import React, { useState } from 'react';
import { Card, ErrorLine } from './ui.jsx';
import { timeAgo } from '../format.js';

const FILTERS = [
  ['all', 'All', () => true],
  ['actions', 'Actions', (e) => e.outcome === 'success'],
  ['denied', 'Denied / failed', (e) => e.outcome !== 'success'],
];

export default function AuditLog({ entries, error, onRefresh }) {
  const [filter, setFilter] = useState('all');
  const predicate = FILTERS.find(([key]) => key === filter)[2];
  const shown = entries.filter(predicate);

  return (
    <Card title="Audit & activity log" actions={<button onClick={onRefresh}>Refresh</button>} className="audit">
      <div className="seg" role="group" aria-label="Filter log">
        {FILTERS.map(([key, label, fn]) => (
          <button key={key} className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
            {label} <span className="count">{entries.filter(fn).length}</span>
          </button>
        ))}
      </div>
      <ErrorLine error={error} />
      {shown.length === 0 ? (
        <p className="muted empty">Nothing to show for this filter.</p>
      ) : (
        <ol className="audit-list">
          {shown.map((e) => (
            <li key={e.id} className={`audit-item ${e.outcome}`}>
              <time dateTime={e.ts} title={new Date(e.ts).toLocaleString()}>
                {timeAgo(e.ts)}
              </time>
              <span className={`badge role-${e.role}`}>{e.role}</span>
              <span className="audit-actor">{e.actor}</span>
              <code>{e.action}</code>
              <span className="audit-details">{e.details}</span>
              {e.outcome !== 'success' && <span className="badge alert">{e.outcome}</span>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
