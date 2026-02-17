import { useRef, useState, useEffect, useMemo } from 'react';
import { VolumeX } from 'lucide-react';
import {
  formatTime,
  msToSeconds,
  secondsToMs,
  clipGainDbToPosition,
  positionToClipGainDb,
} from '../utils/audio';
import { audioManager } from '../lib/audioManager';
import Waveform from './Waveform';
import { calculateGlobalPeakAmplitude } from '../utils/waveformUtils';
import { getEffectiveTrackMix, getGroupDescendantTrackIdsByGroup, getTrackHeight } from '../utils/trackTree';
import { 
  constrainClipMove, 
  constrainCropStart, 
  constrainCropEnd, 
  canAddClip,
  findSafePosition 
} from '../utils/clipCollision';
import { isPrimaryModifierPressed } from '../utils/keyboard';

const TIMELINE_VIEWPORT_WIDTH = 1920; // Default viewport width (updated dynamically)
const MIN_VISIBLE_DURATION_MS = 8000; // Minimum duration to show when zoomed out
const MAX_ZOOM_VISIBLE_MS = 100; // At max zoom, show 100ms across viewport
const MIN_CLIP_DURATION_MS = 100;
const MIN_CLIP_GAIN_DB = -24;
const MAX_CLIP_GAIN_DB = 24;

// Helper to calculate cumulative Y position for a row index
const getTrackYPosition = (rows, rowIndex) => {
  let yPosition = 0;
  for (let i = 0; i < rowIndex; i++) {
    yPosition += rows[i].height;
  }
  return yPosition;
};

/**
 * Timeline component
 * Displays tracks, clips, and waveforms with editing capabilities
 */
