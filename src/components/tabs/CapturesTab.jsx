/**
 * CapturesTab.jsx
 * Gallery and inspection log for all recorded distress captures.
 */
import React, { useState, useMemo } from 'react';
import { downloadCapturesCSV, downloadCapturesZip } from '../../utils/projectStore';
import CaptureDetailModal from '../modals/CaptureDetailModal';

export default function CapturesTab({
  project,
  sections = [],
  selectedSectionId,
  onSelectSection,
  onUpdateSection,
  addToast,
}) {
  const [filterSectionId, setFilterSectionId] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('gallery'); // 'gallery' | 'table'
  const [inspectCapture, setInspectCapture] = useState(null);
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(null);

  // Flatten all captures with section metadata
  const allCaptures = useMemo(() => {
    const list = [];
    sections.forEach(s => {
      if (Array.isArray(s.captures)) {
        s.captures.forEach(c => {
          list.push({ ...c, section: s });
        });
      }
    });
    return list.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  }, [sections]);

  // Filtered captures
  const filteredCaptures = useMemo(() => {
    return allCaptures.filter(c => {
      if (filterSectionId !== 'all' && c.sectionId !== filterSectionId) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesType = c.distressType?.toLowerCase().includes(term);
        const matchesSec = c.sectionId?.toLowerCase().includes(term);
        const matchesHwy = c.section?.highway?.toLowerCase().includes(term);
        const matchesNotes = c.notes?.toLowerCase().includes(term);
        if (!matchesType && !matchesSec && !matchesHwy && !matchesNotes) return false;
      }
      return true;
    });
  }, [allCaptures, filterSectionId, searchTerm]);

  // Statistics
  const totalCaptures = allCaptures.length;
  const uniqueDistresses = new Set(allCaptures.map(c => c.distressType)).size;

  function handleDeleteCapture(captureId, secId) {
    const sec = sections.find(s => s.id === secId);
    if (!sec) return;
    const nextCaptures = (sec.captures || []).filter(c => c.id !== captureId);
    onUpdateSection({ ...sec, captures: nextCaptures });
    addToast('success', 'Capture deleted', 'Distress capture was removed.');
  }

  async function handleExportZip() {
    if (allCaptures.length === 0) {
      addToast('info', 'No Captures', 'There are no captures to export.');
      return;
    }
    setIsZipping(true);
    try {
      await downloadCapturesZip(project, filterSectionId === 'all' ? null : filterSectionId, (p) => {
        setZipProgress(p);
      });
      addToast('success', 'ZIP Downloaded', 'Captures package downloaded with report and images.');
    } catch (err) {
      addToast('error', 'ZIP Failed', err.message);
    } finally {
      setIsZipping(false);
      setZipProgress(null);
    }
  }

  return (
    <div className="tab-pane" style={{ padding: 20, overflowY: 'auto' }}>
      {/* Summary Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            Distress Captures Gallery
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {totalCaptures} total distress captures recorded across {sections.length} sections
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => downloadCapturesCSV(project, filterSectionId === 'all' ? null : filterSectionId)}
            disabled={filteredCaptures.length === 0}
            title="Download captures as CSV summary report"
          >
            📊 Export CSV
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={handleExportZip}
            disabled={filteredCaptures.length === 0 || isZipping}
            title="Download all images and CSV report bundled in a ZIP file"
          >
            {isZipping ? <span>📦 Zipping {zipProgress?.current}/{zipProgress?.total}…</span> : <span>📦 Download ZIP Bundle</span>}
          </button>
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        background: 'var(--bg-surface)',
        padding: '10px 14px',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-default)',
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', gap: 10, flex: 1 }}>
          {/* Section filter */}
          <select
            className="form-select"
            style={{ width: 220 }}
            value={filterSectionId}
            onChange={e => setFilterSectionId(e.target.value)}
          >
            <option value="all">All Sections ({allCaptures.length} captures)</option>
            {sections.map(s => (
              <option key={s.id} value={s.id}>
                {s.id} — {s.highway} ({s.captures?.length || 0})
              </option>
            ))}
          </select>

          {/* Search text */}
          <input
            className="form-input"
            style={{ maxWidth: 300 }}
            placeholder="Search distress type, section, or notes..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        {/* View mode toggle */}
        <div className="segmented-group">
          <button
            type="button"
            className={`segmented-btn ${viewMode === 'gallery' ? 'segmented-btn--active' : ''}`}
            onClick={() => setViewMode('gallery')}
          >
            🖼️ Cards
          </button>
          <button
            type="button"
            className={`segmented-btn ${viewMode === 'table' ? 'segmented-btn--active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            📋 Table
          </button>
        </div>
      </div>

      {/* Empty State */}
      {filteredCaptures.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px dashed var(--border-default)',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📸</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No Captures Found</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 360, margin: '0 auto 16px' }}>
            Switch to the <strong>Map</strong> tab, enter Google Street View along any section, and click <strong>"Capture Distress"</strong>.
          </div>
        </div>
      )}

      {/* Gallery Cards View */}
      {viewMode === 'gallery' && filteredCaptures.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}>
          {filteredCaptures.map(c => (
            <div
              key={c.id}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onClick={() => setInspectCapture(c)}
            >
              {/* Snapshot thumbnail */}
              <div style={{ height: 180, background: '#000', position: 'relative', overflow: 'hidden' }}>
                {c.imageUrl ? (
                  <img
                    src={c.imageUrl}
                    alt={c.distressType}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                    No snapshot
                  </div>
                )}

                <div style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  background: 'rgba(0, 0, 0, 0.75)',
                  backdropFilter: 'blur(4px)',
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#fff',
                }}>
                  {c.sectionId}
                </div>

                <div style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  background: 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(4px)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#38bdf8',
                }}>
                  📅 {c.imageYear || (c.imageDate ? c.imageDate.slice(0, 4) : 'Year —')}
                </div>

                <div style={{
                  position: 'absolute',
                  bottom: 8,
                  right: 8,
                  background: '#0f172a',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#fff',
                }}>
                  +{c.distanceFromStartMiles?.toFixed(2)} mi
                </div>
              </div>

              {/* Card Body */}
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                  {c.distressType}
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {c.section?.highway} · RM {c.section?.beginRef}–{c.section?.endRef}
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {c.lat?.toFixed(5)}°, {c.lon?.toFixed(5)}°
                  {c.imageDate && <span style={{ marginLeft: 8, color: 'var(--accent-primary)', fontWeight: 600 }}>· {c.imageDate}</span>}
                </div>

                {c.notes && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    &ldquo;{c.notes}&rdquo;
                  </div>
                )}

                <div style={{ marginTop: 'auto', paddingTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', fontSize: 10, color: 'var(--text-muted)' }}>
                  <span>{new Date(c.capturedAt).toLocaleDateString()}</span>
                  <button
                    className="btn btn--ghost btn--icon-sm"
                    style={{ color: '#dc2626' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('Delete capture?')) {
                        handleDeleteCapture(c.id, c.sectionId);
                      }
                    }}
                    title="Delete capture"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && filteredCaptures.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '10px 14px' }}>Snapshot</th>
                <th style={{ padding: '10px 14px' }}>Section</th>
                <th style={{ padding: '10px 14px' }}>Highway</th>
                <th style={{ padding: '10px 14px' }}>Distress Type</th>
                <th style={{ padding: '10px 14px' }}>Imagery Year / Date</th>
                <th style={{ padding: '10px 14px' }}>Offset from Start</th>
                <th style={{ padding: '10px 14px' }}>Coordinates</th>
                <th style={{ padding: '10px 14px' }}>Logged At</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCaptures.map(c => (
                <tr
                  key={c.id}
                  style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                  onClick={() => setInspectCapture(c)}
                >
                  <td style={{ padding: '8px 14px' }}>
                    {c.imageUrl && (
                      <img
                        src={c.imageUrl}
                        alt=""
                        style={{ width: 44, height: 32, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                      />
                    )}
                  </td>
                  <td style={{ padding: '8px 14px', fontWeight: 600 }}>{c.sectionId}</td>
                  <td style={{ padding: '8px 14px' }}>{c.section?.highway}</td>
                  <td style={{ padding: '8px 14px', fontWeight: 600, color: 'var(--accent-primary)' }}>{c.distressType}</td>
                  <td style={{ padding: '8px 14px', fontWeight: 600, color: '#0284c7' }}>
                    {c.imageYear ? `${c.imageYear} ${c.imageDate ? `(${c.imageDate})` : ''}` : (c.imageDate || '—')}
                  </td>
                  <td style={{ padding: '8px 14px' }}>+{c.distanceFromStartMiles?.toFixed(2)} mi</td>
                  <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {c.lat?.toFixed(5)}, {c.lon?.toFixed(5)}
                  </td>
                  <td style={{ padding: '8px 14px', color: 'var(--text-muted)' }}>
                    {new Date(c.capturedAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                    <button
                      className="btn btn--ghost btn--icon-sm"
                      style={{ color: '#dc2626' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Delete capture?')) handleDeleteCapture(c.id, c.sectionId);
                      }}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Capture Detail Modal */}
      {inspectCapture && (
        <CaptureDetailModal
          capture={inspectCapture}
          section={inspectCapture.section || sections.find(s => s.id === inspectCapture.sectionId)}
          onUpdateCapture={(updated) => {
            const sec = sections.find(s => s.id === updated.sectionId);
            if (sec) {
              const nextCaptures = sec.captures.map(c => c.id === updated.id ? updated : c);
              onUpdateSection({ ...sec, captures: nextCaptures });
            }
          }}
          onDeleteCapture={(id) => {
            handleDeleteCapture(id, inspectCapture.sectionId);
          }}
          onClose={() => setInspectCapture(null)}
        />
      )}
    </div>
  );
}
