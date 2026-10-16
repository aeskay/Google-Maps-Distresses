/**
 * txdotGisApi.js
 * Official TxDOT ArcGIS REST API service for resolving Reference Markers,
 * DFO (Distance From Origin), and measured roadbed polyline geometry.
 *
 * Tailored for specific highways (e.g. "IH0020 R", "US0059 L", "FM2826 KG").
 */

import { get, set } from 'idb-keyval';
import { cleanDistrictString, cleanCountyString, parseSpecificHighway } from './normalizers';

const RM_FEATURE_SERVER = 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Reference_Markers/FeatureServer/0/query';
const ROADWAYS_FEATURE_SERVER = 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Roadways/FeatureServer/0/query';

// Storage keys for persistent caching in IndexedDB
const GPS_CACHE_STORE_KEY = 'txdot-distress:gps-cache-v1';
const RM_CACHE_STORE_KEY = 'txdot-distress:rm-cache-v1';
const ROADWAYS_CACHE_STORE_KEY = 'txdot-distress:roadways-cache-v1';

// In-memory caches for fast repeated access
const cacheRM = new Map();
const cacheRoadways = new Map();
const memoryGpsCache = new Map();

let isGpsCacheHydrated = false;

// ── Approximate District Bounds for Sanity Checking ───────────────────────────
export const DISTRICT_BOUNDS = {
  'Houston':        { minLon: -96.6, maxLon: -94.2, minLat: 28.6, maxLat: 30.8 },
  'El Paso':        { minLon: -107.0, maxLon: -103.5, minLat: 29.0, maxLat: 32.5 },
  'Beaumont':       { minLon: -95.0, maxLon: -93.5, minLat: 29.5, maxLat: 31.5 },
  'San Antonio':    { minLon: -100.5, maxLon: -97.5, minLat: 28.5, maxLat: 30.5 },
  'Austin':         { minLon: -99.0, maxLon: -96.5, minLat: 29.5, maxLat: 31.2 },
  'Dallas':         { minLon: -97.5, maxLon: -96.0, minLat: 32.0, maxLat: 33.5 },
  'Fort Worth':     { minLon: -98.5, maxLon: -96.8, minLat: 32.0, maxLat: 33.6 },
  'Lubbock':        { minLon: -103.5, maxLon: -100.5, minLat: 32.5, maxLat: 34.5 },
  'Amarillo':       { minLon: -103.2, maxLon: -100.0, minLat: 34.5, maxLat: 36.6 },
  'Corpus Christi': { minLon: -98.5, maxLon: -96.8, minLat: 26.8, maxLat: 28.8 },
  'Pharr':          { minLon: -99.0, maxLon: -97.0, minLat: 25.8, maxLat: 27.5 },
  'Laredo':         { minLon: -101.0, maxLon: -98.8, minLat: 26.8, maxLat: 29.8 },
  'Odessa':         { minLon: -104.5, maxLon: -101.5, minLat: 30.5, maxLat: 32.8 },
  'Waco':           { minLon: -98.5, maxLon: -96.5, minLat: 30.8, maxLat: 32.3 },
  'Bryan':          { minLon: -97.5, maxLon: -95.5, minLat: 30.0, maxLat: 31.5 },
  'Tyler':          { minLon: -96.0, maxLon: -94.5, minLat: 31.8, maxLat: 33.0 },
  'Yoakum':         { minLon: -98.0, maxLon: -95.8, minLat: 28.5, maxLat: 30.2 },
};

export function isCoordinateInDistrict(coord, districtName) {
  if (!coord || !Array.isArray(coord) || coord.length < 2 || !districtName) return true;
  const canonical = cleanDistrictString(districtName);
  const bounds = DISTRICT_BOUNDS[canonical];
  if (!bounds) return true;
  const [lat, lon] = coord;
  return lat >= bounds.minLat - 0.35 && lat <= bounds.maxLat + 0.35 &&
         lon >= bounds.minLon - 0.35 && lon <= bounds.maxLon + 0.35;
}

