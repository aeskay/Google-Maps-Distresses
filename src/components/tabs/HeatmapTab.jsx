/**
 * HeatmapTab.jsx
 * Displays spatio-temporal PMIS Heatmap visualizations for a selected section across years
 * using TxDOT PMIS data (Condition Score, Distress Score, and Ride Score).
 */
import React, { useMemo, useState, useEffect, useRef } from 'react';
import PlotlyChart from '../PlotlyChart';
import { buildHeatmapData, parseHighwayComponents, cleanDistrictKey } from '../../utils/chartBuilder';
import { cleanDistrictString, normalizeHighway, formatDistrictDisplay, formatSlabThicknessDisplay } from '../../utils/normalizers';

const METRICS = [
  { id: 'conditionScore', label: 'Condition Score', zmin: 0, zmax: 100 },
  { id: 'distressScore',  label: 'Distress Score',  zmin: 0, zmax: 100 },
  { id: 'rideScore',      label: 'Ride Score',      zmin: 0, zmax: 5 },
];

const CONDITION_COLORS = [
  [0.0, '#ef4444'], [0.35, '#ef4444'],
  [0.35, '#f97316'], [0.50, '#f97316'],
  [0.50, '#facc15'], [0.70, '#facc15'],
  [0.70, '#4ade80'], [0.90, '#4ade80'],
  [0.90, '#166534'], [1.0, '#166534'],
];

const DISTRESS_COLORS = [
  [0.0, '#ef4444'], [0.60, '#ef4444'],
  [0.60, '#f97316'], [0.70, '#f97316'],
  [0.70, '#facc15'], [0.80, '#facc15'],
  [0.80, '#4ade80'], [0.90, '#4ade80'],
  [0.90, '#166534'], [1.0, '#166534'],
];

const RIDE_COLORS = [
  [0.0, '#ef4444'], [0.40, '#ef4444'],
  [0.40, '#f97316'], [0.60, '#f97316'],
  [0.60, '#facc15'], [0.80, '#facc15'],
  [0.80, '#4ade80'], [0.90, '#4ade80'],
  [0.90, '#166534'], [1.0, '#166534'],
];

function formatRef(val) {
  if (val === null || val === undefined || val === '') return '—';
  const num = parseFloat(val);
  return isNaN(num) ? String(val) : num.toFixed(3);
}

