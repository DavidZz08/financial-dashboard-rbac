const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { createAuth } = require('./auth');
const { PERMISSIONS, permissionsFor, ROLES } = require('./permissions');
const { NotFoundError } = require('./marketService');
const v = require('./validate');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp({ market, store, users, jwtSecret, jwtExpiresIn, allowDemoLogin = true, trustProxy = false, accessLog = false, staticDir, authRateLimit = 100 }) {
  const auth = createAuth({ users, secret: jwtSecret, expiresIn: jwtExpiresIn, audit: store.audit });
  const { authenticate, authorize } = auth;
  const actor = (req) => ({ actor: req.user.displayName, role: req.user.role });

  const app = express();
  app.disable('x-powered-by');
  // Behind a reverse proxy (nginx, a cloud load balancer) the real client IP is in X-Forwarded-For;
  // without this the login rate limiter would see every user as the proxy's single IP.
  if (trustProxy) app.set('trust proxy', trustProxy);

  if (accessLog) {
    // One line per request: method, path WITHOUT the query string, status, duration. Never headers/tokens/bodies.
    app.use((req, res, next) => {
      const started = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        console.log(`[http] ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(0)}ms`);
      });
      next();
    });
  }
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'img-src': ["'self'", 'data:', 'https://coin-images.coingecko.com', 'https://assets.coingecko.com'] },
      },
    }),
  );
  app.use(express.json({ limit: '10kb' }));

  // ---------------------------------------------------------------- public routes (no token)
  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ status: 'ok' }));

  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: authRateLimit, standardHeaders: true, legacyHeaders: false });

  api.post('/auth/login', loginLimiter, (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'bad_request', message: 'username and password are required' });
    const user = users.verifyLogin(username, password);
    if (!user) {
      store.audit({ actor: username.slice(0, 40), role: 'none', action: 'auth.login', details: 'Invalid credentials', outcome: 'denied' });
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid credentials' });
    }
    store.audit({ actor: user.displayName, role: user.role, action: 'auth.login', details: 'Password login' });
    res.json({ token: auth.issueToken(user), user: auth.publicUser(user), permissions: permissionsFor(user.role) });
  });

  // Role-switcher backend: mints a token for a seeded demo user WITHOUT a password.
  // This is a testing convenience required by the brief; it is disabled with ALLOW_DEMO_LOGIN=false.
  api.post('/auth/demo-login', loginLimiter, (req, res) => {
    if (!allowDemoLogin) return res.status(404).json({ error: 'not_found', message: 'Demo login is disabled' });
    const role = req.body?.role;
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'bad_request', message: `role must be one of: ${ROLES.join(', ')}` });
    const user = users.findByRole(role);
    store.audit({ actor: user.displayName, role: user.role, action: 'auth.switch_role', details: `Demo login as ${role}` });
    res.json({ token: auth.issueToken(user), user: auth.publicUser(user), permissions: permissionsFor(user.role) });
  });

  // ---------------------------------------------------------------- everything below requires a valid token
  // Authentication is applied to the whole router *before* any route is declared: a route added
  // later without thinking about security is still protected (deny-by-default).
  api.use(authenticate);

  api.get('/auth/me', (req, res) => res.json({ user: req.user, permissions: permissionsFor(req.user.role) }));

  // ---- market data (viewer+)
  const marketRead = authorize(PERMISSIONS.MARKET_READ);
  const respond = (res, result, extra = {}) => res.json({ data: result.data, meta: result.meta, ...extra });

  api.get(
    '/market/prices',
    marketRead,
    asyncHandler(async (req, res) => {
      const vs = v.parseCurrency(req.query.vs);
      const ids = v.parseIds(req.query.ids);
      const result = await market.getMarkets({ vs, ids });
      const threshold = store.thresholds().volatilityAlertPct;
      const data = result.data.map((c) => ({ ...c, alert: Math.abs(c.change24h ?? 0) >= threshold }));
      respond(res, { ...result, data }, { threshold });
    }),
  );

  api.get('/market/summary', marketRead, asyncHandler(async (req, res) => respond(res, await market.getGlobal({ vs: v.parseCurrency(req.query.vs) }))));

  api.get('/market/fx', marketRead, asyncHandler(async (_req, res) => respond(res, await market.getFxRates())));

  api.get(
    '/market/history/:id',
    marketRead,
    asyncHandler(async (req, res) => {
      const id = v.parseCoinId(req.params.id);
      respond(res, await market.getHistory({ id, vs: v.parseCurrency(req.query.vs), days: v.parseDays(req.query.days) }));
    }),
  );

  // ---- watchlist (read: everyone, write: trader+)
  api.get('/watchlist', authorize(PERMISSIONS.WATCHLIST_READ), (_req, res) => res.json({ data: store.watchlist.list() }));

  const watchlistWrite = authorize(PERMISSIONS.WATCHLIST_WRITE);

  api.post(
    '/watchlist',
    watchlistWrite,
    asyncHandler(async (req, res) => {
      const id = v.parseCoinId(req.body?.id);
      const note = v.parseNote(req.body?.note);
      const targetPrice = v.parseTargetPrice(req.body?.targetPrice);
      if (store.watchlist.has(id)) return res.status(409).json({ error: 'conflict', message: `${id} is already in the watchlist` });
      const known = await market.getMarkets({ ids: [id] });
      if (known.data.length === 0) return res.status(404).json({ error: 'not_found', message: `Unknown asset: ${id}` });
      // The lookup above awaited: another request may have inserted the same asset meanwhile.
      if (store.watchlist.has(id)) return res.status(409).json({ error: 'conflict', message: `${id} is already in the watchlist` });
      const item = store.watchlist.add(id, req.user.displayName, { note: note ?? '', targetPrice: targetPrice ?? null });
      store.audit({ ...actor(req), action: 'watchlist.add', details: `Added ${id} to watchlist` });
      res.status(201).json({ data: item });
    }),
  );

  api.patch('/watchlist/:id', watchlistWrite, (req, res) => {
    const id = v.parseCoinId(req.params.id);
    if (!store.watchlist.has(id)) return res.status(404).json({ error: 'not_found', message: `${id} is not in the watchlist` });
    // Whitelist the editable fields: no mass-assignment of addedBy/addedAt/etc.
    const patch = {};
    const note = v.parseNote(req.body?.note);
    const targetPrice = v.parseTargetPrice(req.body?.targetPrice);
    if (note !== undefined) patch.note = note;
    if (targetPrice !== undefined) patch.targetPrice = targetPrice;
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'bad_request', message: 'Provide note and/or targetPrice' });
    const item = store.watchlist.update(id, patch);
    store.audit({ ...actor(req), action: 'watchlist.update', details: `Edited ${id}: ${Object.keys(patch).join(', ')}` });
    res.json({ data: item });
  });

  api.delete('/watchlist/:id', watchlistWrite, (req, res) => {
    const id = v.parseCoinId(req.params.id);
    if (!store.watchlist.remove(id)) return res.status(404).json({ error: 'not_found', message: `${id} is not in the watchlist` });
    store.audit({ ...actor(req), action: 'watchlist.remove', details: `Removed ${id} from watchlist` });
    res.status(204).end();
  });

  // ---- global thresholds (read: everyone, write: admin)
  api.get('/thresholds', authorize(PERMISSIONS.THRESHOLDS_READ), (_req, res) => res.json({ data: store.thresholds() }));

  api.put('/thresholds', authorize(PERMISSIONS.THRESHOLDS_WRITE), (req, res) => {
    const value = v.parseThreshold(req.body?.volatilityAlertPct);
    const previous = store.setVolatilityAlertPct(value);
    store.audit({ ...actor(req), action: 'threshold.update', details: `Volatility alert trigger ${previous}% -> ${value}%` });
    res.json({ data: store.thresholds() });
  });

  // ---- audit log (admin only)
  api.get('/audit', authorize(PERMISSIONS.AUDIT_READ), (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    res.json({ data: store.auditEntries(limit) });
  });

  // Authenticated request to a route that does not exist.
  api.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Route not found' }));

  app.use('/api', api);

  // ---------------------------------------------------------------- production: serve the built SPA
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err instanceof v.ValidationError) return res.status(400).json({ error: 'bad_request', message: err.message });
    if (err instanceof NotFoundError) return res.status(404).json({ error: 'not_found', message: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_request', message: 'Malformed JSON body' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'Body too large' });
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: 'Unexpected error' }); // never leak stack traces
  });

  return app;
}

module.exports = { createApp };