// ── Reference Markers Service ────────────────────────────────────────────────
async function fetchReferenceMarkersForRoute(paddedRoute, canonicalDistrict = null, cleanCounty = null, beginRef = null, endRef = null) {
  const cacheKey = canonicalDistrict ? `${paddedRoute}:${canonicalDistrict}` : paddedRoute;
  if (cacheRM.has(cacheKey)) {
    return cacheRM.get(cacheKey);
  }

  try {
    const idbStore = (await get(RM_CACHE_STORE_KEY)) || {};
    if (idbStore[cacheKey] && Array.isArray(idbStore[cacheKey])) {
      cacheRM.set(cacheKey, idbStore[cacheKey]);
      return idbStore[cacheKey];
    }
  } catch {}

  // 1. District targeted
  if (canonicalDistrict) {
    const params = new URLSearchParams({
      where: `RTE_NM LIKE '${paddedRoute}%' AND DIST_NM = '${canonicalDistrict}'`,
      outFields: 'OBJECTID,RTE_NM,RTE_PRFX,RTE_NBR,RDBD_TYPE,DFO,MRKR_NBR,MRKR_SFX,CNTY_NM,DIST_NM',
      orderByFields: 'MRKR_NBR ASC, DFO ASC',
      returnGeometry: 'true',
      outSR: '4326',
      resultRecordCount: '2000',
      f: 'pjson',
    });

    try {
      const res = await fetch(`${RM_FEATURE_SERVER}?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const features = data.features || [];
        if (features.length > 0) {
          cacheRM.set(cacheKey, features);
          try {
            const idbStore = (await get(RM_CACHE_STORE_KEY)) || {};
            idbStore[cacheKey] = features;
            await set(RM_CACHE_STORE_KEY, idbStore);
          } catch {}
          return features;
        }
      }
    } catch (err) {
      console.warn(`District query failed for ${paddedRoute} in ${canonicalDistrict}:`, err);
    }
  }

  // 2. Reference Marker range targeted
  if (beginRef !== null && endRef !== null && !isNaN(beginRef) && !isNaN(endRef)) {
    const minM = Math.floor(Math.min(beginRef, endRef)) - 10;
    const maxM = Math.ceil(Math.max(beginRef, endRef)) + 10;
    const params = new URLSearchParams({
      where: `RTE_NM LIKE '${paddedRoute}%' AND MRKR_NBR >= ${minM} AND MRKR_NBR <= ${maxM}`,
      outFields: 'OBJECTID,RTE_NM,RTE_PRFX,RTE_NBR,RDBD_TYPE,DFO,MRKR_NBR,MRKR_SFX,CNTY_NM,DIST_NM',
      orderByFields: 'MRKR_NBR ASC, DFO ASC',
      returnGeometry: 'true',
      outSR: '4326',
      resultRecordCount: '2000',
      f: 'pjson',
    });

    try {
      const res = await fetch(`${RM_FEATURE_SERVER}?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const features = data.features || [];
        if (features.length > 0) {
          cacheRM.set(cacheKey, features);
          return features;
        }
      }
    } catch {}
  }

  // 3. Broad query
  const broadParams = new URLSearchParams({
    where: `RTE_NM LIKE '${paddedRoute}%'`,
    outFields: 'OBJECTID,RTE_NM,RTE_PRFX,RTE_NBR,RDBD_TYPE,DFO,MRKR_NBR,MRKR_SFX,CNTY_NM,DIST_NM',
    orderByFields: 'MRKR_NBR ASC, DFO ASC',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '2000',
    f: 'pjson',
  });

  try {
    const res = await fetch(`${RM_FEATURE_SERVER}?${broadParams.toString()}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    const features = data.features || [];
    cacheRM.set(cacheKey, features);

    try {
      const idbStore = (await get(RM_CACHE_STORE_KEY)) || {};
      idbStore[cacheKey] = features;
      await set(RM_CACHE_STORE_KEY, idbStore);
    } catch {}

    return features;
  } catch (err) {
    console.warn(`Broad query failed for Reference Markers on ${paddedRoute}:`, err);
    return [];
  }
}

// ── Roadways Geometry Service ────────────────────────────────────────────────
async function fetchRoadwayGeometryForRoute(routeId) {
  if (cacheRoadways.has(routeId)) {
    return cacheRoadways.get(routeId);
  }

  try {
    const idbStore = (await get(ROADWAYS_CACHE_STORE_KEY)) || {};
    if (idbStore[routeId] && Array.isArray(idbStore[routeId])) {
      cacheRoadways.set(routeId, idbStore[routeId]);
      return idbStore[routeId];
    }
  } catch {}

  const params = new URLSearchParams({
    where: `RTE_NM = '${routeId}'`,
    outFields: 'OBJECTID,RTE_NM,RDBD_TYPE,BEGIN_DFO,END_DFO,COUNTY',
    returnGeometry: 'true',
    returnM: 'true',
    outSR: '4326',
    resultRecordCount: '2000',
    f: 'pjson',
  });

  try {
    const res = await fetch(`${ROADWAYS_FEATURE_SERVER}?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    const features = data.features || [];
    cacheRoadways.set(routeId, features);

    if (features.length > 0) {
      try {
        const idbStore = (await get(ROADWAYS_CACHE_STORE_KEY)) || {};
        idbStore[routeId] = features;
        await set(ROADWAYS_CACHE_STORE_KEY, idbStore);
      } catch {}
    }

    return features;
  } catch (err) {
    console.warn(`Failed to fetch Roadway geometries for ${routeId}:`, err);
    return [];
  }
}

function findRoadwayFeatureForDfo(roadwayFeatures, targetDfo) {
  if (!roadwayFeatures || roadwayFeatures.length === 0) return null;

  for (const feat of roadwayFeatures) {
    const b = feat.attributes.BEGIN_DFO;
    const e = feat.attributes.END_DFO;
    const minD = Math.min(b, e);
    const maxD = Math.max(b, e);
    if (targetDfo >= minD && targetDfo <= maxD) {
      return feat;
    }
  }

  let closest = null;
  let minDiff = Infinity;
  for (const feat of roadwayFeatures) {
    const b = feat.attributes.BEGIN_DFO;
    const e = feat.attributes.END_DFO;
    const minD = Math.min(b, e);
    const maxD = Math.max(b, e);
    const diff = Math.min(Math.abs(targetDfo - minD), Math.abs(targetDfo - maxD));
    if (diff < minDiff) {
      minDiff = diff;
      closest = feat;
    }
  }

  return minDiff <= 5.0 ? closest : null;
}

function getVerticesFromGeometry(featOrPaths) {
  if (!featOrPaths) return null;
  const p = featOrPaths.geometry?.paths || featOrPaths;
  if (!Array.isArray(p) || p.length === 0) return null;
  if (Array.isArray(p[0]) && Array.isArray(p[0][0])) {
    return p[0];
  }
  if (Array.isArray(p[0]) && typeof p[0][0] === 'number') {
    return p;
  }
  return null;
}

function interpolatePointAtDfo(featOrPaths, targetDfo) {
  const vertices = getVerticesFromGeometry(featOrPaths);
  if (!vertices || vertices.length === 0) return null;

  const firstM = vertices[0][2];
  const lastM = vertices[vertices.length - 1][2];
  if (typeof firstM !== 'number' || typeof lastM !== 'number') return null;

  if (targetDfo <= Math.min(firstM, lastM)) {
    const pt = firstM <= lastM ? vertices[0] : vertices[vertices.length - 1];
    return [Number(pt[1].toFixed(6)), Number(pt[0].toFixed(6))];
  }
  if (targetDfo >= Math.max(firstM, lastM)) {
    const pt = firstM >= lastM ? vertices[0] : vertices[vertices.length - 1];
    return [Number(pt[1].toFixed(6)), Number(pt[0].toFixed(6))];
  }

  for (let i = 0; i < vertices.length - 1; i++) {
    const p1 = vertices[i];
    const p2 = vertices[i + 1];
    if (!p1 || !p2 || typeof p1[2] !== 'number' || typeof p2[2] !== 'number') continue;
    const minM = Math.min(p1[2], p2[2]);
    const maxM = Math.max(p1[2], p2[2]);

    if (targetDfo >= minM && targetDfo <= maxM) {
      const denom = (p2[2] - p1[2]) || 0.000001;
      const ratio = (targetDfo - p1[2]) / denom;
      const lat = p1[1] + ratio * (p2[1] - p1[1]);
      const lon = p1[0] + ratio * (p2[0] - p1[0]);
      return [Number(lat.toFixed(6)), Number(lon.toFixed(6))];
    }
  }

  return [Number(vertices[0][1].toFixed(6)), Number(vertices[0][0].toFixed(6))];
}

function extractPathBetweenDfosFromFeatures(roadwayFeatures, beginDfo, endDfo) {
  if (!roadwayFeatures || roadwayFeatures.length === 0) return [];
  const startD = Math.min(beginDfo, endDfo);
  const stopD = Math.max(beginDfo, endDfo);

  const overlapping = roadwayFeatures.filter(f => {
    const b = Math.min(f.attributes.BEGIN_DFO, f.attributes.END_DFO);
    const e = Math.max(f.attributes.BEGIN_DFO, f.attributes.END_DFO);
    return !(e < startD || b > stopD);
  }).sort((a, b) => a.attributes.BEGIN_DFO - b.attributes.BEGIN_DFO);

  if (overlapping.length === 0) {
    const closest = findRoadwayFeatureForDfo(roadwayFeatures, (startD + stopD) / 2);
    if (!closest) return [];
    return extractPathFromSingleFeature(closest, beginDfo, endDfo);
  }

  const combined = [];
  for (const feat of overlapping) {
    const seg = extractPathFromSingleFeature(feat, startD, stopD);
    combined.push(...seg);
  }

  if (beginDfo > endDfo) {
    combined.reverse();
  }
  return combined;
}

function extractPathFromSingleFeature(feat, beginDfo, endDfo) {
  const vertices = getVerticesFromGeometry(feat);
  if (!vertices || vertices.length === 0) return [];

  const startD = Math.min(beginDfo, endDfo);
  const stopD = Math.max(beginDfo, endDfo);

  const startPt = interpolatePointAtDfo(vertices, startD);
  const endPt = interpolatePointAtDfo(vertices, stopD);

  const segment = [];
  if (startPt) segment.push(startPt);

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (Array.isArray(v) && typeof v[2] === 'number') {
      const m = v[2];
      if (m > startD && m < stopD) {
        segment.push([Number(v[1].toFixed(6)), Number(v[0].toFixed(6))]);
      }
    }
  }

  if (endPt) segment.push(endPt);
  if (beginDfo > endDfo) {
    segment.reverse();
  }
  return segment;
}

