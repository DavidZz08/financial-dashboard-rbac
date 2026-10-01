const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildApp, tokenFor, bearer, request } = require('./helpers');

describe('market endpoints (offline -> mock fallback)', () => {
  test('prices include source meta and an alert flag driven by the global threshold', async () => {
    const { app } = buildApp();
    const t = await tokenFor(app, 'viewer');
    const res = await request(app).get('/api/market/prices?ids=cardano,bitcoin').set(bearer(t)).expect(200);
    assert.equal(res.body.meta.source, 'mock');
    assert.equal(res.body.threshold, 5);
    const byId = Object.fromEntries(res.body.data.map((c) => [c.id, c]));
    assert.equal(byId.cardano.alert, true); // -6.3% >= 5
    assert.equal(byId.bitcoin.alert, false);
  });

  test('changing the threshold changes the alerts (admin -> everyone)', async () => {
    const { app } = buildApp();
    const admin = await tokenFor(app, 'admin');
    const viewer = await tokenFor(app, 'viewer');
    await request(app).put('/api/thresholds').set(bearer(admin)).send({ volatilityAlertPct: 1 }).expect(200);
    const res = await request(app).get('/api/market/prices?ids=bitcoin').set(bearer(viewer)).expect(200);
    assert.equal(res.body.data[0].alert, true); // +1.8% >= 1
  });

  test('input validation on query params', async () => {
    const { app } = buildApp();
    const t = await tokenFor(app, 'viewer');
    for (const url of [
      '/api/market/prices?vs=xyz',
      '/api/market/prices?ids=BTC;DROP',
      '/api/market/prices?ids=../../etc/passwd',
      '/api/market/history/bitcoin?days=9999',
      '/api/market/history/bad%20id',
    ]) {
      await request(app).get(url).set(bearer(t)).expect(400);
    }
    const many = Array.from({ length: 30 }, (_, i) => `coin${i}`).join(',');
    await request(app).get(`/api/market/prices?ids=${many}`).set(bearer(t)).expect(400);
  });

  test('history, summary and fx return normalized data', async () => {
    const { app } = buildApp();
    const t = await tokenFor(app, 'viewer');
    const h = await request(app).get('/api/market/history/ethereum?days=30&vs=eur').set(bearer(t)).expect(200);
    assert.ok(h.body.data.length > 10 && typeof h.body.data[0].t === 'number');
    const s = await request(app).get('/api/market/summary').set(bearer(t)).expect(200);
    assert.ok(s.body.data.totalMarketCap > 0 && s.body.data.btcDominance > 0);
    const fx = await request(app).get('/api/market/fx').set(bearer(t)).expect(200);
    assert.ok(fx.body.data.some((r) => r.code === 'eur'));
    await request(app).get('/api/market/history/not-a-coin').set(bearer(t)).expect(404);
  });
});

describe('watchlist behaviour', () => {
  test('trader full CRUD + audit trail', async () => {
    const { app } = buildApp();
    const trader = await tokenFor(app, 'trader');
    const admin = await tokenFor(app, 'admin');

    const created = await request(app).post('/api/watchlist').set(bearer(trader)).send({ id: 'Bitcoin', note: 'core', targetPrice: 80000 }).expect(201);
    assert.equal(created.body.data.id, 'bitcoin'); // normalized to lowercase
    assert.equal(created.body.data.addedBy, 'Tomás Trader');

    await request(app).post('/api/watchlist').set(bearer(trader)).send({ id: 'bitcoin' }).expect(409);
    const patched = await request(app).patch('/api/watchlist/bitcoin').set(bearer(trader)).send({ note: 'updated', targetPrice: null }).expect(200);
    assert.equal(patched.body.data.note, 'updated');
    assert.equal(patched.body.data.targetPrice, null);
    await request(app).delete('/api/watchlist/bitcoin').set(bearer(trader)).expect(204);
    await request(app).delete('/api/watchlist/bitcoin').set(bearer(trader)).expect(404);

    const log = await request(app).get('/api/audit').set(bearer(admin)).expect(200);
    const actions = log.body.data.map((e) => e.action);
    for (const a of ['watchlist.add', 'watchlist.update', 'watchlist.remove']) assert.ok(actions.includes(a), a);
    const add = log.body.data.find((e) => e.action === 'watchlist.add');
    assert.equal(add.actor, 'Tomás Trader');
    assert.equal(add.role, 'trader');
    assert.match(add.details, /bitcoin/);
  });

  test('unknown asset is rejected, bad payloads are 400', async () => {
    const { app } = buildApp();
    const trader = await tokenFor(app, 'trader');
    await request(app).post('/api/watchlist').set(bearer(trader)).send({ id: 'totally-fake-coin' }).expect(404);
    await request(app).post('/api/watchlist').set(bearer(trader)).send({}).expect(400);
    await request(app).post('/api/watchlist').set(bearer(trader)).send({ id: 'bitcoin', targetPrice: -5 }).expect(400);
    await request(app).post('/api/watchlist').set(bearer(trader)).send({ id: 'bitcoin', note: 'x'.repeat(201) }).expect(400);
    await request(app).post('/api/watchlist').set(bearer(trader)).set('Content-Type', 'application/json').send('{bad json').expect(400);
  });

  test('PATCH cannot overwrite protected fields (no mass assignment)', async () => {
    const { app, store } = buildApp();
    const trader = await tokenFor(app, 'trader');
    await request(app).post('/api/watchlist').set(bearer(trader)).send({ id: 'solana' }).expect(201);
    const before = store.watchlist.get('solana');
    await request(app).patch('/api/watchlist/solana').set(bearer(trader)).send({ addedBy: 'Hacker', id: 'other' }).expect(400);
    await request(app).patch('/api/watchlist/solana').set(bearer(trader)).send({ note: 'ok', addedBy: 'Hacker' }).expect(200);
    const after = store.watchlist.get('solana');
    assert.equal(after.addedBy, before.addedBy);
    assert.equal(after.id, 'solana');
  });

  test('viewers can read the watchlist (read-only)', async () => {
    const { app, store } = buildApp();
    store.watchlist.add('bitcoin', 'seed');
    const viewer = await tokenFor(app, 'viewer');
    const res = await request(app).get('/api/watchlist').set(bearer(viewer)).expect(200);
    assert.equal(res.body.data.length, 1);
  });
});

