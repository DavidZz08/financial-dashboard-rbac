import React, { useEffect, useMemo, useRef, useState } from 'react';
import { METRICS, toneClass } from '../metrics.js';
import { formatCompact, formatPct } from '../format.js';
import { Card, Skeleton, SourceBadge } from './ui.jsx';

export function SummaryCards({ summary, currency, loading }) {
  const d = summary?.data;
  if (!d) {
    return loading ? (
      <div className="summary">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stat">
            <Skeleton width="60%" height={12} />
            <Skeleton width="80%" height={24} />
          </div>
        ))}
      </div>
    ) : null;
  }
  const items = [
    ['Total market cap', formatCompact(d.totalMarketCap, currency)],
    ['24h volume', formatCompact(d.totalVolume24h, currency)],
    ['BTC dominance', formatPct(d.btcDominance, { signed: false })],
    ['24h market cap change', formatPct(d.marketCapChange24h), toneClass(d.marketCapChange24h)],
  ];
  return (
    <div className="summary">
      {items.map(([label, value, tone]) => (
        <div key={label} className="stat">
          <span className="stat-label">{label}</span>
          <span className={`stat-value ${tone ?? ''}`}>{value}</span>
        </div>
      ))}
      <SourceBadge meta={summary.meta} />
    </div>
  );
}

// Briefly returns 'up' / 'down' when `value` changes, so a tick is noticeable at a glance.
function useTick(value) {
  const prev = useRef(value);
  const [dir, setDir] = useState(null);
  useEffect(() => {
    if (prev.current === value) return undefined;
    const direction = value > prev.current ? 'up' : 'down';
    prev.current = value;
    setDir(direction);
    const timer = setTimeout(() => setDir(null), 1200);
    return () => clearTimeout(timer);
  }, [value]);
  return dir;
}

function MetricCell({ metric, coin, currency }) {
  const v = metric.value(coin);
  const tick = useTick(metric.key === 'price' ? v : undefined);
  return (
    <td className={`num ${metric.tone ? toneClass(v) : ''} ${tick ? `tick-${tick}` : ''}`}>{metric.format(v, currency)}</td>
  );
}

function compare(a, b, dir) {
  const missingA = a === null || a === undefined || Number.isNaN(a);
  const missingB = b === null || b === undefined || Number.isNaN(b);
  if (missingA || missingB) return missingA === missingB ? 0 : missingA ? 1 : -1; // empty values always last
  const result = typeof a === 'string' ? a.localeCompare(b) : a - b;
  return dir === 'asc' ? result : -result;
}

export default function PricesTable({ prices, assets, metrics, currency, threshold, onSelect, selectedId, loading }) {
  const [sort, setSort] = useState({ key: 'marketCap', dir: 'desc' });
  const columns = METRICS.filter((m) => metrics.includes(m.key));

  const rows = useMemo(() => {
    const list = (prices?.data ?? []).filter((c) => assets.includes(c.id));
    const metric = METRICS.find((m) => m.key === sort.key);
    const value = (c) => (sort.key === 'name' ? c.name : metric ? metric.value(c) : null);
    return [...list].sort((a, b) => compare(value(a), value(b), sort.dir));
  }, [prices, assets, sort]);

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  const ariaSort = (key) => (sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  const arrow = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  const header = (key, label, className) => (
    <th key={key} className={className} aria-sort={ariaSort(key)}>
      <button className="th-btn" onClick={() => toggleSort(key)}>
        {label}
        <span aria-hidden="true">{arrow(key)}</span>
      </button>
    </th>
  );

  let body;
  if (loading) {
    body = (
      <div className="skeleton-rows">
        {Array.from({ length: Math.max(3, assets.length) }, (_, i) => (
          <Skeleton key={i} height={34} style={{ marginBottom: 8 }} />
        ))}
      </div>
    );
  } else if (columns.length === 0 || rows.length === 0) {
    body = <p className="muted empty">Pick at least one metric and one asset in “Configure view” to see data here.</p>;
  } else {
    body = (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {header('name', 'Asset')}
              {columns.map((m) => header(m.key, m.label, 'num'))}
            </tr>
          </thead>
          <tbody>
            {rows.map((coin) => (
              <tr key={coin.id} className={`clickable ${selectedId === coin.id ? 'selected' : ''}`} onClick={() => onSelect?.(coin.id)}>
                <td>
                  <strong>{coin.name}</strong> <span className="muted">{coin.symbol.toUpperCase()}</span>
                  {coin.alert && (
                    <span className="badge alert" title={`|24h change| ≥ ${threshold}% (global threshold)`}>
                      ⚠ volatile
                    </span>
                  )}
                </td>
                {columns.map((m) => (
                  <MetricCell key={m.key} metric={m} coin={coin} currency={currency} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small hint">Click a column to sort · click a row to chart that asset.</p>
      </div>
    );
  }

  return (
    <Card title="Live market" actions={<SourceBadge meta={prices?.meta} />}>
      {body}
    </Card>
  );
}
