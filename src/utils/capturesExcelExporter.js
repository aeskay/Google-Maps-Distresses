/**
 * capturesExcelExporter.js
 * Professional Excel (.xlsx) export utility for TxDOT Distress Captures using ExcelJS.
 *
 * Provides two primary export modes:
 * 1. exportSectionCapturesToExcel:
 *    Detailed export for a selected section where each row is an individual distress capture,
 *    complete with embedded in-cell snapshot photos and direct clickable Google Street View links.
 *
 * 2. exportGroupedSectionsSummaryToExcel:
 *    High-level project summary where each row is a section, with comma-separated recorded
 *    distresses in a single cell, allowing instant Excel filtering by distress type.
 */

import ExcelJS from 'exceljs/dist/exceljs.min.js';
import { calculateReferenceMarkerAtOffset } from './txdotGisApi';

/**
 * Builds direct Google Maps 360° Street View URL for a given capture.
 */
export function getStreetViewPanoUrl(capture) {
  if (!capture) return null;
  const heading = capture.heading ?? 0;
  const pitch = capture.pitch ?? 0;

  if (capture.panoId) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(capture.panoId)}&heading=${heading}&pitch=${pitch}&fov=90`;
  }

  if (capture.lat != null && capture.lon != null) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${capture.lat},${capture.lon}&heading=${heading}&pitch=${pitch}&fov=90`;
  }

  return null;
}

/**
 * Extracts base64 payload and image format extension ('png' | 'jpeg') from an image URL or data URI.
 */
async function getImagePayload(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;

  // Handle data URL (data:image/jpeg;base64,... or data:image/png;base64,...)
  if (imageUrl.startsWith('data:image/')) {
    const match = imageUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,/i);
    if (match) {
      let ext = match[1].toLowerCase();
      if (ext === 'jpg') ext = 'jpeg';
      const base64 = imageUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
      return { base64, extension: ext === 'png' ? 'png' : 'jpeg' };
    }
  }

  // Handle remote HTTP image URLs
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) return null;
      const blob = await response.blob();
      const ext = blob.type.includes('png') ? 'png' : 'jpeg';
      const arrayBuf = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return { base64: btoa(binary), extension: ext };
    } catch (err) {
      console.warn('Failed to load remote capture image for Excel embedding:', err);
      return null;
    }
  }

  return null;
}

/**
 * Triggers browser download of an ExcelJS workbook as an .xlsx file.
 */
