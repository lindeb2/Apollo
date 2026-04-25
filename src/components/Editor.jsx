import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { ArrowLeft, Download, Play, Pause, Square, Volume2, Circle, Upload, SkipBack, SkipForward, Settings, Lock, WifiOff } from 'lucide-react';
import useStore from '../store/useStore';
import { audioManager } from '../lib/audioManager';
import { recordingManager } from '../lib/recordingManager';
import { storeMediaBlob, getMediaBlob } from '../lib/db';
import { createTrack, createClip, normalizeExportSettings, TRACK_ROLES } from '../types/project';
import FileImport from './FileImport';
import TrackList from './TrackList';
import Timeline from './Timeline';
import ExportDialog from './ExportDialog';
import CreditsEditorDialog from './CreditsEditorDialog';
import { dbToVolume, volumeToDb } from '../utils/audio';
import { applyChoirAutoPanToProject } from '../utils/choirAutoPan';
import { PlaybackDevicesSettingsPanel, ProjectSettingsPanel } from './SettingsPanels';
import useKeyboardShortcuts from '../utils/useKeyboardShortcuts';
import { processRecordingOverwrites } from '../utils/clipCollision';
import { isPrimaryModifierPressed } from '../utils/keyboard';
import { reportUserError } from '../utils/errorReporter';
import { buildBlobReferenceErrorMessage } from '../utils/mediaErrors';
import { measureTuttiPeak } from '../lib/exportEngine';
import useRealtimeProjectSync from '../hooks/useRealtimeProjectSync';
import { downloadMediaBlob, forceCheckpoint } from '../lib/serverApi';
import { createId } from '../utils/id';
import {
  cacheRemoteBlobAsLocalWav,
  prepareMediaForImportSource,
  prepareRecordedMedia,
  SUPPORTED_IMPORT_EXTENSIONS,
} from '../lib/mediaEncoding';
import { registerAndUploadMediaBlob } from '../lib/mediaUpload';
import {
  GROUP_ROLE_CHOIRS,
  GROUP_ROLE_NONE,
  isChoirRole,
  isGroupParentRole,
  isMetronomeRole,
  groupRoleToTrackRole,
} from '../utils/trackRoles';
import {
  attachTrackNode,
  createGroupNode,
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
  syncDirectChildRolesFromGroupCategories,
  TRACK_NODE_TYPE_AUDIO,
  TRACK_NODE_TYPE_GROUP,
  toggleGroupCollapsed,
} from '../utils/trackTree';
import { usePlaybackDeviceSettings } from '../hooks/usePlaybackDeviceSettings';

const TRACK_CONFIG_COLUMN_WIDTH_PX = 384;
const VALUE_ANIMATION_DURATION_MS = 800;

function easeInOutQuint(t) {
  if (t < 0.5) {
    return 16 * t * t * t * t * t;
  }
  return 1 - Math.pow(-2 * t + 2, 5) / 2;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const isFileDragEvent = (event) => {
  const types = event?.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes('Files'));
};

const getSupportedAudioFiles = (dataTransfer) => {
  const files = Array.from(dataTransfer?.files || []);
  return files.filter((file) => {
    const extension = file.name.toLowerCase().split('.').pop();
    return SUPPORTED_IMPORT_EXTENSIONS.has(extension);
  });
};

