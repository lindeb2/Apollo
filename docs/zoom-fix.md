# Zoom/Waveform Performance Fix Plan

## Goal
Make timeline interactions (zoom, crop, cut, load) feel immediate and stable, even on larger projects.

## Current Bottlenecks (Observed)
- Waveform rendering rebuilds cropped buffers and re-encodes WAV blobs during edits.
- Group tracks render additional waveform instances for child clips.
- Global peak scanning can re-run across many clips/samples.
- `updateProject` stores full deep-cloned snapshots for every drag/crop step.

## Plan

### Phase 1: Interaction + State Cost Reduction
- Keep drag/crop preview state local in `Timeline` during pointer move.
- Commit project state only on pointer-up (single undo entry per gesture).
- Add throttling (`requestAnimationFrame`) for pointer-move visual updates.
- Ensure zoom and crop handlers avoid expensive project writes per frame.

### Phase 2: Viewport and Zoom Efficiency
- Add viewport culling for offscreen clips/rows.
- Add multi-resolution peaks (LOD) so zoomed-out views draw fewer points.
- Use the closest peak resolution based on current `pixelsPerMs`.

### Phase 3: Waveform Pipeline Refactor
- Replace Blob/WAV reload-based clip waveform updates with peak-data rendering.
- Precompute and cache waveform peaks per source media (`blobId`).
- Derive cropped display segments by slicing/scaling cached peaks (not raw PCM copy).
- Remove per-crop `AudioContext` creation in waveform UI path.

### Phase 4: Group Preview Optimization
- Stop rendering nested clip waveform components for group rows.
- Build group preview from merged/stacked peak envelopes.
- Respect existing muted-clip/track rules while avoiding duplicate draw cost.

### Phase 5: Async Preprocessing
- Move heavy peak extraction to a Web Worker.
- Keep main thread free for drag/scroll/zoom responsiveness.
- Persist extracted peaks in IndexedDB for fast project reload.

## Validation Targets
- Zoom drag remains smooth at 60fps target on medium projects.
- Crop/drag interaction has no visible frame hitching.
- Project load time improves after peak cache warmup.
- Undo stack entries are gesture-level, not frame-level.

## Suggested Implementation Order
1. Phase 1 (highest impact / lowest risk)
2. Phase 2 (culling + LOD)
3. Phase 3 (waveform renderer refactor)
4. Phase 4 (group envelope refactor)
5. Phase 5 (worker + persistence)

## Rollout Notes
- Ship behind a feature flag for waveform renderer refactor.
- Compare old/new rendering path in one release before removing legacy code.
- Add instrumentation for render time and pointer-move frame cost.
