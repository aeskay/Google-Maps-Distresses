/**
 * ConditionTab.jsx
 * Displays Evaluation Scores (Chart A) and Distress Counts per Lane Mile (Chart B)
 * for the selected section using the TxDOT PMIS database.
 */
import React, { useMemo, useRef, useState } from 'react';
import PlotlyChart from '../PlotlyChart';
import { buildEvalData, buildDistressData, parseHighwayComponents } from '../../utils/chartBuilder';
import { cleanDistrictString, normalizeHighway } from '../../utils/normalizers';
import { cleanDistrictKey } from '../../utils/chartBuilder';
import { exportSectionToExcel } from '../../utils/excelExporter';

function formatRef(val) {
  if (val === null || val === undefined || val === '') return '—';
  const num = parseFloat(val);
  return isNaN(num) ? String(val) : num.toFixed(3);
}

function vline(x, color, label) {
  return {
    shape: {
      type: 'line', x0: x, x1: x, y0: 0, y1: 1, yref: 'paper',
      line: { color, width: 2.5, dash: 'dash' },
    },
    annotation: {
      x, yref: 'paper', y: 1.02, xanchor: 'center', yanchor: 'bottom',
      text: `<b>${label}</b>`, showarrow: false,
      font: { color, size: 11 },
    },
  };
}

function buildEvalLayout(section, years) {
  const lines = [];
  const yearConst = parseInt(section.yearConstructed, 10);
  const endOfLife = parseInt(section.endOfLife, 10);

  if (!isNaN(yearConst)) lines.push(vline(yearConst, '#050505', 'Construction Year'));
  if (!isNaN(endOfLife)) lines.push(vline(endOfLife, '#ef4444', 'End of Life'));

  const minYr = (years[0] ?? 1996);
  const maxYr = (years[years.length - 1] ?? 2024);

  return {
    template: 'plotly_white',
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { t: 45, b: 100, l: 75, r: 85 },
    height: 400,
    legend: {
      orientation: 'h', yanchor: 'top', y: -0.27, xanchor: 'center', x: 0.5,
      font: { size: 12 }, bordercolor: '#000', borderwidth: 1,
    },
    hovermode: 'x unified',
    barmode: 'group',
    xaxis: {
      title: { text: '<b>Year</b>', font: { size: 14 } },
      range: [minYr - 0.7, maxYr + 0.7],
      tickmode: 'linear', dtick: 1, tickangle: -45,
      tickfont: { size: 12 },
      showline: true, linewidth: 2, linecolor: '#000', mirror: true, ticks: 'inside',
    },
    yaxis: {
      title: { text: '<b>Average Score</b>', font: { size: 13 } },
      range: [0, 105],
      tickvals: Array.from({ length: 11 }, (_, i) => i * 10),
      tickfont: { size: 12 },
      showline: true, linewidth: 2, linecolor: '#000', mirror: true, ticks: 'inside',
    },
    yaxis2: {
      title: { text: '<b>Average Ride Score</b>', font: { size: 13, color: '#d62728' } },
      tickfont: { size: 12, color: '#d62728' },
      range: [0, 5.25], dtick: 0.5, tickformat: '.1f',
      overlaying: 'y', side: 'right',
      showgrid: false, showline: true, linewidth: 2, linecolor: '#000', ticks: 'inside',
    },
    shapes: lines.map(l => l.shape),
    annotations: lines.map(l => l.annotation),
  };
}

