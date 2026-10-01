// CoinGecko client with graceful degradation:
//   fresh cache -> (cooldown?) -> live request w/ exponential backoff -> stale cache -> mock data
const mock = require('./mockData');

class NotFoundError extends Error {}
class UpstreamError extends Error {
  constructor(status, retryAfterMs) {
    super(`CoinGecko responded ${status}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const MAX_CACHE_ENTRIES = 200;

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function createMarketService(options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    baseUrl = 'https://api.coingecko.com/api/v3',
    apiKey,
    ttlMs = 30_000, // fresh window: protects the free tier (~10-30 calls/min)
    maxRetries = 3,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    cooldownMs = 60_000, // after exhausting retries on a 429, stop calling upstream for a while
    timeoutMs = 8_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    random = Math.random,
  } = options;

  const cache = new Map(); // url -> { data, at }
  const inflight = new Map(); // url -> Promise  (request coalescing)
  let cooldownUntil = 0;

  const backoff = (attempt) => Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) + random() * baseDelayMs;

  async function fetchJson(url) {
    const headers = { accept: 'application/json' };
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let waitMs;
      try {
        const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) return await res.json();
        if (res.status === 404) throw new NotFoundError('Not found upstream');
        if (res.status !== 429 && res.status < 500) throw new UpstreamError(res.status); // other 4xx: retrying won't help
        const retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
        lastError = new UpstreamError(res.status, retryAfterMs);
        // Server asked for a longer pause than we are willing to hold a request: give up now.
        if (retryAfterMs !== undefined && retryAfterMs > maxDelayMs) break;
        waitMs = retryAfterMs ?? backoff(attempt);
      } catch (err) {
        if (err instanceof NotFoundError || (err instanceof UpstreamError && err.status !== 429 && err.status < 500)) throw err;
        lastError = err; // network error / timeout -> retry
        waitMs = backoff(attempt);
      }
      if (attempt < maxRetries) await sleep(waitMs);
    }

    if (lastError instanceof UpstreamError && lastError.status === 429) {
      cooldownUntil = now() + (lastError.retryAfterMs ?? cooldownMs);
    }
    throw lastError;
  }

  function remember(url, data) {
    cache.delete(url);
    cache.set(url, { data, at: now() });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  }

  function degrade(hit, fallback, reason) {
    if (hit) return { data: hit.data, meta: { source: 'stale', fetchedAt: hit.at, reason } };
    const data = fallback();
    if (data === null || data === undefined) throw new NotFoundError('Unknown asset');
    return { data, meta: { source: 'mock', fetchedAt: now(), reason } };
  }

  async function cached(path, params, normalize, fallback) {
    const qs = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
    const url = `${baseUrl}${path}${qs ? `?${qs}` : ''}`;
    const hit = cache.get(url);
    const t = now();

    if (hit && t - hit.at < ttlMs) return { data: hit.data, meta: { source: 'cache', fetchedAt: hit.at } };
    if (t < cooldownUntil) return degrade(hit, fallback, 'rate-limited');

    let pending = inflight.get(url);
    if (!pending) {
      pending = fetchJson(url)
        .then((raw) => {
          const data = normalize(raw);
          remember(url, data);
          return { data, meta: { source: 'live', fetchedAt: now() } };
        })
        .finally(() => inflight.delete(url));
      inflight.set(url, pending);
    }

    try {
      return await pending;
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      const reason = err instanceof UpstreamError && err.status === 429 ? 'rate-limited' : 'upstream-unavailable';
      return degrade(hit, fallback, reason);
    }
  }

  // ---- public API -----------------------------------------------------------------------------
  const normalizeCoin = (c) => ({
    id: c.id,
    symbol: c.symbol,
    name: c.name,
    image: c.image ?? null,
    rank: c.market_cap_rank ?? null,
    price: c.current_price,
    marketCap: c.market_cap,
    volume24h: c.total_volume,
    change24h: c.price_change_percentage_24h,
    high24h: c.high_24h,
    low24h: c.low_24h,
  });

  function getMarkets({ vs = 'usd', ids } = {}) {
    const params = { vs_currency: vs, order: 'market_cap_desc', per_page: ids?.length ? String(ids.length) : '20', page: '1', sparkline: 'false' };
    if (ids?.length) params.ids = [...ids].sort().join(',');
    return cached('/coins/markets', params, (raw) => raw.map(normalizeCoin), () => mock.mockMarkets({ vs, ids, random }));
  }

  function getGlobal({ vs = 'usd' } = {}) {
    return cached(
      '/global',
      {},
      (raw) => ({
        totalMarketCap: raw.data.total_market_cap[vs],
        totalVolume24h: raw.data.total_volume[vs],
        btcDominance: raw.data.market_cap_percentage.btc,
        marketCapChange24h: raw.data.market_cap_change_percentage_24h_usd,
        activeCryptos: raw.data.active_cryptocurrencies,
      }),
      () => mock.mockGlobal({ vs }),
    );
  }

  // CoinGecko quotes every rate against BTC, so USD->X is rate[x] / rate[usd].
  function getFxRates() {
    return cached(
      '/exchange_rates',
      {},
      (raw) => {
        const usd = raw.rates.usd.value;
        return mock.SUPPORTED_VS.filter((code) => raw.rates[code]).map((code) => ({
          code,
          name: raw.rates[code].name,
          perUsd: raw.rates[code].value / usd,
        }));
      },
      () => mock.mockRates(),
    );
  }

  function getHistory({ id, vs = 'usd', days = 7 }) {
    return cached(
      `/coins/${encodeURIComponent(id)}/market_chart`,
      { vs_currency: vs, days: String(days) },
      (raw) => {
        const step = Math.max(1, Math.ceil(raw.prices.length / 200)); // keep payloads small
        return raw.prices.filter((_, i) => i % step === 0 || i === raw.prices.length - 1).map(([t, price]) => ({ t, price }));
      },
      () => mock.mockHistory({ id, vs, days, now: now() }),
    );
  }

  return { getMarkets, getGlobal, getFxRates, getHistory };
}

module.exports = { createMarketService, NotFoundError, UpstreamError };
