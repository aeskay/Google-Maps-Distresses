/**
 * normalizers.js
 * Helpers for normalizing TxDOT highway strings, districts, and counties.
 *
 * In this application, highways are already roadbed-specific (e.g. "IH0020 R", "US0059 L", "FM2826 KG").
 */

export const TXDOT_DISTRICT_NAMES = {
  1: 'Paris', '01': 'Paris', 'PARIS': 'Paris', 'PAR': 'Paris',
  2: 'Fort Worth', '02': 'Fort Worth', 'FORT WORTH': 'Fort Worth', 'FT WORTH': 'Fort Worth', 'FTW': 'Fort Worth',
  3: 'Wichita Falls', '03': 'Wichita Falls', 'WICHITA FALLS': 'Wichita Falls', 'WFS': 'Wichita Falls',
  4: 'Amarillo', '04': 'Amarillo', 'AMARILLO': 'Amarillo', 'AMA': 'Amarillo',
  5: 'Lubbock', '05': 'Lubbock', 'LUBBOCK': 'Lubbock', 'LBB': 'Lubbock',
  6: 'Odessa', '06': 'Odessa', 'ODESSA': 'Odessa', 'ODA': 'Odessa',
  7: 'San Angelo', '07': 'San Angelo', 'SAN ANGELO': 'San Angelo', 'SJT': 'San Angelo',
  8: 'Abilene', '08': 'Abilene', 'ABILENE': 'Abilene', 'ABL': 'Abilene',
  9: 'Waco', '09': 'Waco', 'WACO': 'Waco', 'WAC': 'Waco',
  10: 'Tyler', '10': 'Tyler', 'TYLER': 'Tyler', 'TYL': 'Tyler',
  11: 'Lufkin', '11': 'Lufkin', 'LUFKIN': 'Lufkin', 'LFK': 'Lufkin',
  12: 'Houston', '12': 'Houston', 'HOUSTON': 'Houston', 'HOU': 'Houston',
  13: 'Yoakum', '13': 'Yoakum', 'YOAKUM': 'Yoakum', 'YKM': 'Yoakum',
  14: 'Austin', '14': 'Austin', 'AUSTIN': 'Austin', 'AUS': 'Austin',
  15: 'San Antonio', '15': 'San Antonio', 'SAN ANTONIO': 'San Antonio', 'SAT': 'San Antonio',
  16: 'Corpus Christi', '16': 'Corpus Christi', 'CORPUS CHRISTI': 'Corpus Christi', 'CRP': 'Corpus Christi',
  17: 'Bryan', '17': 'Bryan', 'BRYAN': 'Bryan', 'BRY': 'Bryan',
  18: 'Dallas', '18': 'Dallas', 'DALLAS': 'Dallas', 'DAL': 'Dallas',
  19: 'Atlanta', '19': 'Atlanta', 'ATLANTA': 'Atlanta', 'ATL': 'Atlanta',
  20: 'Beaumont', '20': 'Beaumont', 'BEAUMONT': 'Beaumont', 'BMT': 'Beaumont',
  21: 'Pharr', '21': 'Pharr', 'PHARR': 'Pharr', 'PHR': 'Pharr',
  22: 'Laredo', '22': 'Laredo', 'LAREDO': 'Laredo', 'LRD': 'Laredo',
  23: 'Brownwood', '23': 'Brownwood', 'BROWNWOOD': 'Brownwood', 'BWD': 'Brownwood',
  24: 'El Paso', '24': 'El Paso', 'EL PASO': 'El Paso', 'ELP': 'El Paso',
  25: 'Childress', '25': 'Childress', 'CHILDRESS': 'Childress', 'CHS': 'Childress',
};

/**
 * Converts any raw district input (e.g. '12 - HOUSTON', '12', 'Houston')
 * into the canonical TxDOT district name (e.g. 'Houston').
 */
export function cleanDistrictString(raw) {
  if (!raw) return '';
  const str = String(raw).trim().toUpperCase();
  if (TXDOT_DISTRICT_NAMES[str]) return TXDOT_DISTRICT_NAMES[str];

  // Try matching leading numbers e.g. "12 - HOUSTON" or "12"
  const numMatch = str.match(/^0*(\d+)/);
  if (numMatch && TXDOT_DISTRICT_NAMES[numMatch[1]]) {
    return TXDOT_DISTRICT_NAMES[numMatch[1]];
  }

  // Substring match
  for (const [k, v] of Object.entries(TXDOT_DISTRICT_NAMES)) {
    if (isNaN(Number(k)) && k.length > 2 && str.includes(k)) {
      return v;
    }
  }
  return String(raw).trim();
}

/**
 * Strips "County" suffix and cleans county string.
 */
export function cleanCountyString(raw) {
  if (!raw) return '';
  return String(raw).replace(/\bcounty\b/gi, '').trim();
}

