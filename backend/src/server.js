const path = require('node:path');

// Optional local overrides (.env at the repo root). Real environment variables always win,
// and a missing file is fine (Docker/CI inject variables directly).
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const { loadConfig, ConfigError } = require('./config');
const { createApp } = require('./app');
const { createStore } = require('./store');
const { createUserDirectory } = require('./auth');
const { createMarketService } = require('./marketService');

let config;
try {
  config = loadConfig();
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(`[config] ${err.message}`);
  process.exit(1);
}

if (config.ephemeralSecret) {
  console.warn('[auth] JWT_SECRET is not set: generated a random secret for this run. Sessions end when the server restarts (set JWT_SECRET in .env to keep them).');
}
if (config.production && config.allowDemoLogin) {
  console.warn('[auth] ALLOW_DEMO_LOGIN=true: anyone can obtain a token for any role without a password. Demo use only.');
}

const app = createApp({
  market: createMarketService({ apiKey: config.coingeckoApiKey }),
  store: createStore(),
  users: createUserDirectory(),
  jwtSecret: config.jwtSecret,
  jwtExpiresIn: config.jwtExpiresIn,
  allowDemoLogin: config.allowDemoLogin,
  trustProxy: config.trustProxy,
  accessLog: true,
  staticDir: path.join(__dirname, '..', '..', 'frontend', 'dist'),
});

const server = app.listen(config.port, () => {
  if (config.production) {
    // One process serves API + built UI.
    console.log(`[api] ready  -> open http://localhost:${config.publicPort}`);
    if (config.publicPort !== config.port) console.log(`[api] (container port ${config.port} is published as ${config.publicPort} on your machine)`);
  } else {
    // Dev: this process is only the API; the UI is the Vite dev server, which proxies /api here.
    console.log(`[api] API listening on http://localhost:${config.port}  -> open the app at http://localhost:5173`);
  }
  console.log(`[api] mode=${config.production ? 'production' : 'development'} demoLogin=${config.allowDemoLogin ? 'on' : 'off'}`);
});

// A busy/forbidden port is the most common startup failure: explain it instead of dumping a stack trace.
server.on('error', (err) => {
  if (err.code === 'EACCES' || err.code === 'EADDRINUSE') {
    const why = err.code === 'EADDRINUSE' ? 'is already in use' : 'is forbidden by the OS (on Windows it may be in a reserved range: run `netsh interface ipv4 show excludedportrange protocol=tcp`)';
    console.error(`[api] port ${config.port} ${why}. Pick another one with PORT=<number> (see .env.example).`);
    process.exit(1);
  }
  throw err;
});

// Graceful shutdown: finish in-flight requests when Docker/Kubernetes sends SIGTERM.
function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
