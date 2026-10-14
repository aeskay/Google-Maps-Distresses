/**
 * AddSectionModal.jsx
 * Modal for creating or editing a section manually, with full GPS Start and End input support.
 */
import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { TXDOT_DISTRICT_NAMES } from '../../utils/normalizers';
import { haversineDistanceMiles, fetchCoordinatesForSection } from '../../utils/txdotGisApi';

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
  const [slabThickness, setSlabThickness] = useState(initialData?.slabThickness || '');
  const [baseType, setBaseType] = useState(initialData?.baseType || '');
  const [baseThickness, setBaseThickness] = useState(initialData?.baseThickness || '');
  const [subgradeType, setSubgradeType] = useState(initialData?.subgradeType || '');
  const [subgradeThickness, setSubgradeThickness] = useState(initialData?.subgradeThickness || '');

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
  const [isResolvingTxdot, setIsResolvingTxdot] = useState(false);
  const [txdotResolvedInfo, setTxdotResolvedInfo] = useState(null);
  const [resolvedCoordinates, setResolvedCoordinates] = useState(initialData?.coordinates || null);

  async function handleFetchFromTxdot() {
    setError('');
    setTxdotResolvedInfo(null);
    const b = parseFloat(beginRef);
    const eRef = parseFloat(endRef);
    if (isNaN(b) || isNaN(eRef)) {
      setError('Please enter valid Begin and End Reference Markers.');
      return;
    }
    if (!highway.trim()) {
      setError('Highway is required to fetch TxDOT coordinates.');
      return;
    }
    setIsResolvingTxdot(true);
    try {
      const res = await fetchCoordinatesForSection({
        highway: highway.trim().toUpperCase(),
        district: district.trim(),
        countyName: countyName.trim() || null,
        beginRef: b,
        endRef: eRef,
      }, { forceRefresh: true });

      if (res.status === 'success' && res.begin && res.end) {
        setGpsStartInput(`${res.begin[0].toFixed(6)}, ${res.begin[1].toFixed(6)}`);
        setGpsEndInput(`${res.end[0].toFixed(6)}, ${res.end[1].toFixed(6)}`);
        setResolvedCoordinates(res);
        const curvePoints = Array.isArray(res.path) ? res.path.length : 2;
        setTxdotResolvedInfo(`✓ Resolved from TxDOT: ${curvePoints} road curve points (${res.lengthMiles || 0} mi)`);
      } else {
        setError(res.error || 'Could not resolve coordinates from TxDOT for this marker range.');
      }
    } catch (err) {
      setError(`Failed to fetch from TxDOT: ${err.message}`);
    } finally {
      setIsResolvingTxdot(false);
    }
  }

  async function handleSubmit(e) {
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

    const rmOrHwyChanged = isEditing && (
      parseFloat(beginRef) !== parseFloat(initialData?.beginRef) ||
      parseFloat(endRef) !== parseFloat(initialData?.endRef) ||
      highway.trim().toUpperCase() !== String(initialData?.highway || '').trim().toUpperCase() ||
      district.trim().toLowerCase() !== String(initialData?.district || '').trim().toLowerCase()
    );

    let coordinates = resolvedCoordinates;
    let startCoord = parseCoordString(gpsStartInput);
    let endCoord = parseCoordString(gpsEndInput);

    // If RM or highway changed and user didn't explicitly fetch new coordinates:
    if (rmOrHwyChanged && (!coordinates || coordinates === initialData?.coordinates)) {
      try {
        const fresh = await fetchCoordinatesForSection({
          highway: highway.trim().toUpperCase(),
          district: district.trim(),
          countyName: countyName.trim() || null,
          beginRef: b,
          endRef: eRef,
        }, { forceRefresh: true });
        if (fresh && fresh.status === 'success' && fresh.begin && fresh.end) {
          coordinates = fresh;
          startCoord = fresh.begin;
          endCoord = fresh.end;
        }
      } catch (err) {
        console.warn('Auto-resolve from TxDOT during submit failed:', err);
      }
    }

    // Process GPS coordinates if provided
    if (gpsStartInput.trim() && !startCoord) {
      setError('GPS Start format is invalid. Expected format: "latitude, longitude" (e.g. 29.7110, -95.2112)');
      return;
    }
    if (gpsEndInput.trim() && !endCoord) {
      setError('GPS End format is invalid. Expected format: "latitude, longitude" (e.g. 29.7420, -95.1850)');
      return;
    }

    if (!coordinates) {
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
      slabThickness: slabThickness.trim() || null,
      baseType: baseType.trim() || null,
      baseThickness: baseThickness.trim() || null,
      subgradeType: subgradeType.trim() || null,
      subgradeThickness: subgradeThickness.trim() || null,
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
                <label className="form-label">County</label>
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

            {/* Pavement Design & Structure */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Slab Thickness</label>
                <input
                  className="form-input"
                  value={slabThickness}
                  onChange={e => setSlabThickness(e.target.value)}
                  placeholder="e.g. 10.0 in"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Base Type</label>
                <input
                  className="form-input"
                  value={baseType}
                  onChange={e => setBaseType(e.target.value)}
                  placeholder="e.g. Asphalt Treated Base"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Base Thickness</label>
                <input
                  className="form-input"
                  value={baseThickness}
                  onChange={e => setBaseThickness(e.target.value)}
                  placeholder="e.g. 4.0 in"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Subgrade Type</label>
                <input
                  className="form-input"
                  value={subgradeType}
                  onChange={e => setSubgradeType(e.target.value)}
                  placeholder="e.g. Lime Stabilized Subgrade"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Subgrade Thickness</label>
                <input
                  className="form-input"
                  value={subgradeThickness}
                  onChange={e => setSubgradeThickness(e.target.value)}
                  placeholder="e.g. 6.0 in"
                />
              </div>

              <div className="form-group">
                <label className="form-label">CSJ</label>
                <input
                  className="form-input"
                  value={csj}
                  onChange={e => setCsj(e.target.value)}
                  placeholder="e.g. 0123-04-056"
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)' }}>
                  📍 GPS Coordinates & Highway Path
                </span>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={handleFetchFromTxdot}
                  disabled={isResolvingTxdot}
                  title="Query TxDOT GIS API to automatically fetch GPS coordinates and the full curved highway path"
                >
                  {isResolvingTxdot ? '⏳ Querying TxDOT...' : '⚡ Fetch from TxDOT GIS'}
                </button>
              </div>

              {txdotResolvedInfo && (
                <div style={{ color: '#059669', fontSize: 11, marginBottom: 10, fontWeight: 600 }}>
                  {txdotResolvedInfo}
                </div>
              )}

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
