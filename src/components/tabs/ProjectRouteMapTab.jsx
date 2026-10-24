/**
 * ProjectRouteMapTab.jsx
 * Interactive Google Map & Travel Route Planner for all project highway sections.
 *
 * Features:
 * - High-contrast "Plain Map" style toggle removing terrain/POI clutter so sections pop.
 * - Uniform, high-visibility pin markers and halo polylines for all sections.
 * - Driving route search supporting coordinates and place names.
 * - Seamless fallback navigation engine when Google Directions API is denied (REQUEST_DENIED).
 * - Proximity analysis: detects which sections fall along or near the driving route (within customizable radius).
 * - "Sections Along Trip" drawer with direct jump to Street View distress inspection.
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  loadGoogleMapsApi,
  getStoredGoogleMapsApiKey,
} from '../../utils/googleMapsLoader';
import {
  extractSectionCoordinates,
  calculateSectionRouteProximity,
} from '../../utils/routeProximity';
import { parseCoordinatesInput } from '../../utils/txdotGisApi';
import { formatDistrictDisplay } from '../../utils/normalizers';

const PROXIMITY_OPTIONS = [
  { label: '5 mi', value: 5 },
  { label: '10 mi', value: 10 },
  { label: '25 mi', value: 25 },
  { label: '50 mi', value: 50 },
  { label: 'All', value: Infinity },
];

// Clean minimalist map style removing terrain clutter, POIs, and noise
const PLAIN_MAP_STYLE = [
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ visibility: 'simplified' }, { color: '#cbd5e1' }],
  },
  {
    featureType: 'administrative.country',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#64748b' }],
  },
  {
    featureType: 'administrative.province',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#475569' }],
  },
  {
    featureType: 'landscape',
    elementType: 'geometry',
    stylers: [{ color: '#f8fafc' }], // Crisp clean off-white background
  },
  {
    featureType: 'landscape.man_made',
    elementType: 'geometry',
    stylers: [{ color: '#f1f5f9' }],
  },
  {
    featureType: 'poi',
    elementType: 'all',
    stylers: [{ visibility: 'off' }], // Strip all commercial / park green blobs
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#e2e8f0' }], // Muted light grey roads
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#cbd5e1' }], // Distinct but subtle highway network
  },
  {
    featureType: 'road.highway',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#94a3b8' }],
  },
  {
    featureType: 'transit',
    elementType: 'all',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#dbeafe' }], // Soft light blue water
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#93c5fd' }],
  },
];

/**
 * Free OSRM driving route fallback when Google Directions API returns REQUEST_DENIED.
 */
async function fetchOsrmDrivingRoute(originCoord, destCoord) {
  const [oLat, oLng] = originCoord;
  const [dLat, dLng] = destCoord;
  const url = `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  if (!res.ok) throw new Error('Public routing engine unavailable');
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
    throw new Error('No driving route found between these points');
  }

  const route = data.routes[0];
  // OSRM coordinates are [lng, lat]
  const pathCoords = route.geometry.coordinates.map(([lng, lat]) => [
    Number(lat.toFixed(6)),
    Number(lng.toFixed(6)),
  ]);

  const distanceMiles = Number((route.distance / 1609.344).toFixed(1));
  const totalSeconds = route.duration;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  const durationText = hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`;

  return {
    pathCoords,
    distanceMiles,
    durationText,
    summary: `${distanceMiles} miles (~${durationText})`,
  };
}

