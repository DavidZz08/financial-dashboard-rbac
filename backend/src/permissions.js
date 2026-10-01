// Single source of truth for RBAC on the server. Routes never check role names
// directly; they ask for a *permission*, and this table decides which roles hold it.
const PERMISSIONS = Object.freeze({
  MARKET_READ: 'market:read',
  WATCHLIST_READ: 'watchlist:read',
  WATCHLIST_WRITE: 'watchlist:write',
  THRESHOLDS_READ: 'thresholds:read',
  THRESHOLDS_WRITE: 'thresholds:write',
  AUDIT_READ: 'audit:read',
});

const VIEWER = [PERMISSIONS.MARKET_READ, PERMISSIONS.WATCHLIST_READ, PERMISSIONS.THRESHOLDS_READ];
const TRADER = [...VIEWER, PERMISSIONS.WATCHLIST_WRITE];
const ADMIN = [...TRADER, PERMISSIONS.THRESHOLDS_WRITE, PERMISSIONS.AUDIT_READ];

const ROLE_PERMISSIONS = Object.freeze({
  viewer: Object.freeze(new Set(VIEWER)),
  trader: Object.freeze(new Set(TRADER)),
  admin: Object.freeze(new Set(ADMIN)),
});

const ROLES = Object.freeze(Object.keys(ROLE_PERMISSIONS));

function hasPermission(role, permission) {
  // Own-property check: a role like "__proto__" or "constructor" must never match.
  return Object.hasOwn(ROLE_PERMISSIONS, role) && ROLE_PERMISSIONS[role].has(permission);
}

function permissionsFor(role) {
  return Object.hasOwn(ROLE_PERMISSIONS, role) ? [...ROLE_PERMISSIONS[role]] : [];
}

module.exports = { PERMISSIONS, ROLES, hasPermission, permissionsFor };
