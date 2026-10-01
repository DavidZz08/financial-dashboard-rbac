const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { buildApp, tokenFor, bearer, SECRET, request } = require('./helpers');
const { hasPermission, PERMISSIONS } = require('../src/permissions');

// [method, path, body, seedWatchlist, expected HTTP status per role ('anon' = no token at all)]
const MATRIX = [
  ['GET', '/api/market/prices', undefined, false, { anon: 401, viewer: 200, trader: 200, admin: 200 }],
  ['GET', '/api/market/summary', undefined, false, { anon: 401, viewer: 200, trader: 200, admin: 200 }],
  ['GET', '/api/market/fx', undefined, false, { anon: 401, viewer: 200, trader: 200, admin: 200 }],
  ['GET', '/api/market/history/bitcoin', undefined, false, { anon: 401, viewer: 200, trader: 200, admin: 200 }],
  ['GET', '/api/watchlist', undefined, false, { anon: 401, viewer: 200, trader: 200, admin: 200 }],
  ['POST', '/api/watchlist', { id: 'solana' }, false, { anon: 401, viewer: 403, trader: 201, admin: 201 }],
  ['PATCH', '/api/watchlist/solana', { note: 'x' }, true, { anon: 401, viewer: 403, trader: 200, admin: 200 }],
  ['DELETE', '/api/watchlist/solana', undefined, true, { anon: 401, viewer: 403, trader: 204, admin: 204 }],
  ['GET', '/api/thresholds', undefined, false, { anon: 401, viewer: 200, trader: 200, admin: 200 }],
  ['PUT', '/api/thresholds', { volatilityAlertPct: 7 }, false, { anon: 401, viewer: 403, trader: 403, admin: 200 }],
  ['GET', '/api/audit', undefined, false, { anon: 401, viewer: 403, trader: 403, admin: 200 }],
  ['GET', '/api/does-not-exist', undefined, false, { anon: 401, viewer: 404, trader: 404, admin: 404 }],
];

describe('RBAC matrix (HTTP status per route x role)', () => {
  for (const [method, path, body, seed, expected] of MATRIX) {
    for (const [role, want] of Object.entries(expected)) {
      test(`${method} ${path} as ${role} -> ${want}`, async () => {
        const { app, store } = buildApp(); // fresh state per cell: no cross-test coupling
        if (seed) store.watchlist.add('solana', 'seed');
        const req = request(app)[method.toLowerCase()](path);
        if (role !== 'anon') req.set(bearer(await tokenFor(app, role)));
        if (body !== undefined) req.send(body);
        const res = await req;
        assert.equal(res.status, want, JSON.stringify(res.body));
      });
    }
  }
});

describe('denied requests have no side effects', () => {
  test('viewer cannot mutate watchlist or thresholds', async () => {
    const { app, store } = buildApp();
    const viewer = await tokenFor(app, 'viewer');
    await request(app).post('/api/watchlist').set(bearer(viewer)).send({ id: 'bitcoin' }).expect(403);
    await request(app).put('/api/thresholds').set(bearer(viewer)).send({ volatilityAlertPct: 50 }).expect(403);
    assert.equal(store.watchlist.list().length, 0);
    assert.equal(store.thresholds().volatilityAlertPct, 5);
  });

  test('denials are written to the audit log', async () => {
    const { app } = buildApp();
    const viewer = await tokenFor(app, 'viewer');
    const admin = await tokenFor(app, 'admin');
    await request(app).get('/api/audit').set(bearer(viewer)).expect(403);
    const log = await request(app).get('/api/audit').set(bearer(admin)).expect(200);
    const denied = log.body.data.find((e) => e.action === 'access.denied');
    assert.ok(denied, 'expected an access.denied entry');
    assert.equal(denied.role, 'viewer');
    assert.match(denied.details, /audit:read/);
  });
});

