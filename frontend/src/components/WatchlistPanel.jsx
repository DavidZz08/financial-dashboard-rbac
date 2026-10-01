import React, { useEffect, useState } from 'react';
import { Card } from './ui.jsx';
import { formatMoney } from '../format.js';
import { PERM, REQUIRED_ROLE } from '../permissions.js';

function Item({ item, coin, canWrite, currency, onEdit, onRemove }) {
  const [note, setNote] = useState(item.note);
  const [target, setTarget] = useState(item.targetPrice ?? '');
  const lockedHint = canWrite ? undefined : `Requires ${REQUIRED_ROLE[PERM.WATCHLIST_WRITE]} role`;

  // Two-step delete: first click arms it, second confirms; it disarms itself after 4s.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return undefined;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const saveNote = () => note !== item.note && onEdit(item.id, { note });
  const saveTarget = () => {
    const value = target === '' ? null : Number(target);
    if (value !== item.targetPrice) onEdit(item.id, { targetPrice: value });
  };

  return (
    <li className="watch-item">
      <div className="watch-head">
        <div>
          <strong>{coin?.name ?? item.id}</strong> <span className="muted">{coin?.symbol?.toUpperCase()}</span>
          {coin?.alert && <span className="badge alert">⚠ volatile</span>}
          <div className="muted small">added by {item.addedBy}</div>
        </div>
        <div className="watch-price">{coin ? formatMoney(coin.price, currency) : '—'}</div>
      </div>
      <div className="watch-fields">
        <input type="number" min="0" step="any" placeholder="Target price" value={target} disabled={!canWrite} title={lockedHint} onChange={(e) => setTarget(e.target.value)} onBlur={saveTarget} aria-label={`Target price for ${item.id}`} />
        <input type="text" maxLength={200} placeholder="Note" value={note} disabled={!canWrite} title={lockedHint} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label={`Note for ${item.id}`} />
        {confirming ? (
          <span className="confirm">
            <button className="danger solid" onClick={() => onRemove(item.id)}>
              Confirm
            </button>
            <button onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        ) : (
          <button className="danger" disabled={!canWrite} title={lockedHint} onClick={() => setConfirming(true)} aria-label={`Remove ${item.id}`}>
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

export default function WatchlistPanel({ items, prices, canWrite, assetOptions, currency, onAdd, onEdit, onRemove }) {
  const [candidate, setCandidate] = useState('');
  const byId = new Map((prices ?? []).map((c) => [c.id, c]));
  const available = assetOptions.filter((a) => !items.some((i) => i.id === a.id));
  const lockedHint = canWrite ? undefined : `Requires ${REQUIRED_ROLE[PERM.WATCHLIST_WRITE]} role`;

  const submit = (e) => {
    e.preventDefault();
    if (!candidate) return;
    onAdd(candidate);
    setCandidate('');
  };

  return (
    <Card title={`Watchlist (${items.length})`} actions={!canWrite && <span className="badge readonly">Read-only</span>}>
      <form className="add-form" onSubmit={submit}>
        <select value={candidate} disabled={!canWrite} title={lockedHint} onChange={(e) => setCandidate(e.target.value)} aria-label="Asset to add">
          <option value="">Add asset…</option>
          {available.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.symbol.toUpperCase()})
            </option>
          ))}
        </select>
        <button type="submit" disabled={!canWrite || !candidate} title={lockedHint}>
          Add
        </button>
      </form>
      {items.length === 0 ? (
        <p className="muted empty">The watchlist is empty. {canWrite ? 'Pick an asset above to start tracking it.' : 'A Trader or Admin can add assets.'}</p>
      ) : (
        <ul className="watch-list">
          {items.map((item) => (
            <Item key={item.id} item={item} coin={byId.get(item.id)} canWrite={canWrite} currency={currency} onEdit={onEdit} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </Card>
  );
}
