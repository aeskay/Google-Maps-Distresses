/**
 * projectStore.js
 * State factory and export utilities for projects and captures.
 */

import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';

export function createBlankState() {
  return {
    version: '1.0.0',
    projects: [],
  };
}

export function createDefaultProject(name = 'New Inspection Project') {
  return {
    id: uuidv4(),
    name,
    sections: [],
  };
}

/**
 * Generates CSV content from captures across a project or single section.
 */
export function generateCapturesCSV(project, sectionId = null) {
  if (!project || !Array.isArray(project.sections)) return '';

  const headers = [
    'Capture ID',
    'Section ID',
    'Highway',
    'District',
    'County',
    'Distress Type',
    'Imagery Date',
    'Imagery Year',
    'Latitude',
    'Longitude',
    'Heading (deg)',
    'Pitch (deg)',
    'Distance From Start (mi)',
    'Captured At',
    'Pano ID',
    'Image URL',
    'Notes',
  ];

  const rows = [];
  const sectionsToExport = sectionId
    ? project.sections.filter(s => s.id === sectionId)
    : project.sections;

  for (const s of sectionsToExport) {
    if (!Array.isArray(s.captures)) continue;
    for (const c of s.captures) {
      rows.push([
        c.id || '',
        s.id || '',
        s.highway || '',
        s.district || '',
        s.countyName || '',
        c.distressType || '',
        c.imageDate || '',
        c.imageYear || (c.imageDate ? c.imageDate.slice(0, 4) : ''),
        c.lat ?? '',
        c.lon ?? '',
        c.heading ?? 0,
        c.pitch ?? 0,
        c.distanceFromStartMiles ?? 0,
        c.capturedAt || '',
        c.panoId || '',
        c.imageUrl || '',
        (c.notes || '').replace(/"/g, '""'),
      ]);
    }
  }

  const csvContent = [
    headers.join(','),
    ...rows.map(r => r.map(val => `"${String(val)}"`).join(',')),
  ].join('\r\n');

  return csvContent;
}

/**
 * Downloads a CSV file to user's computer.
 */
export function downloadCapturesCSV(project, sectionId = null) {
  const csvText = generateCapturesCSV(project, sectionId);
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fileName = `${project.name.replace(/[^a-z0-9]/gi, '_')}_Captures_${new Date().toISOString().slice(0, 10)}.csv`;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Packages captures into a ZIP file with CSV report and all snapshot images.
 */
export async function downloadCapturesZip(project, sectionId = null, onProgress = null) {
  const zip = new JSZip();
  const csvText = generateCapturesCSV(project, sectionId);
  zip.file('captures_report.csv', csvText);

  const imagesFolder = zip.folder('images');
  const sectionsToExport = sectionId
    ? project.sections.filter(s => s.id === sectionId)
    : project.sections;

  const allCaptures = [];
  sectionsToExport.forEach(s => {
    if (Array.isArray(s.captures)) {
      s.captures.forEach(c => allCaptures.push({ section: s, capture: c }));
    }
  });

  const total = allCaptures.length;
  for (let i = 0; i < total; i++) {
    const { section, capture } = allCaptures[i];
    if (onProgress) {
      onProgress({ current: i + 1, total });
    }

    if (capture.imageUrl) {
      try {
        let base64Data = null;
        if (capture.imageUrl.startsWith('data:image')) {
          base64Data = capture.imageUrl.split(',')[1];
        } else {
          // Fetch remote image
          const res = await fetch(capture.imageUrl);
          const blob = await res.blob();
          const buffer = await blob.arrayBuffer();
          const cleanName = `${section.id}_${capture.distressType.replace(/[^a-z0-9]/gi, '_')}_${i + 1}.jpg`;
          imagesFolder.file(cleanName, buffer);
          continue;
        }

        if (base64Data) {
          const cleanName = `${section.id}_${capture.distressType.replace(/[^a-z0-9]/gi, '_')}_${i + 1}.jpg`;
          imagesFolder.file(cleanName, base64Data, { base64: true });
        }
      } catch (err) {
        console.warn(`Could not add image for capture ${capture.id} to zip:`, err);
      }
    }
  }

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/[^a-z0-9]/gi, '_')}_Captures_Package.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
