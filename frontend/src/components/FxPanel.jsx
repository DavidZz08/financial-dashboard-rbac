import React, { useState } from 'react';
import { Card, SourceBadge } from './ui.jsx';

// USD -> other currencies, with a small converter. Rates come from CoinGecko /exchange_rates.
export default function FxPanel({ fx }) {
  const [amount, setAmount] = useState(100);
  const rates = fx?.data ?? [];
  const safe = Number.isFinite(amount) && amount >= 0 ? amount : 0;

  return (
    <Card title="FX conversion (from USD)" actions={<SourceBadge meta={fx?.meta} />}>
      <label className="inline">
        Amount in USD
        <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.valueAsNumber)} />
      </label>
      <table>
        <thead>
          <tr>
            <th>Currency</th>
            <th className="num">1 USD =</th>
            <th className="num">{safe.toLocaleString()} USD =</th>
          </tr>
        </thead>
        <tbody>
          {rates
            .filter((r) => r.code !== 'usd')
            .map((r) => (
              <tr key={r.code}>
                <td>
                  <strong>{r.code.toUpperCase()}</strong> <span className="muted">{r.name}</span>
                </td>
                <td className="num">{r.perUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                <td className="num">{(safe * r.perUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </Card>
  );
}
