import { formatCompact, formatMoney, formatPct } from './format.js';

// 24h "volatility" = size of the day's trading range relative to its low.
export function volatility24h(coin) {
  if (!coin.low24h || !coin.high24h) return null;
  return ((coin.high24h - coin.low24h) / coin.low24h) * 100;
}

// Each entry is one selectable column in the table. `tone` lets the UI colour +/- values.
export const METRICS = [
  { key: 'price', label: 'Price', value: (c) => c.price, format: (v, cur) => formatMoney(v, cur) },
  { key: 'change24h', label: '24h change', value: (c) => c.change24h, format: (v) => formatPct(v), tone: true },
  { key: 'volatility24h', label: '24h volatility', value: volatility24h, format: (v) => formatPct(v, { signed: false }) },
  { key: 'marketCap', label: 'Market cap', value: (c) => c.marketCap, format: (v, cur) => formatCompact(v, cur) },
  { key: 'volume24h', label: '24h volume', value: (c) => c.volume24h, format: (v, cur) => formatCompact(v, cur) },
];

export const DEFAULT_METRICS = ['price', 'change24h', 'marketCap'];
export const DEFAULT_ASSETS = ['bitcoin', 'ethereum', 'solana', 'ripple', 'cardano'];
export const CURRENCIES = ['usd', 'eur', 'gbp', 'jpy', 'cop', 'brl'];
export const RANGES = [
  { days: 1, label: '24h' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

export function toneClass(value) {
  if (value === null || value === undefined || value === 0) return '';
  return value > 0 ? 'up' : 'down';
}
