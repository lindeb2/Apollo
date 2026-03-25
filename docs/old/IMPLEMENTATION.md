# Apollo Implementation Documentation

## Architecture Overview

Apollo is a single-page web application built with React and Vite, using IndexedDB for local persistence and Web Audio API for audio processing.

### Core Design Principles

1. **Browser-only** - No server, no cloud, no native wrappers
2. **Deterministic** - Same project always produces identical exports
3. **Non-destructive** - Audio blobs are immutable, clips are metadata overlays
4. **Persistent** - All state survives page refresh
5. **Correctness over polish** - Exact math, strict adherence to spec

## Technology Stack

### Frontend Framework
- **React 18.3** - UI components and rendering
- **Vite 5.1** - Build tool and dev server
- **Tailwind CSS 3.4** - Utility-first styling

### State Management
- **Zustand 4.5** - Central state store
  - Chosen for simplicity and minimal boilerplate
  - Provides middleware for persistence
  - Easy integration with React hooks

### Storage Layer
- **Dexie.js 4.0** - IndexedDB wrapper
  - Chosen for promise-based API and TypeScript support
  - Handles schema versioning and migrations
  - Provides transaction management

### Audio Processing
- **Web Audio API** - Core audio engine
  - 44.1kHz sample rate (always)
  - 32-bit float internal processing
  - OfflineAudioContext for deterministic rendering
- **wavesurfer.js 7.7** - Waveform visualization
  - Efficient canvas-based rendering
  - Zoom and scroll capabilities
  - Region selection for loop points

### UI Components
- **Lucide React** - Icon library (tree-shakeable, modern)

## Data Flow

```
User Action
    ↓
React Component
    ↓
Zustand Store Action
    ↓
[Update State + Push to Undo Stack]
    ↓
Trigger Autosave (debounced 2s)
    ↓
IndexedDB Write (projects + undo tables)
```

### Read Path
```
IndexedDB
    ↓
Load Project Data
    ↓
Zustand Store
    ↓
React Components (via hooks)
```

## Storage Schema

### IndexedDB Structure

**Database:** `ApolloDB` (version 1)

**Tables:**

1. **projects**
   - Primary key: `projectId`
   - Indexes: `projectName`, `lastModified`
   - Stores: Complete project JSON + metadata

2. **media**
   - Primary key: `blobId`
   - Indexes: `fileName`, `createdAt`
   - Stores: Audio Blob + metadata (sample rate, duration, channels)

3. **undo**
   - Composite key: `[projectId + actionIndex]`
   - Indexes: `projectId`, `actionIndex`, `timestamp`
   - Stores: Undo action history (circular buffer, max 100)

### Time Value Convention

**Critical:** All time values in storage and project JSON are in **milliseconds**.

Web Audio API uses seconds, so conversions are required:
```javascript
// Storage → Audio API
const seconds = milliseconds / 1000;

// Audio API → Storage
const milliseconds = seconds * 1000;
```

## Audio Mathematics

### Volume Mapping

Slider range: 0-100

**Decibels:**
```
dB = -60 + (slider / 100) × 60
```

**Linear gain:**
```
gain = 10^(dB / 20)
```

**Examples:**
- Slider 0 → -60dB → gain 0.001
- Slider 50 → -30dB → gain 0.0316
- Slider 100 → 0dB → gain 1.0

### Pan Mapping

Slider range: -100 to +100
Normalized range: -1 to +1

**Equal-power panning:**
```javascript
angle = (pan + 1) × π / 4
leftGain = cos(angle)
rightGain = sin(angle)
```

**Examples:**
- Pan -100 → L=1.0, R=0.0
- Pan 0 → L=0.707, R=0.707 (√2/2)
- Pan +100 → L=0.0, R=1.0

### Gain Drag Interaction

**Spec:** 100 pixels vertical = ±6.0 dB

```javascript
deltaDb = -(deltaY / 100) × 6.0
```

Negative sign because drag down = decrease volume.

### Choir Panning Matrix

```javascript
const matrices = {
  1: [0],
  2: [30, -30],
  3: [0, 40, -40],
  4: [25, -65, 65, -25],
  5: [0, 70, -70, 35, -35],
};
```

Pan values are on -100 to +100 scale.

## Undo/Redo System

### Architecture

- **Circular buffer** of max 100 actions
- **Persist to IndexedDB** on each autosave
- **State snapshots** - full project state at each undo point
- **Survives refresh** - loaded from IndexedDB on project open

