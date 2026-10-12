/**
 * SettingsModal.jsx
 * In-app configuration for Google Maps API Key and Firebase / Firestore setup.
 */
import React, { useState } from 'react';
import {
  getStoredGoogleMapsApiKey,
  saveGoogleMapsApiKey,
  loadGoogleMapsApi,
} from '../../utils/googleMapsLoader';
import {
  getStoredFirebaseConfig,
  saveStoredFirebaseConfig,
} from '../../firebase/config';

const FIRESTORE_RULES_SNIPPET = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}`;

export default function SettingsModal({ onClose, addToast }) {
  const [activeTab, setActiveTab] = useState('google'); // 'google' | 'firebase'

  // Google Maps state
  const [googleKey, setGoogleKey] = useState(getStoredGoogleMapsApiKey());
  const [googleTesting, setGoogleTesting] = useState(false);
  const [googleStatus, setGoogleStatus] = useState(null); // 'valid' | 'invalid' | null

  // Firebase state
  const currentFb = getStoredFirebaseConfig();
  const [fbApiKey, setFbApiKey] = useState(currentFb.apiKey || '');
  const [fbAuthDomain, setFbAuthDomain] = useState(currentFb.authDomain || '');
  const [fbProjectId, setFbProjectId] = useState(currentFb.projectId || '');
  const [fbStorageBucket, setFbStorageBucket] = useState(currentFb.storageBucket || '');
  const [fbMessagingSenderId, setFbMessagingSenderId] = useState(currentFb.messagingSenderId || '');
  const [fbAppId, setFbAppId] = useState(currentFb.appId || '');
  const [rawJsonPaste, setRawJsonPaste] = useState('');

  // Handle parsing JSON paste (e.g. copied directly from Firebase Console)
  function handlePasteFirebaseConfig(raw) {
    setRawJsonPaste(raw);
    try {
      // Clean string if copied as const firebaseConfig = { ... };
      const cleaned = raw.replace(/^[^{]*/, '').replace(/[^}]*$/, '');
      const parsed = JSON.parse(cleaned);
      if (parsed.apiKey) setFbApiKey(parsed.apiKey);
      if (parsed.authDomain) setFbAuthDomain(parsed.authDomain);
      if (parsed.projectId) setFbProjectId(parsed.projectId);
      if (parsed.storageBucket) setFbStorageBucket(parsed.storageBucket);
      if (parsed.messagingSenderId) setFbMessagingSenderId(parsed.messagingSenderId);
      if (parsed.appId) setFbAppId(parsed.appId);
      addToast('success', 'Firebase config parsed', 'Configuration fields auto-filled!');
    } catch {}
  }

  async function handleSaveGoogle() {
    saveGoogleMapsApiKey(googleKey.trim());
    setGoogleTesting(true);
    setGoogleStatus(null);
    try {
      await loadGoogleMapsApi(googleKey.trim());
      setGoogleStatus('valid');
      addToast('success', 'Google Maps API Connected', 'Key saved and verified successfully.');
    } catch (err) {
      setGoogleStatus('invalid');
      addToast('error', 'Google Maps Error', err.message);
    } finally {
      setGoogleTesting(false);
    }
  }

  function handleSaveFirebase() {
    const config = {
      apiKey: fbApiKey.trim(),
      authDomain: fbAuthDomain.trim(),
      projectId: fbProjectId.trim(),
      storageBucket: fbStorageBucket.trim(),
      messagingSenderId: fbMessagingSenderId.trim(),
      appId: fbAppId.trim(),
    };
    saveStoredFirebaseConfig(config);
    addToast('success', 'Firebase Config Saved', 'Reloading page to initialize Firebase with your project credentials…');
    setTimeout(() => window.location.reload(), 1200);
  }

  function handleCopyRules() {
    navigator.clipboard.writeText(FIRESTORE_RULES_SNIPPET);
    addToast('success', 'Rules Copied', 'Firestore Security Rules copied to clipboard!');
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal--lg">
        <div className="modal__header">
          <div className="modal__title">API & Cloud Settings</div>
          <button className="btn btn--ghost btn--icon" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          {/* Settings Tabs */}
          <div className="segmented-group" style={{ width: '100%', marginBottom: 18 }}>
            <button
              type="button"
              className={`segmented-btn ${activeTab === 'google' ? 'segmented-btn--active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => setActiveTab('google')}
            >
              🗺️ Google Maps & Street View
            </button>
            <button
              type="button"
              className={`segmented-btn ${activeTab === 'firebase' ? 'segmented-btn--active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => setActiveTab('firebase')}
            >
              🔥 Firebase & Firestore
            </button>
          </div>

          {/* Google Maps Tab */}
          {activeTab === 'google' && (
            <div>
              <div style={{ marginBottom: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Enter your Google Maps Platform API Key to enable the interactive map, Street View navigation, and high-resolution snapshot captures.
              </div>

              <div className="form-group">
                <label className="form-label">Google Maps API Key</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    className="form-input"
                    value={googleKey}
                    onChange={e => setGoogleKey(e.target.value)}
                    placeholder="AIzaSy..."
                  />
                  <button
                    className="btn btn--primary"
                    onClick={handleSaveGoogle}
                    disabled={googleTesting || !googleKey.trim()}
                  >
                    {googleTesting ? <span className="spinner" /> : 'Save & Verify'}
                  </button>
                </div>
                <div className="form-hint" style={{ marginTop: 8 }}>
                  Requires: <strong>Maps JavaScript API</strong> and <strong>Street View Static API</strong> enabled on Google Cloud Console.
                </div>
              </div>

              {googleStatus === 'valid' && (
                <div style={{ padding: '8px 12px', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', borderRadius: 'var(--radius-md)', fontSize: 12 }}>
                  ✓ Google Maps API key loaded and validated!
                </div>
              )}
            </div>
          )}

          {/* Firebase Tab */}
          {activeTab === 'firebase' && (
            <div>
              <div style={{ marginBottom: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Paste your Firebase Web App configuration from Firebase Console (<strong>Project settings &gt; General &gt; Your apps &gt; SDK setup and configuration</strong>).
              </div>

              <div className="form-group">
                <label className="form-label">Quick Paste (Config JSON or JS Object)</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={rawJsonPaste}
                  onChange={e => handlePasteFirebaseConfig(e.target.value)}
                  placeholder='const firebaseConfig = { apiKey: "...", projectId: "...", ... };'
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">API Key</label>
                  <input className="form-input" value={fbApiKey} onChange={e => setFbApiKey(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Project ID</label>
                  <input className="form-input" value={fbProjectId} onChange={e => setFbProjectId(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Auth Domain</label>
                  <input className="form-input" value={fbAuthDomain} onChange={e => setFbAuthDomain(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">App ID</label>
                  <input className="form-input" value={fbAppId} onChange={e => setFbAppId(e.target.value)} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button className="btn btn--primary" onClick={handleSaveFirebase}>
                  💾 Save & Reinitialize Firebase
                </button>
              </div>

              <div className="divider" style={{ margin: '16px 0' }} />

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>
                    Recommended Firestore Security Rules (Firebase Console &gt; Firestore &gt; Rules)
                  </label>
                  <button className="btn btn--secondary btn--sm" onClick={handleCopyRules}>
                    📋 Copy Rules
                  </button>
                </div>
                <pre style={{
                  background: 'var(--bg-elevated)',
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-strong)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: '#0f172a',
                  overflowX: 'auto',
                }}>
                  {FIRESTORE_RULES_SNIPPET}
                </pre>
              </div>
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
