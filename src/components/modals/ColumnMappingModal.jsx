/**
 * ColumnMappingModal.jsx
 * CSV / Excel column mapping with comprehensive GPS Start/End support and auto-detection.
 */
import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { haversineDistanceMiles } from '../../utils/txdotGisApi';

const REQUIRED_FIELDS = [
  { appKey: 'id',       label: 'Section ID',   hint: 'Unique section identifier' },
  { appKey: 'highway',  label: 'Highway',      hint: 'Highway + roadbed (e.g. "IH0020 R" or "US 59 L")' },
  { appKey: 'beginRef', label: 'Begin RM',     hint: 'Start reference marker (e.g. 520.0)' },
  { appKey: 'endRef',   label: 'End RM',       hint: 'End reference marker (e.g. 524.5)' },
  { appKey: 'district', label: 'District',     hint: 'District name or number (e.g. "12 - HOUSTON" or "Houston")' },
];

const OPTIONAL_FIELDS = [
  { appKey: 'countyName', label: 'County', hint: 'County name (e.g. "Harris")' },
  { appKey: 'csj',        label: 'CSJ',    hint: 'Control Section Job (e.g. 0123-04-056)' },
  { appKey: 'sn',         label: 'S/N',    hint: 'Section Number' },
];

const GPS_FIELDS = [
  { appKey: 'gpsStart',  label: 'GPS Start (lat, lon)', hint: 'Combined start coordinates: "29.7110, -95.2112"' },
  { appKey: 'gpsEnd',    label: 'GPS End (lat, lon)',   hint: 'Combined end coordinates: "29.7420, -95.1850"' },
  { appKey: 'startLat',  label: 'Start Latitude',       hint: 'If latitude and longitude are separate columns' },
  { appKey: 'startLon',  label: 'Start Longitude',      hint: 'Separate start longitude column' },
  { appKey: 'endLat',    label: 'End Latitude',         hint: 'Separate end latitude column' },
  { appKey: 'endLon',    label: 'End Longitude',        hint: 'Separate end longitude column' },
];

const SUGGEST_MAP = {
  id:       ['id', 'section id', 'sec id', 'sid', 'section_id'],
  highway:  ['highway', 'hwy', 'signed hwy', 'roadbed', 'highway roadbed', 'signed highway'],
  beginRef: ['begin ref', 'begin_ref', 'begin', 'start ref', 'start_ref', 'beg ref', 'beg trm', 'begin trm', 'from rm'],
  endRef:   ['end ref', 'end_ref', 'end', 'ending ref', 'end trm', 'ending trm', 'to rm'],
  district: ['district', 'dist', 'responsible district'],
  countyName: ['county', 'county name', 'cnty'],
  csj:      ['csj', 'csj number', 'control section job', 'control section', 'job number'],
  sn:       ['s/n', 'sn', 'section number', 'sec no'],
  gpsStart: ['gps start', 'start gps', 'begin gps', 'gps begin', 'start coord', 'start lat lon', 'gps start r', 'gps start l', 'start r', 'start l'],
  gpsEnd:   ['gps end', 'end gps', 'ending gps', 'end coord', 'end lat lon', 'gps end r', 'gps end l', 'end r', 'end l'],
  startLat: ['start lat', 'beg lat', 'begin lat', 'latitude start', 'from lat'],
  startLon: ['start lon', 'beg lon', 'begin lon', 'start long', 'longitude start', 'from lon'],
  endLat:   ['end lat', 'ending lat', 'latitude end', 'to lat'],
  endLon:   ['end lon', 'ending lon', 'longitude end', 'to lon', 'end long'],
};

function autoSuggest(appKey, headers) {
  const patterns = SUGGEST_MAP[appKey] || [];
  const norm = s => String(s).toLowerCase().trim().replace(/[_\s]+/g, ' ');
  for (const p of patterns) {
    const found = headers.find(h => norm(h) === p || norm(h).includes(p));
    if (found) return found;
  }
  return '';
}

