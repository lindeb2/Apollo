import { useRef, useState, useEffect } from 'react';
import { formatTime, msToSeconds, secondsToMs, pixelsToDbChange } from '../utils/audio';
import { audioManager } from '../lib/audioManager';
import Waveform from './Waveform';
import { calculateGlobalPeakAmplitude } from '../utils/waveformUtils';
import { 
  constrainClipMove, 
  constrainCropStart, 
  constrainCropEnd, 
  canAddClip,
  findSafePosition 
} from '../utils/clipCollision';

const TRACK_HEIGHT = 120;
const LOCKED_TRACK_HEIGHT = 120;
const TIMELINE_VIEWPORT_WIDTH = 1920; // Default viewport width (updated dynamically)
const MIN_VISIBLE_DURATION_MS = 8000; // Minimum duration to show when zoomed out
const MAX_ZOOM_VISIBLE_MS = 100; // At max zoom, show 100ms across viewport

// Helper to get track height based on locked state
const getTrackHeight = (track) => track.locked ? LOCKED_TRACK_HEIGHT : TRACK_HEIGHT;

// Helper to calculate cumulative Y position for a track
const getTrackYPosition = (tracks, trackIndex) => {
  let yPosition = 0;
  for (let i = 0; i < trackIndex; i++) {
    yPosition += getTrackHeight(tracks[i]);
  }
  return yPosition;
};

