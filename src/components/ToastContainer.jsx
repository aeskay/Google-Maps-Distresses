/**
 * ToastContainer.jsx
 * Floating toast notification system.
 */
import React from 'react';

const TYPE_ICONS = {
  success: '✓',
  error:   '✕',
  info:    'ℹ',
  warning: '⚠',
};

const TYPE_COLORS = {
  success: '#10b981',
  error:   '#ef4444',
  info:    '#3b82f6',
  warning: '#f59e0b',
};

export default function ToastContainer({ toasts = [], onRemove }) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 9999,
        maxWidth: 360,
      }}
    >
      {toasts.map(t => (
        <div
          key={t.id}
          style={{
            background: 'var(--bg-surface)',
            border: `1px solid ${TYPE_COLORS[t.type] || 'var(--border-default)'}`,
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            animation: 'modalIn 0.2s ease',
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: TYPE_COLORS[t.type] || 'var(--accent-primary)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {TYPE_ICONS[t.type] || 'ℹ'}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
              {t.title}
            </div>
            {t.desc && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                {t.desc}
              </div>
            )}
          </div>

          <button
            className="btn btn--ghost btn--icon"
            style={{ padding: 2, fontSize: 10, color: 'var(--text-muted)' }}
            onClick={() => onRemove(t.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
