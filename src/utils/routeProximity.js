/**
 * routeProximity.js
 * Geometric and distance utilities for calculating proximity between
 * project highway sections and Google Maps travel driving routes.
 */

import { parseCoordinatesInput } from './txdotGisApi';

const EARTH_RADIUS_MILES = 3958.8;

/**
 * Calculates Great-Circle distance in miles between two coordinates [lat, lng].
 */
export function haversineDistanceMiles(coord1, coord2) {
  if (!coord1 || !coord2) return Infinity;
  const [lat1, lon1] = coord1;
  const [lat2, lon2] = coord2;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_MILES * c;
}

/**
 * Calculates shortest distance in miles from a point P [lat, lng] to a line segment AB.
 */
export function distancePointToSegmentMiles(p, a, b) {
  const [pLat, pLng] = p;
  const [aLat, aLng] = a;
  const [bLat, bLng] = b;

  // Approximate flat projection around latitude
  const cosLat = Math.cos((pLat * Math.PI) / 180);
  const px = (pLng - aLng) * cosLat;
  const py = pLat - aLat;
  const bx = (bLng - aLng) * cosLat;
  const by = bLat - aLat;

  const segLenSq = bx * bx + by * by;
  if (segLenSq === 0) {
    return haversineDistanceMiles(p, a);
  }

  // Projection scalar t of AP onto AB clamped to [0, 1]
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / segLenSq));
  const closestLat = aLat + t * (bLat - aLat);
  const closestLng = aLng + t * (bLng - aLng);

  return haversineDistanceMiles(p, [closestLat, closestLng]);
}

/**
 * Extracts all known coordinates for a section as an array of [lat, lng].
 */
export function extractSectionCoordinates(sec) {
  if (!sec) return [];
  const coords = sec.coordinates;
  if (coords) {
    if (Array.isArray(coords.path) && coords.path.length >= 2) {
      return coords.path;
    }
    if (Array.isArray(coords.begin) && Array.isArray(coords.end)) {
      return [coords.begin, coords.end];
    }
    if (Array.isArray(coords.begin)) {
      return [coords.begin];
    }
  }

  // Fallback to gpsStart / gpsEnd string or object
  const pts = [];
  if (sec.gpsStart) {
    const p = typeof sec.gpsStart === 'string' ? parseCoordinatesInput(sec.gpsStart) : sec.gpsStart;
    if (p && !isNaN(p.lat) && !isNaN(p.lng)) pts.push([Number(p.lat), Number(p.lng)]);
  }
  if (sec.gpsEnd) {
    const p = typeof sec.gpsEnd === 'string' ? parseCoordinatesInput(sec.gpsEnd) : sec.gpsEnd;
    if (p && !isNaN(p.lat) && !isNaN(p.lng)) pts.push([Number(p.lat), Number(p.lng)]);
  }
  return pts;
}

/**
 * Calculates proximity metrics between a section's points and a travel route's path.
 *
 * @param {Array<[number, number]>} sectionPoints - Coordinates of the section.
 * @param {Array<[number, number]>} routePath - Array of [lat, lng] points representing the route.
 * @returns {{ minDistanceMiles: number, closestRouteIndex: number, routeProgressFraction: number }}
 */
export function calculateSectionRouteProximity(sectionPoints, routePath) {
  if (!Array.isArray(sectionPoints) || sectionPoints.length === 0 || !Array.isArray(routePath) || routePath.length === 0) {
    return { minDistanceMiles: Infinity, closestRouteIndex: -1, routeProgressFraction: 0 };
  }

  let minDistance = Infinity;
  let bestRouteIndex = 0;

  // Optimize: Sample section points (start, end, midpoints) if very long
  const sampleSection = sectionPoints.length > 20
    ? sectionPoints.filter((_, idx) => idx % Math.ceil(sectionPoints.length / 20) === 0 || idx === sectionPoints.length - 1)
    : sectionPoints;

  // Step through route segments
  for (let r = 0; r < routePath.length - 1; r++) {
    const rA = routePath[r];
    const rB = routePath[r + 1];

    for (let s = 0; s < sampleSection.length; s++) {
      const p = sampleSection[s];
      const dist = distancePointToSegmentMiles(p, rA, rB);
      if (dist < minDistance) {
        minDistance = dist;
        bestRouteIndex = r;
      }
    }
  }

  const fraction = routePath.length > 1 ? bestRouteIndex / (routePath.length - 1) : 0;

  return {
    minDistanceMiles: Number(minDistance.toFixed(2)),
    closestRouteIndex: bestRouteIndex,
    routeProgressFraction: Number(fraction.toFixed(3)),
  };
}
