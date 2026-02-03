# Timeline Ruler Loop Feature Implementation

## Overview
Implemented interactive timeline ruler functionality for setting loop regions and toggling loop mode.

## Features Added

### 1. Click to Seek
- **Action**: Left-click on timeline ruler
- **Result**: Playhead immediately jumps to clicked position
- **Implementation**: `handleRulerMouseDown` captures click position and calls `onSeek()`

### 2. Drag to Create Loop
- **Action**: Left-click and drag on timeline ruler
- **Result**: Creates a loop region between start and end drag positions
- **Minimum Duration**: 100ms (prevents accidental tiny loops)
- **Visual Feedback**: Loop markers appear after drag completes
- **Implementation**: 
  - Drag detection threshold: 5 pixels of movement
  - Updates project loop settings via `updateProject()` with undo support
  - Automatically enables loop when created via drag

### 3. Loop Mode Toggle (L key)
- **Action**: Press 'L' key
- **Result**: Toggles loop.enabled on/off
- **Visual Feedback**: Loop markers change appearance when disabled
- **Already Implemented**: Keyboard shortcut was pre-existing in `useKeyboardShortcuts.js`
- **Implementation**: Added `handleToggleLoop()` in Editor component

### 4. Loop Marker Visual States

#### Enabled (Yellow)
- Loop markers: Bright yellow bars (`bg-yellow-500`, 4px width)
- Loop region: Yellow tint (`bg-yellow-500 bg-opacity-20`)
- Cursor: East-west resize cursor on markers
- **No labels**: Clean, minimal appearance

#### Disabled (Grey)
- Loop markers: Grey with 40% opacity (`bg-gray-500 opacity-40`)
- Loop region: Very faint grey (`bg-gray-500 bg-opacity-5`)
- Barely noticeable, indicates where loop would be if enabled

### 5. Draggable Loop Markers
- **Action**: Click and drag loop start or end markers
- **Result**: Adjusts loop region boundaries
- **Visual Feedback**: Real-time marker movement during drag
- **Constraints**: 
  - Minimum 100ms loop duration maintained
  - Start marker can't pass end marker
  - End marker can't pass start marker
- **Undo**: Single undo entry created at end of drag (not per mouse move)
- **Performance**: Optimized to prevent undo stack flooding

## Files Modified

### 1. `src/components/Timeline.jsx`
**Added:**
- `rulerDragState` state for tracking ruler drag operations
- `loopMarkerDragState` state for tracking loop marker dragging
- `handleRulerMouseDown()` - Initiates click/drag interaction on ruler
- `handleLoopMarkerMouseDown()` - Initiates loop marker dragging
- `useEffect()` for ruler drag handling (mouse move/up)
- `useEffect()` for loop marker drag handling (mouse move/up)
- `updateProject` prop to Timeline component
- Conditional styling for loop markers based on `project.loop.enabled`

**Changed:**
- Loop markers: Moved from track area to ruler area
- Loop markers: Changed from green to yellow (matches solo color)
- Loop markers: Removed text labels for cleaner look
- Loop markers: Made 4px wide (`w-1`) for better visibility
- Loop markers: Added draggable functionality with resize cursor
- Loop rendering: Uses drag state values during drag for smooth feedback
- Ruler div: Added `cursor-pointer` class and `onMouseDown` handler

### 2. `src/components/Editor.jsx`
**Added:**
- `handleToggleLoop()` function to toggle loop enabled state
- `updateProject` prop passed to Timeline component
- `onToggleLoop` handler in `useKeyboardShortcuts()` call

## Technical Details

### State Management
All changes follow the Zustand pattern:
- Loop state stored in `project.loop` object
- Updates via `updateProject()` action
- Automatic undo/redo support
- Automatic autosave (2s debounce)

### Time Units
- All calculations in milliseconds (ms)
- Consistent with existing codebase architecture

### Drag Detection (Ruler)
- Threshold: 5 pixels of movement before considered a drag
- Prevents accidental loop creation from simple clicks
- If drag distance < 5px, only seek occurs (no loop created)

### Loop Marker Dragging
- Uses local variables during drag to avoid undo stack flooding
- Only creates one undo entry at end of drag operation
- Visual feedback via `loopMarkerDragState` state
- Renders using drag state values or project values (fallback)
```javascript
const displayStartMs = loopMarkerDragState?.currentStartMs ?? project.loop.startMs;
```

### Loop Range Calculation
```javascript
const startMs = Math.min(rulerDragState.startTimeMs, endTimeMs);
const endMs = Math.max(rulerDragState.startTimeMs, endTimeMs);
```
- Always creates a valid range regardless of drag direction
- Clamped to timeline bounds (0 to projectDurationMs)
- Minimum 100ms enforced during marker dragging

## User Experience

### Workflow
1. **Set Loop Region**: Click and drag on ruler to define loop range
2. **Adjust Loop Boundaries**: Drag the yellow markers to fine-tune loop region
3. **Toggle Loop On/Off**: Press 'L' to enable/disable looping
4. **Quick Seek**: Click ruler to jump playhead without creating loop
5. **Visual Feedback**: 
   - Yellow markers/region when enabled
   - Faint grey markers/region when disabled
   - No text labels, clean minimal design

### Keyboard Shortcuts
- **L**: Toggle loop mode on/off
- (No change to existing shortcuts)

## Testing Checklist

- [x] Click ruler to seek playhead
- [x] Drag ruler to create loop region (left to right)
- [x] Drag ruler to create loop region (right to left)
- [x] Press 'L' to toggle loop enabled/disabled
- [x] Loop markers show yellow when enabled
- [x] Loop markers show grey when disabled
- [x] Loop markers in ruler area (not track area)
- [x] No text labels on loop markers
- [x] Loop markers are 4px wide vertical bars
- [x] Drag loop start marker to adjust
- [x] Drag loop end marker to adjust
- [x] Markers show resize cursor on hover
- [x] Real-time visual feedback during marker drag
- [x] Minimum loop duration enforced (100ms)
- [x] Start marker can't pass end marker
- [x] End marker can't pass start marker
- [x] Undo/redo works for loop creation
- [x] Undo/redo works for loop toggle
- [x] Undo/redo works for loop marker dragging (single entry per drag)
- [x] Autosave triggers after loop changes

## Edge Cases Handled

1. **Zero-width loops**: Minimum 100ms duration enforced
2. **Out-of-bounds clicks**: Clamped to valid timeline range
3. **Drag during playback**: Playhead updates during drag
4. **Small mouse movements**: 5px threshold prevents accidental loops
5. **Bidirectional drags**: Works in both directions (left→right, right→left)
6. **Marker collision**: Start/end markers maintain minimum separation
7. **Undo stack flooding**: Only one undo entry per drag operation
8. **Visual state sync**: Drag state properly merged with project state for rendering

## Future Enhancements (Not Implemented)

- Right-click ruler to clear loop region
- Shift+click to snap to clip boundaries
- Alt+drag to move entire loop region (both markers together)
- Loop count control (loop N times vs infinite)
- Tooltip showing exact time on marker hover

## Compatibility

- **Undo/Redo**: ✅ Fully supported
- **Persistence**: ✅ Saves to IndexedDB
- **Autosave**: ✅ Triggers on changes
- **Project Import/Export**: ✅ Loop settings included
- **Existing Features**: ✅ No breaking changes

## Notes

- Loop functionality already existed in playback engine
- This implementation adds UI controls for existing backend feature
- Maintains consistency with existing keyboard shortcuts
- Follows established code patterns (Zustand actions, prop drilling, etc.)
