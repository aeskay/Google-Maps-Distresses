/**
 * CaptureDetailModal.jsx
 * High-resolution distress snapshot inspector and editor.
 */
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getDistressSuggestionsForSection,
  saveSectionRecentDistressType,
  saveCustomDistressType,
} from '../../utils/distressPresets';
import { calculateReferenceMarkerAtOffset } from '../../utils/txdotGisApi';

export default function CaptureDetailModal({
  capture,
  section,
  onUpdateCapture,
  onDeleteCapture,
  onClose,
  onViewInMap,
}) {
  const [distressType, setDistressType] = useState(capture?.distressType || '');
  const [imageYear, setImageYear] = useState(capture?.imageYear || (capture?.imageDate ? capture.imageDate.slice(0, 4) : ''));
  const [imageDate, setImageDate] = useState(capture?.imageDate || '');
  const [notes, setNotes] = useState(capture?.notes || '');
  const suggestions = getDistressSuggestionsForSection(
    section?.id,
    section?.captures || [],
    distressType
  );

  const refMarkerInfo = capture?.refMarkerDisplay
    ? { refMarkerDisplay: capture.refMarkerDisplay, refMarker: capture.refMarker }
    : calculateReferenceMarkerAtOffset(section, capture?.distanceFromStartMiles);

  if (!capture) return null;

  function handleSave() {
    const trimmedType = distressType.trim() || 'Unspecified Distress';
    if (section?.id) {
      saveSectionRecentDistressType(section.id, trimmedType);
    } else {
      saveCustomDistressType(trimmedType);
    }
    onUpdateCapture({
      ...capture,
      distressType: trimmedType,
      imageYear: imageYear.trim(),
      imageDate: imageDate.trim(),
      notes: notes.trim(),
    });
    onClose();
  }

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${capture.lat},${capture.lon}`;
  const streetViewWebUrl = capture.panoId
    ? `https://www.google.com/maps/@?api=1&map_action=pano&pano=${capture.panoId}&heading=${capture.heading || 0}&pitch=${capture.pitch || 0}`
    : `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${capture.lat},${capture.lon}&heading=${capture.heading || 0}&pitch=${capture.pitch || 0}`;

  return createPortal(
    <div className="modal-overlay">
      <div className="modal modal--xl">
        <div className="modal__header">
          <div className="modal__title">
            Distress Capture Inspector — <span style={{ color: 'var(--accent-primary)' }}>{distressType}</span>
          </div>
          <button className="btn btn--ghost btn--icon" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
          {/* Snapshot image preview */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{
              background: '#000',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              border: '1px solid var(--border-default)',
              minHeight: 340,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {capture.imageUrl ? (
                <img
                  src={capture.imageUrl}
                  alt={distressType}
                  style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'contain' }}
                />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No snapshot image available</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  if (onViewInMap) {
                    onViewInMap(capture);
                  }
                  onClose();
                }}
                className="btn btn--secondary btn--sm"
                title="View and navigate to this distress directly in the Map & Street View workspace"
              >
                🗺️ View on Map & Street View
              </button>
              <a
                href={streetViewWebUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn--secondary btn--sm"
              >
                👀 Open in Google Street View Web
              </a>
            </div>
          </div>

          {/* Metadata & Edit Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Type of Distress *</label>
              <input
                className="form-input"
                value={distressType}
                onChange={e => setDistressType(e.target.value)}
                placeholder="e.g. Spalls or Longitudinal Cracks"
              />

              {/* Inline suggestion chips */}
              <div className="chips-container" style={{ maxHeight: 90, overflowY: 'auto' }}>
                {suggestions.slice(0, 10).map(s => (
                  <button
                    key={s}
                    type="button"
                    className={`chip ${distressType.toLowerCase() === s.toLowerCase() ? 'chip--active' : ''}`}
                    onClick={() => setDistressType(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 'var(--radius-md)', fontSize: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Section:</span>{' '}
                  <strong>{section?.id || capture.sectionId}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Highway:</span>{' '}
                  <strong>{section?.highway || '—'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Coordinates:</span>{' '}
                  <strong>{capture.lat?.toFixed(5)}°, {capture.lon?.toFixed(5)}°</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Distance from Start:</span>{' '}
                  <strong style={{ color: 'var(--accent-primary)' }}>+{capture.distanceFromStartMiles?.toFixed(3)} mi</strong>
                </div>
                {refMarkerInfo?.refMarkerDisplay && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Reference Marker:</span>{' '}
                    <strong style={{ color: '#0284c7' }}>{refMarkerInfo.refMarkerDisplay}</strong>
                  </div>
                )}
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Street View Imagery:</span>{' '}
                  <strong style={{ color: 'var(--accent-primary)' }}>{capture.imageDate || 'Current / Unknown'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Observation Year:</span>{' '}
                  <strong style={{ color: 'var(--accent-primary)' }}>{capture.imageYear || (capture.imageDate ? capture.imageDate.slice(0, 4) : '—')}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Camera Heading:</span>{' '}
                  <strong>{Math.round(capture.heading || 0)}°</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Captured On:</span>{' '}
                  <strong>{new Date(capture.capturedAt).toLocaleString()}</strong>
                </div>
              </div>
            </div>

            {/* Editable Imagery Year and Date Override */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">Distress Year</label>
                <input
                  className="form-input"
                  value={imageYear}
                  onChange={e => setImageYear(e.target.value)}
                  placeholder="e.g. 2021"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Imagery Date (YYYY-MM)</label>
                <input
                  className="form-input"
                  value={imageDate}
                  onChange={e => setImageDate(e.target.value)}
                  placeholder="e.g. 2021-06"
                />
              </div>
            </div>

            <div className="form-group" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <label className="form-label">Inspector Notes & Severity</label>
              <textarea
                className="form-textarea"
                rows={4}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Medium severity, wheelpath crack approx 15 ft in length..."
                style={{ flex: 1 }}
              />
            </div>
          </div>
        </div>

        <div className="modal__footer" style={{ justifyContent: 'space-between' }}>
          <button
            className="btn btn--danger btn--sm"
            onClick={() => {
              if (window.confirm('Delete this capture?')) {
                onDeleteCapture(capture.id);
                onClose();
              }
            }}
          >
            🗑️ Delete Capture
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--secondary btn--sm" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn--primary btn--sm" onClick={handleSave}>
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