export default function ProjectRouteMapTab({
  project,
  sections = [],
  selectedSectionId,
  onSelectSection,
  onNavigateToTab,
  addToast,
  activeTab,
}) {
  const mapContainerRef = useRef(null);
  const googleMapRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const polylinesMapRef = useRef(new Map());
  const markersMapRef = useRef(new Map());
  const infoWindowRef = useRef(null);

  // Fallback route polyline and waypoint markers
  const fallbackPolylineRef = useRef(null);
  const fallbackMarkersRef = useRef([]);

  // User Device Location & Right-click feedback refs
  const userLocationMarkerRef = useRef(null);
  const userLocationCircleRef = useRef(null);
  const userLocationWatchIdRef = useRef(null);
  const copiedBadgeTimerRef = useRef(null);

  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [mapsError, setMapsError] = useState(null);

  // Map Style: 'plain' (Clean high-contrast) | 'roadmap' (Google standard) | 'hybrid' (Satellite)
  const [mapStyleType, setMapStyleType] = useState('plain');
  const [showSectionMarkers, setShowSectionMarkers] = useState(true);

  // Travel Route Search State
  const [originText, setOriginText] = useState('');
  const [destText, setDestText] = useState('');
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [isLocatingUser, setIsLocatingUser] = useState(false);
  const [isLocationActive, setIsLocationActive] = useState(false);
  const [userLocation, setUserLocation] = useState(null); // { lat, lng, accuracy }

  // Right-click copied coordinates feedback badge
  const [copiedCoordsBadge, setCopiedCoordsBadge] = useState(null); // { text, x, y }

  // Computed Directions Result
  const [directionsData, setDirectionsData] = useState(null);

  // Proximity & Filter State
  const [proximityMiles, setProximityMiles] = useState(10);
  const [onlyShowNearby, setOnlyShowNearby] = useState(false);
  const [activeSectionPopup, setActiveSectionPopup] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // ── Right-Click to Copy Coordinates ───────────────────────────────────────
  const handleMapRightClick = useCallback((e) => {
    if (!e || !e.latLng) return;
    const lat = typeof e.latLng.lat === 'function' ? e.latLng.lat() : e.latLng.lat;
    const lng = typeof e.latLng.lng === 'function' ? e.latLng.lng() : e.latLng.lng;
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return;

    const coordText = `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;

    // Copy to clipboard with fallback
    const copyToClipboard = async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(coordText);
        } else {
          throw new Error('Clipboard API not available');
        }
      } catch {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = coordText;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        } catch (err) {
          console.warn('Fallback copy failed:', err);
        }
      }
    };

    copyToClipboard();
    addToast?.('success', 'Coordinates Copied', `${coordText} copied to clipboard!`, 2500);

    // Position floating feedback badge on map canvas
    if (mapContainerRef.current) {
      const rect = mapContainerRef.current.getBoundingClientRect();
      let x = rect.width / 2;
      let y = rect.height / 2;
      if (e.domEvent && typeof e.domEvent.clientX === 'number') {
        x = e.domEvent.clientX - rect.left;
        y = e.domEvent.clientY - rect.top;
      }
      setCopiedCoordsBadge({ text: coordText, x, y });
      if (copiedBadgeTimerRef.current) clearTimeout(copiedBadgeTimerRef.current);
      copiedBadgeTimerRef.current = setTimeout(() => {
        setCopiedCoordsBadge(null);
      }, 2000);
    }
  }, [addToast]);

  // ── User Device Location Tracking ──────────────────────────────────────────
  const renderUserLocation = useCallback((lat, lng, accuracy, panTo = false) => {
    if (!googleMapRef.current || !window.google?.maps) return;
    const gMaps = window.google.maps;
    const map = googleMapRef.current;

    // Animated blue pulsing GPS dot
    const userLocationSvg = `
      <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
        <circle cx="20" cy="20" r="16" fill="rgba(37, 99, 235, 0.25)" stroke="rgba(37, 99, 235, 0.6)" stroke-width="1.5">
          <animate attributeName="r" values="10;18;10" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2s" repeatCount="indefinite"/>
        </circle>
        <circle cx="20" cy="20" r="7.5" fill="#2563eb" stroke="#ffffff" stroke-width="2.5"/>
      </svg>
    `;

    const icon = {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(userLocationSvg)}`,
      scaledSize: new gMaps.Size(40, 40),
      anchor: new gMaps.Point(20, 20),
    };

    if (userLocationMarkerRef.current) {
      userLocationMarkerRef.current.setPosition({ lat, lng });
      userLocationMarkerRef.current.setTitle(`Your Current Location (±${Math.round(accuracy)}m)`);
      userLocationMarkerRef.current.setMap(map);
    } else {
      const marker = new gMaps.Marker({
        position: { lat, lng },
        map,
        title: `Your Current Location (±${Math.round(accuracy)}m)`,
        icon,
        zIndex: 3000,
      });

      marker.addListener('click', () => {
        addToast?.('info', 'Your Location', `${lat.toFixed(6)}, ${lng.toFixed(6)} (±${Math.round(accuracy)}m)`);
      });

      marker.addListener('rightclick', handleMapRightClick);

      userLocationMarkerRef.current = marker;
    }

    // Accuracy Circle
    if (accuracy && accuracy > 0) {
      if (userLocationCircleRef.current) {
        userLocationCircleRef.current.setCenter({ lat, lng });
        userLocationCircleRef.current.setRadius(accuracy);
        userLocationCircleRef.current.setMap(map);
      } else {
        userLocationCircleRef.current = new gMaps.Circle({
          strokeColor: '#3b82f6',
          strokeOpacity: 0.45,
          strokeWeight: 1.5,
          fillColor: '#3b82f6',
          fillOpacity: 0.12,
          map,
          center: { lat, lng },
          radius: accuracy,
          zIndex: 2999,
          clickable: false,
        });
      }
    }

    if (panTo) {
      map.panTo({ lat, lng });
      if (map.getZoom() < 14) {
        map.setZoom(15);
      }
    }
  }, [addToast, handleMapRightClick]);

  const handleLocateUser = useCallback(() => {
    if (!navigator.geolocation) {
      addToast?.('error', 'Geolocation Unavailable', 'Your browser does not support geolocation.');
      return;
    }

    if (!googleMapRef.current || !window.google?.maps) {
      addToast?.('warning', 'Map Loading', 'Google Maps is still initializing. Please wait a moment.');
      return;
    }

    // If location is already active and known, pan immediately
    if (isLocationActive && userLocation) {
      renderUserLocation(userLocation.lat, userLocation.lng, userLocation.accuracy, true);
      addToast?.('info', 'Current Location', `Re-centered on your location (${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}).`);
    }

    setIsLocatingUser(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocatingUser(false);
        setIsLocationActive(true);
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy || 20;

        setUserLocation({ lat, lng, accuracy });
        renderUserLocation(lat, lng, accuracy, true);
        addToast?.('success', 'Location Found', `Centered on your location (${lat.toFixed(5)}, ${lng.toFixed(5)}).`);

        // Start background watch so the blue dot stays in sync as the user moves
        if (!userLocationWatchIdRef.current) {
          userLocationWatchIdRef.current = navigator.geolocation.watchPosition(
            (pos) => {
              const wLat = pos.coords.latitude;
              const wLng = pos.coords.longitude;
              const wAcc = pos.coords.accuracy || 20;
              setUserLocation({ lat: wLat, lng: wLng, accuracy: wAcc });
              renderUserLocation(wLat, wLng, wAcc, false);
            },
            (err) => {
              console.warn('Geolocation watch error:', err);
            },
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
          );
        }
      },
      (err) => {
        setIsLocatingUser(false);
        console.warn('Geolocation error:', err);
        let msg = 'Could not get your current location.';
        if (err.code === 1) {
          msg = 'Location permission was denied. Please allow location access in your browser settings.';
        } else if (err.code === 2) {
          msg = 'Location information is unavailable.';
        } else if (err.code === 3) {
          msg = 'Location request timed out.';
        }
        addToast?.('warning', 'Location Unavailable', msg);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }, [isLocationActive, userLocation, renderUserLocation, addToast]);

  // Clean up location markers on unmount
  useEffect(() => {
    return () => {
      if (userLocationWatchIdRef.current != null) {
        navigator.geolocation?.clearWatch(userLocationWatchIdRef.current);
        userLocationWatchIdRef.current = null;
      }
      if (userLocationMarkerRef.current) {
        userLocationMarkerRef.current.setMap(null);
        userLocationMarkerRef.current = null;
      }
      if (userLocationCircleRef.current) {
        userLocationCircleRef.current.setMap(null);
        userLocationCircleRef.current = null;
      }
      if (copiedBadgeTimerRef.current) {
        clearTimeout(copiedBadgeTimerRef.current);
        copiedBadgeTimerRef.current = null;
      }
    };
  }, []);

  // ── Load Google Maps JS API ───────────────────────────────────────────────
  useEffect(() => {
    const apiKey = getStoredGoogleMapsApiKey();
    if (!apiKey) {
      setMapsError('Missing Google Maps API Key. Please configure your key in Settings.');
      return;
    }

    setMapsError(null);
    loadGoogleMapsApi(apiKey)
      .then(() => setMapsLoaded(true))
      .catch((err) => {
        console.error('Failed to load Google Maps SDK:', err);
        setMapsError(err.message || 'Failed to load Google Maps.');
      });
  }, []);

  // ── Initialize Google Map ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mapsLoaded || !mapContainerRef.current || googleMapRef.current || !window.google?.maps) return;

    const gMaps = window.google.maps;
    const defaultCenter = { lat: 31.9686, lng: -99.9018 }; // Texas Center

    const map = new gMaps.Map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 6,
      mapTypeId: 'roadmap',
      styles: PLAIN_MAP_STYLE, // Default to Plain clean high-contrast map
      tilt: 0,
      streetViewControl: true,
      fullscreenControl: false,
      mapTypeControl: false, // Custom segmented toggle
    });

    googleMapRef.current = map;

    // Directions Renderer
    const renderer = new gMaps.DirectionsRenderer({
      map,
      suppressMarkers: false,
      polylineOptions: {
        strokeColor: '#2563eb',
        strokeWeight: 6,
        strokeOpacity: 0.9,
        zIndex: 60,
      },
    });
    directionsRendererRef.current = renderer;

    // Info Window
    infoWindowRef.current = new gMaps.InfoWindow();

    // Right-click anywhere on Google Map to copy coordinates
    map.addListener('rightclick', (e) => {
      handleMapRightClick(e);
    });

    // Prevent native browser context menu from covering map canvas on right-click
    const mapContainerEl = mapContainerRef.current;
    const handleContextMenu = (e) => e.preventDefault();
    if (mapContainerEl) {
      mapContainerEl.addEventListener('contextmenu', handleContextMenu);
    }

    // Re-render user location if it was already active
    if (userLocation) {
      renderUserLocation(userLocation.lat, userLocation.lng, userLocation.accuracy, false);
    }
  }, [mapsLoaded, handleMapRightClick, renderUserLocation, userLocation]);

  // ── Apply Map Style Toggle (Plain vs Roadmap vs Hybrid) ───────────────────
  useEffect(() => {
    if (!googleMapRef.current || !window.google?.maps) return;
    const map = googleMapRef.current;

    if (mapStyleType === 'plain') {
      map.setMapTypeId('roadmap');
      map.setOptions({ styles: PLAIN_MAP_STYLE });
    } else if (mapStyleType === 'roadmap') {
      map.setMapTypeId('roadmap');
      map.setOptions({ styles: null });
    } else if (mapStyleType === 'hybrid') {
      map.setMapTypeId('hybrid');
      map.setOptions({ styles: null });
    }
  }, [mapStyleType]);

  // Handle Tab Switch Resize
  useEffect(() => {
    if (activeTab === 'routeMap' && googleMapRef.current && window.google?.maps) {
      setTimeout(() => {
        window.google.maps.event.trigger(googleMapRef.current, 'resize');
      }, 50);
    }
  }, [activeTab]);

  // ── Calculate Proximity for all Project Sections ──────────────────────────
  const sectionsWithProximity = useMemo(() => {
    const routeCoords = directionsData?.pathCoords || null;

    return sections.map((sec) => {
      const points = extractSectionCoordinates(sec);
      const hasCoords = points.length >= 2 || (sec.coordinates?.begin && sec.coordinates?.end);

      if (!hasCoords || !routeCoords || routeCoords.length === 0) {
        return {
          ...sec,
          points,
          hasCoords,
          minDistanceMiles: null,
          routeProgressFraction: 0,
          isNearby: false,
        };
      }

      const proximity = calculateSectionRouteProximity(points, routeCoords);
      const isNearby = proximity.minDistanceMiles <= proximityMiles;

      return {
        ...sec,
        points,
        hasCoords,
        minDistanceMiles: proximity.minDistanceMiles,
        routeProgressFraction: proximity.routeProgressFraction,
        isNearby,
      };
    });
  }, [sections, directionsData, proximityMiles]);

  // Sections along the travel route sorted by trip progress (Origin -> Destination)
  const nearbySectionsAlongRoute = useMemo(() => {
    if (!directionsData) return [];
    return sectionsWithProximity
      .filter((s) => s.hasCoords && s.isNearby)
      .sort((a, b) => (a.routeProgressFraction ?? 0) - (b.routeProgressFraction ?? 0));
  }, [sectionsWithProximity, directionsData]);

  // ── Render Uniform High-Contrast Polylines & Pin Markers on Map ───────────
  useEffect(() => {
    if (!googleMapRef.current || !window.google?.maps) return;
    const gMaps = window.google.maps;
    const map = googleMapRef.current;
    const polyMap = polylinesMapRef.current;
    const markerMap = markersMapRef.current;

    const currentSecIds = new Set();

    // Uniform clean blue for all sections (no right/left/single differentiation)
    const defaultColor = '#2563eb';

    sectionsWithProximity.forEach((sec) => {
      const secId = String(sec.id);
      currentSecIds.add(secId);
      const points = sec.points;

      if (!points || points.length === 0) return;

      const pathLatLngs = points.map(([lat, lng]) => ({ lat, lng }));
      const hasRoute = !!directionsData;
      const isNearby = sec.isNearby;

      let strokeColor = defaultColor;
      let coreWeight = 5;
      let haloWeight = 9;
      let strokeOpacity = 1.0;
      let zIndex = 30;

      if (hasRoute) {
        if (isNearby) {
          strokeColor = '#059669'; // Bold Emerald for on/near route
          coreWeight = 7;
          haloWeight = 12;
          strokeOpacity = 1.0;
          zIndex = 100;
        } else {
          strokeColor = '#94a3b8'; // Muted Slate for off-route
          coreWeight = 2;
          haloWeight = 4;
          strokeOpacity = 0.4;
          zIndex = 10;
        }
      }

      const isVisible = !(hasRoute && onlyShowNearby && !isNearby);

      // ── 1. Polyline (Dual-layer: White Halo casing + Core line)
      let polyEntry = polyMap.get(secId);

      if (!polyEntry) {
        const haloPoly = new gMaps.Polyline({
          path: pathLatLngs,
          strokeColor: '#ffffff',
          strokeOpacity: isVisible ? 0.9 : 0,
          strokeWeight: haloWeight,
          zIndex: zIndex - 1,
          map,
        });

        const corePoly = new gMaps.Polyline({
          path: pathLatLngs,
          strokeColor,
          strokeOpacity: isVisible ? strokeOpacity : 0,
          strokeWeight: coreWeight,
          zIndex,
          map,
        });

        const clickHandler = (e) => handleSectionClick(sec, e.latLng);
        corePoly.addListener('click', clickHandler);
        haloPoly.addListener('click', clickHandler);
        corePoly.addListener('rightclick', handleMapRightClick);
        haloPoly.addListener('rightclick', handleMapRightClick);

        polyMap.set(secId, { corePoly, haloPoly, sec });
      } else {
        polyEntry.haloPoly.setPath(pathLatLngs);
        polyEntry.haloPoly.setOptions({
          strokeOpacity: isVisible ? 0.9 : 0,
          strokeWeight: haloWeight,
          zIndex: zIndex - 1,
        });

        polyEntry.corePoly.setPath(pathLatLngs);
        polyEntry.corePoly.setOptions({
          strokeColor,
          strokeOpacity: isVisible ? strokeOpacity : 0,
          strokeWeight: coreWeight,
          zIndex,
        });
        polyEntry.sec = sec;
      }

      // ── 2. Uniform Section Pin Marker (Identical dots for all sections)
      const markerPos = pathLatLngs[0];
      let markerEntry = markerMap.get(secId);

      const markerColor = hasRoute ? (isNearby ? '#059669' : '#94a3b8') : defaultColor;
      const markerScale = isNearby ? 8 : 6.5;

      const markerIcon = {
        path: gMaps.SymbolPath.CIRCLE,
        fillColor: markerColor,
        fillOpacity: 1.0,
        strokeColor: '#ffffff',
        strokeWeight: 2.5,
        scale: markerScale,
      };

      if (!markerEntry) {
        const marker = new gMaps.Marker({
          position: markerPos,
          icon: markerIcon,
          title: `${sec.highway || 'Section'} (ID: ${sec.id})`,
          zIndex: zIndex + 2,
          map: showSectionMarkers && isVisible ? map : null,
        });

        marker.addListener('click', () => handleSectionClick(sec, markerPos));
        marker.addListener('rightclick', handleMapRightClick);
        markerMap.set(secId, { marker, sec });
      } else {
        markerEntry.marker.setPosition(markerPos);
        markerEntry.marker.setIcon(markerIcon);
        markerEntry.marker.setZIndex(zIndex + 2);
        markerEntry.marker.setMap(showSectionMarkers && isVisible ? map : null);
        markerEntry.sec = sec;
      }
    });

    // Remove obsolete polylines and markers
    for (const [id, entry] of polyMap.entries()) {
      if (!currentSecIds.has(id)) {
        entry.corePoly.setMap(null);
        entry.haloPoly.setMap(null);
        polyMap.delete(id);
      }
    }
    for (const [id, entry] of markerMap.entries()) {
      if (!currentSecIds.has(id)) {
        entry.marker.setMap(null);
        markerMap.delete(id);
      }
    }
  }, [sectionsWithProximity, directionsData, onlyShowNearby, showSectionMarkers, handleMapRightClick]);

  // ── Fit Map Bounds to Project Sections ────────────────────────────────────
  const fitProjectBounds = useCallback(() => {
    if (!googleMapRef.current || !window.google?.maps || sections.length === 0) return;
    const gMaps = window.google.maps;
    const bounds = new gMaps.LatLngBounds();
    let pointCount = 0;

    sections.forEach((sec) => {
      const pts = extractSectionCoordinates(sec);
      pts.forEach(([lat, lng]) => {
        bounds.extend({ lat, lng });
        pointCount++;
      });
    });

    if (pointCount > 0) {
      googleMapRef.current.fitBounds(bounds, 50);
    }
  }, [sections]);

  // Auto-fit on initial map load if sections exist
  const hasAutoFittedRef = useRef(false);
  useEffect(() => {
    if (mapsLoaded && sections.length > 0 && !hasAutoFittedRef.current) {
      hasAutoFittedRef.current = true;
      setTimeout(fitProjectBounds, 300);
    }
  }, [mapsLoaded, sections.length, fitProjectBounds]);

  // ── Handle Section Click on Map ───────────────────────────────────────────
  const handleSectionClick = useCallback(
    (sec, clickLatLng) => {
      if (!googleMapRef.current || !window.google?.maps) return;
      setActiveSectionPopup(sec);

      const pos = clickLatLng || {
        lat: sec.coordinates?.begin?.[0] || sec.points?.[0]?.[0] || 31.9686,
        lng: sec.coordinates?.begin?.[1] || sec.points?.[0]?.[1] || -99.9018,
      };

      const distNote = sec.minDistanceMiles != null
        ? `<div style="font-size:12px; font-weight:700; color:${sec.isNearby ? '#059669' : '#64748b'}; margin-bottom:6px;">
            ${sec.minDistanceMiles === 0 ? '🎯 Directly on driving route' : `📍 ${sec.minDistanceMiles} mi off travel route`}
           </div>`
        : '';

      const contentString = `
        <div style="font-family:sans-serif; min-width:210px; max-width:280px; padding:4px 0;">
          <div style="font-weight:700; font-size:14px; color:#0f172a; margin-bottom:2px;">
            ${sec.highway || 'Highway Section'}
          </div>
          <div style="font-size:12px; color:#475569; margin-bottom:6px;">ID: ${sec.id}</div>
          ${distNote}
          <div style="font-size:11px; color:#64748b; line-height:1.4; margin-bottom:10px;">
            RM: ${sec.beginRefMarker || 'Start'} to ${sec.endRefMarker || 'End'}<br/>
            ${sec.county ? `County: ${sec.county}<br/>` : ''}
            ${sec.district ? `District: ${formatDistrictDisplay(sec.district)}` : ''}
          </div>
          <div style="display:flex; gap:6px;">
            <button id="btn-inspect-section" style="flex:1; background:#0f172a; color:#fff; border:none; padding:7px 10px; font-size:11px; font-weight:600; border-radius:6px; cursor:pointer;">
              📸 Inspect Street View
            </button>
          </div>
        </div>
      `;

      if (infoWindowRef.current) {
        infoWindowRef.current.setContent(contentString);
        infoWindowRef.current.setPosition(pos);
        infoWindowRef.current.open(googleMapRef.current);

        setTimeout(() => {
          const btn = document.getElementById('btn-inspect-section');
          if (btn) {
            btn.onclick = () => {
              if (onSelectSection) onSelectSection(sec.id);
              if (onNavigateToTab) onNavigateToTab('map');
            };
          }
        }, 100);
      }
    },
    [onSelectSection, onNavigateToTab]
  );

  // ── Helper to resolve an input string to [lat, lng] ────────────────────────
  const resolveCoord = useCallback(async (inputStr, gMaps) => {
    const trimmed = (inputStr || '').trim();
    if (!trimmed) return null;

    // Check if input is GPS coordinates
    const parsed = parseCoordinatesInput(trimmed);
    if (parsed && !isNaN(parsed.lat) && !isNaN(parsed.lng)) {
      return [parsed.lat, parsed.lng];
    }

    // Otherwise use Google Geocoder
    if (gMaps?.Geocoder) {
      try {
        const geocoder = new gMaps.Geocoder();
        const res = await new Promise((resolve) => {
          geocoder.geocode({ address: trimmed }, (results, status) => {
            if (status === 'OK' && results?.[0]?.geometry?.location) {
              const loc = results[0].geometry.location;
              resolve([loc.lat(), loc.lng()]);
            } else {
              resolve(null);
            }
          });
        });
        if (res) return res;
      } catch (err) {
        console.warn('Geocoding error:', err);
      }
    }

    return null;
  }, []);

  // ── Calculate Driving Route (Google Directions with Seamless OSRM Fallback) ─
  const handleCalculateRoute = useCallback(
    async (e) => {
      if (e) e.preventDefault();
      const origin = originText.trim();
      const destination = destText.trim();

      if (!origin || !destination) {
        addToast?.('warning', 'Missing Locations', 'Please enter both an Origin and a Destination.');
        return;
      }

      if (!googleMapRef.current || !window.google?.maps) {
        addToast?.('error', 'Map Not Ready', 'Google Maps is still loading. Please wait a moment.');
        return;
      }

      setIsCalculatingRoute(true);
      const gMaps = window.google.maps;
      const map = googleMapRef.current;

      // Clear any previous fallback polyline & markers
      if (fallbackPolylineRef.current) {
        fallbackPolylineRef.current.setMap(null);
        fallbackPolylineRef.current = null;
      }
      fallbackMarkersRef.current.forEach((m) => m.setMap(null));
      fallbackMarkersRef.current = [];

      // Resolve coordinates
      const [oCoord, dCoord] = await Promise.all([
        resolveCoord(origin, gMaps),
        resolveCoord(destination, gMaps),
      ]);

      const applyFallbackRoute = async () => {
        if (!oCoord || !dCoord) {
          throw new Error('Could not resolve GPS coordinates for origin or destination.');
        }

        const fallback = await fetchOsrmDrivingRoute(oCoord, dCoord);

        // Draw driving path on map
        const pathLatLngs = fallback.pathCoords.map(([lat, lng]) => ({ lat, lng }));

        const poly = new gMaps.Polyline({
          path: pathLatLngs,
          strokeColor: '#2563eb',
          strokeWeight: 6,
          strokeOpacity: 0.9,
          zIndex: 60,
          map,
        });
        poly.addListener('rightclick', handleMapRightClick);
        fallbackPolylineRef.current = poly;

        // Place Origin and Destination Pins
        const originMarker = new gMaps.Marker({
          position: { lat: oCoord[0], lng: oCoord[1] },
          map,
          label: { text: 'A', color: '#ffffff', fontWeight: 'bold' },
          title: `Origin: ${origin}`,
          zIndex: 70,
        });
        originMarker.addListener('rightclick', handleMapRightClick);

        const destMarker = new gMaps.Marker({
          position: { lat: dCoord[0], lng: dCoord[1] },
          map,
          label: { text: 'B', color: '#ffffff', fontWeight: 'bold' },
          title: `Destination: ${destination}`,
          zIndex: 70,
        });
        destMarker.addListener('rightclick', handleMapRightClick);
        fallbackMarkersRef.current = [originMarker, destMarker];

        // Fit map bounds
        const bounds = new gMaps.LatLngBounds();
        pathLatLngs.forEach((pt) => bounds.extend(pt));
        map.fitBounds(bounds, 50);

        setDirectionsData({
          pathCoords: fallback.pathCoords,
          distanceMiles: fallback.distanceMiles,
          durationText: fallback.durationText,
          summary: `${fallback.distanceMiles} mi via driving road corridor`,
        });

        addToast?.(
          'info',
          'Route Planned',
          `${fallback.distanceMiles} miles (~${fallback.durationText}). Finding sections along your route.`
        );
      };

      // Try Google DirectionsService first
      const directionsService = new gMaps.DirectionsService();
      const originParam = oCoord ? new gMaps.LatLng(oCoord[0], oCoord[1]) : origin;
      const destParam = dCoord ? new gMaps.LatLng(dCoord[0], dCoord[1]) : destination;

      directionsService.route(
        {
          origin: originParam,
          destination: destParam,
          travelMode: gMaps.TravelMode.DRIVING,
        },
        async (result, status) => {
          if (status === gMaps.DirectionsStatus.OK && result) {
            setIsCalculatingRoute(false);
            directionsRendererRef.current?.setDirections(result);

            const route = result.routes[0];
            const pathCoords = route.overview_path.map((pt) => [
              Number(pt.lat().toFixed(6)),
              Number(pt.lng().toFixed(6)),
            ]);

            let totalMeters = 0;
            let totalSeconds = 0;
            route.legs.forEach((l) => {
              totalMeters += l.distance?.value || 0;
              totalSeconds += l.duration?.value || 0;
            });

            const distanceMiles = (totalMeters / 1609.344).toFixed(1);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.round((totalSeconds % 3600) / 60);
            const durationText = hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`;

            setDirectionsData({
              result,
              route,
              pathCoords,
              distanceMiles,
              durationText,
              summary: route.summary || `${origin} to ${destination}`,
            });

            addToast?.(
              'success',
              'Route Calculated',
              `${distanceMiles} miles (~${durationText}). Finding project sections along your route.`
            );
          } else {
            console.warn(`Google Directions returned ${status}. Attempting seamless driving route fallback.`);
            try {
              await applyFallbackRoute();
            } catch (err) {
              console.error('Routing failed:', err);
              addToast?.(
                'error',
                'Route Failed',
                'Unable to calculate driving route. Please verify GPS coordinates or location spelling.'
              );
            } finally {
              setIsCalculatingRoute(false);
            }
          }
        }
      );
    },
    [originText, destText, resolveCoord, addToast]
  );

  // ── Clear Route ───────────────────────────────────────────────────────────
  const handleClearRoute = useCallback(() => {
    if (directionsRendererRef.current) {
      directionsRendererRef.current.set('directions', null);
    }
    if (fallbackPolylineRef.current) {
      fallbackPolylineRef.current.setMap(null);
      fallbackPolylineRef.current = null;
    }
    fallbackMarkersRef.current.forEach((m) => m.setMap(null));
    fallbackMarkersRef.current = [];

    setDirectionsData(null);
    infoWindowRef.current?.close();
    setActiveSectionPopup(null);
    fitProjectBounds();
  }, [fitProjectBounds]);

  // ── Reverse / Swap Locations ──────────────────────────────────────────────
  const handleSwapLocations = useCallback(() => {
    setOriginText(destText);
    setDestText(originText);
  }, [originText, destText]);

  // ── Current Geolocation Helper ────────────────────────────────────────────
  const handleUseCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      addToast?.('warning', 'Geolocation Unavailable', 'Your browser does not support GPS location.');
      return;
    }

    setIsLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocatingUser(false);
        setIsLocationActive(true);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy || 20;
        setOriginText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        setUserLocation({ lat, lng, accuracy });
        renderUserLocation(lat, lng, accuracy, true);
        addToast?.('info', 'Location Set', 'Origin set to your current GPS position.');
      },
      (err) => {
        setIsLocatingUser(false);
        addToast?.('error', 'Location Error', err.message || 'Unable to retrieve your current location.');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, [addToast, renderUserLocation]);

  // ── Pan and Zoom to a Specific Section ────────────────────────────────────
  const handleFocusSection = useCallback(
    (sec) => {
      if (!googleMapRef.current || !window.google?.maps || !sec) return;
      const gMaps = window.google.maps;
      const pts = extractSectionCoordinates(sec);

      if (pts.length > 0) {
        const bounds = new gMaps.LatLngBounds();
        pts.forEach(([lat, lng]) => bounds.extend({ lat, lng }));
        googleMapRef.current.fitBounds(bounds, 60);

        handleSectionClick(sec, bounds.getCenter());
      }
    },
    [handleSectionClick]
  );

  // Mapped vs Total count
  const mappedCount = useMemo(
    () => sectionsWithProximity.filter((s) => s.hasCoords).length,
    [sectionsWithProximity]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--bg-base)' }}>
      {/* ── Top Travel & Route Search Bar ── */}
      <div
        style={{
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-default)',
          padding: '12px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          {/* Title & Overview Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🗺️</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                Project Sections & Travel Map
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {mappedCount} of {sections.length} sections mapped across Texas highway network
              </div>
            </div>
          </div>

          {/* Quick Map Controls & Plain Map Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Map Style Segmented Control */}
            <div
              style={{
                display: 'inline-flex',
                background: 'var(--bg-elevated)',
                padding: 2,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
              }}
            >
              <button
                type="button"
                className={`btn btn--xs ${mapStyleType === 'plain' ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setMapStyleType('plain')}
                title="Plain clean high-contrast map with no terrain clutter"
                style={{ fontSize: 11, padding: '3px 9px', borderRadius: 'var(--radius-sm)' }}
              >
                🗺️ Plain Map
              </button>
              <button
                type="button"
                className={`btn btn--xs ${mapStyleType === 'roadmap' ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setMapStyleType('roadmap')}
                title="Standard Google Roads"
                style={{ fontSize: 11, padding: '3px 9px', borderRadius: 'var(--radius-sm)' }}
              >
                🛣️ Roads
              </button>
              <button
                type="button"
                className={`btn btn--xs ${mapStyleType === 'hybrid' ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setMapStyleType('hybrid')}
                title="Satellite Imagery"
                style={{ fontSize: 11, padding: '3px 9px', borderRadius: 'var(--radius-sm)' }}
              >
                🛰️ Satellite
              </button>
            </div>

            {/* My Location GPS Button */}
            <button
              type="button"
              className={`btn btn--xs ${isLocationActive ? 'btn--primary' : 'btn--ghost'}`}
              onClick={handleLocateUser}
              disabled={isLocatingUser}
              title={isLocationActive ? "Re-center map on your location" : "Show my current location on map"}
              style={{
                fontSize: 11,
                padding: '3px 9px',
                borderRadius: 'var(--radius-sm)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontWeight: isLocationActive ? 700 : 500,
                boxShadow: isLocationActive ? '0 0 8px rgba(37, 99, 235, 0.4)' : 'none',
              }}
            >
              <span>📍</span>
              <span>{isLocatingUser ? 'Locating...' : 'My Location'}</span>
            </button>

            {/* Toggle Section Markers */}
            <button
              className={`btn btn--xs ${showSectionMarkers ? 'btn--secondary' : 'btn--ghost'}`}
              onClick={() => setShowSectionMarkers((v) => !v)}
              title="Toggle visible pin markers on section locations"
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              📍 {showSectionMarkers ? 'Pins ON' : 'Pins OFF'}
            </button>

            <button
              className="btn btn--secondary btn--sm"
              onClick={fitProjectBounds}
              title="Fit map view to all project sections"
              style={{ fontSize: 11 }}
            >
              All Sections
            </button>

            {directionsData && (
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  if (directionsData?.route?.bounds && googleMapRef.current) {
                    googleMapRef.current.fitBounds(directionsData.route.bounds, 50);
                  }
                }}
                title="Fit map view to calculated driving route"
                style={{ fontSize: 11 }}
              >
                Fit Route
              </button>
            )}

            <button
              className={`btn btn--sm ${isSidebarOpen ? 'btn--secondary' : 'btn--ghost'}`}
              onClick={() => setIsSidebarOpen((v) => !v)}
              title="Toggle Sections Drawer"
              style={{ fontSize: 11 }}
            >
              📋 {isSidebarOpen ? 'Hide Drawer' : 'Show Sections'}
            </button>
          </div>
        </div>

        {/* Search Inputs Row (Freeform text or GPS coordinates) */}
        <form
          onSubmit={handleCalculateRoute}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {/* Origin Input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 240px', minWidth: 200, position: 'relative' }}>
            <span style={{ fontSize: 13, color: '#10b981', fontWeight: 700 }}>A</span>
            <input
              type="text"
              className="form-input"
              placeholder="Origin (address, city, or lat, lng)"
              value={originText}
              onChange={(e) => setOriginText(e.target.value)}
              style={{ width: '100%', fontSize: 12, paddingRight: 32 }}
            />
            <button
              type="button"
              className="btn btn--ghost btn--icon-sm"
              onClick={handleUseCurrentLocation}
              title="Use my current GPS location as Origin"
              style={{ position: 'absolute', right: 4, top: 4 }}
              disabled={isLocatingUser}
            >
              {isLocatingUser ? '⏳' : '📍'}
            </button>
          </div>

          {/* Swap Button */}
          <button
            type="button"
            className="btn btn--ghost btn--icon-sm"
            onClick={handleSwapLocations}
            title="Swap Origin and Destination"
            style={{ fontSize: 14 }}
          >
            ⇅
          </button>

          {/* Destination Input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 240px', minWidth: 200 }}>
            <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 700 }}>B</span>
            <input
              type="text"
              className="form-input"
              placeholder="Destination (address, city, or lat, lng)"
              value={destText}
              onChange={(e) => setDestText(e.target.value)}
              style={{ width: '100%', fontSize: 12 }}
            />
          </div>

          {/* Plan Route Action Buttons */}
          <button
            type="submit"
            className="btn btn--primary btn--sm"
            disabled={isCalculatingRoute || !originText.trim() || !destText.trim()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px' }}
          >
            {isCalculatingRoute ? (
              <>
                <span className="spinner" style={{ width: 12, height: 12 }} />
                <span>Routing…</span>
              </>
            ) : (
              <>
                <span>🚗</span>
                <span>Get Route</span>
              </>
            )}
          </button>

          {directionsData && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={handleClearRoute}
              title="Clear driving route and reset map"
            >
              ✕ Clear
            </button>
          )}
        </form>

        {/* Filter & Proximity Settings Row */}
        {directionsData && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              paddingTop: 8,
              borderTop: '1px solid var(--border-subtle)',
              fontSize: 12,
              flexWrap: 'wrap',
            }}
          >
            {/* Driving Trip Summary Banner */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                🛣️ {directionsData.summary}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>•</span>
              <span style={{ color: 'var(--text-secondary)' }}>{directionsData.distanceMiles} miles</span>
              <span style={{ color: 'var(--text-muted)' }}>•</span>
              <span style={{ color: 'var(--text-secondary)' }}>~{directionsData.durationText}</span>
              <span style={{ color: 'var(--text-muted)' }}>•</span>
              <span
                style={{
                  background: nearbySectionsAlongRoute.length > 0 ? '#dcfce7' : '#f1f5f9',
                  color: nearbySectionsAlongRoute.length > 0 ? '#15803d' : '#64748b',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  fontWeight: 600,
                  fontSize: 11,
                }}
              >
                🎯 {nearbySectionsAlongRoute.length} section{nearbySectionsAlongRoute.length === 1 ? '' : 's'} on/near route
              </span>
            </div>

            {/* Proximity Radius Options */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Search Buffer:</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {PROXIMITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    className={`btn btn--xs ${proximityMiles === opt.value ? 'btn--primary' : 'btn--secondary'}`}
                    onClick={() => setProximityMiles(opt.value)}
                    style={{ fontSize: 10, padding: '2px 8px' }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8, cursor: 'pointer', fontSize: 11 }}>
                <input
                  type="checkbox"
                  checked={onlyShowNearby}
                  onChange={(e) => setOnlyShowNearby(e.target.checked)}
                />
                <span style={{ color: 'var(--text-secondary)' }}>Hide distant sections</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* ── Main Workspace: Map & Sections Drawer ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        {/* Google Map Container */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {/* Floating My Location Map Button */}
          {!mapsError && (
            <button
              type="button"
              onClick={handleLocateUser}
              disabled={isLocatingUser}
              title={isLocationActive ? "Re-center map on your location" : "Show my current location"}
              aria-label="Show my current location"
              style={{
                position: 'absolute',
                top: 14,
                right: 14,
                zIndex: 25,
                width: 38,
                height: 38,
                borderRadius: '50%',
                background: isLocationActive ? 'var(--accent-primary, #2563eb)' : 'var(--bg-surface, #ffffff)',
                color: isLocationActive ? '#ffffff' : 'var(--text-primary, #1e293b)',
                border: isLocationActive ? '2px solid #ffffff' : '1.5px solid var(--border-default, #cbd5e1)',
                boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: isLocatingUser ? 'wait' : 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {isLocatingUser ? (
                <span style={{ fontSize: 14 }}>⏳</span>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                </svg>
              )}
            </button>
          )}

          {/* Right-click Copied Coordinates Floating Badge */}
          {copiedCoordsBadge && (
            <div
              style={{
                position: 'absolute',
                left: Math.max(90, Math.min(copiedCoordsBadge.x, (mapContainerRef.current?.clientWidth || 400) - 90)),
                top: Math.max(30, copiedCoordsBadge.y - 12),
                transform: 'translate(-50%, -100%)',
                background: 'rgba(15, 23, 42, 0.94)',
                backdropFilter: 'blur(8px)',
                border: '1.5px solid #10b981',
                color: '#ffffff',
                padding: '5px 12px',
                borderRadius: '8px',
                fontSize: 12,
                fontWeight: 700,
                boxShadow: '0 4px 16px rgba(0,0,0,0.4), 0 0 10px rgba(16, 185, 129, 0.3)',
                pointerEvents: 'none',
                zIndex: 100,
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ color: '#10b981', fontSize: 13 }}>✓ Copied</span>
              <span style={{ color: '#f8fafc', fontWeight: 600 }}>{copiedCoordsBadge.text}</span>
            </div>
          )}

          {mapsError ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                color: 'var(--accent-danger)',
                background: 'var(--bg-elevated)',
                textAlign: 'center',
              }}
            >
              <span style={{ fontSize: 32, marginBottom: 12 }}>⚠️</span>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Google Maps Error</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 440 }}>{mapsError}</div>
            </div>
          ) : (
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
          )}
        </div>

        {/* ── Right Drawer: Sections Along Travel Route ── */}
        {isSidebarOpen && (
          <aside
            style={{
              width: 340,
              background: 'var(--bg-surface)',
              borderLeft: '1px solid var(--border-default)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              boxShadow: '-2px 0 8px rgba(0,0,0,0.03)',
              zIndex: 8,
            }}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border-default)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                  {directionsData ? 'Sections Along Trip' : 'Project Sections'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {directionsData
                    ? `${nearbySectionsAlongRoute.length} sections found on this route`
                    : `${mappedCount} sections available`}
                </div>
              </div>
              <button
                className="btn btn--ghost btn--icon-sm"
                onClick={() => setIsSidebarOpen(false)}
                title="Collapse drawer"
              >
                ✕
              </button>
            </div>

            {/* Drawer Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {directionsData ? (
                nearbySectionsAlongRoute.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '36px 12px', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>🛣️</div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>
                      No Sections Along This Route
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                      None of your project sections fall within {proximityMiles} miles of this route.
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <button
                        className="btn btn--secondary btn--xs"
                        onClick={() => setProximityMiles(50)}
                      >
                        Expand Search Buffer to 50 mi
                      </button>
                    </div>
                  </div>
                ) : (
                  nearbySectionsAlongRoute.map((sec, idx) => {
                    const isSelected = activeSectionPopup?.id === sec.id;

                    return (
                      <div
                        key={sec.id}
                        onClick={() => handleFocusSection(sec)}
                        style={{
                          background: isSelected ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                          border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                          borderRadius: 'var(--radius-md)',
                          padding: 10,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        {/* Section Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: '50%',
                                background: '#059669',
                                color: '#fff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 10,
                                fontWeight: 700,
                              }}
                            >
                              {idx + 1}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                              {sec.highway}
                            </span>
                          </div>

                          {/* Off-route proximity badge */}
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              background: sec.minDistanceMiles === 0 ? '#dcfce7' : '#e0f2fe',
                              color: sec.minDistanceMiles === 0 ? '#15803d' : '#0369a1',
                              padding: '2px 6px',
                              borderRadius: 'var(--radius-full)',
                            }}
                          >
                            {sec.minDistanceMiles === 0 ? 'On route' : `${sec.minDistanceMiles} mi off`}
                          </span>
                        </div>

                        {/* Details */}
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          ID: <span style={{ fontWeight: 600 }}>{sec.id}</span>
                          {sec.county && ` · ${sec.county}`}
                        </div>

                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          RM: {sec.beginRefMarker || 'Start'} → {sec.endRefMarker || 'End'}
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          <button
                            type="button"
                            className="btn btn--secondary btn--xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFocusSection(sec);
                            }}
                            style={{ flex: 1, justifyContent: 'center' }}
                          >
                            🔍 View
                          </button>
                          <button
                            type="button"
                            className="btn btn--primary btn--xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onSelectSection) onSelectSection(sec.id);
                              if (onNavigateToTab) onNavigateToTab('map');
                            }}
                            style={{ flex: 1, justifyContent: 'center' }}
                          >
                            📸 Street View
                          </button>
                        </div>
                      </div>
                    );
                  })
                )
              ) : (
                /* No route yet — show project sections overview */
                <div>
                  <div
                    style={{
                      background: 'var(--bg-elevated)',
                      padding: 10,
                      borderRadius: 'var(--radius-md)',
                      marginBottom: 10,
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.4,
                    }}
                  >
                    💡 <strong>Travel Search:</strong> Enter your trip Origin and Destination above (city, address, or GPS coordinates) to see which sections you can visit on your drive!
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sections.map((sec) => {
                      const pts = extractSectionCoordinates(sec);
                      const isMapped = pts.length >= 2 || (sec.coordinates?.begin && sec.coordinates?.end);

                      return (
                        <div
                          key={sec.id}
                          onClick={() => isMapped && handleFocusSection(sec)}
                          style={{
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-default)',
                            borderRadius: 'var(--radius-md)',
                            padding: 8,
                            cursor: isMapped ? 'pointer' : 'default',
                            opacity: isMapped ? 1 : 0.6,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 3,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)' }}>
                              {sec.highway || 'Section'}
                            </span>
                            <span style={{ fontSize: 10, color: isMapped ? '#10b981' : '#94a3b8' }}>
                              {isMapped ? '● Mapped' : '○ No GPS'}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            ID: {sec.id} {sec.county ? `· ${sec.county}` : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