describe('thresholds', () => {
  test('admin can update within range, out-of-range or wrong type is 400', async () => {
    const { app } = buildApp();
    const admin = await tokenFor(app, 'admin');
    const ok = await request(app).put('/api/thresholds').set(bearer(admin)).send({ volatilityAlertPct: 12.345 }).expect(200);
    assert.equal(ok.body.data.volatilityAlertPct, 12.35);
    for (const bad of [0, -1, 101, '5', null, NaN, undefined]) {
      await request(app).put('/api/thresholds').set(bearer(admin)).send({ volatilityAlertPct: bad }).expect(400);
    }
  });

  test('update is audited with old and new value', async () => {
    const { app } = buildApp();
    const admin = await tokenFor(app, 'admin');
    await request(app).put('/api/thresholds').set(bearer(admin)).send({ volatilityAlertPct: 9 }).expect(200);
    const log = await request(app).get('/api/audit').set(bearer(admin)).expect(200);
    const entry = log.body.data.find((e) => e.action === 'threshold.update');
    assert.equal(entry.actor, 'Ana Admin');
    assert.match(entry.details, /5% -> 9%/);
  });
});

describe('audit log', () => {
  test('is newest-first, records logins/role switches and failed logins', async () => {
    const { app } = buildApp();
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' }).expect(401);
    const admin = await tokenFor(app, 'admin');
    const log = await request(app).get('/api/audit').set(bearer(admin)).expect(200);
    const entries = log.body.data;
    assert.ok(entries[0].id > entries.at(-1).id);
    assert.ok(entries.some((e) => e.action === 'auth.login' && e.outcome === 'denied'));
    assert.ok(entries.some((e) => e.action === 'auth.switch_role'));
    assert.ok(!JSON.stringify(entries).includes('wrong'), 'passwords must never be logged');
  });

  test('is bounded', async () => {
    const { store } = buildApp();
    for (let i = 0; i < 700; i++) store.audit({ actor: 'x', role: 'viewer', action: 'noop' });
    assert.equal(store.auditEntries(1000).length, 500);
  });
});

describe('hardening regressions', () => {
  test('a low-privilege user spamming 403s cannot evict real activity from the audit log', async () => {
    const { app } = buildApp();
    const trader = await tokenFor(app, 'trader');
    const viewer = await tokenFor(app, 'viewer');
    const admin = await tokenFor(app, 'admin');
    await request(app).post('/api/watchlist').set(bearer(trader)).send({ id: 'bitcoin' }).expect(201);
    for (let i = 0; i < 600; i++) await request(app).get('/api/audit').set(bearer(viewer)); // 403 each
    const log = await request(app).get('/api/audit?limit=500').set(bearer(admin)).expect(200);
    assert.ok(log.body.data.some((e) => e.action === 'watchlist.add'), 'watchlist.add must survive the flood');
  });

  test('concurrent POSTs for the same asset create exactly one entry', async () => {
    // Slow upstream lookup widens the window between the "already exists?" check and the insert.
    const slowMarket = { getMarkets: async () => { await new Promise((r) => setTimeout(r, 50)); return { data: [{ id: 'solana' }], meta: {} }; } };
    const { app, store } = buildApp({ market: slowMarket });
    const trader = await tokenFor(app, 'trader');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post('/api/watchlist').set(bearer(trader)).send({ id: 'solana' })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409, 409]);
    assert.equal(store.watchlist.list().length, 1);
    assert.equal(store.auditEntries(100).filter((e) => e.action === 'watchlist.add').length, 1);
  });
});

describe('access log', () => {
  test('logs method/path/status but never tokens, bodies or query strings', async () => {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      const { app } = buildApp({ accessLog: true });
      const token = await tokenFor(app, 'viewer');
      await request(app).get('/api/market/prices?ids=bitcoin&secret=hunter2').set(bearer(token)).expect(200);
      await request(app).post('/api/auth/login').send({ username: 'admin', password: 'super-secret-pw' }).expect(401);
    } finally {
      console.log = original;
    }
    const text = lines.join('\n');
    assert.match(text, /\[http\] GET \/api\/market\/prices 200 \d+ms/);
    assert.ok(!text.includes(lines.length ? 'hunter2' : '###'), 'query string leaked');
    assert.ok(!text.includes('super-secret-pw'), 'password leaked');
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(text), 'a JWT leaked');
  });
});
