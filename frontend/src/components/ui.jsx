import React from 'react';
import { formatTime } from '../format.js';

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <h2>{title}</h2>
          <div className="card-actions">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

const SOURCE_TEXT = {
  live: 'Live',
  cache: 'Cached',
  stale: 'Stale (API unavailable)',
  mock: 'Mock data (API unavailable)',
};

// Shows where the numbers came from: live API, cache, stale cache or the offline mock fallback.
export function SourceBadge({ meta }) {
  if (!meta) return null;
  const label = SOURCE_TEXT[meta.source] ?? meta.source;
  const reason = meta.reason === 'rate-limited' ? ' · rate-limited' : '';
  return (
    <span className={`badge source-${meta.source}`} title={`Fetched ${formatTime(meta.fetchedAt)}`}>
      {label}
      {reason} · {formatTime(meta.fetchedAt)}
    </span>
  );
}

// Placeholder rendered instead of a view the current role may not see.
export function Locked({ title, role }) {
  return (
    <Card title={title} className="locked">
      <p className="locked-msg">
        <span aria-hidden="true">🔒</span> Requires the <strong>{role}</strong> role. Switch role (top right) to see it.
      </p>
    </Card>
  );
}

// Shimmering placeholder shown while the first load is in flight (no layout jump afterwards).
export function Skeleton({ height = 16, width = '100%', style }) {
  return <span className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

export function ErrorLine({ error }) {
  if (!error) return null;
  return <p className="error-line">⚠ {error.message}</p>;
}
