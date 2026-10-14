/**
 * chartBuilder.js
 * Pure data-transformation helpers for building Plotly chart data.
 *
 * buildEvalData     — weighted-average Condition/Distress/Ride scores
 * buildDistressData — apportioned distress counts per centerline mile
 */

import { cleanDistrictString, normalizeHighway, parseHighwayComponents, parseSpecificHighway } from './normalizers';

export { parseHighwayComponents };

/**
 * Normalizes district to clean uppercase string with no leading numbers or spaces.
 * Example: '02 - FORT WORTH' or 'Fort Worth' -> 'FORTWORTH'
 */
export function cleanDistrictKey(val) {
  if (val === null || val === undefined) return '';
  let s = String(val).toUpperCase().trim();
  s = s.replace(/^[0-9\s-]+/, ''); // remove leading numbers and dashes
  s = s.replace(/\s+/g, '');        // remove all internal spaces
  return s;
}

/**
 * Get all PMIS records that spatially overlap the section's reference range.
 * Supports both PMIS Charts Generator key format and Google Maps Distresses legacy key format.
 */
export function getOverlapping(pmisMap, section, suffix = '') {
  if (!pmisMap || !section) return [];

  const start = parseFloat(section.beginRef);
  const end = parseFloat(section.endRef);
  if (isNaN(start) || isNaN(end)) return [];

  const distKey = cleanDistrictKey(section.district);
  const { base, explicitSuffix } = parseHighwayComponents(section.highway);
  const finalSuffix = suffix || explicitSuffix || '';

  // Candidates for lookup key
  const candidates = [
    `${distKey}|${base}${finalSuffix}`,
    `${distKey}|${base}`,
    `${distKey}|${section.highway}`,
    `${cleanDistrictString(section.district).toUpperCase()}|${base}${finalSuffix}`,
  ];

  const parsed = parseSpecificHighway(section.highway);
  if (parsed) {
    candidates.push(`${distKey}|${parsed.paddedRoute} ${finalSuffix || parsed.roadbed || 'K'}`);
    candidates.push(`${cleanDistrictString(section.district).toUpperCase()}|${parsed.paddedRoute} ${finalSuffix || parsed.roadbed || 'K'}`);
  }

  let mapData = null;
  for (const k of candidates) {
    if (pmisMap.has(k)) {
      mapData = pmisMap.get(k);
      break;
    }
  }

  if (!mapData || !Array.isArray(mapData)) return [];

  return mapData.filter(p => {
    const pStart = p.startRef ?? p.beginRef;
    const pEnd = p.endRef;
    return typeof pStart === 'number' && typeof pEnd === 'number' && pStart < end && pEnd > start;
  });
}

/**
 * Picks the smallest "nice" step such that there are ~7 ticks on the axis.
 */
export function niceTickStep(maxVal) {
  if (!maxVal || maxVal <= 0) return 1;
  const roughStep = maxVal / 7;
  const niceSteps = [
    0.1, 0.2, 0.25, 0.5,
    1, 2, 2.5, 5,
    10, 20, 25, 50,
    100, 200, 250, 500,
    1000, 2000, 5000,
  ];
  for (const s of niceSteps) {
    if (s >= roughStep) return s;
  }
  return 5000;
}

// ─── Chart 1: Evaluation Scores ──────────────────────────────────────────────

/**
 * Build weighted-average evaluation score data for a single section.
 */
