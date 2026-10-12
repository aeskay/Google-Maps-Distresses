/**
 * pmisParser.js
 * Parses the master TxDOT PMIS database CSV/XLSX (~168 MB) via PapaParse and builds
 * an in-memory Map<string, Array<Object>> for instant section condition score matching.
 *
 * Persisted in IndexedDB so it is loaded once and saved offline forever.
 */

import Papa from 'papaparse';
import { cleanDistrictString, normalizeHighway, parseSpecificHighway } from './normalizers';

export function parsePmisCSV(csvText, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const pmisMap = new Map();
    const yearSet = new Set();

    const lineCount = (csvText.match(/\n/g) || []).length;
    let rowsProcessed = 0;
    let colMap = null;

    Papa.parse(csvText, {
      header: true,
      encoding: 'latin1',
      skipEmptyLines: true,

      step: (result) => {
        rowsProcessed++;
        if (onProgress && rowsProcessed % 50000 === 0) {
          onProgress(Math.min(95, Math.round((rowsProcessed / lineCount) * 100)));
        }

        const row = result.data;
        if (!colMap) {
          const keys = Object.keys(row);
          const find = (keywords) => keys.find(k => keywords.some(kw => k.toUpperCase().includes(kw))) || keywords[0];

          const findHighwayCol = () => {
            const uKeys = keys.map(k => ({ raw: k, up: k.toUpperCase().replace(/[\s_-]+/g, ' ').trim() }));
            const m1 = uKeys.find(k => k.up.includes('SIGNED HWY') || k.up.includes('SIGNED HIGHWAY'));
            if (m1) return m1.raw;
            const m2 = uKeys.find(k => (k.up.includes('HIGHWAY') || k.up.includes('HWY')) && !k.up.includes('ROADBED ID'));
            if (m2) return m2.raw;
            return find(['SIGNED HWY AND ROADBED ID', 'HIGHWAY ROADBED', 'HWY', 'ROADBED']);
          };

          const findRoadbedIdCol = () => {
            const uKeys = keys.map(k => ({ raw: k, up: k.toUpperCase().replace(/[\s_-]+/g, ' ').trim() }));
            const m = uKeys.find(k => !k.up.includes('SIGNED') && (k.up === 'HIGHWAY ROADBED ID' || k.up === 'ROADBED ID' || k.up.includes('ROADBED ID')));
            return m ? m.raw : null;
          };

          colMap = {
            year: find(['FISCAL YEAR', 'YEAR', 'FY']),
            highway: findHighwayCol(),
            roadbedId: findRoadbedIdCol(),
            district: find(['RESPONSIBLE DISTRICT', 'DISTRICT', 'DIST']),
            beginTrm: find(['BEGINNING TRM NUMBER', 'BEG TRM', 'BEGIN TRM', 'BEGINNING TRM', 'BEGIN REF', 'START REF']),
            beginDisp: find(['BEGINNING TRM DISPLACEMENT', 'BEG TRM DISP', 'BEGIN DISP', 'BEG DISP']),
            endTrm: find(['ENDING TRM NUMBER', 'END TRM', 'ENDING TRM', 'END REF']),
            endDisp: find(['ENDING TRM DISPLACEMENT', 'END TRM DISP', 'END DISP']),
            distress: find(['DISTRESS SCORE', 'DISTRESS']),
            condition: find(['CONDITION SCORE', 'CONDITION']),
            ride: find(['RIDE SCORE', 'RIDE']),
            iri: find(['IRI SCORE', 'IRI']),
            punchouts: find(['PUNCHOUTS', 'PUNCH']),
            acpPatches: find(['ACP PATCHES', 'ACP PATCH']),
            pccPatches: find(['PCC PATCHES', 'PCC PATCH']),
            spalled: find(['SPALLED CRACKS', 'SPALLED']),
            aadt: find(['AADT CURRENT', 'AADT']),
          };
        }

        const year = parseInt(row[colMap.year], 10);
        if (isNaN(year) || year < 1900 || year > 2100) return;
        yearSet.add(year);

        const rawHighway = row[colMap.highway] || '';
        const parsedHwy = parseSpecificHighway(rawHighway);
        if (!parsedHwy) return;

        const rawDistrict = row[colMap.district] || '';
        const district = cleanDistrictString(rawDistrict);

        const rawRoadbed = colMap.roadbedId ? String(row[colMap.roadbedId] || '').trim().toUpperCase() : '';
        const roadbed = rawRoadbed.includes('R') ? 'R' : rawRoadbed.includes('L') ? 'L' : parsedHwy.roadbed || 'K';

        const beginTrm = parseFloat(row[colMap.beginTrm]) || 0;
        const beginDisp = parseFloat(row[colMap.beginDisp]) || 0;
        const endTrm = parseFloat(row[colMap.endTrm]) || 0;
        const endDisp = parseFloat(row[colMap.endDisp]) || 0;

        const record = {
          year,
          highway: `${parsedHwy.paddedRoute} ${roadbed}`,
          roadbed,
          district,
          beginRef: beginTrm + beginDisp,
          endRef: endTrm + endDisp,
          distressScore: parseFloat(row[colMap.distress]) || null,
          conditionScore: parseFloat(row[colMap.condition]) || null,
          rideScore: parseFloat(row[colMap.ride]) || null,
          iri: parseFloat(row[colMap.iri]) || null,
          punchouts: parseFloat(row[colMap.punchouts]) || 0,
          acpPatches: parseFloat(row[colMap.acpPatches]) || 0,
          pccPatches: parseFloat(row[colMap.pccPatches]) || 0,
          spalled: parseFloat(row[colMap.spalled]) || 0,
          aadt: parseFloat(row[colMap.aadt]) || null,
        };

        // Group by `${district}|${parsedHwy.paddedRoute} ${roadbed}`
        const primaryKey = `${district.toLowerCase()}|${parsedHwy.paddedRoute} ${roadbed}`.toUpperCase();
        if (!pmisMap.has(primaryKey)) {
          pmisMap.set(primaryKey, []);
        }
        pmisMap.get(primaryKey).push(record);
      },

      complete: () => {
        if (onProgress) onProgress(100);
        resolve({
          pmisMap,
          availableYears: Array.from(yearSet).sort((a, b) => b - a),
        });
      },

      error: (err) => {
        reject(err);
      },
    });
  });
}
