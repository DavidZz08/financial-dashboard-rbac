import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, configureAuth } from './api.js';
import { usePolled } from './usePolled.js';
import { can, PERM } from './permissions.js';
import { CURRENCIES, DEFAULT_ASSETS, DEFAULT_METRICS, METRICS } from './metrics.js';
import RoleSwitcher from './components/RoleSwitcher.jsx';
import Controls from './components/Controls.jsx';
import PricesTable, { SummaryCards } from './components/PricesTable.jsx';
import PriceChart from './components/PriceChart.jsx';
import FxPanel from './components/FxPanel.jsx';
import WatchlistPanel from './components/WatchlistPanel.jsx';
import ThresholdPanel from './components/ThresholdPanel.jsx';
import AuditLog from './components/AuditLog.jsx';
import ApiProbe from './components/ApiProbe.jsx';
import RefreshBar from './components/RefreshBar.jsx';
import RoleBanner from './components/RoleBanner.jsx';
import { Locked } from './components/ui.jsx';

const THEME_KEY = 'dashboard.theme';
const PREFS_KEY = 'dashboard.prefs.v1';
const ROLE_KEY = 'dashboard.role';
const DEFAULT_PREFS = {
  metrics: DEFAULT_METRICS,
  assets: DEFAULT_ASSETS,
  currency: 'usd',
  widgets: { summary: true, chart: true, fx: true },
};

// localStorage can throw (private mode, blocked storage): everything degrades to defaults.
function readStorage(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}
function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function loadPrefs() {
  const saved = readStorage(PREFS_KEY);
  if (!saved || typeof saved !== 'object') return DEFAULT_PREFS;
  const metricKeys = METRICS.map((m) => m.key);
  return {
    metrics: Array.isArray(saved.metrics) ? saved.metrics.filter((k) => metricKeys.includes(k)) : DEFAULT_PREFS.metrics,
    assets: Array.isArray(saved.assets) ? saved.assets.filter((id) => typeof id === 'string' && /^[a-z0-9-]{1,64}$/.test(id)).slice(0, 25) : DEFAULT_PREFS.assets,
    currency: CURRENCIES.includes(saved.currency) ? saved.currency : 'usd',
    widgets: { ...DEFAULT_PREFS.widgets, ...(saved.widgets ?? {}) },
  };
}

