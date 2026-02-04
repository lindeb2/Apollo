# ChoirMaster - LLM Developer Context

**Quick Start for LLMs:** This document provides all essential context needed to understand and modify the ChoirMaster codebase. Read this before requesting changes.

---

## Tool Usage Guidelines

**When using Claude with Filesystem connector, follow this workflow:**

1. **Start by reading this document** - You're doing it now!
2. **List available files** - Use `Filesystem:list_directory` or `Filesystem:directory_tree` to understand structure
3. **Read relevant files** - Use `Filesystem:read_text_file` for single files or `Filesystem:read_multiple_files` for batch reading
4. **Make targeted edits** - Use `Filesystem:edit_file` for small changes with line-based replacements
5. **Write new files** - Use `Filesystem:write_file` for new files or complete rewrites
6. **Verify changes** - Read the modified file back to confirm correctness

**Best practices:**
- Always read files before editing them
- Use `read_multiple_files` when you need context from several related files
- Prefer `edit_file` over `write_file` for modifications (preserves git history better)
- Check the actual file paths in `src/` - they're all there
- Use `directory_tree` to get a complete view of the codebase structure

---

## Important Constraints

### ✅ Always Follow These Rules

1. **Time units:** Milliseconds in storage/state, seconds for Web Audio API only
2. **Sample rate:** Always 44,100 Hz (resample if needed)
3. **State updates:** Always through Zustand actions, never direct mutation
4. **Immutability:** Blobs in IndexedDB are immutable; clips are metadata overlays
5. **Autosave:** Triggered automatically via `updateProject()`, debounced 2s
6. **Undo/redo:** Automatically handled by store, max 100 actions
7. **Volume mapping:** Use utilities from `src/utils/audio.js`, don't reimplement
8. **Equal-power panning:** Use `equalPowerPan()` function, don't use linear panning
9. **Export format:** WAV 16-bit PCM only, no MP3, no other formats
10. **No external dependencies:** Don't add new npm packages without strong justification
11. **Collision detection:** Use utilities from `src/utils/clipCollision.js` for clip positioning
12. **Brief summaries only:** Provide a concise summary of changes in chat (never create separate documents)

### ❌ Never Do These

1. **Don't use localStorage** for audio or large data (use IndexedDB)
2. **Don't mutate state directly** (always use store actions)
3. **Don't use different sample rates** (always 44.1 kHz)
4. **Don't add MP3 export** (WAV only per spec)
5. **Don't add cloud features** (local-only by design)
6. **Don't break undo/redo** (test after changes)
7. **Don't ignore autosave** (must persist across refresh)
8. **Don't change math formulas** without updating docs
9. **Don't create documents to explain changes** (chat summaries only)
10. **Don't skip collision detection** when moving/adding clips

---

## Project Overview

**ChoirMaster** is a browser-based DAW for creating choir practice files. It allows importing audio, recording vocals, editing clips non-destructively, and exporting specialized WAV files for choir rehearsal.

**Tech Stack:**
- React 18.3.1 + Vite 5.1.4
- Tailwind CSS 3.4.1
- Zustand 4.5.0 (state management)
- IndexedDB via Dexie.js 4.0.1 + dexie-react-hooks 1.1.7
- Web Audio API (44.1 kHz)
- wavesurfer.js 7.7.3 (waveforms)
- JSZip 3.10.1 (project archives)
- lucide-react 0.263.1 (icons)
- uuid 9.0.1 (ID generation)

**Status:** All 3 phases complete (MVP), production-ready, zero spec deviations

---

## Architecture at a Glance

```
User Interaction
    ↓
React Component
    ↓
Zustand Store Action (src/store/useStore.js)
    ↓
Update Project State + Undo Stack
    ↓
Trigger Autosave (2s debounce)
    ↓
IndexedDB Write (src/lib/db.js)
```

**Key Pattern:** All state changes go through Zustand store actions. Direct state mutation is never used.

---

## Critical File Map