function calculateDfoFromRefMarker(markerList, targetRef) {
  if (!markerList || markerList.length === 0) return null;

  const numRef = parseFloat(targetRef);
  if (isNaN(numRef)) return null;

  const exact = markerList.find(m => Math.abs(m.marker - numRef) < 0.0001);
  if (exact) return exact.dfo;

  let prevMarker = null;
  let nextMarker = null;

  for (let i = 0; i < markerList.length; i++) {
    const m = markerList[i];
    if (m.marker <= numRef) {
      if (!prevMarker || m.marker > prevMarker.marker) prevMarker = m;
    }
    if (m.marker >= numRef) {
      if (!nextMarker || m.marker < nextMarker.marker) nextMarker = m;
    }
  }

  if (prevMarker && nextMarker && prevMarker.marker !== nextMarker.marker) {
    const markerDiff = nextMarker.marker - prevMarker.marker;
    const dfoDiff = nextMarker.dfo - prevMarker.dfo;
    const fraction = (numRef - prevMarker.marker) / markerDiff;
    return prevMarker.dfo + (fraction * dfoDiff);
  }

  if (prevMarker) return prevMarker.dfo + (numRef - prevMarker.marker);
  if (nextMarker) return Math.max(0, nextMarker.dfo - (nextMarker.marker - numRef));

  return null;
}

