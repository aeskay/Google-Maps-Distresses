/**
 * OpenProjectsModal.jsx
 * Modal to view, search, switch between, and manage existing projects.
 */
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';

export default function OpenProjectsModal({
  projects = [],
  selectedProjectId,
  onSelectProject,
  onDeleteProject,
  onNewProject,
  onClose,
}) {
  const [filterText, setFilterText] = useState('');

  const filteredProjects = useMemo(() => {
    const q = filterText.toLowerCase().trim();
    if (!q) return projects;
    return projects.filter(p => (p.name || '').toLowerCase().includes(q));
  }, [projects, filterText]);

  return createPortal(
    <div className="modal-overlay">
      <div className="modal modal--md">
        <div className="modal__header">
          <div className="modal__title">Inspection Projects ({projects.length})</div>
          <button className="btn btn--ghost btn--icon" onClick={onClose}>✕</button>
        </div>

        {/* Search input for 10+ or 100+ projects */}
        {projects.length > 3 && (
          <div style={{ padding: '8px 18px 0' }}>
            <input
              type="text"
              className="form-input"
              placeholder="🔍 Search projects…"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              style={{ width: '100%', fontSize: 12 }}
              autoFocus
            />
          </div>
        )}

        <div className="modal__body" style={{ maxHeight: 380, overflowY: 'auto' }}>
          {projects.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
              No projects created yet. Click below to create your first project.
            </div>
          ) : filteredProjects.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
              No projects matching &ldquo;{filterText}&rdquo;
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredProjects.map(p => {
                const isSelected = p.id === selectedProjectId;
                const sectionCount = p.sections?.length || 0;
                const totalCaptures = (p.sections || []).reduce((acc, s) => acc + (s.captures?.length || 0), 0);

                return (
                  <div
                    key={p.id}
                    className={`project-list__item ${isSelected ? 'project-list__item--active' : ''}`}
                    style={{ border: '1px solid var(--border-default)', padding: '10px 14px' }}
                    onClick={() => {
                      onSelectProject(p.id);
                      onClose();
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name} {isSelected && <span style={{ fontSize: 11, color: 'var(--accent-primary)', marginLeft: 6 }}>● Active</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {sectionCount} section(s) · {totalCaptures} capture(s)
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                      <button
                        className="btn btn--ghost btn--sm"
                        style={{ color: '#f87171' }}
                        onClick={() => onDeleteProject(p.id)}
                        title="Delete project"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal__footer" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn--primary btn--sm" onClick={() => { onClose(); onNewProject(); }}>
            + New Project
          </button>
          <button className="btn btn--secondary btn--sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