async function downloadWorkbook(workbook, defaultFilename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = defaultFilename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * 1. Export captures for the SELECTED section with embedded in-cell images & Street View links.
 */
export async function exportSectionCapturesToExcel(section, project, onProgress = null) {
  if (!section) throw new Error('No section provided for export.');

  const captures = Array.isArray(section.captures) ? section.captures : [];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TxDOT Distress Capture & Studio';
  workbook.created = new Date();

  const safeSheetName = `Sec ${section.id || ''}`.slice(0, 31).trim() || 'Captures';
  const worksheet = workbook.addWorksheet(safeSheetName, {
    views: [{ showGridLines: true }],
  });

  // Section Metadata Banner (Rows 1 & 2)
  worksheet.mergeCells('A1:C1');
  worksheet.getCell('A1').value = `SECTION ${section.id || '—'} · ${section.highway || '—'}`;
  worksheet.getCell('A1').font = { size: 14, bold: true, color: { argb: 'FF0F172A' } };

  worksheet.mergeCells('D1:G1');
  worksheet.getCell('D1').value = `Project: ${project?.name || 'Roadway Study'}`;
  worksheet.getCell('D1').font = { size: 11, italic: true, color: { argb: 'FF475569' } };

  worksheet.mergeCells('H1:K1');
  worksheet.getCell('H1').value = `Exported: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  worksheet.getCell('H1').font = { size: 10, color: { argb: 'FF64748B' } };
  worksheet.getCell('H1').alignment = { horizontal: 'right' };

  // Row 2: Section Attributes
  const rmBegin = section.beginRef != null ? Number(section.beginRef).toFixed(3) : '—';
  const rmEnd = section.endRef != null ? Number(section.endRef).toFixed(3) : '—';
  const roadbed = section.coordinates?.roadbed || 'Mainlane';
  const dist = section.district || '—';
  const county = section.countyName || '—';

  worksheet.mergeCells('A2:K2');
  worksheet.getCell('A2').value = `District: ${dist}   |   County: ${county}   |   Roadbed: ${roadbed}   |   RM Limits: ${rmBegin} – ${rmEnd}   |   Recorded Captures: ${captures.length}`;
  worksheet.getCell('A2').font = { size: 10, bold: true, color: { argb: 'FF2563EB' } };
  worksheet.getCell('A2').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' },
  };
  worksheet.getRow(2).height = 22;

  // Empty separator row
  worksheet.getRow(3).height = 10;

  // Header Row (Row 4)
  const headers = [
    { header: '#', key: 'num', width: 6 },
    { header: 'Snapshot', key: 'snapshot', width: 22 },
    { header: 'Street View Link', key: 'link', width: 24 },
    { header: 'Distress Type', key: 'type', width: 24 },
    { header: 'Reference Marker (RM)', key: 'rm', width: 22 },
    { header: 'Offset from Start', key: 'offset', width: 18 },
    { header: 'Latitude', key: 'lat', width: 14 },
    { header: 'Longitude', key: 'lon', width: 14 },
    { header: 'Camera Heading', key: 'heading', width: 16 },
    { header: 'Camera Pitch', key: 'pitch', width: 14 },
    { header: 'Imagery Date', key: 'date', width: 14 },
    { header: 'Captured Log Date', key: 'capturedAt', width: 20 },
    { header: 'Notes / Details', key: 'notes', width: 32 },
  ];

  const headerRowIndex = 4;
  const headerRow = worksheet.getRow(headerRowIndex);
  headerRow.height = 28;

  headers.forEach((h, colIdx) => {
    const cell = headerRow.getCell(colIdx + 1);
    cell.value = h.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' }, // Dark slate navy
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF94A3B8' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } },
    };
    worksheet.getColumn(colIdx + 1).width = h.width;
  });

  // Data Rows
  if (captures.length === 0) {
    const emptyRow = worksheet.getRow(5);
    emptyRow.height = 36;
    worksheet.mergeCells('A5:M5');
    const emptyCell = emptyRow.getCell(1);
    emptyCell.value = 'No distress captures have been recorded for this section yet.';
    emptyCell.font = { italic: true, color: { argb: 'FF64748B' } };
    emptyCell.alignment = { vertical: 'middle', horizontal: 'center' };
  } else {
    for (let i = 0; i < captures.length; i++) {
      const c = captures[i];
      if (onProgress) {
        onProgress({ current: i + 1, total: captures.length });
      }

      const rowIndex = headerRowIndex + 1 + i;
      const row = worksheet.getRow(rowIndex);
      row.height = 70; // Room for embedded 125x60 thumbnail

      const streetViewUrl = getStreetViewPanoUrl(c);

      // 1. #
      const cellNum = row.getCell(1);
      cellNum.value = i + 1;
      cellNum.alignment = { vertical: 'middle', horizontal: 'center' };
      cellNum.font = { bold: true, color: { argb: 'FF64748B' } };

      // 2. Snapshot: cell placeholder (image will be placed over it)
      const cellSnap = row.getCell(2);
      cellSnap.value = '';
      cellSnap.alignment = { vertical: 'middle', horizontal: 'center' };

      // Embed image if available
      if (c.imageUrl) {
        try {
          const imgPayload = await getImagePayload(c.imageUrl);
          if (imgPayload && imgPayload.base64) {
            const imageId = workbook.addImage({
              base64: imgPayload.base64,
              extension: imgPayload.extension,
            });

            worksheet.addImage(imageId, {
              tl: { col: 1.08, row: rowIndex - 1 + 0.08 },
              ext: { width: 125, height: 60 },
              editAs: 'oneCell',
            });
          }
        } catch (imgErr) {
          console.warn(`Could not embed image for capture ${c.id}:`, imgErr);
        }
      }

      // 3. Street View Link
      const cellLink = row.getCell(3);
      if (streetViewUrl) {
        cellLink.value = {
          text: 'Open in Street View ↗',
          hyperlink: streetViewUrl,
          tooltip: 'Click to open 360° Google Street View at this distress location',
        };
        cellLink.font = { color: { argb: 'FF0284C7' }, underline: true, bold: true };
      } else {
        cellLink.value = '—';
        cellLink.font = { color: { argb: 'FF94A3B8' } };
      }
      cellLink.alignment = { vertical: 'middle', horizontal: 'center' };

      // 4. Distress Type
      const cellType = row.getCell(4);
      cellType.value = c.distressType || 'Unspecified';
      cellType.font = { bold: true, color: { argb: 'FF0F172A' } };
      cellType.alignment = { vertical: 'middle', horizontal: 'left' };

      // 5. Reference Marker (RM)
      const rmData = c.refMarkerDisplay
        ? { refMarkerDisplay: c.refMarkerDisplay }
        : calculateReferenceMarkerAtOffset(section, c.distanceFromStartMiles);
      const cellRm = row.getCell(5);
      cellRm.value = rmData?.refMarkerDisplay || (c.refMarker != null ? `RM ${Number(c.refMarker).toFixed(3)}` : '—');
      cellRm.font = { color: { argb: 'FF0284C7' }, bold: true };
      cellRm.alignment = { vertical: 'middle', horizontal: 'center' };

      // 6. Offset from Start
      const cellOffset = row.getCell(6);
      cellOffset.value = c.distanceFromStartMiles != null ? `+${Number(c.distanceFromStartMiles).toFixed(2)} mi` : '+0.00 mi';
      cellOffset.font = { color: { argb: 'FF15803D' }, bold: true };
      cellOffset.alignment = { vertical: 'middle', horizontal: 'center' };

      // 7. Latitude
      const cellLat = row.getCell(7);
      cellLat.value = c.lat != null ? Number(c.lat) : '';
      cellLat.numFmt = '0.000000';
      cellLat.alignment = { vertical: 'middle', horizontal: 'right' };

      // 8. Longitude
      const cellLon = row.getCell(8);
      cellLon.value = c.lon != null ? Number(c.lon) : '';
      cellLon.numFmt = '0.000000';
      cellLon.alignment = { vertical: 'middle', horizontal: 'right' };

      // 9. Camera Heading
      const cellHeading = row.getCell(9);
      cellHeading.value = c.heading != null ? `${Math.round(c.heading)}°` : '—';
      cellHeading.alignment = { vertical: 'middle', horizontal: 'center' };

      // 10. Camera Pitch
      const cellPitch = row.getCell(10);
      cellPitch.value = c.pitch != null ? `${Math.round(c.pitch)}°` : '—';
      cellPitch.alignment = { vertical: 'middle', horizontal: 'center' };

      // 11. Imagery Date
      const cellDate = row.getCell(11);
      cellDate.value = c.imageYear ? `${c.imageYear}${c.imageDate ? ` (${c.imageDate})` : ''}` : (c.imageDate || '—');
      cellDate.alignment = { vertical: 'middle', horizontal: 'center' };

      // 12. Captured Log Date
      const cellCapAt = row.getCell(12);
      if (c.capturedAt) {
        const d = new Date(c.capturedAt);
        cellCapAt.value = isNaN(d.getTime()) ? c.capturedAt : d.toLocaleString();
      } else {
        cellCapAt.value = '—';
      }
      cellCapAt.alignment = { vertical: 'middle', horizontal: 'center' };

      // 13. Notes
      const cellNotes = row.getCell(13);
      cellNotes.value = c.notes || '';
      cellNotes.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

      // Zebra striping & subtle grid borders
      const isEven = i % 2 === 1;
      for (let col = 1; col <= 13; col++) {
        const cCell = row.getCell(col);
        if (isEven && col !== 2) {
          cCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' },
          };
        }
        cCell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      }
    }

    // Enable Excel AutoFilter
    worksheet.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex + captures.length, column: 13 },
    };
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const cleanSecId = String(section.id || 'Section').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanHwy = String(section.highway || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${cleanSecId}_${cleanHwy}_Captures_${dateStr}.xlsx`;

  await downloadWorkbook(workbook, filename);
}

/**
 * 2. Export GROUPED summary for ALL sections in project.
 *    One section per row with comma-separated recorded distresses in a single cell,
 *    enabling instant filtering by distress across all project sections.
 */
export async function exportGroupedSectionsSummaryToExcel(project, sections = []) {
  if (!project) throw new Error('No project data provided for export.');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TxDOT Distress Capture & Studio';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Sections Distress Summary', {
    views: [{ showGridLines: true }],
  });

  // Title Banner
  worksheet.mergeCells('A1:D1');
  worksheet.getCell('A1').value = `${project.name || 'Project'} — Sections Distress Summary`;
  worksheet.getCell('A1').font = { size: 14, bold: true, color: { argb: 'FF0F172A' } };

  worksheet.mergeCells('E1:L1');
  worksheet.getCell('E1').value = `Total Sections: ${sections.length}   |   Export Date: ${new Date().toISOString().slice(0, 10)}`;
  worksheet.getCell('E1').font = { size: 11, italic: true, color: { argb: 'FF475569' } };
  worksheet.getCell('E1').alignment = { horizontal: 'right' };

  worksheet.getRow(1).height = 24;
  worksheet.getRow(2).height = 8; // Spacer

  // Header Definition (Row 3)
  const columns = [
    { header: 'Section ID', key: 'id', width: 16 },
    { header: 'Highway', key: 'highway', width: 14 },
    { header: 'Roadbed', key: 'roadbed', width: 12 },
    { header: 'District', key: 'district', width: 14 },
    { header: 'County', key: 'county', width: 14 },
    { header: 'Begin RM', key: 'beginRef', width: 13 },
    { header: 'End RM', key: 'endRef', width: 13 },
    { header: 'Length (mi)', key: 'length', width: 13 },
    { header: 'Captures Count', key: 'captureCount', width: 16 },
    { header: 'Recorded Distresses (Filterable)', key: 'distresses', width: 38 },
    { header: 'Distress Breakdown (Counts)', key: 'breakdown', width: 34 },
    { header: 'Has Distresses?', key: 'hasDistresses', width: 16 },
    { header: 'Google Maps Link', key: 'mapsLink', width: 22 },
  ];

  const headerRowIndex = 3;
  const headerRow = worksheet.getRow(headerRowIndex);
  headerRow.height = 28;

  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0284C7' }, // Deep sky blue
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF38BDF8' } },
      bottom: { style: 'medium', color: { argb: 'FF0369A1' } },
      left: { style: 'thin', color: { argb: 'FF0284C7' } },
      right: { style: 'thin', color: { argb: 'FF0284C7' } },
    };
    worksheet.getColumn(idx + 1).width = col.width;
  });

  // Populate one row per section
  sections.forEach((sec, idx) => {
    const rowIndex = headerRowIndex + 1 + idx;
    const row = worksheet.getRow(rowIndex);
    row.height = 22;

    const captures = Array.isArray(sec.captures) ? sec.captures : [];
    const captureCount = captures.length;

    // Unique distresses list (e.g. "Punchouts, ACP Patches, Spalled Cracks")
    const uniqueDistressesSet = new Set();
    const distressCounts = {};

    captures.forEach(c => {
      const type = (c.distressType || '').trim();
      if (type) {
        uniqueDistressesSet.add(type);
        distressCounts[type] = (distressCounts[type] || 0) + 1;
      }
    });

    const uniqueDistressesList = Array.from(uniqueDistressesSet);
    const distressesCommaSeparated = uniqueDistressesList.length > 0
      ? uniqueDistressesList.join(', ')
      : 'None';

    const breakdownText = uniqueDistressesList.length > 0
      ? Object.entries(distressCounts).map(([type, cnt]) => `${type}: ${cnt}`).join(', ')
      : '—';

    const lengthMiles = sec.coordinates?.lengthMiles != null
      ? Number(sec.coordinates.lengthMiles).toFixed(2)
      : sec.beginRef != null && sec.endRef != null
        ? Math.abs(Number(sec.endRef) - Number(sec.beginRef)).toFixed(2)
        : '—';

    // 1. Section ID
    const cellId = row.getCell(1);
    cellId.value = sec.id || '';
    cellId.font = { bold: true };
    cellId.alignment = { vertical: 'middle', horizontal: 'left' };

    // 2. Highway
    const cellHwy = row.getCell(2);
    cellHwy.value = sec.highway || '';
    cellHwy.font = { bold: true };
    cellHwy.alignment = { vertical: 'middle', horizontal: 'center' };

    // 3. Roadbed
    const cellBed = row.getCell(3);
    cellBed.value = sec.coordinates?.roadbed || 'Mainlane';
    cellBed.alignment = { vertical: 'middle', horizontal: 'center' };

    // 4. District
    const cellDist = row.getCell(4);
    cellDist.value = sec.district || '';
    cellDist.alignment = { vertical: 'middle', horizontal: 'center' };

    // 5. County
    const cellCounty = row.getCell(5);
    cellCounty.value = sec.countyName || '';
    cellCounty.alignment = { vertical: 'middle', horizontal: 'center' };

    // 6. Begin RM
    const cellBegin = row.getCell(6);
    cellBegin.value = sec.beginRef != null ? Number(sec.beginRef) : '';
    cellBegin.numFmt = '0.000';
    cellBegin.alignment = { vertical: 'middle', horizontal: 'right' };

    // 7. End RM
    const cellEnd = row.getCell(7);
    cellEnd.value = sec.endRef != null ? Number(sec.endRef) : '';
    cellEnd.numFmt = '0.000';
    cellEnd.alignment = { vertical: 'middle', horizontal: 'right' };

    // 8. Length
    const cellLen = row.getCell(8);
    cellLen.value = lengthMiles !== '—' ? Number(lengthMiles) : '';
    if (lengthMiles !== '—') cellLen.numFmt = '0.00';
    cellLen.alignment = { vertical: 'middle', horizontal: 'right' };

    // 9. Captures Count
    const cellCount = row.getCell(9);
    cellCount.value = captureCount;
    cellCount.font = { bold: true, color: { argb: captureCount > 0 ? 'FF059669' : 'FF64748B' } };
    cellCount.alignment = { vertical: 'middle', horizontal: 'center' };

    // 10. Recorded Distresses (Filterable comma-separated cell)
    const cellDistresses = row.getCell(10);
    cellDistresses.value = distressesCommaSeparated;
    cellDistresses.font = {
      bold: captureCount > 0,
      color: { argb: captureCount > 0 ? 'FF0F172A' : 'FF94A3B8' },
    };
    cellDistresses.alignment = { vertical: 'middle', horizontal: 'left' };

    // 11. Breakdown
    const cellBreakdown = row.getCell(11);
    cellBreakdown.value = breakdownText;
    cellBreakdown.font = { color: { argb: 'FF475569' }, size: 9 };
    cellBreakdown.alignment = { vertical: 'middle', horizontal: 'left' };

    // 12. Has Distresses?
    const cellHas = row.getCell(12);
    cellHas.value = captureCount > 0 ? 'YES' : 'NO';
    cellHas.font = {
      bold: true,
      color: { argb: captureCount > 0 ? 'FF059669' : 'FF94A3B8' },
    };
    cellHas.alignment = { vertical: 'middle', horizontal: 'center' };

    // 13. Maps Link
    const cellMap = row.getCell(13);
    if (sec.coordinates?.begin && Array.isArray(sec.coordinates.begin)) {
      const gMapUrl = `https://www.google.com/maps/search/?api=1&query=${sec.coordinates.begin[0]},${sec.coordinates.begin[1]}`;
      cellMap.value = {
        text: 'View Map ↗',
        hyperlink: gMapUrl,
      };
      cellMap.font = { color: { argb: 'FF0284C7' }, underline: true };
    } else {
      cellMap.value = '—';
      cellMap.font = { color: { argb: 'FF94A3B8' } };
    }
    cellMap.alignment = { vertical: 'middle', horizontal: 'center' };

    // Zebra striping and borders
    const isEven = idx % 2 === 1;
    for (let c = 1; c <= 13; c++) {
      const targetCell = row.getCell(c);
      if (captureCount > 0 && (c === 9 || c === 10 || c === 12)) {
        targetCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF0FDF4' }, // Light emerald highlight for captured sections
        };
      } else if (isEven) {
        targetCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' },
        };
      }
      targetCell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    }
  });

  // Enable AutoFilter on header row
  worksheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex + sections.length, column: 13 },
  };

  const dateStr = new Date().toISOString().slice(0, 10);
  const cleanProj = String(project.name || 'Project').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${cleanProj}_Sections_Distress_Summary_${dateStr}.xlsx`;

  await downloadWorkbook(workbook, filename);
}