// ── Persistent GPS Coordinates Cache ─────────────────────────────────────────
export function getSectionGpsKey(highway, beginRef, endRef, county = '', district = '') {
  const parsed = parseSpecificHighway(highway);
  const route = parsed ? parsed.fullKey : String(highway || '').trim().toUpperCase();
  const b = parseFloat(beginRef);
  const e = parseFloat(endRef);
  const bStr = !isNaN(b) ? b.toFixed(3) : String(beginRef ?? '').trim();
  const eStr = !isNaN(e) ? e.toFixed(3) : String(endRef ?? '').trim();
  const cStr = cleanCountyString(county).toLowerCase();
  const dStr = cleanDistrictString(district).toLowerCase();
  return `${route}:${bStr}:${eStr}${dStr ? `:${dStr}` : ''}${cStr ? `:${cStr}` : ''}`;
}

export async function initGpsCache() {
  if (isGpsCacheHydrated) return memoryGpsCache;
  try {
    const stored = await get(GPS_CACHE_STORE_KEY);
    if (stored && typeof stored === 'object') {
      Object.entries(stored).forEach(([k, v]) => memoryGpsCache.set(k, v));
    }
    isGpsCacheHydrated = true;
  } catch (err) {
    console.warn('Failed to load GPS cache from IndexedDB:', err);
  }
  return memoryGpsCache;
}