### Implementation

```javascript
// On action
undoStack.push({
  description: "Move clip",
  state: JSON.parse(JSON.stringify(project))
});

// Keep last 100
undoStack = undoStack.slice(-100);

// Save to IndexedDB
for (let i = 0; i < undoStack.length; i++) {
  await saveUndoAction(projectId, undoStack[i], i);
}
```

### Circular Buffer Logic

Index calculation: `actionIndex = currentIndex % 100`

This ensures the undo table never exceeds 100 entries per project.

## Autosave Mechanism

### Debouncing Strategy

1. User makes change
2. Store marks `isDirty = true`
3. Store calls `triggerAutosave()`
4. Existing timeout is cleared
5. New timeout set for 2000ms
6. After 2s idle, `performAutosave()` executes

### Save Operation

```javascript
async performAutosave() {
  1. Save project to IndexedDB
  2. Save undo history (last 100 actions)
  3. Update lastSaved timestamp
  4. Set isDirty = false
}
```

### Force Save

For critical operations (export, close project):
```javascript
await forceSave(); // Immediate, no debounce
```

## Audio Import Pipeline

### Phase 1 Implementation

```
File Input
    ↓
ArrayBuffer
    ↓
AudioContext.decodeAudioData()
    ↓
Resample to 44.1kHz (if needed)
    ↓
Convert to Blob
    ↓
Store in IndexedDB (media table)
    ↓
Create Track + Clip metadata
    ↓
Add to project
```

### Supported Formats

- WAV (PCM, float)
- MP3
- FLAC

Browser's native decoders handle format parsing.

### Resampling

If source sample rate ≠ 44.1kHz:

```javascript
const offlineCtx = new OfflineAudioContext(
  channels,
  duration * 44100,
  44100
);
// Render at 44.1kHz
const resampled = await offlineCtx.startRendering();
```

## Export Engine

### Rendering Pipeline

```
OfflineAudioContext (44.1kHz)
    ↓
For each track:
    - Apply volume (dB → gain)
    - Apply pan (equal-power)
    - Schedule clips on timeline
    ↓
Mix to stereo
    ↓
Render to AudioBuffer
    ↓
Convert to 16-bit PCM WAV
    ↓
Trigger browser download
```

### WAV Encoding

Headers (44 bytes):
- RIFF chunk
- fmt chunk (PCM, 16-bit, 44.1kHz, stereo)
- data chunk

Sample conversion:
```javascript
// Float32 (-1 to +1) → Int16 (-32768 to +32767)
const sample = Math.max(-1, Math.min(1, float));
const int16 = sample < 0 
  ? sample * 32768 
  : sample * 32767;
```

**No dithering** (per spec).

### Export Preset Logic

Each preset calculates:
1. Which tracks to include
2. Gain adjustments per track
3. Pan adjustments per track
4. Number of output files

See `MASTER SYSTEM PROMPT v1.0.md` section 5 for exact formulas.

## Recording System

### Punch & Split Model

**Non-loop recording:**
- New clip overlays existing clips
- Existing clips are split/cropped (metadata only)
- Original audio preserved in IndexedDB
- Clips can be moved to reveal original audio

**Loop recording (destructive in session):**
- When loop enabled AND recording over current-session recording
- Second pass overwrites first (destructive)
- Original audio still in IndexedDB
- Undo restores previous recording

### MediaDevices API

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }
});
```

Recording to AudioBuffer via ScriptProcessorNode or AudioWorklet (Phase 3).

## Project Portability

### JSON Export

```javascript
{
  version: "1.0.0",
  projectId: "...",
  // ... full project structure
}
```

References blobs by `blobId`. Import requires blobs to exist in IndexedDB.

### ZIP Export

```
project.zip/
  ├── project.json
  └── media/
      ├── {blobId1}.wav
      ├── {blobId2}.wav
      └── ...
