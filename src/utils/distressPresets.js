/**
 * distressPresets.js
 * Official Pavement Distress Types for Continuously Reinforced Concrete Pavement (CRCP).
 * Strictly contains the 12 CRCP distress categories requested by TxDOT inspection standards.
 */

// The 12 Official CRCP Distress Types from TxDOT inspection protocol
export const CRCP_DISTRESS_TYPES = [
  'Spalls',
  'Patches Due to Spalls',
  'Partial-Depth Punchouts',
  'Patches Due to PDP',
  'Failed Repair Joint',
  'Longitudinal Cracks',
  'Patches due to Longitudinal Cracks',
  'Distress at TCJ',
  'Lane Separation',
  'Map Cracks',
  'Patches Due to FDP',
  'Full-Depth Punchouts',
];

export const DEFAULT_DISTRESS_TYPES = CRCP_DISTRESS_TYPES;

const GLOBAL_CUSTOM_KEY = 'txdot-distress:custom-types:v2';
const SECTION_RECENT_KEY_PREFIX = 'txdot-distress:section-recent:v2:';

// List of non-CRCP legacy strings to strictly exclude from autocomplete & recents
const LEGACY_EXCLUDED = new Set([
  'alligator cracking',
  'transverse cracking',
  'block cracking',
  'rutting (shallow)',
  'rutting (deep)',
  'patching / patch failure',
  'pothole',
  'flushing / bleeding',
  'raveling',
  'unspecified distress',
]);

/**
 * Get custom/added distress types from localStorage (filtering out legacy asphalt types)
 */
export function getCustomDistressTypes() {
  try {
    const raw = localStorage.getItem(GLOBAL_CUSTOM_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(t => t && !LEGACY_EXCLUDED.has(t.trim().toLowerCase()));
  } catch {
    return [];
  }
}

/**
 * Save a newly added or selected distress type to global recent history
 */
export function saveCustomDistressType(typeStr) {
  if (!typeStr || typeof typeStr !== 'string') return [];
  const trimmed = typeStr.trim();
  if (!trimmed || LEGACY_EXCLUDED.has(trimmed.toLowerCase())) return [];

  try {
    const existing = getCustomDistressTypes();
    const filtered = existing.filter(t => t.toLowerCase() !== trimmed.toLowerCase());
    const updated = [trimmed, ...filtered].slice(0, 30);
    localStorage.setItem(GLOBAL_CUSTOM_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.warn('Failed to save custom distress type:', err);
    return [];
  }
}

/**
 * Get section-specific recently used distress types
 */
export function getSectionRecentDistressTypes(sectionId) {
  if (!sectionId) return [];
  try {
    const raw = localStorage.getItem(`${SECTION_RECENT_KEY_PREFIX}${sectionId}`);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(t => t && !LEGACY_EXCLUDED.has(t.trim().toLowerCase()));
  } catch {
    return [];
  }
}

/**
 * Save a distress type as recently selected/captured for a specific section
 */
export function saveSectionRecentDistressType(sectionId, typeStr) {
  if (!sectionId || !typeStr || typeof typeStr !== 'string') return;
  const trimmed = typeStr.trim();
  if (!trimmed || LEGACY_EXCLUDED.has(trimmed.toLowerCase())) return;

  try {
    const existing = getSectionRecentDistressTypes(sectionId);
    const filtered = existing.filter(t => t.toLowerCase() !== trimmed.toLowerCase());
    const updated = [trimmed, ...filtered].slice(0, 20);
    localStorage.setItem(`${SECTION_RECENT_KEY_PREFIX}${sectionId}`, JSON.stringify(updated));
    // Also record in global recents
    saveCustomDistressType(trimmed);
    return updated;
  } catch (err) {
    console.warn('Failed to save section recent distress type:', err);
  }
}

/**
 * Returns strictly CRCP distress suggestions ranked for a specific section:
 * 1. Active clicked/typed distress
 * 2. Distresses already captured in this section (most recent capture first)
 * 3. Section-level recents
 * 4. Custom additions
 * 5. Official CRCP catalog (12 standard distresses)
 */
export function getDistressSuggestionsForSection(sectionId, sectionCaptures = [], latestSelectedType = null) {
  const seen = new Set();
  const result = [];

  function add(item) {
    if (!item || typeof item !== 'string') return;
    const trimmed = item.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    // Exclude any obsolete asphalt / non-CRCP types
    if (LEGACY_EXCLUDED.has(lower)) return;
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(trimmed);
    }
  }

  // 1. Actively typed/clicked type
  if (latestSelectedType) {
    add(latestSelectedType);
  }

  // 2. Distresses already recorded on this section
  if (Array.isArray(sectionCaptures)) {
    sectionCaptures.forEach(c => {
      if (c && c.distressType) {
        add(c.distressType);
      }
    });
  }

  // 3. Section recents
  if (sectionId) {
    const sectionRecents = getSectionRecentDistressTypes(sectionId);
    sectionRecents.forEach(add);
  }

  // 4. Global custom types added by user
  const globalRecents = getCustomDistressTypes();
  globalRecents.forEach(add);

  // 5. Official TxDOT CRCP Catalog
  CRCP_DISTRESS_TYPES.forEach(add);

  return result;
}

export function getAllDistressSuggestions() {
  return getDistressSuggestionsForSection(null, []);
}
