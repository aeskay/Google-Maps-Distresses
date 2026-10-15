/**
 * DataTab.jsx
 * Tabular inspection of project sections, reference marker limits, pavement design,
 * GPS resolution status, distress capture counts, batch deletion, and project-persisted column filtering.
 */
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { formatDistrictDisplay, formatSlabThicknessDisplay } from '../../utils/normalizers';

const COLUMN_DEFS = [
  { id: 'id',                label: 'ID',                 alwaysVisible: true },
  { id: 'highway',           label: 'Highway' },
  { id: 'district',          label: 'District' },
  { id: 'county',            label: 'County' },
  { id: 'rmRange',           label: 'RM Range' },
  { id: 'slabThickness',     label: 'Slab Thickness' },
  { id: 'baseType',          label: 'Base Type' },
  { id: 'baseThickness',     label: 'Base Thickness' },
  { id: 'subgradeType',      label: 'Subgrade Type' },
  { id: 'subgradeThickness', label: 'Subgrade Thickness' },
  { id: 'gpsStatus',         label: 'GPS Status' },
  { id: 'startCoord',        label: 'Start Coord' },
  { id: 'endCoord',          label: 'End Coord' },
  { id: 'captures',          label: 'Captures' },
  { id: 'actions',           label: 'Actions' },
];

const ALL_COLUMN_IDS = COLUMN_DEFS.map(c => c.id);