/**
 * Normalizes highway strings into standard TxDOT format with explicit roadbed.
 * Examples:
 *   "IH0020 R"  -> { prefix: 'IH', number: '0020', paddedRoute: 'IH0020', roadbed: 'R', fullKey: 'IH0020-RG' }
 *   "IH 20 R"   -> { prefix: 'IH', number: '0020', paddedRoute: 'IH0020', roadbed: 'R', fullKey: 'IH0020-RG' }
 *   "US 59 L"   -> { prefix: 'US', number: '0059', paddedRoute: 'US0059', roadbed: 'L', fullKey: 'US0059-LG' }
 *   "FM 2826"   -> { prefix: 'FM', number: '2826', paddedRoute: 'FM2826', roadbed: 'K', fullKey: 'FM2826-KG' }
 *   "SH 225-RG" -> { prefix: 'SH', number: '0225', paddedRoute: 'SH0225', roadbed: 'R', fullKey: 'SH0225-RG' }
 */
export function parseSpecificHighway(highwayStr) {
  if (!highwayStr) return null;
  const clean = String(highwayStr).toUpperCase().replace(/[\s-_]/g, '');

  // Match Prefix + digits + optional roadbed letter(s)
  const match = clean.match(/^([A-Z]+)0*(\d+)([A-Z]*)$/);
  if (!match) return null;

  const prefix = match[1];
  const number = match[2].padStart(4, '0');
  const paddedRoute = `${prefix}${number}`;
  let rawSuffix = match[3] || '';

  // Extract roadbed (R, L, K, or KG/RG/LG)
  let roadbed = 'K';
  if (rawSuffix.includes('R')) roadbed = 'R';
  else if (rawSuffix.includes('L')) roadbed = 'L';
  else if (rawSuffix.includes('K')) roadbed = 'K';

  const routeType = roadbed === 'R' ? 'RG' : roadbed === 'L' ? 'LG' : 'KG';
  const fullKey = `${paddedRoute}-${routeType}`;

  return {
    prefix,
    number,
    paddedRoute,
    roadbed,
    routeType,
    fullKey,
    displayName: `${prefix} ${parseInt(number, 10)} ${roadbed}`,
  };
}

/**
 * Quick highway normalizer helper for PMIS lookup key.
 */
export function normalizeHighway(raw) {
  const parsed = parseSpecificHighway(raw);
  if (!parsed) return String(raw || '').trim().toUpperCase();
  return `${parsed.paddedRoute} ${parsed.roadbed}`;
}

export function cleanDistrictKey(val) {
  if (val === null || val === undefined) return '';
  let s = String(val).toUpperCase().trim();
  s = s.replace(/^[0-9\s-]+/, ''); // remove leading numbers and dashes
  s = s.replace(/\s+/g, '');        // remove all internal spaces
  return s;
}

export function parseHighwayComponents(highwayStr) {
  if (!highwayStr) return { base: '', explicitSuffix: '' };
  const clean = String(highwayStr).toUpperCase().replace(/[\s-_]/g, '');
  const match = clean.match(/^([A-Z]+)0*(\d+)(K\([RL]\)|[A-Z]*)$/);
  if (match) {
    let suffix = match[3] || '';
    if (suffix === 'RG') suffix = 'R';
    else if (suffix === 'LG') suffix = 'L';
    else if (suffix === 'KG') suffix = 'K';
    const base = `${match[1]}${parseInt(match[2], 10)}`;
    return {
      base,
      explicitSuffix: suffix,
    };
  }
  return {
    base: clean,
    explicitSuffix: '',
  };
}

/**
 * Strips leading numbers and separators from a district string for clean UI display.
 * E.g.:
 *   "19 - ATLANTA"  -> "ATLANTA"
 *   "19-ATLANTA"   -> "ATLANTA"
 *   "01 - PARIS"   -> "PARIS"
 *   "19"           -> "ATLANTA"
 *   "Atlanta"      -> "Atlanta"
 */
export function formatDistrictDisplay(raw) {
  if (raw === null || raw === undefined) return '';
  const str = String(raw).trim();
  if (!str) return '';

  // Remove leading numbers followed by hyphens, dashes, colons, or whitespace
  const stripped = str.replace(/^[0-9]+\s*[-–—:]*\s*/, '').trim();
  if (stripped && !/^\d+$/.test(stripped)) {
    return stripped;
  }

  // If the raw input was only a number (e.g. "19" or "01"), resolve to canonical district name
  const canonical = cleanDistrictString(str);
  if (canonical) {
    return canonical.toUpperCase();
  }
  return str;
}

/**
 * Formats slab thickness for UI display (e.g. "10" -> "10 in", "10.0 in" -> "10.0 in").
 */
export function formatSlabThicknessDisplay(val) {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (!str) return '';
  if (/^[0-9]+(\.[0-9]+)?$/.test(str)) {
    return `${str} in`;
  }
  return str;
}