// ── Main Specific Roadbed Resolver ───────────────────────────────────────────
export async function fetchCoordinatesForSection(section, { forceRefresh = false } = {}) {
  if (!section || !section.highway) {
    return { status: 'error', error: 'Missing highway information' };
  }

  const parsed = parseSpecificHighway(section.highway);
  if (!parsed) {
    return { status: 'error', error: `Unrecognized highway format: ${section.highway}` };
  }

  const canonicalDist = cleanDistrictString(section.district);
  const cleanCounty = cleanCountyString(section.countyName);
  const beginRef = parseFloat(section.beginRef);
  const endRef = parseFloat(section.endRef);

  if (isNaN(beginRef) || isNaN(endRef)) {
    return { status: 'error', error: `Invalid reference marker range: ${section.beginRef} – ${section.endRef}` };
  }

  // Check persistent cache
  await initGpsCache();
  const keyFull = getSectionGpsKey(section.highway, section.beginRef, section.endRef, section.countyName, section.district);
  const keyDist = getSectionGpsKey(section.highway, section.beginRef, section.endRef, '', section.district);
  const cached = memoryGpsCache.get(keyFull) || memoryGpsCache.get(keyDist);

  if (!forceRefresh && cached && cached.status === 'success' && cached.begin && Array.isArray(cached.path) && cached.path.length > 2) {
    if (!canonicalDist || isCoordinateInDistrict(cached.begin, canonicalDist)) {
      return cached;
    }
  }

  // Fetch Reference Markers
  const allMarkers = await fetchReferenceMarkersForRoute(parsed.paddedRoute, canonicalDist, cleanCounty, beginRef, endRef);
  if (!allMarkers || allMarkers.length === 0) {
    return {
      status: 'not_found',
      error: `No TxDOT Reference Markers found for ${parsed.paddedRoute}${canonicalDist ? ` in ${canonicalDist} District` : ''}`,
    };
  }

  // Filter markers by roadbed type
  const targetType = parsed.routeType; // 'RG', 'LG', or 'KG'
  let typeFiltered = allMarkers.filter(f => f.attributes.RDBD_TYPE === targetType);
  let isUndivided = false;

  if (typeFiltered.length === 0) {
    typeFiltered = allMarkers.filter(f => f.attributes.RDBD_TYPE === 'KG');
    if (typeFiltered.length > 0) isUndivided = true;
  }

  if (typeFiltered.length === 0) {
    // If RG was requested but only LG exists, or vice versa, fallback
    typeFiltered = allMarkers;
  }

  let candidateMarkers = typeFiltered.map(f => ({
    marker: f.attributes.MRKR_NBR,
    dfo: f.attributes.DFO,
    lat: f.geometry?.y,
    lon: f.geometry?.x,
    county: f.attributes.CNTY_NM,
    district: f.attributes.DIST_NM,
  })).sort((a, b) => a.marker - b.marker);

  if (canonicalDist) {
    const distMatches = candidateMarkers.filter(m => m.district && m.district.toLowerCase() === canonicalDist.toLowerCase());
    if (distMatches.length > 0) candidateMarkers = distMatches;
  }

  const beginDfo = calculateDfoFromRefMarker(candidateMarkers, beginRef);
  const endDfo = calculateDfoFromRefMarker(candidateMarkers, endRef);

  if (beginDfo === null || endDfo === null) {
    return {
      status: 'failed',
      error: `Could not interpolate DFO for RM ${beginRef} – ${endRef}`,
    };
  }

  // Query Roadway features for this roadbed route
  const targetRouteId = isUndivided ? `${parsed.paddedRoute}-KG` : `${parsed.paddedRoute}-${targetType}`;
  let roadwayFeatures = await fetchRoadwayGeometryForRoute(targetRouteId);

  // If specific roadbed has no geometry, fallback to single roadbed (-KG) or alternate
  if (!roadwayFeatures || roadwayFeatures.length === 0) {
    roadwayFeatures = await fetchRoadwayGeometryForRoute(`${parsed.paddedRoute}-KG`);
  }
  if (!roadwayFeatures || roadwayFeatures.length === 0) {
    const altType = targetType === 'RG' ? 'LG' : 'RG';
    roadwayFeatures = await fetchRoadwayGeometryForRoute(`${parsed.paddedRoute}-${altType}`);
  }

  let beginCoord = null;
  let endCoord = null;
  let path = [];

  if (roadwayFeatures && roadwayFeatures.length > 0) {
    const featBegin = findRoadwayFeatureForDfo(roadwayFeatures, beginDfo);
    const featEnd = findRoadwayFeatureForDfo(roadwayFeatures, endDfo);

    if (featBegin) beginCoord = interpolatePointAtDfo(featBegin, beginDfo);
    if (featEnd) endCoord = interpolatePointAtDfo(featEnd, endDfo);

    path = extractPathBetweenDfosFromFeatures(roadwayFeatures, beginDfo, endDfo);
  }

  // Fallback: interpolate directly between candidate reference marker coordinates
  if (!beginCoord || !endCoord) {
    const validMarkers = candidateMarkers.filter(m => typeof m.lat === 'number' && typeof m.lon === 'number');
    const findClosestPoint = (targetRef) => {
      if (validMarkers.length === 0) return null;
      const sorted = [...validMarkers].sort((a, b) => Math.abs(a.marker - targetRef) - Math.abs(b.marker - targetRef));
      if (sorted.length >= 2) {
        const m1 = sorted[0];
        const m2 = sorted[1];
        const denom = (m2.marker - m1.marker) || 1;
        const ratio = (targetRef - m1.marker) / denom;
        const lat = m1.lat + ratio * (m2.lat - m1.lat);
        const lon = m1.lon + ratio * (m2.lon - m1.lon);
        return [Number(lat.toFixed(6)), Number(lon.toFixed(6))];
      }
      return [Number(sorted[0].lat.toFixed(6)), Number(sorted[0].lon.toFixed(6))];
    };

    beginCoord = beginCoord || findClosestPoint(beginRef);
    endCoord = endCoord || findClosestPoint(endRef);
    if (beginCoord && endCoord) {
      path = [beginCoord, endCoord];
    }
  }

  if (!beginCoord || !endCoord) {
    return {
      status: 'failed',
      error: `Could not resolve coordinates for RM ${beginRef} – ${endRef}`,
    };
  }

  const bDfoNum = Number(beginDfo.toFixed(3));
  const eDfoNum = Number(endDfo.toFixed(3));
  const lengthMiles = Number(Math.abs(eDfoNum - bDfoNum).toFixed(3));

  const result = {
    status: 'success',
    timestamp: new Date().toISOString(),
    highwayRoute: parsed.paddedRoute,
    roadbed: parsed.roadbed,
    routeId: targetRouteId,
    district: canonicalDist,
    county: cleanCounty,
    begin: beginCoord, // [lat, lon]
    end: endCoord,     // [lat, lon]
    beginDfo: bDfoNum,
    endDfo: eDfoNum,
    lengthMiles,
    path: path.length > 0 ? path : [beginCoord, endCoord],
  };

  // Cache result
  memoryGpsCache.set(keyFull, result);
  memoryGpsCache.set(keyDist, result);
  try {
    const existing = (await get(GPS_CACHE_STORE_KEY)) || {};
    existing[keyFull] = result;
    existing[keyDist] = result;
    await set(GPS_CACHE_STORE_KEY, existing);
  } catch {}

  return result;
}

