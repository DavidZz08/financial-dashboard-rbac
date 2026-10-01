// Offline fallback used when CoinGecko is rate-limiting or unreachable and nothing is cached.
const SUPPORTED_VS = ['usd', 'eur', 'gbp', 'jpy', 'cop', 'brl'];

// Approximate "units of currency per 1 USD".
const MOCK_PER_USD = { usd: 1, eur: 0.92, gbp: 0.79, jpy: 150, cop: 4000, brl: 5.2 };
const FIAT_NAMES = { usd: 'US Dollar', eur: 'Euro', gbp: 'British Pound', jpy: 'Japanese Yen', cop: 'Colombian Peso', brl: 'Brazilian Real' };

const COINS = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', price: 67000, cap: 1.32e12, vol: 28e9, chg: 1.8, range: 0.035 },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', price: 3500, cap: 4.2e11, vol: 14e9, chg: -0.9, range: 0.04 },
  { id: 'tether', symbol: 'usdt', name: 'Tether', price: 1, cap: 1.1e11, vol: 40e9, chg: 0.01, range: 0.002 },
  { id: 'binancecoin', symbol: 'bnb', name: 'BNB', price: 590, cap: 8.7e10, vol: 1.5e9, chg: 0.6, range: 0.03 },
  { id: 'solana', symbol: 'sol', name: 'Solana', price: 160, cap: 7.4e10, vol: 3e9, chg: 4.2, range: 0.07 },
  { id: 'ripple', symbol: 'xrp', name: 'XRP', price: 0.52, cap: 2.9e10, vol: 1.2e9, chg: -2.1, range: 0.05 },
  { id: 'usd-coin', symbol: 'usdc', name: 'USDC', price: 1, cap: 3.3e10, vol: 6e9, chg: 0, range: 0.001 },
  { id: 'cardano', symbol: 'ada', name: 'Cardano', price: 0.45, cap: 1.6e10, vol: 4.5e8, chg: -6.3, range: 0.09 },
  { id: 'dogecoin', symbol: 'doge', name: 'Dogecoin', price: 0.15, cap: 2.2e10, vol: 1.1e9, chg: 7.4, range: 0.11 },
  { id: 'avalanche-2', symbol: 'avax', name: 'Avalanche', price: 35, cap: 1.4e10, vol: 5e8, chg: 2.2, range: 0.06 },
  { id: 'chainlink', symbol: 'link', name: 'Chainlink', price: 14.5, cap: 8.5e9, vol: 3.5e8, chg: -1.4, range: 0.05 },
  { id: 'polkadot', symbol: 'dot', name: 'Polkadot', price: 6.8, cap: 9.5e9, vol: 2.2e8, chg: 0.3, range: 0.045 },
];

function perUsd(vs) {
  return MOCK_PER_USD[vs] ?? 1;
}

function mockMarkets({ vs = 'usd', ids, random = Math.random } = {}) {
  const rate = perUsd(vs);
  const list = ids?.length ? COINS.filter((c) => ids.includes(c.id)) : COINS;
  return list.map((c) => {
    const jitter = 1 + (random() - 0.5) * 0.004; // tiny movement so the demo "ticks"
    const price = c.price * rate * jitter;
    return {
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      image: null,
      rank: COINS.indexOf(c) + 1,
      price,
      marketCap: c.cap * rate,
      volume24h: c.vol * rate,
      change24h: c.chg,
      high24h: price * (1 + c.range / 2),
      low24h: price * (1 - c.range / 2),
    };
  });
}

function mockGlobal({ vs = 'usd' } = {}) {
  const rate = perUsd(vs);
  const total = COINS.reduce((s, c) => s + c.cap, 0) * 1.15;
  return {
    totalMarketCap: total * rate,
    totalVolume24h: COINS.reduce((s, c) => s + c.vol, 0) * rate,
    btcDominance: (COINS[0].cap / total) * 100,
    marketCapChange24h: 0.9,
    activeCryptos: 14000,
  };
}

function mockRates() {
  return SUPPORTED_VS.map((code) => ({ code, name: FIAT_NAMES[code], perUsd: MOCK_PER_USD[code] }));
}

// Deterministic PRNG so the same coin/range always yields the same fake curve.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POINTS_BY_DAYS = { 1: 96, 7: 168, 30: 120, 90: 90 };

function mockHistory({ id, vs = 'usd', days = 7, now = Date.now() }) {
  const coin = COINS.find((c) => c.id === id);
  if (!coin) return null;
  const n = POINTS_BY_DAYS[days] ?? 120;
  const stepMs = (days * 86_400_000) / n;
  const seed = [...`${id}:${days}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);
  const rnd = mulberry32(seed);
  // Walk backwards from the current price so the curve ends where the table says it is.
  const points = [];
  let p = coin.price * perUsd(vs);
  for (let i = 0; i < n; i++) {
    points.push({ t: now - i * stepMs, price: p });
    p *= 1 + (rnd() - 0.5) * coin.range * 0.35;
  }
  return points.reverse();
}

module.exports = { SUPPORTED_VS, FIAT_NAMES, COINS, mockMarkets, mockGlobal, mockRates, mockHistory };
