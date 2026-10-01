const crypto = require('node:crypto');

class ConfigError extends Error {}

const MIN_SECRET_LENGTH = 32;
// Outside the TCP ranges Windows commonly reserves for Hyper-V/WinNAT (e.g. 3945-4044, 4045-4144 ... 4597-4696).
const DEFAULT_PORT = 8787;

function parseBool(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ConfigError(`${name} must be "true" or "false" (got "${value}")`);
}

function parsePort(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`${name} must be an integer between 1 and 65535 (got "${value}")`);
  return port;
}

// Reads and validates every environment variable in ONE place, so a bad deployment fails at boot
// with a clear message instead of misbehaving later.
function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';

  let jwtSecret = env.JWT_SECRET;
  let ephemeralSecret = false;
  if (!jwtSecret) {
    jwtSecret = crypto.randomBytes(32).toString('hex'); // secure, but sessions end when the process restarts
    ephemeralSecret = true;
  } else if (jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters (generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")`);
  }

  const port = parsePort('PORT', env.PORT, DEFAULT_PORT);
  return {
    production,
    port,
    // Port the user types in the browser. Differs from `port` under Docker (host:container mapping).
    publicPort: parsePort('PUBLIC_PORT', env.PUBLIC_PORT, port),
    jwtSecret,
    ephemeralSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '1h',
    // Role-switcher endpoint: handy for demos, dangerous in real deployments -> off by default in production.
    allowDemoLogin: parseBool('ALLOW_DEMO_LOGIN', env.ALLOW_DEMO_LOGIN, !production),
    coingeckoApiKey: env.COINGECKO_API_KEY || undefined,
    trustProxy: env.TRUST_PROXY === undefined || env.TRUST_PROXY === '' ? false : /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY,
  };
}

module.exports = { loadConfig, ConfigError, MIN_SECRET_LENGTH };
