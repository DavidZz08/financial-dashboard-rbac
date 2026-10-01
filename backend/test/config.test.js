const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, ConfigError } = require('../src/config');

const GOOD_SECRET = 'a'.repeat(40);

describe('config', () => {
  test('safe defaults for development', () => {
    const c = loadConfig({});
    assert.equal(c.port, 8787);
    assert.equal(c.publicPort, 8787);
    assert.equal(c.allowDemoLogin, true);
    assert.equal(c.ephemeralSecret, true);
    assert.equal(c.jwtSecret.length, 64);
    assert.equal(c.trustProxy, false);
  });

  test('generates a different ephemeral secret on every load', () => {
    assert.notEqual(loadConfig({}).jwtSecret, loadConfig({}).jwtSecret);
  });

  test('demo login is OFF by default in production but can be enabled explicitly', () => {
    assert.equal(loadConfig({ NODE_ENV: 'production' }).allowDemoLogin, false);
    assert.equal(loadConfig({ NODE_ENV: 'production', ALLOW_DEMO_LOGIN: 'true' }).allowDemoLogin, true);
    assert.equal(loadConfig({ ALLOW_DEMO_LOGIN: 'false' }).allowDemoLogin, false);
  });

  test('uses the provided secret and rejects short ones', () => {
    const c = loadConfig({ JWT_SECRET: GOOD_SECRET });
    assert.equal(c.jwtSecret, GOOD_SECRET);
    assert.equal(c.ephemeralSecret, false);
    assert.throws(() => loadConfig({ JWT_SECRET: 'short' }), ConfigError);
  });

  test('validates PORT / PUBLIC_PORT / booleans', () => {
    assert.equal(loadConfig({ PORT: '5000' }).port, 5000);
    assert.equal(loadConfig({ PORT: '4000', PUBLIC_PORT: '8080' }).publicPort, 8080);
    for (const bad of ['abc', '0', '70000', '12.5', '-1']) assert.throws(() => loadConfig({ PORT: bad }), ConfigError, bad);
    assert.throws(() => loadConfig({ ALLOW_DEMO_LOGIN: 'yes' }), ConfigError);
  });

  test('TRUST_PROXY accepts hop counts and keywords', () => {
    assert.equal(loadConfig({ TRUST_PROXY: '1' }).trustProxy, 1);
    assert.equal(loadConfig({ TRUST_PROXY: 'loopback' }).trustProxy, 'loopback');
  });

  test('empty strings (as produced by docker compose defaults) behave like "unset"', () => {
    const c = loadConfig({ JWT_SECRET: '', COINGECKO_API_KEY: '', PORT: '', ALLOW_DEMO_LOGIN: '' });
    assert.equal(c.ephemeralSecret, true);
    assert.equal(c.coingeckoApiKey, undefined);
    assert.equal(c.port, 8787);
  });
});
