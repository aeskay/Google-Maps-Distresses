/**
 * ProjectRouteMapTab.jsx
 * Interactive Google Map & Travel Route Planner for all project highway sections.
 *
 * Features:
 * - Full geographic map showing all project sections with start/end coordinates and polylines.
 * - Google Maps driving route search between two locations (Origin & Destination) with Autocomplete.
 * - Proximity analysis: detects which sections fall along or near the driving route (within customizable radius).
 * - Highlights on-route sections and provides trip order listing to easily visit sections while traveling.
 * - Seamless jump to Map & Street View tab for full pavement distress inspection.
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
import { formatDistrictDisplay } from '../../utils/normalizers';

const PROXIMITY_OPTIONS = [
  { label: '5 mi', value: 5 },
  { label: '10 mi', value: 10 },
  { label: '25 mi', value: 25 },
  { label: '50 mi', value: 50 },
  { label: 'All', value: Infinity },
];

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
  const originInputRef = useRef(null);
  const destInputRef = useRef(null);

  const googleMapRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const polylinesMapRef = useRef(new Map());
  const extentMarkersRef = useRef([]);
  const infoWindowRef = useRef(null);
  const originAutocompleteRef = useRef(null);
  const destAutocompleteRef = useRef(null);

  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [mapsError, setMapsError] = useState(null);

  // Travel Route Search State
  const [originText, setOriginText] = useState('');
  const [destText, setDestText] = useState('');
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [isLocatingUser, setIsLocatingUser] = useState(false);

  // Computed Directions Result
  const [directionsData, setDirectionsData] = useState(null); // { route, pathCoords, distanceText, durationText, summary }
  const [routeWaypoints, setRouteWaypoints] = useState([]); // Array of { location: string, label: string }

  // Proximity & Filter State
  const [proximityMiles, setProximityMiles] = useState(10);
  const [onlyShowNearby, setOnlyShowNearby] = useState(false);
  const [activeSectionPopup, setActiveSectionPopup] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

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
      tilt: 0,
      streetViewControl: true,
      fullscreenControl: false,
      mapTypeControlOptions: {
        style: gMaps.MapTypeControlStyle.DROPDOWN_MENU,
        position: gMaps.ControlPosition.TOP_RIGHT,
      },
    });

    googleMapRef.current = map;

    // Directions Renderer
    const renderer = new gMaps.DirectionsRenderer({
      map,
      suppressMarkers: false,
      polylineOptions: {
        strokeColor: '#2563eb',
        strokeWeight: 6,
        strokeOpacity: 0.85,
        zIndex: 50,
      },
    });
    directionsRendererRef.current = renderer;

    // Info Window
    infoWindowRef.current = new gMaps.InfoWindow();

    // Attach Autocomplete to inputs if Places library is available
    if (gMaps.places && originInputRef.current && destInputRef.current) {
      try {
        const originAuto = new gMaps.places.Autocomplete(originInputRef.current, {
          types: ['geocode', 'establishment'],
          componentRestrictions: { country: 'us' },
        });
        originAuto.addListener('place_changed', () => {
          const place = originAuto.getPlace();
          if (place?.formatted_address || place?.name) {
            setOriginText(place.formatted_address || place.name);
          }
        });
        originAutocompleteRef.current = originAuto;

        const destAuto = new gMaps.places.Autocomplete(destInputRef.current, {
          types: ['geocode', 'establishment'],
          componentRestrictions: { country: 'us' },
        });
        destAuto.addListener('place_changed', () => {
          const place = destAuto.getPlace();
          if (place?.formatted_address || place?.name) {
            setDestText(place.formatted_address || place.name);
          }
        });
        destAutocompleteRef.current = destAuto;
      } catch (err) {
        console.warn('Google Places Autocomplete init notice:', err);
      }
    }
  }, [mapsLoaded]);

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

  // ── Render Section Polylines on Google Map ────────────────────────────────
  useEffect(() => {
    if (!googleMapRef.current || !window.google?.maps) return;
    const gMaps = window.google.maps;
    const map = googleMapRef.current;
    const polyMap = polylinesMapRef.current;

    const currentSecIds = new Set();

    sectionsWithProximity.forEach((sec) => {
      const secId = String(sec.id);
      currentSecIds.add(secId);
      const points = sec.points;

      if (!points || points.length < 2) return;

      const pathLatLngs = points.map(([lat, lng]) => ({ lat, lng }));
      const hasRoute = !!directionsData;
      const isNearby = sec.isNearby;

      // Color coding:
      // When route active: Nearby sections highlighted in emerald green (#10b981), others subtle slate (#94a3b8)
      // When no route: Roadbed color (Right: Orange, Left: Blue, Other: Green)
      let strokeColor = '#10b981';
      let strokeWeight = 5;
      let strokeOpacity = 0.9;
      let zIndex = 20;

      if (hasRoute) {
        if (isNearby) {
          strokeColor = '#059669'; // Bold Emerald
          strokeWeight = 7;
          strokeOpacity = 1.0;
          zIndex = 100;
        } else {
          strokeColor = '#94a3b8'; // Muted Slate
          strokeWeight = 2;
          strokeOpacity = 0.4;
          zIndex = 10;
        }
      } else {
        const roadbed = sec.coordinates?.roadbed;
        strokeColor = roadbed === 'R' ? '#ea580c' : roadbed === 'L' ? '#0284c7' : '#059669';
        strokeWeight = 5;
        strokeOpacity = 0.85;
      }

      const isVisible = !(hasRoute && onlyShowNearby && !isNearby);

      let polyEntry = polyMap.get(secId);

      if (!polyEntry) {
        const poly = new gMaps.Polyline({
          path: pathLatLngs,
          strokeColor,
          strokeOpacity: isVisible ? strokeOpacity : 0,
          strokeWeight,
          zIndex,
          map,
        });

        poly.addListener('click', (e) => {
          handleSectionClick(sec, e.latLng);
        });

        polyMap.set(secId, { poly, sec });
      } else {
        polyEntry.poly.setPath(pathLatLngs);
        polyEntry.poly.setOptions({
          strokeColor,
          strokeOpacity: isVisible ? strokeOpacity : 0,
          strokeWeight,
          zIndex,
        });
        polyEntry.sec = sec;
      }
    });

    // Remove obsolete polylines
    for (const [id, entry] of polyMap.entries()) {
      if (!currentSecIds.has(id)) {
        entry.poly.setMap(null);
        polyMap.delete(id);
      }
    }
  }, [sectionsWithProximity, directionsData, onlyShowNearby]);

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
            <span style="font-size:11px; font-weight:600; background:#f1f5f9; padding:2px 6px; border-radius:4px; margin-left:4px;">
              ${sec.coordinates?.roadbed || ''}
            </span>
          </div>
          <div style="font-size:12px; color:#475569; margin-bottom:6px;">ID: ${sec.id}</div>
          ${distNote}
          <div style="font-size:11px; color:#64748b; line-height:1.4; margin-bottom:10px;">
            RM: ${sec.beginRefMarker || 'Start'} to ${sec.endRefMarker || 'End'}<br/>
            ${sec.county ? `County: ${sec.county}<br/>` : ''}
            ${sec.district ? `District: ${formatDistrictDisplay(sec.district)}` : ''}
          </div>
          <div style="display:flex; gap:6px;">
            <button id="btn-inspect-section" style="flex:1; background:#0f172a; color:#fff; border:none; padding:6px 10px; font-size:11px; font-weight:600; border-radius:6px; cursor:pointer;">
              📸 Inspect Street View
            </button>
          </div>
        </div>
      `;

      if (infoWindowRef.current) {
        infoWindowRef.current.setContent(contentString);
        infoWindowRef.current.setPosition(pos);
        infoWindowRef.current.open(googleMapRef.current);

        // Bind button click inside info window
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

  // ── Calculate Driving Route via DirectionsService ──────────────────────────
  const handleCalculateRoute = useCallback(
    async (e) => {
      if (e) e.preventDefault();
      const origin = originText.trim();
      const destination = destText.trim();

      if (!origin || !destination) {
        addToast?.('warning', 'Missing Locations', 'Please enter both an Origin and a Destination to plan your route.');
        return;
      }

      if (!googleMapRef.current || !window.google?.maps) {
        addToast?.('error', 'Map Not Ready', 'Google Maps is still loading. Please wait a moment.');
        return;
      }

      setIsCalculatingRoute(true);
      const gMaps = window.google.maps;
      const directionsService = new gMaps.DirectionsService();

      const waypoints = routeWaypoints.map((w) => ({
        location: w.location,
        stopover: true,
      }));

      directionsService.route(
        {
          origin,
          destination,
          waypoints,
          travelMode: gMaps.TravelMode.DRIVING,
          optimizeWaypoints: false,
        },
        (result, status) => {
          setIsCalculatingRoute(false);

          if (status === gMaps.DirectionsStatus.OK && result) {
            // Render on map
            directionsRendererRef.current?.setDirections(result);

            const route = result.routes[0];
            const leg = route.legs[0];

            // Extract all route coordinates
            const pathCoords = route.overview_path.map((pt) => [
              Number(pt.lat().toFixed(6)),
              Number(pt.lng().toFixed(6)),
            ]);

            // Total distance & duration
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
              `${distanceMiles} miles (${durationText}). Identifying sections along your path.`
            );
          } else {
            console.error('Directions request failed:', status);
            addToast?.(
              'error',
              'Route Failed',
              status === 'NOT_FOUND'
                ? 'One or both locations could not be resolved. Check spelling or try a city name.'
                : `Could not calculate driving directions: ${status}`
            );
          }
        }
      );
    },
    [originText, destText, routeWaypoints, addToast]
  );

  // ── Clear Route ───────────────────────────────────────────────────────────
  const handleClearRoute = useCallback(() => {
    if (directionsRendererRef.current) {
      directionsRendererRef.current.set('directions', null);
    }
    setDirectionsData(null);
    setRouteWaypoints([]);
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
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setOriginText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        addToast?.('info', 'Location Set', 'Origin set to your current GPS position.');
      },
      (err) => {
        setIsLocatingUser(false);
        addToast?.('error', 'Location Error', err.message || 'Unable to retrieve your current location.');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, [addToast]);

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
            <span style={{ fontSize: 18 }}>🛣️</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                Travel Route & Project Sections Map
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {mappedCount} of {sections.length} sections mapped on Texas roadway network
              </div>
            </div>
          </div>

          {/* Quick Map Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="btn btn--secondary btn--sm"
              onClick={fitProjectBounds}
              title="Fit map view to all project sections"
              style={{ fontSize: 11 }}
            >
              🗺️ All Sections
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
                🚗 Fit Route
              </button>
            )}

            <button
              className={`btn btn--sm ${isSidebarOpen ? 'btn--secondary' : 'btn--ghost'}`}
              onClick={() => setIsSidebarOpen((v) => !v)}
              title="Toggle Route Sections Drawer"
              style={{ fontSize: 11 }}
            >
              📋 {isSidebarOpen ? 'Hide Drawer' : 'Show Sections'}
            </button>
          </div>
        </div>

        {/* Search Inputs Row */}
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
              ref={originInputRef}
              type="text"
              className="form-input"
              placeholder="Origin (e.g. Lubbock, TX or address)"
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
              ref={destInputRef}
              type="text"
              className="form-input"
              placeholder="Destination (e.g. Austin, TX or Dallas)"
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

          {/* Map Floating Legend */}
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              left: 20,
              background: 'rgba(255, 255, 255, 0.94)',
              backdropFilter: 'blur(8px)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
              fontSize: 11,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              pointerEvents: 'none',
              zIndex: 5,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Legend
            </div>
            {directionsData ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 14, height: 4, background: '#2563eb', borderRadius: 2 }} />
                  <span>Driving Route</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 14, height: 4, background: '#059669', borderRadius: 2 }} />
                  <span style={{ fontWeight: 600, color: '#059669' }}>Within {proximityMiles} mi of route</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 14, height: 2, background: '#94a3b8', borderRadius: 1 }} />
                  <span style={{ color: '#64748b' }}>Other Project Sections</span>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 14, height: 4, background: '#ea580c', borderRadius: 2 }} />
                  <span>Right Roadbed (R)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 14, height: 4, background: '#0284c7', borderRadius: 2 }} />
                  <span>Left Roadbed (L)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 14, height: 4, background: '#059669', borderRadius: 2 }} />
                  <span>Single / Other</span>
                </div>
              </>
            )}
          </div>
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
                    const capturesCount = sec.captures?.length || 0;

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
                            {sec.coordinates?.roadbed && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  background: 'var(--bg-elevated)',
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                }}
                              >
                                {sec.coordinates.roadbed}
                              </span>
                            )}
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
                    💡 <strong>Plan a Trip:</strong> Enter your travel Origin and Destination above to find which sections you can visit along the way!
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sections.map((sec) => {
                      const pts = extractSectionCoordinates(sec);
                      const isMapped = pts.length >= 2;

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
