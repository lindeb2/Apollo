import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Upload, Play, Pause, Square, Volume2, Circle, Download, SkipBack, SkipForward, Settings } from 'lucide-react';
import useStore from '../store/useStore';
import { audioManager } from '../lib/audioManager';
import { recordingManager } from '../lib/recordingManager';
import { storeMediaBlob, getMediaBlob } from '../lib/db';
import { createTrack, createClip, normalizeExportSettings, TRACK_ROLES } from '../types/project';
import FileImport from './FileImport';
import TrackList from './TrackList';
import Timeline from './Timeline';
import ExportDialog from './ExportDialog';
import { dbToVolume, volumeToDb } from '../utils/audio';
import { AUTO_PAN_STRATEGIES, applyChoirAutoPanToProject } from '../utils/choirAutoPan';
import useKeyboardShortcuts from '../utils/useKeyboardShortcuts';
import { processRecordingOverwrites } from '../utils/clipCollision';
import { normalizeProjectName } from '../utils/naming';
import {
  attachTrackNode,
  createGroupNode,
  deleteGroupPromoteChildren,
  getEffectiveTrackMix,
  getTrackNodeByTrackId,
  updateGroupNode,
  getVisibleTimelineRows,
  getVisibleTrackIds,
  moveTrackTreeNode,
  normalizeTrackTree,
  removeTrackNode,
  renameGroupNode,
  reorderTracksByTree,
  toggleGroupCollapsed,
} from '../utils/trackTree';

