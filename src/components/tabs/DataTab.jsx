/**
 * DataTab.jsx
 * Tabular inspection of project sections, reference marker limits, pavement design,
 * GPS resolution status, distress capture counts, and batch deletion.
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';

export default function DataTab({
  sections = [],
  pmisMap,
  selectedSectionId,
  onSelectSection,
  onDeleteSection,
  onDeleteSections,
  addToast,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const headerCheckboxRef = useRef(null);

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return sections;
    const term = searchTerm.toLowerCase().trim();
    return sections.filter(s => {
      return (
        s.id?.toLowerCase().includes(term) ||
        s.highway?.toLowerCase().includes(term) ||
        s.district?.toLowerCase().includes(term) ||
        s.countyName?.toLowerCase().includes(term) ||
        s.csj?.toLowerCase().includes(term) ||
        s.slabThickness?.toLowerCase().includes(term) ||
        s.baseType?.toLowerCase().includes(term) ||
        s.baseThickness?.toLowerCase().includes(term) ||
        s.subgradeType?.toLowerCase().includes(term) ||
        s.subgradeThickness?.toLowerCase().includes(term)
      );
    });
  }, [sections, searchTerm]);

  // Sync header indeterminate state
  const isAllSelected = filtered.length > 0 && filtered.every(s => selectedIds.has(s.id));
  const isSomeSelected = filtered.some(s => selectedIds.has(s.id)) && !isAllSelected;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isSomeSelected;
    }
  }, [isSomeSelected]);

  function handleToggleAll() {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(s => s.id)));
    }
  }

  function handleToggleRow(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (window.confirm(`Delete ${count} selected section(s)? This will also remove any distress captures within them.`)) {
      const idsArray = Array.from(selectedIds);
      if (onDeleteSections) {
        onDeleteSections(idsArray);
      } else if (onDeleteSection) {
        idsArray.forEach(id => onDeleteSection(id));
      }
      setSelectedIds(new Set());
      if (addToast) {
        addToast('success', 'Sections Deleted', `${count} section(s) deleted.`);
      }
    }
  }

  function handleDeleteSingle(id) {
    if (window.confirm(`Delete section "${id}"?`)) {
      if (onDeleteSections) {
        onDeleteSections([id]);
      } else if (onDeleteSection) {
        onDeleteSection(id);
      }
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (addToast) {
        addToast('success', 'Section Deleted', `Section "${id}" deleted.`);
      }
    }
  }

  return (
    <div className="tab-pane" style={{ padding: 20, overflowY: 'auto' }}>
      {/* Header and Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            Sections Data Table ({sections.length})
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Reference markers, pavement structure, GPS coordinates, and distress capture counts.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {selectedIds.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--accent-primary)',
                background: 'rgba(59, 130, 246, 0.1)',
                padding: '4px 10px',
                borderRadius: 'var(--radius-full)',
              }}>
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                onClick={handleDeleteSelected}
                title="Delete all selected sections"
                style={{ fontWeight: 600 }}
              >
                🗑️ Delete Selected ({selectedIds.size})
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setSelectedIds(new Set())}
                style={{ fontSize: 12 }}
              >
                Deselect
              </button>
            </div>
          )}

          <input
            className="form-input"
            style={{ width: 240 }}
            placeholder="Filter sections..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Table Container */}
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        overflowX: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{
              background: 'var(--bg-elevated)',
              borderBottom: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap',
            }}>
              <th style={{ padding: '10px 12px', width: 38, textAlign: 'center' }}>
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={handleToggleAll}
                  aria-label="Select all sections"
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <th style={{ padding: '10px 14px' }}>ID</th>
              <th style={{ padding: '10px 14px' }}>Highway</th>
              <th style={{ padding: '10px 14px' }}>District</th>
              <th style={{ padding: '10px 14px' }}>County</th>
              <th style={{ padding: '10px 14px' }}>RM Range</th>
              <th style={{ padding: '10px 14px' }}>Slab Thickness</th>
              <th style={{ padding: '10px 14px' }}>Base Type</th>
              <th style={{ padding: '10px 14px' }}>Base Thickness</th>
              <th style={{ padding: '10px 14px' }}>Subgrade Type</th>
              <th style={{ padding: '10px 14px' }}>Subgrade Thickness</th>
              <th style={{ padding: '10px 14px' }}>GPS Status</th>
              <th style={{ padding: '10px 14px' }}>Start Coord</th>
              <th style={{ padding: '10px 14px' }}>End Coord</th>
              <th style={{ padding: '10px 14px' }}>Captures</th>
              <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={16} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                  {searchTerm ? 'No sections match the current filter.' : 'No sections available in this project.'}
                </td>
              </tr>
            ) : (
              filtered.map(s => {
                const isFocused = s.id === selectedSectionId;
                const isChecked = selectedIds.has(s.id);
                const hasGps = s.coordinates?.status === 'success' && s.coordinates.begin;
                const captureCount = s.captures?.length || 0;

                return (
                  <tr
                    key={s._uuid || s.id}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      background: isChecked
                        ? 'rgba(59, 130, 246, 0.12)'
                        : isFocused
                        ? 'rgba(59, 130, 246, 0.05)'
                        : 'transparent',
                      transition: 'background 0.12s ease',
                    }}
                  >
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleRow(s.id)}
                        aria-label={`Select section ${s.id}`}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '8px 14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {s.id}
                    </td>
                    <td style={{ padding: '8px 14px', fontWeight: 600, whiteSpace: 'nowrap' }}>{s.highway}</td>
                    <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>{s.district}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {s.countyName || '—'}
                    </td>
                    <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                      {s.beginRef} – {s.endRef} mi
                    </td>
                    <td style={{ padding: '8px 14px', color: s.slabThickness ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {s.slabThickness || '—'}
                    </td>
                    <td style={{ padding: '8px 14px', color: s.baseType ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {s.baseType || '—'}
                    </td>
                    <td style={{ padding: '8px 14px', color: s.baseThickness ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {s.baseThickness || '—'}
                    </td>
                    <td style={{ padding: '8px 14px', color: s.subgradeType ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {s.subgradeType || '—'}
                    </td>
                    <td style={{ padding: '8px 14px', color: s.subgradeThickness ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {s.subgradeThickness || '—'}
                    </td>
                    <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                      {hasGps ? (
                        <span style={{ color: '#10b981', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span>●</span> Mapped ({s.coordinates.lengthMiles || 0} mi)
                        </span>
                      ) : (
                        <span style={{ color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span>●</span> Unmapped
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {s.coordinates?.begin ? `${s.coordinates.begin[0].toFixed(4)}, ${s.coordinates.begin[1].toFixed(4)}` : '—'}
                    </td>
                    <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {s.coordinates?.end ? `${s.coordinates.end[0].toFixed(4)}, ${s.coordinates.end[1].toFixed(4)}` : '—'}
                    </td>
                    <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                      {captureCount > 0 ? (
                        <span style={{
                          background: 'rgba(59, 130, 246, 0.2)',
                          color: 'var(--accent-primary)',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-full)',
                          fontWeight: 700,
                        }}>
                          📸 {captureCount}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>0</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => onSelectSection(s.id)}
                          title="Focus section on Map & Street View"
                        >
                          View on Map
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => handleDeleteSingle(s.id)}
                          title={`Delete section "${s.id}"`}
                          style={{ color: '#dc2626', padding: '4px 6px' }}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