export function buildEvalData(pmisMap, section, suffix = '') {
  const records = getOverlapping(pmisMap, section, suffix);
  if (!records.length) return null;

  const start = parseFloat(section.beginRef);
  const end = parseFloat(section.endRef);
  const byYear = {};

  let pmisMinRef = Infinity;
  let pmisMaxRef = -Infinity;

  for (const p of records) {
    const pStart = p.startRef ?? p.beginRef;
    const pEnd = p.endRef;
    if (typeof pStart !== 'number' || typeof pEnd !== 'number') continue;

    if (!byYear[p.year]) {
      byYear[p.year] = {
        wDistress: 0, wCondition: 0, wRide: 0, wIri: 0,
        lenDistress: 0, lenCondition: 0, lenRide: 0, lenIri: 0,
      };
    }
    const y = byYear[p.year];

    const overlapStart = Math.max(start, pStart);
    const overlapEnd = Math.min(end, pEnd);
    const w = Math.max(0, overlapEnd - overlapStart);

    if (w > 0) {
      if (p.distressScore !== null && p.distressScore !== undefined) {
        y.wDistress += p.distressScore * w;
        y.lenDistress += w;
      }
      if (p.conditionScore !== null && p.conditionScore !== undefined) {
        y.wCondition += p.conditionScore * w;
        y.lenCondition += w;
      }
      if (p.rideScore !== null && p.rideScore !== undefined) {
        y.wRide += p.rideScore * w;
        y.lenRide += w;
      }
      if (p.iri !== null && p.iri !== undefined) {
        y.wIri += p.iri * w;
        y.lenIri += w;
      }

      if (pStart < pmisMinRef) pmisMinRef = pStart;
      if (pEnd > pmisMaxRef) pmisMaxRef = pEnd;
    }
  }

  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  if (!years.length) return null;

  return {
    years,
    distressScore: years.map(yr => byYear[yr].lenDistress > 0 ? byYear[yr].wDistress / byYear[yr].lenDistress : null),
    conditionScore: years.map(yr => byYear[yr].lenCondition > 0 ? byYear[yr].wCondition / byYear[yr].lenCondition : null),
    rideScore: years.map(yr => byYear[yr].lenRide > 0 ? byYear[yr].wRide / byYear[yr].lenRide : null),
    iriScore: years.map(yr => byYear[yr].lenIri > 0 ? byYear[yr].wIri / byYear[yr].lenIri : null),
    pmisStartRef: isFinite(pmisMinRef) ? pmisMinRef : null,
    pmisEndRef: isFinite(pmisMaxRef) ? pmisMaxRef : null,
  };
}

// ─── Chart 2: Distress Counts per Centerline Mile ────────────────────────────

/**
 * Build apportioned distress-count-per-mile data for a single section.
 */
export function buildDistressData(pmisMap, section, suffix = '') {
  const records = getOverlapping(pmisMap, section, suffix);
  if (!records.length) return null;

  const start = parseFloat(section.beginRef);
  const end = parseFloat(section.endRef);
  const byYear = {};

  let pmisMinRef = Infinity;
  let pmisMaxRef = -Infinity;

  for (const p of records) {
    const pStart = p.startRef ?? p.beginRef;
    const pEnd = p.endRef;
    if (typeof pStart !== 'number' || typeof pEnd !== 'number') continue;

    if (!byYear[p.year]) byYear[p.year] = { acp: 0, pcc: 0, punch: 0, spall: 0, len: 0 };
    const y = byYear[p.year];

    const overlapStart = Math.max(start, pStart);
    const overlapEnd = Math.min(end, pEnd);
    const w = Math.max(0, overlapEnd - overlapStart);

    if (w > 0) {
      const segLen = Math.max(0.001, pEnd - pStart);
      const ratio = w / segLen;
      y.acp += (p.acpPatches || 0) * ratio;
      y.pcc += (p.pccPatches || 0) * ratio;
      y.punch += (p.punchout || p.punchouts || 0) * ratio;
      y.spall += (p.spalledCracks || p.spalled || 0) * ratio;
      y.len += w;

      if (pStart < pmisMinRef) pmisMinRef = pStart;
      if (pEnd > pmisMaxRef) pmisMaxRef = pEnd;
    }
  }

  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  if (!years.length) return null;

  const safe = (n, d) => (d > 0 ? n / d : null);

  const acpPerMile = years.map(yr => safe(byYear[yr].acp, byYear[yr].len));
  const pccPerMile = years.map(yr => safe(byYear[yr].pcc, byYear[yr].len));
  const punchPerMile = years.map(yr => safe(byYear[yr].punch, byYear[yr].len));
  const spallPerMile = years.map(yr => safe(byYear[yr].spall, byYear[yr].len));

  const allVals = [...acpPerMile, ...pccPerMile, ...punchPerMile, ...spallPerMile].filter(v => v !== null);
  const maxVal = allVals.length ? Math.max(...allVals) : 0;
  const step = niceTickStep(maxVal);
  const yMax = Math.ceil((maxVal + step * 0.5) / step) * step;

  return {
    years,
    acpPerMile,
    pccPerMile,
    punchPerMile,
    spallPerMile,
    yMax,
    step,
    pmisStartRef: isFinite(pmisMinRef) ? pmisMinRef : null,
    pmisEndRef: isFinite(pmisMaxRef) ? pmisMaxRef : null,
  };
}
