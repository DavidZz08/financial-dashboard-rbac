const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { createUserDirectory } = require('../src/auth');
const { createMarketService } = require('../src/marketService');

const SECRET = 'test-secret-test-secret-test-secret';

// Fetch that always fails -> market service falls back to mock data (no network in tests).
const offlineFetch = async () => ({ ok: false, status: 503, headers: new Headers(), json: async () => ({}) });

function buildApp(overrides = {}) {
  const store = createStore();
  const users = createUserDirectory();
  const market = createMarketService({ fetchImpl: offlineFetch, maxRetries: 0, sleep: async () => {} });
  const app = createApp({ market, store, users, jwtSecret: SECRET, authRateLimit: 10_000, ...overrides });
  return { app, store, users, market };
}

async function tokenFor(app, role) {
  const res = await request(app).post('/api/auth/demo-login').send({ role });
  if (res.status !== 200) throw new Error(`demo-login failed for ${role}: ${res.status}`);
  return res.body.token;
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { buildApp, tokenFor, bearer, SECRET, request };
