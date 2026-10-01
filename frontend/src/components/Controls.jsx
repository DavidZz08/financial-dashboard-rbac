import React, { useState } from 'react';
import { Card } from './ui.jsx';
import { CURRENCIES, METRICS } from '../metrics.js';

function toggle(list, key) {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

// User-configurable view: which metrics (columns), which assets, which currency and widgets.
export default function Controls({ prefs, setPrefs, assetOptions }) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const set = (patch) => setPrefs({ ...prefs, ...patch });
  const widgets = [
    ['summary', 'Market summary'],
    ['chart', 'Trend chart'],
    ['fx', 'FX rates'],
  ];
  const q = query.trim().toLowerCase();
  const visible = assetOptions.filter((a) => !q || a.name.toLowerCase().includes(q) || a.symbol.toLowerCase().includes(q));

  const toggleButton = (
    <button onClick={() => setOpen(!open)} aria-expanded={open}>
      {open ? 'Hide' : 'Show'}
    </button>
  );

  return (
    <Card title="Configure view" actions={toggleButton} className="controls">
      {!open ? (
        <p className="muted small">
          {prefs.metrics.length} metrics · {prefs.assets.length} assets · {prefs.currency.toUpperCase()}
        </p>
      ) : (
        <div className="controls-grid">
          <fieldset>
            <legend>Metrics</legend>
            {METRICS.map((m) => (
              <label key={m.key} className="check">
                <input type="checkbox" checked={prefs.metrics.includes(m.key)} onChange={() => set({ metrics: toggle(prefs.metrics, m.key) })} />
                {m.label}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Widgets</legend>
            {widgets.map(([key, label]) => (
              <label key={key} className="check">
                <input type="checkbox" checked={prefs.widgets[key]} onChange={() => set({ widgets: { ...prefs.widgets, [key]: !prefs.widgets[key] } })} />
                {label}
              </label>
            ))}
            <label className="inline-select">
              Currency
              <select value={prefs.currency} onChange={(e) => set({ currency: e.target.value })} aria-label="Display currency">
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset className="assets">
            <legend>Assets ({prefs.assets.length})</legend>
            <div className="asset-tools">
              <input type="search" placeholder="Search assets…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search assets" />
              <button onClick={() => set({ assets: [...new Set([...prefs.assets, ...visible.map((a) => a.id)])].slice(0, 25) })}>All</button>
              <button onClick={() => set({ assets: prefs.assets.filter((id) => !visible.some((a) => a.id === id)) })}>None</button>
            </div>
            <div className="asset-list">
              {visible.length === 0 && <p className="muted small">No match.</p>}
              {visible.map((a) => (
                <label key={a.id} className="check">
                  <input type="checkbox" checked={prefs.assets.includes(a.id)} onChange={() => set({ assets: toggle(prefs.assets, a.id) })} />
                  {a.name} <span className="muted">{a.symbol.toUpperCase()}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </Card>
  );
}
