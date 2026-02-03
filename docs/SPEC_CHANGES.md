# ChoirMaster Specification Changes

This document tracks all deviations from the MASTER SYSTEM PROMPT v1.0 specification.

**Rule:** Any deviation from the spec must be logged here with justification and impact assessment.

---

## Phase 0 - Setup

### Change Log

**None.** Phase 0 implemented exactly per specification.

### Implementation Notes

- Vite scaffolding completed
- React 18.3 + Tailwind CSS configured
- Zustand store structure created
- Dexie.js IndexedDB wrapper implemented
- Basic dashboard and editor shell created
- All dependencies installed per tech stack requirements

### Verification Checklist

- ✅ Vite + React + Tailwind + Zustand + Lucide + wavesurfer.js
- ✅ IndexedDB schemas for `projects`, `media`, `undo`
- ✅ Time values stored in milliseconds
- ✅ Audio math utilities (volume/pan conversions) per spec
- ✅ Project data model matches spec exactly
- ✅ Autosave mechanism (debounced 2s)
- ✅ Undo/redo persistence (circular buffer, max 100)

---

## Phase 1 - Core Import & Playback

### Change Log

**None.** Phase 1 implemented exactly per specification.

### Implementation Notes

- File import UI with drag/drop completed
- Audio decoding with automatic 44.1kHz resampling
- AudioBuffer caching for performance
- Track list UI with all controls (volume, pan, lock, mute, solo)
- Basic playback engine with proper gain/pan application
- Keyboard shortcuts (Space, Ctrl+Z, Ctrl+Y)
- Auto-show import dialog for new projects

### Verification Checklist

- ✅ File import (WAV, MP3, FLAC)
- ✅ Audio decoding and resampling to 44.1kHz
- ✅ Blob storage in IndexedDB
- ✅ Track creation with role assignment
- ✅ Volume slider (0-100 → -60dB to 0dB)
- ✅ Pan slider (-100 to +100, equal-power)
- ✅ Lock/mute/solo controls
- ✅ Editable track names
- ✅ Basic playback engine
- ✅ Master volume control
- ✅ Keyboard shortcuts
- ✅ Real-time parameter updates during playback

### Known Limitations (Expected)

**The following are intentionally not implemented (Phase 2 features):**
- Timeline visualization (placeholder shown)
- Waveform rendering (wavesurfer.js integration pending)
- Clip editing (move, crop, gain drag)
- Multi-clip playback scheduling
- Timeline scrubbing
- Loop region support

These limitations are per spec implementation order and will be addressed in Phase 2.

---

## Phase 2 - Timeline & Editing

### Change Log

**None.** Phase 2 implemented exactly per specification.

### Implementation Notes

- Timeline component with wavesurfer.js integration
- Waveform visualization for each clip
- Clip editing: move, crop (both edges), gain drag
- Copy/paste/duplicate/delete operations
- Timeline scrubbing (click-to-seek)
- Zoom controls (25% to 400%)
- Multi-clip playback scheduling
- Keyboard shortcuts (Ctrl+C/V/D, Delete)

### Verification Checklist

- ✅ Timeline rendering with time ruler
- ✅ Waveform display per clip (wavesurfer.js)
- ✅ Silence visually distinguishable
- ✅ Clip move (left-drag)
- ✅ Clip crop (edge-drag, non-destructive)
- ✅ Gain adjustment (right-drag vertical, 100px = ±6dB)
- ✅ Copy/paste/duplicate clips
- ✅ Delete clips (metadata only)
- ✅ Timeline scrubbing (click-to-seek)
- ✅ Zoom controls
- ✅ Multi-clip playback
- ✅ Undo/redo for all edit operations
- ✅ Locked tracks cannot be edited

### Known Limitations (Expected)

**The following are intentionally not implemented (Phase 3 features):**
- Recording functionality
- Loop region playback UI (data model exists)
- Export engine
- Project import/export

These limitations are per spec implementation order and will be addressed in Phase 3.

---

## Phase 3 - Recording & Export

### Change Log

**None.** Phase 3 implemented exactly per specification.

### Implementation Notes

- Recording via MediaDevices API
- Microphone permission handling
- Record to selected track
- Keyboard shortcut (R) for recording
- Export engine with OfflineAudioContext
- All 7 export presets with exact gain/pan specs
- WAV 16-bit PCM output (no limiter/normalize/dither)
- Project export (JSON and ZIP formats)
- Project import with validation
- Cross-machine portability verified

### Verification Checklist

- ✅ MediaDevices API integration
- ✅ Microphone recording
- ✅ Record to selected track
- ✅ Keyboard shortcut (R)
- ✅ Non-destructive recording (punch & split model)
- ✅ All 7 export presets implemented
- ✅ Exact gain adjustments per spec
- ✅ Choir panning matrix (exact values)
- ✅ WAV 16-bit PCM export
- ✅ 44.1 kHz sample rate
- ✅ No limiter/normalization/dithering
- ✅ OfflineAudioContext (deterministic)
- ✅ Project export (JSON)
- ✅ Project export (ZIP with audio)
- ✅ Project import (JSON with validation)
- ✅ Project import (ZIP with full restore)
- ✅ Cross-machine compatibility
- ✅ Filename sanitization

### Export Presets Verified

1. ✅ Instrumental (instrument only)
2. ✅ All (leads +3dB)
3. ✅ Lead (lead + instrumental)
4. ✅ Leads Separate (target +6dB, others -3dB)
5. ✅ Only Whole Choir (choir only)
6. ✅ Separate Choir Parts Practice (target +6dB/+30pan, others -6dB/-30pan, instrumental -3dB)
7. ✅ Separate Choir Parts Omitted (target muted)

### Choir Panning Matrix Verified

- ✅ 1 part: [0]
- ✅ 2 parts: [30, -30]
- ✅ 3 parts: [0, 40, -40]
- ✅ 4 parts: [25, -65, 65, -25]
- ✅ 5 parts: [0, 70, -70, 35, -35]

### Known Limitations (Expected)

**The following are intentionally not implemented (per MVP scope):**
- Tempo/BPM/snapping
- MIDI support
- Cloud sync
- MP3 export (WAV only per spec)
- DSP effects (reverb, EQ, compression)
- Native/Electron builds
- Metronome
- Time signature

These exclusions are intentional and documented in the specification.

---

## Spec Compliance Summary

| Phase | Status | Deviations | Critical Issues |
|-------|--------|-----------|-----------------|  
| 0 - Setup | ✅ Complete | 0 | None |
| 1 - Import & Playback | ✅ Complete | 0 | None |
| 2 - Timeline & Editing | ✅ Complete | 0 | None |
| 3 - Recording & Export | ✅ Complete | 0 | None |

**MVP Status: ✅ COMPLETE**

All phases implemented with zero deviations from specification.

---

## Future Deviation Template

When logging a deviation, use this format:

```markdown
### [Date] - [Component/Feature Name]

**Deviation:**
[Describe what differs from spec]

**Justification:**
[Explain why the change was necessary]

**Impact:**
[Assess impact on spec compliance, exports, or user experience]

**Alternatives Considered:**
[List other approaches and why they were rejected]

**Mitigation:**
[If compliance is broken, how will it be addressed?]
```

---

**Document Version:** 1.0.0  
**Last Updated:** Phase 0 completion  
**Next Review:** After Phase 1 implementation
