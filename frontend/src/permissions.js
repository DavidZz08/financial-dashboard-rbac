// The server is the source of truth: it returns the caller's permission list at login (/auth/me).
// The UI only *reads* that list to decide what to show; the backend still enforces every call.
export const PERM = {
  WATCHLIST_WRITE: 'watchlist:write',
  THRESHOLDS_WRITE: 'thresholds:write',
  AUDIT_READ: 'audit:read',
};

export const can = (session, permission) => Boolean(session?.permissions?.includes(permission));

export const ROLE_LABEL = { viewer: 'Viewer', trader: 'Trader', admin: 'Admin' };

export const REQUIRED_ROLE = {
  [PERM.WATCHLIST_WRITE]: 'Trader',
  [PERM.THRESHOLDS_WRITE]: 'Admin',
  [PERM.AUDIT_READ]: 'Admin',
};
