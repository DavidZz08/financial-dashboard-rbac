const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createMarketService, NotFoundError } = require('../src/marketService');

const coinRow = (id, price = 100, change = 1) => ({
  id, symbol: id.slice(0, 3), name: id, image: 'x', market_cap_rank: 1, current_price: price,
  market_cap: 1e9, total_volume: 1e6, price_change_percentage_24h: change, high_24h: price * 1.02, low_24h: price * 0.98,
});

const ok = (body) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body });
const fail = (status, headers = {}) => ({ ok: false, status, headers: new Headers(headers), json: async () => ({}) });

// Scripted fetch: returns responses in order and records every call.
function scriptedFetch(...responses) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

function make(fetchImpl, extra = {}) {
  const sleeps = [];
  let clock = 1_000_000;
  const svc = createMarketService({
    fetchImpl, baseDelayMs: 100, maxDelayMs: 1000, maxRetries: 3, ttlMs: 30_000, cooldownMs: 60_000,
    random: () => 0, // no jitter -> deterministic delays
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => clock,
    ...extra,
  });
  return { svc, sleeps, advance: (ms) => { clock += ms; } };
}

describe('market service: live + cache', () => {
  test('normalizes CoinGecko payloads', async () => {
    const { svc } = make(scriptedFetch(ok([coinRow('bitcoin', 50000, -2.5)])));
    const { data, meta } = await svc.getMarkets({ ids: ['bitcoin'] });
    assert.equal(meta.source, 'live');
    assert.deepEqual(Object.keys(data[0]).sort(), ['change24h', 'high24h', 'id', 'image', 'low24h', 'marketCap', 'name', 'price', 'rank', 'symbol', 'volume24h']);
    assert.equal(data[0].price, 50000);
    assert.equal(data[0].change24h, -2.5);
  });

  test('second call inside the TTL is served from cache without touching upstream', async () => {
    const f = scriptedFetch(ok([coinRow('bitcoin')]));
    const { svc, advance } = make(f);
    await svc.getMarkets({ ids: ['bitcoin'] });
    advance(10_000);
    const second = await svc.getMarkets({ ids: ['bitcoin'] });
    assert.equal(second.meta.source, 'cache');
    assert.equal(f.calls.length, 1);
    advance(25_000); // TTL (30s) now expired
    await svc.getMarkets({ ids: ['bitcoin'] });
    assert.equal(f.calls.length, 2);
  });

  test('id order does not create separate cache entries', async () => {
    const f = scriptedFetch(ok([coinRow('a'), coinRow('b')]));
    const { svc } = make(f);
    await svc.getMarkets({ ids: ['a', 'b'] });
    await svc.getMarkets({ ids: ['b', 'a'] });
    assert.equal(f.calls.length, 1);
  });

  test('concurrent identical requests are coalesced into one upstream call', async () => {
    const f = scriptedFetch(ok([coinRow('bitcoin')]));
    const { svc } = make(f);
    await Promise.all([svc.getMarkets({ ids: ['bitcoin'] }), svc.getMarkets({ ids: ['bitcoin'] }), svc.getMarkets({ ids: ['bitcoin'] })]);
    assert.equal(f.calls.length, 1);
  });

  test('FX rates are converted relative to USD (CoinGecko quotes vs BTC)', async () => {
    const rates = { usd: { name: 'US Dollar', value: 60000 }, eur: { name: 'Euro', value: 55200 }, jpy: { name: 'Yen', value: 9_000_000 } };
    const { svc } = make(scriptedFetch(ok({ rates })));
    const { data } = await svc.getFxRates();
    assert.equal(data.find((r) => r.code === 'usd').perUsd, 1);
    assert.ok(Math.abs(data.find((r) => r.code === 'eur').perUsd - 0.92) < 1e-9);
    assert.equal(data.find((r) => r.code === 'jpy').perUsd, 150);
  });
});