/**
 * Hydrates sections from persistent cache if missing.
 */
export async function hydrateSectionsWithCachedCoordinates(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return { sections: [], hasUpdates: false };
  await initGpsCache();

  let hasUpdates = false;
  const updated = sections.map(s => {
    if (
      s.coordinates?.status === 'success' &&
      s.coordinates.begin &&
      Array.isArray(s.coordinates.path) &&
      s.coordinates.path.length >= 2
    ) {
      return s;
    }
    const keyFull = getSectionGpsKey(s.highway, s.beginRef, s.endRef, s.countyName, s.district);
    const keyDist = getSectionGpsKey(s.highway, s.beginRef, s.endRef, '', s.district);
    const cached = memoryGpsCache.get(keyFull) || memoryGpsCache.get(keyDist);

    if (cached && cached.status === 'success') {
      hasUpdates = true;
      return { ...s, coordinates: cached };
    }

    // Fallback: if begin and end exist without a path array, construct a 2-point path
    if (s.coordinates?.begin && s.coordinates?.end && (!s.coordinates.path || s.coordinates.path.length < 2)) {
      hasUpdates = true;
      return {
        ...s,
        coordinates: {
          ...s.coordinates,
          status: 'success',
          path: [s.coordinates.begin, s.coordinates.end],
        },
      };
    }
    return s;
  });

  return { sections: updated, hasUpdates };
}

/**
 * Batch generate coordinates for sections that do not yet have valid coordinates or full road curves.
 * Supports concurrent requests and real-time chunk streaming so maps update live.
 */
export async function batchGenerateCoordinates(
  sections,
  onProgress = null,
  { forceUpgradeCurves = false, concurrency = 4, onBatchChunk = null } = {}
) {
  if (!Array.isArray(sections) || sections.length === 0) return [];
  const results = [...sections];
  const toProcess = [];

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const hasCurvedPath = s.coordinates?.status === 'success' &&
                          Array.isArray(s.coordinates?.path) &&
                          s.coordinates.path.length > 2;

    if (forceUpgradeCurves || !hasCurvedPath) {
      toProcess.push({ index: i, section: s });
    }
  }

  if (toProcess.length === 0) return sections;

  let completed = 0;

  for (let i = 0; i < toProcess.length; i += concurrency) {
    const chunk = toProcess.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async ({ index, section }) => {
        try {
          const coords = await fetchCoordinatesForSection(section, { forceRefresh: true });
          if (coords && coords.status === 'success' && Array.isArray(coords.path) && coords.path.length > 2) {
            results[index] = { ...section, coordinates: coords };
          } else if (!section.coordinates || section.coordinates.status !== 'success') {
            results[index] = { ...section, coordinates: coords };
          }
        } catch (err) {
          console.warn(`Failed to resolve coordinates for ${section.id}:`, err);
        } finally {
          completed++;
          if (onProgress) {
            onProgress({ current: completed, total: toProcess.length, sectionId: section.id });
          }
        }
      })
    );

    if (onBatchChunk) {
      onBatchChunk([...results]);
    }
  }

  return results;
}

// ── Great-Circle / Haversine Distance & Stationing ───────────────────────────
export function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Radius of the Earth in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates estimated distance (in miles) of target point along the polyline path
 * from the begin coordinate.
 * Uses continuous orthogonal projection onto highway segments to smoothly
 * track mileage as the inspector steps along the road in Street View.
 */
export function calculateDistanceFromStart(targetCoord, rawPath, beginCoord) {
  if (!targetCoord || !Array.isArray(targetCoord)) return 0;
  const [tLat, tLon] = targetCoord;

  // Fallback if no valid path
  if (!rawPath || !Array.isArray(rawPath) || rawPath.length < 2) {
    if (beginCoord && Array.isArray(beginCoord)) {
      return Number(haversineDistanceMiles(beginCoord[0], beginCoord[1], tLat, tLon).toFixed(2));
    }
    return 0;
  }

  // Ensure path orientation starts from beginCoord
  let path = rawPath;
  if (beginCoord && Array.isArray(beginCoord)) {
    const distToFirst = haversineDistanceMiles(beginCoord[0], beginCoord[1], rawPath[0][0], rawPath[0][1]);
    const distToLast = haversineDistanceMiles(beginCoord[0], beginCoord[1], rawPath[rawPath.length - 1][0], rawPath[rawPath.length - 1][1]);
    if (distToLast < distToFirst) {
      path = [...rawPath].reverse();
    }
  }

  // Find the closest point projected onto each segment
  let minPerpDistance = Infinity;
  let bestOffset = 0;
  let accumulatedLength = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    const segLen = haversineDistanceMiles(p1[0], p1[1], p2[0], p2[1]);

    if (segLen === 0) continue;

    // Flat Earth projection approximation around segment midpoint
    const midLatRad = ((p1[0] + p2[0]) / 2) * (Math.PI / 180);
    const cosLat = Math.cos(midLatRad);

    const vX = (p2[1] - p1[1]) * cosLat;
    const vY = p2[0] - p1[0];
    const vLenSq = vX * vX + vY * vY;

    let t = 0;
    if (vLenSq > 0) {
      const pX = (tLon - p1[1]) * cosLat;
      const pY = tLat - p1[0];
      t = (pX * vX + pY * vY) / vLenSq;
    }

    // Clamp projection parameter to segment bounds [0, 1]
    const clampedT = Math.max(0, Math.min(1, t));

    // Projected coordinate on this segment
    const projLat = p1[0] + clampedT * (p2[0] - p1[0]);
    const projLon = p1[1] + clampedT * (p2[1] - p1[1]);

    const perpDist = haversineDistanceMiles(tLat, tLon, projLat, projLon);

    if (perpDist < minPerpDistance) {
      minPerpDistance = perpDist;
      bestOffset = accumulatedLength + clampedT * segLen;
    }

    accumulatedLength += segLen;
  }

  // If target point is beyond the polyline (e.g. perpendicular distance > 2 miles),
  // fallback to direct distance from begin point
  if (minPerpDistance > 2.0 && beginCoord && Array.isArray(beginCoord)) {
    return Number(haversineDistanceMiles(beginCoord[0], beginCoord[1], tLat, tLon).toFixed(2));
  }

  return Number(bestOffset.toFixed(2));
}

