/**
 * firestoreService.js
 * Cloud Firestore sync for TxDOT Distress Studio projects, sections, and distress captures.
 *
 * Structure:
 * /users/{userId}/projects/{projectId}
 */
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './config';

function serializeCoordinatesForFirestore(coords) {
  if (!coords) return { coordinates: null, coordinatesJson: null };
  try {
    const coordinatesJson = JSON.stringify(coords);
    const firestoreSafe = {
      status: coords.status || 'unknown',
      timestamp: coords.timestamp || null,
      highwayRoute: coords.highwayRoute || null,
      roadbed: coords.roadbed || null,
      routeId: coords.routeId || null,
      lengthMiles: coords.lengthMiles ?? null,
      begin: coords.begin || null,
      end: coords.end || null,
      beginDfo: coords.beginDfo ?? null,
      endDfo: coords.endDfo ?? null,
    };
    return { coordinates: firestoreSafe, coordinatesJson };
  } catch {
    return { coordinates: null, coordinatesJson: null };
  }
}

function deserializeSectionCoordinates(s) {
  if (s.coordinatesJson) {
    try {
      const parsed = JSON.parse(s.coordinatesJson);
      if (parsed) return parsed;
    } catch {}
  }
  return s.coordinates || null;
}

function sanitizeProject(project) {
  return {
    id: project.id,
    name: project.name || 'Untitled Project',
    updatedAt: serverTimestamp(),
    sections: Array.isArray(project.sections)
      ? project.sections.map(s => {
          const { coordinates, coordinatesJson } = serializeCoordinatesForFirestore(s.coordinates);
          return {
            _uuid: s._uuid || s.id,
            id: s.id || '',
            highway: s.highway || '',
            district: s.district || '',
            countyName: s.countyName || null,
            beginRef: s.beginRef ?? 0,
            endRef: s.endRef ?? 0,
            csj: s.csj || null,
            sn: s.sn || null,
            coordinates,
            coordinatesJson,
            captures: Array.isArray(s.captures)
              ? s.captures.map(c => ({
                  id: c.id,
                  sectionId: s.id,
                  distressType: c.distressType || 'Unspecified Distress',
                  lat: c.lat,
                  lon: c.lon,
                  heading: c.heading ?? 0,
                  pitch: c.pitch ?? 0,
                  fov: c.fov ?? 90,
                  distanceFromStartMiles: c.distanceFromStartMiles ?? 0,
                  capturedAt: c.capturedAt || new Date().toISOString(),
                  imageUrl: c.imageUrl || null,
                  notes: c.notes || '',
                }))
              : [],
          };
        })
      : [],
  };
}

export function subscribeToUserProjects(userId, onUpdate, onError) {
  if (!db || !userId) {
    if (onUpdate) onUpdate([]);
    return () => {};
  }
  const colRef = collection(db, 'users', userId, 'projects');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const projects = snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || 'Untitled Project',
          sections: Array.isArray(data.sections)
            ? data.sections.map(s => ({
                ...s,
                coordinates: deserializeSectionCoordinates(s),
                captures: Array.isArray(s.captures) ? s.captures : [],
              }))
            : [],
        };
      });
      onUpdate(projects);
    },
    (err) => {
      console.error('Firestore subscription error:', err);
      if (onError) onError(err);
    }
  );
}

export async function saveUserProject(userId, project) {
  if (!db || !userId || !project?.id) return;
  const docRef = doc(db, 'users', userId, 'projects', project.id);
  const data = sanitizeProject(project);
  await setDoc(docRef, data, { merge: true });
}

export async function deleteUserProject(userId, projectId) {
  if (!db || !userId || !projectId) return;
  const docRef = doc(db, 'users', userId, 'projects', projectId);
  await deleteDoc(docRef);
}

export async function batchMigrateProjects(userId, projects) {
  if (!db || !userId || !Array.isArray(projects) || projects.length === 0) return;
  const batch = writeBatch(db);
  for (const p of projects) {
    if (!p.id) continue;
    const ref = doc(db, 'users', userId, 'projects', p.id);
    batch.set(ref, sanitizeProject(p), { merge: true });
  }
  await batch.commit();
}
