import React from 'react';
import { can, PERM, ROLE_LABEL } from '../permissions.js';

const CAPABILITIES = [
  { label: 'View market data', allowed: () => true },
  { label: 'Edit watchlist', permission: PERM.WATCHLIST_WRITE },
  { label: 'Change alert threshold', permission: PERM.THRESHOLDS_WRITE },
  { label: 'View audit log', permission: PERM.AUDIT_READ },
];

// Tells the user, in plain words, what the current role can and cannot do.
export default function RoleBanner({ session }) {
  const items = CAPABILITIES.map((c) => ({ ...c, ok: c.permission ? can(session, c.permission) : true }));
  const blocked = items.filter((i) => !i.ok).length;
  return (
    <div className={`role-banner role-${session.user.role}`}>
      <strong>{ROLE_LABEL[session.user.role]} access</strong>
      <span className="muted">{blocked === 0 ? 'Full access.' : `${blocked} action${blocked > 1 ? 's' : ''} locked — switch role to unlock.`}</span>
      <ul>
        {items.map((i) => (
          <li key={i.label} className={i.ok ? 'ok' : 'no'}>
            <span aria-hidden="true">{i.ok ? '✓' : '🔒'}</span> {i.label}
            <span className="sr-only">{i.ok ? ' (allowed)' : ' (not allowed)'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
