/**
 * excelExporter.js
 * Utility to export section PMIS condition and distress evaluation data to Excel (.xlsx).
 */

import * as XLSX from 'xlsx';
import { buildEvalData, buildDistressData, parseHighwayComponents } from './chartBuilder';
import { cleanDistrictString } from './normalizers';

function formatRef(val) {
  if (val === null || val === undefined || val === '') return '—';
  const num = parseFloat(val);
  return isNaN(num) ? String(val) : num.toFixed(3);
}

function roundVal(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return '';
  const factor = Math.pow(10, decimals);
  return Math.round(Number(val) * factor) / factor;
}

export function getSectionRoadbeds(pmisMap, section) {
  if (!pmisMap || !section) return [''];
  const { base } = parseHighwayComponents(section.highway);
  const districtKey = cleanDistrictString(section.district).toUpperCase().replace(/[\s-]+/g, '');
  const baseKey = `${districtKey}|${base}`;
  const beds = [];
  if (pmisMap.has(baseKey))          beds.push('');
  if (pmisMap.has(baseKey + 'R'))    beds.push('R');
  if (pmisMap.has(baseKey + 'L'))    beds.push('L');
  if (pmisMap.has(baseKey + 'K(R)')) beds.push('K(R)');
  if (pmisMap.has(baseKey + 'K(L)')) beds.push('K(L)');
  if (pmisMap.has(baseKey + 'K'))    beds.push('K');
  if (pmisMap.has(baseKey + 'A'))    beds.push('A');
  return beds.length > 0 ? beds : [''];
}

export function makeSafeSheetName(rawName) {
  let name = String(rawName || 'Section')
    .replace(/[\\/?*\[\]:]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  return name || 'Section';
}

export function buildSectionSheetAoa(section, pmisMap) {
  const roadbeds = getSectionRoadbeds(pmisMap, section);
  const actualRmStr = `${formatRef(section.beginRef)} – ${formatRef(section.endRef)}`;

  const row1 = [
    `ID: ${section.id ?? '—'}`,
    `Highway: ${section.highway ?? '—'}`,
    `District: ${section.district ?? '—'}`,
    `County: ${section.countyName ?? '—'}`,
    `RM (Actual): ${actualRmStr}`,
    `Yr Const: ${section.yearConstructed ?? '—'}`,
    `End of Life: ${section.endOfLife ?? '—'}`,
    `CSJ: ${section.csj ?? '—'}`,
    `S/N: ${section.sn ?? '—'}`,
  ];

  const row2 = [
    'Year',
    'Roadbed',
    'Condition Score',
    'Distress Score',
    'Ride Score',
    'Punchouts / mi',
    'ACP Patches / mi',
    'PCC Patches / mi',
    'Spalled Cracks / mi',
  ];

  const dataRows = [];

  for (const suffix of roadbeds) {
    const evalData = buildEvalData(pmisMap, section, suffix);
    const distData = buildDistressData(pmisMap, section, suffix);

    const yearSet = new Set([
      ...(evalData?.years || []),
      ...(distData?.years || []),
    ]);
    const years = Array.from(yearSet).sort((a, b) => a - b);

    const evalMap = new Map();
    if (evalData) {
      evalData.years.forEach((y, i) => {
        evalMap.set(y, {
          cond: evalData.conditionScore[i],
          dist: evalData.distressScore[i],
          ride: evalData.rideScore[i],
        });
      });
    }

    const distMap = new Map();
    if (distData) {
      distData.years.forEach((y, i) => {
        distMap.set(y, {
          punch: distData.punchPerMile[i],
          acp: distData.acpPerMile[i],
          pcc: distData.pccPerMile[i],
          spall: distData.spallPerMile[i],
        });
      });
    }

    for (const y of years) {
      const e = evalMap.get(y) || {};
      const d = distMap.get(y) || {};

      dataRows.push([
        y,
        suffix ? `Roadbed ${suffix}` : 'Single Roadbed',
        roundVal(e.cond, 1),
        roundVal(e.dist, 1),
        roundVal(e.ride, 2),
        roundVal(d.punch, 2),
        roundVal(d.acp, 2),
        roundVal(d.pcc, 2),
        roundVal(d.spall, 2),
      ]);
    }
  }

  if (dataRows.length === 0) {
    dataRows.push(['No PMIS data matched for this reference marker range', '', '', '', '', '', '', '', '']);
  }

  return [row1, row2, ...dataRows];
}

export function exportSectionToExcel(section, pmisMap) {
  if (!section) return;
  const wb = XLSX.utils.book_new();
  const aoa = buildSectionSheetAoa(section, pmisMap);
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws['!cols'] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 20 },
  ];

  const rawSheetName = `${section.id}_${section.highway}`;
  const sheetName = makeSafeSheetName(rawSheetName);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const safeFileName = `${section.id || 'section'}_${section.highway || 'PMIS'}_Data.xlsx`
    .replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, safeFileName);
}