### Core Libraries (src/lib/)
```
db.js                    - IndexedDB wrapper (Dexie), all persistence
audioManager.js          - Web Audio API playback engine
recordingManager.js      - MediaDevices API recording
exportEngine.js          - 7 export presets with OfflineAudioContext
projectPortability.js    - JSON/ZIP import/export
```

### Components (src/components/)
```
Dashboard.jsx            - Project list, create/import projects
Editor.jsx              - Main editor, integrates all features
FileImport.jsx          - Audio import dialog
TrackList.jsx           - Track mixer (volume/pan/mute/solo)
Timeline.jsx            - Timeline editor with clip editing
Waveform.jsx            - wavesurfer.js wrapper
ExportDialog.jsx        - Export preset selection UI
```

### State & Types (src/store/, src/types/)
```
useStore.js             - Zustand store, all actions
project.js              - Data model, factory functions
```

### Utilities (src/utils/)
```
audio.js                - Volume/pan/gain math, time conversion
clipCollision.js        - Clip collision detection and resolution
waveformUtils.js        - Waveform amplitude calculations
useKeyboardShortcuts.js - Global keyboard handler
```

---

## Key Data Model

**Time:** Always stored in **milliseconds** (ms). Convert to seconds only for Web Audio API.

**Project Structure:**
```javascript
{
  version: "1.0.0",
  projectId: "uuid",
  projectName: "string",
  sampleRate: 44100,  // constant
  masterVolume: 0-100,
  tracks: [
    {
      id: "uuid",
      name: "string",
      role: "instrument" | "lead" | "choir-part-1" ... "choir-part-5" | "other",
      locked: boolean,
      volume: 0-100,  // maps to -60dB to 0dB
      pan: -100 to +100,  // maps to -1 to +1
      muted: boolean,
      soloed: boolean,
      clips: [
        {
          id: "uuid",
          blobId: "uuid",  // references IndexedDB media table
          timelineStartMs: number,  // position on timeline
          sourceStartMs: 0,  // usually 0
          sourceDurationMs: number,  // full audio duration
          cropStartMs: number,  // crop from start
          cropEndMs: number,  // crop from end
          gainDb: number,  // gain adjustment in dB
          muted: boolean
        }
      ]
    }
  ],
  loop: { enabled: boolean, startMs: number, endMs: number },
  undoStackSize: 100
}
```

**Audio Storage:** Blobs in `media` table (IndexedDB) with `blobId` as key.

**Track Roles:** Defined in `src/types/project.js` as `TRACK_ROLES` constant.

---

## Critical Math Formulas

**Must be exact - these are in the spec:**

```javascript
// Volume slider (0-100) to dB
dB = -60 + (slider / 100) * 60

// dB to linear gain
gain = 10^(dB / 20)

// Equal-power panning (pan is -1 to +1)
angle = (pan + 1) * Math.PI / 4
leftGain = Math.cos(angle)
rightGain = Math.sin(angle)

// Vertical drag to gain (for clip gain adjustment)
deltaDb = -(deltaY / 100) * 6.0  // 100 pixels = ±6 dB

// Choir panning matrix (exact values, do not change)
1 part:  [0]
2 parts: [30, -30]
3 parts: [0, 40, -40]
4 parts: [25, -65, 65, -25]
5 parts: [0, 70, -70, 35, -35]
```

**All conversion functions are in `src/utils/audio.js` - use them, don't recreate!**

---

## Common Patterns

### 1. Updating Project State
```javascript
// Always use updateProject from store
const { updateProject } = useStore();

updateProject((proj) => ({
  ...proj,
  tracks: proj.tracks.map(track => 
    track.id === targetId 
      ? { ...track, volume: newVolume }
      : track
  ),
}), 'Update track volume');  // Description for undo
```

### 2. Updating Clips
```javascript
const { updateClip } = useStore();

// Update existing clip
updateClip(trackId, clipId, { cropEndMs: newValue });

// Add new clip (check collision first!)
const collisions = findCollidingClips(newClip, track.clips);
if (collisions.length === 0) {
  updateClip(trackId, null, newClip, 'add');
}

// Delete clip
updateClip(trackId, clipId, null, 'delete');
```

