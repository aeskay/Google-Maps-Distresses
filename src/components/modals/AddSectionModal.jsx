/**
 * AddSectionModal.jsx
 * Modal for creating or editing a section manually, with full GPS Start and End input support.
 */
import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { TXDOT_DISTRICT_NAMES } from '../../utils/normalizers';
import { haversineDistanceMiles } from '../../utils/txdotGisApi';

const DISTRICT_OPTIONS = Array.from(new Set(Object.values(TXDOT_DISTRICT_NAMES))).sort();

function parseCoordString(str) {
  if (!str) return null;
  const parts = String(str).split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return [Number(lat.toFixed(6)), Number(lon.toFixed(6))];
    }
  }
  return null;
}

export default function AddSectionModal({
  initialData = null,
  existingIds = new Set(),
  onSave,
  onAdd,
  onCancel,
}) {
  const isEditing = Boolean(initialData);

  const [id, setId] = useState(initialData?.id || '');
  const [highway, setHighway] = useState(initialData?.highway || '');
  const [district, setDistrict] = useState(initialData?.district || 'Houston');
  const [countyName, setCountyName] = useState(initialData?.countyName || '');
  const [beginRef, setBeginRef] = useState(initialData?.beginRef ?? '');
  const [endRef, setEndRef] = useState(initialData?.endRef ?? '');
  const [csj, setCsj] = useState(initialData?.csj || '');

  // GPS Coordinates inputs
  const initialGpsStartStr = initialData?.coordinates?.begin
    ? `${initialData.coordinates.begin[0]}, ${initialData.coordinates.begin[1]}`
    : (initialData?.gpsStart || '');
  const initialGpsEndStr = initialData?.coordinates?.end
    ? `${initialData.coordinates.end[0]}, ${initialData.coordinates.end[1]}`
    : (initialData?.gpsEnd || '');

  const [gpsStartInput, setGpsStartInput] = useState(initialGpsStartStr);
  const [gpsEndInput, setGpsEndInput] = useState(initialGpsEndStr);

  const [error, setError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const cleanId = id.trim();
    if (!cleanId) {
      setError('Section ID is required.');
      return;
    }

    if (!isEditing && existingIds.has(cleanId)) {
      setError(`A section with ID "${cleanId}" already exists.`);
      return;
    }

    if (!highway.trim()) {
      setError('Highway is required (e.g. "IH0020 R" or "US 59 L").');
      return;
    }

    const b = parseFloat(beginRef);
    const eRef = parseFloat(endRef);
    if (isNaN(b) || isNaN(eRef)) {
      setError('Please provide valid Begin and End Reference Markers.');
      return;
    }

    // Process GPS coordinates if provided
    const startCoord = parseCoordString(gpsStartInput);
    const endCoord = parseCoordString(gpsEndInput);

    if (gpsStartInput.trim() && !startCoord) {
      setError('GPS Start format is invalid. Expected format: "latitude, longitude" (e.g. 29.7110, -95.2112)');
      return;
    }
    if (gpsEndInput.trim() && !endCoord) {
      setError('GPS End format is invalid. Expected format: "latitude, longitude" (e.g. 29.7420, -95.1850)');
      return;
    }

    let coordinates = initialData?.coordinates || null;

    if (startCoord && endCoord) {
      const lengthMi = Number(haversineDistanceMiles(startCoord[0], startCoord[1], endCoord[0], endCoord[1]).toFixed(3));
      coordinates = {
        status: 'success',
        available: true,
        source: 'manual',
        timestamp: new Date().toISOString(),
        begin: startCoord,
        end: endCoord,
        path: [startCoord, endCoord],
        lengthMiles: lengthMi,
      };
    } else if (startCoord && !endCoord) {
      coordinates = {
        status: 'partial',
        available: true,
        source: 'manual',
        begin: startCoord,
        end: null,
        path: [startCoord],
        lengthMiles: 0,
      };
    }

    const payload = {
      ...(initialData || {}),
      _uuid: initialData?._uuid || uuidv4(),
      id: cleanId,
      highway: highway.trim().toUpperCase(),
      district: district.trim(),
      countyName: countyName.trim() || null,
      beginRef: b,
      endRef: eRef,
      csj: csj.trim() || null,
      gpsStart: gpsStartInput.trim() || null,
      gpsEnd: gpsEndInput.trim() || null,
      coordinates,
      captures: initialData?.captures || [],
    };

    if (isEditing && onSave) {
      onSave(payload);
    } else if (onAdd) {
      onAdd(payload);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal--md">
        <form onSubmit={handleSubmit}>
          <div className="modal__header">
            <div className="modal__title">{isEditing ? 'Edit Section' : 'Add New Section'}</div>
            <button type="button" className="btn btn--ghost btn--icon" onClick={onCancel}>✕</button>
          </div>

          <div className="modal__body">
            {error && (
              <div style={{
                padding: '10px 14px',
                background: '#fee2e2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                borderRadius: 'var(--radius-md)',
                marginBottom: 14,
                fontSize: 12,
                fontWeight: 500,
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Section ID *</label>
                <input
                  className="form-input"
                  value={id}
                  onChange={e => setId(e.target.value)}
                  placeholder="e.g. SEC-01"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Highway + Roadbed *</label>
                <input
                  className="form-input"
                  value={highway}
                  onChange={e => setHighway(e.target.value)}
                  placeholder="e.g. IH0020 R or US 59 L"
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">TxDOT District *</label>
                <select
                  className="form-select"
                  value={district}
                  onChange={e => setDistrict(e.target.value)}
                >
                  {DISTRICT_OPTIONS.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">County (Optional)</label>
                <input
                  className="form-input"
                  value={countyName}
                  onChange={e => setCountyName(e.target.value)}
                  placeholder="e.g. Harris"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Begin Reference Marker *</label>
                <input
                  type="number"
                  step="any"
                  className="form-input"
                  value={beginRef}
                  onChange={e => setBeginRef(e.target.value)}
                  placeholder="e.g. 520.0"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">End Reference Marker *</label>
                <input
                  type="number"
                  step="any"
                  className="form-input"
                  value={endRef}
                  onChange={e => setEndRef(e.target.value)}
                  placeholder="e.g. 524.5"
                  required
                />
              </div>
            </div>

            {/* GPS Coordinates Section */}
            <div style={{
              background: 'var(--bg-elevated)',
              padding: 14,
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              marginBottom: 14,
            }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)', marginBottom: 4 }}>
                📍 GPS Coordinates (Optional)
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                If you leave these blank, you can auto-generate them anytime via the TxDOT GIS API.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="form-label">GPS Start (lat, lon)</label>
                  <input
                    className="form-input"
                    value={gpsStartInput}
                    onChange={e => setGpsStartInput(e.target.value)}
                    placeholder="e.g. 29.7110, -95.2112"
                  />
                </div>

                <div>
                  <label className="form-label">GPS End (lat, lon)</label>
                  <input
                    className="form-input"
                    value={gpsEndInput}
                    onChange={e => setGpsEndInput(e.target.value)}
                    placeholder="e.g. 29.7420, -95.1850"
                  />
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">CSJ (Optional)</label>
              <input
                className="form-input"
                value={csj}
                onChange={e => setCsj(e.target.value)}
                placeholder="e.g. 0123-04-056"
              />
            </div>
          </div>

          <div className="modal__footer">
            <button type="button" className="btn btn--secondary" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn--primary">
              {isEditing ? 'Save Changes' : 'Add Section'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
