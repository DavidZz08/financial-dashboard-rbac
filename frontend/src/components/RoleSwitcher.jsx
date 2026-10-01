import React from 'react';
import { ROLE_LABEL } from '../permissions.js';

// Testing aid required by the brief: swap the authenticated user in one click.
// Each change asks the API for a brand-new JWT; nothing about the role is decided client-side.
export default function RoleSwitcher({ session, busy, onSwitch }) {
  return (
    <div className="role-switcher">
      <label htmlFor="role-select">Session</label>
      <select id="role-select" value={session.user.role} disabled={busy} onChange={(e) => onSwitch(e.target.value)}>
        {Object.entries(ROLE_LABEL).map(([role, label]) => (
          <option key={role} value={role}>
            Log in as {label}
          </option>
        ))}
      </select>
      <span className={`badge role-${session.user.role}`}>{session.user.displayName}</span>
    </div>
  );
}
