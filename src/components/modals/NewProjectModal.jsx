/**
 * NewProjectModal.jsx
 * Modal for creating a new distress project.
 */
import React, { useState } from 'react';

export default function NewProjectModal({ onAddProject, onCancel }) {
  const [name, setName] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onAddProject(name.trim());
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 420 }}>
        <form onSubmit={handleSubmit}>
          <div className="modal__header">
            <div className="modal__title">Create New Inspection Project</div>
            <button type="button" className="btn btn--ghost btn--icon" onClick={onCancel}>✕</button>
          </div>

          <div className="modal__body">
            <div className="form-group">
              <label className="form-label">Project Name</label>
              <input
                className="form-input"
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. IH-20 Eastbound Distress Survey"
                required
              />
            </div>
          </div>

          <div className="modal__footer">
            <button type="button" className="btn btn--secondary" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={!name.trim()}>
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