/**
 * Format a coordinate pair into a standard readable GPS string.
 */
export function formatGpsDisplay(coord) {
  if (!coord || !Array.isArray(coord) || coord.length < 2) return '—';
  const [lat, lon] = coord;
  if (typeof lat !== 'number' || typeof lon !== 'number') return '—';
  const latCard = lat >= 0 ? 'N' : 'S';
  const lonCard = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latCard}, ${Math.abs(lon).toFixed(4)}° ${lonCard}`;
}

/**
 * Generate Google Maps navigation URL for a coordinate pair.
 */
export function getGoogleMapsUrl(coord) {
  if (!coord || !Array.isArray(coord) || coord.length < 2) return null;
  return `https://www.google.com/maps/search/?api=1&query=${coord[0]},${coord[1]}`;
}

/**
 * Calculates initial compass heading in degrees (0–360) from p1 to p2.
 */
export function calculateSegmentHeading(p1, p2) {
  const lat1 = (p1[0] * Math.PI) / 180;
  const lat2 = (p2[0] * Math.PI / 180);
  const dLon = ((p2[1] - p1[1]) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((brng + 360) % 360);
}

/**
 * Calculates forward camera heading along the highway at target coordinate.
 */
export function calculateHighwayHeadingAtPoint(targetCoord, rawPath, beginCoord) {
  if (!targetCoord || !Array.isArray(targetCoord) || !rawPath || !Array.isArray(rawPath) || rawPath.length < 2) {
    return 0;
  }
  let path = rawPath;
  if (beginCoord && Array.isArray(beginCoord)) {
    const distToFirst = haversineDistanceMiles(beginCoord[0], beginCoord[1], rawPath[0][0], rawPath[0][1]);
    const distToLast = haversineDistanceMiles(beginCoord[0], beginCoord[1], rawPath[rawPath.length - 1][0], rawPath[rawPath.length - 1][1]);
    if (distToLast < distToFirst) {
      path = [...rawPath].reverse();
    }
  }

  const [tLat, tLon] = targetCoord;
  let minPerpDistance = Infinity;
  let bestHeading = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    const segLen = haversineDistanceMiles(p1[0], p1[1], p2[0], p2[1]);
    if (segLen === 0) continue;

    const midLatRad = ((p1[0] + p2[0]) / 2) * (Math.PI / 180);
    const cosLat = Math.cos(midLatRad);

    const vX = (p2[1] - p1[1]) * cosLat;
    const vY = p2[0] - p1[0];
    const vLenSq = vX * vX + vY * vY;

    let t = 0;
    if (vLenSq > 0) {
      const pX = (tLon - p1[1]) * cosLat;
      const pY = tLat - p1[0];
      t = (pX * vX + pY * vY) / vLenSq;
    }
    const clampedT = Math.max(0, Math.min(1, t));
    const projLat = p1[0] + clampedT * (p2[0] - p1[0]);
    const projLon = p1[1] + clampedT * (p2[1] - p1[1]);

    const perpDist = haversineDistanceMiles(tLat, tLon, projLat, projLon);
    if (perpDist < minPerpDistance) {
      minPerpDistance = perpDist;
      bestHeading = calculateSegmentHeading(p1, p2);
    }
  }
  return bestHeading;
}

/**
 * Calculates TxDOT Reference Marker for a given distance offset along a section.
 * Supports both ascending and descending roadbed mileage directions.
 * Returns { refMarker: number, refMarkerDisplay: string, baseMarker: number, displacement: number }
 */