function Editor({ onBackToDashboard, onSwitchToPlayerMode = null, remoteSession = null }) {
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
  const [settingsTab, setSettingsTab] = useState('playback');
  const [masterVolume, setMasterVolume] = useState(() => toFiniteNumber(project?.masterVolume, 100));
  const [masterEditTooltip, setMasterEditTooltip] = useState(null);
  const [masterDragTooltip, setMasterDragTooltip] = useState(null);
  const [showDisconnectedIndicator, setShowDisconnectedIndicator] = useState(false);
  const [trackListContextMenu, setTrackListContextMenu] = useState(null);
  const [trackCreditsEditor, setTrackCreditsEditor] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedRowKind, setSelectedRowKind] = useState(null);
  const masterDragRef = useRef(null);
  const masterVolumeRef = useRef(toFiniteNumber(project?.masterVolume, 100));
  const masterAnimationFrameRef = useRef(null);
  const [mediaMap, setMediaMap] = useState(new Map());
  const [recordingSegments, setRecordingSegments] = useState([]);
  const [recordingOffsetMs, setRecordingOffsetMs] = useState(0);
  const lastMasterRightClickRef = useRef(0);
  const isNormalizingMasterRef = useRef(false);
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
  const timelineRowsScrollAreaRef = useRef(null);
  const recordingLockTrackIdRef = useRef(null);
  const lockByTrackIdRef = useRef({});
  const isHostedSession = Boolean(remoteSession?.session && remoteSession?.serverProjectId);
  const remoteUserId = remoteSession?.session?.user?.id || null;
  const {
    audioInputs,
    audioOutputs,
    audioSettings,
    outputChannelCount,
    playbackPanLawDb,
    refreshAudioDevices,
    setAudioSettings,
  } = usePlaybackDeviceSettings({
    errorPrefix: 'editor',
    onRecordingOffsetChange: setRecordingOffsetMs,
  });
  const applyEditorPlaybackOutputConfig = useCallback(async () => {
    await audioManager.setPlaybackOutputConfig({
      outputDeviceId: audioSettings.outputDeviceId,
      outputChannelCount,
      forceMonoOutput: audioSettings.forceMonoOutput,
      panLawDb: playbackPanLawDb,
    });
  }, [
    audioSettings.forceMonoOutput,
    audioSettings.outputDeviceId,
    outputChannelCount,
    playbackPanLawDb,
  ]);

  const createEphemeralMediaEntry = useCallback((blobId, fileName, audioBuffer, blob) => ({
    blobId,
    fileName,
    sampleRate: audioBuffer.sampleRate,
    durationMs: audioBuffer.duration * 1000,
    channels: audioBuffer.numberOfChannels,
    blob,
    createdAt: Date.now(),
  }), []);

  const persistImportedMedia = useCallback(async (file, audioBuffer) => {
    const prepared = await prepareMediaForImportSource({
      sourceBlob: file,
      sourceFileName: file?.name || 'audio.wav',
      sourceMimeType: file?.type || '',
      audioBuffer,
    });

    let blobId = createId();
    if (isHostedSession) {
      const uploaded = await registerAndUploadMediaBlob({
        mediaId: blobId,
        blob: prepared.serverUploadBlob,
        fileName: prepared.serverUploadFileName,
        mimeType: prepared.serverUploadMimeType,
        session: remoteSession.session,
        projectId: remoteSession.serverProjectId,
      });
      blobId = uploaded.mediaId;
    }

    await storeMediaBlob(prepared.localCacheFileName, audioBuffer, prepared.localCacheBlob, blobId);
    audioManager.mediaCache.set(blobId, audioBuffer);

    return {
      blobId,
      durationMs: audioBuffer.duration * 1000,
    };
  }, [isHostedSession, remoteSession?.session]);

  const persistRecordedMedia = useCallback(async (audioBuffer, fileNameBase) => {
    const prepared = await prepareRecordedMedia({ audioBuffer, fileNameBase });

    let blobId = createId();
    if (isHostedSession) {
      const uploaded = await registerAndUploadMediaBlob({
        mediaId: blobId,
        blob: prepared.serverUploadBlob,
        fileName: prepared.serverUploadFileName,
        mimeType: prepared.serverUploadMimeType,
        session: remoteSession.session,
        projectId: remoteSession.serverProjectId,
      });
      blobId = uploaded.mediaId;
    }

    await storeMediaBlob(prepared.localCacheFileName, audioBuffer, prepared.localCacheBlob, blobId);
    audioManager.mediaCache.set(blobId, audioBuffer);

    return {
      blobId,
      durationMs: audioBuffer.duration * 1000,
    };
  }, [isHostedSession, remoteSession?.session]);

  const {
    connected: syncConnected,
    syncError,
    remoteAnimation,
    lockByTrackId,
    lockHelpers,
  } = useRealtimeProjectSync({
    enabled: isHostedSession,
    project,
    remoteSession,
    updateProject,
  });

  useEffect(() => {
    lockByTrackIdRef.current = lockByTrackId || {};
  }, [lockByTrackId]);

  useEffect(() => {
    if (!isHostedSession) {
      setShowDisconnectedIndicator(false);
      return undefined;
    }
    if (syncConnected) {
      setShowDisconnectedIndicator(false);
      return undefined;
    }
    const timeoutId = setTimeout(() => {
      setShowDisconnectedIndicator(true);
    }, 2500);
    return () => clearTimeout(timeoutId);
  }, [isHostedSession, syncConnected]);

  // Keep project ref updated
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    masterVolumeRef.current = masterVolume;
  }, [masterVolume]);

  const stopMasterVolumeAnimation = useCallback(() => {
    if (masterAnimationFrameRef.current) {
      cancelAnimationFrame(masterAnimationFrameRef.current);
      masterAnimationFrameRef.current = null;
    }
  }, []);

  const startMasterVolumeAnimation = useCallback(
    (fromRaw, toRaw, durationRaw = VALUE_ANIMATION_DURATION_MS) => {
      const from = toFiniteNumber(fromRaw, masterVolumeRef.current);
      const to = toFiniteNumber(toRaw, from);
      const durationMs = Math.max(1, Number(durationRaw) || VALUE_ANIMATION_DURATION_MS);

      stopMasterVolumeAnimation();

      if (Math.abs(from - to) <= 1e-6) {
        masterVolumeRef.current = to;
        setMasterVolume(to);
        return;
      }

      masterVolumeRef.current = from;
      setMasterVolume(from);

      const startedAt = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - startedAt) / durationMs);
        const eased = easeInOutQuint(progress);
        const nextValue = from + ((to - from) * eased);
        masterVolumeRef.current = nextValue;
        setMasterVolume(nextValue);

        if (progress < 1) {
          masterAnimationFrameRef.current = requestAnimationFrame(step);
          return;
        }

        masterAnimationFrameRef.current = null;
        masterVolumeRef.current = to;
        setMasterVolume(to);
      };

      masterAnimationFrameRef.current = requestAnimationFrame(step);
    },
    [stopMasterVolumeAnimation]
  );

  useLayoutEffect(() => {
    if (!remoteAnimation?.token) return;
    const master = remoteAnimation?.masterVolume;
    if (!master) return;

    const from = masterAnimationFrameRef.current
      ? masterVolumeRef.current
      : toFiniteNumber(master?.from, masterVolumeRef.current);
    const to = toFiniteNumber(master?.to, from);
    const durationMs = Number(remoteAnimation.durationMs || VALUE_ANIMATION_DURATION_MS);
    startMasterVolumeAnimation(from, to, durationMs);
  }, [remoteAnimation?.token, startMasterVolumeAnimation]);

  useEffect(() => {
    if (!project) return;
    if (masterDragRef.current) return;
    if (masterAnimationFrameRef.current) return;

    const nextMaster = toFiniteNumber(project.masterVolume, 100);
    if (Math.abs(nextMaster - masterVolumeRef.current) <= 1e-6) return;
    masterVolumeRef.current = nextMaster;
    setMasterVolume(nextMaster);
  }, [project?.masterVolume]);

  useEffect(
    () => () => {
      stopMasterVolumeAnimation();
    },
    [stopMasterVolumeAnimation]
  );

  const headerProjectTitle = useMemo(() => {
    const projectName = String(
      remoteSession?.projectName
      || project?.projectName
      || 'Untitled Project'
    ).trim();
    const musicalNumber = String(
      remoteSession?.musicalNumber
      || project?.musicalNumber
      || '0.0'
    ).trim();
    return `${musicalNumber || '0.0'} - ${projectName || 'Untitled Project'}`;
  }, [remoteSession?.musicalNumber, remoteSession?.projectName, project?.musicalNumber, project?.projectName]);

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

  const loadProjectAudio = useCallback(async () => {
    const currentProject = projectRef.current;
    if (!currentProject) return;

    const blobIds = new Set();
    for (const track of currentProject.tracks) {
      for (const clip of track.clips) {
        blobIds.add(clip.blobId);
      }
    }

    const newMediaMap = new Map();
    for (const blobId of blobIds) {
      if (!audioManager.mediaCache.has(blobId)) {
        try {
          let media = null;
          try {
            media = await getMediaBlob(blobId);
          } catch (localError) {
            if (!isHostedSession) {
              throw localError;
            }

            try {
              const remoteBlob = await downloadMediaBlob(blobId, remoteSession.session, {
                projectId: remoteSession.serverProjectId,
              });
              const cachedRemoteMedia = await cacheRemoteBlobAsLocalWav({
                blobId,
                remoteBlob,
                decodeAudioFile: audioManager.decodeAudioFile.bind(audioManager),
                storeMediaBlob,
                fileName: `${blobId}.wav`,
              });
              audioManager.mediaCache.set(blobId, cachedRemoteMedia.audioBuffer);
              if (cachedRemoteMedia.storedLocally) {
                media = await getMediaBlob(blobId);
              } else {
                media = createEphemeralMediaEntry(
                  blobId,
                  cachedRemoteMedia.localCacheFileName,
                  cachedRemoteMedia.audioBuffer,
                  cachedRemoteMedia.fallbackBlob
                );
                reportUserError(
                  'Failed to persist downloaded media locally. Using in-memory audio for this session.',
                  cachedRemoteMedia.storeError,
                  { onceKey: `editor:cache-remote-media:${blobId}` }
                );
              }
            } catch (remoteError) {
              throw remoteError;
            }
          }

          await audioManager.loadAudioBuffer(blobId, media.blob);
          newMediaMap.set(blobId, media);
        } catch (error) {
          reportUserError(
            buildBlobReferenceErrorMessage(currentProject, blobId, 'clip audio'),
            error,
            { onceKey: `editor:load-audio-buffer:${blobId}` }
          );
        }
      } else {
        try {
          const media = await getMediaBlob(blobId);
          newMediaMap.set(blobId, media);
        } catch (error) {
          reportUserError(
            buildBlobReferenceErrorMessage(currentProject, blobId, 'clip media details'),
            error,
            { onceKey: `editor:load-media-data:${blobId}` }
          );
        }
      }
    }
    setMediaMap(newMediaMap);
  }, [createEphemeralMediaEntry, isHostedSession, remoteSession?.session]);

  // Initialize audio context on mount
  useEffect(() => {
    audioManager.init();

    return () => {
      audioManager.stop();
    };
  }, []);

  const mediaLoadSignature = useMemo(() => {
    if (!project?.tracks) return '';
    const ids = [];
    project.tracks.forEach((track) => {
      track.clips.forEach((clip) => {
        if (clip?.blobId) ids.push(clip.blobId);
      });
    });
    ids.sort();
    return ids.join('|');
  }, [project?.tracks]);

  useEffect(() => {
    if (!project || !project.tracks) return;
    loadProjectAudio().catch((error) => {
      reportUserError(
        'Failed to load project audio.',
        error,
        { onceKey: `editor:load-project-audio:${project.projectId}` }
      );
    });
  }, [project?.projectId, mediaLoadSignature, loadProjectAudio]);

  useEffect(() => {
    audioManager.setMasterVolume(masterVolume);
  }, [masterVolume]);

  useEffect(() => {
    void applyEditorPlaybackOutputConfig();
  }, [applyEditorPlaybackOutputConfig]);

  useEffect(() => {
    const handleMove = (e) => {
      if (!masterDragRef.current) return;
      const { startX, startValue, width, moved } = masterDragRef.current;
      const deltaX = e.clientX - startX;
      if (!moved) {
        if (Math.abs(deltaX) < 2) return;
        masterDragRef.current.moved = true;
        setMasterEditTooltip(null);
      }
      const next = Math.min(100, Math.max(0, startValue + (deltaX / width) * 100));
      if (Math.abs(next - masterDragRef.current.lastValue) < 1e-6) {
        setMasterDragTooltip(next);
        return;
      }
      masterDragRef.current.lastValue = next;
      masterVolumeRef.current = next;
      setMasterVolume(next);
      setMasterDragTooltip(next);
    };
    const handleUp = () => {
      const dragState = masterDragRef.current;
      masterDragRef.current = null;
      setMasterDragTooltip(null);
      if (!dragState || !dragState.moved) return;
      const finalValue = Number.isFinite(dragState.lastValue)
        ? dragState.lastValue
        : dragState.startValue;
      if (Math.abs(finalValue - dragState.startValue) < 1e-6) return;
      applyMasterVolume(finalValue);
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
    const getPlaybackEndMs = (currentProject) => {
      if (!currentProject?.tracks?.length) return 0;
      const mix = getEffectiveTrackMix(currentProject);
      let maxEndMs = 0;
      currentProject.tracks.forEach((track) => {
        const trackState = mix.statesByTrackId.get(track.id);
        if (!trackState?.audible) return;
        (track.clips || []).forEach((clip) => {
          if (clip?.muted) return;
          const clipStart = Number(clip?.timelineStartMs || 0);
          const clipDuration = Math.max(0, Number(clip?.cropEndMs || 0) - Number(clip?.cropStartMs || 0));
          if (clipDuration <= 0) return;
          const clipEnd = clipStart + clipDuration;
          if (Number.isFinite(clipEnd)) {
            maxEndMs = Math.max(maxEndMs, clipEnd);
          }
        });
      });
      return maxEndMs;
    };
    
    if (isPlaying) {
      // Reset loop wrap flag when starting playback
      isHandlingLoopWrapRef.current = false;
      
      // Stop existing audio and start new playback
      const startPlayback = async () => {
        if (isHandlingLoopWrapRef.current) return;
        
        audioManager.stop();
        if (!isCancelled) {
          await applyEditorPlaybackOutputConfig();
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

          const playbackEndMs = getPlaybackEndMs(currentProject);
          if (
            !currentProject.loop.enabled
            && !isRecording
            && playbackEndMs > 0
            && previousTime < playbackEndMs
            && newTime >= playbackEndMs
          ) {
            stop();
            audioManager.stop();
            setCurrentTime(0);
            previousTimeRef.current = 0;
            return;
          }
          
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
              applyEditorPlaybackOutputConfig()
                .then(() => audioManager.play(currentProject, currentProject.loop.startMs))
                .then(() => {
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
  }, [applyEditorPlaybackOutputConfig, isPlaying, project.projectId, isRecording, recordingSegments.length]);

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

  const waitForOwnTrackLock = async (trackId, timeoutMs = 2500) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const lockState = lockByTrackIdRef.current?.[trackId];
      if (lockState?.ownerUserId === remoteUserId) {
        return true;
      }
      if (lockState?.ownerUserId && lockState.ownerUserId !== remoteUserId) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return false;
  };

  const releaseRecordingLock = () => {
    const trackId = recordingLockTrackIdRef.current;
    if (!isHostedSession || !trackId) return;
    lockHelpers.release(trackId);
    recordingLockTrackIdRef.current = null;
  };

  useEffect(() => {
    if (!isHostedSession || !isRecording) return undefined;
    const trackId = recordingLockTrackIdRef.current;
    if (!trackId) return undefined;

    const intervalId = setInterval(() => {
      lockHelpers.heartbeat(trackId);
    }, 10000);

    return () => clearInterval(intervalId);
  }, [isHostedSession, isRecording, lockHelpers]);

  useEffect(() => {
    return () => {
      const trackId = recordingLockTrackIdRef.current;
      if (isHostedSession && trackId) {
        lockHelpers.release(trackId);
      }
      recordingLockTrackIdRef.current = null;
    };
  }, [isHostedSession, lockHelpers]);

  const treeProject = useMemo(
    () => (project ? normalizeTrackTree(project) : null),
    [project]
  );
  const timelineRows = useMemo(
    () => (treeProject ? getVisibleTimelineRows(treeProject) : []),
    [treeProject]
  );
  const trackEffectiveRoleById = useMemo(() => {
    if (!treeProject) return {};
    const mix = getEffectiveTrackMix(treeProject);
    const map = {};
    mix.statesByTrackId.forEach((state, trackId) => {
      map[trackId] = state.effectiveRole;
    });
    return map;
  }, [treeProject]);

  if (!project || !treeProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">No project loaded</p>
      </div>
    );
  }
  const hasNoTracks = !project.tracks || project.tracks.length === 0;
  const selectedTrackLock = selectedTrackId ? lockByTrackId?.[selectedTrackId] : null;
  const selectedTrackLockedByOther = Boolean(
    selectedTrackLock?.ownerUserId
    && selectedTrackLock.ownerUserId !== remoteUserId
  );
  const selectedTrackLockOwnerName = selectedTrackLock?.ownerName || 'another user';
  const recordButtonDisabled = hasNoTracks
    || !selectedTrackId
    || selectedRowKind !== 'track'
    || (isHostedSession && !isRecording && (!syncConnected || selectedTrackLockedByOther));

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
      const { blobId } = await persistRecordedMedia(audioBuffer, `recording_segment_${Date.now()}`);
      
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
      reportUserError(
        'Failed to process recording loop wrap.',
        error
      );
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
      const { blobId, durationMs: totalDurationMs } = await persistRecordedMedia(
        audioBuffer,
        `recording_final_${Date.now()}`
      );

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
    } finally {
      releaseRecordingLock();
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
      pause();
      await audioManager.pause(currentTimeMs);
    } else {
      // Start recording
      try {
        if (isHostedSession) {
          if (!syncConnected) {
            alert('Cannot record while disconnected from server.');
            return;
          }
          if (selectedTrackLockedByOther) {
            alert(`Track is locked by ${selectedTrackLockOwnerName}.`);
            return;
          }

          const lockSent = lockHelpers.acquire(selectedTrackId);
          if (!lockSent) {
            alert('Could not request recording lock. Try again.');
            return;
          }

          const lockGranted = await waitForOwnTrackLock(selectedTrackId);
          if (!lockGranted) {
            alert(`Track is locked by ${selectedTrackLockOwnerName}.`);
            return;
          }
          recordingLockTrackIdRef.current = selectedTrackId;
        }

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
        releaseRecordingLock();
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

        const { blobId, durationMs } = await persistImportedMedia(file, audioBuffer);

        const trackName = file.name.replace(/\.[^/.]+$/, '');
        const track = createTrack(trackName, role || TRACK_ROLES.INSTRUMENT);
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
      nextProject = syncDirectChildRolesFromGroupCategories(nextProject);
      return reorderTracksByTree(nextProject);
    }, 'Import audio files');

    console.log(`Import complete: ${newTracks.length} tracks added`);
  };

  const handleDropImportToTrackAtPlayhead = async (files, targetRow) => {
    if (!targetRow?.trackId || !targetRow?.nodeId || !files.length) return;

    const snapshotTrack = projectRef.current?.tracks?.find((track) => track.id === targetRow.trackId);
    if (!snapshotTrack || (snapshotTrack.clips?.length || 0) > 0) {
      return;
    }

    const importedFiles = [];
    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioManager.decodeAudioFile(arrayBuffer);
        const { blobId, durationMs } = await persistImportedMedia(file, audioBuffer);
        importedFiles.push({
          name: file.name.replace(/\.[^/.]+$/, ''),
          blobId,
          durationMs,
        });
      } catch (error) {
        console.error(`Failed to import ${file.name}:`, error);
        throw new Error(`Failed to import ${file.name}: ${error.message}`);
      }
    }

    if (!importedFiles.length) return;

    updateProject((proj) => {
      let nextProject = normalizeTrackTree(proj);
      const visibleRows = getVisibleTimelineRows(nextProject);
      const droppedIndex = visibleRows.findIndex((row) => row.nodeId === targetRow.nodeId);
      if (droppedIndex < 0) return nextProject;
      const droppedRow = visibleRows[droppedIndex];
      if (droppedRow.kind !== 'track') return nextProject;

      const trackById = new Map((nextProject.tracks || []).map((track) => [track.id, track]));
      const droppedTrack = trackById.get(droppedRow.trackId);
      if (!droppedTrack || (droppedTrack.clips?.length || 0) > 0) {
        return nextProject;
      }

      const emptyTrackIds = [];
      for (let idx = droppedIndex; idx < visibleRows.length; idx += 1) {
        const row = visibleRows[idx];
        if (row.kind !== 'track') continue;
        const track = trackById.get(row.trackId);
        if (track && (track.clips?.length || 0) === 0) {
          emptyTrackIds.push(track.id);
        }
      }

      const droppedNode = (nextProject.trackTree || []).find(
        (node) => node.kind === 'track' && node.id === droppedRow.nodeId
      );
      if (!droppedNode) return nextProject;
      const targetParentId = droppedNode.parentId ?? null;
      const dropRole = droppedTrack.role || TRACK_ROLES.INSTRUMENT;

      const addedTracks = [];
      const assignments = importedFiles.map((fileData, fileIndex) => {
        if (fileIndex < emptyTrackIds.length) {
          return { trackId: emptyTrackIds[fileIndex], fileData };
        }
        const newTrack = createTrack(fileData.name || `Track ${nextProject.tracks.length + addedTracks.length + 1}`, dropRole);
        addedTracks.push(newTrack);
        return { trackId: newTrack.id, fileData, isNewTrack: true };
      });

      if (addedTracks.length > 0) {
        nextProject = {
          ...nextProject,
          tracks: [...nextProject.tracks, ...addedTracks],
        };
      }

      const clipsByTrackId = new Map();
      assignments.forEach(({ trackId, fileData }) => {
        const clip = createClip(fileData.blobId, currentTimeMs, fileData.durationMs);
        const existing = clipsByTrackId.get(trackId) || [];
        existing.push(clip);
        clipsByTrackId.set(trackId, existing);
      });

      nextProject = {
        ...nextProject,
        tracks: nextProject.tracks.map((track) => {
          const clipsToAdd = clipsByTrackId.get(track.id);
          if (!clipsToAdd?.length) return track;
          return {
            ...track,
            clips: [...track.clips, ...clipsToAdd],
          };
        }),
      };

      if (addedTracks.length > 0) {
        const siblings = (nextProject.trackTree || [])
          .filter((node) => (node.parentId ?? null) === targetParentId)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const droppedSiblingIndex = siblings.findIndex((node) => node.id === droppedNode.id);
        let insertIndex = droppedSiblingIndex >= 0 ? droppedSiblingIndex + 1 : siblings.length;

        addedTracks.forEach((newTrack) => {
          nextProject = attachTrackNode(nextProject, newTrack.id, targetParentId, insertIndex);
          insertIndex += 1;
        });
      }

      nextProject = syncDirectChildRolesFromGroupCategories(nextProject);
      return reorderTracksByTree(nextProject);
    }, 'Drop import audio files');
  };

  const handleDropImportToNewTracksAtPlayhead = async (files) => {
    if (!files.length) return null;

    const importedFiles = [];
    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioManager.decodeAudioFile(arrayBuffer);
        const { blobId, durationMs } = await persistImportedMedia(file, audioBuffer);
        importedFiles.push({
          name: file.name.replace(/\.[^/.]+$/, ''),
          blobId,
          durationMs,
        });
      } catch (error) {
        console.error(`Failed to import ${file.name}:`, error);
        throw new Error(`Failed to import ${file.name}: ${error.message}`);
      }
    }

    if (!importedFiles.length) return null;

    const newTracks = importedFiles.map((fileData, index) => {
      const fallbackName = `Track ${projectRef.current?.tracks?.length + index + 1 || index + 1}`;
      const track = createTrack(fileData.name || fallbackName, TRACK_ROLES.INSTRUMENT);
      track.clips.push(createClip(fileData.blobId, currentTimeMs, fileData.durationMs));
      return track;
    });
    const firstTrackId = newTracks[0]?.id || null;

    updateProject((proj) => {
      let nextProject = {
        ...proj,
        tracks: [...proj.tracks, ...newTracks],
      };
      nextProject = normalizeTrackTree(nextProject);
      newTracks.forEach((track) => {
        nextProject = attachTrackNode(nextProject, track.id);
      });
      nextProject = syncDirectChildRolesFromGroupCategories(nextProject);
      return reorderTracksByTree(nextProject);
    }, 'Drop import audio files');

    return firstTrackId;
  };

  const getTrackRowAtClientY = (clientY) => {
    const scrollArea = timelineRowsScrollAreaRef.current;
    if (!scrollArea) return null;
    const rect = scrollArea.getBoundingClientRect();
    if (clientY < rect.top || clientY > rect.bottom) return null;
    const yWithinContent = clientY - rect.top + scrollArea.scrollTop;
    let cursor = 0;
    for (const row of timelineRows) {
      const rowEnd = cursor + row.height;
      if (yWithinContent >= cursor && yWithinContent < rowEnd) {
        return row.kind === 'track' ? row : null;
      }
      cursor = rowEnd;
    }
    return null;
  };

  const isDropInsideTimelineFreeArea = (clientX, clientY) => {
    const scrollArea = timelineRowsScrollAreaRef.current;
    if (!scrollArea) return false;

    const rect = scrollArea.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return false;
    }

    const xWithin = clientX - rect.left;
    if (xWithin < TRACK_CONFIG_COLUMN_WIDTH_PX) {
      return false;
    }

    const yWithinContent = clientY - rect.top + scrollArea.scrollTop;
    const renderedRowsHeight = timelineRows.reduce((sum, row) => sum + row.height, 0);
    return yWithinContent >= renderedRowsHeight;
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
      const wasChoirTrack = isChoirRole(previousTrack?.role);
      const previousMix = getEffectiveTrackMix(proj);
      const previousState = previousMix.statesByTrackId.get(trackId);
      const previousChoirUnitId = previousState?.choirUnitId
        || previousState?.roleUnitId
        || `track:${trackId}`;
      const isDirectChoirPartTrack = (
        previousState?.effectiveRole === TRACK_ROLES.CHOIR
        && previousChoirUnitId === `track:${trackId}`
      );
      const nextTracks = proj.tracks.map((track) =>
        track.id === trackId ? { ...track, ...updates } : track
      );
      let nextProject = {
        ...proj,
        tracks: nextTracks,
      };

      if (updates.part !== undefined) {
        const nextPart = Boolean(updates.part);
        nextProject = normalizeTrackTree({
          ...nextProject,
          trackTree: (nextProject.trackTree || []).map((node) => (
            node.kind === 'track' && node.trackId === trackId
              ? { ...node, part: nextPart }
              : node
          )),
        });
      }

      if (updates.role !== undefined) {
        nextProject = normalizeTrackTree(nextProject);
        if (isMetronomeRole(nextTracks.find((track) => track.id === trackId)?.role)) {
          nextProject = collapseEmptyGroupsToTracks(nextProject);
          nextProject = reorderTracksByTree(nextProject);
        }
      }

      if (updates.pan !== undefined && wasChoirTrack && proj.autoPan?.enabled && isDirectChoirPartTrack) {
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
        void applyEditorPlaybackOutputConfig().then(() => audioManager.play(nextProjectAfter, currentTimeMs));
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

  const artistRefsHaveSoloArtist = (artistRefs) => (
    Array.isArray(artistRefs)
    && artistRefs.some((ref) => {
      const type = String(ref?.type || '').trim().toLowerCase();
      return type === 'user' || type === 'guest';
    })
  );

  const clearDescendantArtistRefs = (proj, ancestorNodeId) => {
    const normalized = normalizeTrackTree(proj);
    const childrenByParent = new Map();
    (normalized.trackTree || []).forEach((node) => {
      const parentKey = node.parentId || '__root__';
      const children = childrenByParent.get(parentKey) || [];
      children.push(node);
      childrenByParent.set(parentKey, children);
    });

    const descendantNodeIds = new Set();
    const stack = [ancestorNodeId];
    while (stack.length) {
      const parentId = stack.pop();
      (childrenByParent.get(parentId) || []).forEach((child) => {
        descendantNodeIds.add(child.id);
        stack.push(child.id);
      });
    }
    if (!descendantNodeIds.size) {
      return normalized;
    }

    const descendantTrackIds = new Set();
    const nextTree = (normalized.trackTree || []).map((node) => {
      if (!descendantNodeIds.has(node.id)) return node;
      if (node.kind === 'track' && node.trackId) {
        descendantTrackIds.add(String(node.trackId));
        return node;
      }
      if (node.kind === 'group' && Array.isArray(node.artistRefs) && node.artistRefs.length) {
        return { ...node, artistRefs: [] };
      }
      return node;
    });
    const nextTracks = (normalized.tracks || []).map((track) => {
      if (!descendantTrackIds.has(String(track.id)) || !Array.isArray(track.artistRefs) || !track.artistRefs.length) {
        return track;
      }
      return { ...track, artistRefs: [] };
    });
    return normalizeTrackTree({
      ...normalized,
      trackTree: nextTree,
      tracks: nextTracks,
    });
  };

  const enforceSoloArtistAncestorRule = (proj) => {
    const normalized = normalizeTrackTree(proj);
    const tracksById = new Map((normalized.tracks || []).map((track) => [track.id, track]));
    let nextProject = normalized;
    (normalized.trackTree || []).forEach((node) => {
      const artistRefs = node.kind === 'group'
        ? node.artistRefs
        : tracksById.get(node.trackId)?.artistRefs;
      if (artistRefsHaveSoloArtist(artistRefs)) {
        nextProject = clearDescendantArtistRefs(nextProject, node.id);
      }
    });
    return nextProject;
  };

  const applyTrackArtistRefs = (trackId, artistRefs) => {
    updateProject((proj) => {
      let nextProject = normalizeTrackTree({
        ...proj,
        tracks: (proj.tracks || []).map((track) => (
          track.id === trackId ? { ...track, artistRefs } : track
        )),
      });
      return enforceSoloArtistAncestorRule(nextProject);
    }, 'Update track artists');
  };

  const applyGroupArtistRefs = (groupNodeId, artistRefs) => {
    updateProject((proj) => {
      let nextProject = updateGroupNode(proj, groupNodeId, { artistRefs });
      return enforceSoloArtistAncestorRule(nextProject);
    }, 'Update group artists');
  };

  const handleEditTrackArtists = (track) => {
    if (!track?.id) return;
    setTrackCreditsEditor({
      kind: 'track',
      trackId: track.id,
      title: `Artists - ${track.name || 'Untitled track'}`,
      artistRefs: Array.isArray(track.artistRefs) ? track.artistRefs : [],
    });
  };

  const handleEditGroupArtists = (group) => {
    if (!group?.nodeId) return;
    setTrackCreditsEditor({
      kind: 'group',
      groupNodeId: group.nodeId,
      title: `Artists - ${group.name || 'Untitled group'}`,
      artistRefs: Array.isArray(group.artistRefs) ? group.artistRefs : [],
    });
  };

  const getDirectChildRoleSnapshot = (proj, groupNodeId) => {
    const normalized = normalizeTrackTree(proj);
    const tracksById = new Map((normalized.tracks || []).map((track) => [track.id, track]));
    return (normalized.trackTree || [])
      .filter((node) => (node.parentId ?? null) === groupNodeId)
      .map((node) => {
        if (node.kind === 'track') {
          return {
            kind: 'track',
            nodeId: node.id,
            trackId: node.trackId,
            role: tracksById.get(node.trackId)?.role ?? null,
          };
        }
        return {
          kind: 'group',
          nodeId: node.id,
          role: node.role,
        };
      });
  };

  const handleUpdateGroup = (groupNodeId, updates) => {
    let nextProjectAfter = null;
    const beforeChildren = updates.role !== undefined
      ? getDirectChildRoleSnapshot(project, groupNodeId)
      : null;
    updateProject((proj) => {
      let nextProject = updateGroupNode(proj, groupNodeId, updates);
      if (updates.role !== undefined) {
        nextProject = syncDirectChildRolesFromGroupCategories(nextProject);
      }
      const wasChoirGroup = (proj.trackTree || []).some(
        (node) => node.id === groupNodeId && node.kind === 'group' && (
          isChoirRole(node.role) || (isGroupParentRole(node.role) && node.role === GROUP_ROLE_CHOIRS)
        )
      );
      const nextChoirGroup = (nextProject.trackTree || []).some(
        (node) => node.id === groupNodeId && node.kind === 'group' && (
          isChoirRole(node.role) || (isGroupParentRole(node.role) && node.role === GROUP_ROLE_CHOIRS)
        )
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

    if (updates.role !== undefined && nextProjectAfter) {
      const afterChildren = getDirectChildRoleSnapshot(nextProjectAfter, groupNodeId);
      const updatedGroup = (nextProjectAfter.trackTree || []).find(
        (node) => node.id === groupNodeId && node.kind === 'group'
      );
      console.debug('[GroupRoleApply]', {
        groupNodeId,
        groupName: updatedGroup?.name,
        requestedRole: updates.role,
        appliedGroupRole: updatedGroup?.role,
        beforeChildren,
        afterChildren,
      });
    }

    if (isPlaying && nextProjectAfter) {
      const shouldRestart = updates.muted !== undefined || updates.soloed !== undefined;
      if (shouldRestart) {
        audioManager.stop();
        void applyEditorPlaybackOutputConfig().then(() => audioManager.play(nextProjectAfter, currentTimeMs));
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
      nextProject = syncDirectChildRolesFromGroupCategories(nextProject);
      nextProject = collapseEmptyGroupsToTracks(nextProject);
      nextProject = reorderTracksByTree(nextProject);
      nextProject = enforceSoloArtistAncestorRule(nextProject);
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

  const handleConvertEmptyTrackAboveToGroup = (sourceTrackId, movingNodeId) => {
    let panUpdates = null;
    updateProject((proj) => {
      const normalized = normalizeTrackTree(proj);
      const sourceNode = getTrackNodeByTrackId(normalized, sourceTrackId);
      const movingNode = (normalized.trackTree || []).find((node) => node.id === movingNodeId);
      const sourceTrack = (normalized.tracks || []).find((track) => track.id === sourceTrackId);

      if (!sourceNode || !movingNode || !sourceTrack) return normalized;
      if (isMetronomeRole(sourceTrack.role)) return normalized;
      if ((sourceTrack.clips?.length || 0) > 0) return normalized;
      if (sourceNode.id === movingNode.id) return normalized;

      const sourceParentId = sourceNode.parentId ?? null;
      const movingParentId = movingNode.parentId ?? null;
      const sourceOrder = Number.isFinite(Number(sourceNode.order)) ? Number(sourceNode.order) : 0;
      const groupNodeId = createId();
      const groupRole = sourceTrack.role || TRACK_ROLES.OTHER;

      const nextTree = (normalized.trackTree || [])
        .filter((node) => node.id !== sourceNode.id && node.id !== movingNode.id)
        .map((node) => ({ ...node }));

      const reindexParent = (parentId) => {
        const siblings = nextTree
          .filter((node) => (node.parentId ?? null) === (parentId ?? null))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        siblings.forEach((node, idx) => {
          node.order = idx;
        });
      };

      reindexParent(sourceParentId);
      if (movingParentId !== sourceParentId) {
        reindexParent(movingParentId);
      }

      const sourceSiblings = nextTree
        .filter((node) => (node.parentId ?? null) === sourceParentId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const insertionIndex = Math.max(0, Math.min(sourceOrder, sourceSiblings.length));
      sourceSiblings.forEach((node) => {
        if (node.order >= insertionIndex) {
          node.order += 1;
        }
      });

      nextTree.push({
        id: groupNodeId,
        kind: 'group',
        type: TRACK_NODE_TYPE_GROUP,
        parentId: sourceParentId,
        order: insertionIndex,
        name: sourceTrack.name,
        collapsed: false,
        muted: Boolean(sourceTrack.muted),
        soloed: Boolean(sourceTrack.soloed),
        volume: Number.isFinite(sourceTrack.volume) ? sourceTrack.volume : 100,
        pan: Number.isFinite(sourceTrack.pan) ? sourceTrack.pan : 0,
        role: groupRole,
        part: Boolean(sourceTrack.part) || groupRole !== GROUP_ROLE_NONE,
        artistRefs: Array.isArray(sourceTrack.artistRefs) ? sourceTrack.artistRefs : [],
      });

      nextTree.push({
        ...movingNode,
        type: movingNode.kind === 'track' ? TRACK_NODE_TYPE_AUDIO : TRACK_NODE_TYPE_GROUP,
        parentId: groupNodeId,
        order: 0,
      });

      reindexParent(sourceParentId);
      reindexParent(groupNodeId);

      let nextProject = {
        ...normalized,
        tracks: (normalized.tracks || []).filter((track) => track.id !== sourceTrackId),
        trackTree: nextTree,
      };

      nextProject = syncDirectChildRolesFromGroupCategories(nextProject);
      nextProject = collapseEmptyGroupsToTracks(nextProject);
      nextProject = reorderTracksByTree(nextProject);
      nextProject = enforceSoloArtistAncestorRule(nextProject);

      if (nextProject.autoPan?.enabled && !nextProject.autoPan?.manualChoirParts) {
        const result = applyChoirAutoPanToProject(nextProject);
        panUpdates = result.panUpdates;
        nextProject = result.project;
      }

      return nextProject;
    }, 'Indent track into empty track');

    if (isPlaying && panUpdates) {
      Object.entries(panUpdates).forEach(([id, pan]) => {
        audioManager.updateTrackPan(id, pan);
      });
    }
  };

  const handleIndentSelectedRight = () => {
    const currentIndex = selectedNodeId
      ? timelineRows.findIndex((row) => row.nodeId === selectedNodeId)
      : -1;
    if (currentIndex <= 0) return;

    const selectedRow = timelineRows[currentIndex];
    const rowAbove = timelineRows[currentIndex - 1];
    if (!selectedRow || !rowAbove) return;

    if (rowAbove.depth === selectedRow.depth + 1) {
      handleMoveNode(selectedRow.nodeId, rowAbove.nodeId, 'after');
      return;
    }

    if (rowAbove.kind === 'group') {
      handleMoveNode(selectedRow.nodeId, rowAbove.nodeId, 'inside');
      return;
    }

    if (rowAbove.kind === 'track' && (rowAbove.track?.clips?.length || 0) === 0) {
      handleConvertEmptyTrackAboveToGroup(rowAbove.trackId, selectedRow.nodeId);
    }
  };

  const handleIndentSelectedLeft = () => {
    const selectedRow = selectedNodeId
      ? timelineRows.find((row) => row.nodeId === selectedNodeId)
      : null;
    if (!selectedRow) return;
    if (!selectedRow.parentId) return;

    const parentGroup = (treeProject.trackTree || []).find(
      (node) => node.id === selectedRow.parentId && node.kind === 'group'
    );
    if (!parentGroup) return;

    const siblings = (treeProject.trackTree || [])
      .filter((node) => (node.parentId ?? null) === parentGroup.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const lastSibling = siblings[siblings.length - 1];
    if (!lastSibling || lastSibling.id !== selectedRow.nodeId) return;

    handleMoveNode(selectedRow.nodeId, parentGroup.id, 'after');
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
      const role = groupRoleToTrackRole(group.role);
      const restoredTrack = createTrack(group.name || 'Track', role);
      restoredTrack.muted = Boolean(group.muted);
      restoredTrack.soloed = Boolean(group.soloed);
      restoredTrack.volume = Number.isFinite(Number(group.volume)) ? Number(group.volume) : restoredTrack.volume;
      restoredTrack.pan = Number.isFinite(Number(group.pan)) ? Number(group.pan) : restoredTrack.pan;
      restoredTrack.part = Boolean(group.part);
      restoredTrack.artistRefs = Array.isArray(group.artistRefs) ? group.artistRefs : [];
      nextTracks.push(restoredTrack);
      nextTree.push({
        id: createId(),
        kind: 'track',
        type: TRACK_NODE_TYPE_AUDIO,
        parentId: group.parentId ?? null,
        order: Number.isFinite(Number(group.order)) ? Number(group.order) : 0,
        trackId: restoredTrack.id,
        part: Boolean(group.part),
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
    const normalizedBeforeDelete = normalizeTrackTree(project);
    const rowsBeforeDelete = getVisibleTimelineRows(normalizedBeforeDelete);
    const groupNode = (normalizedBeforeDelete.trackTree || []).find(
      (node) => node.kind === 'group' && node.id === groupNodeId
    );
    if (!groupNode) return;

    const deletedRowIndex = rowsBeforeDelete.findIndex((row) => row.nodeId === groupNodeId);
    const deletedParentId = groupNode.parentId ?? null;

    const nodeIdsToDelete = new Set([groupNodeId]);
    const descendantTrackIds = [];
    const stack = [groupNodeId];
    while (stack.length > 0) {
      const currentGroupId = stack.pop();
      const children = (normalizedBeforeDelete.trackTree || []).filter(
        (node) => (node.parentId ?? null) === currentGroupId
      );
      for (const child of children) {
        nodeIdsToDelete.add(child.id);
        if (child.kind === 'track' && child.trackId) {
          descendantTrackIds.push(child.trackId);
        } else if (child.kind === 'group') {
          stack.push(child.id);
        }
      }
    }

    const trackById = new Map((normalizedBeforeDelete.tracks || []).map((track) => [track.id, track]));
    const clipCount = descendantTrackIds.reduce(
      (sum, trackId) => sum + (trackById.get(trackId)?.clips?.length || 0),
      0
    );

    if (clipCount > 0) {
      const confirmed = window.confirm(
        `Are you sure you want to delete "${groupNode.name}" with ${clipCount} clip${clipCount !== 1 ? 's' : ''}?`
      );
      if (!confirmed) return;
    }

    let panUpdates = null;
    let nextRowSelection = null;
    updateProject((proj) => {
      let nextProject = normalizeTrackTree(proj);
      nextProject = {
        ...nextProject,
        tracks: (nextProject.tracks || []).filter((track) => !descendantTrackIds.includes(track.id)),
        trackTree: (nextProject.trackTree || []).filter((node) => !nodeIdsToDelete.has(node.id)),
      };
      nextProject = collapseEmptyGroupsToTracks(nextProject);
      nextProject = reorderTracksByTree(nextProject);

      if (nextProject.autoPan?.enabled && !nextProject.autoPan?.manualChoirParts) {
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
    }, `Delete group "${groupNode.name}"`);

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

  const handleToggleGroupCollapse = (groupNodeId) => {
    let shouldSelectCollapsedGroup = false;
    updateProject((proj) => {
      const normalized = normalizeTrackTree(proj);
      const targetGroup = (normalized.trackTree || []).find(
        (node) => node.kind === 'group' && node.id === groupNodeId
      );
      if (!targetGroup) return normalized;

      const willCollapse = !Boolean(targetGroup.collapsed);
      if (willCollapse && selectedNodeId) {
        if (selectedNodeId === groupNodeId) {
          shouldSelectCollapsedGroup = true;
        } else {
          const nodeById = new Map((normalized.trackTree || []).map((node) => [node.id, node]));
          let current = nodeById.get(selectedNodeId);
          while (current && current.parentId) {
            if (current.parentId === groupNodeId) {
              shouldSelectCollapsedGroup = true;
              break;
            }
            current = nodeById.get(current.parentId);
          }
        }
      }

      return toggleGroupCollapsed(normalized, groupNodeId);
    }, 'Toggle group collapse');

    if (shouldSelectCollapsedGroup) {
      setSelectedNodeId(groupNodeId);
      setSelectedRowKind('group');
      selectTrack(null);
    }
  };

  const handleMasterVolumeDoubleClick = () => {
    const currentValue = toFiniteNumber(masterVolumeRef.current, masterVolume);
    const display = currentValue <= 0 ? '-∞' : volumeToDb(currentValue).toFixed(1);
    setMasterEditTooltip({ text: display });
  };

  const handleNormalizeMasterVolume = async () => {
    if (!project) return;
    if (isNormalizingMasterRef.current) return;
    isNormalizingMasterRef.current = true;

    try {
      const confirmed = window.confirm('Normalize audio by adjusting master volume to 0 dBFS peak (no clipping)?');
      if (!confirmed) return;

      await loadProjectAudio();
      const { peak } = await measureTuttiPeak(projectRef.current, audioManager.mediaCache);
      if (!Number.isFinite(peak) || peak <= 0) {
        alert('Nothing to normalize (no audible audio found).');
        return;
      }

      // Target just under 0 dBFS to avoid tiny overs from floating point math.
      const targetPeak = 0.9999;
      const gainFactor = targetPeak / peak;

      const currentDb = volumeToDb(toFiniteNumber(masterVolumeRef.current, masterVolume));
      const desiredDb = currentDb + (20 * Math.log10(gainFactor));
      const nextVolume = dbToVolume(Math.max(-60, Math.min(6, desiredDb)));

      applyMasterVolume(nextVolume, {
        animate: true,
        durationMs: VALUE_ANIMATION_DURATION_MS,
      });

      if (gainFactor > 1 && nextVolume >= 100) {
        alert('Master volume is already at maximum; could not reach 0 dBFS peak without exceeding limits.');
      }
    } catch (error) {
      console.error('Master normalize failed:', error);
      alert(`Normalize failed: ${error.message || error}`);
    } finally {
      isNormalizingMasterRef.current = false;
    }
  };

  const handleMasterVolumeContextMenu = (e) => {
    e.preventDefault();
    const now = Date.now();
    const delta = now - lastMasterRightClickRef.current;
    lastMasterRightClickRef.current = now;
    if (delta > 0 && delta < 350) {
      handleNormalizeMasterVolume();
    }
  };

  const handleMasterVolumeMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stopMasterVolumeAnimation();
    if (masterEditTooltip) setMasterEditTooltip(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const currentValue = toFiniteNumber(masterVolumeRef.current, masterVolume);
    setMasterDragTooltip(currentValue);
    masterDragRef.current = {
      startX: e.clientX,
      startValue: currentValue,
      lastValue: currentValue,
      width: rect.width,
      moved: false,
    };
  };

  const applyMasterVolume = useCallback(
    (value, options = {}) => {
      const nextVolume = Math.min(100, Math.max(0, toFiniteNumber(value, masterVolumeRef.current)));
      const shouldAnimate = Boolean(options?.animate);
      const durationMs = Number(options?.durationMs || VALUE_ANIMATION_DURATION_MS);
      const currentUiMaster = toFiniteNumber(masterVolumeRef.current, nextVolume);
      const currentProjectMaster = toFiniteNumber(projectRef.current?.masterVolume, currentUiMaster);
      const projectNeedsUpdate = Math.abs(currentProjectMaster - nextVolume) > 1e-6;

      if (shouldAnimate) {
        startMasterVolumeAnimation(currentUiMaster, nextVolume, durationMs);
      } else {
        stopMasterVolumeAnimation();
        masterVolumeRef.current = nextVolume;
        setMasterVolume(nextVolume);
      }

      if (!projectNeedsUpdate) return;
      updateProject((proj) => ({
        ...proj,
        masterVolume: nextVolume,
      }), 'Set master volume');
    },
    [startMasterVolumeAnimation, stopMasterVolumeAnimation, updateProject]
  );

  const parseMasterVolumeInput = useCallback((rawText) => {
    const text = String(rawText || '').trim();
    if (!text) return dbToVolume(0);

    const normalized = text.toLowerCase();
    if (normalized === '-∞' || normalized === '-inf' || normalized === '-infinity') {
      return 0;
    }

    const parsed = parseFloat(text);
    if (Number.isNaN(parsed)) return null;
    return dbToVolume(Math.min(6, Math.max(-60, parsed)));
  }, []);

  const commitMasterEditTooltip = useCallback(() => {
    if (!masterEditTooltip) return;

    const nextVolume = parseMasterVolumeInput(masterEditTooltip.text);
    if (nextVolume !== null) {
      applyMasterVolume(nextVolume, {
        animate: true,
        durationMs: VALUE_ANIMATION_DURATION_MS,
      });
    }
    setMasterEditTooltip(null);
  }, [applyMasterVolume, masterEditTooltip, parseMasterVolumeInput]);

  const handleAddEmptyTrack = (options = null) => {
    const trackNumber = project.tracks.length + 1;
    const trackName = `Track ${trackNumber}`;
    const newTrack = createTrack(trackName, 'other');
    let panUpdates = null;

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
      nextProject = syncDirectChildRolesFromGroupCategories(nextProject);
      nextProject = reorderTracksByTree(nextProject);

      if (nextProject.autoPan?.enabled) {
        const result = applyChoirAutoPanToProject(nextProject);
        panUpdates = result.panUpdates;
        nextProject = result.project;
      }

      return nextProject;
    }, 'Add empty track');

    if (isPlaying && panUpdates) {
      Object.entries(panUpdates).forEach(([id, pan]) => {
        audioManager.updateTrackPan(id, pan);
      });
    }
    
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
    const wasChoir = isChoirRole(track.role);
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
    if (selectedRowKind === 'group' && selectedNodeId) {
      handleDeleteGroup(selectedNodeId);
      return;
    }
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
    if (isMetronomeRole(sourceTrack.role)) {
      alert('Metronome tracks must stay at the root level and cannot have children.');
      return;
    }
    if ((sourceTrack.clips?.length || 0) > 0) {
      alert('Create new subtrack only works from an empty track.');
      return;
    }

    const newTrackNumber = project.tracks.length + 1;
    const newTrack = createTrack(`Track ${newTrackNumber}`, 'other');
    let panUpdates = null;

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

      const groupRole = source.role || TRACK_ROLES.OTHER;
      const groupNodeId = createId();
      const childNodeId = createId();

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
          type: TRACK_NODE_TYPE_GROUP,
          parentId: sourceNode.parentId ?? null,
          order: groupOrder,
          name: source.name,
          collapsed: false,
          muted: Boolean(source.muted),
          soloed: Boolean(source.soloed),
          volume: Number.isFinite(source.volume) ? source.volume : 100,
          pan: Number.isFinite(source.pan) ? source.pan : 0,
          role: groupRole,
          part: Boolean(source.part) || groupRole !== GROUP_ROLE_NONE,
          artistRefs: Array.isArray(source.artistRefs) ? source.artistRefs : [],
        },
        {
          id: childNodeId,
          kind: 'track',
          type: TRACK_NODE_TYPE_AUDIO,
          parentId: groupNodeId,
          order: 0,
          trackId: newTrack.id,
          part: false,
        },
      ];

      let nextProject = syncDirectChildRolesFromGroupCategories({
        ...normalized,
        tracks: nextTracks,
        trackTree: nextTree,
      });
      nextProject = reorderTracksByTree(nextProject);
      nextProject = enforceSoloArtistAncestorRule(nextProject);

      if (nextProject.autoPan?.enabled) {
        const result = applyChoirAutoPanToProject(nextProject);
        panUpdates = result.panUpdates;
        nextProject = result.project;
      }

      return nextProject;
    }, 'Create subtrack');

    if (isPlaying && panUpdates) {
      Object.entries(panUpdates).forEach(([id, pan]) => {
        audioManager.updateTrackPan(id, pan);
      });
    }

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

  const getSelectedTargetGroupNodeId = () => {
    const selectedRow = selectedNodeId
      ? timelineRows.find((row) => row.nodeId === selectedNodeId)
      : null;
    if (!selectedRow) return null;
    if (selectedRow.kind === 'group') return selectedRow.nodeId;
    if (selectedRow.kind === 'track') return selectedRow.parentId ?? null;
    return null;
  };

  const handleToggleSelectedGroupFold = () => {
    const groupNodeId = getSelectedTargetGroupNodeId();
    if (!groupNodeId) return;
    handleToggleGroupCollapse(groupNodeId);
  };

  const handleToggleSelectedGroupFoldRecursive = () => {
    const groupNodeId = getSelectedTargetGroupNodeId();
    if (!groupNodeId) return;
    updateProject((proj) => {
      const normalized = normalizeTrackTree(proj);
      const rootGroup = (normalized.trackTree || []).find(
        (node) => node.kind === 'group' && node.id === groupNodeId
      );
      if (!rootGroup) return normalized;

      const targetCollapsed = !Boolean(rootGroup.collapsed);
      const descendantGroupIds = new Set([groupNodeId]);
      const stack = [groupNodeId];
      while (stack.length > 0) {
        const currentGroupId = stack.pop();
        const children = (normalized.trackTree || []).filter(
          (node) => node.kind === 'group' && (node.parentId ?? null) === currentGroupId
        );
        for (const child of children) {
          descendantGroupIds.add(child.id);
          stack.push(child.id);
        }
      }

      return {
        ...normalized,
        trackTree: (normalized.trackTree || []).map((node) => (
          node.kind === 'group' && descendantGroupIds.has(node.id)
            ? { ...node, collapsed: targetCollapsed }
            : node
        )),
      };
    }, 'Toggle group collapse recursively');
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
    onIndentRight: handleIndentSelectedRight,
    onIndentLeft: handleIndentSelectedLeft,
    onToggleFold: handleToggleSelectedGroupFold,
    onToggleFoldRecursive: handleToggleSelectedGroupFoldRecursive,
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
    <div
      className="h-full flex flex-col"
      onDragOver={(e) => {
        if (!isFileDragEvent(e)) return;
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={async (e) => {
        if (!isFileDragEvent(e)) return;
        e.preventDefault();

        const files = getSupportedAudioFiles(e.dataTransfer);
        if (!files.length) return;

        try {
          const targetRow = getTrackRowAtClientY(e.clientY);
          if (targetRow?.trackId) {
            await handleDropImportToTrackAtPlayhead(files, targetRow);
            handleSelectRow(targetRow);
            return;
          }

          if (isDropInsideTimelineFreeArea(e.clientX, e.clientY)) {
            const firstTrackId = await handleDropImportToNewTracksAtPlayhead(files);
            if (firstTrackId) {
              selectTrack(firstTrackId);
            }
          }
        } catch (error) {
          alert(`Import failed: ${error.message}`);
        }
      }}
    >
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
                setSettingsTab('playback');
                setSettingsOpen(true);
                refreshAudioDevices();
              }}
              className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
              title="Settings"
            >
              <Settings size={18} />
            </button>
            <h1 className="text-lg font-semibold truncate" title={headerProjectTitle}>
              {headerProjectTitle}
            </h1>
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
                  disabled={recordButtonDisabled}
                  className={`p-2 ${
                    isRecording
                      ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                      : 'bg-red-600 hover:bg-red-700'
                  } disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded transition-colors`}
                  title={
                    isRecording
                      ? 'Stop Recording'
                      : selectedTrackLockedByOther
                        ? `Locked by ${selectedTrackLockOwnerName}`
                        : (isHostedSession && !syncConnected)
                          ? 'Disconnected from server'
                          : 'Record'
                  }
                >
                  {!isRecording && selectedTrackLockedByOther ? (
                    <Lock size={18} />
                  ) : (
                    <Circle size={18} fill={isRecording ? 'currentColor' : 'none'} />
                  )}
                </button>

                {isHostedSession && showDisconnectedIndicator && !syncConnected && (
                  <div className="p-1 text-red-500" title="Disconnected from server">
                    <WifiOff size={18} />
                  </div>
                )}

                {isHostedSession && syncError && (
                  <div className="text-xs text-red-300 max-w-56 truncate" title={syncError}>
                    Sync error: {syncError}
                  </div>
                )}
              </div>

              <div className="flex-shrink-0 flex flex-col items-center">
                <div className="text-xl font-mono bg-gray-900 px-3 py-1 rounded">
                  {formatTime(currentTimeMs)}
                </div>
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
                      onContextMenu={handleMasterVolumeContextMenu}
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
                        onBlur={commitMasterEditTooltip}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.currentTarget.blur();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
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
                  <Download size={16} />
                  <span className="text-sm">Import</span>
                </button>

                <button
                  onClick={async () => {
                    if (isHostedSession) {
                      try {
                        await forceCheckpoint(remoteSession.serverProjectId, remoteSession.session);
                      } catch (error) {
                        reportUserError(
                          'Failed to create server checkpoint before export.',
                          error,
                          { onceKey: 'editor:force-checkpoint-before-export' }
                        );
                      }
                    }
                    setShowExportDialog(true);
                  }}
                  disabled={hasNoTracks}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-3 py-2 rounded transition-colors"
                >
                  <Upload size={16} />
                  <span className="text-sm">Export</span>
                </button>
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
          remoteAnimation={remoteAnimation}
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
            <div className="relative grid grid-cols-[384px_1fr] grid-rows-[24px_minmax(0,1fr)] h-full min-h-0 min-w-0">
              <div className="bg-gray-800 border-b border-r border-gray-700" />
              <div className="relative z-50 overflow-visible min-w-0">{header}</div>
              <div className="absolute top-[32px] right-3 z-40 pointer-events-auto">{zoomOverlay}</div>
              <div
                ref={timelineRowsScrollAreaRef}
                className="col-span-2 min-h-0 overflow-y-auto scrollbar-hidden relative z-10"
                onWheel={(e) => {
                  if (e.defaultPrevented) return;
                  if (isPrimaryModifierPressed(e)) return;
                  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                    const scrollElement = timelineScrollRef.current;
                    if (scrollElement && scrollElement.scrollWidth > scrollElement.clientWidth) {
                      e.preventDefault();
                      scrollElement.scrollLeft += e.shiftKey ? e.deltaY * 3 : e.deltaX;
                    }
                  }
                }}
              >
                <div className="grid grid-cols-[384px_1fr] min-w-0 min-h-full">
                  <div
                    className="bg-gray-850 border-r border-gray-700 min-h-full"
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
                      remoteAnimation={remoteAnimation}
                      trackEffectiveRoleById={trackEffectiveRoleById}
                      onUpdateTrack={handleUpdateTrack}
                      onUpdateGroup={handleUpdateGroup}
                      onCreateSubtrack={handleCreateSubtrackFromTrack}
                      onSelectRow={handleSelectRow}
                      onSelectTrack={selectTrack}
                      selectedNodeId={selectedNodeId}
                      selectedTrackId={selectedTrackId}
                      onAddTrack={handleAddEmptyTrack}
                      onDeleteTrack={handleDeleteTrackById}
                      onEditTrackArtists={remoteSession?.session ? handleEditTrackArtists : null}
                      onEditGroupArtists={remoteSession?.session ? handleEditGroupArtists : null}
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
                  <div className="min-w-0 bg-gray-900 relative overflow-hidden min-h-full">
                    {tracks}
                    {hasNoTracks && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center text-gray-500">
                          <Download size={48} className="mx-auto mb-4 opacity-50" />
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
          onUpdateExportSettings={handleUpdateExportSettings}
          onClose={() => setShowExportDialog(false)}
        />
      )}

      <CreditsEditorDialog
        open={Boolean(trackCreditsEditor)}
        mode="track"
        title={trackCreditsEditor?.title || 'Track artist'}
        session={remoteSession?.session || null}
        initialArtistRefs={trackCreditsEditor?.artistRefs || []}
        resetKey={
          trackCreditsEditor?.kind === 'group'
            ? `group:${trackCreditsEditor?.groupNodeId || ''}`
            : `track:${trackCreditsEditor?.trackId || ''}`
        }
        onClose={() => setTrackCreditsEditor(null)}
        onSave={async (artistRefs) => {
          if (trackCreditsEditor?.kind === 'group') {
            if (!trackCreditsEditor?.groupNodeId) return;
            applyGroupArtistRefs(trackCreditsEditor.groupNodeId, artistRefs);
            return;
          }
          if (!trackCreditsEditor?.trackId) return;
          applyTrackArtistRefs(trackCreditsEditor.trackId, artistRefs);
        }}
      />

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
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-gray-900 p-1">
                <button
                  type="button"
                  onClick={() => setSettingsTab('playback')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    settingsTab === 'playback'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  Playback and Devices
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsTab('project')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    settingsTab === 'project'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  Project
                </button>
              </div>

              {settingsTab === 'playback' ? (
                <PlaybackDevicesSettingsPanel
                  audioSettings={audioSettings}
                  setAudioSettings={setAudioSettings}
                  audioInputs={audioInputs}
                  audioOutputs={audioOutputs}
                  monoOutputActive={audioSettings.forceMonoOutput === true || outputChannelCount <= 1}
                  onRefreshDevices={refreshAudioDevices}
                  outputChannelCount={outputChannelCount}
                  playbackPanLawDb={playbackPanLawDb}
                />
              ) : (
                <ProjectSettingsPanel
                  project={project}
                  onSetAutoPanStrategy={handleSetAutoPanStrategy}
                  onToggleAutoPanInverted={(enabled) => applyProjectAutoPanSettings(
                    { inverted: enabled },
                    'Update inverted auto-pan'
                  )}
                  onSetAutoPanManualChoirParts={handleSetAutoPanManualChoirParts}
                />
              )}
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