### 3. Collision Detection
```javascript
import { 
  findCollidingClips, 
  constrainClipMove,
  constrainCropStart,
  constrainCropEnd 
} from '../utils/clipCollision';

// Before moving a clip
const safePosition = constrainClipMove(clip, desiredPosition, track.clips);

// Before adjusting crop
const safeCropStart = constrainCropStart(clip, desiredCropStart, track.clips);
```

### 4. Audio Manager Usage
```javascript
import { audioManager } from '../lib/audioManager';

// Decode audio file
const audioBuffer = await audioManager.decodeAudioFile(arrayBuffer);

// Cache it
audioManager.mediaCache.set(blobId, audioBuffer);

// Convert to blob for storage
const blob = audioManager.audioBufferToBlob(audioBuffer);
```

### 5. Persisting to IndexedDB
```javascript
import { storeMediaBlob, getMediaBlob } from '../lib/db';

// Store audio
const blobId = await storeMediaBlob(fileName, audioBuffer, blob);

// Retrieve audio
const media = await getMediaBlob(blobId);
const audioBuffer = await audioManager.loadAudioBuffer(blobId, media.blob);
```

---

## Common Tasks & How To Do Them

### Add a New Track Property

1. Update data model in `src/types/project.js`
2. Update `createTrack()` factory function
3. Add UI control in `src/components/TrackList.jsx`
4. Update store action in `src/store/useStore.js` (if needed)
5. Test undo/redo and persistence

### Add a New Export Preset

1. Add preset constant to `src/lib/exportEngine.js`
2. Implement preset function (follow existing patterns)
3. Add to `exportProject()` switch statement
4. Add UI option in `src/components/ExportDialog.jsx`
5. Test output with audio player

### Add a New Keyboard Shortcut

1. Edit `src/utils/useKeyboardShortcuts.js`
2. Add handler function in `src/components/Editor.jsx`
3. Pass handler to `useKeyboardShortcuts()` hook
4. Update transport control hints

### Fix a Bug in Playback

1. Check `src/lib/audioManager.js` (playback engine)
2. Debug audio source scheduling in `playTrack()`
3. Verify gain/pan calculations
4. Test with multiple clips and tracks

### Modify Timeline Behavior

1. Edit `src/components/Timeline.jsx`
2. Check drag state management
3. Verify clip position calculations (ms to pixels)
4. Check collision detection when moving/resizing clips
5. Test zoom and scroll interactions

### Add Clip Collision Logic

1. Edit `src/utils/clipCollision.js`
2. Add new constraint function following existing patterns
3. Update Timeline.jsx to use new constraint
4. Test edge cases (clip at timeline start/end, adjacent clips)

---

## Testing Checklist

After making changes, verify:

- [ ] Undo/redo still works
- [ ] Changes persist after page refresh
- [ ] Autosave triggered (check IndexedDB in DevTools)
- [ ] No console errors
- [ ] Volume/pan math still correct (use unit tests)
- [ ] Clip collision detection working
- [ ] Playback works with new changes
- [ ] Export still produces valid WAV files
- [ ] Project import/export still functional

---

## Common Gotchas

1. **Time conversion:** Easy to mix up ms and seconds. Storage = ms, Web Audio = seconds.
2. **Clip positioning:** `timelineStartMs` is the clip's position. Crop is separate.
3. **Crop vs source:** `sourceDurationMs` is total audio. `cropStartMs/cropEndMs` define visible portion.
4. **Gain vs volume:** Volume is 0-100 slider. Gain is linear multiplier. Don't confuse.
5. **Audio caching:** Always check `audioManager.mediaCache` before loading from IndexedDB.
6. **Blob IDs:** Must be valid UUIDs. Don't use sequential integers.
7. **Track roles:** Must be exact strings (see `TRACK_ROLES` in `src/types/project.js`).
8. **Undo stack:** Updates automatically; don't manage manually.
9. **Collision detection:** Always use constraint functions before updating clip positions.
10. **Recording overwrites:** Use `processRecordingOverwrites()` to handle clip splitting.

---

## File Locations Quick Reference

