const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { ROLES, hasPermission } = require('./permissions');

const ALGORITHM = 'HS256';

// ---- user directory (mock). Passwords are stored as scrypt hashes, never in clear.
function hashPassword(password, salt = crypto.randomBytes(16)) {
  return { salt, hash: crypto.scryptSync(password, salt, 32) };
}

function verifyPassword(password, record) {
  const candidate = crypto.scryptSync(password, record.salt, 32);
  return crypto.timingSafeEqual(candidate, record.hash);
}

const DEMO_USERS = [
  { id: 'u-viewer', username: 'viewer', displayName: 'Vera Viewer', role: 'viewer', password: 'viewer123' },
  { id: 'u-trader', username: 'trader', displayName: 'Tomás Trader', role: 'trader', password: 'trader123' },
  { id: 'u-admin', username: 'admin', displayName: 'Ana Admin', role: 'admin', password: 'admin123' },
];

function createUserDirectory(defs = DEMO_USERS) {
  const byId = new Map();
  const byUsername = new Map();
  for (const def of defs) {
    if (!ROLES.includes(def.role)) throw new Error(`Unknown role: ${def.role}`);
    const user = { id: def.id, username: def.username, displayName: def.displayName, role: def.role };
    const record = { user, password: hashPassword(def.password) };
    byId.set(def.id, record);
    byUsername.set(def.username, record);
  }
  // Used to burn the same CPU time when the username does not exist (no user enumeration by timing).
  const dummy = hashPassword('dummy-password');

  return {
    findById: (id) => byId.get(id)?.user,
    findByRole: (role) => [...byId.values()].map((r) => r.user).find((u) => u.role === role),
    verifyLogin(username, password) {
      const record = byUsername.get(username);
      const ok = verifyPassword(password, record ? record.password : dummy);
      return record && ok ? record.user : null;
    },
  };
}

// ---- JWT issuing + the two Express middlewares that implement RBAC.
function createAuth({ users, secret, expiresIn = '1h', audit }) {
  const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role });

  function issueToken(user) {
    // The token carries identity (sub). Role is only informational: the server re-reads the role
    // from its own directory on every request, so a forged/stale "role" claim can never escalate.
    return jwt.sign({ sub: user.id, username: user.username, role: user.role }, secret, {
      algorithm: ALGORITHM,
      expiresIn,
    });
  }

  function unauthorized(res, message) {
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'unauthorized', message });
  }

  function authenticate(req, res, next) {
    const [scheme, token] = (req.get('authorization') || '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return unauthorized(res, 'Missing bearer token');

    let payload;
    try {
      // Pin the algorithm: prevents "alg: none" and HS/RS confusion attacks.
      payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
    } catch (err) {
      return unauthorized(res, err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
    }

    const user = users.findById(payload.sub);
    if (!user) return unauthorized(res, 'Unknown user');
    req.user = publicUser(user);
    next();
  }

  function authorize(permission) {
    return (req, res, next) => {
      if (!req.user) return unauthorized(res, 'Authentication required'); // defensive: never fail open
      if (!hasPermission(req.user.role, permission)) {
        audit?.({
          actor: req.user.displayName,
          role: req.user.role,
          action: 'access.denied',
          details: `${req.method} ${req.baseUrl}${req.path}`.slice(0, 120) + ` requires ${permission}`,
          outcome: 'denied',
        });
        return res.status(403).json({ error: 'forbidden', message: 'Your role cannot perform this action', required: permission });
      }
      next();
    };
  }

  return { issueToken, authenticate, authorize, publicUser };
}

module.exports = { createUserDirectory, createAuth, DEMO_USERS };