export default function App() {
  const [session, setSession] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [notice, setNotice] = useState(null);
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [chartAsset, setChartAsset] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [theme, setTheme] = useState(() => {
    const saved = readStorage(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const sessionRef = useRef(null);
  const relogin = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeStorage(THEME_KEY, theme);
  }, [theme]);

  const setPrefs = useCallback((next) => {
    setPrefsState(next);
    writeStorage(PREFS_KEY, next);
  }, []);

  const flash = useCallback((type, text) => {
    setNotice({ type, text, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // ---- auth ------------------------------------------------------------------------------------
  const login = useCallback(async (role) => {
    const res = await api.demoLogin(role);
    const next = { token: res.token, user: res.user, permissions: res.permissions };
    sessionRef.current = next; // update the ref first so in-flight/next requests use the new token
    setSession(next);
    writeStorage(ROLE_KEY, role);
    return next;
  }, []);

  useEffect(() => {
    configureAuth({
      token: () => sessionRef.current?.token,
      // Token expired or API restarted: log in again as the same role, once, shared by all callers.
      handleExpired: () => {
        const role = sessionRef.current?.user?.role;
        if (!role) return null;
        relogin.current ??= login(role)
          .then((s) => s.token)
          .finally(() => {
            relogin.current = null;
          });
        return relogin.current;
      },
    });
    const saved = readStorage(ROLE_KEY);
    // Initial sign-in on mount: setSession happens after the network round-trip, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    login(['viewer', 'trader', 'admin'].includes(saved) ? saved : 'viewer').catch(setBootError);
  }, [login]);

  const switchRole = async (role) => {
    setSwitching(true);
    try {
      await login(role);
      flash('info', `Now logged in as ${role}`);
    } catch (err) {
      flash('error', err.message);
    } finally {
      setSwitching(false);
    }
  };

  // ---- data ------------------------------------------------------------------------------------
  const role = session?.user.role;
  const ready = Boolean(session);
  const canWatch = can(session, PERM.WATCHLIST_WRITE);
  const canThreshold = can(session, PERM.THRESHOLDS_WRITE);
  const canAudit = can(session, PERM.AUDIT_READ);

  const options = usePolled(() => api.prices({ vs: 'usd' }), [role], 5 * 60_000, ready);
  const watchlist = usePolled(() => api.watchlist(), [role], 15_000, ready);
  const thresholds = usePolled(() => api.thresholds(), [role], 30_000, ready);
  const audit = usePolled(() => api.audit(), [role], 10_000, ready && canAudit);

  const watchItems = useMemo(() => watchlist.data?.data ?? [], [watchlist.data]);
  const ids = useMemo(() => [...new Set([...prefs.assets, ...watchItems.map((i) => i.id)])].sort(), [prefs.assets, watchItems]);
  const idsKey = ids.join(',');

  const prices = usePolled(() => api.prices({ ids, vs: prefs.currency }), [role, idsKey, prefs.currency], 30_000, ready && ids.length > 0);
  const summary = usePolled(() => api.summary(prefs.currency), [role, prefs.currency], 60_000, ready && prefs.widgets.summary);
  const fx = usePolled(() => api.fx(), [role], 5 * 60_000, ready && prefs.widgets.fx);

  const assetOptions = useMemo(() => {
    const known = new Map((options.data?.data ?? []).map((c) => [c.id, { id: c.id, name: c.name, symbol: c.symbol }]));
    for (const c of prices.data?.data ?? []) known.set(c.id, { id: c.id, name: c.name, symbol: c.symbol });
    for (const id of [...prefs.assets, ...watchItems.map((i) => i.id)]) if (!known.has(id)) known.set(id, { id, name: id, symbol: id.slice(0, 4) });
    return [...known.values()];
  }, [options.data, prices.data, prefs.assets, watchItems]);

  const chartChoices = assetOptions.filter((a) => prefs.assets.includes(a.id));
  const activeChartAsset = chartChoices.some((a) => a.id === chartAsset) ? chartAsset : chartChoices[0]?.id;

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([prices.reload(), watchlist.reload(), thresholds.reload(), prefs.widgets.summary && summary.reload(), prefs.widgets.fx && fx.reload(), canAudit && audit.reload()]);
    } finally {
      setRefreshing(false);
    }
  };

  const flagged = (prices.data?.data ?? []).filter((c) => prefs.assets.includes(c.id) && c.alert).length;

  // ---- actions (every one hits the API; a 403 simply surfaces as an error toast) ----------------
  const act = async (fn, okText) => {
    try {
      await fn();
      if (okText) flash('ok', okText);
    } catch (err) {
      flash('error', `${err.status ? `${err.status} ` : ''}${err.message}`);
    } finally {
      watchlist.reload();
      audit.reload();
    }
  };

  const onAdd = (id) => act(() => api.addWatch({ id }), `Added ${id} to watchlist`);
  const onEdit = (id, patch) => act(() => api.editWatch(id, patch), `Updated ${id}`);
  const onRemove = (id) => act(() => api.removeWatch(id), `Removed ${id}`);
  const onSaveThreshold = (value) =>
    act(async () => {
      await api.setThreshold(value);
      thresholds.reload();
      prices.reload();
    }, `Threshold set to ${value}%`);

  // ---- render ----------------------------------------------------------------------------------
  if (bootError) {
    return (
      <main className="boot">
        <h1>Cannot reach the API</h1>
        <p className="muted">{bootError.message}. Is the backend running?</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </main>
    );
  }
  if (!session) return <main className="boot">Signing in…</main>;

  const threshold = thresholds.data?.data?.volatilityAlertPct;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Market Dashboard</h1>
          <p className="muted">Crypto metrics · role-based access control</p>
        </div>
        <div className="topbar-right">
          <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <RoleSwitcher session={session} busy={switching} onSwitch={switchRole} />
        </div>
      </header>

      <RoleBanner session={session} />
      <RefreshBar updatedAt={prices.data?.meta?.fetchedAt} refreshing={refreshing} onRefresh={refreshAll} />

      <div className={`toast ${notice?.type ?? ''}`} role="status" aria-live="polite" hidden={!notice} onClick={() => setNotice(null)}>
        {notice?.text}
      </div>

      <main className="grid">
        <div className="col-wide">
          <Controls prefs={prefs} setPrefs={setPrefs} assetOptions={assetOptions} />
          {prefs.widgets.summary && <SummaryCards summary={summary.data} currency={prefs.currency} loading={summary.loading} />}
          <PricesTable prices={prices.data} loading={prices.loading && !prices.data} assets={prefs.assets} metrics={prefs.metrics} currency={prefs.currency} threshold={threshold} selectedId={activeChartAsset} onSelect={setChartAsset} />
          {prefs.widgets.chart && <PriceChart assetId={activeChartAsset} assetOptions={chartChoices} onAssetChange={setChartAsset} currency={prefs.currency} theme={theme} />}
          {prefs.widgets.fx && <FxPanel fx={fx.data} />}
        </div>

        <div className="col-side">
          <WatchlistPanel items={watchItems} prices={prices.data?.data} canWrite={canWatch} assetOptions={assetOptions} currency={prefs.currency} onAdd={onAdd} onEdit={onEdit} onRemove={onRemove} />
          <ThresholdPanel value={threshold} canWrite={canThreshold} onSave={onSaveThreshold} flagged={prices.data ? flagged : undefined} />
          {canAudit ? <AuditLog entries={audit.data?.data ?? []} error={audit.error} onRefresh={audit.reload} /> : <Locked title="Audit & activity log" role="Admin" />}
          <ApiProbe role={role} />
        </div>
      </main>
    </div>
  );
}
