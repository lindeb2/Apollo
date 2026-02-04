import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Upload, Play, Pause, Square, Volume2, Circle, Download, SkipBack, SkipForward, Plus } from 'lucide-react';
import useStore from '../store/useStore';
import { audioManager } from '../lib/audioManager';
import { recordingManager } from '../lib/recordingManager';
import { storeMediaBlob, getMediaBlob } from '../lib/db';
import { createTrack, createClip } from '../types/project';
import FileImport from './FileImport';
import TrackList from './TrackList';
import Timeline from './Timeline';
import ExportDialog from './ExportDialog';
import { volumeToDb } from '../utils/audio';
import useKeyboardShortcuts from '../utils/useKeyboardShortcuts';
import { processRecordingOverwrites } from '../utils/clipCollision';

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
  const [masterVolume, setMasterVolume] = useState(100);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [mediaMap, setMediaMap] = useState(new Map());
  const [recordingSegments, setRecordingSegments] = useState([]);
  const recordingOriginalClipsRef = useRef(null);
  const previousTimeRef = useRef(0);
  const recordingStartTimeRef = useRef(0);
  const projectRef = useRef(project);
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
    if (project) {
      setProjectNameDraft(project.projectName);
    }
  }, [project?.projectName]);

  useEffect(() => {
    if (!project) return;
    if (!project.tracks || project.tracks.length === 0) {
      if (selectedTrackId !== null) {
        selectTrack(null);
      }
      return;
    }

    const hasSelected = project.tracks.some(track => track.id === selectedTrackId);
    if (!hasSelected) {
      selectTrack(project.tracks[0].id);
    }
  }, [project, selectedTrackId, selectTrack]);

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

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">No project loaded</p>
      </div>
    );
  }

  const hasNoTracks = !project.tracks || project.tracks.length === 0;

  useEffect(() => {
    if (hasNoTracks && !showFileImport) {
      setShowFileImport(true);
    }
  }, [hasNoTracks]);

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
      const segmentEnd = project.loop.endMs;
      
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
      
      // Update the segment with the blobId
      const updatedSegments = recordingSegments.map((seg, idx) => 
        idx === recordingSegments.length - 1 
          ? { ...seg, blobId, clip }
          : seg
      );
      
      // Get current track state
      const track = project.tracks.find(t => t.id === selectedTrackId);
      if (!track) return;
      
      // Apply overwrites for this segment
      let updatedClips = processRecordingOverwrites(segmentStart, segmentEnd, track.clips);
      
      // Add the new clip
      updatedClips = [...updatedClips, clip];
      
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
      setRecordingSegments([...updatedSegments, { startTimeMs: project.loop.startMs }]);
      
      console.log('New recording segment started at loop start');
    } catch (error) {
      console.error('Failed to handle loop wrap during recording:', error);
    }
  };

  const handleRecordingOverwrite = (currentTime) => {
    if (recordingSegments.length === 0 || !selectedTrackId) return;
    
    const currentSegment = recordingSegments[recordingSegments.length - 1];
    const recordingStart = currentSegment.startTimeMs;
    const recordingEnd = currentTime;
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
      const recordingEnd = currentTimeMs; // Capture the final recording end position
      
      const arrayBuffer = await result.blob.arrayBuffer();
      const audioBuffer = await audioManager.decodeAudioFile(arrayBuffer);
      const wavBlob = audioManager.audioBufferToBlob(audioBuffer);
      const fileName = `recording_final_${Date.now()}.wav`;
      const blobId = await storeMediaBlob(fileName, audioBuffer, wavBlob);

      audioManager.mediaCache.set(blobId, audioBuffer);

      const totalDurationMs = audioBuffer.duration * 1000;

      // Create clip for final segment
      const finalClip = createClip(blobId, recordingStart, totalDurationMs);
      
      // Update the final segment
      const finalSegments = recordingSegments.map((seg, idx) => 
        idx === recordingSegments.length - 1 
          ? { ...seg, blobId, clip: finalClip }
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
        
        await recordingManager.startRecording(selectedTrackId, currentTimeMs);
        startRecording();
        
        // Initialize first recording segment
        recordingStartTimeRef.current = currentTimeMs;
        setRecordingSegments([{ startTimeMs: currentTimeMs }]);
        
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
        const track = createTrack(trackName, role, true);

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

    updateProject((proj) => ({
      ...proj,
      tracks: [...proj.tracks, ...newTracks],
    }), 'Import audio files');

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
    updateProject((proj) => ({
      ...proj,
      tracks: proj.tracks.map(track =>
        track.id === trackId ? { ...track, ...updates } : track
      ),
    }), `Update track`);

    if (isPlaying) {
      if (updates.volume !== undefined) {
        audioManager.updateTrackVolume(trackId, updates.volume);
      }
      if (updates.pan !== undefined) {
        audioManager.updateTrackPan(trackId, updates.pan);
      }
    }
  };

  const handleMasterVolumeDoubleClick = () => {
    const newValue = prompt('Enter master volume (0-100):', masterVolume);
    if (newValue !== null) {
      const parsed = parseFloat(newValue);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        setMasterVolume(parsed);
      }
    }
  };

  const commitProjectName = () => {
    const nextName = projectNameDraft.trim();
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

  const handleAddEmptyTrack = () => {
    const trackNumber = project.tracks.length + 1;
    const trackName = `Track ${trackNumber}`;
    const newTrack = createTrack(trackName, 'other', false);
    
    updateProject((proj) => ({
      ...proj,
      tracks: [...proj.tracks, newTrack],
    }), 'Add empty track');
    
    // Select the new track
    selectTrack(newTrack.id);
  };

  const handleDeleteTrack = () => {
    if (!selectedTrackId) {
      return; // No track selected
    }

    const track = project.tracks.find(t => t.id === selectedTrackId);
    if (!track) {
      return; // Track not found
    }

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
    updateProject((proj) => ({
      ...proj,
      tracks: proj.tracks.filter(t => t.id !== selectedTrackId),
    }), `Delete track "${track.name}"`);
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
    onPlayPause: handlePlay,
    onRecord: handleRecord,
    onToggleLoop: handleToggleLoop,
    onUndo: undo,
    onRedo: redo,
    onDeleteTrack: handleDeleteTrack,
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between gap-6">
          {/* Group 1: Back button and project name */}
          <div className="flex items-center gap-4 min-w-0 flex-shrink">
            <button
              onClick={onBackToDashboard}
              className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
              title="Back to Dashboard"
            >
              <ArrowLeft size={20} />
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

          {/* Group 2: Transport controls */}
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

          {/* Group 3: Time display */}
          <div className="flex-shrink-0">
            <div className="text-xl font-mono bg-gray-900 px-3 py-1 rounded">
              {formatTime(currentTimeMs)}
            </div>
          </div>

          {/* Group 4: Volume, Import, Export */}
          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Volume2 size={18} className="text-gray-400" />
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={masterVolume}
                onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
                onDoubleClick={handleMasterVolumeDoubleClick}
                className="w-28 volume-slider cursor-pointer"
                title="Master Volume (double-click for numeric input)"
              />
              <span className="text-xs text-gray-500 w-16 text-right">
                {masterVolume === 0 ? '-∞ dB' : `${volumeToDb(masterVolume).toFixed(1)} dB`}
              </span>
            </div>

            <button
              onClick={handleAddEmptyTrack}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded transition-colors"
              title="Add empty track"
            >
              <Plus size={16} />
              <span className="text-sm">Add Track</span>
            </button>

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
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden" style={{ minWidth: 0 }}>
        {/* Track List Sidebar */}
        <div className="w-96 min-w-96 max-w-96 bg-gray-850 border-r border-gray-700 flex flex-col overflow-hidden">
          <div className="bg-gray-800 px-4 py-3 border-b border-gray-700 overflow-hidden">
            <h2 className="font-semibold">Tracks</h2>
            <p className="text-xs text-gray-500 mt-1">
              {project.tracks.length} track{project.tracks.length !== 1 ? 's' : ''}
            </p>
          </div>
          
          <div 
            ref={trackListScrollRef}
            className="flex-1 overflow-auto scrollbar-hidden"
            onScroll={handleTrackListScroll}
          >
            <TrackList
              tracks={project.tracks}
              onUpdateTrack={handleUpdateTrack}
              onSelectTrack={selectTrack}
              selectedTrackId={selectedTrackId}
            />
          </div>
        </div>

        {/* Timeline Area */}
        <div className="flex-1 flex flex-col bg-gray-900" style={{ minWidth: 0 }}>
          {hasNoTracks ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-gray-500">
                <Upload size={48} className="mx-auto mb-4 opacity-50" />
                <p className="text-lg mb-2">No tracks yet</p>
                <p className="text-sm">Click Import to add audio files</p>
              </div>
            </div>
          ) : (
            <Timeline
              project={project}
              currentTimeMs={currentTimeMs}
              isPlaying={isPlaying}
              isRecording={isRecording}
              recordingSegments={recordingSegments}
              selectedTrackId={selectedTrackId}
              onUpdateClip={updateClip}
              onSelectTrack={selectTrack}
              onSeek={handleSeek}
              onVerticalScroll={handleTimelineScroll}
              scrollContainerRef={timelineScrollRef}
              updateProject={updateProject}
            />
          )}
        </div>
      </div>

      {showFileImport && (
        <FileImport
          onImport={handleFileImport}
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