function InfoCard({ label, value, accent }) {
  return (
    <div style={{
      background: 'var(--bg-elevated, #f8fafc)',
      border: '1px solid var(--border-default, #e2e8f0)',
      borderRadius: 'var(--radius-md, 8px)',
      padding: '8px 14px',
      flex: '1 1 110px',
      minWidth: 90,
      maxWidth: '20%',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{
        fontWeight: 700,
        fontSize: 'var(--text-sm, 13px)',
        color: accent || 'var(--text-primary, #0f172a)',
        fontFamily: 'var(--font-mono, monospace)',
        wordBreak: 'break-word',
      }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

export default function HeatmapTab({ section, pmisMap, pmisLoading, pmisProgress }) {
  const chartRef = useRef(null);
  const [metricId, setMetricId] = useState('conditionScore');
  const [roadbed, setRoadbed] = useState('');
  const [copiedImage, setCopiedImage] = useState(false);
  const [copyingImage, setCopyingImage] = useState(false);

  // Detect available roadbeds for the selected section
  const availableRoadbeds = useMemo(() => {
    if (!pmisMap || !section) return [];
    const { base } = parseHighwayComponents(section.highway);
    const distKey = cleanDistrictKey(section.district);
    const baseKey = `${distKey}|${base}`;
    const cleanDist = cleanDistrictString(section.district).toUpperCase();
    const beds = [];

    const checkBeds = [
      { label: 'Main / None', val: '' },
      { label: 'R (Right / East / North)', val: 'R' },
      { label: 'L (Left / West / South)', val: 'L' },
      { label: 'K(R)', val: 'K(R)' },
      { label: 'K(L)', val: 'K(L)' },
      { label: 'K', val: 'K' },
      { label: 'A', val: 'A' },
    ];

    for (const b of checkBeds) {
      if (
        pmisMap.has(baseKey + b.val) ||
        pmisMap.has(`${cleanDist}|${base}${b.val}`)
      ) {
        beds.push(b);
      }
    }

    // Check if section has an explicit roadbed code
    const norm = normalizeHighway(section.highway);
    const m = norm.match(/([RLKA])$/);
    if (m && !beds.some(b => b.val === m[1])) {
      beds.push({ label: m[1], val: m[1] });
    }

    return beds.length > 0 ? beds : [{ label: 'Main', val: '' }];
  }, [pmisMap, section]);

  // Sync selected roadbed when availableRoadbeds changes
  useEffect(() => {
    if (availableRoadbeds.length > 0) {
      if (!availableRoadbeds.some(b => b.val === roadbed)) {
        setRoadbed(availableRoadbeds[0].val);
      }
    }
  }, [availableRoadbeds, roadbed]);

  const metric = METRICS.find(m => m.id === metricId) || METRICS[0];

  const data = useMemo(() => {
    if (!section || !pmisMap || availableRoadbeds.length === 0) return null;
    return buildHeatmapData(pmisMap, section, metricId, roadbed);
  }, [pmisMap, section, metricId, roadbed, availableRoadbeds]);

  async function handleCopyChart() {
    if (!chartRef.current) return;
    setCopyingImage(true);
    try {
      const success = await chartRef.current.copy();
      if (success) {
        setCopiedImage(true);
        setTimeout(() => setCopiedImage(false), 2200);
      }
    } finally {
      setCopyingImage(false);
    }
  }

  // ── Empty & Loading states ──────────────────────────────────────────────────
  if (!pmisMap && !pmisLoading) {
    return (
      <div className="tab-pane" style={{ alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div className="empty-state" style={{ maxWidth: 460 }}>
          <div className="empty-state__icon" style={{ fontSize: 44, marginBottom: 8 }}>📂</div>
          <h2 className="empty-state__title" style={{ fontSize: 18, marginBottom: 6 }}>No PMIS Database Loaded</h2>
          <p className="empty-state__desc" style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Upload your TxDOT PMIS master file (.csv or .xlsx) using the <strong>PMIS Database</strong> button in the left sidebar to enable spatial heatmaps.
          </p>
        </div>
      </div>
    );
  }

  if (pmisLoading) {
    return (
      <div className="tab-pane" style={{ alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div className="loading-state">
          <div className="loading-bar-track" style={{ width: 320, height: 6, background: 'var(--border-default)', borderRadius: 99, overflow: 'hidden' }}>
            <div
              className="loading-bar-fill"
              style={{
                width: `${pmisProgress}%`,
                height: '100%',
                background: 'var(--accent-primary)',
                transition: 'width 0.2s ease',
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
            Parsing PMIS records… {pmisProgress}%
          </div>
        </div>
      </div>
    );
  }

  if (!section) {
    return (
      <div className="tab-pane" style={{ alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div className="empty-state" style={{ maxWidth: 420 }}>
          <div className="empty-state__icon" style={{ fontSize: 44, marginBottom: 8 }}>👆</div>
          <h2 className="empty-state__title" style={{ fontSize: 18, marginBottom: 6 }}>No Section Selected</h2>
          <p className="empty-state__desc" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Select an inspection section from the sidebar to inspect its multi-year PMIS heatmaps.
          </p>
        </div>
      </div>
    );
  }

  const colorscale =
    metricId === 'rideScore'
      ? RIDE_COLORS
      : metricId === 'distressScore'
      ? DISTRESS_COLORS
      : CONDITION_COLORS;

  const tickvals =
    metricId === 'rideScore'
      ? [0, 1, 2, 3, 4, 5]
      : metricId === 'distressScore'
      ? [0, 60, 70, 80, 90, 100]
      : [0, 35, 50, 70, 90, 100];

  const ticktext =
    metricId === 'rideScore'
      ? ['0.0 (Very Poor)', '1.0 (Poor)', '2.0 (Fair)', '3.0 (Good)', '4.0', '5.0 (Very Good)']
      : metricId === 'distressScore'
      ? ['0 (Very Poor)', '60 (Poor)', '70 (Fair)', '80 (Good)', '90', '100 (Very Good)']
      : ['0 (Very Poor)', '35 (Poor)', '50 (Fair)', '70 (Good)', '90', '100 (Very Good)'];

  const chartData = data ? [{
    type: 'heatmap',
    x: data.x,
    y: data.y,
    z: data.z,
    colorscale,
    zmin: metric.zmin,
    zmax: metric.zmax,
    hoverongaps: false,
    xgap: 1,
    ygap: 1,
    hovertemplate: '<b>Fiscal Year:</b> %{y}<br><b>Ref Marker:</b> %{x:.3f}<br><b>' + metric.label + ':</b> %{z:.1f}<extra></extra>',
    colorbar: {
      title: {
        text: `<b>${metric.label}</b>`,
        font: { size: 12, color: '#0f172a' },
      },
      tickmode: 'array',
      tickvals,
      ticktext,
      ticks: 'outside',
      tickwidth: 1.5,
      ticklen: 6,
      len: 0.95,
      thickness: 16,
    },
  }] : [];

  const layout = {
    template: 'plotly_white',
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { t: 30, b: 65, l: 65, r: 40 },
    height: 520,
    xaxis: {
      title: { text: '<b>Reference Marker</b>', font: { size: 13, color: '#0f172a' } },
      tickmode: 'linear',
      dtick: 1,
      showline: true,
      linewidth: 1.5,
      linecolor: '#64748b',
      mirror: true,
      ticks: 'inside',
      gridcolor: '#e2e8f0',
    },
    yaxis: {
      title: { text: '<b>Fiscal Year</b>', font: { size: 13, color: '#0f172a' } },
      type: 'category',
      showline: true,
      linewidth: 1.5,
      linecolor: '#64748b',
      mirror: true,
      ticks: 'inside',
      gridcolor: '#e2e8f0',
    },
  };

  const actualRangeStr = `${formatRef(section.beginRef)} – ${formatRef(section.endRef)}`;

  return (
    <div className="tab-pane" style={{ padding: 20, overflowY: 'auto' }}>
      {/* Section Header Info Cards */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 16,
        background: 'var(--bg-surface, #ffffff)',
        padding: 14,
        borderRadius: 'var(--radius-lg, 12px)',
        border: '1px solid var(--border-default, #e2e8f0)',
      }}>
        <InfoCard label="Section" value={section.id} accent="var(--accent-primary, #0ea5e9)" />
        <InfoCard label="Highway" value={section.highway} />
        <InfoCard label="County" value={section.countyName || section.county || '—'} />
        <InfoCard label="District" value={formatDistrictDisplay(section.district)} />
        <InfoCard label="Reference Limits" value={actualRangeStr} />
        <InfoCard label="Slab Thickness" value={formatSlabThicknessDisplay(section.slabThickness)} />
      </div>

      {/* Main Heatmap Card */}
      <div className="chart-panel" style={{ background: 'var(--bg-surface, #ffffff)', border: '1px solid var(--border-default, #e2e8f0)', borderRadius: 'var(--radius-lg, 12px)', padding: 18 }}>
        {/* Toolbar & Selector Header */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                🔥 PMIS Heatmap — <span style={{ color: 'var(--accent-primary)' }}>{metric.label}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                Spatial condition tracking across reference markers ({actualRangeStr}) by fiscal year
              </div>
            </div>

            {/* Metric Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Metric:</label>
              <select
                className="form-select"
                value={metricId}
                onChange={e => setMetricId(e.target.value)}
                style={{ fontSize: 12, padding: '4px 8px', borderRadius: 'var(--radius-sm, 6px)', minWidth: 150 }}
              >
                {METRICS.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Roadbed Selector */}
            {availableRoadbeds.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Roadbed:</label>
                <select
                  className="form-select"
                  value={roadbed}
                  onChange={e => setRoadbed(e.target.value)}
                  style={{ fontSize: 12, padding: '4px 8px', borderRadius: 'var(--radius-sm, 6px)', minWidth: 110 }}
                >
                  {availableRoadbeds.map(b => (
                    <option key={b.val} value={b.val}>{b.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={handleCopyChart}
              disabled={copyingImage || !data}
              title="Copy heatmap to clipboard"
              style={{ gap: 5, fontSize: 12 }}
            >
              <span>{copiedImage ? '✓' : copyingImage ? '⏳' : '📋'}</span>
              <span>{copiedImage ? 'Copied!' : copyingImage ? 'Copying…' : 'Copy Image'}</span>
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => chartRef.current?.download(`${section.id}_heatmap_${metricId}`)}
              disabled={!data}
              title="Download heatmap as PNG"
              style={{ gap: 5, fontSize: 12 }}
            >
              <span>📷</span>
              <span>Download PNG</span>
            </button>
          </div>
        </div>

        {/* Heatmap Plot */}
        {!data ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
              No PMIS Records Found for this Section Range
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              No overlapping PMIS data was matched for {section.highway} ({actualRangeStr}) in district {cleanDistrictString(section.district)}.
            </div>
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border-default, #e2e8f0)', borderRadius: 'var(--radius-md, 8px)', padding: 10, background: '#ffffff' }}>
            <PlotlyChart
              ref={chartRef}
              data={chartData}
              layout={layout}
              config={{ responsive: true, displaylogo: false }}
              filename={`${section.id}_${metricId}_heatmap`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
