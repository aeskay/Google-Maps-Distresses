/**
 * App.jsx
 * Root application container for Google Distress Locator.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { get, set } from 'idb-keyval';

import Topbar from './components/Topbar';
import Sidebar from './components/Sidebar';
import MapTab from './components/tabs/MapTab';
import ConditionTab from './components/tabs/ConditionTab';
import CapturesTab from './components/tabs/CapturesTab';
import DataTab from './components/tabs/DataTab';
import ToastContainer from './components/ToastContainer';

import NewProjectModal from './components/modals/NewProjectModal';
import OpenProjectsModal from './components/modals/OpenProjectsModal';
import AuthModal from './components/modals/AuthModal';

import { onAuthChange } from './firebase/authService';
import {
  subscribeToUserProjects,
  saveUserProject,
  deleteUserProject,
  batchMigrateProjects,
} from './firebase/firestoreService';

import { parsePmisCSV } from './utils/pmisParser';
import { createBlankState, createDefaultProject } from './utils/projectStore';
import { hydrateSectionsWithCachedCoordinates, batchGenerateCoordinates } from './utils/txdotGisApi';

const TABS = [
  { id: 'map',       label: 'Map & Street View', icon: '🗺️' },
  { id: 'captures',  label: 'Captures',          icon: '📸' },
  { id: 'condition', label: 'Condition',         icon: '📊' },
  { id: 'data',      label: 'Data Table',        icon: '📋' },
];

const WORKING_STATE_KEY = 'txdot-distress:working-state';
const SAVE_DEBOUNCE_MS = 800;

let _toastId = 0;

export default function App() {
  // ── Project State ──────────────────────────────────────────────────────────
  const [state, setState] = useState(() => {
    const blank = createBlankState();
    const defaultProj = createDefaultProject('Highway Inspection #1');
    blank.projects = [defaultProj];
    return blank;
  });

  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [focusSectionTrigger, setFocusSectionTrigger] = useState(0);
  const [activeTab, setActiveTab] = useState('map');

  const handleSelectSection = useCallback((id, shouldFocus = true) => {
    setSelectedSectionId(id);
    if (shouldFocus) {
      setFocusSectionTrigger(prev => prev + 1);
    }
  }, []);

  const [targetCapture, setTargetCapture] = useState(null);

  const handleViewInMapTab = useCallback((capture) => {
    if (!capture) return;
    if (capture.sectionId && capture.sectionId !== selectedSectionId) {
      handleSelectSection(capture.sectionId, false);
    }
    setTargetCapture({
      ...capture,
      _triggerTime: Date.now(),
    });
    setActiveTab('map');
  }, [selectedSectionId, handleSelectSection]);

  const [saveStatus, setSaveStatus] = useState(null); // 'saving' | 'saved' | null
  const [cloudSyncStatus, setCloudSyncStatus] = useState('offline'); // 'synced' | 'saving' | 'offline' | 'error'
  const [currentUser, setCurrentUser] = useState(null);

  // ── PMIS Database State ────────────────────────────────────────────────────
  const [pmisFileName, setPmisFileName] = useState(null);
  const [pmisMap, setPmisMap] = useState(null);
  const [pmisLoading, setPmisLoading] = useState(false);
  const [pmisProgress, setPmisProgress] = useState(0);

  // ── Modals & Toasts ────────────────────────────────────────────────────────
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showOpenProjectsModal, setShowOpenProjectsModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [toasts, setToasts] = useState([]);

  const saveTimerRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  // ── Toast Helpers ──────────────────────────────────────────────────────────
  const addToast = useCallback((type, title, desc, duration = 4500) => {
    const id = ++_toastId;
    setToasts(t => [...t, { id, type, title, desc }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  // ── Firebase Auth & Real-Time Sync ─────────────────────────────────────────
  useEffect(() => {
    let unsubscribeProjects = null;

    const unsubscribeAuth = onAuthChange(user => {
      setCurrentUser(user);
      if (user) {
        setCloudSyncStatus('saving');
        unsubscribeProjects = subscribeToUserProjects(
          user.uid,
          async (cloudProjects) => {
            setCloudSyncStatus('synced');
            if (cloudProjects.length === 0) {
              // Migrate local projects to cloud if cloud is currently empty
              setState(prev => {
                if (prev.projects && prev.projects.length > 0) {
                  batchMigrateProjects(user.uid, prev.projects)
                    .then(() => addToast('info', 'Cloud Sync', 'Local projects uploaded to your cloud account.'))
                    .catch(err => console.warn('Failed to migrate local projects to cloud:', err));
                }
                return prev;
              });
            } else {
              // Populate state from cloud and hydrate coordinates cache
              const hydrated = await Promise.all(
                cloudProjects.map(async (p) => {
                  if (Array.isArray(p.sections)) {
                    const { sections } = await hydrateSectionsWithCachedCoordinates(p.sections);
                    return { ...p, sections };
                  }
                  return p;
                })
              );

              setState(prev => ({ ...prev, projects: hydrated }));
              setSelectedProjectId(prevId => {
                if (hydrated.some(p => p.id === prevId)) return prevId;
                return hydrated[0]?.id || null;
              });
            }
          },
          (err) => {
            console.error('Firestore subscription error:', err);
            setCloudSyncStatus('error');
            addToast('error', 'Cloud sync error', err.message);
          }
        );
      } else {
        if (unsubscribeProjects) {
          unsubscribeProjects();
          unsubscribeProjects = null;
        }
        setCloudSyncStatus('offline');
        // Restore local working state from IndexedDB when signed out
        get(WORKING_STATE_KEY).then(saved => {
          if (saved && Array.isArray(saved.projects) && saved.projects.length > 0) {
            setState(saved);
            setSelectedProjectId(saved.projects[0]?.id || null);
          }
        }).catch(console.warn);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProjects) unsubscribeProjects();
    };
  }, [addToast]);

  // ── Restore PMIS & Local State on Mount ────────────────────────────────────
  useEffect(() => {
    // 1. Restore PMIS database from IndexedDB
    get('cachedPmisData').then(data => {
      if (data && data.pmisMap) {
        setPmisMap(data.pmisMap);
        setPmisFileName(data.pmisFileName || 'PMIS Database');
      }
    }).catch(console.warn);

    // 2. Restore local working state from IndexedDB
    get(WORKING_STATE_KEY).then(async (saved) => {
      if (saved && Array.isArray(saved.projects) && saved.projects.length > 0) {
        const hydrated = await Promise.all(
          saved.projects.map(async (p) => {
            if (Array.isArray(p.sections)) {
              const { sections } = await hydrateSectionsWithCachedCoordinates(p.sections);
              return { ...p, sections };
            }
            return p;
          })
        );
        setState({ ...saved, projects: hydrated });
        setSelectedProjectId(hydrated[0].id);
      } else {
        setSelectedProjectId(state.projects[0]?.id || null);
      }
    }).catch(console.warn);
  }, []);

  // ── Derived Selections ─────────────────────────────────────────────────────
  const selectedProject = useMemo(
    () => state.projects.find(p => p.id === selectedProjectId) || state.projects[0] || null,
    [state.projects, selectedProjectId]
  );

  const selectedSection = useMemo(
    () => selectedProject?.sections?.find(s => s.id === selectedSectionId) || null,
    [selectedProject, selectedSectionId]
  );

  const projectSections = selectedProject?.sections || [];

  // Total captures across active project
  const totalProjectCaptures = useMemo(() => {
    return projectSections.reduce((acc, s) => acc + (s.captures?.length || 0), 0);
  }, [projectSections]);

  // ── Cloud Auto-Save ────────────────────────────────────────────────────────
  const triggerAutoSave = useCallback((newState) => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const user = currentUserRef.current;
      if (user && selectedProjectId) {
        const activeProj = newState.projects.find(p => p.id === selectedProjectId);
        if (activeProj) {
          try {
            setSaveStatus('saving');
            setCloudSyncStatus('saving');
            await saveUserProject(user.uid, activeProj);
            setSaveStatus('saved');
            setCloudSyncStatus('synced');
            setTimeout(() => setSaveStatus(null), 2000);
          } catch (err) {
            console.error('Cloud auto-save error:', err);
            setSaveStatus(null);
            setCloudSyncStatus('error');
          }
        }
      }
    }, SAVE_DEBOUNCE_MS);
  }, [selectedProjectId]);

  // ── Mutate State Helper ────────────────────────────────────────────────────
  const mutate = useCallback((updater) => {
    setState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      triggerAutoSave(next);
      set(WORKING_STATE_KEY, next).catch(console.warn);
      return next;
    });
  }, [triggerAutoSave]);

  // ── Load PMIS CSV / Excel ──────────────────────────────────────────────────
  const loadPmisFromFile = useCallback(async (file) => {
    if (!file) return;
    setPmisFileName(file.name);
    setPmisLoading(true);
    setPmisProgress(0);

    try {
      const name = file.name.toLowerCase();
      let csvText = '';
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const XLSX = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        csvText = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
      } else {
        csvText = await file.text();
      }

      const { pmisMap: map } = await parsePmisCSV(csvText, {
        onProgress: pct => setPmisProgress(pct),
      });

      setPmisMap(map);
      addToast('success', 'PMIS Database Loaded', `${map.size.toLocaleString()} highway groups saved offline.`);

      await set('cachedPmisData', {
        pmisMap: map,
        pmisFileName: file.name,
        cachedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('PMIS Loading Error:', err);
      addToast('error', 'Failed to parse PMIS', err.message);
    } finally {
      setPmisLoading(false);
    }
  }, [addToast]);

  // ── Project Actions ────────────────────────────────────────────────────────
  const handleAddProject = useCallback((name) => {
    const newProject = createDefaultProject(name);
    mutate(prev => ({
      ...prev,
      projects: [...prev.projects, newProject],
    }));
    setSelectedProjectId(newProject.id);
    setSelectedSectionId(null);
    setShowNewProjectModal(false);
    addToast('success', 'Project created', name);

    if (currentUser) {
      setCloudSyncStatus('saving');
      saveUserProject(currentUser.uid, newProject)
        .then(() => setCloudSyncStatus('synced'))
        .catch(err => {
          setCloudSyncStatus('error');
          addToast('error', 'Cloud sync failed', err.message);
        });
    }
  }, [mutate, addToast, currentUser]);

  const handleRenameProject = useCallback((id, newName) => {
    mutate(prev => {
      const nextProjects = prev.projects.map(p => p.id === id ? { ...p, name: newName } : p);
      if (currentUser) {
        const updated = nextProjects.find(p => p.id === id);
        if (updated) saveUserProject(currentUser.uid, updated);
      }
      return { ...prev, projects: nextProjects };
    });
  }, [mutate, currentUser]);

  const handleDeleteProject = useCallback((id) => {
    if (!window.confirm('Delete this project and all its sections and distress captures?')) return;
    mutate(prev => ({
      ...prev,
      projects: prev.projects.filter(p => p.id !== id),
    }));
    if (selectedProjectId === id) {
      setSelectedProjectId(state.projects.find(p => p.id !== id)?.id || null);
      setSelectedSectionId(null);
    }
    if (currentUser) {
      deleteUserProject(currentUser.uid, id);
    }
  }, [mutate, selectedProjectId, state.projects, currentUser]);

  // ── Section Actions ────────────────────────────────────────────────────────
  const handleAddSections = useCallback(async (newSections, importMode = 'merge') => {
    if (!selectedProjectId) return;

    const { sections: hydrated } = await hydrateSectionsWithCachedCoordinates(newSections);
    const incomingList = hydrated || newSections;

    mutate(prev => {
      const nextProjects = prev.projects.map(p => {
        if (p.id !== selectedProjectId) return p;

        if (importMode === 'overwrite') {
          return { ...p, sections: incomingList };
        }

        // Merge mode: update matching section IDs or append new
        const map = new Map((p.sections || []).map(s => [s.id.toLowerCase(), s]));
        for (const inc of incomingList) {
          const key = inc.id.toLowerCase();
          if (map.has(key)) {
            const existing = map.get(key);
            map.set(key, {
              ...existing,
              ...inc,
              captures: existing.captures || [],
              coordinates: inc.coordinates || existing.coordinates || null,
            });
          } else {
            map.set(key, inc);
          }
        }
        return { ...p, sections: Array.from(map.values()) };
      });

      if (currentUser) {
        const updated = nextProjects.find(p => p.id === selectedProjectId);
        if (updated) saveUserProject(currentUser.uid, updated);
      }

      return { ...prev, projects: nextProjects };
    });

    addToast('success', 'Sections Imported', `${newSections.length} section(s) added to project.`);
  }, [selectedProjectId, mutate, currentUser, addToast]);

  const handleUpdateSection = useCallback((updatedSection) => {
    if (!selectedProjectId) return;
    autoCurvingAttemptedRef.current.delete(updatedSection?.id);
    mutate(prev => {
      const nextProjects = prev.projects.map(p => {
        if (p.id !== selectedProjectId) return p;
        return {
          ...p,
          sections: (p.sections || []).map(s => s.id === updatedSection.id ? updatedSection : s),
        };
      });

      if (currentUser) {
        const updated = nextProjects.find(p => p.id === selectedProjectId);
        if (updated) saveUserProject(currentUser.uid, updated);
      }

      return { ...prev, projects: nextProjects };
    });
  }, [selectedProjectId, mutate, currentUser]);

  const handleBatchUpdateSections = useCallback((updatedSections) => {
    if (!selectedProjectId || !Array.isArray(updatedSections)) return;
    const updateMap = new Map(updatedSections.map(s => [s.id, s]));

    mutate(prev => {
      const nextProjects = prev.projects.map(p => {
        if (p.id !== selectedProjectId) return p;
        return {
          ...p,
          sections: (p.sections || []).map(s => updateMap.has(s.id) ? updateMap.get(s.id) : s),
        };
      });

      if (currentUser) {
        const updated = nextProjects.find(p => p.id === selectedProjectId);
        if (updated) saveUserProject(currentUser.uid, updated);
      }

      return { ...prev, projects: nextProjects };
    });
  }, [selectedProjectId, mutate, currentUser]);

  const handleDeleteSection = useCallback((sectionId) => {
    if (!selectedProjectId) return;
    mutate(prev => {
      const nextProjects = prev.projects.map(p => {
        if (p.id !== selectedProjectId) return p;
        return {
          ...p,
          sections: (p.sections || []).filter(s => s.id !== sectionId),
        };
      });

      if (currentUser) {
        const updated = nextProjects.find(p => p.id === selectedProjectId);
        if (updated) saveUserProject(currentUser.uid, updated);
      }

      return { ...prev, projects: nextProjects };
    });

    if (selectedSectionId === sectionId) setSelectedSectionId(null);
  }, [selectedProjectId, mutate, currentUser, selectedSectionId]);

  const handleDeleteSections = useCallback((sectionIds) => {
    if (!selectedProjectId || !Array.isArray(sectionIds) || sectionIds.length === 0) return;
    const toDeleteSet = new Set(sectionIds);
    mutate(prev => {
      const nextProjects = prev.projects.map(p => {
        if (p.id !== selectedProjectId) return p;
        return {
          ...p,
          sections: (p.sections || []).filter(s => !toDeleteSet.has(s.id)),
        };
      });

      if (currentUser) {
        const updated = nextProjects.find(p => p.id === selectedProjectId);
        if (updated) saveUserProject(currentUser.uid, updated);
      }

      return { ...prev, projects: nextProjects };
    });

    if (selectedSectionId && toDeleteSet.has(selectedSectionId)) {
      setSelectedSectionId(null);
    }
  }, [selectedProjectId, mutate, currentUser, selectedSectionId]);

  const handleUpdateProject = useCallback((updatedProject) => {
    if (!updatedProject?.id) return;
    mutate(prev => {
      const nextProjects = prev.projects.map(p => p.id === updatedProject.id ? updatedProject : p);
      if (currentUser) {
        saveUserProject(currentUser.uid, updatedProject);
      }
      return { ...prev, projects: nextProjects };
    });
  }, [mutate, currentUser]);

  // ── Automatic Background Roadway Curve Resolution ─────────────────────────
  const autoCurvingAttemptedRef = useRef(new Set());

  useEffect(() => {
    if (!selectedProjectId) return;
    const project = state.projects?.find(p => p.id === selectedProjectId);
    if (!project || !Array.isArray(project.sections) || project.sections.length === 0) return;

    // Check if any sections lack road curvature or need GPS and have not yet been attempted
    const toResolve = project.sections.filter(s =>
      s.highway &&
      !autoCurvingAttemptedRef.current.has(s.id) &&
      (!s.coordinates || s.coordinates.status !== 'success' || !Array.isArray(s.coordinates?.path) || s.coordinates.path.length <= 2)
    );

    if (toResolve.length === 0) return;

    // Mark as attempted so sections without TxDOT coverage don't loop endlessly
    toResolve.forEach(s => autoCurvingAttemptedRef.current.add(s.id));

    let isCancelled = false;
    const timer = setTimeout(async () => {
      try {
        await batchGenerateCoordinates(
          project.sections,
          null,
          {
            forceUpgradeCurves: true,
            concurrency: 4,
            onBatchChunk: (chunkedSections) => {
              if (isCancelled) return;
              handleBatchUpdateSections(chunkedSections);
            },
          }
        );
      } catch (err) {
        console.warn('Auto background curve resolution error:', err);
      }
    }, 400);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [selectedProjectId, state.projects, handleBatchUpdateSections]);

  // ── Keyboard Shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === 's') {
        e.preventDefault();
        if (selectedProject && currentUser) {
          saveUserProject(currentUser.uid, selectedProject);
          addToast('success', 'Project Saved', `"${selectedProject.name}" saved to cloud.`);
        }
      }
      if (e.key === 'n') {
        e.preventDefault();
        setShowNewProjectModal(true);
      }
      if (e.key === 'o') {
        e.preventDefault();
        setShowOpenProjectsModal(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProject, currentUser, addToast]);

  return (
    <div className="app-shell">
      {/* Top Navigation Bar */}
      <Topbar
        selectedProject={selectedProject}
        saveStatus={saveStatus}
        cloudSyncStatus={cloudSyncStatus}
        currentUser={currentUser}
        onNewProject={() => setShowNewProjectModal(true)}
        onOpenProjects={() => setShowOpenProjectsModal(true)}
        onSaveProject={() => {
          if (!currentUser) {
            setShowAuthModal(true);
            addToast('info', 'Sign in to save', 'Please sign in to save your project to the cloud.');
            return;
          }
          if (selectedProject) {
            saveUserProject(currentUser.uid, selectedProject);
            addToast('success', 'Project Saved', `"${selectedProject.name}" saved to cloud.`);
          }
        }}
        onOpenAuth={() => setShowAuthModal(true)}
        addToast={addToast}
      />

      {/* Main Layout */}
      <div className="main-layout">
        <Sidebar
          pmisFileName={pmisFileName}
          pmisLoading={pmisLoading}
          pmisProgress={pmisProgress}
          onLoadPmis={loadPmisFromFile}
          projects={state.projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={id => { setSelectedProjectId(id); setSelectedSectionId(null); }}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          sections={projectSections}
          selectedSectionId={selectedSectionId}
          onSelectSection={handleSelectSection}
          onAddSections={handleAddSections}
          onUpdateSection={handleUpdateSection}
          onBatchUpdateSections={handleBatchUpdateSections}
          onDeleteSection={handleDeleteSection}
          addToast={addToast}
        />

        <div className="main-content">
          {/* Main Tab Bar */}
          <nav className="tab-bar" role="tablist">
            {TABS.map(tab => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`tab-btn ${activeTab === tab.id ? 'tab-btn--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.id === 'captures' && totalProjectCaptures > 0 && (
                  <span className="tab-badge">{totalProjectCaptures}</span>
                )}
              </button>
            ))}
          </nav>

          {/* Tab Panes (kept mounted to preserve Google Maps & Street View panorama states) */}
          <div style={{ display: activeTab === 'map' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
            <MapTab
              project={selectedProject}
              sections={projectSections}
              selectedSectionId={selectedSectionId}
              onSelectSection={handleSelectSection}
              onUpdateSection={handleUpdateSection}
              addToast={addToast}
              activeTab={activeTab}
              focusSectionTrigger={focusSectionTrigger}
              targetCapture={targetCapture}
            />
          </div>

          <div style={{ display: activeTab === 'captures' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
            <CapturesTab
              project={selectedProject}
              sections={projectSections}
              selectedSectionId={selectedSectionId}
              onSelectSection={handleSelectSection}
              onUpdateSection={handleUpdateSection}
              addToast={addToast}
              onViewInMap={handleViewInMapTab}
            />
          </div>

          <div style={{ display: activeTab === 'condition' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
            <ConditionTab
              section={selectedSection}
              pmisMap={pmisMap}
              pmisLoading={pmisLoading}
              pmisProgress={pmisProgress}
            />
          </div>

          <div style={{ display: activeTab === 'data' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
            <DataTab
              project={selectedProject}
              sections={projectSections}
              pmisMap={pmisMap}
              selectedSectionId={selectedSectionId}
              onSelectSection={id => {
                handleSelectSection(id);
                setActiveTab('map');
              }}
              onDeleteSection={handleDeleteSection}
              onDeleteSections={handleDeleteSections}
              onUpdateProject={handleUpdateProject}
              addToast={addToast}
            />
          </div>
        </div>
      </div>

      {/* Modals */}
      {showNewProjectModal && (
        <NewProjectModal
          onAddProject={handleAddProject}
          onCancel={() => setShowNewProjectModal(false)}
        />
      )}

      {showOpenProjectsModal && (
        <OpenProjectsModal
          projects={state.projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={id => { setSelectedProjectId(id); setSelectedSectionId(null); }}
          onDeleteProject={handleDeleteProject}
          onNewProject={() => setShowNewProjectModal(true)}
          onClose={() => setShowOpenProjectsModal(false)}
        />
      )}

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          addToast={addToast}
        />
      )}

      {/* Floating Notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
