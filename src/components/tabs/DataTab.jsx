/**
 * DataTab.jsx
 * Tabular inspection of project sections, reference marker limits, GPS resolution status, and PMIS data.
 */
import React, { useState } from 'react';
import { cleanDistrictString, normalizeHighway } from '../../utils/normalizers';

export default function DataTab({
  sections = [],
  pmisMap,
  selectedSectionId,
  onSelectSection,
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = sections.filter(s => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return s.id?.toLowerCase().includes(term) ||
           s.highway?.toLowerCase().includes(term) ||
           s.district?.toLowerCase().includes(term) ||
           s.countyName?.toLowerCase().includes(term);
  });

  return (
    <div className="tab-pane" style={{ padding: 20, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            Sections Data Table ({sections.length})
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Overview of highway reference markers, GPS resolution coordinates, and distress capture counts.
          </div>
        </div>

        <input
          className="form-input"
          style={{ maxWidth: 280 }}
          placeholder="Filter sections..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
              <th style={{ padding: '10px 14px' }}>ID</th>
              <th style={{ padding: '10px 14px' }}>Highway</th>
              <th style={{ padding: '10px 14px' }}>District</th>
              <th style={{ padding: '10px 14px' }}>County</th>
              <th style={{ padding: '10px 14px' }}>RM Range</th>
              <th style={{ padding: '10px 14px' }}>GPS Status</th>
              <th style={{ padding: '10px 14px' }}>Start Coord</th>
              <th style={{ padding: '10px 14px' }}>End Coord</th>
              <th style={{ padding: '10px 14px' }}>Captures</th>
              <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => {
              const isSelected = s.id === selectedSectionId;
              const hasGps = s.coordinates?.status === 'success' && s.coordinates.begin;
              const captureCount = s.captures?.length || 0;

              return (
                <tr
                  key={s._uuid || s.id}
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                  }}
                >
                  <td style={{ padding: '8px 14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {s.id}
                  </td>
                  <td style={{ padding: '8px 14px', fontWeight: 600 }}>{s.highway}</td>
                  <td style={{ padding: '8px 14px' }}>{s.district}</td>
                  <td style={{ padding: '8px 14px', color: 'var(--text-secondary)' }}>{s.countyName || '—'}</td>
                  <td style={{ padding: '8px 14px' }}>
                    {s.beginRef} – {s.endRef} mi
                  </td>
                  <td style={{ padding: '8px 14px' }}>
                    {hasGps ? (
                      <span style={{ color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>●</span> Mapped ({s.coordinates.lengthMiles || 0} mi)
                      </span>
                    ) : (
                      <span style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>●</span> Unmapped
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                    {s.coordinates?.begin ? `${s.coordinates.begin[0].toFixed(4)}, ${s.coordinates.begin[1].toFixed(4)}` : '—'}
                  </td>
                  <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                    {s.coordinates?.end ? `${s.coordinates.end[0].toFixed(4)}, ${s.coordinates.end[1].toFixed(4)}` : '—'}
                  </td>
                  <td style={{ padding: '8px 14px' }}>
                    {captureCount > 0 ? (
                      <span style={{ background: 'rgba(59, 130, 246, 0.2)', color: 'var(--accent-primary)', padding: '2px 8px', borderRadius: 'var(--radius-full)', fontWeight: 700 }}>
                        📸 {captureCount}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>0</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                    <button
                      className="btn btn--secondary btn--sm"
                      onClick={() => onSelectSection(s.id)}
                    >
                      View on Map
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