export default function DataTab({
  project,
  sections = [],
  pmisMap,
  selectedSectionId,
  onSelectSection,
  onDeleteSection,
  onDeleteSections,
  onUpdateProject,
  addToast,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isColumnDropdownOpen, setIsColumnDropdownOpen] = useState(false);

  const headerCheckboxRef = useRef(null);
  const columnDropdownRef = useRef(null);

  const storageKey = project?.id ? `txdot-distress:columns:${project.id}` : null;

  // Initialize visible columns with project persistence & localStorage fallback
  const getInitialVisibleColumns = useCallback(() => {
    if (Array.isArray(project?.visibleColumns) && project.visibleColumns.length > 0) {
      return new Set(project.visibleColumns);
    }
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return new Set(parsed);
          }
        }
      } catch {}
    }
    return new Set(ALL_COLUMN_IDS);
  }, [project?.id, project?.visibleColumns, storageKey]);

  const [visibleColumns, setVisibleColumns] = useState(getInitialVisibleColumns);

  // Sync visible columns whenever active project changes
  useEffect(() => {
    setVisibleColumns(getInitialVisibleColumns());
  }, [getInitialVisibleColumns]);

  // Persist column changes to project & localStorage
  const updateVisibleColumns = useCallback((newSet) => {
    setVisibleColumns(newSet);
    const arr = Array.from(newSet);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(arr));
      } catch {}
    }
    if (project && onUpdateProject) {
      onUpdateProject({ ...project, visibleColumns: arr });
    }
  }, [storageKey, project, onUpdateProject]);

  function handleToggleColumn(columnId) {
    if (columnId === 'id') return; // Keep ID always visible for reference
    const next = new Set(visibleColumns);
    if (next.has(columnId)) {
      if (next.size <= 1) return; // Prevent hiding everything
      next.delete(columnId);
    } else {
      next.add(columnId);
    }
    updateVisibleColumns(next);
  }

  function handleShowAllColumns() {
    updateVisibleColumns(new Set(ALL_COLUMN_IDS));
  }

  function handleResetColumns() {
    updateVisibleColumns(new Set(ALL_COLUMN_IDS));
  }

  // Close column dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (columnDropdownRef.current && !columnDropdownRef.current.contains(e.target)) {
        setIsColumnDropdownOpen(false);
      }
    }
    if (isColumnDropdownOpen) {
      document.addEventListener('pointerdown', handleClickOutside);
      return () => document.removeEventListener('pointerdown', handleClickOutside);
    }
  }, [isColumnDropdownOpen]);

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

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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

          {/* Column Visibility Filter Popover */}
          <div style={{ position: 'relative' }} ref={columnDropdownRef}>
            <button
              type="button"
              className={`btn btn--secondary btn--sm ${isColumnDropdownOpen ? 'btn--active' : ''}`}
              onClick={() => setIsColumnDropdownOpen(v => !v)}
              title="Show or hide columns (persists for this project)"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
            >
              <span>👁️ Columns</span>
              <span style={{
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
              }}>
                {visibleColumns.size}/{COLUMN_DEFS.length}
              </span>
              <span style={{ fontSize: 9 }}>▼</span>
            </button>

            {isColumnDropdownOpen && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 100,
                background: '#ffffff',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-modal)',
                width: 250,
                maxHeight: 420,
                overflowY: 'auto',
                padding: 10,
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingBottom: 8,
                  marginBottom: 8,
                  borderBottom: '1px solid var(--border-default)',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                    Visible Columns
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn--ghost btn--xs"
                      onClick={handleShowAllColumns}
                      style={{ fontSize: 10, padding: '2px 6px', color: 'var(--accent-primary)', fontWeight: 600 }}
                    >
                      Show All
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--xs"
                      onClick={handleResetColumns}
                      style={{ fontSize: 10, padding: '2px 6px' }}
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {COLUMN_DEFS.map(col => {
                    const isChecked = visibleColumns.has(col.id);
                    const isLocked = col.alwaysVisible;

                    return (
                      <label
                        key={col.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '5px 8px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 12,
                          cursor: isLocked ? 'default' : 'pointer',
                          background: isChecked ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                          color: isChecked ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isLocked}
                          onChange={() => handleToggleColumn(col.id)}
                          style={{ cursor: isLocked ? 'not-allowed' : 'pointer' }}
                        />
                        <span style={{ flex: 1, fontWeight: isChecked ? 600 : 400 }}>
                          {col.label}
                        </span>
                        {isLocked && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }} title="Always visible">
                            🔒
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <input
            className="form-input"
            style={{ width: 220 }}
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
              {visibleColumns.has('id') && <th style={{ padding: '10px 14px' }}>ID</th>}
              {visibleColumns.has('highway') && <th style={{ padding: '10px 14px' }}>Highway</th>}
              {visibleColumns.has('district') && <th style={{ padding: '10px 14px' }}>District</th>}
              {visibleColumns.has('county') && <th style={{ padding: '10px 14px' }}>County</th>}
              {visibleColumns.has('rmRange') && <th style={{ padding: '10px 14px' }}>RM Range</th>}
              {visibleColumns.has('slabThickness') && <th style={{ padding: '10px 14px' }}>Slab Thickness</th>}
              {visibleColumns.has('baseType') && <th style={{ padding: '10px 14px' }}>Base Type</th>}
              {visibleColumns.has('baseThickness') && <th style={{ padding: '10px 14px' }}>Base Thickness</th>}
              {visibleColumns.has('subgradeType') && <th style={{ padding: '10px 14px' }}>Subgrade Type</th>}
              {visibleColumns.has('subgradeThickness') && <th style={{ padding: '10px 14px' }}>Subgrade Thickness</th>}
              {visibleColumns.has('gpsStatus') && <th style={{ padding: '10px 14px' }}>GPS Status</th>}
              {visibleColumns.has('startCoord') && <th style={{ padding: '10px 14px' }}>Start Coord</th>}
              {visibleColumns.has('endCoord') && <th style={{ padding: '10px 14px' }}>End Coord</th>}
              {visibleColumns.has('captures') && <th style={{ padding: '10px 14px' }}>Captures</th>}
              {visibleColumns.has('actions') && <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={1 + visibleColumns.size} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
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
                    {visibleColumns.has('id') && (
                      <td style={{ padding: '8px 14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {s.id}
                      </td>
                    )}
                    {visibleColumns.has('highway') && (
                      <td style={{ padding: '8px 14px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {s.highway}
                      </td>
                    )}
                    {visibleColumns.has('district') && (
                      <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                        {formatDistrictDisplay(s.district) || '—'}
                      </td>
                    )}
                    {visibleColumns.has('county') && (
                      <td style={{ padding: '8px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {s.countyName || '—'}
                      </td>
                    )}
                    {visibleColumns.has('rmRange') && (
                      <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                        {s.beginRef} – {s.endRef} mi
                      </td>
                    )}
                    {visibleColumns.has('slabThickness') && (
                      <td style={{ padding: '8px 14px', color: s.slabThickness ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {formatSlabThicknessDisplay(s.slabThickness) || '—'}
                      </td>
                    )}
                    {visibleColumns.has('baseType') && (
                      <td style={{ padding: '8px 14px', color: s.baseType ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {s.baseType || '—'}
                      </td>
                    )}
                    {visibleColumns.has('baseThickness') && (
                      <td style={{ padding: '8px 14px', color: s.baseThickness ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {s.baseThickness || '—'}
                      </td>
                    )}
                    {visibleColumns.has('subgradeType') && (
                      <td style={{ padding: '8px 14px', color: s.subgradeType ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {s.subgradeType || '—'}
                      </td>
                    )}
                    {visibleColumns.has('subgradeThickness') && (
                      <td style={{ padding: '8px 14px', color: s.subgradeThickness ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {s.subgradeThickness || '—'}
                      </td>
                    )}
                    {visibleColumns.has('gpsStatus') && (
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
                    )}
                    {visibleColumns.has('startCoord') && (
                      <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {s.coordinates?.begin ? `${s.coordinates.begin[0].toFixed(4)}, ${s.coordinates.begin[1].toFixed(4)}` : '—'}
                      </td>
                    )}
                    {visibleColumns.has('endCoord') && (
                      <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {s.coordinates?.end ? `${s.coordinates.end[0].toFixed(4)}, ${s.coordinates.end[1].toFixed(4)}` : '—'}
                      </td>
                    )}
                    {visibleColumns.has('captures') && (
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
                    )}
                    {visibleColumns.has('actions') && (
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
                    )}
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