```
Need to...                          Edit this file...
───────────────────────────────────────────────────────────────────
Add UI component                    src/components/[Name].jsx
Change state management             src/store/useStore.js
Modify data model                   src/types/project.js
Add audio processing                src/lib/audioManager.js
Change export logic                 src/lib/exportEngine.js
Update recording                    src/lib/recordingManager.js
Modify persistence                  src/lib/db.js
Add keyboard shortcut               src/utils/useKeyboardShortcuts.js
Change volume/pan math              src/utils/audio.js
Update clip collision logic         src/utils/clipCollision.js
Update waveform rendering           src/utils/waveformUtils.js
Update timeline rendering           src/components/Timeline.jsx
Modify track controls               src/components/TrackList.jsx
Change import flow                  src/components/FileImport.jsx
Update export UI                    src/components/ExportDialog.jsx
Modify main editor layout           src/components/Editor.jsx
Update main app                     src/App.jsx
```

---

## Debugging Tips

### Check State in DevTools

```javascript
// In browser console:
useStore.getState().project  // Current project
useStore.getState().undoStack  // Undo history
useStore.getState().currentTimeMs  // Playback position
useStore.getState().isPlaying  // Transport state
```

### Inspect IndexedDB

1. Open DevTools → Application → Storage → IndexedDB
2. Expand `ChoirMasterDB`
3. Check tables: `projects`, `media`, `undo`

### Verify Audio Processing

```javascript
// In audioManager.js, add logging:
console.log('Scheduling clip:', {
  clipId: clip.id,
  startTime,
  offset,
  duration,
  gain: gainNode.gain.value,
  pan: panNode.pan.value
});
```

### Test Collision Detection

```javascript
// In clipCollision.js, add logging:
console.log('Collision check:', {
  proposedPosition: clip.timelineStartMs,
  collidingClips: collisions.map(c => c.id)
});
```

### Test Export Format

1. Export a file
2. Open in hex editor
3. Check headers: "RIFF" at offset 0, "WAVE" at offset 8
4. Verify sample rate at offset 24 (should be 0xAC44 = 44100)

---

## Quick Command Reference

```bash
# Development
npm install          # Install dependencies
npm run dev          # Start dev server (localhost:5173)
npm run build        # Production build
npm run preview      # Preview production build
npm test             # Run unit tests (vitest)

# Debugging
npm run dev -- --host  # Expose to network
npm run dev -- --open  # Auto-open browser
```

---

## When You're Stuck

1. **Check `IMPLEMENTATION.md`** for detailed architecture
2. **Read phase summaries** (`PHASE_[0-3]_SUMMARY.md`) for feature details
3. **Review `SPEC_CHANGES.md`** to confirm no deviations exist (spoiler: there are none!)
4. **Grep for patterns:** `grep -r "updateProject" src/` to find usage examples
5. **Check console** for errors (especially IndexedDB/audio errors)
6. **Use filesystem tools:** Read actual code before making assumptions
7. **Check collision detection:** Many bugs are actually collision constraint issues

---

## File Reading Strategy for LLMs

When working on a feature, read files in this order:

**For state/data changes:**
1. `src/types/project.js` (data model)
2. `src/store/useStore.js` (state actions)
3. Relevant component file

**For UI changes:**
1. Relevant component file
2. `src/store/useStore.js` (state access)
3. Related utility files

**For audio processing:**
1. `src/lib/audioManager.js` (playback)
2. `src/utils/audio.js` (math utilities)
3. `src/lib/exportEngine.js` (export)

**For timeline/editing:**
1. `src/components/Timeline.jsx` (UI)
2. `src/utils/clipCollision.js` (constraints)
3. `src/store/useStore.js` (state updates)

**Use `read_multiple_files` for efficiency when you need context from several related files!**

---

## Version Information

- **Project Version:** 1.0.0
- **Spec Version:** MASTER SYSTEM PROMPT v1.0
- **Last Updated:** MVP delivery
- **Status:** Production-ready, zero technical debt, zero spec deviations

---

**Last Updated:** Post-MVP (all phases complete)  
**Maintained By:** Project developer  
**Purpose:** LLM onboarding for development tasks with Filesystem connector
