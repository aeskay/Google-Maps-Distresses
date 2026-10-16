/**
 * Sidebar.jsx
 * Left sidebar container for PMIS Database file loading, Project management, and Section list.
 */
import React, { useRef } from 'react';
import SectionList from './SectionList';

export default function Sidebar({
  pmisFileName,
  pmisLoading,
  pmisProgress,
  onLoadPmis,
  projects = [],
  selectedProjectId,
  selectedProject,
  onOpenProjects,
  onNewProject,
  onSelectProject,
  onRenameProject,
  onDeleteProject,
  sections = [],
  selectedSectionId,
  onSelectSection,
  onAddSections,
  onUpdateSection,
  onBatchUpdateSections,
  onDeleteSection,
  addToast,
}) {
  const pmisInputRef = useRef(null);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) onLoadPmis(file);
    e.target.value = '';
  }

  const activeProj = selectedProject || projects.find(p => p.id === selectedProjectId) || null;
  const totalCaptures = sections.reduce((acc, s) => acc + (s.captures?.length || 0), 0);

  return (
    <aside className="sidebar" aria-label="Project Sidebar">
      {/* Hidden PMIS File Input */}
      <input
        ref={pmisInputRef}
        type="file"
        accept=".csv,text/csv,.xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* PMIS Database Card */}
      <div className="sidebar__section">
        <div className="sidebar__section-title">
          <span>Local PMIS Database</span>
        </div>

        {pmisLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span className="spinner" style={{ width: 14, height: 14 }} />
              Parsing PMIS… {pmisProgress}%
            </div>
            <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${pmisProgress}%`,
                  background: 'linear-gradient(90deg, var(--accent-primary), #8b5cf6)',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Parsing local PMIS database into browser storage…
            </div>
          </div>
        ) : pmisFileName ? (
          <div>
            <div className="sidebar__pmis-path" title={pmisFileName}>
              {pmisFileName}
            </div>
            <div style={{ fontSize: 11, color: '#10b981', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>●</span> Saved offline in IndexedDB
            </div>
            <button
              className="btn btn--secondary btn--sm"
              style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
              onClick={() => pmisInputRef.current?.click()}
            >
              Change Database…
            </button>
          </div>
        ) : (
          <div>
            <div className="sidebar__pmis-empty">No PMIS database loaded</div>
            <button
              className="btn btn--primary btn--sm"
              style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
              onClick={() => pmisInputRef.current?.click()}
            >
              📁 Load PMIS File (.csv / .xlsx)…
            </button>
          </div>
        )}
      </div>

      {/* Active Project Card */}
      <div className="sidebar__section">
        <div className="sidebar__section-title">
          <span>Active Project</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {onOpenProjects && (
              <button
                className="btn btn--secondary btn--xs"
                onClick={onOpenProjects}
                title="Switch or browse projects"
              >
                📁 Projects ({projects.length})
              </button>
            )}
          </div>
        </div>

        {activeProj ? (
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 13,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={activeProj.name}
            >
              <span style={{ color: 'var(--accent-primary)', fontSize: 13 }}>📁</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeProj.name}</span>
            </div>

            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                marginTop: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{sections.length} section{sections.length === 1 ? '' : 's'}</span>
              <span>•</span>
              <span>
                {totalCaptures} capture{totalCaptures === 1 ? '' : 's'}
              </span>
            </div>

            {onOpenProjects && (
              <button
                className="btn btn--secondary btn--sm"
                style={{ marginTop: 8, width: '100%', justifyContent: 'center', fontSize: 11 }}
                onClick={onOpenProjects}
              >
                Switch Project…
              </button>
            )}
          </div>
        ) : (
          <div>
            <div className="sidebar__pmis-empty" style={{ marginBottom: 8 }}>
              No project loaded
            </div>
            {onOpenProjects && (
              <button
                className="btn btn--primary btn--sm"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={onOpenProjects}
              >
                📁 Open Projects…
              </button>
            )}
          </div>
        )}
      </div>

      {/* Sections List for selected project */}
      {selectedProjectId && (
        <SectionList
          sections={sections}
          selectedSectionId={selectedSectionId}
          onSelect={onSelectSection}
          onAddSections={onAddSections}
          onUpdateSection={onUpdateSection}
          onBatchUpdateSections={onBatchUpdateSections}
          onDelete={onDeleteSection}
          addToast={addToast}
        />
      )}
    </aside>
  );
}
