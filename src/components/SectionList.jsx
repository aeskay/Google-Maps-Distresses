/**
 * SectionList.jsx
 * Displays sections for the active project with CSV upload, manual entry, and batch GPS generator.
 */
import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import ColumnMappingModal from './modals/ColumnMappingModal';
import AddSectionModal from './modals/AddSectionModal';
import { parseSpecificHighway } from '../utils/normalizers';
import { batchGenerateCoordinates } from '../utils/txdotGisApi';

export default function SectionList({
  sections = [],
  selectedSectionId,
  onSelect,
  onAddSections,
  onUpdateSection,
  onBatchUpdateSections,
  onDelete,
  addToast,
}) {
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSection, setEditingSection] = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [isGeneratingGps, setIsGeneratingGps] = useState(false);
  const [gpsProgress, setGpsProgress] = useState(null);

  const fileInputRef = useRef(null);

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const name = file.name.toLowerCase();
      let text = '';
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        text = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
      } else {
        text = await file.text();
      }

      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: h => (h ? h.trim() : ''),
        complete: ({ data, meta }) => {
          setCsvHeaders(meta.fields || []);
          setCsvRows(data);
          setShowCsvModal(true);
        },
        error: (err) => {
          addToast('error', 'CSV parse error', err.message);
        },
      });
    } catch (err) {
      addToast('error', 'Failed to read file', err.message);
    }
  }

  async function handleGenerateMissingGps() {
    const unmapped = sections.filter(s => !s.coordinates || s.coordinates.status !== 'success');
    if (unmapped.length === 0) {
      addToast('info', 'All Sections Mapped', 'All sections in this project already have valid GPS coordinates.');
      return;
    }

    setIsGeneratingGps(true);
    setGpsProgress({ current: 0, total: unmapped.length });
    try {
      const updated = await batchGenerateCoordinates(sections, (prog) => {
        setGpsProgress(prog);
      });
      onBatchUpdateSections(updated);
      const newlyMapped = updated.filter(s => s.coordinates?.status === 'success').length;
      addToast('success', 'GPS Coordinates Generated', `${newlyMapped} section(s) successfully mapped via TxDOT API.`);
    } catch (err) {
      addToast('error', 'GPS Generation Failed', err.message);
    } finally {
      setIsGeneratingGps(false);
      setGpsProgress(null);
    }
  }

  const unmappedCount = sections.filter(s => !s.coordinates || s.coordinates.status !== 'success').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv,.xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="section-list__header">
        <div>
          <span className="sidebar__section-title" style={{ marginBottom: 0 }}>
            Sections ({sections.length})
          </span>
          {unmappedCount > 0 ? (
            <div style={{ fontSize: 10, color: 'var(--accent-warning)', marginTop: 2 }}>
              {unmappedCount} need GPS
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {unmappedCount > 0 ? (
            <button
              className="btn btn--secondary btn--sm"
              onClick={handleGenerateMissingGps}
              disabled={isGeneratingGps}
              title="Auto-generate GPS coordinates for unmapped sections from TxDOT API"
            >
              {isGeneratingGps ? (
                <span>📍 {gpsProgress?.current}/{gpsProgress?.total}</span>
              ) : (
                <span>📍 Gen GPS</span>
              )}
            </button>
          ) : null}

          <button
            className="btn btn--secondary btn--sm"
            onClick={handleUploadClick}
            title="Import sections from CSV or Excel"
          >
            ↑ CSV
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={() => setShowAddModal(true)}
            title="Add section manually"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Sections List */}
      <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 16 }}>
        {sections.length === 0 ? (
          <div style={{ padding: '16px 14px', color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic', lineHeight: 1.5 }}>
            No sections yet. Click &ldquo;↑ CSV&rdquo; to import or &ldquo;+ Add&rdquo; to create manually.
          </div>
        ) : (
          sections.map(section => {
            const isSelected = selectedSectionId === section.id;
            const parsed = parseSpecificHighway(section.highway);
            const roadbed = parsed ? parsed.roadbed : 'other';
            const hasGps = section.coordinates?.status === 'success' && section.coordinates.begin;
            const captureCount = section.captures?.length || 0;

            return (
              <div
                key={section._uuid || section.id}
                className={`section-item ${isSelected ? 'section-item--active' : ''}`}
                onClick={() => onSelect(section.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                  <span className={`section-item__badge section-item__badge--${roadbed}`}>
                    {roadbed}
                  </span>

                  <div className="section-item__info">
                    <div className="section-item__highway">
                      {section.id} — {section.highway || '—'}
                    </div>
                    <div className="section-item__meta">
                      {typeof section.beginRef === 'number' ? section.beginRef.toFixed(1) : section.beginRef}
                      –
                      {typeof section.endRef === 'number' ? section.endRef.toFixed(1) : section.endRef} mi
                      {section.district ? ` · ${section.district}` : ''}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  {captureCount > 0 && (
                    <span
                      style={{
                        background: 'rgba(59, 130, 246, 0.2)',
                        color: 'var(--accent-primary)',
                        padding: '1px 5px',
                        borderRadius: 'var(--radius-full)',
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                      title={`${captureCount} distress captures`}
                    >
                      📸 {captureCount}
                    </span>
                  )}

                  {!hasGps && (
                    <span
                      title="No GPS coordinates yet. Click 'Gen GPS' above."
                      style={{ fontSize: 12, color: 'var(--accent-warning)', cursor: 'help' }}
                    >
                      ⚠️
                    </span>
                  )}

                  <button
                    className="btn btn--ghost btn--icon-sm"
                    title="Edit section"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingSection(section);
                    }}
                  >
                    ✏️
                  </button>

                  <button
                    className="btn btn--ghost btn--icon-sm"
                    title="Delete section"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete section "${section.id}"?`)) {
                        onDelete(section.id);
                      }
                    }}
                    style={{ color: '#dc2626' }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showCsvModal && (
        <ColumnMappingModal
          csvHeaders={csvHeaders}
          csvRows={csvRows}
          onImport={(imported, mode) => {
            onAddSections(imported, mode);
            setShowCsvModal(false);
          }}
          onCancel={() => setShowCsvModal(false)}
        />
      )}

      {showAddModal && (
        <AddSectionModal
          existingIds={new Set(sections.map(s => s.id))}
          onAdd={(sec) => {
            onAddSections([sec], 'merge');
            setShowAddModal(false);
          }}
          onCancel={() => setShowAddModal(false)}
        />
      )}

      {editingSection && (
        <AddSectionModal
          initialData={editingSection}
          existingIds={new Set(sections.map(s => s.id))}
          onSave={(updated) => {
            onUpdateSection(updated);
            setEditingSection(null);
          }}
          onCancel={() => setEditingSection(null)}
        />
      )}
    </div>
  );
}
