# TxDOT Distress Studio

An interactive pavement distress inspection and capture application built for TxDOT roadway sections, powered by **Google Maps JavaScript API**, **Street View**, and the **TxDOT ArcGIS LRS API**.

---

## Key Features

1. **Section Management & CSV / Excel Import**
   - Import sections with smart auto-suggest column mapping (`ID`, `Highway`, `District`, `County`, `Begin RM`, `End RM`, `CSJ`, etc.).
   - Support for specific highway formats (e.g., `IH0020 R`, `US0059 L`, `FM 2826`).
   - If pre-existing GPS coordinates are in the CSV, they are imported directly.
   - For sections without GPS, one-click **"📍 Gen GPS"** fetches and interpolates official coordinates from the TxDOT ArcGIS REST API with persistent caching in IndexedDB.

2. **Offline Local PMIS Database**
   - Upload your master PMIS `.csv` or `.xlsx` file once.
   - Automatically parsed client-side and saved offline in browser storage (`IndexedDB`) across all sessions.

3. **Google Maps & Street View Workspace**
   - Roadway sections are rendered as interactive polylines on Google Hybrid / Satellite maps.
   - Jump straight to the beginning of any section in **Google Street View** or click anywhere along the route.
   - Split-screen, full Street View, and Map-only view modes.

4. **Real-Time Distress Capture & Smart Suggestions**
   - While navigating in Street View, press **Spacebar** or click **"📸 Capture Distress"**.
   - Captures high-resolution snapshot images (via Street View Static API), exact GPS coordinates (lat, lon), camera bearing, pitch, and relative stationing (`+X.XX miles from start`).
   - **Inline Distress Type Suggestions**: Standard TxDOT pavement distress presets (Alligator Cracking, Rutting, Spalling, Punchout, etc.) plus recently typed custom entries shown as one-click chips below the input box.

5. **Captures Tab & Export**
   - Gallery card grid and tabular inspection log.
   - Filter by section or search distress types.
   - **Export CSV Report**: download an instant spreadsheet summary.
   - **Download ZIP Bundle**: packages all high-resolution snapshot images with the CSV report.

6. **Firebase Authentication & Cloud Firestore Sync**
   - Real-time cloud sync across sessions and devices.
   - In-app **Settings Modal** to easily paste Firebase configuration or Google Maps API key without editing code.

---

## Quick Start

### 1. Start the Development Server
```bash
npm run dev
```
Open [http://localhost:5174](http://localhost:5174) in your browser.

### 2. Enter Your API Keys
Click the **⚙️ Settings** button in the top navigation bar:
- **Google Maps Platform API Key**: Enable **Maps JavaScript API** and **Street View Static API** in Google Cloud Console.
- **Firebase Configuration**: Paste your web app configuration from Firebase Console.

### 3. Firestore Security Rules
In Firebase Console > Firestore Database > Rules, paste:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