function parseCombinedCoord(str) {
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

export default function ColumnMappingModal({
  csvHeaders = [],
  csvRows = [],
  onImport,
  onCancel,
}) {
  const [importMode, setImportMode] = useState('merge'); // 'merge' | 'overwrite'
  const [mappings, setMappings] = useState(() => {
    const initial = {};
    for (const f of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS, ...GPS_FIELDS]) {
      initial[f.appKey] = autoSuggest(f.appKey, csvHeaders);
    }
    return initial;
  });

  const previewRow = csvRows[0] || {};

  function handleFieldChange(appKey, value) {
    setMappings(prev => ({ ...prev, [appKey]: value }));
  }

  function handleConfirm() {
    const imported = csvRows.map((row) => {
      const getVal = (key) => {
        const col = mappings[key];
        return col ? row[col] : undefined;
      };

      // Resolve Start Coordinate (combined or separate)
      let startCoord = parseCombinedCoord(getVal('gpsStart'));
      if (!startCoord) {
        const sLat = parseFloat(getVal('startLat'));
        const sLon = parseFloat(getVal('startLon'));
        if (!isNaN(sLat) && !isNaN(sLon)) startCoord = [sLat, sLon];
      }

      // Resolve End Coordinate (combined or separate)
      let endCoord = parseCombinedCoord(getVal('gpsEnd'));
      if (!endCoord) {
        const eLat = parseFloat(getVal('endLat'));
        const eLon = parseFloat(getVal('endLon'));
        if (!isNaN(eLat) && !isNaN(eLon)) endCoord = [eLat, eLon];
      }

      let coordinates = null;
      if (startCoord && endCoord) {
        const lengthMi = Number(haversineDistanceMiles(startCoord[0], startCoord[1], endCoord[0], endCoord[1]).toFixed(3));
        coordinates = {
          status: 'success',
          available: true,
          source: 'imported_csv',
          timestamp: new Date().toISOString(),
          begin: startCoord,
          end: endCoord,
          path: [startCoord, endCoord],
          lengthMiles: lengthMi,
        };
      }

      return {
        _uuid: uuidv4(),
        id: String(getVal('id') || '').trim() || `SEC-${Math.floor(Math.random() * 9000 + 1000)}`,
        highway: String(getVal('highway') || '').trim(),
        district: String(getVal('district') || '').trim(),
        countyName: String(getVal('countyName') || '').trim() || null,
        beginRef: parseFloat(getVal('beginRef')) || 0,
        endRef: parseFloat(getVal('endRef')) || 0,
        csj: String(getVal('csj') || '').trim() || null,
        sn: String(getVal('sn') || '').trim() || null,
        gpsStart: startCoord ? `${startCoord[0]}, ${startCoord[1]}` : null,
        gpsEnd: endCoord ? `${endCoord[0]}, ${endCoord[1]}` : null,
        coordinates,
        captures: [],
      };
    });

    onImport(imported, importMode);
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal--lg">
        <div className="modal__header">
          <div className="modal__title">Import Sections from CSV / Excel</div>
          <button className="btn btn--ghost btn--icon" onClick={onCancel}>✕</button>
        </div>

        <div className="modal__body">
          <div style={{ marginBottom: 14, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
            Map your columns ({csvRows.length.toLocaleString()} rows detected). If GPS coordinates are in your CSV, they will be imported directly. Sections without GPS will be auto-generated from TxDOT GIS services.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Required Fields & General Info */}
            <div>
              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-primary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Required Highway Fields
              </div>
              {REQUIRED_FIELDS.map(f => (
                <div key={f.appKey} className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{f.label} *</span>
                    {previewRow[mappings[f.appKey]] && (
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                        {String(previewRow[mappings[f.appKey]]).slice(0, 20)}
                      </span>
                    )}
                  </label>
                  <select
                    className="form-select"
                    value={mappings[f.appKey] || ''}
                    onChange={e => handleFieldChange(f.appKey, e.target.value)}
                  >
                    <option value="">— Select Column —</option>
                    {csvHeaders.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}

              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-primary)', marginTop: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Optional Section Fields
              </div>
              {OPTIONAL_FIELDS.map(f => (
                <div key={f.appKey} className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label">
                    <span>{f.label}</span>
                  </label>
                  <select
                    className="form-select"
                    value={mappings[f.appKey] || ''}
                    onChange={e => handleFieldChange(f.appKey, e.target.value)}
                  >
                    <option value="">— Unmapped —</option>
                    {csvHeaders.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* GPS Coordinates Mapping */}
            <div>
              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-primary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                📍 GPS Coordinates (Start & End)
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                Map combined columns (e.g. "GPS Start") OR separate Latitude/Longitude columns.
              </div>

              {GPS_FIELDS.map(f => (
                <div key={f.appKey} className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{f.label}</span>
                    {previewRow[mappings[f.appKey]] && (
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                        {String(previewRow[mappings[f.appKey]]).slice(0, 18)}
                      </span>
                    )}
                  </label>
                  <select
                    className="form-select"
                    value={mappings[f.appKey] || ''}
                    onChange={e => handleFieldChange(f.appKey, e.target.value)}
                  >
                    <option value="">— Unmapped —</option>
                    {csvHeaders.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}

              <div className="form-group" style={{ marginTop: 18, padding: 12, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
                <label className="form-label" style={{ marginBottom: 6 }}>Import Mode</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text-primary)' }}>
                    <input
                      type="radio"
                      name="importMode"
                      value="merge"
                      checked={importMode === 'merge'}
                      onChange={() => setImportMode('merge')}
                    />
                    <span>Smart Merge (Updates existing sections, preserves captures)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text-primary)' }}>
                    <input
                      type="radio"
                      name="importMode"
                      value="overwrite"
                      checked={importMode === 'overwrite'}
                      onChange={() => setImportMode('overwrite')}
                    />
                    <span>Replace Sections (Cleans existing sections list)</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={handleConfirm}
            disabled={!mappings.id || !mappings.highway}
          >
            Import {csvRows.length} Sections
          </button>
        </div>
      </div>
    </div>
  );
}
