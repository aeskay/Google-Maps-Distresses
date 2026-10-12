/**
 * ProjectList.jsx
 * Lists all projects in the sidebar with active selection, rename, and delete actions.
 */
import React, { useState } from 'react';

export default function ProjectList({
  projects = [],
  selectedProjectId,
  onSelect,
  onRename,
  onDelete,
}) {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  function handleStartRename(e, p) {
    e.stopPropagation();
    setEditingId(p.id);
    setEditName(p.name);
  }

  function handleSaveRename(e, id) {
    e.stopPropagation();
    if (editName.trim()) {
      onRename(id, editName.trim());
    }
    setEditingId(null);
  }

  return (
    <div className="sidebar__section">
      <div className="sidebar__section-title">
        <span>Projects ({projects.length})</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {projects.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
            No projects — click &ldquo;+ New Project&rdquo; above
          </div>
        ) : (
          projects.map(p => {
            const isSelected = p.id === selectedProjectId;
            const isEditing = editingId === p.id;
            const captureCount = (p.sections || []).reduce((acc, s) => acc + (s.captures?.length || 0), 0);

            if (isEditing) {
              return (
                <div key={p.id} style={{ display: 'flex', gap: 4, padding: '4px 8px' }}>
                  <input
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: 12 }}
                    value={editName}
                    autoFocus
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveRename(e, p.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <button className="btn btn--primary btn--sm" onClick={e => handleSaveRename(e, p.id)}>✓</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditingId(null)}>✕</button>
                </div>
              );
            }

            return (
              <div
                key={p.id}
                className={`project-list__item ${isSelected ? 'project-list__item--active' : ''}`}
                onClick={() => onSelect(p.id)}
              >
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  <span>{p.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>
                    ({captureCount} 📸)
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                  <button
                    className="btn btn--ghost btn--icon-sm"
                    title="Rename project"
                    onClick={e => handleStartRename(e, p)}
                  >
                    ✏️
                  </button>
                  <button
                    className="btn btn--ghost btn--icon-sm"
                    title="Delete project"
                    onClick={() => onDelete(p.id)}
                    style={{ color: '#dc2626' }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