describe('token security', () => {
  test('rejects malformed, tampered and wrong-secret tokens with 401', async () => {
    const { app } = buildApp();
    const good = await tokenFor(app, 'viewer');
    const forged = jwt.sign({ sub: 'u-admin' }, 'another-secret', { algorithm: 'HS256' });
    const tampered = good.slice(0, -2) + (good.endsWith('aa') ? 'bb' : 'aa');
    for (const header of ['Bearer', 'Bearer not.a.jwt', `Bearer ${forged}`, `Bearer ${tampered}`, `Basic ${good}`, '']) {
      await request(app).get('/api/auth/me').set('Authorization', header).expect(401);
    }
  });

  test('rejects an unsigned "alg: none" token', async () => {
    const { app } = buildApp();
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u-admin', role: 'admin' })}.`;
    await request(app).get('/api/audit').set(bearer(none)).expect(401);
  });

  test('rejects an expired token', async () => {
    const { app } = buildApp();
    const expired = jwt.sign({ sub: 'u-admin' }, SECRET, { algorithm: 'HS256', expiresIn: -10 });
    const res = await request(app).get('/api/audit').set(bearer(expired)).expect(401);
    assert.match(res.body.message, /expired/i);
  });

  test('a correctly signed token cannot escalate by lying about its role claim', async () => {
    const { app } = buildApp();
    const lying = jwt.sign({ sub: 'u-viewer', role: 'admin' }, SECRET, { algorithm: 'HS256' });
    await request(app).get('/api/audit').set(bearer(lying)).expect(403);
    const me = await request(app).get('/api/auth/me').set(bearer(lying)).expect(200);
    assert.equal(me.body.user.role, 'viewer');
  });

  test('a token for a user that no longer exists is rejected', async () => {
    const { app } = buildApp();
    const ghost = jwt.sign({ sub: 'u-ghost', role: 'admin' }, SECRET, { algorithm: 'HS256' });
    await request(app).get('/api/market/prices').set(bearer(ghost)).expect(401);
  });

  test('responses to 401 carry WWW-Authenticate', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/market/prices').expect(401);
    assert.equal(res.headers['www-authenticate'], 'Bearer');
  });
});

describe('login', () => {
  test('password login works and returns the permission list', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/auth/login').send({ username: 'trader', password: 'trader123' }).expect(200);
    assert.equal(res.body.user.role, 'trader');
    assert.ok(res.body.permissions.includes('watchlist:write'));
    assert.ok(!res.body.permissions.includes('audit:read'));
    assert.equal(res.body.user.password, undefined);
  });

  test('wrong password, unknown user and bad types all fail without revealing which', async () => {
    const { app } = buildApp();
    const a = await request(app).post('/api/auth/login').send({ username: 'trader', password: 'nope' }).expect(401);
    const b = await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'nope' }).expect(401);
    assert.deepEqual(a.body, b.body);
    await request(app).post('/api/auth/login').send({ username: { $ne: null }, password: 'x' }).expect(400);
  });

  test('demo login can be switched off', async () => {
    const { app } = buildApp({ allowDemoLogin: false });
    await request(app).post('/api/auth/demo-login').send({ role: 'admin' }).expect(404);
  });

  test('demo login rejects unknown roles (including prototype keys)', async () => {
    const { app } = buildApp();
    for (const role of ['superuser', '__proto__', 'constructor', undefined, 5]) {
      await request(app).post('/api/auth/demo-login').send({ role }).expect(400);
    }
  });
});

describe('permission table', () => {
  test('is least-privilege and hierarchical', () => {
    assert.ok(hasPermission('viewer', PERMISSIONS.MARKET_READ));
    assert.ok(!hasPermission('viewer', PERMISSIONS.WATCHLIST_WRITE));
    assert.ok(hasPermission('trader', PERMISSIONS.WATCHLIST_WRITE));
    assert.ok(!hasPermission('trader', PERMISSIONS.THRESHOLDS_WRITE));
    assert.ok(!hasPermission('trader', PERMISSIONS.AUDIT_READ));
    assert.ok(hasPermission('admin', PERMISSIONS.AUDIT_READ));
  });

  test('unknown roles hold nothing', () => {
    for (const role of ['', undefined, null, '__proto__', 'constructor', 'toString', 'root']) {
      assert.equal(hasPermission(role, PERMISSIONS.MARKET_READ), false, String(role));
    }
  });
});
