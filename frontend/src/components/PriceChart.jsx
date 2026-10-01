import React, { useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { api } from '../api.js';
import { usePolled } from '../usePolled.js';
import { RANGES } from '../metrics.js';
import { formatMoney } from '../format.js';
import { Card, ErrorLine, Skeleton, SourceBadge } from './ui.jsx';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

function label(ts, days) {
  const d = new Date(ts);
  return days <= 1 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function PriceChart({ assetId, assetOptions, onAssetChange, currency, theme = 'dark' }) {
  const [days, setDays] = useState(7);
  const { data, error, loading } = usePolled(() => api.history({ id: assetId, vs: currency, days }), [assetId, currency, days], 60_000, Boolean(assetId));

  const chartData = useMemo(() => {
    const points = data?.data ?? [];
    const rising = points.length > 1 && points.at(-1).price >= points[0].price;
    const color = rising ? '#2fbf71' : '#ef5350';
    return {
      labels: points.map((p) => label(p.t, days)),
      datasets: [
        {
          label: `${assetId} (${currency.toUpperCase()})`,
          data: points.map((p) => p.price),
          borderColor: color,
          backgroundColor: `${color}22`,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
          tension: 0.25,
        },
      ],
    };
  }, [data, days, assetId, currency]);

  const options = useMemo(() => {
    const tick = theme === 'light' ? '#5f6b7d' : '#8a94a6';
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => formatMoney(ctx.parsed.y, currency) } } },
      scales: {
        x: { ticks: { maxTicksLimit: 8, color: tick }, grid: { display: false } },
        y: { ticks: { color: tick, callback: (v) => formatMoney(v, currency) }, grid: { color: theme === 'light' ? '#0000001a' : '#ffffff12' } },
      },
    };
  }, [currency, theme]);

  return (
    <Card
      title="Price trend"
      actions={
        <>
          <select value={assetId ?? ''} onChange={(e) => onAssetChange(e.target.value)} aria-label="Chart asset">
            {assetOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div className="seg" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r.days} className={days === r.days ? 'on' : ''} onClick={() => setDays(r.days)}>
                {r.label}
              </button>
            ))}
          </div>
          <SourceBadge meta={data?.meta} />
        </>
      }
    >
      <div className="chart-box">
        {assetId ? <Line data={chartData} options={options} /> : <p className="muted">Select an asset.</p>}
        {loading && !data && (
          <div className="overlay">
            <Skeleton height="100%" />
          </div>
        )}
      </div>
      <ErrorLine error={error} />
    </Card>
  );
}
