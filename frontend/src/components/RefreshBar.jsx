import React from 'react';
import { timeAgo } from '../format.js';
import { useNow } from '../useNow.js';

export default function RefreshBar({ updatedAt, refreshing, onRefresh }) {
  const now = useNow(1000);
  return (
    <div className="refresh-bar">
      <span className="muted" aria-live="off">
        {updatedAt ? `Prices updated ${timeAgo(updatedAt, now)}` : 'Waiting for data…'} · auto-refresh every 30s
      </span>
      <button onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>
        <span className={refreshing ? 'spin' : ''} aria-hidden="true">⟳</span> {refreshing ? 'Refreshing…' : 'Refresh now'}
      </button>
    </div>
  );
}