function Timeline({ 
  project, 
  rows = [],
  currentTimeMs, 
  isPlaying,
  isRecording,
  recordingSegments,
  selectedTrackId,
  selectedNodeId = null,
  selectedRowKind = null,
  onUpdateClip,
  onSelectRow,
  onSelectTrack,
  onSeek,
  onVerticalScroll,
  scrollContainerRef,
  updateProject,
  shortcutsEnabled = false,
  deleteClipShortcutEnabled = false,
  onDeleteTrackShortcut = null,
  sharedVerticalScroll = false,
  children,
}) {
  const timelineRef = useRef(null);
  const rulerScrollRef = useRef(null);
  const tracksScrollRef = useRef(null);
  const internalScrollRef = scrollContainerRef || useRef(null);
  const [visibleDurationMs, setVisibleDurationMs] = useState(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [dragState, setDragState] = useState(null);
  const [selectedClipIds, setSelectedClipIds] = useState([]);
  const [selectedClipHistory, setSelectedClipHistory] = useState([]);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [clipboardClip, setClipboardClip] = useState(null);
  const [rulerDragState, setRulerDragState] = useState(null);
  const [loopMarkerDragState, setLoopMarkerDragState] = useState(null);
  const [timelineSelectionState, setTimelineSelectionState] = useState(null);
  const rightClickDragRef = useRef(false);
  const timelineSelectionRef = useRef(null);
  const timelineSelectionSuppressClickRef = useRef(false);
  const prevProjectDurationRef = useRef(null);
  const shouldCenterOnPlayheadAfterZoomRef = useRef(false);
  const [containerWidth, setContainerWidth] = useState(TIMELINE_VIEWPORT_WIDTH);
  const [globalPeakAmplitude, setGlobalPeakAmplitude] = useState(1.0);
  const [loadedClipIds, setLoadedClipIds] = useState(new Set());
  const errorBeepContextRef = useRef(null);
  const selectedClipIdSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);

  const playErrorBeep = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!errorBeepContextRef.current) {
        errorBeepContextRef.current = new AudioCtx();
      }
      const ctx = errorBeepContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch {
      // no-op
    }
  };

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

  const timelineRows = rows && rows.length
    ? rows
    : (project.tracks || []).map((track) => ({
      kind: 'track',
      trackId: track.id,
      track,
      depth: 0,
      height: getTrackHeight(track),
    }));

  const effectiveMix = useMemo(() => getEffectiveTrackMix(project), [project]);
  const trackStateById = effectiveMix.statesByTrackId;

  const trackRowByTrackId = useMemo(() => {
    const map = new Map();
    timelineRows.forEach((row) => {
      if (row.kind === 'track' && row.trackId) {
        map.set(row.trackId, row);
      }
    });
    return map;
  }, [timelineRows]);

  const clipLocationById = useMemo(() => {
    const map = new Map();
    project.tracks.forEach((track) => {
      track.clips.forEach((clip) => {
        map.set(clip.id, { trackId: track.id, clip });
      });
    });
    return map;
  }, [project.tracks]);

  const visibleTrackIndexByTrackId = useMemo(() => {
    const map = new Map();
    timelineRows.forEach((row, idx) => {
      if (row.kind === 'track' && row.trackId) {
        map.set(row.trackId, idx);
      }
    });
    return map;
  }, [timelineRows]);

  const visibleTrackIdByRowIndex = useMemo(() => {
    const map = new Map();
    timelineRows.forEach((row, idx) => {
      if (row.kind === 'track' && row.trackId) {
        map.set(idx, row.trackId);
      }
    });
    return map;
  }, [timelineRows]);

  const selectRow = (row) => {
    if (!row) return;
    onSelectRow?.(row);
    if (row.kind === 'track' && row.trackId) {
      onSelectTrack?.(row.trackId);
    }
  };

  const clearSelectedClips = () => {
    setSelectedClipIds([]);
    setSelectedClipHistory([]);
    setSelectedClipId(null);
  };

  const getLastSelectedFromHistory = (selectedIds, history) => {
    const selectedSet = new Set(selectedIds);
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (selectedSet.has(history[i])) {
        return history[i];
      }
    }
    return null;
  };

  const getShiftRangeSelection = (anchorClipId, targetClipId) => {
    const anchor = clipLocationById.get(anchorClipId);
    const target = clipLocationById.get(targetClipId);
    if (!anchor || !target) return [targetClipId];

    const anchorTrackIndex = visibleTrackIndexByTrackId.get(anchor.trackId);
    const targetTrackIndex = visibleTrackIndexByTrackId.get(target.trackId);
    if (anchorTrackIndex === undefined || targetTrackIndex === undefined) {
      return [targetClipId];
    }

    const minTrackIndex = Math.min(anchorTrackIndex, targetTrackIndex);
    const maxTrackIndex = Math.max(anchorTrackIndex, targetTrackIndex);
    const anchorStartMs = anchor.clip.timelineStartMs;
    const targetStartMs = target.clip.timelineStartMs;
    const anchorEndMs = anchor.clip.timelineStartMs + (anchor.clip.cropEndMs - anchor.clip.cropStartMs);
    const targetEndMs = target.clip.timelineStartMs + (target.clip.cropEndMs - target.clip.cropStartMs);
    const minTimeMs = Math.min(anchorStartMs, targetStartMs);
    const maxTimeMs = Math.max(anchorEndMs, targetEndMs);

    const selection = [];
    project.tracks.forEach((track) => {
      const trackIndex = visibleTrackIndexByTrackId.get(track.id);
      if (trackIndex === undefined || trackIndex < minTrackIndex || trackIndex > maxTrackIndex) {
        return;
      }
      track.clips.forEach((clip) => {
        const clipStartMs = clip.timelineStartMs;
        const clipEndMs = clip.timelineStartMs + (clip.cropEndMs - clip.cropStartMs);
        if (clipStartMs >= minTimeMs && clipEndMs <= maxTimeMs) {
          selection.push(clip.id);
        }
      });
    });

    if (!selection.includes(anchorClipId)) selection.push(anchorClipId);
    if (!selection.includes(targetClipId)) selection.push(targetClipId);
    return selection;
  };

  const getClipDurationMs = (clip) => clip.cropEndMs - clip.cropStartMs;

  const getSelectedClipEntries = (clipIds = selectedClipIds) => {
    const entries = [];
    project.tracks.forEach((track) => {
      const rowIndex = visibleTrackIndexByTrackId.get(track.id);
      if (rowIndex === undefined) return;
      track.clips.forEach((clip) => {
        if (!clipIds.includes(clip.id)) return;
        entries.push({
          trackId: track.id,
          trackRowIndex: rowIndex,
          clip,
        });
      });
    });
    entries.sort((a, b) => (
      a.trackRowIndex - b.trackRowIndex ||
      a.clip.timelineStartMs - b.clip.timelineStartMs ||
      a.clip.id.localeCompare(b.clip.id)
    ));
    return entries;
  };

  const getActiveSelectionForClip = (clipId) => (
    selectedClipIdSet.has(clipId) && selectedClipIds.length > 0 ? selectedClipIds : [clipId]
  );

  const buildClipboardPayload = (clipIds = selectedClipIds) => {
    const entries = getSelectedClipEntries(clipIds);
    if (!entries.length) return null;

    const anchor = entries[0];
    const anchorTrackIndex = anchor.trackRowIndex;
    const anchorStartMs = anchor.clip.timelineStartMs;

    if (entries.length === 1) {
      return {
        type: 'single',
        clip: { ...anchor.clip },
      };
    }

    return {
      type: 'multi',
      items: entries.map((entry) => ({
        clip: { ...entry.clip },
        trackOffset: entry.trackRowIndex - anchorTrackIndex,
        startOffsetMs: entry.clip.timelineStartMs - anchorStartMs,
      })),
    };
  };

  // Calculate total timeline height based on rendered rows
  const totalTimelineHeight = timelineRows.reduce((sum, row) => sum + row.height, 0);

  const groupTimelinePreviewByNodeId = useMemo(() => {
    const groupTrackIdsByNodeId = getGroupDescendantTrackIdsByGroup(project);
    const trackById = new Map((project.tracks || []).map((track) => [track.id, track]));
    const byGroupNodeId = new Map();

    for (const [groupNodeId, trackIds] of groupTrackIdsByNodeId.entries()) {
      const clips = [];
      for (const trackId of trackIds) {
        const track = trackById.get(trackId);
        if (!track?.clips?.length) continue;
        for (const clip of track.clips) {
          if (clip?.muted) continue;
          const durationMs = Math.max(0, (clip.cropEndMs || 0) - (clip.cropStartMs || 0));
          if (durationMs <= 0) continue;
          clips.push({
            key: `${trackId}:${clip.id}`,
            startMs: clip.timelineStartMs,
            durationMs,
            cropStartMs: clip.cropStartMs,
            cropEndMs: clip.cropEndMs,
            sourceDurationMs: clip.sourceDurationMs,
            blobId: clip.blobId,
          });
        }
      }

      clips.sort((a, b) => a.startMs - b.startMs || b.durationMs - a.durationMs);

      const activeSegments = [];
      for (const clip of clips) {
        const clipStart = clip.startMs;
        const clipEnd = clip.startMs + clip.durationMs;
        const previous = activeSegments[activeSegments.length - 1];
        if (!previous || clipStart > previous.endMs) {
          activeSegments.push({ startMs: clipStart, endMs: clipEnd });
        } else if (clipEnd > previous.endMs) {
          previous.endMs = clipEnd;
        }
      }

      byGroupNodeId.set(groupNodeId, {
        clips,
        activeSegments,
      });
    }

    return byGroupNodeId;
  }, [project]);

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

  const applyZoomDuration = (nextVisibleDurationMs) => {
    shouldCenterOnPlayheadAfterZoomRef.current = true;
    setVisibleDurationMs(nextVisibleDurationMs);
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

  useEffect(() => {
    if (!shouldCenterOnPlayheadAfterZoomRef.current) return;
    const tracksElement = tracksScrollRef.current;
    if (!tracksElement) return;

    const maxScrollLeft = Math.max(0, timelineWidthPx - containerWidth);
    const targetScrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, (currentTimeMs * pixelsPerMs) - (containerWidth / 2))
    );

    tracksElement.scrollLeft = targetScrollLeft;
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = targetScrollLeft;
    }
    setScrollLeft(targetScrollLeft);
    shouldCenterOnPlayheadAfterZoomRef.current = false;
  }, [pixelsPerMs, timelineWidthPx, containerWidth, currentTimeMs]);
  
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
        const preservedDuration = Math.max(prevDuration, MIN_VISIBLE_DURATION_MS);
        setVisibleDurationMs(preservedDuration);
      }
    }
    
    prevProjectDurationRef.current = projectDurationMs;
  }, [projectDurationMs, visibleDurationMs]);

  const getTimelineContentPoint = (clientX, clientY) => {
    const scrollElement = tracksScrollRef.current;
    if (!scrollElement) return null;
    const rect = scrollElement.getBoundingClientRect();
    return {
      x: clientX - rect.left + scrollElement.scrollLeft,
      y: clientY - rect.top + scrollElement.scrollTop,
    };
  };

  const getSelectionRect = (state) => {
    const left = Math.min(state.startX, state.currentX);
    const right = Math.max(state.startX, state.currentX);
    const top = Math.min(state.startY, state.currentY);
    const bottom = Math.max(state.startY, state.currentY);
    return {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  };

  const getClipIdsInSelectionRect = (selectionRect) => {
    const selectedIds = [];
    timelineRows.forEach((row, rowIndex) => {
      if (row.kind !== 'track' || !row.track) return;
      const trackY = getTrackYPosition(timelineRows, rowIndex);
      const clipPadding = 8;
      const clipTop = trackY + clipPadding;
      const clipBottom = clipTop + Math.max(0, row.height - (clipPadding * 2));
      if (clipBottom < selectionRect.top || clipTop > selectionRect.bottom) return;

      row.track.clips.forEach((clip) => {
        const clipLeft = clip.timelineStartMs * pixelsPerMs;
        const clipRight = clipLeft + (getClipDurationMs(clip) * pixelsPerMs);
        const intersects = (
          clipRight >= selectionRect.left &&
          clipLeft <= selectionRect.right &&
          clipBottom >= selectionRect.top &&
          clipTop <= selectionRect.bottom
        );
        if (intersects) {
          selectedIds.push(clip.id);
        }
      });
    });
    return selectedIds;
  };

  const handleTimelineMouseDown = (e) => {
    if (e.button !== 0 || dragState) return;
    const point = getTimelineContentPoint(e.clientX, e.clientY);
    if (!point) return;

    const nextState = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      currentClientX: e.clientX,
      currentClientY: e.clientY,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      moved: false,
    };
    timelineSelectionRef.current = nextState;
    setTimelineSelectionState(nextState);
  };

  const handleClipClick = (e, clipId, trackId) => {
    e.stopPropagation();
    const isToggleSelect = isPrimaryModifierPressed(e) && !e.shiftKey;
    const isRangeSelect = e.shiftKey;

    if (isRangeSelect) {
      const anchorClipId = getLastSelectedFromHistory(selectedClipIds, selectedClipHistory) || selectedClipId || clipId;
      const rangeSelected = getShiftRangeSelection(anchorClipId, clipId);
      const nextSelected = Array.from(new Set([...selectedClipIds, ...rangeSelected]));
      const nextHistory = [
        ...selectedClipHistory.filter((id) => nextSelected.includes(id) && id !== clipId),
        ...rangeSelected.filter((id) => id !== clipId && !selectedClipHistory.includes(id)),
        clipId,
      ];
      setSelectedClipIds(nextSelected);
      setSelectedClipHistory(nextHistory);
      setSelectedClipId(clipId);
    } else if (isToggleSelect) {
      const isSelected = selectedClipIds.includes(clipId);
      const nextSelected = isSelected
        ? selectedClipIds.filter((id) => id !== clipId)
        : [...selectedClipIds, clipId];
      const nextHistory = isSelected
        ? selectedClipHistory.filter((id) => id !== clipId)
        : [...selectedClipHistory.filter((id) => id !== clipId), clipId];
      setSelectedClipIds(nextSelected);
      setSelectedClipHistory(nextHistory);
      setSelectedClipId(getLastSelectedFromHistory(nextSelected, nextHistory));
    } else {
      setSelectedClipIds([clipId]);
      setSelectedClipHistory([clipId]);
      setSelectedClipId(clipId);
    }

    const row = trackRowByTrackId.get(trackId);
    if (row) {
      selectRow(row);
    } else {
      onSelectTrack(trackId);
    }
  };

  const handleClipRightClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleClipMouseDown = (e, clip, track) => {
    if (e.button === 2) {
      e.preventDefault();
    }

    e.stopPropagation();

    if (e.button === 0 && (e.shiftKey || isPrimaryModifierPressed(e))) {
      const row = trackRowByTrackId.get(track.id);
      if (row) {
        selectRow(row);
      } else {
        onSelectTrack(track.id);
      }
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const clipWidthPx = (clip.cropEndMs - clip.cropStartMs) * pixelsPerMs;

    const edgeThreshold = 12; // Match the w-3 (12px) hover zone width
    let dragType = 'move';

    const isOnLeftEdge = offsetX < edgeThreshold;
    const isOnRightEdge = offsetX > clipWidthPx - edgeThreshold;
    const isOnEdge = isOnLeftEdge || isOnRightEdge;

    // Cropping requires left-click on edges. Right-click on edges does nothing.
    if (isOnEdge && e.button !== 0) {
      return;
    }

    if (isOnLeftEdge) {
      dragType = 'crop-start';
    } else if (isOnRightEdge) {
      dragType = 'crop-end';
    } else if (e.button === 2) {
      dragType = 'gain';
      rightClickDragRef.current = false;
    }

    const activeClipIds = getActiveSelectionForClip(clip.id);
    const activeEntries = getSelectedClipEntries(activeClipIds);
    const initialByClipId = {};
    const initialTrackRowByClipId = {};
    activeEntries.forEach((entry) => {
      initialByClipId[entry.clip.id] = {
        trackId: entry.trackId,
        timelineStartMs: entry.clip.timelineStartMs,
        cropStartMs: entry.clip.cropStartMs,
        cropEndMs: entry.clip.cropEndMs,
        sourceDurationMs: entry.clip.sourceDurationMs,
        gainDb: entry.clip.gainDb,
      };
      initialTrackRowByClipId[entry.clip.id] = entry.trackRowIndex;
    });
    const clickedRowIndex = visibleTrackIndexByTrackId.get(track.id) ?? 0;

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
      initialGainPosition: clipGainDbToPosition(clip.gainDb),
      activeClipIds,
      initialByClipId,
      initialTrackRowByClipId,
      clickedRowIndex,
      trackRowOffset: 0,
      sourceDurationMs: clip.sourceDurationMs,  // Store for validation during drag
    });

    if (!selectedClipIdSet.has(clip.id)) {
      setSelectedClipIds([clip.id]);
      setSelectedClipHistory([clip.id]);
      setSelectedClipId(clip.id);
    }
    const row = trackRowByTrackId.get(track.id);
    if (row) {
      selectRow(row);
    } else {
      onSelectTrack(track.id);
    }
  };

  const getTrackRowAtClientY = (clientY) => {
    const timelineElement = timelineRef.current;
    const scrollElement = tracksScrollRef.current;
    if (!timelineElement || !scrollElement) return null;

    const rect = timelineElement.getBoundingClientRect();
    const yWithinContent = clientY - rect.top + scrollElement.scrollTop;
    if (yWithinContent < 0) return null;

    let accumulatedHeight = 0;
    for (const row of timelineRows) {
      const rowEnd = accumulatedHeight + row.height;
      if (yWithinContent >= accumulatedHeight && yWithinContent < rowEnd) {
        return row.kind === 'track' ? row : null;
      }
      accumulatedHeight = rowEnd;
    }

    return null;
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

      const activeClipIds = dragState.activeClipIds?.length
        ? dragState.activeClipIds
        : [dragState.clipId];
      const activeClipIdSet = new Set(activeClipIds);
      const initialByClipId = dragState.initialByClipId || {
        [dragState.clipId]: {
          trackId: dragState.trackId,
          timelineStartMs: dragState.initialTimelineStartMs,
          cropStartMs: dragState.initialCropStartMs,
          cropEndMs: dragState.initialCropEndMs,
          sourceDurationMs: dragState.sourceDurationMs,
          gainDb: dragState.initialGainDb,
        },
      };

      if (dragState.type === 'move') {
        const desiredDeltaMs = deltaMs;

        const computeCandidatesForOffset = (rowOffset) => {
          const candidates = [];
          for (const clipId of activeClipIds) {
            const initial = initialByClipId[clipId];
            const current = clipLocationById.get(clipId);
            if (!initial || !current) return null;
            const initialRowIndex = dragState.initialTrackRowByClipId?.[clipId];
            if (initialRowIndex === undefined) return null;
            const targetRowIndex = initialRowIndex + rowOffset;
            const targetTrackId = visibleTrackIdByRowIndex.get(targetRowIndex);
            if (!targetTrackId) return null;
            candidates.push({
              clipId,
              targetTrackId,
              clip: {
                ...current.clip,
                timelineStartMs: initial.timelineStartMs + desiredDeltaMs,
              },
            });
          }
          return candidates;
        };

        let desiredRowOffset = dragState.trackRowOffset ?? 0;
        const hoveredRow = getTrackRowAtClientY(e.clientY);
        if (hoveredRow?.trackId) {
          const hoveredIndex = visibleTrackIndexByTrackId.get(hoveredRow.trackId);
          if (hoveredIndex !== undefined) {
            desiredRowOffset = hoveredIndex - (dragState.clickedRowIndex ?? 0);
          }
        }

        let candidateEntries = computeCandidatesForOffset(desiredRowOffset);
        let appliedRowOffset = desiredRowOffset;
        if (!candidateEntries) {
          appliedRowOffset = dragState.trackRowOffset ?? 0;
          candidateEntries = computeCandidatesForOffset(appliedRowOffset);
        }
        if (!candidateEntries) {
          return;
        }

        const staticClipsByTrack = new Map();
        project.tracks.forEach((candidateTrack) => {
          staticClipsByTrack.set(
            candidateTrack.id,
            candidateTrack.clips.filter((clip) => !activeClipIdSet.has(clip.id))
          );
        });

        const candidateByTrack = new Map();
        candidateEntries.forEach((entry) => {
          if (!candidateByTrack.has(entry.targetTrackId)) {
            candidateByTrack.set(entry.targetTrackId, []);
          }
          candidateByTrack.get(entry.targetTrackId).push(entry.clip);
        });

        let valid = true;
        for (const entry of candidateEntries) {
          if (entry.clip.timelineStartMs < 0) {
            valid = false;
            break;
          }
        }

        if (valid) {
          for (const [targetTrackId, movingClips] of candidateByTrack.entries()) {
            const sortedMoving = [...movingClips].sort((a, b) => a.timelineStartMs - b.timelineStartMs);
            for (let i = 1; i < sortedMoving.length; i += 1) {
              const previous = sortedMoving[i - 1];
              const current = sortedMoving[i];
              const previousEnd = previous.timelineStartMs + getClipDurationMs(previous);
              if (current.timelineStartMs < previousEnd) {
                valid = false;
                break;
              }
            }
            if (!valid) break;

            const staticClips = staticClipsByTrack.get(targetTrackId) || [];
            for (const movingClip of movingClips) {
              if (!canAddClip(movingClip, staticClips)) {
                valid = false;
                break;
              }
            }
            if (!valid) break;
          }
        }

        if (!valid) {
          return;
        }

        const additionsByTrack = new Map();
        candidateEntries.forEach((entry) => {
          if (!additionsByTrack.has(entry.targetTrackId)) {
            additionsByTrack.set(entry.targetTrackId, []);
          }
          additionsByTrack.get(entry.targetTrackId).push(entry.clip);
        });

        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map((candidateTrack) => {
            const remaining = candidateTrack.clips.filter((clip) => !activeClipIdSet.has(clip.id));
            const additions = additionsByTrack.get(candidateTrack.id) || [];
            return {
              ...candidateTrack,
              clips: [...remaining, ...additions],
            };
          }),
        }), activeClipIds.length > 1 ? 'Move clips' : 'Move clip');

        const clickedCandidate = candidateEntries.find((entry) => entry.clipId === dragState.clipId);
        if (clickedCandidate) {
          const row = trackRowByTrackId.get(clickedCandidate.targetTrackId);
          if (row) selectRow(row);
          setDragState((prev) => ({
            ...prev,
            trackId: clickedCandidate.targetTrackId,
            trackRowOffset: appliedRowOffset,
          }));
        }
        return;

      } else if (dragState.type === 'crop-start') {
        if (activeClipIds.length > 1) {
          const desiredDeltaMs = deltaMs;
          let minAllowedDelta = -Infinity;
          let maxAllowedDelta = Infinity;
          activeClipIds.forEach((clipId) => {
            const initial = initialByClipId[clipId];
            if (!initial) return;
            minAllowedDelta = Math.max(minAllowedDelta, -initial.cropStartMs, -initial.timelineStartMs);
            maxAllowedDelta = Math.min(
              maxAllowedDelta,
              initial.cropEndMs - MIN_CLIP_DURATION_MS - initial.cropStartMs
            );
          });
          const appliedDeltaMs = Math.max(minAllowedDelta, Math.min(maxAllowedDelta, desiredDeltaMs));
          updateProject((proj) => ({
            ...proj,
            tracks: proj.tracks.map((candidateTrack) => ({
              ...candidateTrack,
              clips: candidateTrack.clips.map((candidateClip) => {
                if (!activeClipIdSet.has(candidateClip.id)) return candidateClip;
                const initial = initialByClipId[candidateClip.id];
                if (!initial) return candidateClip;
                return {
                  ...candidateClip,
                  cropStartMs: initial.cropStartMs + appliedDeltaMs,
                  timelineStartMs: initial.timelineStartMs + appliedDeltaMs,
                };
              }),
            })),
          }), 'Crop clips start');
          return;
        }

        const proposedCropStartMs = dragState.initialCropStartMs + deltaMs;
        const constrainedCropStartMs = constrainCropStart(
          { ...currentClip, cropStartMs: dragState.initialCropStartMs },
          proposedCropStartMs,
          track.clips
        );
        const cropDelta = constrainedCropStartMs - dragState.initialCropStartMs;
        updates.cropStartMs = constrainedCropStartMs;
        updates.timelineStartMs = dragState.initialTimelineStartMs + cropDelta;

      } else if (dragState.type === 'crop-end') {
        if (activeClipIds.length > 1) {
          const desiredDeltaMs = deltaMs;
          let minAllowedDelta = -Infinity;
          let maxAllowedDelta = Infinity;
          activeClipIds.forEach((clipId) => {
            const initial = initialByClipId[clipId];
            if (!initial) return;
            minAllowedDelta = Math.max(
              minAllowedDelta,
              initial.cropStartMs + MIN_CLIP_DURATION_MS - initial.cropEndMs
            );
            maxAllowedDelta = Math.min(maxAllowedDelta, initial.sourceDurationMs - initial.cropEndMs);
          });
          const appliedDeltaMs = Math.max(minAllowedDelta, Math.min(maxAllowedDelta, desiredDeltaMs));
          updateProject((proj) => ({
            ...proj,
            tracks: proj.tracks.map((candidateTrack) => ({
              ...candidateTrack,
              clips: candidateTrack.clips.map((candidateClip) => {
                if (!activeClipIdSet.has(candidateClip.id)) return candidateClip;
                const initial = initialByClipId[candidateClip.id];
                if (!initial) return candidateClip;
                return {
                  ...candidateClip,
                  cropEndMs: initial.cropEndMs + appliedDeltaMs,
                };
              }),
            })),
          }), 'Crop clips end');
          return;
        }

        const proposedCropEndMs = dragState.initialCropEndMs + deltaMs;
        const constrainedCropEndMs = constrainCropEnd(
          { ...currentClip, cropEndMs: dragState.initialCropEndMs, sourceDurationMs: dragState.sourceDurationMs },
          proposedCropEndMs,
          track.clips
        );
        updates.cropEndMs = constrainedCropEndMs;

      } else if (dragState.type === 'gain') {
        if (deltaX !== 0 || deltaY !== 0) {
          rightClickDragRef.current = true;
        }
        const gainDragPixels = 300;
        const distance = Math.min(1, Math.abs(deltaY) / gainDragPixels);
        const shaped = distance * distance * distance;
        const deltaPosition = Math.sign(-deltaY) * shaped;
        const nextPosition = Math.max(
          0,
          Math.min(1, dragState.initialGainPosition + deltaPosition)
        );
        const nextGainDb = positionToClipGainDb(nextPosition);

        if (activeClipIds.length > 1) {
          const clickedInitial = initialByClipId[dragState.clipId]?.gainDb ?? dragState.initialGainDb;
          const desiredDeltaDb = nextGainDb - clickedInitial;
          let minAllowedDeltaDb = -Infinity;
          let maxAllowedDeltaDb = Infinity;
          activeClipIds.forEach((clipId) => {
            const initial = initialByClipId[clipId];
            if (!initial) return;
            minAllowedDeltaDb = Math.max(minAllowedDeltaDb, MIN_CLIP_GAIN_DB - initial.gainDb);
            maxAllowedDeltaDb = Math.min(maxAllowedDeltaDb, MAX_CLIP_GAIN_DB - initial.gainDb);
          });
          const appliedDeltaDb = Math.max(minAllowedDeltaDb, Math.min(maxAllowedDeltaDb, desiredDeltaDb));
          updateProject((proj) => ({
            ...proj,
            tracks: proj.tracks.map((candidateTrack) => ({
              ...candidateTrack,
              clips: candidateTrack.clips.map((candidateClip) => {
                if (!activeClipIdSet.has(candidateClip.id)) return candidateClip;
                const initial = initialByClipId[candidateClip.id];
                if (!initial) return candidateClip;
                const nextDb = Math.max(MIN_CLIP_GAIN_DB, Math.min(MAX_CLIP_GAIN_DB, initial.gainDb + appliedDeltaDb));
                return {
                  ...candidateClip,
                  gainDb: Math.abs(nextDb) < 0.1 ? 0 : nextDb,
                };
              }),
            })),
          }), 'Adjust clip gains');
          return;
        }

        const clippedDb = Math.max(MIN_CLIP_GAIN_DB, Math.min(MAX_CLIP_GAIN_DB, nextGainDb));
        updates.gainDb = Math.abs(clippedDb) < 0.1 ? 0 : clippedDb;
      }

      if (Object.keys(updates).length > 0) {
        onUpdateClip(dragState.trackId, dragState.clipId, updates);
      }
    };

    const handleMouseUp = () => {
      if (dragState.type === 'gain') {
        if (!rightClickDragRef.current) {
          const targetClipIds = dragState.activeClipIds?.length
            ? dragState.activeClipIds
            : [dragState.clipId];
          const targetClipIdSet = new Set(targetClipIds);
          const targetClips = [];
          project.tracks.forEach((candidateTrack) => {
            candidateTrack.clips.forEach((candidateClip) => {
              if (targetClipIdSet.has(candidateClip.id)) {
                targetClips.push(candidateClip);
              }
            });
          });
          const shouldMute = !targetClips.every((candidateClip) => candidateClip.muted);
          updateProject((proj) => ({
            ...proj,
            tracks: proj.tracks.map((candidateTrack) => ({
              ...candidateTrack,
              clips: candidateTrack.clips.map((candidateClip) => (
                targetClipIdSet.has(candidateClip.id)
                  ? { ...candidateClip, muted: shouldMute }
                  : candidateClip
              )),
            })),
          }), shouldMute ? 'Mute clips' : 'Unmute clips');
        }
        rightClickDragRef.current = false;
      }
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, pixelsPerMs, onUpdateClip, project.tracks, updateProject, timelineRows]);

  useEffect(() => {
    if (!timelineSelectionState) return;

    const handleMouseMove = (e) => {
      const current = timelineSelectionRef.current;
      if (!current) return;
      const point = getTimelineContentPoint(e.clientX, e.clientY);
      if (!point) return;

      const movedNow = (
        e.clientX !== current.startClientX ||
        e.clientY !== current.startClientY
      );
      const next = {
        ...current,
        currentClientX: e.clientX,
        currentClientY: e.clientY,
        currentX: point.x,
        currentY: point.y,
        moved: current.moved || movedNow,
      };
      if (next.moved) {
        timelineSelectionSuppressClickRef.current = true;
      }
      timelineSelectionRef.current = next;
      setTimelineSelectionState(next);

      if (!next.moved) return;
      const selectionRect = getSelectionRect(next);
      const selectedIds = getClipIdsInSelectionRect(selectionRect);
      setSelectedClipIds(selectedIds);
      setSelectedClipHistory(selectedIds);
      setSelectedClipId(selectedIds[selectedIds.length - 1] || null);
    };

    const handleMouseUp = (e) => {
      const current = timelineSelectionRef.current;
      if (!current) return;

      const noMovement = (
        !current.moved &&
        e.clientX === current.startClientX &&
        e.clientY === current.startClientY
      );

      if (noMovement) {
        const point = getTimelineContentPoint(e.clientX, e.clientY);
        if (point) {
          const timeMs = point.x / pixelsPerMs;
          if (timeMs >= 0 && timeMs <= (projectDurationMs || minZoomDurationMs)) {
            onSeek(timeMs);
          }
        }
        clearSelectedClips();
      } else {
        timelineSelectionSuppressClickRef.current = true;
      }

      timelineSelectionRef.current = null;
      setTimelineSelectionState(null);
      window.requestAnimationFrame(() => {
        timelineSelectionSuppressClickRef.current = false;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    timelineSelectionState,
    timelineRows,
    pixelsPerMs,
    projectDurationMs,
    minZoomDurationMs,
    onSeek,
  ]);

  useEffect(() => {
    if (selectedRowKind === 'group') {
      clearSelectedClips();
    }
  }, [selectedRowKind]);

  useEffect(() => {
    const validClipIds = new Set();
    project.tracks.forEach((track) => {
      track.clips.forEach((clip) => validClipIds.add(clip.id));
    });

    const nextSelected = selectedClipIds.filter((id) => validClipIds.has(id));
    const nextHistory = selectedClipHistory.filter((id) => validClipIds.has(id));

    if (nextSelected.length !== selectedClipIds.length) {
      setSelectedClipIds(nextSelected);
    }
    if (nextHistory.length !== selectedClipHistory.length) {
      setSelectedClipHistory(nextHistory);
    }

    const fallbackSelectedClipId = getLastSelectedFromHistory(nextSelected, nextHistory);
    if (selectedClipId && !validClipIds.has(selectedClipId)) {
      setSelectedClipId(fallbackSelectedClipId);
      return;
    }
    if (selectedClipId && !nextSelected.includes(selectedClipId)) {
      setSelectedClipId(fallbackSelectedClipId);
    }
  }, [selectedClipId, selectedClipIds, selectedClipHistory, project.tracks]);

  useEffect(() => {
    if (!shortcutsEnabled && !deleteClipShortcutEnabled) return;

    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const hasTrackSelection = selectedRowKind !== 'group' && Boolean(selectedTrackId);
      const selectedTrack = hasTrackSelection ? project.tracks.find(t => t.id === selectedTrackId) : null;
      const selectedEntries = getSelectedClipEntries(selectedClipIds);
      const hasSelectedClips = selectedEntries.length > 0;
      const focusedSelectedEntry = selectedClipId
        ? selectedEntries.find((entry) => entry.clip.id === selectedClipId)
        : null;
      const selectedClip = focusedSelectedEntry?.clip
        || (selectedTrack ? selectedTrack.clips.find(c => c.id === selectedClipId) : null);

      if (deleteClipShortcutEnabled && (e.code === 'Delete' || e.code === 'Backspace') && hasSelectedClips) {
        e.preventDefault();
        const selectedIdSet = new Set(selectedClipIds);
        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map((candidateTrack) => ({
            ...candidateTrack,
            clips: candidateTrack.clips.filter((candidateClip) => !selectedIdSet.has(candidateClip.id)),
          })),
        }), 'Delete clips');
        clearSelectedClips();
        return;
      }

      if (deleteClipShortcutEnabled && (e.code === 'Delete' || e.code === 'Backspace') && !hasSelectedClips && hasTrackSelection) {
        e.preventDefault();
        onDeleteTrackShortcut?.(selectedTrackId);
        return;
      }

      if (e.code === 'KeyT' && isPrimaryModifierPressed(e) && hasSelectedClips) {
        e.preventDefault();
        const selectedIdSet = new Set(selectedClipIds);
        const rightClipIds = [];

        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map((candidateTrack) => ({
            ...candidateTrack,
            clips: candidateTrack.clips.flatMap((candidateClip) => {
              if (!selectedIdSet.has(candidateClip.id)) return [candidateClip];
              const clipStartMs = candidateClip.timelineStartMs;
              const clipEndMs = candidateClip.timelineStartMs + getClipDurationMs(candidateClip);
              if (currentTimeMs <= clipStartMs || currentTimeMs >= clipEndMs) return [candidateClip];

              const splitOffsetMs = currentTimeMs - clipStartMs;
              const splitCropMs = candidateClip.cropStartMs + splitOffsetMs;
              const leftClip = {
                ...candidateClip,
                id: crypto.randomUUID(),
                timelineStartMs: clipStartMs,
                cropStartMs: candidateClip.cropStartMs,
                cropEndMs: splitCropMs,
              };
              const rightClip = {
                ...candidateClip,
                id: crypto.randomUUID(),
                timelineStartMs: currentTimeMs,
                cropStartMs: splitCropMs,
                cropEndMs: candidateClip.cropEndMs,
              };
              rightClipIds.push(rightClip.id);
              return [leftClip, rightClip];
            }),
          })),
        }), 'Split clips');

        if (rightClipIds.length > 0) {
          setSelectedClipIds(rightClipIds);
          setSelectedClipHistory(rightClipIds);
          setSelectedClipId(rightClipIds[rightClipIds.length - 1]);
        }
        return;
      }

      if (e.code === 'KeyM' && hasTrackSelection) {
        e.preventDefault();
        const track = project.tracks.find(t => t.id === selectedTrackId);
        if (!track) return;
        onSelectTrack(selectedTrackId);
        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map(t =>
            t.id === selectedTrackId ? { ...t, muted: !t.muted } : t
          ),
        }), 'Toggle mute');
        return;
      }

      if (e.code === 'KeyS' && hasTrackSelection) {
        e.preventDefault();
        const track = project.tracks.find(t => t.id === selectedTrackId);
        if (!track) return;
        onSelectTrack(selectedTrackId);
        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map(t =>
            t.id === selectedTrackId ? { ...t, soloed: !t.soloed } : t
          ),
        }), 'Toggle solo');
        return;
      }

      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        if (!timelineRows.length) return;
        const currentIndex = selectedNodeId
          ? timelineRows.findIndex((row) => row.nodeId === selectedNodeId)
          : -1;
        const nextIndex =
          currentIndex === -1
            ? 0
            : Math.min(
                timelineRows.length - 1,
                Math.max(0, currentIndex + (e.code === 'ArrowDown' ? 1 : -1))
              );
        const nextRow = timelineRows[nextIndex];
        if (nextRow) {
          selectRow(nextRow);
          clearSelectedClips();
        }
        return;
      }

      if (!shortcutsEnabled) return;

      if (e.code === 'KeyX' && isPrimaryModifierPressed(e) && (hasSelectedClips || selectedClip)) {
        e.preventDefault();
        const clipIdsToCut = hasSelectedClips
          ? selectedClipIds
          : (selectedClip ? [selectedClip.id] : []);
        const payload = buildClipboardPayload(clipIdsToCut);
        if (!payload) return;
        setClipboardClip(payload);

        const cutIdSet = new Set(clipIdsToCut);
        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map((candidateTrack) => ({
            ...candidateTrack,
            clips: candidateTrack.clips.filter((candidateClip) => !cutIdSet.has(candidateClip.id)),
          })),
        }), 'Cut clips');
        clearSelectedClips();
        return;
      }

      if (e.code === 'KeyC' && isPrimaryModifierPressed(e) && (hasSelectedClips || selectedClip)) {
        e.preventDefault();
        const clipIdsToCopy = hasSelectedClips
          ? selectedClipIds
          : (selectedClip ? [selectedClip.id] : []);
        const payload = buildClipboardPayload(clipIdsToCopy);
        if (payload) {
          setClipboardClip(payload);
        }
      }

      if (e.code === 'KeyV' && isPrimaryModifierPressed(e) && clipboardClip && hasTrackSelection) {
        e.preventDefault();
        const track = project.tracks.find(t => t.id === selectedTrackId);
        if (!track) return;

        if (clipboardClip.type === 'single' || clipboardClip.blobId) {
          const singleClip = clipboardClip.type === 'single' ? clipboardClip.clip : clipboardClip;
          const newClip = {
            ...singleClip,
            id: crypto.randomUUID(),
            timelineStartMs: currentTimeMs,
          };
          const safePosition = findSafePosition(newClip, track.clips, currentTimeMs);
          if (safePosition !== null) {
            newClip.timelineStartMs = safePosition;
            onUpdateClip(selectedTrackId, null, newClip, 'add');
            setSelectedClipIds([newClip.id]);
            setSelectedClipHistory([newClip.id]);
            setSelectedClipId(newClip.id);
          } else {
            playErrorBeep();
            console.warn('Cannot paste: no space available on track');
          }
          return;
        }

        const anchorTrackIndex = visibleTrackIndexByTrackId.get(selectedTrackId);
        if (anchorTrackIndex === undefined || !Array.isArray(clipboardClip.items)) {
          playErrorBeep();
          return;
        }

        const candidatesByTrack = new Map();
        const pastedIds = [];
        let valid = true;
        for (const item of clipboardClip.items) {
          const targetTrackIndex = anchorTrackIndex + item.trackOffset;
          const targetTrackId = visibleTrackIdByRowIndex.get(targetTrackIndex);
          const targetTrack = project.tracks.find((candidateTrack) => candidateTrack.id === targetTrackId);
          if (!targetTrack) {
            valid = false;
            break;
          }
          const timelineStartMs = currentTimeMs + item.startOffsetMs;
          if (timelineStartMs < 0) {
            valid = false;
            break;
          }
          const newClip = {
            ...item.clip,
            id: crypto.randomUUID(),
            timelineStartMs,
          };
          pastedIds.push(newClip.id);
          if (!candidatesByTrack.has(targetTrack.id)) {
            candidatesByTrack.set(targetTrack.id, []);
          }
          candidatesByTrack.get(targetTrack.id).push(newClip);
        }

        if (!valid) {
          playErrorBeep();
          return;
        }

        for (const [trackId, newClips] of candidatesByTrack.entries()) {
          const targetTrack = project.tracks.find((candidateTrack) => candidateTrack.id === trackId);
          if (!targetTrack) {
            valid = false;
            break;
          }
          const simulated = [...targetTrack.clips];
          for (const newClip of newClips) {
            if (!canAddClip(newClip, simulated)) {
              valid = false;
              break;
            }
            simulated.push(newClip);
          }
          if (!valid) break;
        }

        if (!valid) {
          playErrorBeep();
          return;
        }

        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map((candidateTrack) => {
            const additions = candidatesByTrack.get(candidateTrack.id) || [];
            if (!additions.length) return candidateTrack;
            return {
              ...candidateTrack,
              clips: [...candidateTrack.clips, ...additions],
            };
          }),
        }), 'Paste clips');
        setSelectedClipIds(pastedIds);
        setSelectedClipHistory(pastedIds);
        setSelectedClipId(pastedIds[pastedIds.length - 1] || null);
        return;
      }

      if (e.code === 'KeyD' && isPrimaryModifierPressed(e) && (hasSelectedClips || selectedClip)) {
        e.preventDefault();
        const entries = hasSelectedClips
          ? selectedEntries
          : (selectedClip ? [{ trackId: selectedTrackId, clip: selectedClip }] : []);
        if (!entries.length) return;

        const duplicatesByTrack = new Map();
        const duplicateIds = [];
        let valid = true;
        entries.forEach((entry) => {
          const durationMs = getClipDurationMs(entry.clip);
          const duplicate = {
            ...entry.clip,
            id: crypto.randomUUID(),
            timelineStartMs: entry.clip.timelineStartMs + durationMs,
          };
          duplicateIds.push(duplicate.id);
          if (!duplicatesByTrack.has(entry.trackId)) {
            duplicatesByTrack.set(entry.trackId, []);
          }
          duplicatesByTrack.get(entry.trackId).push(duplicate);
        });

        for (const [trackId, duplicates] of duplicatesByTrack.entries()) {
          const targetTrack = project.tracks.find((candidateTrack) => candidateTrack.id === trackId);
          if (!targetTrack) {
            valid = false;
            break;
          }
          const simulated = [...targetTrack.clips];
          for (const duplicate of duplicates) {
            if (!canAddClip(duplicate, simulated)) {
              valid = false;
              break;
            }
            simulated.push(duplicate);
          }
          if (!valid) break;
        }

        if (!valid) {
          playErrorBeep();
          return;
        }

        updateProject((proj) => ({
          ...proj,
          tracks: proj.tracks.map((candidateTrack) => {
            const additions = duplicatesByTrack.get(candidateTrack.id) || [];
            if (!additions.length) return candidateTrack;
            return {
              ...candidateTrack,
              clips: [...candidateTrack.clips, ...additions],
            };
          }),
        }), 'Duplicate clips');
        setSelectedClipIds(duplicateIds);
        setSelectedClipHistory(duplicateIds);
        setSelectedClipId(duplicateIds[duplicateIds.length - 1] || null);
        return;
      }

    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    shortcutsEnabled,
    deleteClipShortcutEnabled,
    selectedClipId,
    selectedClipIds,
    selectedTrackId,
    selectedNodeId,
    selectedRowKind,
    clipboardClip,
    currentTimeMs,
    project.tracks,
    onUpdateClip,
    onSelectTrack,
    onDeleteTrackShortcut,
    updateProject,
    timelineRows,
    visibleTrackIndexByTrackId,
    visibleTrackIdByRowIndex,
    getSelectedClipEntries,
    buildClipboardPayload,
    clearSelectedClips,
    getClipDurationMs,
    playErrorBeep,
  ]);

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
      // Primary modifier + wheel = Zoom in/out
      if (isPrimaryModifierPressed(e)) {
        e.preventDefault();
        const delta = e.deltaY * 0.001; // Inverted: scroll up = zoom in, scroll down = zoom out
        const newSliderValue = Math.max(0, Math.min(1, zoomSliderValue + delta));
        
        if (newSliderValue >= 0.99) {
          applyZoomDuration(null);
        } else {
          const newDuration = convertSliderToDuration(newSliderValue);
          if (newDuration >= minZoomDurationMs * 0.95) {
            applyZoomDuration(null);
          } else {
            applyZoomDuration(newDuration);
          }
        }
      }
      // Shift + Wheel = Horizontal scroll
      else if (e.shiftKey) {
        const scrollElement = tracksScrollRef.current;
        if (scrollElement && scrollElement.scrollWidth > scrollElement.clientWidth) {
          e.preventDefault();
          scrollElement.scrollLeft += e.deltaY * 3;
        }
      }
      // Trackpad horizontal scroll
      else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const scrollElement = tracksScrollRef.current;
        if (scrollElement && scrollElement.scrollWidth > scrollElement.clientWidth) {
          e.preventDefault();
          scrollElement.scrollLeft += e.deltaX;
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
    applyZoomDuration(newDuration);
  };
  
  const handleZoomOut = () => {
    const newSliderValue = Math.min(1, zoomSliderValue + 0.1);
    if (newSliderValue >= 0.99) {
      applyZoomDuration(null);
    } else {
      const newDuration = sliderValueToDuration(newSliderValue);
      if (newDuration >= minZoomDurationMs * 0.95) {
        applyZoomDuration(null);
      } else {
        applyZoomDuration(newDuration);
      }
    }
  };
  
  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    if (value >= 0.99) {
      applyZoomDuration(null);
    } else {
      const newDuration = sliderValueToDuration(value);
      if (newDuration >= minZoomDurationMs * 0.95) {
        applyZoomDuration(null);
      } else {
        applyZoomDuration(newDuration);
      }
    }
  };

  const zoomOverlay = (
    <div className="bg-gray-800/90 border border-gray-700 rounded-md px-2 py-2 shadow-lg flex items-center">
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
  );

  const header = (
    <div className="relative flex flex-col overflow-visible w-full min-w-0">
      {/* Timeline Ruler */}
      <div className="bg-gray-850 flex overflow-visible" style={{ height: '24px' }}>
        <div 
          ref={rulerScrollRef}
          className="flex-1 overflow-x-scroll overflow-y-visible ruler-scrollbar-hidden w-full min-w-0"
          onScroll={(e) => {
            const newScrollLeft = e.target.scrollLeft;
            if (tracksScrollRef.current && tracksScrollRef.current.scrollLeft !== newScrollLeft) {
              tracksScrollRef.current.scrollLeft = newScrollLeft;
            }
            setScrollLeft(newScrollLeft);
          }}
        >
          <div 
            style={{ width: `${timelineWidthPx}px`, height: '24px' }} 
            className="relative cursor-pointer"
            onMouseDown={handleRulerMouseDown}
          >
            <div className="absolute left-0 right-0 top-0 h-[23px] overflow-hidden">
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
                  style={{ left: `${timeMs * pixelsPerMs}px`, height: '23px' }}
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
            </div>
            <div className="absolute left-0 right-0 bottom-0 h-px bg-gray-700 pointer-events-none" />
            {/* Playhead (ruler) */}
            <div
              className="absolute top-0 w-0.5 bg-red-500 pointer-events-none z-40"
              style={{
                left: `${currentTimeMs * pixelsPerMs}px`,
                height: '24px',
              }}
            />

            {/* Loop start marker */}
            {(() => {
              if (rulerDragState?.isDragging && rulerDragState.currentStartMs !== undefined) {
                return (
                  <div
                    className="absolute top-0 bottom-px w-1 pointer-events-none bg-yellow-500"
                    style={{
                      left: `${rulerDragState.currentStartMs * pixelsPerMs}px`,
                    }}
                  />
                );
              }
              
            if (project.loop.startMs !== undefined && project.loop.endMs !== undefined) {
              const displayStartMs = loopMarkerDragState?.currentStartMs 
                ?? (rulerDragState?.mode === 'move' ? rulerDragState.currentStartMs : undefined)
                ?? project.loop.startMs;
              
              return (
                <div
                  className={`absolute top-0 bottom-px w-1 cursor-ew-resize ${
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
              if (rulerDragState?.isDragging && rulerDragState.currentEndMs !== undefined) {
                return (
                  <div
                    className="absolute top-0 bottom-px w-1 pointer-events-none bg-yellow-500"
                    style={{
                      left: `${rulerDragState.currentEndMs * pixelsPerMs}px`,
                    }}
                  />
                );
              }
              
            if (project.loop.startMs !== undefined && project.loop.endMs !== undefined) {
              const displayEndMs = loopMarkerDragState?.currentEndMs 
                ?? (rulerDragState?.mode === 'move' ? rulerDragState.currentEndMs : undefined)
                ?? project.loop.endMs;
              
              return (
                <div
                  className={`absolute top-0 bottom-px w-1 cursor-ew-resize ${
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
    </div>
  );

  const tracks = (
    <div 
      ref={timelineRef}
      className={`${sharedVerticalScroll ? 'relative' : 'flex-1 overflow-hidden relative'} bg-gray-900 w-full min-w-0`}
      onMouseDown={handleTimelineMouseDown}
      onContextMenu={handleContextMenu}
    >
      <div 
        ref={(el) => {
          tracksScrollRef.current = el;
          if (internalScrollRef) {
            internalScrollRef.current = el;
          }
        }}
        className={`${sharedVerticalScroll ? 'overflow-x-auto overflow-y-hidden' : 'absolute inset-0 overflow-auto'} scrollbar-hidden w-full min-w-0`}
        onScroll={(e) => {
          const newScrollLeft = e.target.scrollLeft;
          setScrollLeft(newScrollLeft);
          e.target.style.setProperty('--scroll-left', `${newScrollLeft}px`);
          if (rulerScrollRef.current) {
            rulerScrollRef.current.scrollLeft = newScrollLeft;
          }
          if (!sharedVerticalScroll && onVerticalScroll) {
            onVerticalScroll(e.target.scrollTop);
          }
        }}
        style={{ '--scroll-left': '0px' }}
      >
        <div style={{ width: `${timelineWidthPx}px`, height: `${totalTimelineHeight}px`, position: 'relative' }}>
              {/* Playhead (tracks) */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-30"
                style={{
                  left: `${currentTimeMs * pixelsPerMs}px`,
                }}
              />
              {timelineSelectionState?.moved && (() => {
                const selectionRect = getSelectionRect(timelineSelectionState);
                return (
                  <div
                    className="absolute pointer-events-none z-40 border border-blue-400 bg-blue-500/20"
                    style={{
                      left: `${selectionRect.left}px`,
                      top: `${selectionRect.top}px`,
                      width: `${selectionRect.width}px`,
                      height: `${selectionRect.height}px`,
                    }}
                  />
                );
              })()}
              {timelineRows.map((row, rowIndex) => {
                const trackY = getTrackYPosition(timelineRows, rowIndex);
                if (row.kind === 'group') {
                  const groupPreview = groupTimelinePreviewByNodeId.get(row.nodeId);
                  const rowPadding = 8;
                  const rowInternalHeight = Math.max(0, row.height - (rowPadding * 2));
                  return (
                    <div
                      key={row.nodeId}
                      className="border-b border-gray-700 relative bg-gray-900/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (timelineSelectionSuppressClickRef.current) return;
                        selectRow(row);
                        clearSelectedClips();
                      }}
                      style={{
                        height: `${row.height}px`,
                        top: `${trackY}px`,
                        position: 'absolute',
                        width: '100%',
                      }}
                    >
                      {groupPreview?.activeSegments?.map((segment, idx) => {
                        const leftPx = segment.startMs * pixelsPerMs;
                        const widthPx = Math.max(0, (segment.endMs - segment.startMs) * pixelsPerMs);
                        return (
                          <div
                            key={`group-segment-${row.nodeId}-${idx}`}
                            className="absolute rounded pointer-events-none"
                            style={{
                              left: `${leftPx}px`,
                              top: `${rowPadding}px`,
                              width: `${widthPx}px`,
                              height: `${rowInternalHeight}px`,
                              backgroundColor: 'rgba(79, 142, 247, 0.18)',
                            }}
                          />
                        );
                      })}

                      {groupPreview?.clips?.map((clip) => {
                        const clipLeftPx = clip.startMs * pixelsPerMs;
                        const clipWidthPx = clip.durationMs * pixelsPerMs;
                        const audioBuffer = audioManager.mediaCache.get(clip.blobId);
                        return (
                          <div
                            key={`group-clip-${row.nodeId}-${clip.key}`}
                            className="absolute rounded overflow-hidden pointer-events-none"
                            style={{
                              left: `${clipLeftPx}px`,
                              top: `${rowPadding}px`,
                              width: `${clipWidthPx}px`,
                              height: `${rowInternalHeight}px`,
                              backgroundColor: 'transparent',
                            }}
                          >
                            {audioBuffer && (
                              <Waveform
                                audioBuffer={audioBuffer}
                                clipId={`group:${row.nodeId}:${clip.key}`}
                                cropStartMs={clip.cropStartMs}
                                cropEndMs={clip.cropEndMs}
                                sourceDurationMs={clip.sourceDurationMs}
                                height={rowInternalHeight}
                                color="rgba(123, 173, 255, 0.55)"
                                globalPeakAmplitude={globalPeakAmplitude}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                const track = row.track;
                const trackHeight = row.height;
                const trackState = trackStateById.get(track.id);
                const hasAnyAudibleClip = track.clips.some((clip) => !clip.muted);
                const trackInactive = Boolean(
                  !trackState?.audible || (track.clips.length > 0 && !hasAnyAudibleClip)
                );

                return (
                  <div
                    key={track.id}
                    className={`border-b border-gray-700 relative ${trackInactive ? 'bg-gray-850' : ''}`}
                    style={{
                      height: `${trackHeight}px`,
                      top: `${trackY}px`,
                      position: 'absolute',
                      width: '100%'
                    }}
                  >
                    {track.clips.map(clip => {
                      const clipDurationMs = clip.cropEndMs - clip.cropStartMs;
                      const clipWidthPx = clipDurationMs * pixelsPerMs;
                      const clipLeftPx = clip.timelineStartMs * pixelsPerMs;
                      const audioBuffer = audioManager.mediaCache.get(clip.blobId);
                      const clipPadding = 8;
                      const clipInternalHeight = trackHeight - (clipPadding * 2);
                      const labelPadding = 8;
                      const gainLabelText = `${clip.gainDb > 0 ? '+' : ''}${clip.gainDb.toFixed(1)} dB`;
                      const estimatedLabelWidth = gainLabelText.length * 7;
                      const clipRightPx = clipLeftPx + clipWidthPx;
                      const visibleLeftPx = Math.max(clipLeftPx, scrollLeft);
                      const visibleRightPx = Math.min(clipRightPx, scrollLeft + containerWidth);
                      const visibleWidthPx = Math.max(0, visibleRightPx - visibleLeftPx);
                      const labelFits = visibleWidthPx >= estimatedLabelWidth + (labelPadding * 2);

                      return (
                        <div
                          key={clip.id}
                          data-clip-id={clip.id}
                          className={`absolute rounded overflow-hidden ${
                            selectedClipIds.includes(clip.id)
                              ? 'ring-2 ring-blue-500'
                              : 'hover:ring-2 hover:ring-gray-500'
                          }`}
                          style={{
                            left: `${clipLeftPx}px`,
                            top: `${clipPadding}px`,
                            width: `${clipWidthPx}px`,
                            height: `${clipInternalHeight}px`,
                            backgroundColor: 'rgba(79, 142, 247, 0.3)',
                            '--clip-left': `${clipLeftPx}px`,
                            '--clip-width': `${clipWidthPx}px`,
                          }}
                          onClick={(e) => handleClipClick(e, clip.id, track.id)}
                          onMouseDown={(e) => handleClipMouseDown(e, clip, track)}
                          onContextMenu={handleClipRightClick}
                        >
                          <div
                            className="absolute inset-0 cursor-move"
                            style={{
                              pointerEvents: 'none',
                              zIndex: 1,
                            }}
                          />
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

                          {labelFits && (clip.muted || Math.abs(clip.gainDb) >= 0.1) && (
                            <div className="absolute top-1 left-0 right-0 text-xs font-medium pointer-events-none">
                              <span
                                className="absolute text-yellow-400 whitespace-nowrap overflow-hidden text-ellipsis inline-flex items-center"
                                style={{
                                  left: `clamp(${labelPadding}px, calc(var(--scroll-left) - var(--clip-left) + ${labelPadding}px), calc(var(--clip-width) - ${labelPadding}px))`,
                                  maxWidth: `calc(var(--clip-width) - ${labelPadding * 2}px)`,
                                }}
                              >
                                {clip.muted ? <VolumeX size={12} /> : Math.abs(clip.gainDb) >= 0.1 ? gainLabelText : null}
                              </span>
                            </div>
                          )}

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
                        </div>
                      );
                    })}

                    {isRecording && recordingSegments && recordingSegments.length > 0 && selectedTrackId === track.id && (() => {
                      const currentSegment = recordingSegments[recordingSegments.length - 1];
                      const recordingStartMs = currentSegment.startTimeMs;
                      const segmentOffsetMs = Math.max(0, Number(currentSegment.offsetMs) || 0);
                      const effectiveEndMs = Math.max(recordingStartMs, currentTimeMs - segmentOffsetMs);
                      const recordingDurationMs = Math.max(0, effectiveEndMs - recordingStartMs);
                      const recordingWidthPx = recordingDurationMs * pixelsPerMs;
                      const recordingLeftPx = recordingStartMs * pixelsPerMs;
                      const clipPadding = 8;
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
                          <div className="absolute top-1 left-2 text-xs text-red-500 font-bold pointer-events-none flex items-center gap-1">
                            <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                            REC {recordingSegments.length > 1 && `(${recordingSegments.length})`}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
    </div>
  );

  if (typeof children === 'function') {
    return children({ header, tracks, zoomOverlay });
  }

  return (
    <div className={`${sharedVerticalScroll ? '' : 'flex-1'} flex flex-col bg-gray-900 ${sharedVerticalScroll ? '' : 'overflow-hidden'} relative`} style={{ minWidth: 0 }}>
      <div className="absolute top-9 right-3 z-50">{zoomOverlay}</div>
      {header}
      {tracks}
    </div>
  );
}

export default Timeline;