function buildDistLayout(section, distData) {
  const lines = [];
  const yearConst = parseInt(section.yearConstructed, 10);
  const endOfLife = parseInt(section.endOfLife, 10);

  if (!isNaN(yearConst)) lines.push(vline(yearConst, '#22c55e', 'Year Const.'));
  if (!isNaN(endOfLife)) lines.push(vline(endOfLife, '#ef4444', 'End of Life'));

  const { years, yMax, step } = distData;
  const minYr = years[0] ?? 1996;
  const maxYr = years[years.length - 1] ?? 2024;
  const tickCount = Math.round(yMax / step) + 1;
  const tickVals = Array.from({ length: tickCount }, (_, i) => i * step);

  return {
    template: 'plotly_white',
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { t: 45, b: 100, l: 85, r: 35 },
    height: 400,
    legend: {
      orientation: 'h', yanchor: 'top', y: -0.27, xanchor: 'center', x: 0.5,
      font: { size: 12 }, bordercolor: '#000', borderwidth: 1,
    },
    hovermode: 'x unified',
    barmode: 'group',
    xaxis: {
      title: { text: '<b>Year</b>', font: { size: 14 } },
      range: [minYr - 0.7, maxYr + 0.7],
      tickmode: 'linear', dtick: 1, tickangle: -45,
      tickfont: { size: 12 },
      showline: true, linewidth: 2, linecolor: '#000', mirror: true, ticks: 'inside',
    },
    yaxis: {
      title: { text: '<b>Avg. distress per lane mile</b>', font: { size: 13 } },
      range: [0, yMax],
      tickvals: tickVals,
      tickfont: { size: 12 },
      showline: true, linewidth: 2, linecolor: '#000', mirror: true, ticks: 'inside',
      gridcolor: '#dddddd',
    },
    shapes: lines.map(l => l.shape),
    annotations: lines.map(l => l.annotation),
  };
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

function RoadbedCharts({ section, pmisMap, suffix }) {
  const evalChartRef = useRef(null);
  const distChartRef = useRef(null);
  const [copiedEval, setCopiedEval] = useState(false);
  const [copiedDist, setCopiedDist] = useState(false);
  const [copyingEval, setCopyingEval] = useState(false);
  const [copyingDist, setCopyingDist] = useState(false);

  const handleCopyEval = async () => {
    if (!evalChartRef.current || copyingEval) return;
    try {
      setCopyingEval(true);
      await evalChartRef.current.copyImage();
      setCopiedEval(true);
      setTimeout(() => setCopiedEval(false), 2000);
    } catch (err) {
      alert('Could not copy image to clipboard: ' + (err.message || err));
    } finally {
      setCopyingEval(false);
    }
  };

  const handleCopyDist = async () => {
    if (!distChartRef.current || copyingDist) return;
    try {
      setCopyingDist(true);
      await distChartRef.current.copyImage();
      setCopiedDist(true);
      setTimeout(() => setCopiedDist(false), 2000);
    } catch (err) {
      alert('Could not copy image to clipboard: ' + (err.message || err));
    } finally {
      setCopyingDist(false);
    }
  };

  const evalData = useMemo(() => buildEvalData(pmisMap, section, suffix), [pmisMap, section, suffix]);
  const distData = useMemo(() => buildDistressData(pmisMap, section, suffix), [pmisMap, section, suffix]);

  if (!evalData && !distData) return null;

  const actualRangeStr = `${formatRef(section.beginRef)} – ${formatRef(section.endRef)}`;

  const evalPmisRangeStr = evalData?.pmisStartRef != null && evalData?.pmisEndRef != null
    ? `${formatRef(evalData.pmisStartRef)} – ${formatRef(evalData.pmisEndRef)}`
    : 'None (No matching PMIS data)';

  const distPmisRangeStr = distData?.pmisStartRef != null && distData?.pmisEndRef != null
    ? `${formatRef(distData.pmisStartRef)} – ${formatRef(distData.pmisEndRef)}`
    : 'None (No matching PMIS data)';

  const evalTraces = evalData ? [
    {
      type: 'bar', name: 'Distress Score',
      x: evalData.years, y: evalData.distressScore,
      marker: { color: '#1f77b4', line: { color: '#000', width: 0.8 } },
      hovertemplate: 'Year: %{x}<br>Distress: %{y:.1f}<extra></extra>',
    },
    {
      type: 'bar', name: 'Condition Score',
      x: evalData.years, y: evalData.conditionScore,
      marker: { color: '#2ca02c', line: { color: '#000', width: 0.8 } },
      opacity: 0.85,
      hovertemplate: 'Year: %{x}<br>Condition: %{y:.1f}<extra></extra>',
    },
    {
      type: 'scatter', name: 'Ride Score', yaxis: 'y2',
      x: evalData.years, y: evalData.rideScore,
      mode: 'lines+markers',
      marker: { symbol: 'diamond', size: 9, color: '#d62728' },
      line: { color: '#d62728', width: 2.5 },
      hovertemplate: 'Year: %{x}<br>Ride: %{y:.2f}<extra></extra>',
    },
  ] : [];

  const distTraces = distData ? [
    { type: 'bar', name: 'Punchouts',      x: distData.years, y: distData.punchPerMile, marker: { color: '#d62728', line: { color: '#000', width: 0.8 } }, hovertemplate: '<b>Punchouts</b>: %{y:.2f}/mi<extra></extra>' },
    { type: 'bar', name: 'ACP Patches',    x: distData.years, y: distData.acpPerMile,   marker: { color: '#1f77b4', line: { color: '#000', width: 0.8 } }, hovertemplate: '<b>ACP Patches</b>: %{y:.2f}/mi<extra></extra>' },
    { type: 'bar', name: 'PCC Patches',    x: distData.years, y: distData.pccPerMile,   marker: { color: '#555555', line: { color: '#000', width: 0.8 } }, hovertemplate: '<b>PCC Patches</b>: %{y:.2f}/mi<extra></extra>' },
    { type: 'bar', name: 'Spalled Cracks', x: distData.years, y: distData.spallPerMile, marker: { color: '#ff7f0e', line: { color: '#000', width: 0.8 } }, hovertemplate: '<b>Spalled Cracks</b>: %{y:.2f}/mi<extra></extra>' },
  ] : [];

  const evalLayout = evalData ? buildEvalLayout(section, evalData.years) : null;
  const distLayout = distData ? buildDistLayout(section, distData) : null;

  const titleSuffix = suffix ? ` (Roadbed ${suffix})` : '';

  return (
    <div style={{ marginTop: '24px' }}>
      <h3 style={{ borderBottom: '1px solid var(--border-default)', paddingBottom: '8px', marginBottom: '16px', fontSize: 16, fontWeight: 700 }}>
        Roadbed {suffix || 'Data'}
      </h3>

      {/* Chart A — Evaluation Scores */}
      <div className="chart-panel">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <div>
            <div className="chart-panel__title">Evaluation Scores{titleSuffix}</div>
            <div className="chart-panel__sub" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
              <span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>RM (Actual):</span>{' '}
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{actualRangeStr}</span>
              </span>
              <span style={{ color: 'var(--border-strong)' }}>·</span>
              <span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>RM (PMIS):</span>{' '}
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-primary)' }}>{evalPmisRangeStr}</span>
              </span>
            </div>
          </div>
          {evalTraces.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <button
                className="btn btn--secondary btn--sm"
                onClick={handleCopyEval}
                disabled={copyingEval}
                title="Copy chart image to clipboard (paste directly into PowerPoint / Word)"
                style={{ gap: 5, fontSize: '12px' }}
              >
                <span>{copiedEval ? '✓' : copyingEval ? '⏳' : '📋'}</span>
                <span>{copiedEval ? 'Copied!' : copyingEval ? 'Copying…' : 'Copy Image'}</span>
              </button>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => evalChartRef.current?.download()}
                title="Download chart as PNG"
                style={{ gap: 5, fontSize: '12px' }}
              >
                <span>📷</span> Download PNG
              </button>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => exportSectionToExcel(section, pmisMap)}
                title="Export this section's evaluation and distress data to Excel (.xlsx)"
                style={{ gap: 5, fontSize: '12px' }}
              >
                <span>📥</span> Export Excel
              </button>
            </div>
          )}
        </div>
        {evalTraces.length > 0 ? (
          <PlotlyChart
            ref={evalChartRef}
            data={evalTraces}
            layout={evalLayout}
            filename={`eval_${section.id}_${section.highway}${suffix}`}
          />
        ) : (
          <div className="empty-state" style={{ padding: '32px 0' }}>
            <div className="empty-state__icon">🔍</div>
            <p className="empty-state__desc">No PMIS evaluation data found for this roadbed's reference marker range.</p>
          </div>
        )}
      </div>

      {/* Chart B — Distress Counts */}
      <div className="chart-panel">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <div>
            <div className="chart-panel__title">Distress Counts per Lane Mile{titleSuffix}</div>
            <div className="chart-panel__sub" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
              <span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>RM (Actual):</span>{' '}
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{actualRangeStr}</span>
              </span>
              <span style={{ color: 'var(--border-strong)' }}>·</span>
              <span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>RM (PMIS):</span>{' '}
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-primary)' }}>{distPmisRangeStr}</span>
              </span>
            </div>
          </div>
          {distTraces.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <button
                className="btn btn--secondary btn--sm"
                onClick={handleCopyDist}
                disabled={copyingDist}
                title="Copy chart image to clipboard (paste directly into PowerPoint / Word)"
                style={{ gap: 5, fontSize: '12px' }}
              >
                <span>{copiedDist ? '✓' : copyingDist ? '⏳' : '📋'}</span>
                <span>{copiedDist ? 'Copied!' : copyingDist ? 'Copying…' : 'Copy Image'}</span>
              </button>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => distChartRef.current?.download()}
                title="Download chart as PNG"
                style={{ gap: 5, fontSize: '12px' }}
              >
                <span>📷</span> Download PNG
              </button>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => exportSectionToExcel(section, pmisMap)}
                title="Export this section's evaluation and distress data to Excel (.xlsx)"
                style={{ gap: 5, fontSize: '12px' }}
              >
                <span>📥</span> Export Excel
              </button>
            </div>
          )}
        </div>
        {distTraces.length > 0 ? (
          <PlotlyChart
            ref={distChartRef}
            data={distTraces}
            layout={distLayout}
            filename={`distress_${section.id}_${section.highway}${suffix}`}
          />
        ) : (
          <div className="empty-state" style={{ padding: '32px 0' }}>
            <div className="empty-state__icon">🔍</div>
            <p className="empty-state__desc">No PMIS distress data found for this roadbed's reference marker range.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConditionTab({ section, pmisMap, pmisLoading, pmisProgress }) {
  const roadbeds = useMemo(() => {
    if (!pmisMap || !section) return [];
    const { base } = parseHighwayComponents(section.highway);
    const distKey = cleanDistrictKey(section.district);
    const baseKey = `${distKey}|${base}`;
    const beds = [];

    // Check all standard PMIS roadbed variants
    const checkBeds = ['', 'R', 'L', 'K(R)', 'K(L)', 'K', 'A'];
    for (const b of checkBeds) {
      if (pmisMap.has(baseKey + b) || pmisMap.has(`${cleanDistrictString(section.district).toUpperCase()}|${base}${b}`)) {
        beds.push(b);
      }
    }

    // If section explicitly specifies roadbed e.g. "IH0030-KG" or "IH 30 R", ensure that bed is checked
    const norm = normalizeHighway(section.highway);
    const m = norm.match(/([RLKA])$/);
    if (m && !beds.includes(m[1])) {
      beds.push(m[1]);
    }

    return beds.length > 0 ? beds : [''];
  }, [pmisMap, section]);

  // ── Empty & Loading states ──────────────────────────────────────────────────
  if (!pmisMap && !pmisLoading) {
    return (
      <div className="tab-pane" style={{ alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div className="empty-state" style={{ maxWidth: 460 }}>
          <div className="empty-state__icon" style={{ fontSize: 44, marginBottom: 8 }}>📂</div>
          <h2 className="empty-state__title" style={{ fontSize: 18, marginBottom: 6 }}>No PMIS Database Loaded</h2>
          <p className="empty-state__desc" style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Upload your TxDOT PMIS master file (.csv or .xlsx) using the <strong>PMIS Database</strong> button in the left sidebar to enable pavement condition charting.
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
          <p style={{ marginTop: 12, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Parsing PMIS Database… {pmisProgress}%
          </p>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Matching reference markers and historical evaluations
          </span>
        </div>
      </div>
    );
  }

  if (!section) {
    return (
      <div className="tab-pane" style={{ alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div className="empty-state">
          <div className="empty-state__icon" style={{ fontSize: 44, marginBottom: 8 }}>👈</div>
          <h2 className="empty-state__title" style={{ fontSize: 18, marginBottom: 6 }}>No Section Selected</h2>
          <p className="empty-state__desc" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Select a highway section from the sidebar to view its historical PMIS condition and distress charts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-pane" style={{ flexDirection: 'column', overflowY: 'auto', padding: '20px 24px' }}>
      {/* Section info cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <InfoCard label="ID"        value={section.id} />
        <InfoCard label="S/N"       value={section.sn} />
        <InfoCard label="Highway"   value={section.highway} accent="var(--accent-primary)" />
        <InfoCard label="District"  value={section.district} />
        <InfoCard label="Begin Ref" value={typeof section.beginRef === 'number' ? section.beginRef.toFixed(3) : section.beginRef} />
        <InfoCard label="End Ref"   value={typeof section.endRef   === 'number' ? section.endRef.toFixed(3)   : section.endRef} />
        <InfoCard label="Yr. Const."  value={section.yearConstructed} accent="#10b981" />
        <InfoCard label="End of Life" value={section.endOfLife}        accent="#ef4444" />
        <InfoCard label="County"      value={section.countyName} />
        <InfoCard label="CSJ"         value={section.csj} accent="var(--accent-primary)" />
      </div>

      {roadbeds.length > 0 ? (
        roadbeds.map(suffix => (
          <RoadbedCharts key={suffix} section={section} pmisMap={pmisMap} suffix={suffix} />
        ))
      ) : (
        <div className="empty-state" style={{ padding: '32px 0' }}>
          <div className="empty-state__icon">🔍</div>
          <p className="empty-state__desc">
            No PMIS evaluation data found for this section's reference marker range.
          </p>
        </div>
      )}
    </div>
  );
}
