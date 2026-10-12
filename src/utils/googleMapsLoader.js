/**
 * googleMapsLoader.js
 * Asynchronous loader for Google Maps JavaScript API and Street View Static API helpers.
 */

const API_KEY_STORAGE_KEY = 'txdot-distress:google-maps-api-key';

let loadPromise = null;
let currentLoadedKey = null;

export function getStoredGoogleMapsApiKey() {
  const custom = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (custom && custom.trim()) return custom.trim();
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
}

export function saveGoogleMapsApiKey(key) {
  if (key) {
    localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }
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
