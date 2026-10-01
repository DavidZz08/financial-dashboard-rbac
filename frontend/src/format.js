const missing = (v) => v === null || v === undefined || Number.isNaN(v);

export function formatMoney(value, currency = 'usd') {
  if (missing(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: digits,
    minimumFractionDigits: Math.min(digits, 2),
  }).format(value);
}

export function formatCompact(value, currency = 'usd') {
  if (missing(value)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

export function formatPct(value, { signed = true } = {}) {
  if (missing(value)) return '—';
  return `${signed && value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
