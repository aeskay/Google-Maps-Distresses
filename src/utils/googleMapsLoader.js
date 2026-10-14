/**
 * googleMapsLoader.js
 * Asynchronous loader for Google Maps JavaScript API and Street View Static API helpers.
 */

let loadPromise = null;
let currentLoadedKey = null;

const STORAGE_KEY = 'google_maps_api_key';

export function getStoredGoogleMapsApiKey() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {}
  return (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
}

export function saveGoogleMapsApiKey(key) {
  try {
    if (key && key.trim()) {
      localStorage.setItem(STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

/**
 * Loads the Google Maps JS SDK dynamically using the active API key.
 */
export function loadGoogleMapsApi(apiKey = null) {
  const keyToUse = apiKey || getStoredGoogleMapsApiKey();

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (loadPromise && currentLoadedKey === keyToUse) {
    return loadPromise;
  }

  currentLoadedKey = keyToUse;
  loadPromise = new Promise((resolve, reject) => {
    // If a script already exists, remove it if changing keys
    const existingScript = document.getElementById('google-maps-sdk-script');
    if (existingScript) existingScript.remove();

    const script = document.createElement('script');
    script.id = 'google-maps-sdk-script';
    const keyParam = keyToUse ? `&key=${encodeURIComponent(keyToUse)}` : '';
    script.src = `https://maps.googleapis.com/maps/api/js?libraries=geometry,places${keyParam}`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error('Google Maps script loaded, but window.google.maps was not found.'));
      }
    };

    script.onerror = (err) => {
      loadPromise = null;
      reject(new Error('Failed to load Google Maps script. Check your API key and network connection.'));
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Constructs a Street View Static API image URL.
 * Ideal for high-res crisp snapshot storage.
 */
export function getStreetViewStaticUrl(lat, lon, heading = 0, pitch = 0, fov = 90, apiKey = null, pano = null) {
  const key = apiKey || getStoredGoogleMapsApiKey();
  const base = 'https://maps.googleapis.com/maps/api/streetview';
  const params = new URLSearchParams({
    size: '640x480',
    location: `${lat},${lon}`,
    heading: String(Math.round(heading)),
    pitch: String(Math.round(pitch)),
    fov: String(Math.round(fov)),
  });

  if (pano) {
    params.set('pano', pano);
  }

  if (key) {
    params.set('key', key);
  }

  return `${base}?${params.toString()}`;
}

/**
 * Converts an image URL to a base64 Data URL (JPEG) so it can be stored persistently in Firestore/IndexedDB.
 */
export async function fetchImageAsDataUrl(imageUrl) {
  try {
    const res = await fetch(imageUrl);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('Could not fetch snapshot as base64 data URL, falling back to URL:', err);
    return imageUrl;
  }
}

let directionsServiceInstance = null;
const directionsCache = new Map();
let isDirectionsDenied = false;

export function getIsDirectionsApiDenied() {
  return isDirectionsDenied;
}

/**
 * Fetches the driving road path between beginCoord [lat, lng] and endCoord [lat, lng]
 * using the Google Maps DirectionsService SDK.
 * Returns { path: [[lat, lng], ...], lengthMiles: number } or { error: status, isDenied: boolean } or null.
 */
export async function fetchDirectionsRoadPath(beginCoord, endCoord) {
  if (isDirectionsDenied) {
    return { error: 'REQUEST_DENIED', isDenied: true };
  }

  if (!beginCoord || !endCoord || !Array.isArray(beginCoord) || !Array.isArray(endCoord)) {
    return null;
  }
  const [bLat, bLng] = beginCoord;
  const [eLat, eLng] = endCoord;
  if (typeof bLat !== 'number' || typeof bLng !== 'number' || typeof eLat !== 'number' || typeof eLng !== 'number') {
    return null;
  }

  // If start and end are practically identical (< 5 meters)
  if (Math.abs(bLat - eLat) < 0.00005 && Math.abs(bLng - eLng) < 0.00005) {
    return { path: [beginCoord, endCoord], lengthMiles: 0 };
  }

  const cacheKey = `${bLat.toFixed(6)},${bLng.toFixed(6)}->${eLat.toFixed(6)},${eLng.toFixed(6)}`;
  if (directionsCache.has(cacheKey)) {
    return directionsCache.get(cacheKey);
  }

  if (!window.google?.maps?.DirectionsService) {
    try {
      await loadGoogleMapsApi();
    } catch {
      return null;
    }
  }

  if (!window.google?.maps?.DirectionsService) {
    return null;
  }

  if (!directionsServiceInstance) {
    directionsServiceInstance = new window.google.maps.DirectionsService();
  }

  return new Promise((resolve) => {
    directionsServiceInstance.route(
      {
        origin: new window.google.maps.LatLng(bLat, bLng),
        destination: new window.google.maps.LatLng(eLat, eLng),
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK && result?.routes?.[0]?.overview_path) {
          const route = result.routes[0];
          const path = route.overview_path.map(pt => [
            Number(pt.lat().toFixed(6)),
            Number(pt.lng().toFixed(6)),
          ]);

          let totalMeters = 0;
          if (Array.isArray(route.legs)) {
            route.legs.forEach(leg => {
              if (leg.distance?.value) totalMeters += leg.distance.value;
            });
          }
          const lengthMiles = totalMeters > 0 ? Number((totalMeters / 1609.344).toFixed(3)) : null;

          const data = { path, lengthMiles };
          directionsCache.set(cacheKey, data);
          resolve(data);
        } else {
          if (status === 'REQUEST_DENIED') {
            isDirectionsDenied = true;
            console.warn('Google Directions API is not enabled on this Google Maps API key (REQUEST_DENIED).');
            resolve({ error: 'REQUEST_DENIED', isDenied: true });
          } else {
            console.warn(`DirectionsService route query ended with status: ${status}`);
            resolve({ error: status, isDenied: false });
          }
        }
      }
    );
  });
}
