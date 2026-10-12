/**
 * Topbar.jsx
 * Application header with project title, quick actions, settings, and user cloud status.
 */
import React from 'react';
import UserAuthButton from './UserAuthButton';

export default function Topbar({
  selectedProject,
  saveStatus,
  cloudSyncStatus,
  currentUser,
  onNewProject,
  onOpenProjects,
  onSaveProject,
  onOpenAuth,
  addToast,
}) {
  return (
    <header className="topbar">
      <div className="topbar__logo">
        <div className="topbar__logo-icon">📍</div>
        <span className="topbar__title">Google Distress Locator</span>
        {selectedProject && (
          <span className="topbar__subtitle" title={selectedProject.name}>
            — {selectedProject.name}
          </span>
        )}
      </div>

      <nav className="topbar__actions" aria-label="Toolbar Actions">
        <button
          className="btn btn--primary btn--sm"
          onClick={onNewProject}
          title="Create a new inspection project"
        >
          + New Project
        </button>

        <button
          className="btn btn--ghost btn--sm"
          onClick={onOpenProjects}
          title="Open or switch inspection projects"
        >
          📁 Projects
        </button>

        <button
          className="btn btn--secondary btn--sm"
          onClick={onSaveProject}
          title="Save active project to Cloud Firestore"
        >
          💾 Save
        </button>

        {saveStatus === 'saving' && (
          <span className="topbar__save-status topbar__save-status--saving">
            ● Saving…
          </span>
        )}
        {saveStatus === 'saved' && (
          <span className="topbar__save-status topbar__save-status--saved">
            ✓ Saved
          </span>
        )}

        <div style={{ width: 1, height: 18, background: 'var(--border-default)', margin: '0 4px' }} />

        {/* User Auth & Cloud Sync */}
        <UserAuthButton
          user={currentUser}
          cloudSyncStatus={cloudSyncStatus}
          onOpenAuthModal={onOpenAuth}
          addToast={addToast}
        />
      </nav>
    </header>
  );
}
