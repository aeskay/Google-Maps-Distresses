/**
 * MapTab.jsx
 * Interactive Google Map & Street View Pavement Distress Capture Workspace.
 *
 * Features:
 * - Google Maps polyline overlay for selected and project sections.
 * - Integrated Google Street View panorama with synchronized location tracking.
 * - "Capture Distress" HUD with quick distress type input & inline suggestion chips.
 * - High-resolution snapshot capture via Street View Static API with distance from start.
 * - Visual pins for captured distresses directly on the map.
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  loadGoogleMapsApi,
  getStoredGoogleMapsApiKey,
  getStreetViewStaticUrl,
  fetchImageAsDataUrl,
  fetchDirectionsRoadPath,
  getIsDirectionsApiDenied,
} from '../../utils/googleMapsLoader';
import {
  calculateDistanceFromStart,
  formatGpsDisplay,
  getGoogleMapsUrl,
  fetchCoordinatesForSection,
  calculateHighwayHeadingAtPoint,
  calculateReferenceMarkerAtOffset,
  parseCoordinatesInput,
} from '../../utils/txdotGisApi';
import {
  getDistressSuggestionsForSection,
  saveSectionRecentDistressType,
  saveCustomDistressType,
  CRCP_DISTRESS_TYPES,
} from '../../utils/distressPresets';
import {
  formatDistrictDisplay,
  formatSlabThicknessDisplay,
} from '../../utils/normalizers';
import CaptureDetailModal from '../modals/CaptureDetailModal';

export default function MapTab({
  project,
  sections = [],
  selectedSectionId,
  onSelectSection,
  onUpdateSection,
  addToast,
  activeTab = 'map',
  focusSectionTrigger = 0,
  targetCapture = null,
}) {
  const mapContainerRef = useRef(null);
  const panoContainerRef = useRef(null);
  const distressComboboxRef = useRef(null);

  const googleMapInstance = useRef(null);
  const panoramaInstance = useRef(null);
  const mapDivRef = useRef(null);
  const panoDivRef = useRef(null);
  const streetViewServiceRef = useRef(null);
  const lastFetchedPanoRef = useRef(null);
  const polylinesRef = useRef([]);
  const polylinesMapRef = useRef(new Map());
  const selectedHaloRef = useRef(null);
  const prevSelectedIdRef = useRef(null);
  const suppressMapPanUntilRef = useRef(0);
  const extentMarkersRef = useRef([]);
  const captureMarkersRef = useRef([]);
  const currentLocationMarkerRef = useRef(null);
  const currentLocationDotRef = useRef(null);
  const splitContainerRef = useRef(null);
  const focusSectionTimerRef = useRef(null);
  const lastMapClickTimeRef = useRef(0);

  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [mapsError, setMapsError] = useState(null);
  const [mapInstanceVersion, setMapInstanceVersion] = useState(0);

  // View Layout: 'split' | 'pano-only' | 'map-only'
  const [viewLayout, setViewLayout] = useState('split');
  const viewLayoutRef = useRef(viewLayout);
  viewLayoutRef.current = viewLayout;
  const [isStreetViewActive, setIsStreetViewActive] = useState(false);

  // Resizable Split View Ratio (in percent, e.g. 50 = 50% map, 50% street view)
  const [splitPercent, setSplitPercent] = useState(45);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);

  // Current Street View Telemetry & Imagery Metadata
  const [currentPosition, setCurrentPosition] = useState(null); // { lat, lng }
  const [currentPov, setCurrentPov] = useState({ heading: 0, pitch: 0, zoom: 1 });
  const [currentDistance, setCurrentDistance] = useState(0); // miles from start

  // Historical Street View Imagery Dates
  const [currentPanoId, setCurrentPanoId] = useState('');
  const [currentImageDate, setCurrentImageDate] = useState(''); // e.g. "2021-06"
  const [currentImageYear, setCurrentImageYear] = useState(''); // e.g. "2021"
  const [availableDates, setAvailableDates] = useState([]); // Array of { pano, date, year, label }
  const [isLoadingDates, setIsLoadingDates] = useState(false);

  // Collapsible HUD panel (toggle hide and show)
  const [isHudCollapsed, setIsHudCollapsed] = useState(false);
  // Street View Road overlays (navigation arrows and street name text on pavement)
  const [showRoadOverlays, setShowRoadOverlays] = useState(false);

  // Distress Input & Autocomplete Combobox in HUD
  const [distressInput, setDistressInput] = useState(CRCP_DISTRESS_TYPES[0]);
  const [distressNotes, setDistressNotes] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [suggestionList, setSuggestionList] = useState([]);
  const [isDistressDropdownOpen, setIsDistressDropdownOpen] = useState(false);

  // Selected capture for inspector modal
  const [inspectCapture, setInspectCapture] = useState(null);

  // Live polyline hover Reference Marker tooltip
  const [polylineHover, setPolylineHover] = useState({
    visible: false,
    x: 0,
    y: 0,
    offset: 0,
    rmDisplay: null,
    sectionId: '',
    highway: '',
  });

  // Active section
  const selectedSection = useMemo(
    () => sections.find(s => s.id === selectedSectionId) || sections[0] || null,
    [sections, selectedSectionId]
  );

  // Dynamic suggestions: recent for this section ranked to the top
  useEffect(() => {
    const list = getDistressSuggestionsForSection(
      selectedSection?.id,
      selectedSection?.captures || []
    );
    setSuggestionList(list);
    // Default input to the most recently recorded distress on this section, or list top
    if (selectedSection?.captures && selectedSection.captures.length > 0) {
      setDistressInput(selectedSection.captures[0].distressType || list[0] || CRCP_DISTRESS_TYPES[0]);
    } else if (list.length > 0) {
      setDistressInput(list[0]);
    }
  }, [selectedSection?.id, selectedSection?.captures]);

  // Click outside listener for combobox dropdown
  useEffect(() => {
    function handleClickOutside(e) {
      if (distressComboboxRef.current && !distressComboboxRef.current.contains(e.target)) {
        setIsDistressDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filtered suggestions for autocomplete dropdown
  const filteredSuggestions = useMemo(() => {
    const q = distressInput.trim().toLowerCase();
    if (!q) return suggestionList.slice(0, 10);
    return suggestionList.filter(s => s.toLowerCase().includes(q)).slice(0, 10);
  }, [distressInput, suggestionList]);

  const hasExactMatch = useMemo(() => {
    const q = distressInput.trim().toLowerCase();
    return suggestionList.some(s => s.toLowerCase() === q);
  }, [distressInput, suggestionList]);

  // Set of section recents for subtle badge
  const sectionRecentSet = useMemo(() => {
    const set = new Set();
    (selectedSection?.captures || []).forEach(c => {
      if (c.distressType) set.add(c.distressType.toLowerCase());
    });
    return set;
  }, [selectedSection?.captures]);


  // Select a distress from dropdown or quick-pick
  const handleSelectDistress = useCallback((distress) => {
    setDistressInput(distress);
    setIsDistressDropdownOpen(false);
    if (selectedSection?.id) {
      saveSectionRecentDistressType(selectedSection.id, distress);
    }
    const updated = getDistressSuggestionsForSection(
      selectedSection?.id,
      selectedSection?.captures || [],
      distress
    );
    setSuggestionList(updated);
  }, [selectedSection?.id, selectedSection?.captures]);

  // Add custom distress
  const handleAddCustomDistress = useCallback((customText) => {
    const trimmed = customText.trim();
    if (!trimmed) return;
    saveCustomDistressType(trimmed);
    handleSelectDistress(trimmed);
  }, [handleSelectDistress]);

  // ── Load Google Maps JS SDK ────────────────────────────────────────────────
  useEffect(() => {
    const apiKey = getStoredGoogleMapsApiKey();
    if (!apiKey) {
      setMapsError('Missing Google Maps API Key. Click "API Settings" below to enter your key.');
      return;
    }

    setMapsError(null);
    loadGoogleMapsApi(apiKey)
      .then((gMaps) => {
        setMapsLoaded(true);
      })
      .catch((err) => {
        console.error('Maps SDK load failure:', err);
        setMapsError(err.message || 'Failed to load Google Maps SDK.');
      });
  }, []);

  // ── Fetch Street View Metadata & Historical Panoramas ───────────────────────
  const fetchPanoTimeline = useCallback((panoId, latLng = null) => {
    if (!streetViewServiceRef.current) return;
    if (panoId && lastFetchedPanoRef.current === panoId) return;
    if (panoId) lastFetchedPanoRef.current = panoId;

    setIsLoadingDates(true);
    const request = panoId ? { pano: panoId } : (latLng ? { location: latLng, radius: 50 } : null);
    if (!request) {
      setIsLoadingDates(false);
      return;
    }

    try {
      streetViewServiceRef.current.getPanorama(request, (data, status) => {
        setIsLoadingDates(false);
        if (status === 'OK' && data) {
          const activePano = data.location?.pano || panoId || '';
          setCurrentPanoId(activePano);

          const rawDate = data.imageDate || '';
          setCurrentImageDate(rawDate);
          const year = rawDate ? rawDate.split('-')[0] : '';
          setCurrentImageYear(year);

          // Parse historical panos from data.time (undocumented Google Street View history array)
          const times = Array.isArray(data.time) ? data.time : [];
          const parsed = [];

          times.forEach((item) => {
            if (!item || !item.pano) return;
            const dateKey = Object.keys(item).find(k => k !== 'pano');
            const val = dateKey ? item[dateKey] : null;
            let dateObj = null;
            if (val instanceof Date) {
              dateObj = val;
            } else if (val) {
              const parsedD = new Date(val);
              if (!isNaN(parsedD.getTime())) dateObj = parsedD;
            }

            let dStr = '';
            let yStr = '';
            let displayLabel = '';

            if (dateObj) {
              dStr = dateObj.toISOString().slice(0, 7); // "YYYY-MM"
              yStr = String(dateObj.getFullYear());
              displayLabel = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
            } else if (typeof val === 'string') {
              dStr = val.slice(0, 7);
              yStr = val.slice(0, 4);
              displayLabel = val;
            } else {
              dStr = rawDate || 'Historical';
              yStr = dStr.slice(0, 4);
              displayLabel = dStr;
            }

            parsed.push({
              pano: item.pano,
              date: dStr,
              year: yStr,
              label: displayLabel,
            });
          });

          // Sort chronological descending (most recent first)
          parsed.sort((a, b) => b.date.localeCompare(a.date));

          // Ensure active panorama is present in the array
          if (!parsed.some(p => p.pano === activePano)) {
            let currentLabel = rawDate;
            if (rawDate && rawDate.includes('-')) {
              const [y, m] = rawDate.split('-');
              const d = new Date(Number(y), Number(m) - 1, 1);
              if (!isNaN(d.getTime())) {
                currentLabel = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
              }
            }
            parsed.unshift({
              pano: activePano,
              date: rawDate || 'Current',
              year: year || '',
              label: currentLabel || rawDate || 'Latest',
            });
          }

          setAvailableDates(parsed);
        }
      });
    } catch (err) {
      console.warn('Error fetching Street View timeline metadata:', err);
      setIsLoadingDates(false);
    }
  }, []);

  const selectedSectionRef = useRef(selectedSection);
  selectedSectionRef.current = selectedSection;

  // Helper to get valid polyline coordinates for a section (with begin/end fallback)
  const getSectionPathCoords = useCallback((sec) => {
    const coords = sec?.coordinates;
    if (!coords) return [];
    if (Array.isArray(coords.path) && coords.path.length >= 2) {
      return coords.path;
    }
    if (Array.isArray(coords.begin) && Array.isArray(coords.end)) {
      return [coords.begin, coords.end];
    }
    if (Array.isArray(coords.begin)) {
      return [coords.begin];
    }
    return [];
  }, []);

  // Refocus map bounds immediately on current section and all its distress points
  const focusOnSection = useCallback(() => {
    const sec = selectedSectionRef.current;
    if (!googleMapInstance.current || !window.google?.maps || !sec) return;
    const path = getSectionPathCoords(sec);
    if (path.length > 0) {
      // Suppress Street View position_changed from calling panTo and canceling fitBounds
      suppressMapPanUntilRef.current = Date.now() + 1800;

      const secBounds = new window.google.maps.LatLngBounds();
      path.forEach(([lat, lng]) => secBounds.extend({ lat, lng }));

      // Include all saved distress points so every stored distress dot is in view
      if (Array.isArray(sec.captures)) {
        sec.captures.forEach(c => {
          const lngVal = c.lon !== undefined ? c.lon : c.lng;
          if (c.lat != null && lngVal != null) {
            secBounds.extend({ lat: Number(c.lat), lng: Number(lngVal) });
          }
        });
      }

      // Teleport center first to skip slow cross-state fly animation, then fit bounds
      googleMapInstance.current.setCenter(secBounds.getCenter());
      googleMapInstance.current.fitBounds(secBounds, 40);
    }
  }, [getSectionPathCoords]);

  // ── Map Coordinate & Place Search ──────────────────────────────────────────
  const [mapSearchText, setMapSearchText] = useState('');
  const [isSearchingMap, setIsSearchingMap] = useState(false);
  const searchMarkerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (searchMarkerRef.current) {
        searchMarkerRef.current.setMap(null);
        searchMarkerRef.current = null;
      }
    };
  }, []);

  const handleMapSearch = useCallback((e) => {
    if (e) e.preventDefault();
    const query = mapSearchText.trim();
    if (!query) return;

    if (!googleMapInstance.current || !window.google?.maps) {
      addToast('warning', 'Map Loading', 'Google Maps is still initializing. Please wait a moment.');
      return;
    }

    const gMaps = window.google.maps;

    const applySearchResult = (lat, lng, label) => {
      // Temporarily mark last map click to prevent auto-reset to section start
      lastMapClickTimeRef.current = Date.now();
      suppressMapPanUntilRef.current = Date.now() + 3000;

      googleMapInstance.current.panTo({ lat, lng });
      googleMapInstance.current.setZoom(17);

      if (searchMarkerRef.current) {
        searchMarkerRef.current.setMap(null);
      }
      searchMarkerRef.current = new gMaps.Marker({
        position: { lat, lng },
        map: googleMapInstance.current,
        title: label || `Target: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        animation: gMaps.Animation.DROP,
      });

      // Try locating Street View panorama near this location
      if (streetViewServiceRef.current && panoramaInstance.current) {
        let fwdHeading = null;
        const sec = selectedSectionRef.current;
        if (sec) {
          const rawPath = getSectionPathCoords(sec);
          if (rawPath.length >= 2) {
            fwdHeading = calculateHighwayHeadingAtPoint([lat, lng], rawPath, sec.coordinates?.begin);
          }
        }

        streetViewServiceRef.current.getPanorama(
          { location: { lat, lng }, radius: 100 },
          (data, status) => {
            if (status === 'OK' && data?.location?.latLng) {
              lastMapClickTimeRef.current = Date.now();
              const snapLat = data.location.latLng.lat();
              const snapLng = data.location.latLng.lng();
              setCurrentPosition({ lat: snapLat, lng: snapLng });
              panoramaInstance.current.setPosition(data.location.latLng);
              if (fwdHeading !== null) {
                panoramaInstance.current.setPov({ heading: fwdHeading, pitch: 0, zoom: 1 });
              }
              panoramaInstance.current.setVisible(true);
              setIsStreetViewActive(true);
              if (viewLayoutRef.current === 'map-only') {
                setViewLayout('split');
              }
              fetchPanoTimeline(data.location.pano, data.location.latLng);
              addToast(
                'success',
                'Location & Street View Found',
                `Navigated to ${lat.toFixed(5)}, ${lng.toFixed(5)}.`
              );
            } else {
              addToast(
                'info',
                'Map Centered',
                `Centered map at ${lat.toFixed(5)}, ${lng.toFixed(5)}. (No Street View within 100m)`
              );
            }
          }
        );
      } else {
        addToast('success', 'Map Centered', `Centered map at ${lat.toFixed(5)}, ${lng.toFixed(5)}.`);
      }
    };

    // 1. Check if user typed coordinates / Google Maps URL
    const parsedCoords = parseCoordinatesInput(query);
    if (parsedCoords) {
      applySearchResult(parsedCoords.lat, parsedCoords.lng, `Coordinate: ${parsedCoords.lat.toFixed(5)}, ${parsedCoords.lng.toFixed(5)}`);
      return;
    }

    // 2. Geocoder fallback for place names / addresses / highway intersections
    if (gMaps.Geocoder) {
      setIsSearchingMap(true);
      const geocoder = new gMaps.Geocoder();
      geocoder.geocode({ address: query }, (results, status) => {
        setIsSearchingMap(false);
        if (status === 'OK' && results && results[0]) {
          const loc = results[0].geometry.location;
          const lat = loc.lat();
          const lng = loc.lng();
          applySearchResult(lat, lng, results[0].formatted_address);
        } else if (status === 'REQUEST_DENIED') {
          addToast(
            'warning',
            'Geocoding API Not Enabled',
            'To search by place name or address, enable "Geocoding API" in your Google Cloud Console. You can search directly by entering coordinates (e.g. 31.89613, -97.0686).'
          );
        } else {
          addToast(
            'warning',
            'Location Not Found',
            `Could not find "${query}". Try latitude, longitude coordinates (e.g. 31.89613, -97.0686).`
          );
        }
      });
    } else {
      addToast('warning', 'Search Unavailable', 'Geocoder service is unavailable.');
    }
  }, [mapSearchText, addToast, fetchPanoTimeline, getSectionPathCoords]);

  // ── Jump Map and Street View to a Captured Distress ─────────────────────────
  const jumpToCaptureLocation = useCallback((capture) => {
    if (!capture || !googleMapInstance.current || !window.google?.maps) return;
    const lat = Number(capture.lat);
    const lng = Number(capture.lon !== undefined ? capture.lon : capture.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    // Suppress any start-jumping logic from overwriting this position
    lastMapClickTimeRef.current = Date.now();
    suppressMapPanUntilRef.current = Date.now() + 4000;

    // 1. Pan and zoom Google Map
    googleMapInstance.current.panTo({ lat, lng });
    googleMapInstance.current.setZoom(18);

    // 2. Update current position state & orange marker
    setCurrentPosition({ lat, lng });

    // 3. Ensure view layout includes Street View (switch from map-only to split if needed)
    if (viewLayoutRef.current === 'map-only') {
      setViewLayout('split');
    }

    // 4. Update Street View Panorama & Heading / Pitch
    if (panoramaInstance.current) {
      panoramaInstance.current.setVisible(true);
      setIsStreetViewActive(true);

      const targetPov = {
        heading: capture.heading != null && !isNaN(capture.heading) ? Number(capture.heading) : 0,
        pitch: capture.pitch != null && !isNaN(capture.pitch) ? Number(capture.pitch) : 0,
        zoom: 1,
      };

      if (capture.panoId) {
        panoramaInstance.current.setPano(capture.panoId);
        panoramaInstance.current.setPov(targetPov);
        fetchPanoTimeline(capture.panoId, { lat, lng });
      } else if (streetViewServiceRef.current) {
        streetViewServiceRef.current.getPanorama(
          { location: { lat, lng }, radius: 100 },
          (data, status) => {
            if (status === 'OK' && data?.location?.latLng) {
              panoramaInstance.current.setPosition(data.location.latLng);
              panoramaInstance.current.setPov(targetPov);
              fetchPanoTimeline(data.location.pano, data.location.latLng);
            } else {
              panoramaInstance.current.setPosition({ lat, lng });
              panoramaInstance.current.setPov(targetPov);
            }
          }
        );
      } else {
        panoramaInstance.current.setPosition({ lat, lng });
        panoramaInstance.current.setPov(targetPov);
      }
    }

    addToast(
      'info',
      'Distress Located',
      `Viewing ${capture.distressType || 'distress'} at +${(capture.distanceFromStartMiles || 0).toFixed(2)} mi.`
    );
  }, [fetchPanoTimeline, addToast]);

  // Listener for targetCapture requests passed from parent
  const lastTargetCaptureTriggerRef = useRef(0);
  useEffect(() => {
    if (!targetCapture || !targetCapture._triggerTime) return;
    if (targetCapture._triggerTime === lastTargetCaptureTriggerRef.current) return;
    lastTargetCaptureTriggerRef.current = targetCapture._triggerTime;

    if (!googleMapInstance.current) {
      const timer = setTimeout(() => {
        jumpToCaptureLocation(targetCapture);
      }, 500);
      return () => clearTimeout(timer);
    } else {
      jumpToCaptureLocation(targetCapture);
    }
  }, [targetCapture, jumpToCaptureLocation]);

  // Focus map immediately and position Street View when selectedSectionId or focusSectionTrigger changes
  useEffect(() => {
    const sec = selectedSectionRef.current;
    if (!sec) return;

    // Clear any previously pending start-jump timer
    if (focusSectionTimerRef.current) {
      clearTimeout(focusSectionTimerRef.current);
      focusSectionTimerRef.current = null;
    }

    // If the user clicked somewhere on the map or blue line within the last 4 seconds,
    // NEVER overwrite their position or reset Street View / orange pin to the section start!
    if (Date.now() - lastMapClickTimeRef.current < 4000) {
      return;
    }

    const path = getSectionPathCoords(sec);
    if (path.length > 0) {
      focusOnSection();
    }

    if (sec.coordinates?.begin) {
      const coord = sec.coordinates.begin;
      const pos = { lat: coord[0], lng: coord[1] };
      // Immediately move the orange locator pin to the new section start
      setCurrentPosition(pos);

      // Defer heavy Street View 3D panorama & timeline network calls by 1 frame
      // so the map canvas paints the blue extent line and red distress pins first
      focusSectionTimerRef.current = setTimeout(() => {
        if (Date.now() - lastMapClickTimeRef.current < 4000) return;
        if (panoramaInstance.current) {
          suppressMapPanUntilRef.current = Date.now() + 1800;
          panoramaInstance.current.setPosition(pos);
          panoramaInstance.current.setVisible(true);
          setIsStreetViewActive(true);
          fetchPanoTimeline(null, pos);
        }
      }, 40);

      return () => {
        if (focusSectionTimerRef.current) {
          clearTimeout(focusSectionTimerRef.current);
          focusSectionTimerRef.current = null;
        }
      };
    }
  }, [selectedSection?.id, selectedSectionId, focusSectionTrigger, focusOnSection, fetchPanoTimeline, getSectionPathCoords, mapInstanceVersion]);

  // ── Snap Section to Road via Google Directions ─────────────────────────────
  const [isSnappingRoad, setIsSnappingRoad] = useState(false);
  const attemptedSnappingIdsRef = useRef(new Set());

  const handleSnapSectionToRoad = useCallback(async (sectionToSnap, isManual = false) => {
    const sec = sectionToSnap || selectedSectionRef.current;
    if (!sec) return;

    const secId = String(sec.id);
    if (!isManual && attemptedSnappingIdsRef.current.has(secId)) {
      return;
    }
    attemptedSnappingIdsRef.current.add(secId);

    setIsSnappingRoad(true);
    try {
      // 1. Primary: Query official TxDOT ArcGIS Roadways layer for measured roadbed geometry
      if (sec.highway && typeof sec.beginRef === 'number' && typeof sec.endRef === 'number') {
        const txdotCoords = await fetchCoordinatesForSection(sec, { forceRefresh: true });
        if (txdotCoords && txdotCoords.status === 'success' && Array.isArray(txdotCoords.path) && txdotCoords.path.length > 2) {
          const updatedSection = {
            ...sec,
            coordinates: txdotCoords,
          };
          onUpdateSection?.(updatedSection);
          if (isManual) {
            addToast('success', 'Road Curves Mapped', `Section ${sec.id} highway geometry loaded from TxDOT (${txdotCoords.path.length} curve vertices).`);
          }
          return;
        }
      }

      // 2. Secondary: Fallback to Google Directions if enabled
      if (!getIsDirectionsApiDenied() && sec.coordinates?.begin && sec.coordinates?.end) {
        const roadData = await fetchDirectionsRoadPath(sec.coordinates.begin, sec.coordinates.end);
        if (roadData && Array.isArray(roadData.path) && roadData.path.length >= 2) {
          const updatedSection = {
            ...sec,
            coordinates: {
              ...sec.coordinates,
              status: 'success',
              path: roadData.path,
              lengthMiles: roadData.lengthMiles ?? sec.coordinates.lengthMiles,
              snappedVia: 'google_directions',
            },
          };
          onUpdateSection?.(updatedSection);
          if (isManual) {
            addToast('success', 'Snapped to Road', `Section ${sec.id} now traces the highway path via Google Directions.`);
          }
          return;
        }
      }

      if (isManual) {
        addToast('warning', 'Geometry Unavailable', 'Could not resolve curved highway geometry for this section range.');
      }
    } catch (err) {
      console.warn('Failed to snap section to road:', err);
      if (isManual) {
        addToast('error', 'Snap to Road Failed', err.message);
      }
    } finally {
      setIsSnappingRoad(false);
    }
  }, [onUpdateSection, addToast]);

  // Automatically snap selected section to road if it only has a straight 2-point line
  useEffect(() => {
    if (!selectedSection) return;
    const path = selectedSection.coordinates?.path;
    const isStraightLine = !Array.isArray(path) || path.length <= 2;
    if (isStraightLine && selectedSection.highway) {
      handleSnapSectionToRoad(selectedSection, false);
    }
  }, [
    selectedSection?.id,
    selectedSection?.highway,
    selectedSection?.beginRef,
    selectedSection?.endRef,
    selectedSection?.coordinates?.path,
    handleSnapSectionToRoad,
  ]);

  // Resize and refocus map when tab becomes active
  useEffect(() => {
    if (activeTab === 'map' && googleMapInstance.current && window.google?.maps) {
      window.google.maps.event.trigger(googleMapInstance.current, 'resize');
      if (panoramaInstance.current) {
        window.google.maps.event.trigger(panoramaInstance.current, 'resize');
      }
      if (getSectionPathCoords(selectedSectionRef.current).length > 0) {
        focusOnSection();
      }
    }
  }, [activeTab, focusOnSection, getSectionPathCoords]);

  // ── Drag Handle for Resizing Map vs Street View in Split Mode ──────────────
  const handleSplitPointerDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingSplit(true);

    const container = splitContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const handlePointerMove = (moveEvent) => {
      moveEvent.preventDefault();
      const currentX = moveEvent.clientX;
      const offset = currentX - rect.left;
      let newPct = (offset / rect.width) * 100;
      if (newPct < 15) newPct = 15;
      if (newPct > 85) newPct = 85;
      setSplitPercent(Math.round(newPct));

      if (googleMapInstance.current && window.google?.maps) {
        window.google.maps.event.trigger(googleMapInstance.current, 'resize');
      }
      if (panoramaInstance.current && window.google?.maps) {
        window.google.maps.event.trigger(panoramaInstance.current, 'resize');
      }
    };

    const handlePointerUp = () => {
      setIsDraggingSplit(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);

      setTimeout(() => {
        if (googleMapInstance.current && window.google?.maps) {
          window.google.maps.event.trigger(googleMapInstance.current, 'resize');
        }
        if (panoramaInstance.current && window.google?.maps) {
          window.google.maps.event.trigger(panoramaInstance.current, 'resize');
        }
      }, 50);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, []);

  // ── Switch Active Street View Date ──────────────────────────────────────────
  const handleSelectDate = useCallback((targetPanoId) => {
    if (!panoramaInstance.current || !targetPanoId) return;
    panoramaInstance.current.setPano(targetPanoId);
    setCurrentPanoId(targetPanoId);
    const match = availableDates.find(d => d.pano === targetPanoId);
    if (match) {
      setCurrentImageDate(match.date);
      setCurrentImageYear(match.year);
    }
  }, [availableDates]);

  // ── Toggle Street View Road Overlays (Arrows & Street Name Text) ─────────────
  const handleToggleRoadOverlays = useCallback(() => {
    setShowRoadOverlays(prev => {
      const next = !prev;
      if (panoramaInstance.current) {
        panoramaInstance.current.setOptions({
          linksControl: next,
          showRoadLabels: next,
        });
      }
      return next;
    });
  }, []);

  // ── Initialize Google Map & Street View Panorama ───────────────────────────
  useEffect(() => {
    if (!mapsLoaded || !mapContainerRef.current || !panoContainerRef.current) return;
    if (
      googleMapInstance.current &&
      panoramaInstance.current &&
      mapDivRef.current === mapContainerRef.current &&
      panoDivRef.current === panoContainerRef.current
    ) {
      return; // already initialized on the exact current DOM nodes
    }

    try {
      const gMaps = window.google.maps;

      // Clear any stale DOM content if containers were recreated
      mapContainerRef.current.innerHTML = '';
      panoContainerRef.current.innerHTML = '';
      polylinesRef.current = [];
      polylinesMapRef.current.clear();
      selectedHaloRef.current = null;
      prevSelectedIdRef.current = null;
      extentMarkersRef.current = [];
      captureMarkersRef.current = [];
      currentLocationMarkerRef.current = null;
      currentLocationDotRef.current = null;

      // Texas default center
      const defaultCenter = { lat: 31.9686, lng: -99.9018 };

      const map = new gMaps.Map(mapContainerRef.current, {
        center: defaultCenter,
        zoom: 6,
        mapTypeId: 'hybrid',
        tilt: 0,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControlOptions: {
          style: gMaps.MapTypeControlStyle.DROPDOWN_MENU,
          position: gMaps.ControlPosition.TOP_RIGHT,
        },
      });

      streetViewServiceRef.current = new gMaps.StreetViewService();

      const panorama = new gMaps.StreetViewPanorama(panoContainerRef.current, {
        position: defaultCenter,
        pov: { heading: 0, pitch: 0 },
        visible: false,
        addressControl: true,
        linksControl: false, // Hides navigation chevron arrows on the pavement
        showRoadLabels: false, // Hides street names painted onto the roadway surface
        clickToGo: true, // Allows clicking down the highway to navigate smoothly
        panControl: true,
        enableCloseButton: false,
        fullscreenControl: false,
        imageDateControl: true, // Native capture date badge on Street View
      });

      // Listeners for Panorama movements
      panorama.addListener('position_changed', () => {
        const pos = panorama.getPosition();
        if (pos) {
          const lat = pos.lat();
          const lng = pos.lng();
          setCurrentPosition({ lat, lng });

          // Keep street view position visible on map ONLY during manual road navigation,
          // never during a programmatic section switch (which would cancel fitBounds)
          if (map && Date.now() > suppressMapPanUntilRef.current) {
            const currentBounds = map.getBounds();
            if (currentBounds && !currentBounds.contains(pos)) {
              map.panTo({ lat, lng });
            }
          }
        }
      });

      panorama.addListener('pano_changed', () => {
        const pano = panorama.getPano();
        if (pano) {
          setCurrentPanoId(pano);
          fetchPanoTimeline(pano);
        }
      });

      panorama.addListener('pov_changed', () => {
        const pov = panorama.getPov();
        if (pov) {
          setCurrentPov({
            heading: pov.heading || 0,
            pitch: pov.pitch || 0,
            zoom: panorama.getZoom() || 1,
          });
        }
      });

      panorama.addListener('visible_changed', () => {
        setIsStreetViewActive(panorama.getVisible());
      });

      panorama.addListener('status_changed', () => {
        const status = panorama.getStatus();
        if (status === 'ZERO_RESULTS') {
          addToast('warning', 'No Street View Imagery', 'Google Street View imagery is not available at this exact point.');
        }
      });

      // Map click: jump Street View to clicked location if nearby imagery exists
      map.addListener('click', (e) => {
        if (e.latLng && panoramaInstance.current && streetViewServiceRef.current) {
          lastMapClickTimeRef.current = Date.now();
          if (focusSectionTimerRef.current) {
            clearTimeout(focusSectionTimerRef.current);
            focusSectionTimerRef.current = null;
          }

          const lat = typeof e.latLng.lat === 'function' ? e.latLng.lat() : e.latLng.lat;
          const lng = typeof e.latLng.lng === 'function' ? e.latLng.lng() : e.latLng.lng;
          let fwdHeading = null;
          const sec = selectedSectionRef.current;
          if (sec) {
            const rawPath = getSectionPathCoords(sec);
            if (rawPath.length >= 2) {
              fwdHeading = calculateHighwayHeadingAtPoint([lat, lng], rawPath, sec.coordinates?.begin);
            }
          }

          streetViewServiceRef.current.getPanorama({ location: e.latLng, radius: 100 }, (data, status) => {
            if (status === 'OK' && data?.location?.latLng) {
              lastMapClickTimeRef.current = Date.now();
              const snapLat = data.location.latLng.lat();
              const snapLng = data.location.latLng.lng();
              setCurrentPosition({ lat: snapLat, lng: snapLng });
              suppressMapPanUntilRef.current = Date.now() + 2500;
              panoramaInstance.current.setPosition(data.location.latLng);
              if (fwdHeading !== null) {
                panoramaInstance.current.setPov({ heading: fwdHeading, pitch: 0, zoom: 1 });
              }
              panoramaInstance.current.setVisible(true);
              setIsStreetViewActive(true);
              if (viewLayoutRef.current === 'map-only') {
                setViewLayout('split');
              }
              fetchPanoTimeline(data.location.pano, data.location.latLng);
            }
          });
        }
      });

      map.addListener('dragstart', () => {
        setPolylineHover(prev => (prev.visible ? { ...prev, visible: false } : prev));
      });
      map.addListener('zoom_changed', () => {
        setPolylineHover(prev => (prev.visible ? { ...prev, visible: false } : prev));
      });

      mapDivRef.current = mapContainerRef.current;
      panoDivRef.current = panoContainerRef.current;
      googleMapInstance.current = map;
      panoramaInstance.current = panorama;
      setMapInstanceVersion(v => v + 1);
    } catch (err) {
      console.error('Error initializing Google Maps:', err);
      setMapsError(err.message);
    }
  });

  // ── Calculate Distance from Start whenever Position or Section changes ─────
  useEffect(() => {
    if (!currentPosition || !selectedSection?.coordinates?.begin) {
      setCurrentDistance(0);
      return;
    }

    const path = getSectionPathCoords(selectedSection);
    const begin = selectedSection.coordinates.begin;
    const dist = calculateDistanceFromStart([currentPosition.lat, currentPosition.lng], path, begin);
    setCurrentDistance(dist);
  }, [currentPosition, selectedSection, getSectionPathCoords]);

  // ── Calculate TxDOT Reference Marker at Current Offset ──────────────────────
  const currentRefMarker = useMemo(() => {
    return calculateReferenceMarkerAtOffset(selectedSection, currentDistance);
  }, [selectedSection, currentDistance]);

  // ── 1. Maintain Cached Polylines on Map for Project Sections ───────────────
  useEffect(() => {
    if (!googleMapInstance.current || !window.google?.maps) return;
    const gMaps = window.google.maps;
    const polyMap = polylinesMapRef.current;
    const activeIds = new Set();

    sections.forEach(sec => {
      const secId = String(sec.id);
      const rawPath = getSectionPathCoords(sec);
      if (rawPath.length < 2) return;

      activeIds.add(secId);
      const coords = sec.coordinates;
      const defaultColor = coords?.roadbed === 'R' ? '#ea580c' : coords?.roadbed === 'L' ? '#0284c7' : '#059669';
      const isSelected = secId === String(selectedSectionRef.current?.id);

      const existing = polyMap.get(secId);
      if (existing && existing.coordsRef === coords) {
        // Already created with identical coordinates
        existing.defaultColor = defaultColor;
        return;
      }

      // If coordinates changed for this section, remove old polyline
      if (existing) {
        existing.polyline.setMap(null);
      }

      const pathLatLngs = rawPath.map(([lat, lng]) => ({ lat, lng }));
      const polyline = new gMaps.Polyline({
        path: pathLatLngs,
        geodesic: true,
        strokeColor: isSelected ? '#2563eb' : defaultColor,
        strokeOpacity: isSelected ? 1.0 : 0.6,
        strokeWeight: isSelected ? 7 : 4,
        zIndex: isSelected ? 1000 : 10,
        map: googleMapInstance.current,
      });

      polyline.addListener('click', (e) => {
        if (!e.latLng) return;
        lastMapClickTimeRef.current = Date.now();
        if (focusSectionTimerRef.current) {
          clearTimeout(focusSectionTimerRef.current);
          focusSectionTimerRef.current = null;
        }

        if (sec.id !== selectedSectionRef.current?.id) {
          onSelectSection(sec.id, false);
        }

        if (panoramaInstance.current) {
          const lat = typeof e.latLng.lat === 'function' ? e.latLng.lat() : e.latLng.lat;
          const lng = typeof e.latLng.lng === 'function' ? e.latLng.lng() : e.latLng.lng;
          const fwdHeading = calculateHighwayHeadingAtPoint([lat, lng], rawPath, sec.coordinates?.begin);

          const applyStreetView = (pos, panoId = null) => {
            lastMapClickTimeRef.current = Date.now();
            suppressMapPanUntilRef.current = Date.now() + 2500;
            const normLat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
            const normLng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
            setCurrentPosition({ lat: normLat, lng: normLng });
            panoramaInstance.current.setPosition(pos);
            panoramaInstance.current.setPov({ heading: fwdHeading, pitch: 0, zoom: 1 });
            panoramaInstance.current.setVisible(true);
            setIsStreetViewActive(true);
            if (viewLayoutRef.current === 'map-only') {
              setViewLayout('split');
            }
            fetchPanoTimeline(panoId, pos);
          };

          if (streetViewServiceRef.current) {
            streetViewServiceRef.current.getPanorama({ location: e.latLng, radius: 100 }, (data, status) => {
              if (status === 'OK' && data?.location?.latLng) {
                applyStreetView(data.location.latLng, data.location.pano);
              } else {
                applyStreetView(e.latLng, null);
              }
            });
          } else {
            applyStreetView(e.latLng, null);
          }
        }
      });

      // Show live Reference Marker tooltip when hovering along the highway polyline
      polyline.addListener('mousemove', (e) => {
        if (!e.latLng) return;
        const lat = typeof e.latLng.lat === 'function' ? e.latLng.lat() : e.latLng.lat;
        const lng = typeof e.latLng.lng === 'function' ? e.latLng.lng() : e.latLng.lng;

        const offset = calculateDistanceFromStart([lat, lng], rawPath, sec.coordinates?.begin);
        const rmData = calculateReferenceMarkerAtOffset(sec, offset);

        const domEvt = e.domEvent;
        const mapPane = mapDivRef.current || mapContainerRef.current;
        let x = 0;
        let y = 0;
        if (mapPane && domEvt) {
          const rect = mapPane.getBoundingClientRect();
          x = domEvt.clientX - rect.left;
          y = domEvt.clientY - rect.top;
        }

        setPolylineHover({
          visible: true,
          x,
          y,
          offset,
          rmDisplay: rmData?.refMarkerDisplay || (rmData?.refMarker ? `RM ${rmData.refMarker.toFixed(3)}` : null),
          sectionId: sec.id,
          highway: sec.highway,
        });
      });

      polyline.addListener('mouseout', () => {
        setPolylineHover(prev => (prev.visible ? { ...prev, visible: false } : prev));
      });

      polyMap.set(secId, {
        polyline,
        defaultColor,
        coordsRef: coords,
        pathLatLngs,
      });
    });

    // Remove polylines for deleted sections
    for (const [secId, entry] of polyMap.entries()) {
      if (!activeIds.has(secId)) {
        entry.polyline.setMap(null);
        polyMap.delete(secId);
      }
    }
  }, [sections, getSectionPathCoords, onSelectSection, fetchPanoTimeline, mapInstanceVersion]);

  // ── 2. Instant Selected Section Blue Extent Highlight & Start/End Pins ─────
  useEffect(() => {
    if (!googleMapInstance.current || !window.google?.maps) return;
    const gMaps = window.google.maps;
    const polyMap = polylinesMapRef.current;
    const currentId = selectedSection ? String(selectedSection.id) : null;
    const prevId = prevSelectedIdRef.current;

    // Revert previously selected section polyline back to default roadbed style
    if (prevId && prevId !== currentId && polyMap.has(prevId)) {
      const prevEntry = polyMap.get(prevId);
      prevEntry.polyline.setOptions({
        strokeColor: prevEntry.defaultColor,
        strokeOpacity: 0.6,
        strokeWeight: 4,
        zIndex: 10,
      });
    }

    // Highlight newly selected section polyline in Royal Blue + White Halo
    if (currentId && polyMap.has(currentId)) {
      const currEntry = polyMap.get(currentId);
      currEntry.polyline.setOptions({
        strokeColor: '#2563eb',
        strokeOpacity: 1.0,
        strokeWeight: 7,
        zIndex: 1000,
      });

      if (selectedHaloRef.current) {
        selectedHaloRef.current.setPath(currEntry.pathLatLngs);
        selectedHaloRef.current.setMap(googleMapInstance.current);
      } else {
        selectedHaloRef.current = new gMaps.Polyline({
          path: currEntry.pathLatLngs,
          geodesic: true,
          strokeColor: '#ffffff',
          strokeOpacity: 0.9,
          strokeWeight: 10,
          zIndex: 998,
          clickable: false,
          map: googleMapInstance.current,
        });
      }
    } else if (selectedHaloRef.current) {
      selectedHaloRef.current.setMap(null);
    }

    prevSelectedIdRef.current = currentId;

    // Update Start & End extent pins for selected section
    extentMarkersRef.current.forEach(m => m.setMap(null));
    extentMarkersRef.current = [];

    if (selectedSection?.coordinates?.begin && selectedSection?.coordinates?.end) {
      const beginPos = { lat: selectedSection.coordinates.begin[0], lng: selectedSection.coordinates.begin[1] };
      const endPos = { lat: selectedSection.coordinates.end[0], lng: selectedSection.coordinates.end[1] };

      const beginMarker = new gMaps.Marker({
        position: beginPos,
        map: googleMapInstance.current,
        title: `Start of Section ${selectedSection.id} (RM ${selectedSection.beginRef})`,
        zIndex: 1500,
        optimized: true,
        icon: {
          path: gMaps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: '#10b981',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      });

      const endMarker = new gMaps.Marker({
        position: endPos,
        map: googleMapInstance.current,
        title: `End of Section ${selectedSection.id} (RM ${selectedSection.endRef})`,
        zIndex: 1500,
        optimized: true,
        icon: {
          path: gMaps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: '#8b5cf6',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      });

      extentMarkersRef.current.push(beginMarker, endMarker);
    }
  }, [selectedSection?.id, selectedSection?.coordinates, sections, mapInstanceVersion]);

  // ── 3. Render Distress Capture Pins on Map ─────────────────────────────────
  useEffect(() => {
    if (!googleMapInstance.current || !window.google?.maps) return;
    const gMaps = window.google.maps;

    captureMarkersRef.current.forEach(m => m.setMap(null));
    captureMarkersRef.current = [];

    if (!selectedSection || !Array.isArray(selectedSection.captures)) return;

    selectedSection.captures.forEach(c => {
      const lngVal = c.lon !== undefined ? c.lon : c.lng;
      if (c.lat == null || lngVal == null) return;

      const marker = new gMaps.Marker({
        position: { lat: Number(c.lat), lng: Number(lngVal) },
        map: googleMapInstance.current,
        title: `${c.distressType} (+${c.distanceFromStartMiles?.toFixed(2)} mi)${c.imageYear ? ` · Year: ${c.imageYear}` : ''}`,
        zIndex: 2000,
        optimized: true,
        icon: {
          path: gMaps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#ef4444',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2.5,
        },
      });

      marker.addListener('click', () => {
        setInspectCapture(c);
      });

      captureMarkersRef.current.push(marker);
    });
  }, [selectedSection?.id, selectedSection?.captures, mapInstanceVersion]);

  // ── Synchronize Live Street View Location & Heading Indicator on Map ───────
  useEffect(() => {
    if (!googleMapInstance.current || !window.google?.maps) return;
    const gMaps = window.google.maps;

    if (!currentPosition) {
      if (currentLocationMarkerRef.current) currentLocationMarkerRef.current.setMap(null);
      if (currentLocationDotRef.current) currentLocationDotRef.current.setMap(null);
      return;
    }

    const pos = { lat: currentPosition.lat, lng: currentPosition.lng };
    const heading = Math.round(currentPov?.heading || 0);

    // Compact directional pointer symbol oriented toward camera heading (Vibrant Orange)
    const pointerIcon = {
      path: 'M 0,-11 L 4.9,-2.5 A 5.5,5.5 0 1 1 -4.9,-2.5 Z',
      scale: 1.0,
      rotation: heading,
      fillColor: '#f97316', // vibrant Street View orange
      fillOpacity: 1.0,
      strokeColor: '#ffffff',
      strokeWeight: 1.5,
      anchor: new gMaps.Point(0, 0),
    };

    const dotIcon = {
      path: gMaps.SymbolPath.CIRCLE,
      scale: 2.2,
      fillColor: '#ffffff',
      fillOpacity: 1.0,
      strokeColor: '#ea580c',
      strokeWeight: 1.2,
      anchor: new gMaps.Point(0, 0),
    };

    const titleText = `Street View Location (Bearing: ${heading}° · +${currentDistance.toFixed(2)} mi)`;

    if (currentLocationMarkerRef.current) {
      currentLocationMarkerRef.current.setPosition(pos);
      currentLocationMarkerRef.current.setIcon(pointerIcon);
      currentLocationMarkerRef.current.setTitle(titleText);
      currentLocationMarkerRef.current.setZIndex(2500);
      currentLocationMarkerRef.current.setMap(googleMapInstance.current);
    } else {
      const marker = new gMaps.Marker({
        position: pos,
        map: googleMapInstance.current,
        icon: pointerIcon,
        zIndex: 2500,
        title: titleText,
      });

      marker.addListener('click', () => {
        if (viewLayoutRef.current === 'map-only') {
          setViewLayout('split');
        }
        if (panoramaInstance.current && !panoramaInstance.current.getVisible()) {
          panoramaInstance.current.setVisible(true);
          setIsStreetViewActive(true);
        }
        googleMapInstance.current.panTo(pos);
      });

      currentLocationMarkerRef.current = marker;
    }

    if (currentLocationDotRef.current) {
      currentLocationDotRef.current.setPosition(pos);
      currentLocationDotRef.current.setIcon(dotIcon);
      currentLocationDotRef.current.setZIndex(2501);
      currentLocationDotRef.current.setMap(googleMapInstance.current);
    } else {
      const dot = new gMaps.Marker({
        position: pos,
        map: googleMapInstance.current,
        icon: dotIcon,
        zIndex: 2501,
        clickable: false,
      });
      currentLocationDotRef.current = dot;
    }
  }, [currentPosition, currentPov?.heading, currentDistance, mapInstanceVersion]);

  // Clean up location markers on unmount
  useEffect(() => {
    return () => {
      if (currentLocationMarkerRef.current) {
        currentLocationMarkerRef.current.setMap(null);
        currentLocationMarkerRef.current = null;
      }
      if (currentLocationDotRef.current) {
        currentLocationDotRef.current.setMap(null);
        currentLocationDotRef.current = null;
      }
    };
  }, []);

  // Trigger resize and fit section bounds when switching layout (Split / Street View / Map)
  useEffect(() => {
    if (googleMapInstance.current && window.google?.maps) {
      window.google.maps.event.trigger(googleMapInstance.current, 'resize');
      if (panoramaInstance.current) {
        window.google.maps.event.trigger(panoramaInstance.current, 'resize');
      }
      if (selectedSectionRef.current?.coordinates?.path?.length > 0) {
        focusOnSection();
      }
    }
  }, [viewLayout, focusOnSection]);

  // ── Jump to Section Start in Street View ───────────────────────────────────
  const handleEnterStreetView = useCallback((atEnd = false) => {
    if (!selectedSection?.coordinates?.begin || !panoramaInstance.current) {
      addToast('warning', 'No Coordinates', 'This section does not have GPS coordinates. Click "Gen GPS" in the sidebar.');
      return;
    }

    const coord = atEnd ? selectedSection.coordinates.end : selectedSection.coordinates.begin;
    const pos = { lat: coord[0], lng: coord[1] };

    panoramaInstance.current.setPosition(pos);
    panoramaInstance.current.setVisible(true);
    setIsStreetViewActive(true);

    focusOnSection();
    fetchPanoTimeline(null, pos);
  }, [selectedSection, addToast, fetchPanoTimeline, focusOnSection]);

  // ── Capture Distress Action ────────────────────────────────────────────────
  const handleCaptureDistress = useCallback(async () => {
    if (!panoramaInstance.current || !currentPosition || !selectedSection) {
      addToast('error', 'Cannot Capture', 'Please enter Street View along an active section to capture.');
      return;
    }

    const activeType = distressInput.trim() || 'Unspecified Distress';
    setIsCapturing(true);

    try {
      const apiKey = getStoredGoogleMapsApiKey();
      const snapshotUrl = getStreetViewStaticUrl(
        currentPosition.lat,
        currentPosition.lng,
        currentPov.heading,
        currentPov.pitch,
        90,
        apiKey,
        currentPanoId || null
      );

      // Convert snapshot to base64 so it can be saved persistently
      const dataUrl = await fetchImageAsDataUrl(snapshotUrl);

      const effectiveYear = currentImageYear || (currentImageDate ? currentImageDate.slice(0, 4) : '');
      const refMarkerData = calculateReferenceMarkerAtOffset(selectedSection, currentDistance);

      const newCapture = {
        id: uuidv4(),
        sectionId: selectedSection.id,
        distressType: activeType,
        lat: Number(currentPosition.lat.toFixed(6)),
        lon: Number(currentPosition.lng.toFixed(6)),
        heading: Math.round(currentPov.heading),
        pitch: Math.round(currentPov.pitch),
        fov: 90,
        distanceFromStartMiles: currentDistance,
        refMarker: refMarkerData ? refMarkerData.refMarker : null,
        refMarkerDisplay: refMarkerData ? refMarkerData.refMarkerDisplay : null,
        capturedAt: new Date().toISOString(),
        imageDate: currentImageDate || '',
        imageYear: effectiveYear,
        panoId: currentPanoId || '',
        imageUrl: dataUrl,
        notes: distressNotes.trim(),
      };

      // Persist type to section & global history (moves to top for this section)
      saveSectionRecentDistressType(selectedSection.id, activeType);

      // Append to section's captures
      const updatedCaptures = [newCapture, ...(selectedSection.captures || [])];
      const updatedSection = {
        ...selectedSection,
        captures: updatedCaptures,
      };

      const updatedSuggestions = getDistressSuggestionsForSection(
        selectedSection.id,
        updatedCaptures,
        activeType
      );
      setSuggestionList(updatedSuggestions);

      onUpdateSection(updatedSection);
      addToast(
        'success',
        'Distress Captured!',
        `${activeType} recorded (${effectiveYear ? `Year: ${effectiveYear}` : 'Current view'}${refMarkerData ? ` • ${refMarkerData.refMarkerDisplay}` : ''}) at +${currentDistance.toFixed(2)} mi.`
      );
      setDistressNotes(''); // clear notes for next capture
    } catch (err) {
      console.error('Capture error:', err);
      addToast('error', 'Capture Failed', err.message);
    } finally {
      setIsCapturing(false);
    }
  }, [
    currentPosition,
    currentPov,
    currentDistance,
    currentPanoId,
    currentImageDate,
    currentImageYear,
    distressInput,
    distressNotes,
    selectedSection,
    onUpdateSection,
    addToast,
  ]);

  // ── Global Keyboard Shortcut (Spacebar to Capture when in Street View) ──────
  useEffect(() => {
    function handleKeyDown(e) {
      // Spacebar when in Street View and not typing in an input
      if (e.code === 'Space' && isStreetViewActive && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handleCaptureDistress();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isStreetViewActive, handleCaptureDistress]);

  // ── Render API Error State if Key Missing ───────────────────────────────────
  if (mapsError) {
    return (
      <div className="tab-pane" style={{ alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ maxWidth: 480, textAlign: 'center', background: 'var(--bg-surface)', padding: 32, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-default)' }}>
          <div style={{ fontSize: 42, marginBottom: 16 }}>🗺️</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
            Google Maps Unavailable
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
            Ensure <code>VITE_GOOGLE_MAPS_API_KEY</code> is configured in your environment variables.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-pane" style={{ flexDirection: 'column' }}>
      {/* Top Workspace Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-default)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {selectedSection ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>
                {selectedSection.id} — {selectedSection.highway}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                (RM {selectedSection.beginRef} – {selectedSection.endRef}
                {selectedSection.district ? ` · ${formatDistrictDisplay(selectedSection.district)}` : ''}
                {selectedSection.slabThickness ? ` · Slab: ${formatSlabThicknessDisplay(selectedSection.slabThickness)}` : ''})
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '2px 9px',
                  borderRadius: 'var(--radius-full, 9999px)',
                  background: (selectedSection.captures?.length || 0) > 0 ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-tertiary, #f1f5f9)',
                  color: (selectedSection.captures?.length || 0) > 0 ? '#059669' : 'var(--text-secondary, #64748b)',
                  border: (selectedSection.captures?.length || 0) > 0 ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid var(--border-default, #e2e8f0)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
                title={`${selectedSection.captures?.length || 0} distress capture(s) recorded for this section`}
              >
                <span>📸</span>
                <span>
                  {selectedSection.captures?.length || 0} {(selectedSection.captures?.length || 0) === 1 ? 'capture' : 'captures'}
                </span>
              </span>
            </div>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>Select a section from the sidebar</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Layout Toggle */}
          <div className="segmented-group">
            <button
              type="button"
              className={`segmented-btn ${viewLayout === 'split' ? 'segmented-btn--active' : ''}`}
              onClick={() => setViewLayout('split')}
              title="Split View (Map & Street View)"
            >
              Split
            </button>
            <button
              type="button"
              className={`segmented-btn ${viewLayout === 'pano-only' ? 'segmented-btn--active' : ''}`}
              onClick={() => setViewLayout('pano-only')}
              title="Street View Full"
            >
              Street View
            </button>
            <button
              type="button"
              className={`segmented-btn ${viewLayout === 'map-only' ? 'segmented-btn--active' : ''}`}
              onClick={() => setViewLayout('map-only')}
              title="Map Only"
            >
              Map
            </button>
          </div>
        </div>
      </div>

      {/* Main Split Viewport */}
      <div
        ref={splitContainerRef}
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          position: 'relative',
          userSelect: isDraggingSplit ? 'none' : 'auto',
        }}
      >
        {/* Google Map Container */}
        <div
          key="map-pane"
          style={{
            width: viewLayout === 'split' ? `calc(${splitPercent}% - 5px)` : (viewLayout === 'map-only' ? '100%' : '0px'),
            flex: 'none',
            height: '100%',
            position: 'relative',
            display: viewLayout === 'pano-only' ? 'none' : 'block',
          }}
        >
          {/* Floating Coordinate & Place Search Bar */}
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              zIndex: 20,
              width: 'min(360px, calc(100% - 24px))',
              pointerEvents: 'auto',
            }}
          >
            <form
              onSubmit={handleMapSearch}
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'rgba(15, 23, 42, 0.92)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '24px',
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
                padding: '3px 6px 3px 12px',
                gap: 6,
              }}
            >
              <span style={{ fontSize: 13, opacity: 0.8, pointerEvents: 'none', userSelect: 'none' }}>🔍</span>
              <input
                type="text"
                value={mapSearchText}
                onChange={(e) => setMapSearchText(e.target.value)}
                placeholder="Go to coords (lat, lon) or place..."
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#f8fafc',
                  fontSize: 12,
                  padding: '4px 0',
                }}
              />
              {mapSearchText && (
                <button
                  type="button"
                  onClick={() => {
                    setMapSearchText('');
                    if (searchMarkerRef.current) {
                      searchMarkerRef.current.setMap(null);
                      searchMarkerRef.current = null;
                    }
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '2px 6px',
                    fontSize: 12,
                    lineHeight: 1,
                  }}
                  title="Clear search"
                >
                  ✕
                </button>
              )}
              <button
                type="submit"
                className="btn btn--primary btn--sm"
                disabled={isSearchingMap || !mapSearchText.trim()}
                style={{
                  padding: '3px 10px',
                  fontSize: 11,
                  borderRadius: '16px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                {isSearchingMap ? '...' : 'Go'}
              </button>
            </form>
          </div>

          {/* Live Polyline Hover Reference Marker Tooltip */}
          {polylineHover.visible && (
            <div
              style={{
                position: 'absolute',
                left: Math.max(90, Math.min(polylineHover.x, (mapDivRef.current?.clientWidth || 500) - 90)),
                top: polylineHover.y < 65 ? polylineHover.y + 16 : polylineHover.y - 14,
                transform: polylineHover.y < 65 ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
                zIndex: 60,
                pointerEvents: 'none',
                userSelect: 'none',
                background: 'rgba(15, 23, 42, 0.94)',
                backdropFilter: 'blur(8px)',
                border: '1.5px solid #38bdf8',
                borderRadius: '8px',
                padding: '5px 12px',
                boxShadow: '0 6px 20px rgba(0, 0, 0, 0.55), 0 0 12px rgba(56, 189, 248, 0.4)',
                color: '#ffffff',
                fontSize: 12,
                lineHeight: 1.25,
                whiteSpace: 'nowrap',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }}>
                <span style={{ color: '#38bdf8', fontSize: 13 }}>
                  📍 {polylineHover.rmDisplay || `Offset: +${polylineHover.offset.toFixed(2)} mi`}
                </span>
                {polylineHover.rmDisplay && (
                  <span style={{ color: '#a5f3fc', fontSize: 11, fontWeight: 600 }}>
                    +{polylineHover.offset.toFixed(2)} mi
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>
                {polylineHover.highway} · Sec {polylineHover.sectionId}
              </div>
              {/* Pointer arrow */}
              <div
                style={{
                  position: 'absolute',
                  ...(polylineHover.y < 65
                    ? {
                        top: -6,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: 0,
                        height: 0,
                        borderLeft: '6px solid transparent',
                        borderRight: '6px solid transparent',
                        borderBottom: '6px solid #38bdf8',
                      }
                    : {
                        bottom: -6,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: 0,
                        height: 0,
                        borderLeft: '6px solid transparent',
                        borderRight: '6px solid transparent',
                        borderTop: '6px solid #38bdf8',
                      }),
                }}
              />
            </div>
          )}

          <div
            key="map-canvas"
            ref={mapContainerRef}
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        {/* Draggable Divider Splitter */}
        <div
          key="split-resizer"
          onPointerDown={handleSplitPointerDown}
          className="split-resizer"
          style={{
            width: 10,
            flex: 'none',
            cursor: 'col-resize',
            position: 'relative',
            zIndex: 25,
            background: isDraggingSplit ? 'var(--accent-primary)' : 'var(--border-default)',
            display: viewLayout === 'split' ? 'flex' : 'none',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            touchAction: 'none',
          }}
          title="Drag to resize Map / Street View ratio"
        >
          <div
            style={{
              width: 4,
              height: 36,
              borderRadius: 2,
              background: isDraggingSplit ? '#ffffff' : 'var(--text-muted)',
              opacity: 0.8,
            }}
          />
        </div>

        {/* Street View Container */}
        <div
          key="pano-pane"
          style={{
            width: viewLayout === 'split' ? `calc(${100 - splitPercent}% - 5px)` : (viewLayout === 'pano-only' ? '100%' : '0px'),
            flex: 'none',
            height: '100%',
            position: 'relative',
            display: viewLayout === 'map-only' ? 'none' : 'block',
            overflow: 'hidden',
          }}
        >
          {/* Dedicated empty DOM container for Google StreetViewPanorama */}
          <div
            key="pano-canvas"
            ref={panoContainerRef}
            className={!showRoadOverlays ? 'hide-streetview-arrows' : ''}
            style={{ width: '100%', height: '100%' }}
          />

          {/* Transparent drag protection overlay to prevent maps from swallowing pointer events */}
          {isDraggingSplit && (
            <div
              key="drag-overlay"
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                cursor: 'col-resize',
                userSelect: 'none',
              }}
            />
          )}

          {/* Overlay Placeholder if Street View is not yet active */}
          {!isStreetViewActive && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(255, 255, 255, 0.94)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              padding: 24,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>👀</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                Street View Inactive
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 360, marginBottom: 16, lineHeight: 1.5 }}>
                Click anywhere along the colored highway line on the map, or click below to enter Street View at the start of this section.
              </div>
              <button
                className="btn btn--primary btn--md"
                onClick={() => handleEnterStreetView(false)}
                disabled={!selectedSection?.coordinates?.begin}
              >
                Enter Street View
              </button>
            </div>
          )}

          {/* Full-Width Horizontal Historical Date Selector directly at the bottom */}
          {isStreetViewActive && availableDates.length > 0 && (
            <div
              className="date-pills-bar"
              style={{
                position: 'absolute',
                bottom: 12,
                left: 12,
                right: 12,
                zIndex: 25,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                overflowX: 'auto',
                padding: '6px 10px',
                background: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                borderRadius: 'var(--radius-full)',
                boxShadow: 'var(--shadow-modal)',
                scrollbarWidth: 'thin',
              }}
            >
              {availableDates.map((d) => {
                const isSelected = d.pano === currentPanoId;
                return (
                  <button
                    key={d.pano}
                    type="button"
                    onClick={() => handleSelectDate(d.pano)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: 12,
                      fontWeight: isSelected ? 700 : 500,
                      whiteSpace: 'nowrap',
                      border: isSelected ? '1px solid #059669' : '1px solid rgba(255, 255, 255, 0.15)',
                      background: isSelected ? '#10b981' : 'rgba(255, 255, 255, 0.95)',
                      color: isSelected ? '#ffffff' : '#0f172a',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 2px 6px rgba(16, 185, 129, 0.4)' : 'none',
                      flexShrink: 0,
                    }}
                    title={`Switch to ${d.label}`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Slide-out floating trigger docked to the side when capture bar is hidden */}
          {isStreetViewActive && (
            <button
              type="button"
              className="btn"
              style={{
                position: 'absolute',
                bottom: availableDates.length > 0 ? 58 : 12,
                right: 12,
                zIndex: 35,
                boxShadow: 'var(--shadow-modal)',
                backdropFilter: 'blur(8px)',
                background: 'rgba(15, 23, 42, 0.92)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 'var(--radius-full)',
                padding: '7px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                transform: isHudCollapsed ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
                opacity: isHudCollapsed ? 1 : 0,
                pointerEvents: isHudCollapsed ? 'auto' : 'none',
                transition: 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease',
                whiteSpace: 'nowrap',
              }}
              onClick={() => setIsHudCollapsed(false)}
              title="Open Capture Toolbar (Spacebar to capture)"
            >
              <span>📸</span>
              <span style={{ color: '#38bdf8', fontWeight: 700 }}>◀ Show Capture</span>
            </button>
          )}

          {/* Horizontal Capture Bar positioned directly on top of the date box */}
          {isStreetViewActive && (
            <div
              style={{
                position: 'absolute',
                bottom: availableDates.length > 0 ? 58 : 12,
                left: 12,
                right: 12,
                zIndex: 30,
                background: 'rgba(255, 255, 255, 0.96)',
                backdropFilter: 'blur(10px)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-lg, 12px)',
                padding: '8px 12px',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.18)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                transform: isHudCollapsed ? 'translateX(calc(100% + 24px))' : 'translateX(0)',
                opacity: isHudCollapsed ? 0 : 1,
                pointerEvents: isHudCollapsed ? 'none' : 'auto',
                transition: 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease',
              }}
            >
              {/* Row 1: Header, Active Year, Telemetry, and Hide Button */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                }}
              >
                {/* Left: Title + Active Year Badge + Telemetry */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                      📸 Capture
                    </span>
                    {currentImageYear && (
                      <span
                        style={{
                          background: '#e0f2fe',
                          color: '#0369a1',
                          border: '1px solid #bae6fd',
                          borderRadius: 'var(--radius-sm, 4px)',
                          padding: '1px 6px',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                        title={`Imagery Observation Year: ${currentImageYear}`}
                      >
                        Year: {currentImageYear}
                      </span>
                    )}
                  </div>

                  <span style={{ color: 'var(--border-strong)' }}>|</span>

                  {/* Telemetry info */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                    <span>
                      GPS: <strong style={{ color: 'var(--text-primary)' }}>{currentPosition ? `${currentPosition.lat.toFixed(4)}°, ${currentPosition.lng.toFixed(4)}°` : '—'}</strong>
                    </span>
                    <span>
                      Offset: <strong style={{ color: 'var(--accent-primary)' }}>+{currentDistance.toFixed(2)} mi</strong>
                    </span>
                    {currentRefMarker && (
                      <span title={`TxDOT Reference Marker: ${currentRefMarker.refMarkerDisplay}`}>
                        RM: <strong style={{ color: '#0284c7' }}>{currentRefMarker.refMarkerDisplay}</strong>
                      </span>
                    )}
                    <span>
                      Bearing: <strong style={{ color: 'var(--text-primary)' }}>{Math.round(currentPov.heading)}°</strong>
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {/* Road Overlays Toggle (Arrows & Street Names) */}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={handleToggleRoadOverlays}
                    title={showRoadOverlays ? "Hide navigation arrows and street names on pavement" : "Show navigation arrows and street names on pavement"}
                    style={{
                      padding: '2px 8px',
                      fontSize: 11,
                      color: showRoadOverlays ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <span>{showRoadOverlays ? '↗ Arrows & Labels: On' : '↗ Arrows & Labels: Off'}</span>
                  </button>

                  {/* Far Right: Hide Button */}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setIsHudCollapsed(true)}
                    title="Slide capture toolbar away to screen edge"
                    style={{
                      padding: '2px 8px',
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <span>Hide</span>
                    <span>▶</span>
                  </button>
                </div>
              </div>

              {/* Row 2: Distress Combobox Dropdown + Notes Input + Capture Button */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div ref={distressComboboxRef} style={{ width: 230, minWidth: 180, position: 'relative' }}>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      className="form-input"
                      value={distressInput}
                      onChange={e => {
                        setDistressInput(e.target.value);
                        setIsDistressDropdownOpen(true);
                      }}
                      onFocus={() => setIsDistressDropdownOpen(true)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') {
                          setIsDistressDropdownOpen(false);
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          if (filteredSuggestions.length > 0) {
                            handleSelectDistress(filteredSuggestions[0]);
                          } else if (distressInput.trim()) {
                            handleAddCustomDistress(distressInput.trim());
                          }
                        }
                      }}
                      placeholder="Type or select CRCP distress..."
                      style={{ fontWeight: 600, fontSize: 13, height: 36, paddingRight: 28 }}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setIsDistressDropdownOpen(prev => !prev)}
                      style={{
                        position: 'absolute',
                        right: 8,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        fontSize: 10,
                        padding: 4,
                      }}
                      title="Toggle distress options dropdown"
                    >
                      {isDistressDropdownOpen ? '▲' : '▼'}
                    </button>
                  </div>

                  {/* Autocomplete Dropdown Menu (opens upward so it's never cut off) */}
                  {isDistressDropdownOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 'calc(100% + 4px)',
                        left: 0,
                        right: 0,
                        zIndex: 100,
                        background: '#ffffff',
                        border: '1px solid var(--border-strong)',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: '0 -8px 25px rgba(0, 0, 0, 0.15), 0 4px 6px rgba(0, 0, 0, 0.05)',
                        maxHeight: 220,
                        overflowY: 'auto',
                      }}
                    >
                      {filteredSuggestions.length === 0 && !distressInput.trim() ? (
                        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                          No matching distresses
                        </div>
                      ) : (
                        filteredSuggestions.map(s => {
                          const isSelected = distressInput.toLowerCase() === s.toLowerCase();
                          const isRecent = sectionRecentSet.has(s.toLowerCase());
                          return (
                            <div
                              key={s}
                              onClick={() => handleSelectDistress(s)}
                              style={{
                                padding: '7px 12px',
                                fontSize: 12,
                                fontWeight: isSelected ? 700 : 500,
                                color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)',
                                background: isSelected ? '#eff6ff' : 'transparent',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                cursor: 'pointer',
                                transition: 'background 0.1s ease',
                              }}
                              onMouseEnter={e => {
                                if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                              }}
                              onMouseLeave={e => {
                                if (!isSelected) e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              <span>{s}</span>
                              {isRecent && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    background: '#dbeafe',
                                    color: '#1d4ed8',
                                    padding: '1px 6px',
                                    borderRadius: 10,
                                    fontWeight: 600,
                                  }}
                                >
                                  ★ Recent
                                </span>
                              )}
                            </div>
                          );
                        })
                      )}

                      {/* Add Custom Distress Option */}
                      {distressInput.trim() && !hasExactMatch && (
                        <div
                          onClick={() => handleAddCustomDistress(distressInput.trim())}
                          style={{
                            padding: '7px 12px',
                            fontSize: 12,
                            fontWeight: 600,
                            color: 'var(--accent-primary)',
                            background: '#f0fdf4',
                            borderTop: '1px solid var(--border-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            cursor: 'pointer',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#dcfce7'}
                          onMouseLeave={e => e.currentTarget.style.background = '#f0fdf4'}
                        >
                          <span>➕</span>
                          <span>Add &ldquo;<strong>{distressInput.trim()}</strong>&rdquo;</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Optional Inspector Notes */}
                <input
                  className="form-input"
                  value={distressNotes}
                  onChange={e => setDistressNotes(e.target.value)}
                  placeholder="Optional notes / severity..."
                  style={{ flex: 1, minWidth: 140, fontSize: 12, height: 36 }}
                />

                {/* Capture Button */}
                <button
                  className="btn btn--primary btn--md"
                  onClick={handleCaptureDistress}
                  disabled={isCapturing}
                  style={{
                    gap: 6,
                    padding: '0 18px',
                    height: 36,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                  title="Capture snapshot with active date/year (or press Spacebar)"
                >
                  {isCapturing ? <span className="spinner spinner--white" /> : <span>📸 Capture</span>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Inspect Capture Modal */}
      {inspectCapture && (
        <CaptureDetailModal
          capture={inspectCapture}
          section={selectedSection}
          onUpdateCapture={(updated) => {
            const nextCaptures = selectedSection.captures.map(c => c.id === updated.id ? updated : c);
            onUpdateSection({ ...selectedSection, captures: nextCaptures });
          }}
          onDeleteCapture={(id) => {
            const nextCaptures = selectedSection.captures.filter(c => c.id !== id);
            onUpdateSection({ ...selectedSection, captures: nextCaptures });
          }}
          onViewInMap={(c) => {
            setInspectCapture(null);
            jumpToCaptureLocation(c);
          }}
          onClose={() => setInspectCapture(null)}
        />
      )}
    </div>
  );
}
