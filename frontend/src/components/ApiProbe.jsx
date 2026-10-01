import React, { useState } from 'react';
import { Card } from './ui.jsx';
import { ApiError, request } from '../api.js';

// Harmless requests that show the *backend* enforcing RBAC regardless of what the UI hides.
// Authorised roles get 400/404 (the bad payload / missing id is rejected); others get 403.
const PROBES = [
  { label: 'GET /audit', path: '/audit' },
  { label: 'PUT /thresholds (empty body)', path: '/thresholds', method: 'PUT', body: {} },
  { label: 'POST /watchlist (empty body)', path: '/watchlist', method: 'POST', body: {} },
  { label: 'DELETE /watchlist/_probe_', path: '/watchlist/_probe_', method: 'DELETE' },
];

export default function ApiProbe({ role }) {
  const [results, setResults] = useState([]);

  const run = async (probe) => {
    let status;
    let message;
    try {
      await request(probe.path, { method: probe.method, body: probe.body, noRetry: true });
      status = 200;
      message = 'OK';
    } catch (err) {
      status = err instanceof ApiError ? err.status : 0;
      message = err.message;
    }
    setResults((r) => [{ id: Date.now() + Math.random(), role, label: probe.label, status, message }, ...r].slice(0, 6));
  };

  return (
    <Card title="Backend enforcement probe" className="probe">
      <p className="muted">Fires real API calls with the current token. 403 = blocked by middleware. 400/404 = permission granted, payload rejected.</p>
      <div className="probe-buttons">
        {PROBES.map((p) => (
          <button key={p.label} onClick={() => run(p)}>
            {p.label}
          </button>
        ))}
      </div>
      <ul className="probe-results">
        {results.map((r) => (
          <li key={r.id}>
            <span className={`badge status-${String(r.status)[0]}`}>{r.status}</span> <span className="muted">as {r.role}</span> {r.label} — {r.message}
          </li>
        ))}
      </ul>
    </Card>
  );
}