export function calculateReferenceMarkerAtOffset(section, offsetMiles) {
  if (!section || offsetMiles == null || isNaN(offsetMiles)) return null;

  const beginRef = parseFloat(section.beginRef);
  const endRef = parseFloat(section.endRef);

  if (isNaN(beginRef)) return null;

  // Determine direction: default ascending if endRef >= beginRef or endRef is unknown
  const isAscending = isNaN(endRef) || endRef >= beginRef;
  const rawRm = isAscending ? (beginRef + offsetMiles) : (beginRef - offsetMiles);
  const refMarker = Number(rawRm.toFixed(3));

  const baseMarker = Math.floor(rawRm);
  const displacement = Number((rawRm - baseMarker).toFixed(3));
  const dispSign = displacement >= 0 ? '+' : '';
  const refMarkerDisplay = `RM ${baseMarker} ${dispSign}${displacement.toFixed(3)}`;

  return {
    refMarker,
    baseMarker,
    displacement,
    refMarkerDisplay,
    formatted: `RM ${refMarker.toFixed(3)}`,
  };
}

function isValidLatLng(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' &&
    !isNaN(lat) && !isNaN(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180;
}

/**
 * Robust coordinate parsing from text input or Google Maps URLs.
 * Supports:
 * - Decimal: "31.89613, -97.0686", "31.89613 -97.0686", "(31.89613, -97.0686)"
 * - Cardinal / Degrees: "31.89613° N, 97.0686° W", "31.89613N 97.0686W"
 * - DMS: 31°53'46.1"N 97°04'07.0"W or 31 53 46.1 N, 97 4 7 W
 * - Google Maps URLs: @lat,lng, query=lat,lng, q=lat,lng
 */
export function parseCoordinatesInput(input) {
  if (!input || typeof input !== 'string') return null;
  let str = input.trim();

  // 1. URLs: check for @lat,lng, query=lat,lng, or q=lat,lng
  const urlAtMatch = str.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (urlAtMatch) {
    const lat = parseFloat(urlAtMatch[1]);
    const lng = parseFloat(urlAtMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  const urlQueryMatch = str.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (urlQueryMatch) {
    const lat = parseFloat(urlQueryMatch[1]);
    const lng = parseFloat(urlQueryMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // Strip brackets, parentheses, quotes
  str = str.replace(/[()[\]"']/g, '').trim();

  // 2. Degrees Minutes Seconds (DMS) e.g. 31°53'46.1"N 97°04'07.0"W
  const dmsRegex = /(\d+)[°\s]+(\d+)['\s]+(\d+(?:\.\d+)?)["]?\s*([NSEW])\s*[,]?\s*(\d+)[°\s]+(\d+)['\s]+(\d+(?:\.\d+)?)["]?\s*([NSEW])/i;
  const dmsMatch = str.match(dmsRegex);
  if (dmsMatch) {
    let lat = parseInt(dmsMatch[1], 10) + parseInt(dmsMatch[2], 10) / 60 + parseFloat(dmsMatch[3]) / 3600;
    if (dmsMatch[4].toUpperCase() === 'S') lat = -lat;

    let lng = parseInt(dmsMatch[5], 10) + parseInt(dmsMatch[6], 10) / 60 + parseFloat(dmsMatch[7]) / 3600;
    if (dmsMatch[8].toUpperCase() === 'W') lng = -lng;

    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // 3. Decimal with Cardinal direction letters (e.g. "31.89613° N, 97.0686° W", "31.89613N, 97.0686W")
  const cardinalRegex = /(-?\d+(?:\.\d+)?)[°\s]*([NS])\s*[,]?\s*(-?\d+(?:\.\d+)?)[°\s]*([EW])/i;
  const cardMatch = str.match(cardinalRegex);
  if (cardMatch) {
    let lat = parseFloat(cardMatch[1]);
    if (cardMatch[2].toUpperCase() === 'S' && lat > 0) lat = -lat;

    let lng = parseFloat(cardMatch[3]);
    if (cardMatch[4].toUpperCase() === 'W' && lng > 0) lng = -lng;

    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // 4. Labeled coordinates e.g. "Lat: 31.89613, Lon: -97.06860"
  const labeledMatch = str.match(/lat(?:itude)?[:\s]+(-?\d+(?:\.\d+)?)[,\s]+lon(?:gitude)?[:\s]+(-?\d+(?:\.\d+)?)/i);
  if (labeledMatch) {
    const lat = parseFloat(labeledMatch[1]);
    const lng = parseFloat(labeledMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // 5. Standard decimal coordinates e.g. "31.89613, -97.0686" or "31.89613 -97.0686"
  const standardMatch = str.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
  if (standardMatch) {
    const lat = parseFloat(standardMatch[1]);
    const lng = parseFloat(standardMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // 6. Generic two floating numbers anywhere in string (e.g. "near 31.89613, -97.06860")
  const twoNumbersMatch = str.match(/(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)/);
  if (twoNumbersMatch) {
    const lat = parseFloat(twoNumbersMatch[1]);
    const lng = parseFloat(twoNumbersMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  return null;
}

