import React, { useState } from 'react';
import { Card } from './ui.jsx';
import { PERM, REQUIRED_ROLE } from '../permissions.js';

// Global volatility alert trigger. Everybody sees the value; only Admin can change it.
export default function ThresholdPanel({ value, canWrite, onSave, flagged }) {
  // `edited` holds what the admin is typing; null means "show the server's current value".
  const [edited, setEdited] = useState(null);
  const draft = edited ?? value ?? 5;
  const setDraft = setEdited;

  const valid = Number.isFinite(draft) && draft >= 0.1 && draft <= 100;
  const hint = canWrite ? undefined : `Requires ${REQUIRED_ROLE[PERM.THRESHOLDS_WRITE]} role`;

  return (
    <Card title="Volatility alert threshold" actions={!canWrite && <span className="badge readonly">Read-only</span>}>
      <p className="muted">Assets whose absolute 24h change reaches this level are flagged as “volatile” for every user.</p>
      {flagged !== undefined && (
        <p className={flagged > 0 ? 'flagged' : 'muted'}>
          {flagged > 0 ? `⚠ ${flagged} of your assets ${flagged === 1 ? 'is' : 'are'} flagged right now.` : 'No asset is above the threshold right now.'}
        </p>
      )}
      <div className="threshold">
        <input type="range" min="0.5" max="20" step="0.5" value={Number.isFinite(draft) ? draft : 5} disabled={!canWrite} title={hint} onChange={(e) => setDraft(e.target.valueAsNumber)} aria-label="Threshold slider" />
        <input type="number" min="0.1" max="100" step="0.1" value={Number.isFinite(draft) ? draft : ''} disabled={!canWrite} title={hint} onChange={(e) => setDraft(e.target.valueAsNumber)} aria-label="Threshold percent" />
        <span>%</span>
        <button disabled={!canWrite || !valid || draft === value} title={hint} onClick={() => onSave(draft)}>
          Apply
        </button>
      </div>
    </Card>
  );
}
