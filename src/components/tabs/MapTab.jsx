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
} from '../../utils/googleMapsLoader';
import {
  calculateDistanceFromStart,
  formatGpsDisplay,
  getGoogleMapsUrl,
} from '../../utils/txdotGisApi';
import {
  getDistressSuggestionsForSection,
  saveSectionRecentDistressType,
  saveCustomDistressType,
  CRCP_DISTRESS_TYPES,
} from '../../utils/distressPresets';
import CaptureDetailModal from '../modals/CaptureDetailModal';

export default function MapTab({
  project,
  sections = [],
  selectedSectionId,
  onSelectSection,
  onUpdateSection,
  onOpenSettings,
  addToast,
  activeTab = 'map',
  focusSectionTrigger = 0,
}) {
  const mapContainerRef = useRef(null);
  const panoContainerRef = useRef(null);
  const distressComboboxRef = useRef(null);

  const googleMapInstance = useRef(null);
  const panoramaInstance = useRef(null);
  const streetViewServiceRef = useRef(null);
  const lastFetchedPanoRef = useRef(null);
  const polylinesRef = useRef([]);
  const extentMarkersRef = useRef([]);
  const captureMarkersRef = useRef([]);
  const currentLocationMarkerRef = useRef(null);
  const currentLocationDotRef = useRef(null);
  const splitContainerRef = useRef(null);

  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [mapsError, setMapsError] = useState(null);

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

  // Distress Input & Autocomplete Combobox in HUD
  const [distressInput, setDistressInput] = useState(CRCP_DISTRESS_TYPES[0]);
  const [distressNotes, setDistressNotes] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [suggestionList, setSuggestionList] = useState([]);
  const [isDistressDropdownOpen, setIsDistressDropdownOpen] = useState(false);

  // Selected capture for inspector modal
  const [inspectCapture, setInspectCapture] = useState(null);

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

  // Top 3 quick-pick shortcuts
  const quickPicks = useMemo(() => {
    return suggestionList.slice(0, 3);
  }, [suggestionList]);

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

  // Refocus map bounds on current section and all its distress points
  const focusOnSection = useCallback(() => {
    const sec = selectedSectionRef.current;
    if (!googleMapInstance.current || !window.google?.maps || !sec) return;
    const path = sec.coordinates?.path;
    if (path && path.length > 0) {
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

      googleMapInstance.current.fitBounds(secBounds, 40);
    }
  }, []);

  // Focus map when selectedSectionId or focusSectionTrigger changes
  useEffect(() => {
    const sec = selectedSectionRef.current;
    if (sec?.coordinates?.path?.length > 0) {
      focusOnSection();
    }
  }, [selectedSectionId, focusSectionTrigger, focusOnSection]);

  // If user is in Street View and switches to a different section, move Street View to that section's start
  useEffect(() => {
    const sec = selectedSectionRef.current;
    if (isStreetViewActive && sec?.coordinates?.begin && panoramaInstance.current) {
      const coord = sec.coordinates.begin;
      const pos = { lat: coord[0], lng: coord[1] };
      panoramaInstance.current.setPosition(pos);
      fetchPanoTimeline(null, pos);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSectionId]);

  // Resize and refocus map when tab becomes active
  useEffect(() => {
    if (activeTab === 'map' && googleMapInstance.current && window.google?.maps) {
      window.google.maps.event.trigger(googleMapInstance.current, 'resize');
      if (panoramaInstance.current) {
        window.google.maps.event.trigger(panoramaInstance.current, 'resize');
      }
      if (selectedSectionRef.current?.coordinates?.path?.length > 0) {
        focusOnSection();
      }
    }
  }, [activeTab, focusOnSection]);

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

  // ── Initialize Google Map & Street View Panorama ───────────────────────────
  useEffect(() => {
    if (!mapsLoaded || !mapContainerRef.current || !panoContainerRef.current) return;
    if (googleMapInstance.current) return; // already initialized

    try {
      const gMaps = window.google.maps;

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
        linksControl: true,
        panControl: true,
        enableCloseButton: false,
        fullscreenControl: false,
        imageDateControl: true, // Native capture date badge on Street View
      });

      map.setStreetView(panorama);

      // Listeners for Panorama movements
      panorama.addListener('position_changed', () => {
        const pos = panorama.getPosition();
        if (pos) {
          const lat = pos.lat();
          const lng = pos.lng();
          setCurrentPosition({ lat, lng });

          // Center map subtly on street view position
          if (map) {
            map.panTo({ lat, lng });
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
          streetViewServiceRef.current.getPanorama({ location: e.latLng, radius: 80 }, (data, status) => {
            if (status === 'OK' && data?.location?.latLng) {
              panoramaInstance.current.setPosition(data.location.latLng);
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

      googleMapInstance.current = map;
      panoramaInstance.current = panorama;
    } catch (err) {
      console.error('Error initializing Google Maps:', err);
      setMapsError(err.message);
    }
  }, [mapsLoaded, addToast, fetchPanoTimeline]);

  // ── Calculate Distance from Start whenever Position or Section changes ─────
  useEffect(() => {
    if (!currentPosition || !selectedSection?.coordinates?.begin) {
      setCurrentDistance(0);
      return;
    }

    const path = selectedSection.coordinates.path || [];
    const begin = selectedSection.coordinates.begin;
    const dist = calculateDistanceFromStart([currentPosition.lat, currentPosition.lng], path, begin);
    setCurrentDistance(dist);
  }, [currentPosition, selectedSection]);

  // ── Render Polylines on Map for Sections ───────────────────────────────────
  useEffect(() => {
    if (!googleMapInstance.current || !window.google?.maps) return;
    const gMaps = window.google.maps;

    // Clear old polylines & extent markers
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];
    extentMarkersRef.current.forEach(m => m.setMap(null));
    extentMarkersRef.current = [];

    const bounds = new gMaps.LatLngBounds();
    let hasCoords = false;

    sections.forEach(sec => {
      const isSelected = String(sec.id) === String(selectedSection?.id);
      const coords = sec.coordinates;
      if (!coords || coords.status !== 'success' || !coords.path || coords.path.length < 2) return;

      const pathLatLngs = coords.path.map(([lat, lng]) => ({ lat, lng }));
      pathLatLngs.forEach(pt => bounds.extend(pt));
      hasCoords = true;

      const defaultColor = coords.roadbed === 'R' ? '#ea580c' : coords.roadbed === 'L' ? '#0284c7' : '#059669';

      if (isSelected) {
        // High-visibility halo outline under the blue focus line
        const haloPolyline = new gMaps.Polyline({
          path: pathLatLngs,
          geodesic: true,
          strokeColor: '#ffffff',
          strokeOpacity: 0.9,
          strokeWeight: 10,
          zIndex: 998,
          map: googleMapInstance.current,
        });
        polylinesRef.current.push(haloPolyline);
      }

      // Primary roadway polyline (Royal Blue for selected, Roadbed color for others)
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
        onSelectSection(sec.id);
        focusOnSection();
        if (e.latLng && panoramaInstance.current) {
          panoramaInstance.current.setPosition(e.latLng);
          panoramaInstance.current.setVisible(true);
          setIsStreetViewActive(true);
          if (viewLayoutRef.current === 'map-only') {
            setViewLayout('split');
          }
          fetchPanoTimeline(null, e.latLng);
        }
      });

      polylinesRef.current.push(polyline);
    });

    // Render Start & End extent pins on the map for the selected section
    if (selectedSection?.coordinates?.begin && selectedSection?.coordinates?.end) {
      const beginPos = { lat: selectedSection.coordinates.begin[0], lng: selectedSection.coordinates.begin[1] };
      const endPos = { lat: selectedSection.coordinates.end[0], lng: selectedSection.coordinates.end[1] };

      const beginMarker = new gMaps.Marker({
        position: beginPos,
        map: googleMapInstance.current,
        title: `Start of Section ${selectedSection.id} (RM ${selectedSection.beginRef})`,
        zIndex: 1500,
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

    // If selected section changed and has coordinates, zoom to fit section extent and distresses
    if (selectedSection?.coordinates?.path?.length > 0) {
      focusOnSection();
    } else if (hasCoords && !selectedSection) {
      googleMapInstance.current.fitBounds(bounds);
    }
  }, [sections, selectedSection, onSelectSection, focusOnSection, fetchPanoTimeline]);

  // ── Render Distress Capture Pins on Map ────────────────────────────────────
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
  }, [selectedSection]);

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
  }, [currentPosition, currentPov?.heading, currentDistance]);

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

  // Trigger resize and center map on location when switching layout (e.g. Split to Map Only)
  useEffect(() => {
    if (googleMapInstance.current && window.google?.maps) {
      window.google.maps.event.trigger(googleMapInstance.current, 'resize');
      if (panoramaInstance.current) {
        window.google.maps.event.trigger(panoramaInstance.current, 'resize');
      }
      if (currentPosition) {
        googleMapInstance.current.panTo({ lat: currentPosition.lat, lng: currentPosition.lng });
      }
    }
  }, [viewLayout, currentPosition]);

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

    if (googleMapInstance.current) {
      googleMapInstance.current.panTo(pos);
      googleMapInstance.current.setZoom(17);
    }
    fetchPanoTimeline(null, pos);
  }, [selectedSection, addToast, fetchPanoTimeline]);

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
        `${activeType} recorded (${effectiveYear ? `Year: ${effectiveYear}` : 'Current view'}) at +${currentDistance.toFixed(2)} mi.`
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
            Google Maps API Key Required
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
            To view the interactive satellite map, navigate along roadway sections in Google Street View, and take high-resolution distress snapshots, please provide your Google Maps API key.
          </div>
          <button className="btn btn--primary btn--md" onClick={onOpenSettings}>
            ⚙️ Open API Settings & Enter Key
          </button>
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
            <div>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>
                {selectedSection.id} — {selectedSection.highway}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
                (RM {selectedSection.beginRef} – {selectedSection.endRef} · {selectedSection.district})
              </span>
            </div>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>Select a section from the sidebar</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Toggle Capture Panel visibility */}
          {isStreetViewActive && (
            <button
              type="button"
              className={`btn btn--sm ${isHudCollapsed ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => setIsHudCollapsed(!isHudCollapsed)}
              title="Toggle Distress Capture Panel visibility"
            >
              {isHudCollapsed ? '📸 Show Capture' : '📸 Hide Capture'}
            </button>
          )}

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
        {/* Transparent drag protection overlay to prevent maps from swallowing pointer events */}
        {isDraggingSplit && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 9999,
              cursor: 'col-resize',
              userSelect: 'none',
            }}
          />
        )}

        {/* Google Map Container with Floating Indicator Badge */}
        <div
          style={{
            width: viewLayout === 'split' ? `calc(${splitPercent}% - 5px)` : (viewLayout === 'map-only' ? '100%' : '0px'),
            flex: 'none',
            height: '100%',
            position: 'relative',
            display: viewLayout === 'pano-only' ? 'none' : 'block',
          }}
        >
          <div
            ref={mapContainerRef}
            style={{ width: '100%', height: '100%' }}
          />

          {/* Floating Live Indicator Badge on Map */}
          {currentPosition && (
            <div style={{
              position: 'absolute',
              top: 12,
              left: 12,
              zIndex: 20,
              background: 'rgba(255, 255, 255, 0.94)',
              backdropFilter: 'blur(6px)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-full)',
              padding: '4px 12px',
              boxShadow: 'var(--shadow-modal)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}>
              <span style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#f97316',
                boxShadow: '0 0 0 3px rgba(249, 115, 22, 0.28)',
              }} />
              <span>Street View: <strong>+{currentDistance.toFixed(2)} mi</strong> ({Math.round(currentPov.heading)}°)</span>
              <button
                type="button"
                className="btn btn--ghost btn--xs"
                onClick={() => {
                  if (googleMapInstance.current) {
                    googleMapInstance.current.panTo({ lat: currentPosition.lat, lng: currentPosition.lng });
                    googleMapInstance.current.setZoom(18);
                  }
                }}
                title="Pan map to current location"
                style={{ padding: '2px 6px', fontSize: 10, color: 'var(--accent-primary)', fontWeight: 700 }}
              >
                🎯 Pan Map
              </button>
              {viewLayout === 'map-only' && (
                <button
                  type="button"
                  className="btn btn--primary btn--xs"
                  onClick={() => setViewLayout('split')}
                  title="Switch to Split View to see Street View alongside Map"
                  style={{ padding: '2px 8px', fontSize: 10, borderRadius: 10 }}
                >
                  Open Street View
                </button>
              )}
            </div>
          )}
        </div>

        {/* Draggable Divider Splitter */}
        {viewLayout === 'split' && (
          <div
            onPointerDown={handleSplitPointerDown}
            className="split-resizer"
            style={{
              width: 10,
              flex: 'none',
              cursor: 'col-resize',
              position: 'relative',
              zIndex: 25,
              background: isDraggingSplit ? 'var(--accent-primary)' : 'var(--border-default)',
              display: 'flex',
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
        )}

        {/* Street View Container */}
        <div
          ref={panoContainerRef}
          style={{
            width: viewLayout === 'split' ? `calc(${100 - splitPercent}% - 5px)` : (viewLayout === 'pano-only' ? '100%' : '0px'),
            flex: 'none',
            height: '100%',
            position: 'relative',
            display: viewLayout === 'map-only' ? 'none' : 'block',
          }}
        >
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

          {/* Bottom-Left Horizontal Date Selector (Separate from capture box, doesn't collapse with it) */}
          {isStreetViewActive && availableDates.length > 0 && (
            <div
              className="date-pills-bar"
              style={{
                position: 'absolute',
                bottom: 16,
                left: 16,
                width: 'fit-content',
                maxWidth: isHudCollapsed ? 'calc(100% - 130px)' : 'calc(100% - 440px)',
                zIndex: 30,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                overflowX: 'auto',
                padding: '6px 8px',
                background: 'rgba(15, 23, 42, 0.82)',
                backdropFilter: 'blur(8px)',
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

          {/* Collapsible Distress Capture Side Panel & Floating Toggle */}
          {isStreetViewActive && (
            isHudCollapsed ? (
              /* Minimized Floating Toggle Pill */
              <button
                type="button"
                className="btn"
                style={{
                  position: 'absolute',
                  bottom: 16,
                  right: 16,
                  zIndex: 30,
                  boxShadow: 'var(--shadow-modal)',
                  backdropFilter: 'blur(8px)',
                  background: 'rgba(15, 23, 42, 0.92)',
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: 'var(--radius-full)',
                  padding: '6px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
                onClick={() => setIsHudCollapsed(false)}
                title="Open Capture Panel (Spacebar to capture)"
              >
                <span>📸</span>
                <span style={{ color: '#38bdf8', fontWeight: 700 }}>◀ Show</span>
              </button>
            ) : (
              /* Expanded Side-Docked HUD Panel */
              <div
                style={{
                  position: 'absolute',
                  bottom: 16,
                  right: 16,
                  width: 410,
                  maxWidth: 'calc(100% - 32px)',
                  maxHeight: 'calc(100% - 32px)',
                  background: 'rgba(255, 255, 255, 0.98)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-xl)',
                  padding: 16,
                  boxShadow: 'var(--shadow-modal)',
                  zIndex: 30,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  overflowY: 'auto',
                }}
              >
                {/* Header: Title, Active Year Badge, and Hide/Collapse button */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                      📸 Capture
                    </span>
                    {currentImageYear && (
                      <span
                        style={{
                          background: '#e0f2fe',
                          color: '#0369a1',
                          border: '1px solid #bae6fd',
                          borderRadius: 'var(--radius-sm)',
                          padding: '1px 7px',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                        title={`Imagery Observation Year: ${currentImageYear}`}
                      >
                        Year: {currentImageYear}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setIsHudCollapsed(true)}
                    title="Hide panel so it doesn't block the screen"
                    style={{
                      padding: '2px 8px',
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span>Hide</span>
                    <span>▶</span>
                  </button>
                </div>

                {/* Telemetry Bar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>
                      GPS: <strong style={{ color: 'var(--text-primary)' }}>{currentPosition ? `${currentPosition.lat.toFixed(4)}°, ${currentPosition.lng.toFixed(4)}°` : '—'}</strong>
                    </span>
                    <span>
                      Offset: <strong style={{ color: 'var(--accent-primary)' }}>+{currentDistance.toFixed(2)} mi</strong>
                    </span>
                    <span>
                      Bearing: <strong style={{ color: 'var(--text-primary)' }}>{Math.round(currentPov.heading)}°</strong>
                    </span>
                  </div>
                </div>

                {/* Autocomplete Combobox Input + Capture Button */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div ref={distressComboboxRef} style={{ flex: 1, position: 'relative' }}>
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
                        style={{ fontWeight: 600, fontSize: 13, height: 38, paddingRight: 28 }}
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

                    {/* Autocomplete Dropdown Menu */}
                    {isDistressDropdownOpen && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 4px)',
                          left: 0,
                          right: 0,
                          zIndex: 100,
                          background: '#ffffff',
                          border: '1px solid var(--border-strong)',
                          borderRadius: 'var(--radius-md)',
                          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                          maxHeight: 210,
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
                                  padding: '8px 12px',
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
                              padding: '8px 12px',
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

                  <button
                    className="btn btn--primary btn--md"
                    onClick={handleCaptureDistress}
                    disabled={isCapturing}
                    style={{ gap: 6, padding: '0 16px', height: 38, fontWeight: 700, whiteSpace: 'nowrap' }}
                    title="Capture snapshot with active date/year (or press Spacebar)"
                  >
                    {isCapturing ? <span className="spinner spinner--white" /> : <span>📸 Capture</span>}
                  </button>
                </div>

                {/* Optional Inspector Notes */}
                <input
                  className="form-input"
                  value={distressNotes}
                  onChange={e => setDistressNotes(e.target.value)}
                  placeholder="Optional notes / severity (press Spacebar to capture)..."
                  style={{ fontSize: 11, padding: '5px 10px', height: 30 }}
                />

                {/* Quick-Pick Mini Bar (Only top 3 recents for fast one-tap reuse) */}
                {quickPicks.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>Quick:</span>
                    {quickPicks.map(qp => {
                      const isActive = distressInput.toLowerCase() === qp.toLowerCase();
                      return (
                        <button
                          key={qp}
                          type="button"
                          className={`btn btn--xs ${isActive ? 'btn--primary' : 'btn--secondary'}`}
                          onClick={() => handleSelectDistress(qp)}
                          style={{ padding: '2px 8px', fontSize: 11, borderRadius: 12 }}
                        >
                          {qp}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Footer status / tips */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--text-muted)', paddingTop: 2 }}>
                  <span>Tip: Press <strong>Spacebar</strong> to capture</span>
                  <span>Captured Year: <strong>{currentImageYear || 'Current'}</strong></span>
                </div>
              </div>
            )
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
          onClose={() => setInspectCapture(null)}
        />
      )}
    </div>
  );
}