describe('market service: rate limiting & failures', () => {
  test('retries a 429 with exponential backoff then succeeds', async () => {
    const f = scriptedFetch(fail(429), fail(429), fail(503), ok([coinRow('bitcoin')]));
    const { svc, sleeps } = make(f);
    const { meta } = await svc.getMarkets({ ids: ['bitcoin'] });
    assert.equal(meta.source, 'live');
    assert.equal(f.calls.length, 4);
    assert.deepEqual(sleeps, [100, 200, 400]); // base * 2^attempt
  });

  test('backoff is capped at maxDelayMs', async () => {
    const f = scriptedFetch(fail(500));
    const { svc, sleeps } = make(f, { maxRetries: 5, baseDelayMs: 400, maxDelayMs: 1000 });
    await svc.getMarkets({ ids: ['bitcoin'] });
    assert.deepEqual(sleeps, [400, 800, 1000, 1000, 1000]);
  });

  test('honours a short Retry-After instead of the computed backoff', async () => {
    const f = scriptedFetch(fail(429, { 'retry-after': '1' }), ok([coinRow('bitcoin')]));
    const { svc, sleeps } = make(f);
    await svc.getMarkets({ ids: ['bitcoin'] });
    assert.deepEqual(sleeps, [1000]);
  });

  test('a long Retry-After is not waited on: fall back immediately and cool down', async () => {
    const f = scriptedFetch(fail(429, { 'retry-after': '120' }));
    const { svc, sleeps, advance } = make(f);
    const first = await svc.getMarkets({ ids: ['bitcoin'] });
    assert.equal(first.meta.source, 'mock');
    assert.equal(first.meta.reason, 'rate-limited');
    assert.equal(sleeps.length, 0);
    assert.equal(f.calls.length, 1);
    // during the cooldown upstream is not hit again
    advance(60_000);
    await svc.getMarkets({ ids: ['ethereum'] });
    assert.equal(f.calls.length, 1);
    advance(61_000); // cooldown (120s from Retry-After) over
    await svc.getMarkets({ ids: ['solana'] });
    assert.equal(f.calls.length, 2);
  });

  test('exhausted retries on 429 -> mock data, then cooldown protects the API', async () => {
    const f = scriptedFetch(fail(429));
    const { svc } = make(f);
    const first = await svc.getMarkets({ ids: ['bitcoin'] });
    assert.equal(first.meta.source, 'mock');
    assert.equal(f.calls.length, 4); // 1 + 3 retries
    await svc.getMarkets({ ids: ['bitcoin'] });
    await svc.getMarkets({ vs: 'eur' });
    assert.equal(f.calls.length, 4, 'no more upstream calls during cooldown');
  });

  test('serves STALE cache (not mock) when upstream breaks after a good response', async () => {
    const f = scriptedFetch(ok([coinRow('bitcoin', 123)]), fail(503));
    const { svc, advance } = make(f);
    await svc.getMarkets({ ids: ['bitcoin'] });
    advance(31_000);
    const res = await svc.getMarkets({ ids: ['bitcoin'] });
    assert.equal(res.meta.source, 'stale');
    assert.equal(res.data[0].price, 123);
  });

  test('network errors / timeouts are retried and eventually fall back to mock', async () => {
    const f = scriptedFetch(new TypeError('fetch failed'));
    const { svc } = make(f);
    const res = await svc.getMarkets({});
    assert.equal(res.meta.source, 'mock');
    assert.equal(res.meta.reason, 'upstream-unavailable');
    assert.ok(res.data.length > 5);
    assert.equal(f.calls.length, 4);
  });

  test('non-retryable 4xx (e.g. 401 bad key) is not retried', async () => {
    const f = scriptedFetch(fail(401));
    const { svc, sleeps } = make(f);
    const res = await svc.getMarkets({ ids: ['bitcoin'] });
    assert.equal(res.meta.source, 'mock');
    assert.equal(f.calls.length, 1);
    assert.equal(sleeps.length, 0);
  });

  test('unknown asset history: upstream 404 propagates as NotFoundError', async () => {
    const { svc } = make(scriptedFetch(fail(404)));
    await assert.rejects(svc.getHistory({ id: 'nope' }), NotFoundError);
  });

  test('unknown asset history in mock mode is NotFound too', async () => {
    const { svc } = make(scriptedFetch(fail(503)), { maxRetries: 0 });
    await assert.rejects(svc.getHistory({ id: 'nope' }), NotFoundError);
  });

  test('mock history is deterministic, ends at the mock price and has the requested resolution', async () => {
    const { svc } = make(scriptedFetch(fail(503)), { maxRetries: 0 });
    const a = await svc.getHistory({ id: 'bitcoin', days: 7 });
    const b = await svc.getHistory({ id: 'bitcoin', days: 7 });
    assert.equal(a.meta.source, 'mock');
    assert.equal(a.data.length, 168);
    assert.deepEqual(a.data.map((p) => p.price), b.data.map((p) => p.price));
    assert.equal(a.data.at(-1).price, 67000);
  });
});