```

ZIP import:
1. Extract project.json
2. Extract all media files
3. Store blobs in IndexedDB
4. Restore project

Uses JSZip library (to be added in Phase 3).

## Testing Strategy

### Unit Tests (Vitest)

**Audio Math:**
- `volumeToDb(50) === -30`
- `volumeToGain(100) === 1.0`
- `equalPowerPan(0) === [0.707, 0.707]`
- `pixelsToDbChange(-100) === +6.0`

**Choir Panning:**
- `getChoirPanMatrix(2) === [30, -30]`

**Export Presets:**
- Verify gain offsets
- Verify pan positions

### Integration Tests

**Persistence:**
- Create project → refresh → verify state identical
- Undo 100 times → refresh → verify history intact
- Export ZIP → import → verify audio playback identical

**Recording:**
- Record over clip → verify split/crop behavior
- Loop record → verify overwrite behavior

### Manual QA

**Critical paths:**
- Import various audio formats
- Record vocals
- Edit clips (move, crop, gain drag)
- Export all 7 presets
- Verify bit-identical exports

## Performance Considerations

### Waveform Rendering

- Use wavesurfer.js peaks caching
- Render at appropriate zoom levels
- Lazy load waveforms for off-screen clips

### IndexedDB Operations

- Batch undo history saves
- Debounce autosave to reduce writes
- Use transactions for multi-table operations

### Audio Rendering

- OfflineAudioContext is synchronous and blocking
- Show progress indicator for long exports
- Consider Web Workers for encoding (future optimization)

## Browser Compatibility

**Required APIs:**
- Web Audio API (baseline: all modern browsers)
- IndexedDB (baseline: IE10+, all modern browsers)
- MediaDevices.getUserMedia (baseline: Chrome 53+, Firefox 36+, Safari 11+)
- ES2020 features (baseline: Chrome 80+, Firefox 74+, Safari 13.1+)

**Known limitations:**
- Safari has smaller IndexedDB quota (50MB default, expandable)
- Firefox has stricter autoplay policies (may affect playback start)

## Future Enhancements (Out of Scope for MVP)

These are explicitly **not** in the MVP but documented for reference:

- ❌ Tempo/BPM/snapping
- ❌ MIDI support
- ❌ Cloud sync
- ❌ MP3 export
- ❌ DSP effects (reverb, EQ, compression)
- ❌ Native/Electron builds
- ❌ Metronome
- ❌ Time signature

## Development Guidelines

### Code Style

- Use functional components (hooks)
- Prefer const over let
- Use async/await over promises
- Comment complex audio math
- Validate inputs at boundaries

### Error Handling

- Try/catch all async operations
- Display user-friendly error messages
- Log technical details to console
- Never crash the app silently

### Naming Conventions

- Components: PascalCase
- Functions: camelCase
- Constants: UPPER_SNAKE_CASE
- Files: kebab-case or PascalCase (match component name)

## API Reference

### Zustand Store Actions

```javascript
// Project
initProject(name)
loadProject(projectData)
updateProject(updater, description)

// Undo/Redo
undo()
redo()

// Persistence
triggerAutosave()
performAutosave()
forceSave()

// Transport
play()
pause()
stop()
setCurrentTime(timeMs)

// Recording
startRecording()
stopRecording()

// Selection
selectTrack(trackId)
```

### IndexedDB Functions

```javascript
// Projects
saveProject(project)
loadProject(projectId)
deleteProject(projectId)
listProjects()

// Media
storeMediaBlob(fileName, audioBuffer, blob)
getMediaBlob(blobId)
mediaExists(blobId)

// Undo
saveUndoAction(projectId, action, index)
loadUndoHistory(projectId)
clearUndoHistory(projectId)

// Import/Export
exportProjectJSON(project)
importProjectJSON(jsonString)
```

### Audio Utilities

```javascript
volumeToDb(sliderValue)
dbToVolume(db)
dbToGain(db)
gainToDb(gain)
volumeToGain(sliderValue)

panToNormalized(sliderValue)
normalizedToPan(normalized)
equalPowerPan(pan)

msToSeconds(ms)
secondsToMs(seconds)
formatTime(ms)

pixelsToDbChange(deltaY)
getChoirPanMatrix(numParts)
sanitizeFilename(name)
```

## Deployment

### Production Build

```bash
npm run build
```

Output: `dist/` directory with static files.

### Hosting

Deploy `dist/` to any static file host:
- Netlify
- Vercel
- GitHub Pages
- AWS S3 + CloudFront
- Any web server (nginx, Apache)

No server-side logic required.

### HTTPS Requirement

MediaDevices API (recording) requires HTTPS in production.

Local development (localhost) works over HTTP.

---

**Document Version:** 1.0.0  
**Last Updated:** Phase 0 completion  
**Next Update:** After Phase 1 implementation
