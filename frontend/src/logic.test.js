import { describe, expect, it } from 'vitest';
import { can, PERM } from './permissions.js';
import { METRICS, toneClass, volatility24h } from './metrics.js';
import { formatCompact, formatMoney, formatPct } from './format.js';

const session = (permissions) => ({ permissions });

describe('can()', () => {
  it('reflects exactly the permission list the server returned', () => {
    const viewer = session(['market:read', 'watchlist:read']);
    const admin = session(['market:read', 'watchlist:write', 'thresholds:write', 'audit:read']);
    expect(can(viewer, PERM.WATCHLIST_WRITE)).toBe(false);
    expect(can(viewer, PERM.AUDIT_READ)).toBe(false);
    expect(can(admin, PERM.WATCHLIST_WRITE)).toBe(true);
    expect(can(admin, PERM.THRESHOLDS_WRITE)).toBe(true);
    expect(can(admin, PERM.AUDIT_READ)).toBe(true);
  });

  it('fails closed when there is no session or permissions are missing', () => {
    expect(can(null, PERM.AUDIT_READ)).toBe(false);
    expect(can(undefined, PERM.AUDIT_READ)).toBe(false);
    expect(can({}, PERM.AUDIT_READ)).toBe(false);
  });
});

describe('metrics', () => {
  const coin = { price: 100, change24h: -3.2, high24h: 110, low24h: 100, marketCap: 5e9, volume24h: 2e8 };

  it('computes 24h volatility as range over low', () => {
    expect(volatility24h(coin)).toBeCloseTo(10);
    expect(volatility24h({ high24h: null, low24h: 1 })).toBeNull();
    expect(volatility24h({ high24h: 5, low24h: 0 })).toBeNull(); // no divide by zero
  });

  it('every metric produces a printable value', () => {
    for (const m of METRICS) expect(typeof m.format(m.value(coin), 'usd')).toBe('string');
  });

  it('tone classes', () => {
    expect(toneClass(1)).toBe('up');
    expect(toneClass(-1)).toBe('down');
    expect(toneClass(0)).toBe('');
    expect(toneClass(null)).toBe('');
  });
});

describe('formatting', () => {
  it('formats money with sensible precision', () => {
    expect(formatMoney(67000.4, 'usd')).toBe('$67,000');
    expect(formatMoney(0.52, 'usd')).toBe('$0.52');
    expect(formatMoney(0.000123, 'usd')).toBe('$0.000123');
    expect(formatMoney(null)).toBe('—');
  });

  it('formats percentages and compact numbers', () => {
    expect(formatPct(1.234)).toBe('+1.23%');
    expect(formatPct(-1.234)).toBe('-1.23%');
    expect(formatPct(5, { signed: false })).toBe('5.00%');
    expect(formatCompact(1.32e12, 'usd')).toBe('$1.32T');
    expect(formatCompact(undefined)).toBe('—');
  });
});

import { timeAgo } from './format.js';

describe('timeAgo', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const ago = (s) => new Date(now - s * 1000).toISOString();
  it('uses compact relative units', () => {
    expect(timeAgo(ago(1), now)).toBe('just now');
    expect(timeAgo(ago(42), now)).toBe('42s ago');
    expect(timeAgo(ago(125), now)).toBe('2m ago');
    expect(timeAgo(ago(7300), now)).toBe('2h ago');
    expect(timeAgo(ago(90000), now)).toBe('1d ago');
  });
  it('never goes negative when the clock is slightly off', () => {
    expect(timeAgo(ago(-30), now)).toBe('just now');
  });
});