/**
 * Timeline component
 * Displays tracks, clips, and waveforms with editing capabilities
 */
  function Timeline({ 
    project, 
    currentTimeMs, 
    isPlaying,
    isRecording,
    recordingSegments,
    selectedTrackId,
    onUpdateClip,
    onSelectTrack,
    onSeek,
    onVerticalScroll,
    scrollContainerRef,
    updateProject,
}) {
  const timelineRef = useRef(null);
  const rulerScrollRef = useRef(null);
  const tracksScrollRef = useRef(null);
  const internalScrollRef = scrollContainerRef || useRef(null);
  const [visibleDurationMs, setVisibleDurationMs] = useState(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [dragState, setDragState] = useState(null);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [clipboardClip, setClipboardClip] = useState(null);
  const [rulerDragState, setRulerDragState] = useState(null);
  const [loopMarkerDragState, setLoopMarkerDragState] = useState(null);
  const prevProjectDurationRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(TIMELINE_VIEWPORT_WIDTH);
  const [globalPeakAmplitude, setGlobalPeakAmplitude] = useState(1.0);
  const [loadedClipIds, setLoadedClipIds] = useState(new Set());

  // Track actual container width
  useEffect(() => {
    const updateWidth = () => {
      if (timelineRef.current) {
        setContainerWidth(timelineRef.current.clientWidth || TIMELINE_VIEWPORT_WIDTH);
      }
    };
    
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Calculate global peak amplitude for waveform normalization
  useEffect(() => {
    if (!project) return;
    const currentlyLoaded = new Set();
    let hasChanges = false;
    project.tracks.forEach(track => {
      track.clips.forEach(clip => {
        if (audioManager.mediaCache.has(clip.blobId)) {
          currentlyLoaded.add(clip.id);
          if (!loadedClipIds.has(clip.id)) {
            hasChanges = true;
          }
        }
      });
    });
    if (currentlyLoaded.size !== loadedClipIds.size) {
      hasChanges = true;
    }
    if (hasChanges) {
      setLoadedClipIds(currentlyLoaded);
      const peak = calculateGlobalPeakAmplitude(audioManager.mediaCache, project.tracks);
      setGlobalPeakAmplitude(peak);
    }
  }, [project.tracks, loadedClipIds]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      if (!project) return;
      let hasNewLoads = false;
      project.tracks.forEach(track => {
        track.clips.forEach(clip => {
          if (audioManager.mediaCache.has(clip.blobId) && !loadedClipIds.has(clip.id)) {
            hasNewLoads = true;
          }
        });
      });
      if (hasNewLoads) {
        const currentlyLoaded = new Set();
        project.tracks.forEach(track => {
          track.clips.forEach(clip => {
            if (audioManager.mediaCache.has(clip.blobId)) {
              currentlyLoaded.add(clip.id);
            }
          });
        });
        setLoadedClipIds(currentlyLoaded);
        const peak = calculateGlobalPeakAmplitude(audioManager.mediaCache, project.tracks);
        setGlobalPeakAmplitude(peak);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [project, loadedClipIds]);

  // Calculate total timeline height based on all track heights
  const totalTimelineHeight = project.tracks.reduce((sum, track) => sum + getTrackHeight(track), 0);

  // Calculate total timeline duration (in ms) based on furthest clip endpoint
  const rawProjectDurationMs = project.tracks.reduce((max, track) => {
    const trackEnd = track.clips.reduce((tMax, clip) => {
      const clipEnd = clip.timelineStartMs + (clip.cropEndMs - clip.cropStartMs);
      return Math.max(tMax, clipEnd);
    }, 0);
    return Math.max(max, trackEnd);
  }, 0);
  
  const calculatePaddedDuration = (durationMs, intervalMs) => {
    if (durationMs === 0) return 0;
    const paddingMs = Math.max(intervalMs, durationMs * 0.1);
    const paddedDuration = durationMs + paddingMs;
    return Math.ceil(paddedDuration / intervalMs) * intervalMs;
  };
  
  const tempMinZoomDurationMs = Math.max(rawProjectDurationMs, MIN_VISIBLE_DURATION_MS);
  const tempPixelsPerMs = containerWidth / (visibleDurationMs || tempMinZoomDurationMs);
  const tempRulerIntervalMs = (() => {
    const targetPixelsPerInterval = 80;
    const msPerInterval = targetPixelsPerInterval / tempPixelsPerMs;
    const niceIntervals = [
      100, 500, 1000, 5000, 10000, 30000, 60000, 300000, 600000, 1800000, 3600000
    ];
    let bestInterval = niceIntervals[0];
    for (const interval of niceIntervals) {
      if (Math.abs(interval - msPerInterval) < Math.abs(bestInterval - msPerInterval)) {
        bestInterval = interval;
      }
    }
    return bestInterval;
  })();
  
  const projectDurationMs = calculatePaddedDuration(rawProjectDurationMs, tempRulerIntervalMs);
  const minZoomDurationMs = Math.max(projectDurationMs, MIN_VISIBLE_DURATION_MS);
  const maxZoomDurationMs = MAX_ZOOM_VISIBLE_MS;
  const currentVisibleMs = visibleDurationMs === null ? minZoomDurationMs : visibleDurationMs;
  const clampedVisibleMs = Math.max(maxZoomDurationMs, currentVisibleMs);
  const pixelsPerMs = containerWidth / clampedVisibleMs;
  const timelineWidthPx = Math.max(projectDurationMs, minZoomDurationMs) * pixelsPerMs;
  
  const zoomSliderValue = minZoomDurationMs > maxZoomDurationMs
    ? Math.log(clampedVisibleMs / maxZoomDurationMs) / Math.log(minZoomDurationMs / maxZoomDurationMs)
    : 0;
  
  const sliderValueToDuration = (value) => {
    if (minZoomDurationMs <= maxZoomDurationMs) return maxZoomDurationMs;
    return maxZoomDurationMs * Math.pow(minZoomDurationMs / maxZoomDurationMs, value);
  };
  
  const formatVisibleDuration = (durationMs) => {
    const seconds = durationMs / 1000;
    if (seconds < 1) return `${Math.round(durationMs)}ms`;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  };
  
  const calculateRulerInterval = () => {
    const targetPixelsPerInterval = 80;
    const msPerInterval = targetPixelsPerInterval / pixelsPerMs;
    const niceIntervals = [
      100, 500, 1000, 5000, 10000, 30000, 60000, 300000, 600000, 1800000, 3600000
    ];
    let bestInterval = niceIntervals[0];
    for (const interval of niceIntervals) {
      if (Math.abs(interval - msPerInterval) < Math.abs(bestInterval - msPerInterval)) {
        bestInterval = interval;
      }
    }
    return bestInterval;
  };
  
  const rulerIntervalMs = calculateRulerInterval();
  
  const formatRulerTime = (ms, intervalMs) => {
    if (intervalMs < 1000) {
      return `${ms}ms`;
    }
    
    const totalSeconds = ms / 1000;
    
    if (intervalMs < 60000) {
      if (intervalMs < 1000) {
        return `${totalSeconds.toFixed(1)}s`;
      }
      return `${Math.round(totalSeconds)}s`;
    }
    
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    
    if (intervalMs >= 1800000 && seconds === 0) {
      return `${minutes}m`;
    }
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };
  
  useEffect(() => {
    if (visibleDurationMs === null && prevProjectDurationRef.current !== null) {
      const prevDuration = prevProjectDurationRef.current;
      const currentDuration = projectDurationMs;
      
      if (prevDuration !== currentDuration) {
        const lockedDuration = Math.max(prevDuration, MIN_VISIBLE_DURATION_MS);
        setVisibleDurationMs(lockedDuration);
      }
    }
    
    prevProjectDurationRef.current = projectDurationMs;
  }, [projectDurationMs, visibleDurationMs]);

  const handleTimelineClick = (e) => {
    if (dragState) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft;
    const timeMs = x / pixelsPerMs;

    // Unselect track and clip when clicking empty timeline space
    setSelectedClipId(null);

    // Seek to clicked time
    if (timeMs >= 0 && timeMs <= (projectDurationMs || minZoomDurationMs)) {
      onSeek(timeMs);
    }
  };

  const handleClipClick = (e, clipId, trackId) => {
    e.stopPropagation();
    setSelectedClipId(clipId);
    onSelectTrack(trackId);
  };

  const handleClipMouseDown = (e, clip, track) => {
    if (track.locked) return;

    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const clipWidthPx = (clip.cropEndMs - clip.cropStartMs) * pixelsPerMs;

    const edgeThreshold = 12; // Match the w-3 (12px) hover zone width
    let dragType = 'move';

    if (offsetX < edgeThreshold) {
      dragType = 'crop-start';
    } else if (offsetX > clipWidthPx - edgeThreshold) {
      dragType = 'crop-end';
    } else if (e.button === 2) {
      dragType = 'gain';
    }

    setDragState({
      type: dragType,
      clipId: clip.id,
      trackId: track.id,
      startX: e.clientX,
      startY: e.clientY,
      initialTimelineStartMs: clip.timelineStartMs,
      initialCropStartMs: clip.cropStartMs,
      initialCropEndMs: clip.cropEndMs,
      initialGainDb: clip.gainDb,
      sourceDurationMs: clip.sourceDurationMs,  // Store for validation during drag
    });

    setSelectedClipId(clip.id);
    onSelectTrack(track.id);
  };

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e) => {
      const deltaX = e.clientX - dragState.startX;
      const deltaY = e.clientY - dragState.startY;
      const deltaMs = deltaX / pixelsPerMs;

      let updates = {};

      // Find the current track's clips for collision detection
      const track = project.tracks.find(t => t.id === dragState.trackId);
      if (!track) return;
      
      const currentClip = track.clips.find(c => c.id === dragState.clipId);
      if (!currentClip) return;

      if (dragState.type === 'move') {
        const proposedTimelineStartMs = Math.max(0, dragState.initialTimelineStartMs + deltaMs);
        // Constrain move to avoid collisions
        const constrainedTimelineStartMs = constrainClipMove(
          { ...currentClip, timelineStartMs: dragState.initialTimelineStartMs },
          proposedTimelineStartMs,
          track.clips
        );
        updates.timelineStartMs = constrainedTimelineStartMs;

      } else if (dragState.type === 'crop-start') {
        const proposedCropStartMs = dragState.initialCropStartMs + deltaMs;
        // Constrain crop start to avoid collisions
        const constrainedCropStartMs = constrainCropStart(
          { ...currentClip, cropStartMs: dragState.initialCropStartMs },
          proposedCropStartMs,
          track.clips
        );
        const cropDelta = constrainedCropStartMs - dragState.initialCropStartMs;
        
        updates.cropStartMs = constrainedCropStartMs;
        updates.timelineStartMs = dragState.initialTimelineStartMs + cropDelta;

      } else if (dragState.type === 'crop-end') {
        const proposedCropEndMs = dragState.initialCropEndMs + deltaMs;
        // Constrain crop end to avoid collisions
        const constrainedCropEndMs = constrainCropEnd(
          { ...currentClip, cropEndMs: dragState.initialCropEndMs, sourceDurationMs: dragState.sourceDurationMs },
          proposedCropEndMs,
          track.clips
        );
        updates.cropEndMs = constrainedCropEndMs;

      } else if (dragState.type === 'gain') {
        const deltaDb = pixelsToDbChange(deltaY);
        const newGainDb = Math.max(-24, Math.min(24, dragState.initialGainDb + deltaDb));
        updates.gainDb = newGainDb;
      }

      if (Object.keys(updates).length > 0) {
        onUpdateClip(dragState.trackId, dragState.clipId, updates);
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, pixelsPerMs, onUpdateClip]);

  useEffect(() => {
    if (!selectedClipId) return;
    if (!selectedTrackId) {
      setSelectedClipId(null);
      return;
    }

    const clipTrack = project.tracks.find(track =>
      track.clips.some(clip => clip.id === selectedClipId)
    );

    if (!clipTrack || clipTrack.id !== selectedTrackId) {
      setSelectedClipId(null);
    }
  }, [selectedClipId, selectedTrackId, project.tracks]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const selectedTrack = project.tracks.find(t => t.id === selectedTrackId);
      const selectedClip = selectedTrack?.clips.find(c => c.id === selectedClipId);

      if (e.code === 'KeyC' && (e.ctrlKey || e.metaKey) && selectedClip) {
        e.preventDefault();
        setClipboardClip({ ...selectedClip });
      }

      if (e.code === 'KeyV' && (e.ctrlKey || e.metaKey) && clipboardClip && selectedTrackId) {
        e.preventDefault();
        const track = project.tracks.find(t => t.id === selectedTrackId);
        if (!track) return;
        
        const newClip = {
          ...clipboardClip,
          id: crypto.randomUUID(),
          timelineStartMs: currentTimeMs,
        };
        
        // Check if paste position is clear, otherwise find safe position
        const safePosition = findSafePosition(newClip, track.clips, currentTimeMs);
        if (safePosition !== null) {
          newClip.timelineStartMs = safePosition;
          onUpdateClip(selectedTrackId, null, newClip, 'add');
        } else {
          // Could not find safe position - show error
          console.warn('Cannot paste: no space available on track');
        }
      }

      if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey) && selectedClip && selectedTrackId) {
        e.preventDefault();
        const track = project.tracks.find(t => t.id === selectedTrackId);
        if (!track) return;
        
        const preferredPosition = selectedClip.timelineStartMs + (selectedClip.cropEndMs - selectedClip.cropStartMs);
        const newClip = {
          ...selectedClip,
          id: crypto.randomUUID(),
          timelineStartMs: preferredPosition,
        };
        
        // Check if duplicate position is clear, otherwise find safe position
        const safePosition = findSafePosition(newClip, track.clips, preferredPosition);
        if (safePosition !== null) {
          newClip.timelineStartMs = safePosition;
          onUpdateClip(selectedTrackId, null, newClip, 'add');
        } else {
          // Could not find safe position - show error
          console.warn('Cannot duplicate: no space available on track');
        }
      }

      if ((e.code === 'Delete' || e.code === 'Backspace') && selectedClip && selectedTrackId) {
        e.preventDefault();
        onUpdateClip(selectedTrackId, selectedClipId, null, 'delete');
        setSelectedClipId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipId, selectedTrackId, clipboardClip, currentTimeMs, project.tracks, onUpdateClip]);

  const handleContextMenu = (e) => {
    e.preventDefault();
  };

  const handleRulerMouseDown = (e) => {
    if (e.button !== 0) return; // Only left click
    
    const rect = rulerScrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft;
    const timeMs = Math.max(0, Math.min(x / pixelsPerMs, projectDurationMs || minZoomDurationMs));
    const hasLoop = project.loop.startMs !== undefined && project.loop.endMs !== undefined;
    const clickedLoop = hasLoop && timeMs >= project.loop.startMs && timeMs <= project.loop.endMs;
    const mode = clickedLoop ? 'move' : 'create';
    
    setRulerDragState({
      startTimeMs: timeMs,
      startX: e.clientX,
      isDragging: false,
      clickedLoop,
      mode,
      initialLoopStartMs: project.loop.startMs,
      initialLoopEndMs: project.loop.endMs,
    });
  };

  const handleLoopMarkerMouseDown = (e, markerType) => {
    e.stopPropagation();
    if (e.button !== 0) return; // Only left click
    
    setLoopMarkerDragState({
      markerType, // 'start' or 'end'
      initialStartMs: project.loop.startMs,
      initialEndMs: project.loop.endMs,
    });
  };

  useEffect(() => {
    if (!rulerDragState) return;

    const handleMouseMove = (e) => {
      const deltaX = Math.abs(e.clientX - rulerDragState.startX);
      
      // Consider it a drag if mouse moved more than 5 pixels
      if (deltaX > 5 && !rulerDragState.isDragging) {
        setRulerDragState(prev => ({ ...prev, isDragging: true }));
      }
      
      if (rulerDragState.isDragging) {
        const rect = rulerScrollRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left + scrollLeft;
        const currentTimeMs = Math.max(0, Math.min(x / pixelsPerMs, projectDurationMs || minZoomDurationMs));

        if (rulerDragState.mode === 'move' && rulerDragState.initialLoopStartMs !== undefined) {
          const loopLengthMs = rulerDragState.initialLoopEndMs - rulerDragState.initialLoopStartMs;
          const timelineDurationMs = projectDurationMs || minZoomDurationMs;
          let newStartMs = rulerDragState.initialLoopStartMs + (currentTimeMs - rulerDragState.startTimeMs);
          let newEndMs = newStartMs + loopLengthMs;

          if (newStartMs < 0) {
            newStartMs = 0;
            newEndMs = loopLengthMs;
          } else if (newEndMs > timelineDurationMs) {
            newEndMs = timelineDurationMs;
            newStartMs = timelineDurationMs - loopLengthMs;
          }

          setRulerDragState(prev => ({
            ...prev,
            currentStartMs: newStartMs,
            currentEndMs: newEndMs,
          }));
        } else {
          // Update drag state with current position for visual feedback (loop creation)
          const startMs = Math.min(rulerDragState.startTimeMs, currentTimeMs);
          const endMs = Math.max(rulerDragState.startTimeMs, currentTimeMs);

          setRulerDragState(prev => ({
            ...prev,
            currentStartMs: startMs,
            currentEndMs: endMs,
          }));
        }
      }
    };

    const handleMouseUp = (e) => {
      if (rulerDragState.isDragging) {
        if (rulerDragState.mode === 'move') {
          const finalStartMs = rulerDragState.currentStartMs ?? rulerDragState.initialLoopStartMs;
          const finalEndMs = rulerDragState.currentEndMs ?? rulerDragState.initialLoopEndMs;
          if (finalStartMs !== rulerDragState.initialLoopStartMs || 
              finalEndMs !== rulerDragState.initialLoopEndMs) {
            updateProject((proj) => ({
              ...proj,
              loop: {
                ...proj.loop,
                startMs: finalStartMs,
                endMs: finalEndMs,
              },
            }), 'Move loop region');
          }
        } else {
          // Create loop
          const rect = rulerScrollRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left + scrollLeft;
          const endTimeMs = Math.max(0, Math.min(x / pixelsPerMs, projectDurationMs || minZoomDurationMs));
          
          const startMs = Math.min(rulerDragState.startTimeMs, endTimeMs);
          const endMs = Math.max(rulerDragState.startTimeMs, endTimeMs);
          
          // Only create loop if there's a meaningful range (at least 100ms)
          if (endMs - startMs >= 100) {
            updateProject((proj) => ({
              ...proj,
              loop: {
                enabled: true,
                startMs,
                endMs,
              },
            }), 'Set loop region');
          }
        }
      } else if (rulerDragState.clickedLoop) {
        updateProject((proj) => ({
          ...proj,
          loop: {
            ...proj.loop,
            enabled: !proj.loop.enabled,
          },
        }), 'Toggle loop');
      } else {
        onSeek(rulerDragState.startTimeMs);
      }
      
      setRulerDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [rulerDragState, pixelsPerMs, scrollLeft, projectDurationMs, minZoomDurationMs, updateProject]);

  // Handle loop marker dragging
  useEffect(() => {
    if (!loopMarkerDragState) return;

    const handleMouseMove = (e) => {
      const rect = rulerScrollRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollLeft;
      const timeMs = Math.max(0, Math.min(x / pixelsPerMs, projectDurationMs || minZoomDurationMs));
      
      let newStartMs = loopMarkerDragState.initialStartMs;
      let newEndMs = loopMarkerDragState.initialEndMs;
      
      if (loopMarkerDragState.markerType === 'start') {
        // Dragging start marker - allow crossing past end
        newStartMs = timeMs;
      } else {
        // Dragging end marker - allow crossing past start
        newEndMs = timeMs;
      }
      
      // Update the drag state to store current values for visual update
      setLoopMarkerDragState(prev => ({
        ...prev,
        currentStartMs: newStartMs,
        currentEndMs: newEndMs,
      }));
    };

    const handleMouseUp = () => {
      // Get final values from drag state
      const rawStartMs = loopMarkerDragState.currentStartMs ?? loopMarkerDragState.initialStartMs;
      const rawEndMs = loopMarkerDragState.currentEndMs ?? loopMarkerDragState.initialEndMs;
      const finalStartMs = Math.min(rawStartMs, rawEndMs);
      const finalEndMs = Math.max(rawStartMs, rawEndMs);
      
      // Only create undo entry if values actually changed
      if (finalStartMs !== loopMarkerDragState.initialStartMs || 
          finalEndMs !== loopMarkerDragState.initialEndMs) {
        updateProject((proj) => ({
          ...proj,
          loop: {
            ...proj.loop,
            startMs: finalStartMs,
            endMs: finalEndMs,
          },
        }), 'Adjust loop region');
      }
      setLoopMarkerDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [loopMarkerDragState, pixelsPerMs, scrollLeft, projectDurationMs, minZoomDurationMs, updateProject]);

  // Handle wheel events for zoom and horizontal scroll
  useEffect(() => {
    const convertSliderToDuration = (value) => {
      if (minZoomDurationMs <= maxZoomDurationMs) return maxZoomDurationMs;
      return maxZoomDurationMs * Math.pow(minZoomDurationMs / maxZoomDurationMs, value);
    };

    const handleWheel = (e) => {
      // Ctrl/Cmd + Wheel = Zoom in/out
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY * 0.001; // Inverted: scroll up = zoom in, scroll down = zoom out
        const newSliderValue = Math.max(0, Math.min(1, zoomSliderValue + delta));
        
        if (newSliderValue >= 0.99) {
          setVisibleDurationMs(null);
        } else {
          const newDuration = convertSliderToDuration(newSliderValue);
          if (newDuration >= minZoomDurationMs * 0.95) {
            setVisibleDurationMs(null);
          } else {
            setVisibleDurationMs(newDuration);
          }
        }
      }
      // Shift + Wheel = Horizontal scroll (only when zoomed in)
      else if (e.shiftKey) {
        const scrollElement = tracksScrollRef.current;
        if (scrollElement && scrollElement.scrollWidth > scrollElement.clientWidth) {
          e.preventDefault();
          scrollElement.scrollLeft += e.deltaY * 3;
        }
      }
      // Regular wheel = Vertical scroll between tracks (default behavior)
    };

    const timelineElement = timelineRef.current;
    const tracksElement = tracksScrollRef.current;
    const rulerElement = rulerScrollRef.current;
    
    if (timelineElement) {
      timelineElement.addEventListener('wheel', handleWheel, { passive: false });
    }
    if (tracksElement) {
      tracksElement.addEventListener('wheel', handleWheel, { passive: false });
    }
    if (rulerElement) {
      rulerElement.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      if (timelineElement) {
        timelineElement.removeEventListener('wheel', handleWheel);
      }
      if (tracksElement) {
        tracksElement.removeEventListener('wheel', handleWheel);
      }
      if (rulerElement) {
        rulerElement.removeEventListener('wheel', handleWheel);
      }
    };
  }, [zoomSliderValue, minZoomDurationMs, maxZoomDurationMs]);
  
  const handleZoomIn = () => {
    const newSliderValue = Math.max(0, zoomSliderValue - 0.1);
    const newDuration = sliderValueToDuration(newSliderValue);
    setVisibleDurationMs(newDuration);
  };
  
  const handleZoomOut = () => {
    const newSliderValue = Math.min(1, zoomSliderValue + 0.1);
    if (newSliderValue >= 0.99) {
      setVisibleDurationMs(null);
    } else {
      const newDuration = sliderValueToDuration(newSliderValue);
      if (newDuration >= minZoomDurationMs * 0.95) {
        setVisibleDurationMs(null);
      } else {
        setVisibleDurationMs(newDuration);
      }
    }
  };
  
  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    if (value >= 0.99) {
      setVisibleDurationMs(null);
    } else {
      const newDuration = sliderValueToDuration(value);
      if (newDuration >= minZoomDurationMs * 0.95) {
        setVisibleDurationMs(null);
      } else {
        setVisibleDurationMs(newDuration);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-900 overflow-hidden" style={{ minWidth: 0 }}>
      {/* Timeline Header */}
      <div className="relative flex-1 flex flex-col" style={{ minWidth: 0 }}>
        {/* Zoom overlay */}
        <div className="absolute top-9 right-3 z-40 bg-gray-800/90 border border-gray-700 rounded-md px-2 py-2 shadow-lg flex items-center">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={zoomSliderValue}
            onChange={handleSliderChange}
            className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
            title="Zoom"
            style={{
              background: `linear-gradient(to right, #4F8EF7 0%, #4F8EF7 ${zoomSliderValue * 100}%, #4B5563 ${zoomSliderValue * 100}%, #4B5563 100%)`
            }}
          />
        </div>
        {/* Timeline Ruler */}
        <div className="bg-gray-850 border-b border-gray-700 flex" style={{ height: '24px' }}>
          <div 
            ref={rulerScrollRef}
            className="flex-1 overflow-x-scroll overflow-y-hidden ruler-scrollbar-hidden"
          >
            <div 
              style={{ width: `${timelineWidthPx}px`, height: '24px' }} 
              className="relative cursor-pointer"
              onMouseDown={handleRulerMouseDown}
            >
              {/* Time markers */}
              {Array.from({ 
                length: Math.ceil(Math.max(minZoomDurationMs, clampedVisibleMs) / rulerIntervalMs) + 1 
              }).map((_, i) => {
                const timeMs = i * rulerIntervalMs;
                if (timeMs * pixelsPerMs > timelineWidthPx + 50) return null;
                
                return (
                  <div
                    key={i}
                    className="absolute top-0 border-l border-gray-600"
                    style={{ left: `${timeMs * pixelsPerMs}px`, height: '24px' }}
                  >
                    <span className="text-xs text-gray-500 ml-1 whitespace-nowrap pointer-events-none select-none">
                      {formatRulerTime(timeMs, rulerIntervalMs)}
                    </span>
                  </div>
                );
              }).filter(Boolean)}

              {/* Loop region background (always show if loop exists, faint when disabled) */}
              {/* Show drag state if dragging new loop, otherwise show project loop */}
            {(() => {
              // If dragging a new loop, show that instead of project loop
              if (rulerDragState?.isDragging && rulerDragState.mode === 'create' && rulerDragState.currentStartMs !== undefined) {
                return (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none bg-yellow-500 bg-opacity-20"
                      style={{
                        left: `${rulerDragState.currentStartMs * pixelsPerMs}px`,
                        width: `${(rulerDragState.currentEndMs - rulerDragState.currentStartMs) * pixelsPerMs}px`,
                      }}
                    />
                  );
                }
                
                // Otherwise show project loop (if it exists)
                if (project.loop.startMs !== undefined && project.loop.endMs !== undefined) {
                const rawStartMs = loopMarkerDragState?.currentStartMs 
                  ?? (rulerDragState?.mode === 'move' ? rulerDragState.currentStartMs : undefined)
                  ?? project.loop.startMs;
                const rawEndMs = loopMarkerDragState?.currentEndMs 
                  ?? (rulerDragState?.mode === 'move' ? rulerDragState.currentEndMs : undefined)
                  ?? project.loop.endMs;
                const displayStartMs = Math.min(rawStartMs, rawEndMs);
                const displayEndMs = Math.max(rawStartMs, rawEndMs);
                
                return (
                    <div
                      className={`absolute top-0 bottom-0 pointer-events-none ${
                        project.loop.enabled ? 'bg-yellow-500 bg-opacity-20' : 'bg-gray-500 bg-opacity-5'
                      }`}
                      style={{
                        left: `${displayStartMs * pixelsPerMs}px`,
                        width: `${(displayEndMs - displayStartMs) * pixelsPerMs}px`,
                      }}
                    />
                  );
                }
                
                return null;
              })()}

              {/* Loop start marker */}
              {(() => {
                // If dragging a new loop, show new loop markers
                if (rulerDragState?.isDragging && rulerDragState.currentStartMs !== undefined) {
                  return (
                    <div
                      className="absolute top-0 bottom-0 w-1 pointer-events-none bg-yellow-500"
                      style={{
                        left: `${rulerDragState.currentStartMs * pixelsPerMs}px`,
                      }}
                    />
                  );
                }
                
                // Otherwise show project loop markers
              if (project.loop.startMs !== undefined && project.loop.endMs !== undefined) {
                const displayStartMs = loopMarkerDragState?.currentStartMs 
                  ?? (rulerDragState?.mode === 'move' ? rulerDragState.currentStartMs : undefined)
                  ?? project.loop.startMs;
                
                return (
                  <div
                    className={`absolute top-0 bottom-0 w-1 cursor-ew-resize ${
                        project.loop.enabled ? 'bg-yellow-500' : 'bg-gray-500 opacity-40'
                      }`}
                      style={{
                        left: `${displayStartMs * pixelsPerMs}px`,
                      }}
                      onMouseDown={(e) => handleLoopMarkerMouseDown(e, 'start')}
                    />
                  );
                }
                
                return null;
              })()}

              {/* Loop end marker */}
              {(() => {
                // If dragging a new loop, show new loop end marker
                if (rulerDragState?.isDragging && rulerDragState.currentEndMs !== undefined) {
                  return (
                    <div
                      className="absolute top-0 bottom-0 w-1 pointer-events-none bg-yellow-500"
                      style={{
                        left: `${rulerDragState.currentEndMs * pixelsPerMs}px`,
                      }}
                    />
                  );
                }
                
                // Otherwise show project loop end marker
              if (project.loop.startMs !== undefined && project.loop.endMs !== undefined) {
                const displayEndMs = loopMarkerDragState?.currentEndMs 
                  ?? (rulerDragState?.mode === 'move' ? rulerDragState.currentEndMs : undefined)
                  ?? project.loop.endMs;
                
                return (
                  <div
                      className={`absolute top-0 bottom-0 w-1 cursor-ew-resize ${
                        project.loop.enabled ? 'bg-yellow-500' : 'bg-gray-500 opacity-40'
                      }`}
                      style={{
                        left: `${displayEndMs * pixelsPerMs}px`,
                      }}
                      onMouseDown={(e) => handleLoopMarkerMouseDown(e, 'end')}
                    />
                  );
                }
                
                return null;
              })()}
            </div>
          </div>
        </div>

        {/* Timeline Tracks */}
        <div 
          ref={timelineRef}
          className="flex-1 overflow-hidden relative"
          style={{ minWidth: 0 }}
          onClick={handleTimelineClick}
          onContextMenu={handleContextMenu}
        >
          <div 
            ref={(el) => {
              tracksScrollRef.current = el;
              if (internalScrollRef) {
                internalScrollRef.current = el;
              }
            }}
            className="absolute inset-0 overflow-auto scrollbar-hidden"
            onScroll={(e) => {
              const newScrollLeft = e.target.scrollLeft;
              setScrollLeft(newScrollLeft);
              if (rulerScrollRef.current) {
                rulerScrollRef.current.scrollLeft = newScrollLeft;
              }
              // Notify parent of vertical scroll
              if (onVerticalScroll) {
                onVerticalScroll(e.target.scrollTop);
              }
            }}
          >
            <div style={{ width: `${timelineWidthPx}px`, height: `${totalTimelineHeight}px`, position: 'relative' }}>
              {project.tracks.map((track, trackIndex) => {
                const trackHeight = getTrackHeight(track);
                const trackY = getTrackYPosition(project.tracks, trackIndex);

                return (
                  <div
                    key={track.id}
                    className={`border-b border-gray-700 relative ${track.locked ? 'bg-gray-850' : ''}`}
                    style={{ 
                      height: `${trackHeight}px`,
                      top: `${trackY}px`,
                      position: 'absolute',
                      width: '100%'
                    }}
                  >
                    {/* Locked track label */}
                    {track.locked && (
                      <div className="absolute left-2 top-1 text-xs text-gray-500 italic pointer-events-none z-10">
                        {track.name} (locked)
                      </div>
                    )}

                    {/* Clips */}
                    {track.clips.map(clip => {
                      const clipDurationMs = clip.cropEndMs - clip.cropStartMs;
                      const clipWidthPx = clipDurationMs * pixelsPerMs;
                      const clipLeftPx = clip.timelineStartMs * pixelsPerMs;
                      const audioBuffer = audioManager.mediaCache.get(clip.blobId);
                      const clipPadding = track.locked ? 4 : 8;
                      const clipInternalHeight = trackHeight - (clipPadding * 2);

                      return (
                        <div
                          key={clip.id}
                          className={`absolute rounded overflow-hidden ${
                            track.locked ? 'cursor-not-allowed opacity-50' : ''
                          } ${
                            selectedClipId === clip.id 
                              ? 'ring-2 ring-blue-500' 
                              : 'hover:ring-2 hover:ring-gray-500'
                          }`}
                          style={{
                            left: `${clipLeftPx}px`,
                            top: `${clipPadding}px`,
                            width: `${clipWidthPx}px`,
                            height: `${clipInternalHeight}px`,
                            backgroundColor: 'rgba(79, 142, 247, 0.3)',
                          }}
                          onClick={(e) => handleClipClick(e, clip.id, track.id)}
                          onMouseDown={(e) => handleClipMouseDown(e, clip, track)}
                        >
                          {/* Middle area with move cursor */}
                          {!track.locked && (
                            <div 
                              className="absolute inset-0 cursor-move"
                              style={{ 
                                pointerEvents: 'none',
                                zIndex: 1,
                              }}
                            />
                          )}
                          {/* Waveform - now shown for locked tracks too */}
                          {audioBuffer && (
                            <Waveform
                              audioBuffer={audioBuffer}
                              clipId={clip.id}
                              cropStartMs={clip.cropStartMs}
                              cropEndMs={clip.cropEndMs}
                              sourceDurationMs={clip.sourceDurationMs}
                              height={clipInternalHeight}
                              color="rgba(79, 142, 247, 0.8)"
                              globalPeakAmplitude={globalPeakAmplitude}
                            />
                          )}

                          {/* Clip Label - hidden for locked tracks to save space */}
                          {!track.locked && (
                            <div className="absolute top-1 left-2 text-xs text-white font-medium pointer-events-none">
                              {track.name}
                              {clip.gainDb !== 0 && (
                                <span className="ml-2 text-yellow-400">
                                  {clip.gainDb > 0 ? '+' : ''}{clip.gainDb.toFixed(1)} dB
                                </span>
                              )}
                            </div>
                          )}

                          {/* Resize Handles - wider invisible hover zones with visible indicators */}
                          {!track.locked && (
                            <>
                              <div 
                                className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize group"
                                style={{ 
                                  zIndex: 10,
                                }}
                              >
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-400 opacity-0 group-hover:opacity-70 transition-opacity"></div>
                              </div>
                              <div 
                                className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize group"
                                style={{ 
                                  zIndex: 10,
                                }}
                              >
                                <div className="absolute right-0 top-0 bottom-0 w-1 bg-blue-400 opacity-0 group-hover:opacity-70 transition-opacity"></div>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}

                    {/* Recording Clip - show in real-time during recording */}
                    {isRecording && recordingSegments && recordingSegments.length > 0 && selectedTrackId === track.id && (() => {
                      const currentSegment = recordingSegments[recordingSegments.length - 1];
                      const recordingStartMs = currentSegment.startTimeMs;
                      const recordingDurationMs = Math.max(0, currentTimeMs - recordingStartMs);
                      const recordingWidthPx = recordingDurationMs * pixelsPerMs;
                      const recordingLeftPx = recordingStartMs * pixelsPerMs;
                      const clipPadding = track.locked ? 4 : 8;
                      const clipInternalHeight = trackHeight - (clipPadding * 2);

                      return (
                        <div
                          key="recording-clip"
                          className="absolute rounded overflow-hidden pointer-events-none animate-pulse"
                          style={{
                            left: `${recordingLeftPx}px`,
                            top: `${clipPadding}px`,
                            width: `${recordingWidthPx}px`,
                            height: `${clipInternalHeight}px`,
                            backgroundColor: 'rgba(239, 68, 68, 0.3)',
                            border: '2px solid rgb(239, 68, 68)',
                          }}
                        >
                          {!track.locked && (
                            <div className="absolute top-1 left-2 text-xs text-red-500 font-bold pointer-events-none flex items-center gap-1">
                              <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                              REC {recordingSegments.length > 1 && `(${recordingSegments.length})`}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-30"
          style={{
            left: `${currentTimeMs * pixelsPerMs - scrollLeft}px`,
          }}
        />
      </div>
    </div>
  );
}

export default Timeline;
