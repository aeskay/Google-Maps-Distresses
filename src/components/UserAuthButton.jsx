/**
 * UserAuthButton.jsx
 * Displays user avatar/login status and cloud sync badge in topbar.
 */
import React from 'react';
import { signOutUser } from '../firebase/authService';

export default function UserAuthButton({
  user,
  cloudSyncStatus = 'offline', // 'synced' | 'saving' | 'offline' | 'error'
  onOpenAuthModal,
  addToast,
}) {
  async function handleSignOut() {
    try {
      await signOutUser();
      addToast('info', 'Signed out', 'Switched to local offline mode.');
    } catch (err) {
      addToast('error', 'Sign out error', err.message);
    }
  }

  const syncIndicator = {
    synced:  { color: '#10b981', label: 'Cloud Synced' },
    saving:  { color: '#f59e0b', label: 'Syncing…' },
    offline: { color: '#64748b', label: 'Offline / Local' },
    error:   { color: '#ef4444', label: 'Sync Error' },
  }[cloudSyncStatus] || { color: '#64748b', label: 'Offline' };

  if (!user) {
    return (
      <button
        className="btn btn--secondary btn--sm"
        onClick={onOpenAuthModal}
        title="Sign in to save projects to Cloud Firestore"
      >
        <span>👤</span> Sign In
      </button>
    );
  }

  const initial = (user.displayName || user.email || 'U')[0].toUpperCase();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--bg-elevated)',
          padding: '3px 8px',
          borderRadius: 'var(--radius-full)',
          fontSize: 11,
          border: '1px solid var(--border-default)',
        }}
        title={`Logged in as ${user.email} (${syncIndicator.label})`}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'var(--accent-primary)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 10,
          }}
        >
          {initial}
        </div>
        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
          {user.displayName || user.email}
        </span>
        <span style={{ fontSize: 8, color: syncIndicator.color }} title={syncIndicator.label}>
          ●
        </span>
      </div>

      <button
        className="btn btn--ghost btn--sm"
        onClick={handleSignOut}
        title="Sign out"
      >
        Sign Out
      </button>
    </div>
  );
}
