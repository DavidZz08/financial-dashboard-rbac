// Tiny fetch wrapper. Holds the bearer token and transparently re-authenticates once on a 401
// (expired token, or the API restarted and rotated its signing secret).
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

let getToken = () => null;
let onExpired = null;

export function configureAuth({ token, handleExpired }) {
  getToken = token;
  onExpired = handleExpired;
}

async function send(path, { method = 'GET', body, authToken }) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

export async function request(path, options = {}) {
  try {
    return await send(path, { ...options, authToken: getToken() });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && onExpired && !options.noRetry) {
      const fresh = await onExpired();
      if (fresh) return send(path, { ...options, authToken: fresh });
    }
    throw err;
  }
}

export const api = {
  demoLogin: (role) => send('/auth/demo-login', { method: 'POST', body: { role } }),
  me: (authToken) => send('/auth/me', { authToken }),
  prices: ({ ids, vs }) => request(`/market/prices?vs=${vs}${ids?.length ? `&ids=${ids.join(',')}` : ''}`),
  summary: (vs) => request(`/market/summary?vs=${vs}`),
  fx: () => request('/market/fx'),
  history: ({ id, vs, days }) => request(`/market/history/${id}?vs=${vs}&days=${days}`),
  watchlist: () => request('/watchlist'),
  addWatch: (payload) => request('/watchlist', { method: 'POST', body: payload }),
  editWatch: (id, payload) => request(`/watchlist/${id}`, { method: 'PATCH', body: payload }),
  removeWatch: (id) => request(`/watchlist/${id}`, { method: 'DELETE' }),
  thresholds: () => request('/thresholds'),
  setThreshold: (volatilityAlertPct) => request('/thresholds', { method: 'PUT', body: { volatilityAlertPct } }),
  audit: () => request('/audit?limit=100'),
};