function Editor({ onBackToDashboard }) {
  const {
    project,
    updateProject,
    isPlaying,
    isRecording,
    currentTimeMs,
    selectedTrackId,
    play,
    pause,
    stop,
    setCurrentTime,
    selectTrack,
    updateClip,
    startRecording,
    stopRecording,
    undo,
    redo,
  } = useStore();

  const [showFileImport, setShowFileImport] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioInputs, setAudioInputs] = useState([]);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [audioSettings, setAudioSettings] = useState({
    inputDeviceId: '',
    outputDeviceId: '',
    recordingOffsetMs: 0,
  });
  const [masterVolume, setMasterVolume] = useState(100);
  const [masterEditTooltip, setMasterEditTooltip] = useState(null);
  const [masterDragTooltip, setMasterDragTooltip] = useState(null);
  const [trackListContextMenu, setTrackListContextMenu] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedRowKind, setSelectedRowKind] = useState(null);
  const masterDragRef = useRef(null);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [mediaMap, setMediaMap] = useState(new Map());
  const [recordingSegments, setRecordingSegments] = useState([]);
  const [recordingOffsetMs, setRecordingOffsetMs] = useState(0);
  const recordingOriginalClipsRef = useRef(null);
  const previousTimeRef = useRef(0);
  const recordingStartTimeRef = useRef(0);
  const projectRef = useRef(project);
  const hasHydratedSettingsRef = useRef(false);
  const isHandlingLoopWrapRef = useRef(false);
  
  // Refs for scroll synchronization
  const trackListScrollRef = useRef(null);
  const timelineScrollRef = useRef(null);
  const isTrackListScrollingRef = useRef(false);
  const isTimelineScrollingRef = useRef(false);

  // Keep project ref updated
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    if (!project) return;
    if (typeof project.masterVolume === 'number' && project.masterVolume !== masterVolume) {
      setMasterVolume(project.masterVolume);
    }
  }, [project?.masterVolume, masterVolume, project]);

  useEffect(() => {
    if (project) {
      setProjectNameDraft(project.projectName);
    }
  }, [project?.projectName]);

  useEffect(() => {
    const saved = localStorage.getItem('choirmaster.settings');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      setAudioSettings((prev) => ({
        ...prev,
        ...parsed,
        recordingOffsetMs:
          typeof parsed.recordingOffsetMs === 'number'
            ? parsed.recordingOffsetMs
            : prev.recordingOffsetMs,
      }));
    } catch {
      // Ignore invalid settings
    }
  }, []);

  useEffect(() => {
    if (!hasHydratedSettingsRef.current) {
      hasHydratedSettingsRef.current = true;
    } else {
      let existing = {};
      try {
        existing = JSON.parse(localStorage.getItem('choirmaster.settings') || '{}');
      } catch {
        existing = {};
      }
      localStorage.setItem('choirmaster.settings', JSON.stringify({
        ...existing,
        ...audioSettings,
      }));
    }
    setRecordingOffsetMs(Math.max(0, Number(audioSettings.recordingOffsetMs) || 0));
  }, [audioSettings]);

  const refreshAudioDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let devices = await navigator.mediaDevices.enumerateDevices();
    const hasLabels = devices.some((device) => device.label);
    if (!hasLabels) {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch {
        // Keep unlabeled devices
      }
    }
    setAudioInputs(devices.filter((device) => device.kind === 'audioinput'));
    setAudioOutputs(devices.filter((device) => device.kind === 'audiooutput'));
  };

  useEffect(() => {
    if (!project) return;
    const visibleTrackIds = getVisibleTrackIds(project);
    if (!project.tracks || project.tracks.length === 0 || visibleTrackIds.length === 0) {
      if (selectedTrackId !== null) {
        selectTrack(null);
      }
      return;
    }

    if (selectedRowKind === 'group' && selectedNodeId) {
      const visibleRows = getVisibleTimelineRows(project);
      const groupStillVisible = visibleRows.some((row) => row.kind === 'group' && row.nodeId === selectedNodeId);
      if (groupStillVisible) {
        return;
      }
    }

    const hasSelected = visibleTrackIds.includes(selectedTrackId);
    if (!hasSelected) {
      selectTrack(visibleTrackIds[0]);
    }
  }, [project, selectedTrackId, selectedRowKind, selectedNodeId, selectTrack]);

  // Initialize audio context on mount
  useEffect(() => {
    audioManager.init();
    
    if (project && project.tracks) {
      loadProjectAudio();
    }
    
    return () => {
      audioManager.stop();
    };
  }, [project?.projectId]);

  const loadProjectAudio = async () => {
    if (!project) return;

    const blobIds = new Set();
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        blobIds.add(clip.blobId);
      }
    }

    const newMediaMap = new Map();
    for (const blobId of blobIds) {
      if (!audioManager.mediaCache.has(blobId)) {
        try {
          const media = await getMediaBlob(blobId);
          const audioBuffer = await audioManager.loadAudioBuffer(blobId, media.blob);
          newMediaMap.set(blobId, media);
          console.log(`Loaded audio buffer for ${blobId}`);
        } catch (error) {
          console.error(`Failed to load audio buffer ${blobId}:`, error);
        }
      } else {
        try {
          const media = await getMediaBlob(blobId);
          newMediaMap.set(blobId, media);
        } catch (error) {
          console.error(`Failed to load media data ${blobId}:`, error);
        }
      }
    }
    setMediaMap(newMediaMap);
  };

  useEffect(() => {
    audioManager.setMasterVolume(masterVolume);
  }, [masterVolume]);

  useEffect(() => {
    const handleMove = (e) => {
      if (!masterDragRef.current) return;
      const { startX, startValue, width, moved } = masterDragRef.current;
      const deltaX = e.clientX - startX;
      if (!moved && Math.abs(deltaX) < 2) return;
      masterDragRef.current.moved = true;
      if (masterEditTooltip) setMasterEditTooltip(null);
      const next = Math.min(100, Math.max(0, startValue + (deltaX / width) * 100));
      applyMasterVolume(next);
      setMasterDragTooltip(next);
    };
    const handleUp = () => {
      masterDragRef.current = null;
      setMasterDragTooltip(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  useEffect(() => {
    let interval = null;
    let isCancelled = false;
    let loopRestartTimeout = null;
    
    if (isPlaying) {
      // Reset loop wrap flag when starting playback
      isHandlingLoopWrapRef.current = false;
      
      // Stop existing audio and start new playback
      const startPlayback = async () => {
        if (isHandlingLoopWrapRef.current) return;
        
        audioManager.stop();
        if (!isCancelled) {
          await audioManager.play(project, currentTimeMs);
        }
      };
      
      startPlayback();
      
      interval = setInterval(() => {
        if (isHandlingLoopWrapRef.current) {
          return;
        }
        
        const newTime = audioManager.getCurrentTime();
        if (newTime !== null) {
          const previousTime = previousTimeRef.current;
          const currentProject = projectRef.current;
          
          // Only trigger loop wrap if we're crossing the boundary
          if (currentProject.loop.enabled && 
              previousTime < currentProject.loop.endMs && 
              newTime >= currentProject.loop.endMs) {
            // Loop wraparound detected
            isHandlingLoopWrapRef.current = true;
            
            // Handle recording if active
            if (isRecording && recordingSegments.length > 0) {
              handleLoopWrapDuringRecording();
            }
            
            // Seamlessly restart playback at loop start
            audioManager.stop();
            setCurrentTime(currentProject.loop.startMs);
            
            // Wait one audio processing frame for sources to stop
            loopRestartTimeout = setTimeout(() => {
              audioManager.play(currentProject, currentProject.loop.startMs).then(() => {
                // Set previousTime above loop end to prevent edge re-detection
                previousTimeRef.current = currentProject.loop.endMs + 1000;
                // Wait 100ms before resetting flag
                setTimeout(() => {
                  isHandlingLoopWrapRef.current = false;
                }, 100);
              });
            }, 5);
          } else {
            setCurrentTime(newTime);
            previousTimeRef.current = newTime;
          }
        }
      }, 50);
    } else {
      (async () => {
        await audioManager.pause(currentTimeMs);
      })();
    }
    
    return () => {
      isCancelled = true;
      
      // Clear loop restart timeout if pending
      if (loopRestartTimeout) {
        clearTimeout(loopRestartTimeout);
      }
      
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isPlaying, project.projectId, isRecording, recordingSegments.length]);

  // Separate effect for handling recording overwrite
  useEffect(() => {
    if (!isRecording || recordingSegments.length === 0 || !isPlaying) return;
    
    const interval = setInterval(() => {
      handleRecordingOverwrite(currentTimeMs);
    }, 100); // Check every 100ms
    
    return () => {
      clearInterval(interval);
    };
  }, [isRecording, recordingSegments.length, isPlaying, currentTimeMs]);

  // Handle scroll synchronization
  const handleTrackListScroll = (e) => {
    if (isTimelineScrollingRef.current) {
      return;
    }
    
    isTrackListScrollingRef.current = true;
    
    if (timelineScrollRef.current) {
      timelineScrollRef.current.scrollTop = e.target.scrollTop;
    }
    
    requestAnimationFrame(() => {
      isTrackListScrollingRef.current = false;
    });
  };

  const handleTimelineScroll = (scrollTop) => {
    if (isTrackListScrollingRef.current) {
      return;
    }
    
    isTimelineScrollingRef.current = true;
    
    if (trackListScrollRef.current) {
      trackListScrollRef.current.scrollTop = scrollTop;
    }
    
    requestAnimationFrame(() => {
      isTimelineScrollingRef.current = false;
    });
  };

  const normalizeRecordingOffset = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, numeric);
  };

  const getSegmentOffsetMs = (segment) =>
    normalizeRecordingOffset(segment?.offsetMs ?? recordingOffsetMs);

  const getEffectiveRecordingEndMs = (segment, timeMs) => {
    if (!segment) return timeMs;
    const offsetMs = getSegmentOffsetMs(segment);
    return Math.max(segment.startTimeMs, timeMs - offsetMs);
  };

  const applyRecordingOffsetToClip = (clip, offsetMs) => {
    const safeOffset = normalizeRecordingOffset(offsetMs);
    if (!clip || safeOffset <= 0) {
      return { clip, durationMs: clip ? clip.cropEndMs - clip.cropStartMs : 0 };
    }
    const trimMs = Math.min(safeOffset, clip.sourceDurationMs);
    const nextClip = {
      ...clip,
      cropStartMs: trimMs,
      cropEndMs: clip.sourceDurationMs,
    };
    const durationMs = Math.max(0, nextClip.cropEndMs - nextClip.cropStartMs);
    return { clip: durationMs > 0 ? nextClip : null, durationMs };
  };

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">No project loaded</p>
      </div>
    );
  }

  const treeProject = normalizeTrackTree(project);
  const timelineRows = getVisibleTimelineRows(treeProject);
  const hasNoTracks = !project.tracks || project.tracks.length === 0;

  const handleSelectRow = (row) => {
    if (!row) return;
    setSelectedNodeId(row.nodeId);
    setSelectedRowKind(row.kind);
    if (row.kind === 'track') {
      selectTrack(row.trackId);
    } else {
      selectTrack(null);
    }
  };

  const selectTrackAndRow = (trackId) => {
    selectTrack(trackId);
    if (!trackId) {
      setSelectedNodeId(null);
      setSelectedRowKind(null);
      return;
    }
    const row = timelineRows.find((candidate) => candidate.kind === 'track' && candidate.trackId === trackId);
    setSelectedRowKind('track');
    if (row) {
      setSelectedNodeId(row.nodeId);
    } else {
      setSelectedNodeId(null);
    }
  };

  useEffect(() => {
    if (hasNoTracks && !showFileImport) {
      setShowFileImport(true);
    }
  }, [hasNoTracks]);

  useEffect(() => {
    if (!timelineRows.length) {
      setSelectedNodeId(null);
      setSelectedRowKind(null);
      return;
    }
    const stillVisible = selectedNodeId
      ? timelineRows.some((row) => row.nodeId === selectedNodeId)
      : false;
    if (stillVisible) return;

    const selectedTrackRow = selectedTrackId
      ? timelineRows.find((row) => row.kind === 'track' && row.trackId === selectedTrackId)
      : null;
    const fallbackRow = selectedTrackRow || timelineRows[0];
    setSelectedNodeId(fallbackRow.nodeId);
    setSelectedRowKind(fallbackRow.kind);
  }, [timelineRows, selectedNodeId, selectedTrackId]);

  useEffect(() => {
    if (selectedRowKind !== 'track' || !selectedTrackId) return;
    const trackRow = timelineRows.find((row) => row.kind === 'track' && row.trackId === selectedTrackId);
    if (trackRow && selectedNodeId !== trackRow.nodeId) {
      setSelectedNodeId(trackRow.nodeId);
    }
  }, [selectedRowKind, selectedTrackId, selectedNodeId, timelineRows]);

  const handlePlay = () => {
    if (isPlaying) {
      // Wait for loop wrap to complete before pausing
      const doPause = async () => {
        while (isHandlingLoopWrapRef.current) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        // Force reset the flag to ensure clean state
        isHandlingLoopWrapRef.current = false;
        pause();
        // Stop recording if active when pausing
        if (isRecording) {
          finalizeRecording();
        }
      };
      doPause();
    } else {
      play();
    }
  };

  const handleStop = () => {
    // Stop recording if active
    if (isRecording) {
      finalizeRecording();
    }
    
    stop();
    audioManager.stop();
    // Set to start of loop if loop is enabled, otherwise to project start
    const startTime = project.loop.enabled ? project.loop.startMs : 0;
    setCurrentTime(startTime);
  };

  const handleLoopWrapDuringRecording = async () => {
    console.log('Loop wrap detected during recording!');
    
    try {
      // Stop the current MediaRecorder
      const result = await recordingManager.stopRecording();
      
      const currentSegment = recordingSegments[recordingSegments.length - 1];
      const segmentStart = currentSegment.startTimeMs;
      const segmentOffsetMs = getSegmentOffsetMs(currentSegment);
      
      // Process the audio
      const arrayBuffer = await result.blob.arrayBuffer();
      const audioBuffer = await audioManager.decodeAudioFile(arrayBuffer);
      const wavBlob = audioManager.audioBufferToBlob(audioBuffer);
      const fileName = `recording_segment_${Date.now()}.wav`;
      const blobId = await storeMediaBlob(fileName, audioBuffer, wavBlob);
      audioManager.mediaCache.set(blobId, audioBuffer);
      
      // Create clip for this segment
      const duration = audioBuffer.duration * 1000;
      const clip = createClip(blobId, segmentStart, duration);
      const { clip: adjustedClip, durationMs: adjustedDurationMs } = applyRecordingOffsetToClip(
        clip,
        segmentOffsetMs
      );
      
      // Update the segment with the blobId
      const updatedSegments = recordingSegments.map((seg, idx) => 
        idx === recordingSegments.length - 1 
          ? { ...seg, blobId, clip: adjustedClip }
          : seg
      );
      
      // Get current track state
      const track = project.tracks.find(t => t.id === selectedTrackId);
      if (!track) return;
      
      let updatedClips = track.clips;
      if (adjustedClip && adjustedDurationMs > 0) {
        const segmentEnd = segmentStart + adjustedDurationMs;
        // Apply overwrites for this segment
        updatedClips = processRecordingOverwrites(segmentStart, segmentEnd, track.clips);
        // Add the new clip
        updatedClips = [...updatedClips, adjustedClip];
      }
      
      // Apply overwrites from previous segments to the clips
      for (const segment of updatedSegments.slice(0, -1)) {
        if (segment.clip) {
          const segStart = segment.startTimeMs;
          const segEnd = segment.startTimeMs + (segment.clip.cropEndMs - segment.clip.cropStartMs);
          updatedClips = processRecordingOverwrites(segStart, segEnd, updatedClips.filter(c => c.id !== segment.clip.id));
        }
      }
      
      // Update project with finalized segment
      updateProject((proj) => ({
        ...proj,
        tracks: proj.tracks.map(t => 
          t.id === selectedTrackId 
            ? { ...t, clips: updatedClips }
            : t
        ),
      }), 'Recording segment finalized');
      
      // Start a new segment at loop start
      await recordingManager.startRecording(selectedTrackId, project.loop.startMs);
      setRecordingSegments([
        ...updatedSegments,
        { startTimeMs: project.loop.startMs, offsetMs: segmentOffsetMs },
      ]);
      
      console.log('New recording segment started at loop start');
    } catch (error) {
      console.error('Failed to handle loop wrap during recording:', error);
    }
  };

  const handleRecordingOverwrite = (currentTime) => {
    if (recordingSegments.length === 0 || !selectedTrackId) return;
    
    const currentSegment = recordingSegments[recordingSegments.length - 1];
    const recordingStart = currentSegment.startTimeMs;
    const recordingEnd = getEffectiveRecordingEndMs(currentSegment, currentTime);
    if (recordingEnd <= recordingStart) return;
    const track = project.tracks.find(t => t.id === selectedTrackId);
    
    if (!track) return;
    
    // Collect all existing recording segment clips to exclude from overwrite
    const recordingClipIds = new Set();
    for (const segment of recordingSegments) {
      if (segment.clip) {
        recordingClipIds.add(segment.clip.id);
      }
    }
    
    // Filter out existing recording clips before processing overwrites
    const clipsToProcess = track.clips.filter(c => !recordingClipIds.has(c.id));
    
    // Use collision detection utility to process overwrites
    const updatedClips = processRecordingOverwrites(recordingStart, recordingEnd, clipsToProcess);
    
    // Add back the recording clips
    const recordingClips = track.clips.filter(c => recordingClipIds.has(c.id));
    const allClips = [...updatedClips, ...recordingClips];
    
    // Only update if clips actually changed
    const clipsChanged = JSON.stringify(allClips) !== JSON.stringify(track.clips);
    if (clipsChanged) {
      updateProject((proj) => ({
        ...proj,
        tracks: proj.tracks.map(t => 
          t.id === selectedTrackId 
            ? { ...t, clips: allClips }
            : t
        ),
      }), 'Recording overwrite');
    }
  };

  const finalizeRecording = async () => {
    try {
      const result = await recordingManager.stopRecording();
      stopRecording();
      
      const currentSegment = recordingSegments[recordingSegments.length - 1];
      const recordingStart = currentSegment.startTimeMs;
      const segmentOffsetMs = getSegmentOffsetMs(currentSegment);
      
      const arrayBuffer = await result.blob.arrayBuffer();
      const audioBuffer = await audioManager.decodeAudioFile(arrayBuffer);
      const wavBlob = audioManager.audioBufferToBlob(audioBuffer);
      const fileName = `recording_final_${Date.now()}.wav`;
      const blobId = await storeMediaBlob(fileName, audioBuffer, wavBlob);

      audioManager.mediaCache.set(blobId, audioBuffer);

      const totalDurationMs = audioBuffer.duration * 1000;

      // Create clip for final segment
      const finalClip = createClip(blobId, recordingStart, totalDurationMs);
      const { clip: adjustedFinalClip } = applyRecordingOffsetToClip(finalClip, segmentOffsetMs);
      
      // Update the final segment
      const finalSegments = recordingSegments.map((seg, idx) => 
        idx === recordingSegments.length - 1 
          ? { ...seg, blobId, clip: adjustedFinalClip }
          : seg
      );
      
      // Get the current track state
      const track = project.tracks.find(t => t.id === selectedTrackId);
      if (!track) {
        throw new Error('Track not found');
      }
      
      // Start with existing clips (excluding previous recording clips)
      const recordingClipIds = new Set(finalSegments.filter(s => s.clip).map(s => s.clip.id));
      let updatedClips = track.clips.filter(c => !recordingClipIds.has(c.id));
      
      // Process overwrites for each segment and add clips
      for (const segment of finalSegments) {
        if (segment.clip) {
          const segStart = segment.startTimeMs;
          const segEnd = segment.startTimeMs + (segment.clip.cropEndMs - segment.clip.cropStartMs);
          
          // Apply overwrites for this segment
          updatedClips = processRecordingOverwrites(segStart, segEnd, updatedClips);
          
          // Add the segment clip
          updatedClips = [...updatedClips, segment.clip];
        }
      }
      
      // Update the track with processed clips
      updateProject((proj) => ({
        ...proj,
        tracks: proj.tracks.map(t => 
          t.id === selectedTrackId 
            ? { ...t, clips: updatedClips }
            : t
        ),
      }), 'Finalize recording');
      
      // Clear recording state
      setRecordingSegments([]);
      recordingOriginalClipsRef.current = null;

      console.log(`Recording finalized: ${finalSegments.length} segment(s)`);
    } catch (error) {
      console.error('Recording failed:', error);
      alert('Recording failed: ' + error.message);
      stopRecording();
      setRecordingSegments([]);
      recordingOriginalClipsRef.current = null;
    }
  };

  const handleRecord = async () => {
    if (selectedRowKind === 'group') {
      alert('Cannot record to a group. Select a track first.');
      return;
    }

    if (!selectedTrackId) {
      alert('Please select a track to record to.');
      return;
    }

    if (isRecording) {
      // Stop recording
      await finalizeRecording();
    } else {
      // Start recording
      try {
        const track = project.tracks.find(t => t.id === selectedTrackId);
        const offsetMs = normalizeRecordingOffset(recordingOffsetMs);
        
        await recordingManager.startRecording(selectedTrackId, currentTimeMs);

        startRecording();
        
        // Initialize first recording segment
        recordingStartTimeRef.current = currentTimeMs;
        setRecordingSegments([{ startTimeMs: currentTimeMs, offsetMs }]);
        
        // Store original clips state
        recordingOriginalClipsRef.current = track ? JSON.parse(JSON.stringify(track.clips)) : [];
        
        // Start playing if not already playing
        if (!isPlaying) {
          play();
        }
      } catch (error) {
        console.error('Failed to start recording:', error);
        alert('Failed to start recording: ' + error.message);
        setRecordingSegments([]);
      }
    }
  };

  // Get all clip boundaries (start and end times)
  const getClipBoundaries = () => {
    const boundaries = [];
    
    // Determine which tracks to consider
    const tracksToCheck = selectedTrackId 
      ? project.tracks.filter(t => t.id === selectedTrackId)
      : project.tracks;
    
    for (const track of tracksToCheck) {
      for (const clip of track.clips) {
        // Add clip start
        boundaries.push(clip.timelineStartMs);
        // Add clip end
        const clipEnd = clip.timelineStartMs + (clip.cropEndMs - clip.cropStartMs);
        boundaries.push(clipEnd);
      }
    }
    
    // Remove duplicates and sort
    return [...new Set(boundaries)].sort((a, b) => a - b);
  };

  const handleSkipBackward = () => {
    const boundaries = getClipBoundaries();
    if (boundaries.length === 0) return;
    
    // Find the largest boundary that is less than current time
    const previous = boundaries.filter(b => b < currentTimeMs - 10); // -10ms tolerance
    
    if (previous.length > 0) {
      const targetTime = previous[previous.length - 1];
      handleSeek(targetTime);
    } else {
      // If no previous boundary, go to start
      const startTime = project.loop.enabled ? project.loop.startMs : 0;
      handleSeek(startTime);
    }
  };

  const handleSkipForward = () => {
    const boundaries = getClipBoundaries();
    if (boundaries.length === 0) return;
    
    // Find the smallest boundary that is greater than current time
    const next = boundaries.filter(b => b > currentTimeMs + 10); // +10ms tolerance
    
    if (next.length > 0) {
      const targetTime = next[0];
      handleSeek(targetTime);
    }
  };

  const handleFileImport = async (fileData) => {
    const newTracks = [];

    for (const { file, role } of fileData) {
      try {
        console.log(`Importing ${file.name}...`);
        
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioManager.decodeAudioFile(arrayBuffer);

        console.log(`Decoded ${file.name}: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.sampleRate}Hz`);

        const blob = audioManager.audioBufferToBlob(audioBuffer);
        const blobId = await storeMediaBlob(file.name, audioBuffer, blob);

        audioManager.mediaCache.set(blobId, audioBuffer);

        const trackName = file.name.replace(/\.[^/.]+$/, '');
        const track = createTrack(trackName, role || TRACK_ROLES.INSTRUMENT, false);

        const durationMs = audioBuffer.duration * 1000;
        const clip = createClip(blobId, 0, durationMs);

        track.clips.push(clip);
        newTracks.push(track);

        console.log(`Successfully imported ${file.name} as ${trackName}`);

      } catch (error) {
        console.error(`Failed to import ${file.name}:`, error);
        throw new Error(`Failed to import ${file.name}: ${error.message}`);
      }
    }

    updateProject((proj) => {
      let nextProject = {
        ...proj,
        tracks: [...proj.tracks, ...newTracks],
      };
      nextProject = normalizeTrackTree(nextProject);
      for (const track of newTracks) {
        nextProject = attachTrackNode(nextProject, track.id);
      }
      return reorderTracksByTree(nextProject);
    }, 'Import audio files');

    console.log(`Import complete: ${newTracks.length} tracks added`);
  };

  const handleSeek = (timeMs) => {
    const wasPlaying = isPlaying;
    
    if (wasPlaying) {
      pause();
      audioManager.stop();
    }
    
    setCurrentTime(timeMs);
    
    if (wasPlaying) {
      setTimeout(() => {
        play();
      }, 10);
    }
  };

  const handleUpdateTrack = (trackId, updates) => {
    let nextProjectAfter = null;
    updateProject((proj) => {
      const previousTrack = proj.tracks.find((track) => track.id === trackId);
      const wasChoirTrack = previousTrack?.role?.startsWith('choir-part-');
      const nextTracks = proj.tracks.map((track) =>
        track.id === trackId ? { ...track, ...updates } : track
      );
      let nextProject = {
        ...proj,
        tracks: nextTracks,
      };

      if (updates.pan !== undefined && wasChoirTrack && proj.autoPan?.enabled) {
        nextProject = {
          ...nextProject,
          autoPan: {
            ...nextProject.autoPan,
            enabled: false,
          },
        };
      } else if (updates.role !== undefined && proj.autoPan?.enabled) {
        const result = applyChoirAutoPanToProject(nextProject);
        nextProject = result.project;
      }

      nextProjectAfter = nextProject;
      return nextProject;
    }, `Update track`);

    if (isPlaying && nextProjectAfter) {
      const shouldRestart = updates.muted !== undefined || updates.soloed !== undefined;
      if (shouldRestart) {
        audioManager.stop();
        audioManager.play(nextProjectAfter, currentTimeMs);
      } else {
        const mix = getEffectiveTrackMix(nextProjectAfter);
        mix.statesByTrackId.forEach((state, id) => {
          audioManager.updateTrackMix(
            id,
            state.audible ? state.effectiveGain : 0,
            state.effectivePan
          );
        });
      }
    }
  };

  const handleUpdateGroup = (groupNodeId, updates) => {
    let nextProjectAfter = null;
    updateProject((proj) => {
      let nextProject = updateGroupNode(proj, groupNodeId, updates);
      const wasChoirGroup = (proj.trackTree || []).some(
        (node) => node.id === groupNodeId && node.kind === 'group' && node.role?.startsWith('choir-part-')
      );
      const nextChoirGroup = (nextProject.trackTree || []).some(
        (node) => node.id === groupNodeId && node.kind === 'group' && node.role?.startsWith('choir-part-')
      );
      if (updates.pan !== undefined && wasChoirGroup && proj.autoPan?.enabled) {
        nextProject = {
          ...nextProject,
          autoPan: {
            ...nextProject.autoPan,
            enabled: false,
          },
        };
      } else if (updates.role !== undefined && (wasChoirGroup || nextChoirGroup) && proj.autoPan?.enabled) {
        const result = applyChoirAutoPanToProject(nextProject);
        nextProject = result.project;
      }
      nextProjectAfter = nextProject;
      return nextProject;
    }, 'Update group');

    if (isPlaying && nextProjectAfter) {
      const shouldRestart = updates.muted !== undefined || updates.soloed !== undefined;
      if (shouldRestart) {
        audioManager.stop();
        audioManager.play(nextProjectAfter, currentTimeMs);
      } else {
        const mix = getEffectiveTrackMix(nextProjectAfter);
        mix.statesByTrackId.forEach((state, id) => {
          audioManager.updateTrackMix(
            id,
            state.audible ? state.effectiveGain : 0,
            state.effectivePan
          );
        });
      }
    }
  };

  const handleSetAutoPanStrategy = (strategyId) => {
    applyProjectAutoPanSettings(
      strategyId === 'off'
        ? { enabled: false }
        : { enabled: true, strategy: strategyId },
      'Update choir auto-pan'
    );
  };

  const applyProjectAutoPanSettings = (settingsUpdate, description) => {
    let panUpdates = null;
    updateProject((proj) => {
      const result = applyChoirAutoPanToProject(proj, settingsUpdate);
      panUpdates = result.panUpdates;
      return result.project;
    }, description);

    if (isPlaying && panUpdates) {
      Object.entries(panUpdates).forEach(([id, pan]) => {
        audioManager.updateTrackPan(id, pan);
      });
    }
  };

  const handleToggleAutoPanInverted = () => {
    applyProjectAutoPanSettings(
      {
        inverted: !project?.autoPan?.inverted,
      },
      'Toggle inverted auto-pan'
    );
  };

  const handleSetAutoPanManualChoirParts = (enabled) => {
    applyProjectAutoPanSettings(
      { manualChoirParts: enabled },
      'Update choir part selection mode'
    );
  };

  const handleUpdateExportSettings = (updates) => {
    updateProject((proj) => ({
      ...proj,
      exportSettings: normalizeExportSettings({
        ...(proj.exportSettings || {}),
        ...updates,
      }),
    }), 'Update export settings');
  };

  const handleReorderTrack = (trackId, insertIndex) => {
    let panUpdates = null;
    updateProject((proj) => {
      const rowTracks = getVisibleTimelineRows(proj)
        .filter((row) => row.kind === 'track')
        .map((row) => row.trackId);
      const fromIndex = rowTracks.findIndex((id) => id === trackId);
      if (fromIndex < 0 || insertIndex < 0 || insertIndex >= rowTracks.length) {
        return proj;
      }
      const movingNode = getTrackNodeByTrackId(proj, trackId);
      const targetTrackId = rowTracks[insertIndex];
      const targetNode = getTrackNodeByTrackId(proj, targetTrackId);
      if (!movingNode || !targetNode) return proj;

      let nextProject = moveTrackTreeNode(
        proj,
        movingNode.id,
        targetNode.id,
        insertIndex < fromIndex ? 'before' : 'after'
      );
      nextProject = reorderTracksByTree(nextProject);

      if (nextProject.autoPan?.enabled && !nextProject.autoPan?.manualChoirParts) {
        const result = applyChoirAutoPanToProject(nextProject);
        panUpdates = result.panUpdates;
        nextProject = result.project;
      }

      return nextProject;
    }, 'Reorder tracks');

    if (isPlaying && panUpdates) {
      Object.entries(panUpdates).forEach(([id, pan]) => {
        audioManager.updateTrackPan(id, pan);
      });
    }
  };

  const handleMoveNode = (nodeId, targetNodeId, placement) => {
    let panUpdates = null;
    updateProject((proj) => {
      let nextProject = moveTrackTreeNode(proj, nodeId, targetNodeId, placement);
      nextProject = collapseEmptyGroupsToTracks(nextProject);
      nextProject = reorderTracksByTree(nextProject);
      if (nextProject.autoPan?.enabled && !nextProject.autoPan?.manualChoirParts) {
        const result = applyChoirAutoPanToProject(nextProject);
        panUpdates = result.panUpdates;
        nextProject = result.project;
      }
      return nextProject;
    }, 'Move track node');

    if (isPlaying && panUpdates) {
      Object.entries(panUpdates).forEach(([id, pan]) => {
        audioManager.updateTrackPan(id, pan);
      });
    }
  };

  const collapseEmptyGroupsToTracks = (proj) => {
    const normalized = normalizeTrackTree(proj);
    const childCountByParentId = new Map();
    for (const node of normalized.trackTree || []) {
      const parentKey = node.parentId ?? null;
      childCountByParentId.set(parentKey, (childCountByParentId.get(parentKey) || 0) + 1);
    }

    const emptyGroups = (normalized.trackTree || []).filter(
      (node) => node.kind === 'group' && !childCountByParentId.get(node.id)
    );
    if (!emptyGroups.length) {
      return normalized;
    }

    const emptyGroupIds = new Set(emptyGroups.map((group) => group.id));
    const nextTree = (normalized.trackTree || []).filter((node) => !emptyGroupIds.has(node.id));
    const nextTracks = [...(normalized.tracks || [])];

    emptyGroups.forEach((group) => {
      const role = group.role?.startsWith('choir-part-') ? group.role : TRACK_ROLES.OTHER;
      const restoredTrack = createTrack(group.name || 'Track', role, Boolean(group.collapsed));
      restoredTrack.muted = Boolean(group.muted);
      restoredTrack.soloed = Boolean(group.soloed);
      restoredTrack.volume = Number.isFinite(Number(group.volume)) ? Number(group.volume) : restoredTrack.volume;
      restoredTrack.pan = Number.isFinite(Number(group.pan)) ? Number(group.pan) : restoredTrack.pan;
      nextTracks.push(restoredTrack);
      nextTree.push({
        id: crypto.randomUUID(),
        kind: 'track',
        parentId: group.parentId ?? null,
        order: Number.isFinite(Number(group.order)) ? Number(group.order) : 0,
        trackId: restoredTrack.id,
      });
    });

    return reorderTracksByTree(normalizeTrackTree({
      ...normalized,
      tracks: nextTracks,
      trackTree: nextTree,
    }));
  };

  const handleCreateGroup = (name = 'Group', parentId = null) => {
    updateProject((proj) => createGroupNode(proj, name, parentId, null), 'Create group');
  };

  const handleRenameGroup = (groupNodeId, name) => {
    updateProject((proj) => renameGroupNode(proj, groupNodeId, name), 'Rename group');
  };

  const handleDeleteGroup = (groupNodeId) => {
    const normalized = normalizeTrackTree(project);
    const groupNode = (normalized.trackTree || []).find((node) => node.kind === 'group' && node.id === groupNodeId);
    if (!groupNode) return;

    const stack = [groupNodeId];
    const descendantTrackIds = [];

    while (stack.length > 0) {
      const currentGroupId = stack.pop();
      const children = (normalized.trackTree || []).filter((node) => (node.parentId ?? null) === currentGroupId);
      for (const child of children) {
        if (child.kind === 'track' && child.trackId) {
          descendantTrackIds.push(child.trackId);
        } else if (child.kind === 'group') {
          stack.push(child.id);
        }
      }
    }

    const trackById = new Map((normalized.tracks || []).map((track) => [track.id, track]));
    const clipCount = descendantTrackIds.reduce((sum, trackId) => {
      const track = trackById.get(trackId);
      return sum + (track?.clips?.length || 0);
    }, 0);

    if (clipCount > 0) {
      const confirmed = window.confirm(
        `Are you sure you want to delete "${groupNode.name}" with ${clipCount} clip${clipCount !== 1 ? 's' : ''}?`
      );
      if (!confirmed) return;
    }

    updateProject((proj) => deleteGroupPromoteChildren(proj, groupNodeId), 'Delete group');
  };

  const handleToggleGroupCollapse = (groupNodeId) => {
    updateProject((proj) => toggleGroupCollapsed(proj, groupNodeId), 'Toggle group collapse');
  };

  const handleMasterVolumeDoubleClick = () => {
    const display = masterVolume <= 0 ? '-∞' : volumeToDb(masterVolume).toFixed(1);
    setMasterEditTooltip({ text: display });
  };

  const handleMasterVolumeMouseDown = (e) => {
    e.preventDefault();
    if (masterEditTooltip) setMasterEditTooltip(null);
    const rect = e.currentTarget.getBoundingClientRect();
    setMasterDragTooltip(masterVolume);
    masterDragRef.current = {
      startX: e.clientX,
      startValue: masterVolume,
      width: rect.width,
      moved: false,
    };
  };

  const applyMasterVolume = (value) => {
    setMasterVolume(value);
    updateProject((proj) => ({
      ...proj,
      masterVolume: value,
    }), 'Set master volume');
  };

  const commitProjectName = () => {
    const nextName = normalizeProjectName(projectNameDraft);
    if (!nextName || nextName === project.projectName) {
      setProjectNameDraft(project.projectName);
      setIsEditingProjectName(false);
      return;
    }

    updateProject((proj) => ({
      ...proj,
      projectName: nextName,
    }), 'Rename project');
    setIsEditingProjectName(false);
  };

  const handleAddEmptyTrack = (options = null) => {
    const trackNumber = project.tracks.length + 1;
    const trackName = `Track ${trackNumber}`;
    const newTrack = createTrack(trackName, 'other', false);

    let preferredParentId = null;
    let preferredInsertIndex = null;
    let afterNodeId = null;

    if (typeof options === 'string' || options === null) {
      preferredParentId = options;
    } else if (typeof options === 'object') {
      preferredParentId = options.parentId ?? null;
      preferredInsertIndex = Number.isInteger(options.insertIndex) ? options.insertIndex : null;
      afterNodeId = typeof options.afterNodeId === 'string' ? options.afterNodeId : null;
    }
    
    updateProject((proj) => {
      let nextProject = {
        ...proj,
        tracks: [...proj.tracks, newTrack],
      };

      let targetParentId = preferredParentId;
      let targetInsertIndex = preferredInsertIndex;

      if (afterNodeId) {
        const treeProject = normalizeTrackTree(nextProject);
        const afterNode = treeProject.trackTree.find((node) => node.id === afterNodeId);
        if (afterNode) {
          const parentId = afterNode.parentId ?? null;
          const siblings = treeProject.trackTree
            .filter((node) => (node.parentId ?? null) === parentId)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const afterIndex = siblings.findIndex((node) => node.id === afterNode.id);
          if (afterIndex >= 0) {
            targetParentId = parentId;
            targetInsertIndex = afterIndex + 1;
          }
        }
      }

      nextProject = attachTrackNode(nextProject, newTrack.id, targetParentId, targetInsertIndex);
      return reorderTracksByTree(nextProject);
    }, 'Add empty track');
    
    // Select the new track
    selectTrackAndRow(newTrack.id);
  };

  const handleDeleteTrackById = (trackId) => {
    if (!trackId) {
      return; // No track selected
    }

    const track = project.tracks.find(t => t.id === trackId);
    if (!track) {
      return; // Track not found
    }
    const wasChoir = track.role?.startsWith('choir-part-');
    const normalizedBeforeDelete = normalizeTrackTree(project);
    const rowsBeforeDelete = getVisibleTimelineRows(normalizedBeforeDelete);
    const deletedNode = getTrackNodeByTrackId(normalizedBeforeDelete, trackId);
    const deletedRowIndex = deletedNode
      ? rowsBeforeDelete.findIndex((row) => row.nodeId === deletedNode.id)
      : -1;
    const deletedParentId = deletedNode?.parentId ?? null;
    let nextRowSelection = null;

    // Check if track has clips
    const hasClips = track.clips && track.clips.length > 0;

    if (hasClips) {
      // Show confirmation for non-empty tracks
      const confirmed = window.confirm(
        `Are you sure you want to delete "${track.name}"? This track contains ${track.clips.length} clip${track.clips.length !== 1 ? 's' : ''} and this action cannot be undone.`
      );
      
      if (!confirmed) {
        return; // User canceled
      }
    }

    // Delete the track
    let panUpdates = null;
    updateProject((proj) => {
      let nextProject = {
        ...proj,
        tracks: proj.tracks.filter(t => t.id !== trackId),
      };
      nextProject = removeTrackNode(nextProject, trackId);
      nextProject = collapseEmptyGroupsToTracks(nextProject);
      nextProject = reorderTracksByTree(nextProject);

      if (wasChoir && proj.autoPan?.enabled) {
        const result = applyChoirAutoPanToProject(nextProject);
        panUpdates = result.panUpdates;
        nextProject = result.project;
      }

      const rowsAfterDelete = getVisibleTimelineRows(nextProject);
      if (!rowsAfterDelete.length) {
        nextRowSelection = null;
      } else {
        const sameLevelRowIndexes = rowsAfterDelete
          .map((row, idx) => ({ row, idx }))
          .filter(({ row }) => (row.parentId ?? null) === deletedParentId);

        const sameLevelAbove = sameLevelRowIndexes
          .filter(({ idx }) => deletedRowIndex !== -1 && idx < deletedRowIndex)
          .sort((a, b) => b.idx - a.idx)[0]?.row || null;
        const sameLevelBelow = sameLevelRowIndexes
          .filter(({ idx }) => deletedRowIndex !== -1 && idx >= deletedRowIndex)
          .sort((a, b) => a.idx - b.idx)[0]?.row || null;

        if (sameLevelAbove || sameLevelBelow) {
          nextRowSelection = sameLevelAbove || sameLevelBelow;
        } else if (deletedRowIndex > 0) {
          nextRowSelection = rowsAfterDelete[Math.min(deletedRowIndex - 1, rowsAfterDelete.length - 1)] || null;
        } else if (deletedRowIndex === 0) {
          nextRowSelection = rowsAfterDelete[0] || null;
        } else {
          nextRowSelection = rowsAfterDelete[0] || null;
        }
      }

      return nextProject;
    }, `Delete track "${track.name}"`);

    if (isPlaying && panUpdates) {
      Object.entries(panUpdates).forEach(([id, pan]) => {
        audioManager.updateTrackPan(id, pan);
      });
    }

    if (nextRowSelection) {
      if (nextRowSelection.kind === 'track') {
        selectTrackAndRow(nextRowSelection.trackId);
      } else {
        setSelectedNodeId(nextRowSelection.nodeId);
        setSelectedRowKind('group');
        selectTrack(null);
      }
    } else {
      setSelectedNodeId(null);
      setSelectedRowKind(null);
      selectTrack(null);
    }
  };

  const handleDeleteTrack = () => {
    handleDeleteTrackById(selectedTrackId);
  };

  const handleAddTrackFromSelected = () => {
    const selectedRow = selectedNodeId
      ? timelineRows.find((row) => row.nodeId === selectedNodeId)
      : null;

    if (!selectedRow) {
      handleAddEmptyTrack();
      return;
    }

    handleAddEmptyTrack({
      parentId: selectedRow.parentId ?? null,
      afterNodeId: selectedRow.nodeId,
    });
  };

  const handleCreateSubtrackFromTrack = (trackId) => {
    if (!trackId) return;
    const sourceTrack = project.tracks.find((t) => t.id === trackId);
    if (!sourceTrack) return;
    if ((sourceTrack.clips?.length || 0) > 0) {
      alert('Create new subtrack only works from an empty track.');
      return;
    }

    const newTrackNumber = project.tracks.length + 1;
    const newTrack = createTrack(`Track ${newTrackNumber}`, 'other', false);

    updateProject((proj) => {
      const normalized = normalizeTrackTree(proj);
      const sourceNode = getTrackNodeByTrackId(normalized, trackId);
      if (!sourceNode) return normalized;

      const source = normalized.tracks.find((t) => t.id === trackId);
      if (!source || (source.clips?.length || 0) > 0) {
        return normalized;
      }

      const siblingNodes = normalized.trackTree
        .filter((node) => (node.parentId ?? null) === (sourceNode.parentId ?? null))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const insertOrder = siblingNodes.findIndex((node) => node.id === sourceNode.id);
      const groupOrder = insertOrder >= 0 ? insertOrder : (sourceNode.order ?? siblingNodes.length);

      const groupRole = source.role?.startsWith('choir-part-') ? source.role : 'group';
      const groupNodeId = crypto.randomUUID();
      const childNodeId = crypto.randomUUID();

      const nextTracks = [
        ...normalized.tracks.filter((t) => t.id !== source.id),
        newTrack,
      ];

      const siblingsWithoutSource = normalized.trackTree
        .filter((node) => node.id !== sourceNode.id)
        .map((node) => ({ ...node }));

      const nextTree = [
        ...siblingsWithoutSource,
        {
          id: groupNodeId,
          kind: 'group',
          parentId: sourceNode.parentId ?? null,
          order: groupOrder,
          name: source.name,
          collapsed: false,
          muted: Boolean(source.muted),
          soloed: Boolean(source.soloed),
          volume: Number.isFinite(source.volume) ? source.volume : 100,
          pan: Number.isFinite(source.pan) ? source.pan : 0,
          role: groupRole,
        },
        {
          id: childNodeId,
          kind: 'track',
          parentId: groupNodeId,
          order: 0,
          trackId: newTrack.id,
        },
      ];

      return reorderTracksByTree({
        ...normalized,
        tracks: nextTracks,
        trackTree: nextTree,
      });
    }, 'Create subtrack');

    selectTrackAndRow(newTrack.id);
  };

  const handleCreateSubtrackFromSelected = () => {
    const selectedRow = selectedNodeId
      ? timelineRows.find((row) => row.nodeId === selectedNodeId)
      : null;
    if (!selectedRow) {
      alert('Select a track or group first.');
      return;
    }
    if (selectedRow.kind === 'group') {
      handleAddEmptyTrack(selectedRow.nodeId);
      return;
    }
    handleCreateSubtrackFromTrack(selectedRow.trackId);
  };

  const handleToggleLoop = () => {
    const description = project.loop.enabled ? 'Disable loop' : 'Enable loop';
    updateProject((proj) => ({
      ...proj,
      loop: {
        ...proj.loop,
        enabled: !proj.loop.enabled,
      },
    }), description);
  };

  useKeyboardShortcuts({
    enabled: true,
    onPlayPause: handlePlay,
    onRecord: handleRecord,
    onToggleLoop: handleToggleLoop,
    onUndo: undo,
    onRedo: redo,
    onDeleteTrack: handleDeleteTrack,
    onAddTrack: handleAddTrackFromSelected,
    onAddSubtrack: handleCreateSubtrackFromSelected,
  });

  useEffect(() => {
    const handleSpaceToggle = (e) => {
      if (e.code !== 'Space') return;
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      handlePlay();
    };

    window.addEventListener('keydown', handleSpaceToggle);
    return () => window.removeEventListener('keydown', handleSpaceToggle);
  }, [handlePlay]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="grid grid-cols-[384px_minmax(0,1fr)] items-center">
          <div className="flex items-center gap-3 min-w-0 pr-4">
            <button
              onClick={onBackToDashboard}
              className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
              title="Back to Dashboard"
            >
              <ArrowLeft size={20} />
            </button>
            <button
              onClick={() => {
                setSettingsOpen(true);
                refreshAudioDevices();
              }}
              className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
              title="Settings"
            >
              <Settings size={18} />
            </button>
            {isEditingProjectName ? (
              <input
                type="text"
                value={projectNameDraft}
                autoFocus
                onChange={(e) => setProjectNameDraft(e.target.value)}
                onBlur={commitProjectName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitProjectName();
                  } else if (e.key === 'Escape') {
                    setProjectNameDraft(project.projectName);
                    setIsEditingProjectName(false);
                  }
                }}
                className="text-lg font-semibold bg-transparent border-b border-blue-500 px-0 py-0 leading-tight focus:outline-none min-w-0"
              />
            ) : (
              <h1
                className="text-lg font-semibold truncate cursor-text"
                onDoubleClick={() => setIsEditingProjectName(true)}
                title="Double-click to rename project"
              >
                {project.projectName}
              </h1>
            )}
          </div>

          <div className="relative min-w-0">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={handleSkipBackward}
                  disabled={hasNoTracks}
                  className="p-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded transition-colors"
                  title="Skip to previous clip boundary"
                >
                  <SkipBack size={18} />
                </button>

                <button
                  onClick={handleSkipForward}
                  disabled={hasNoTracks}
                  className="p-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded transition-colors"
                  title="Skip to next clip boundary"
                >
                  <SkipForward size={18} />
                </button>

                <button
                  onClick={handleStop}
                  disabled={hasNoTracks}
                  className="p-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded transition-colors"
                  title="Stop"
                >
                  <Square size={18} />
                </button>

                <button
                  onClick={handlePlay}
                  disabled={hasNoTracks}
                  className="p-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded transition-colors"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>

                <button
                  onClick={handleRecord}
                  disabled={hasNoTracks || !selectedTrackId}
                  className={`p-2 ${
                    isRecording
                      ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                      : 'bg-red-600 hover:bg-red-700'
                  } disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded transition-colors`}
                  title={isRecording ? 'Stop Recording' : 'Record'}
                >
                  <Circle size={18} fill={isRecording ? 'currentColor' : 'none'} />
                </button>
              </div>

              <div className="flex items-center gap-4 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Volume2 size={18} className="text-gray-400" />
                  <div className="relative">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={masterVolume}
                      readOnly
                      onMouseDown={handleMasterVolumeMouseDown}
                      onDoubleClick={handleMasterVolumeDoubleClick}
                      className="w-28 volume-slider cursor-pointer block"
                      title="Master Volume (double-click for numeric input)"
                    />
                    {masterDragTooltip !== null && (
                      <div
                        className="absolute top-full left-1/2 -translate-x-1/2 w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                        style={{ marginTop: '1px' }}
                      >
                        {masterDragTooltip <= 0 ? '-∞' : volumeToDb(masterDragTooltip).toFixed(1)}
                      </div>
                    )}
                    {masterEditTooltip && (
                      <input
                        type="text"
                        value={masterEditTooltip.text}
                        onChange={(e) => setMasterEditTooltip({ text: e.target.value })}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => {
                        const text = masterEditTooltip.text.trim();
                        if (!text) {
                          applyMasterVolume(dbToVolume(0));
                        } else {
                          const normalized = text.toLowerCase();
                          if (normalized === '-∞' || normalized === '-inf' || normalized === '-infinity') {
                            applyMasterVolume(0);
                          } else {
                            const parsed = parseFloat(text);
                            if (!Number.isNaN(parsed)) {
                              applyMasterVolume(dbToVolume(Math.min(6, Math.max(-60, parsed))));
                            }
                          }
                        }
                        setMasterEditTooltip(null);
                      }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const text = masterEditTooltip.text.trim();
                          if (!text) {
                            applyMasterVolume(dbToVolume(0));
                          } else {
                            const normalized = text.toLowerCase();
                            if (normalized === '-∞' || normalized === '-inf' || normalized === '-infinity') {
                              applyMasterVolume(0);
                            } else {
                              const parsed = parseFloat(text);
                              if (!Number.isNaN(parsed)) {
                                applyMasterVolume(dbToVolume(Math.min(6, Math.max(-60, parsed))));
                              }
                            }
                          }
                            setMasterEditTooltip(null);
                          } else if (e.key === 'Escape') {
                            setMasterEditTooltip(null);
                          }
                        }}
                        className="absolute top-full left-1/2 -translate-x-1/2 w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                        style={{ marginTop: '1px' }}
                        autoFocus
                      />
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setShowFileImport(true)}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded transition-colors"
                >
                  <Upload size={16} />
                  <span className="text-sm">Import</span>
                </button>

                <button
                  onClick={() => setShowExportDialog(true)}
                  disabled={hasNoTracks}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-3 py-2 rounded transition-colors"
                >
                  <Download size={16} />
                  <span className="text-sm">Export</span>
                </button>
              </div>
            </div>

            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto text-xl font-mono bg-gray-900 px-3 py-1 rounded">
                {formatTime(currentTimeMs)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden" style={{ minWidth: 0 }}>
        <Timeline
          project={treeProject}
          rows={timelineRows}
          currentTimeMs={currentTimeMs}
          isPlaying={isPlaying}
          isRecording={isRecording}
          recordingSegments={recordingSegments}
          selectedTrackId={selectedTrackId}
          selectedNodeId={selectedNodeId}
          selectedRowKind={selectedRowKind}
          onUpdateClip={updateClip}
          onSelectRow={handleSelectRow}
          onSelectTrack={selectTrack}
          onSeek={handleSeek}
          updateProject={updateProject}
          shortcutsEnabled={true}
          deleteClipShortcutEnabled
          onDeleteTrackShortcut={handleDeleteTrackById}
          sharedVerticalScroll
          scrollContainerRef={timelineScrollRef}
        >
          {({ header, tracks, zoomOverlay }) => (
            <div className="grid grid-cols-[384px_1fr] grid-rows-[24px_minmax(0,1fr)] h-full min-h-0 min-w-0">
              <div className="bg-gray-800 border-b border-gray-700" />
              <div className="relative z-50 overflow-visible min-w-0">{header}</div>
              <div
                className="col-span-2 min-h-0 overflow-y-auto scrollbar-hidden relative z-10"
                onWheel={(e) => {
                  if (e.defaultPrevented) return;
                  if (e.ctrlKey || e.metaKey) return;
                  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                    const scrollElement = timelineScrollRef.current;
                    if (scrollElement && scrollElement.scrollWidth > scrollElement.clientWidth) {
                      e.preventDefault();
                      scrollElement.scrollLeft += e.shiftKey ? e.deltaY * 3 : e.deltaX;
                    }
                  }
                }}
              >
                <div className="grid grid-cols-[384px_1fr] min-w-0">
                  <div
                    className="bg-gray-850 border-r border-gray-700"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setTrackListContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        type: 'empty',
                      });
                    }}
                  >
                    <TrackList
                      tracks={treeProject.tracks}
                      rows={timelineRows}
                      onUpdateTrack={handleUpdateTrack}
                      onUpdateGroup={handleUpdateGroup}
                      onCreateSubtrack={handleCreateSubtrackFromTrack}
                      onSelectRow={handleSelectRow}
                      onSelectTrack={selectTrack}
                      selectedNodeId={selectedNodeId}
                      selectedTrackId={selectedTrackId}
                      onAddTrack={handleAddEmptyTrack}
                      onDeleteTrack={handleDeleteTrackById}
                      onSetAutoPanStrategy={handleSetAutoPanStrategy}
                      onToggleAutoPanInverted={handleToggleAutoPanInverted}
                      autoPanInverted={Boolean(treeProject.autoPan?.inverted)}
                      autoPanManualChoirParts={Boolean(treeProject.autoPan?.manualChoirParts)}
                      onReorderTrack={handleReorderTrack}
                      onMoveNode={handleMoveNode}
                      onCreateGroup={handleCreateGroup}
                      onRenameGroup={handleRenameGroup}
                      onDeleteGroup={handleDeleteGroup}
                      onToggleGroupCollapse={handleToggleGroupCollapse}
                      emptyContextMenu={trackListContextMenu}
                      onClearEmptyContextMenu={() => setTrackListContextMenu(null)}
                    />
                  </div>
                  <div className="min-w-0 bg-gray-900 relative overflow-hidden">
                    <div className="absolute top-2 right-3 z-40">{zoomOverlay}</div>
                    {tracks}
                    {hasNoTracks && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center text-gray-500">
                          <Upload size={48} className="mx-auto mb-4 opacity-50" />
                          <p className="text-lg mb-2">No tracks yet</p>
                          <p className="text-sm">Click Import to add audio files</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </Timeline>
      </div>

      {showFileImport && (
        <FileImport
          onImport={handleFileImport}
          manualChoirPartsEnabled={Boolean(project?.autoPan?.manualChoirParts)}
          onClose={() => setShowFileImport(false)}
        />
      )}

      {showExportDialog && (
        <ExportDialog
          project={project}
          audioBuffers={audioManager.mediaCache}
          mediaMap={mediaMap}
          onClose={() => setShowExportDialog(false)}
        />
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-800 shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
              <div className="text-sm font-semibold">Settings</div>
              <button
                className="text-gray-400 hover:text-gray-200"
                onClick={() => setSettingsOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="px-4 py-3">
              <div className="mb-3 text-xs uppercase tracking-wide text-gray-400">Audio</div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Input device</label>
                  <select
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={audioSettings.inputDeviceId}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({ ...prev, inputDeviceId: e.target.value }))
                    }
                  >
                    <option value="">Default</option>
                    {audioInputs.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Input ${device.deviceId.slice(0, 6)}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Output device</label>
                  <select
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={audioSettings.outputDeviceId}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({ ...prev, outputDeviceId: e.target.value }))
                    }
                  >
                    <option value="">Default</option>
                    {audioOutputs.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Output ${device.deviceId.slice(0, 6)}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Recording offset (ms)</label>
                  <input
                    type="number"
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={audioSettings.recordingOffsetMs}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({
                        ...prev,
                        recordingOffsetMs: Number(e.target.value),
                      }))
                    }
                  />
                </div>
                <button
                  className="text-xs text-gray-400 hover:text-gray-200"
                  onClick={refreshAudioDevices}
                >
                  Refresh device list
                </button>
              </div>

              <div className="mt-6 mb-3 text-xs uppercase tracking-wide text-gray-400">
                Project Settings
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Choir auto-pan
                  </label>
                  <select
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={project?.autoPan?.enabled ? project.autoPan?.strategy : 'off'}
                    onChange={(e) => handleSetAutoPanStrategy(e.target.value)}
                  >
                    <option value="off">Off</option>
                    {AUTO_PAN_STRATEGIES.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-600 bg-gray-900"
                    checked={Boolean(project?.autoPan?.inverted)}
                    onChange={(e) => applyProjectAutoPanSettings(
                      { inverted: e.target.checked },
                      'Update inverted auto-pan'
                    )}
                  />
                  <span>Inverted Auto Pan</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-600 bg-gray-900"
                    checked={Boolean(project?.autoPan?.manualChoirParts)}
                    onChange={(e) => handleSetAutoPanManualChoirParts(e.target.checked)}
                  />
                  <span>Manually select choir parts</span>
                </label>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">dB gain</label>
                  <input
                    type="number"
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={project?.exportSettings?.gainDb ?? 4}
                    onChange={(e) => handleUpdateExportSettings({ gainDb: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">dB attenuation</label>
                  <input
                    type="number"
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={project?.exportSettings?.attenuationDb ?? 4}
                    onChange={(e) => handleUpdateExportSettings({ attenuationDb: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">transformed pan range</label>
                  <input
                    type="number"
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={project?.exportSettings?.transformedPanRange ?? 100}
                    onChange={(e) => handleUpdateExportSettings({ transformedPanRange: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
            <div className="border-t border-gray-700 px-4 py-3 flex justify-end">
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white rounded px-3 py-2 text-sm"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor(ms % 1000);

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

export default Editor;
