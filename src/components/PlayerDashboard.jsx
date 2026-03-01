import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronsLeftRightEllipsis,
  CircleUserRound,
  ChevronLeft,
  ChevronRight,
  Folder,
  HeadphoneOff,
  Headphones,
  Home,
  ListMusic,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Repeat1,
  Repeat,
  Scale,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  addPlayerPlaylistItem,
  bootstrapServerProject,
  createPlayerFolder,
  createPlayerPlaylist,
  createVirtualMix,
  deletePlayerPlaylistItem,
  deletePlayerFolder,
  deletePlayerPlaylist,
  deleteVirtualMix,
  downloadMediaBlob,
  fetchPlayerGlobalMixes,
  fetchPlayerMyDevice,
  fetchPlayerTuttiMixes,
  updatePlayerFolder,
  updatePlayerPlaylist,
  updateVirtualMix,
} from '../lib/serverApi';
import {
  EXPORT_PRESET_DEFINITIONS,
  PRACTICE_REALTIME_MODES,
  isPracticeOmittedPresetId,
  isPracticePresetId,
  listPresetVariants,
  renderPresetVariant,
  resolvePracticeRealtimeTrackMix,
} from '../lib/exportEngine';
import { audioManager } from '../lib/audioManager';
import { getMediaBlob, storeMediaBlob } from '../lib/db';
import {
  createQueueItemFromMix,
  PLAYER_COLLECTION_TYPES,
  PLAYER_LOOP_MODES,
} from '../types/player';

const SINGLE_OUTPUT_PRESETS = new Set([
  'tutti',
  'acapella',
  'no_lead',
  'no_choir',
  'instrumental',
  'lead_only',
  'choir_only',
]);

const PRACTICE_FOCUS_STEPS = [
  'omitted',
  -10,
  -8,
  -6,
  -2,
  0,
  2,
  4,
  6,
  8,
  10,
  'solo',
];
const PRACTICE_FOCUS_INNER_MIN = 8;
const PRACTICE_FOCUS_INNER_MAX = 92;
const PRACTICE_FOCUS_EXTREME_MIN = 0;
const PRACTICE_FOCUS_EXTREME_MAX = 100;
const PRACTICE_FOCUS_SLIDER_POSITIONS = PRACTICE_FOCUS_STEPS.map((step) => {
  if (step === 'omitted') return PRACTICE_FOCUS_EXTREME_MIN;
  if (step === 'solo') return PRACTICE_FOCUS_EXTREME_MAX;
  const normalized = (Number(step) + 10) / 20;
  return PRACTICE_FOCUS_INNER_MIN + (normalized * (PRACTICE_FOCUS_INNER_MAX - PRACTICE_FOCUS_INNER_MIN));
});
const PRACTICE_FOCUS_MIN_INDEX = 0;
const PRACTICE_FOCUS_MAX_INDEX = PRACTICE_FOCUS_STEPS.length - 1;
const PRACTICE_FOCUS_DEFAULT_INDEX = PRACTICE_FOCUS_STEPS.findIndex((step) => step === 0);
const PRACTICE_FOCUS_NUMERIC_STEPS = PRACTICE_FOCUS_STEPS.filter((step) => typeof step === 'number');
const PAN_TRACK_WIDTH_PX = 160;
const PAN_INNER_TRACK_WIDTH_PX = 134;

function formatClock(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function pickRandomQueueIndex(currentIndex, totalCount) {
  if (totalCount <= 1) return currentIndex;
  let candidate = currentIndex;
  let guard = 0;
  while (candidate === currentIndex && guard < 20) {
    candidate = Math.floor(Math.random() * totalCount);
    guard += 1;
  }
  if (candidate === currentIndex) {
    candidate = (currentIndex + 1) % totalCount;
  }
  return candidate;
}

function computeSnapshotDurationMs(snapshot) {
  let maxDurationMs = 0;
  (snapshot?.tracks || []).forEach((track) => {
    (track?.clips || []).forEach((clip) => {
      if (clip?.muted) return;
      const clipStartMs = Number(clip?.timelineStartMs || 0);
      const clipDurationMs = Math.max(0, Number(clip?.cropEndMs || 0) - Number(clip?.cropStartMs || 0));
      const clipEndMs = clipStartMs + clipDurationMs;
      if (Number.isFinite(clipEndMs)) {
        maxDurationMs = Math.max(maxDurationMs, clipEndMs);
      }
    });
  });
  return maxDurationMs;
}

function selectFromPrompt(label, options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const lines = options.map((option, idx) => `${idx + 1}. ${option.label} (${option.value})`).join('\n');
  const input = window.prompt(`${label}\n${lines}`, '1');
  if (input == null) return null;
  const trimmed = String(input).trim();
  const numeric = Number(trimmed);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length) {
    return options[numeric - 1].value;
  }
  const byValue = options.find((option) => option.value === trimmed);
  return byValue ? byValue.value : null;
}

function PlayerDashboard({
  session,
  onLogout,
  onSwitchToDawDashboard,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [folders, setFolders] = useState([]);
  const [myMixes, setMyMixes] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [playlistItemsByPlaylistId, setPlaylistItemsByPlaylistId] = useState({});
  const [tuttiMixes, setTuttiMixes] = useState([]);
  const [globalMixes, setGlobalMixes] = useState([]);

  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [activeCollectionType, setActiveCollectionType] = useState(PLAYER_COLLECTION_TYPES.TUTTI);
  const [activeCollectionId, setActiveCollectionId] = useState('tutti');
  const [activeIndex, setActiveIndex] = useState(-1);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [volume, setVolume] = useState(80);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [loopMode, setLoopMode] = useState(PLAYER_LOOP_MODES.OFF);
  const [nowPlayingLabel, setNowPlayingLabel] = useState('');
  const [playbackEngine, setPlaybackEngine] = useState('html');
  const [practicePanRange, setPracticePanRange] = useState(100);
  const [practiceFocusControl, setPracticeFocusControl] = useState(PRACTICE_FOCUS_DEFAULT_INDEX);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [isLibraryCollapsed, setIsLibraryCollapsed] = useState(false);
  const [libraryScopeFolderId, setLibraryScopeFolderId] = useState(null);
  const [libraryCreateMenuOpen, setLibraryCreateMenuOpen] = useState(false);
  const [libraryContextMenu, setLibraryContextMenu] = useState(null);
  const [projectContextMenu, setProjectContextMenu] = useState(null);
  const [sliderDragTooltip, setSliderDragTooltip] = useState(null);
  const [sliderEditTooltip, setSliderEditTooltip] = useState(null);

  const audioRef = useRef(null);
  const objectUrlRef = useRef(null);
  const activeQueueRef = useRef([]);
  const activeIndexRef = useRef(-1);
  const loopModeRef = useRef(loopMode);
  const shuffleEnabledRef = useRef(shuffleEnabled);
  const playbackEngineRef = useRef('html');
  const realtimePlaybackRef = useRef({
    project: null,
    item: null,
    durationMs: 0,
  });
  const realtimeEndInFlightRef = useRef(false);
  const lastNonZeroVolumeRef = useRef(Math.max(5, volume));
  const playQueueItemRef = useRef(null);
  const profileMenuRef = useRef(null);
  const libraryCreateMenuRef = useRef(null);
  const libraryContextMenuRef = useRef(null);
  const projectContextMenuRef = useRef(null);
  const sliderDragRef = useRef(null);

  const refreshPlayerData = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const [myDevice, tutti, global] = await Promise.all([
        fetchPlayerMyDevice(session),
        fetchPlayerTuttiMixes(session),
        fetchPlayerGlobalMixes(session),
      ]);
      setFolders(myDevice.folders || []);
      setMyMixes(myDevice.mixes || []);
      setPlaylists(myDevice.playlists || []);
      setPlaylistItemsByPlaylistId(myDevice.playlistItemsByPlaylistId || {});
      setTuttiMixes(tutti || []);
      setGlobalMixes(global || []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load player library');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refreshPlayerData();
  }, [refreshPlayerData]);

  const getPracticeFocusStep = useCallback(
    (index) => PRACTICE_FOCUS_STEPS[Math.max(PRACTICE_FOCUS_MIN_INDEX, Math.min(PRACTICE_FOCUS_MAX_INDEX, Math.round(Number(index) || 0)))],
    []
  );

  const getPracticeFocusSliderPosition = useCallback(
    (index) => PRACTICE_FOCUS_SLIDER_POSITIONS[
      Math.max(PRACTICE_FOCUS_MIN_INDEX, Math.min(PRACTICE_FOCUS_MAX_INDEX, Math.round(Number(index) || 0)))
    ],
    []
  );

  const resolvePracticeFocusIndexFromSlider = useCallback((sliderValue) => {
    const numeric = Number(sliderValue);
    if (!Number.isFinite(numeric)) return PRACTICE_FOCUS_DEFAULT_INDEX;
    let nearestIndex = 0;
    let nearestDistance = Math.abs(numeric - PRACTICE_FOCUS_SLIDER_POSITIONS[0]);
    PRACTICE_FOCUS_SLIDER_POSITIONS.forEach((position, index) => {
      const distance = Math.abs(numeric - position);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    });
    return nearestIndex;
  }, []);

  const resolvePracticeFocusDb = useCallback((index) => {
    const step = getPracticeFocusStep(index);
    return typeof step === 'number' ? step : 0;
  }, [getPracticeFocusStep]);

  const resolvePracticePlaybackMode = useCallback((presetId) => {
    const step = getPracticeFocusStep(practiceFocusControl);
    if (step === 'omitted') return PRACTICE_REALTIME_MODES.OMITTED;
    if (step === 'solo') return PRACTICE_REALTIME_MODES.SOLO;
    return isPracticeOmittedPresetId(presetId)
      ? PRACTICE_REALTIME_MODES.OMITTED
      : PRACTICE_REALTIME_MODES.NORMAL;
  }, [getPracticeFocusStep, practiceFocusControl]);

  const applyRealtimePracticeSettings = useCallback((snapshot, item) => {
    if (!snapshot || !item || !isPracticePresetId(item.presetId)) return false;
    const focusDb = resolvePracticeFocusDb(practiceFocusControl);
    const mixState = resolvePracticeRealtimeTrackMix(
      snapshot,
      item.presetId,
      item.presetVariantKey,
      {
        transformedPanRange: practicePanRange,
        practiceFocusDiffDb: focusDb,
      },
      resolvePracticePlaybackMode(item.presetId)
    );
    if (!mixState?.trackMixByTrackId) return false;
    Object.entries(mixState.trackMixByTrackId).forEach(([trackId, trackMix]) => {
      audioManager.updateTrackMix(trackId, trackMix.gain, trackMix.pan);
    });
    return true;
  }, [practiceFocusControl, practicePanRange, resolvePracticeFocusDb, resolvePracticePlaybackMode]);

  const handlePlaybackEnded = useCallback(async () => {
    const queue = activeQueueRef.current || [];
    const currentIdx = activeIndexRef.current;
    const mode = loopModeRef.current;
    const shuffle = shuffleEnabledRef.current;
    if (!queue.length || currentIdx < 0) {
      setIsPlaying(false);
      return;
    }

    if (mode === PLAYER_LOOP_MODES.ONE) {
      if (typeof playQueueItemRef.current === 'function') {
        await playQueueItemRef.current(currentIdx);
      }
      return;
    }

    if (shuffle && queue.length > 1) {
      const randomIndex = pickRandomQueueIndex(currentIdx, queue.length);
      if (typeof playQueueItemRef.current === 'function') {
        await playQueueItemRef.current(randomIndex);
      }
      return;
    }

    let nextIndex = currentIdx + 1;
    if (nextIndex >= queue.length) {
      if (mode === PLAYER_LOOP_MODES.ALL) {
        nextIndex = 0;
      } else {
        setIsPlaying(false);
        return;
      }
    }

    if (typeof playQueueItemRef.current === 'function') {
      await playQueueItemRef.current(nextIndex);
    }
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = volume / 100;
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      if (playbackEngineRef.current !== 'html') return;
      setCurrentTimeSec(Number(audio.currentTime || 0));
    };
    const handleLoadedMetadata = () => {
      if (playbackEngineRef.current !== 'html') return;
      setDurationSec(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const handlePause = () => {
      if (playbackEngineRef.current !== 'html') return;
      setIsPlaying(false);
    };
    const handlePlay = () => {
      if (playbackEngineRef.current !== 'html') return;
      setIsPlaying(true);
    };
    const handleEnded = async () => {
      if (playbackEngineRef.current !== 'html') return;
      await handlePlaybackEnded();
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.pause();
      audioManager.stop();
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('ended', handleEnded);
      realtimePlaybackRef.current = { project: null, item: null, durationMs: 0 };
      audioRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [handlePlaybackEnded]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = Math.max(0, Math.min(1, volume / 100));
    audioManager.setMasterVolume(Math.max(0, Math.min(100, volume)));
  }, [volume]);

  useEffect(() => {
    const handleDocumentClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
      }
      if (!libraryCreateMenuRef.current?.contains(event.target)) {
        setLibraryCreateMenuOpen(false);
      }
      if (!libraryContextMenuRef.current?.contains(event.target)) {
        setLibraryContextMenu(null);
      }
      if (!projectContextMenuRef.current?.contains(event.target)) {
        setProjectContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  useEffect(() => {
    if (volume > 0) {
      lastNonZeroVolumeRef.current = Math.max(5, Number(volume) || 5);
    }
  }, [volume]);

  useEffect(() => {
    const handleMove = (event) => {
      if (!sliderDragRef.current) return;
      const {
        startX,
        startValue,
        width,
        moved,
        min,
        max,
        step,
        kind,
      } = sliderDragRef.current;
      const deltaX = event.clientX - startX;
      if (!moved) {
        if (Math.abs(deltaX) < 2) return;
        sliderDragRef.current.moved = true;
        setSliderEditTooltip(null);
      }
      let next = startValue + (deltaX / Math.max(1, width)) * (max - min);
      next = Math.max(min, Math.min(max, next));
      if (step >= 1) {
        next = Math.round(next);
      }
      if (Math.abs(next - sliderDragRef.current.lastValue) < 1e-6) {
        if (kind === 'focus') {
          setSliderDragTooltip({ kind, value: resolvePracticeFocusIndexFromSlider(next) });
        } else {
          setSliderDragTooltip({ kind, value: next });
        }
        return;
      }
      sliderDragRef.current.lastValue = next;
      if (kind === 'master') {
        setVolume(next);
      } else if (kind === 'focus') {
        const nextFocusIndex = resolvePracticeFocusIndexFromSlider(next);
        setPracticeFocusControl(nextFocusIndex);
        setSliderDragTooltip({ kind, value: nextFocusIndex });
        return;
      } else if (kind === 'pan') {
        setPracticePanRange(next);
      }
      setSliderDragTooltip({ kind, value: next });
    };

    const handleUp = () => {
      sliderDragRef.current = null;
      setSliderDragTooltip(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resolvePracticeFocusIndexFromSlider]);

  const myDeviceMixesInFolder = useMemo(() => (
    myMixes.filter((mix) => {
      const folderId = mix.folderId || null;
      return folderId === selectedFolderId;
    })
  ), [myMixes, selectedFolderId]);

  const selectedPlaylistItems = useMemo(() => {
    if (!selectedPlaylistId) return [];
    return playlistItemsByPlaylistId[selectedPlaylistId] || [];
  }, [playlistItemsByPlaylistId, selectedPlaylistId]);

  const myDeviceQueue = useMemo(() => (
    myDeviceMixesInFolder
      .map((mix) => createQueueItemFromMix(
        mix,
        PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES,
        selectedFolderId || 'root'
      ))
      .filter(Boolean)
  ), [myDeviceMixesInFolder, selectedFolderId]);

  const playlistQueue = useMemo(() => (
    selectedPlaylistItems
      .filter((item) => !item.unavailable && item.mix)
      .map((item) => createQueueItemFromMix(
        item.mix,
        PLAYER_COLLECTION_TYPES.PLAYLIST,
        selectedPlaylistId
      ))
      .filter(Boolean)
  ), [selectedPlaylistItems, selectedPlaylistId]);

  const tuttiQueue = useMemo(() => (
    (tuttiMixes || [])
      .map((mix) => createQueueItemFromMix(
        mix,
        PLAYER_COLLECTION_TYPES.TUTTI,
        'tutti'
      ))
      .filter(Boolean)
  ), [tuttiMixes]);

  const globalQueue = useMemo(() => (
    (globalMixes || [])
      .map((mix) => createQueueItemFromMix(
        mix,
        PLAYER_COLLECTION_TYPES.GLOBAL,
        'global'
      ))
      .filter(Boolean)
  ), [globalMixes]);

  const activeQueueItems = useMemo(() => {
    if (activeCollectionType === PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES) return myDeviceQueue;
    if (activeCollectionType === PLAYER_COLLECTION_TYPES.PLAYLIST) return playlistQueue;
    if (activeCollectionType === PLAYER_COLLECTION_TYPES.GLOBAL) return globalQueue;
    return tuttiQueue;
  }, [activeCollectionType, myDeviceQueue, playlistQueue, globalQueue, tuttiQueue]);

  useEffect(() => {
    activeQueueRef.current = activeQueueItems;
  }, [activeQueueItems]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    loopModeRef.current = loopMode;
  }, [loopMode]);

  useEffect(() => {
    shuffleEnabledRef.current = shuffleEnabled;
  }, [shuffleEnabled]);

  useEffect(() => {
    playbackEngineRef.current = playbackEngine;
  }, [playbackEngine]);

  useEffect(() => {
    if (!activeQueueItems.length) {
      setActiveIndex(-1);
      return;
    }
    if (activeIndex >= activeQueueItems.length) {
      setActiveIndex(-1);
    }
  }, [activeQueueItems, activeIndex]);

  const ensureSnapshotAudioBuffers = useCallback(async (snapshot) => {
    const blobIds = new Set();
    (snapshot?.tracks || []).forEach((track) => {
      (track?.clips || []).forEach((clip) => {
        if (clip?.blobId) blobIds.add(clip.blobId);
      });
    });

    const audioBuffers = new Map();
    for (const blobId of blobIds) {
      if (!audioManager.mediaCache.has(blobId)) {
        let media = null;
        try {
          media = await getMediaBlob(blobId);
        } catch {
          const remoteBlob = await downloadMediaBlob(blobId, session);
          const arrayBuffer = await remoteBlob.arrayBuffer();
          const decodedBuffer = await audioManager.decodeAudioFile(arrayBuffer);
          const fallbackName = `${blobId}.${remoteBlob.type?.split('/')[1] || 'bin'}`;
          await storeMediaBlob(fallbackName, decodedBuffer, remoteBlob, blobId);
          media = await getMediaBlob(blobId);
        }
        await audioManager.loadAudioBuffer(blobId, media.blob);
      }
      const cached = audioManager.mediaCache.get(blobId);
      if (cached) {
        audioBuffers.set(blobId, cached);
      }
    }
    return audioBuffers;
  }, [session]);

  const playMixItem = useCallback(async (item, indexForState = null) => {
    if (!session) return;
    if (!audioRef.current) return;
    if (!item?.projectId || !item?.presetId) return;

    setIsRendering(true);
    setError('');
    try {
      const payload = await bootstrapServerProject(item.projectId, session, 0);
      const snapshot = payload?.snapshot;
      if (!snapshot || typeof snapshot !== 'object') {
        throw new Error('Project snapshot missing');
      }
      const audioBuffers = await ensureSnapshotAudioBuffers(snapshot);
      const audio = audioRef.current;
      audio.pause();
      audioManager.stop();
      realtimePlaybackRef.current = { project: null, item: null, durationMs: 0 };
      realtimeEndInFlightRef.current = false;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }

      setCurrentTimeSec(0);
      setDurationSec(0);
      if (typeof indexForState === 'number' && indexForState >= 0) {
        setActiveIndex(indexForState);
      }
      setNowPlayingLabel(item.name || item.projectName || 'Mix');

      if (isPracticePresetId(item.presetId)) {
        const durationMs = computeSnapshotDurationMs(snapshot);
        audioManager.setPanLawDb(snapshot.panLawDb);
        await audioManager.play(snapshot, 0);
        applyRealtimePracticeSettings(snapshot, item);
        realtimePlaybackRef.current = {
          project: snapshot,
          item,
          durationMs,
        };
        playbackEngineRef.current = 'realtime';
        setPlaybackEngine('realtime');
        setDurationSec(Math.max(0, durationMs / 1000));
        setIsPlaying(true);
        return;
      }

      const rendered = await renderPresetVariant(
        snapshot,
        item.presetId,
        item.presetVariantKey,
        audioBuffers,
        snapshot.exportSettings,
        snapshot.projectName || item.projectName || item.name || 'mix',
        'wav'
      );
      if (!rendered?.blob) {
        throw new Error('Failed to build playback mix');
      }
      const url = URL.createObjectURL(rendered.blob);
      objectUrlRef.current = url;
      playbackEngineRef.current = 'html';
      setPlaybackEngine('html');
      audio.src = url;
      audio.currentTime = 0;
      await audio.play();
    } catch (playError) {
      audioManager.stop();
      realtimePlaybackRef.current = { project: null, item: null, durationMs: 0 };
      playbackEngineRef.current = 'html';
      setPlaybackEngine('html');
      setIsPlaying(false);
      setError(playError.message || 'Playback failed');
    } finally {
      setIsRendering(false);
    }
  }, [applyRealtimePracticeSettings, ensureSnapshotAudioBuffers, session]);

  const playQueueItem = useCallback(async (index) => {
    if (index < 0 || index >= activeQueueItems.length) return;
    const item = activeQueueItems[index];
    await playMixItem(item, index);
  }, [activeQueueItems, playMixItem]);

  useEffect(() => {
    playQueueItemRef.current = playQueueItem;
  }, [playQueueItem]);

  useEffect(() => {
    if (playbackEngine !== 'realtime' || !isPlaying) return undefined;
    const interval = setInterval(() => {
      const currentMs = Math.max(0, Number(audioManager.getCurrentTime() || 0));
      setCurrentTimeSec(currentMs / 1000);

      const durationMs = Number(realtimePlaybackRef.current?.durationMs || 0);
      if (durationMs <= 0 || currentMs < durationMs) {
        return;
      }
      if (realtimeEndInFlightRef.current) {
        return;
      }
      realtimeEndInFlightRef.current = true;
      audioManager.stop();
      setCurrentTimeSec(durationMs / 1000);
      setIsPlaying(false);
      void handlePlaybackEnded().finally(() => {
        realtimeEndInFlightRef.current = false;
      });
    }, 50);
    return () => clearInterval(interval);
  }, [handlePlaybackEnded, isPlaying, playbackEngine]);

  useEffect(() => {
    if (playbackEngine !== 'realtime') return;
    const current = realtimePlaybackRef.current;
    if (!current?.project || !current?.item) return;
    try {
      applyRealtimePracticeSettings(current.project, current.item);
    } catch (applyError) {
      setError(applyError.message || 'Failed to apply practice mix settings');
    }
  }, [applyRealtimePracticeSettings, playbackEngine]);

  const handleSelectCollection = useCallback((type, id = null) => {
    setActiveCollectionType(type);
    setActiveCollectionId(id || type);
  }, []);

  const handleSelectItem = useCallback((type, collectionId, index) => {
    setActiveCollectionType(type);
    setActiveCollectionId(collectionId || type);
    setActiveIndex(index);
  }, []);

  const handleTogglePlay = useCallback(async () => {
    if (!activeQueueItems.length) return;
    if (isPlaying) {
      if (playbackEngineRef.current === 'realtime') {
        const currentMs = Math.max(0, Math.round((Number(currentTimeSec) || 0) * 1000));
        await audioManager.pause(currentMs);
        setIsPlaying(false);
        return;
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      return;
    }

    if (
      playbackEngineRef.current === 'realtime'
      && realtimePlaybackRef.current?.project
      && realtimePlaybackRef.current?.item
      && currentTimeSec < Math.max(0, durationSec - 0.01)
    ) {
      const resumeMs = Math.max(0, Math.round((Number(currentTimeSec) || 0) * 1000));
      const current = realtimePlaybackRef.current;
      audioManager.setPanLawDb(current.project.panLawDb);
      await audioManager.play(current.project, resumeMs);
      applyRealtimePracticeSettings(current.project, current.item);
      setIsPlaying(true);
      return;
    }

    const startIndex = activeIndex >= 0 ? activeIndex : 0;
    await playQueueItem(startIndex);
  }, [activeIndex, activeQueueItems.length, applyRealtimePracticeSettings, currentTimeSec, durationSec, isPlaying, playQueueItem]);

  const handleNext = useCallback(async () => {
    if (!activeQueueItems.length) return;
    if (shuffleEnabled && activeQueueItems.length > 1) {
      const randomIndex = pickRandomQueueIndex(activeIndex, activeQueueItems.length);
      await playQueueItem(randomIndex);
      return;
    }
    let nextIndex = activeIndex + 1;
    if (nextIndex >= activeQueueItems.length) {
      if (loopMode === PLAYER_LOOP_MODES.ALL) {
        nextIndex = 0;
      } else {
        return;
      }
    }
    await playQueueItem(nextIndex);
  }, [activeIndex, activeQueueItems.length, loopMode, playQueueItem, shuffleEnabled]);

  const handlePrevious = useCallback(async () => {
    if (!activeQueueItems.length) return;
    if (playbackEngineRef.current === 'realtime') {
      if (currentTimeSec > 3 && realtimePlaybackRef.current?.project && realtimePlaybackRef.current?.item) {
        const current = realtimePlaybackRef.current;
        if (isPlaying) {
          await audioManager.pause(0);
          audioManager.setPanLawDb(current.project.panLawDb);
          await audioManager.play(current.project, 0);
          applyRealtimePracticeSettings(current.project, current.item);
          setIsPlaying(true);
        } else {
          await audioManager.pause(0);
        }
        setCurrentTimeSec(0);
        return;
      }
    } else if (audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      setCurrentTimeSec(0);
      return;
    }
    let previousIndex = activeIndex - 1;
    if (previousIndex < 0) {
      previousIndex = loopMode === PLAYER_LOOP_MODES.ALL
        ? activeQueueItems.length - 1
        : 0;
    }
    await playQueueItem(previousIndex);
  }, [activeIndex, activeQueueItems.length, applyRealtimePracticeSettings, currentTimeSec, isPlaying, loopMode, playQueueItem]);

  const handleSeek = useCallback(async (nextTimeSec) => {
    const safe = Math.max(0, Math.min(Number(nextTimeSec || 0), Number(durationSec || 0)));
    if (playbackEngineRef.current === 'realtime' && realtimePlaybackRef.current?.project && realtimePlaybackRef.current?.item) {
      try {
        const seekMs = Math.max(0, Math.round(safe * 1000));
        const current = realtimePlaybackRef.current;
        if (isPlaying) {
          await audioManager.pause(seekMs);
          audioManager.setPanLawDb(current.project.panLawDb);
          await audioManager.play(current.project, seekMs);
          applyRealtimePracticeSettings(current.project, current.item);
          setIsPlaying(true);
        } else {
          await audioManager.pause(seekMs);
        }
      } catch (seekError) {
        setError(seekError.message || 'Seek failed');
      }
      setCurrentTimeSec(safe);
      return;
    }
    if (!audioRef.current) return;
    audioRef.current.currentTime = safe;
    setCurrentTimeSec(safe);
  }, [applyRealtimePracticeSettings, durationSec, isPlaying]);

  const handleToggleMute = useCallback(() => {
    setVolume((previous) => {
      const numeric = Number(previous) || 0;
      if (numeric <= 0) {
        return Math.max(5, Number(lastNonZeroVolumeRef.current) || 5);
      }
      lastNonZeroVolumeRef.current = Math.max(5, numeric);
      return 0;
    });
  }, []);

  const beginSliderDrag = useCallback((event, config) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const {
      kind,
      value,
      min,
      max,
      step,
      disabled,
    } = config;
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    sliderDragRef.current = {
      startX: event.clientX,
      startValue: Number(value),
      lastValue: Number(value),
      width: rect.width,
      moved: false,
      min: Number(min),
      max: Number(max),
      step: Number(step || 1),
      kind,
    };
    if (kind === 'focus') {
      setSliderDragTooltip({ kind, value: resolvePracticeFocusIndexFromSlider(Number(value)) });
    } else {
      setSliderDragTooltip({ kind, value: Number(value) });
    }
    setSliderEditTooltip(null);
  }, [resolvePracticeFocusIndexFromSlider]);

  const formatSliderValue = useCallback((kind, value) => {
    if (kind === 'master') {
      return `${Math.round(Math.max(0, Math.min(100, value)))}`;
    }
    if (kind === 'focus') {
      const step = getPracticeFocusStep(value);
      if (step === 'omitted') return 'Omitted';
      if (step === 'solo') return 'Solo';
      return `${step > 0 ? '+' : ''}${step}`;
    }
    return `${Math.round(value)}`;
  }, [getPracticeFocusStep]);

  const parseSliderInput = useCallback((kind, rawText) => {
    const text = String(rawText || '').trim();
    if (kind === 'master') {
      if (!text) return null;
      const parsed = Number.parseFloat(text);
      if (!Number.isFinite(parsed)) return null;
      return Math.max(0, Math.min(100, Math.round(parsed)));
    }
    if (!text) return null;
    if (kind === 'focus') {
      const normalized = text.toLowerCase();
      if (normalized === 'omitted') return PRACTICE_FOCUS_MIN_INDEX;
      if (normalized === 'solo') return PRACTICE_FOCUS_MAX_INDEX;
      const parsed = Number.parseFloat(text);
      if (!Number.isFinite(parsed)) return null;
      let nearest = PRACTICE_FOCUS_NUMERIC_STEPS[0];
      let nearestDistance = Math.abs(parsed - nearest);
      PRACTICE_FOCUS_NUMERIC_STEPS.forEach((candidate) => {
        const distance = Math.abs(parsed - candidate);
        if (distance < nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        }
      });
      return PRACTICE_FOCUS_STEPS.findIndex((step) => step === nearest);
    }
    const parsed = Number.parseFloat(text);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(200, Math.round(parsed)));
  }, []);

  const openSliderEdit = useCallback((kind, value, disabled) => {
    if (disabled) return;
    setSliderEditTooltip({
      kind,
      text: formatSliderValue(kind, value),
    });
  }, [formatSliderValue]);

  const commitSliderEdit = useCallback(() => {
    if (!sliderEditTooltip) return;
    const nextValue = parseSliderInput(sliderEditTooltip.kind, sliderEditTooltip.text);
    if (nextValue !== null) {
      if (sliderEditTooltip.kind === 'master') setVolume(nextValue);
      if (sliderEditTooltip.kind === 'focus') setPracticeFocusControl(nextValue);
      if (sliderEditTooltip.kind === 'pan') setPracticePanRange(nextValue);
    }
    setSliderEditTooltip(null);
  }, [parseSliderInput, sliderEditTooltip]);

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt('Folder name');
    const normalized = String(name || '').trim();
    if (!normalized) return;
    try {
      await createPlayerFolder({ name: normalized, parentFolderId: libraryScopeFolderId || null }, session);
      await refreshPlayerData();
    } catch (createError) {
      setError(createError.message || 'Failed to create folder');
    }
  }, [libraryScopeFolderId, refreshPlayerData, session]);

  const handleRenameFolder = useCallback(async (folder) => {
    const name = window.prompt('Rename folder', folder?.name || '');
    const normalized = String(name || '').trim();
    if (!normalized || normalized === folder?.name) return;
    try {
      await updatePlayerFolder(folder.id, { name: normalized }, session);
      await refreshPlayerData();
    } catch (renameError) {
      setError(renameError.message || 'Failed to rename folder');
    }
  }, [refreshPlayerData, session]);

  const handleDeleteFolder = useCallback(async (folder) => {
    if (!window.confirm(`Delete folder "${folder?.name}"? Folder must be empty.`)) return;
    try {
      await deletePlayerFolder(folder.id, session);
      if (selectedFolderId === folder.id) {
        setSelectedFolderId(null);
      }
      await refreshPlayerData();
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete folder');
    }
  }, [refreshPlayerData, selectedFolderId, session]);

  const handleCreatePlaylist = useCallback(async () => {
    const name = window.prompt('Playlist name');
    const normalized = String(name || '').trim();
    if (!normalized) return;
    try {
      const playlist = await createPlayerPlaylist({ name: normalized, folderId: libraryScopeFolderId || null }, session);
      setSelectedPlaylistId(playlist?.id || null);
      await refreshPlayerData();
    } catch (createError) {
      setError(createError.message || 'Failed to create playlist');
    }
  }, [libraryScopeFolderId, refreshPlayerData, session]);

  const handleRenamePlaylist = useCallback(async (playlist) => {
    const name = window.prompt('Rename playlist', playlist?.name || '');
    const normalized = String(name || '').trim();
    if (!normalized || normalized === playlist?.name) return;
    try {
      await updatePlayerPlaylist(playlist.id, { name: normalized }, session);
      await refreshPlayerData();
    } catch (renameError) {
      setError(renameError.message || 'Failed to rename playlist');
    }
  }, [refreshPlayerData, session]);

  const handleDeletePlaylist = useCallback(async (playlist) => {
    if (!window.confirm(`Delete playlist "${playlist?.name}"?`)) return;
    try {
      await deletePlayerPlaylist(playlist.id, session);
      if (selectedPlaylistId === playlist.id) {
        setSelectedPlaylistId(null);
      }
      await refreshPlayerData();
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete playlist');
    }
  }, [refreshPlayerData, selectedPlaylistId, session]);

  const promptCreateMixFromProject = useCallback(async (projectLike) => {
    const projectId = String(projectLike?.projectId || projectLike?.id || '').trim();
    if (!projectId) return;

    const defaultName = `${projectLike?.musicalNumber ? `${projectLike.musicalNumber} - ` : ''}${projectLike?.name || projectLike?.projectName || 'Mix'}`;
    const mixName = window.prompt('Mix name', defaultName);
    const normalizedMixName = String(mixName || '').trim();
    if (!normalizedMixName) return;

    const presetId = selectFromPrompt(
      'Select preset',
      EXPORT_PRESET_DEFINITIONS.map((preset) => ({
        value: preset.id,
        label: preset.label,
      }))
    );
    if (!presetId) return;

    let presetVariantKey = null;
    if (!SINGLE_OUTPUT_PRESETS.has(presetId)) {
      const payload = await bootstrapServerProject(projectId, session, 0);
      const variants = listPresetVariants(payload?.snapshot || {}, presetId);
      if (!variants.length) {
        throw new Error('This preset has no selectable variants for the project.');
      }
      const variantValue = selectFromPrompt(
        'Select preset variant',
        variants.map((variant) => ({
          value: variant.key,
          label: variant.label,
        }))
      );
      if (!variantValue) return;
      presetVariantKey = variantValue;
    }

    const placement = selectFromPrompt(
      'Place mix in',
      [
        { value: '__root__', label: 'My Library (Root)' },
        ...playlists.map((playlist) => ({ value: `playlist:${playlist.id}`, label: `Playlist: ${playlist.name}` })),
      ]
    );
    if (!placement) return;

    const createdMix = await createVirtualMix({
      projectId,
      name: normalizedMixName,
      presetId,
      presetVariantKey,
      folderId: null,
    }, session);
    if (String(placement).startsWith('playlist:')) {
      const playlistId = String(placement).slice('playlist:'.length);
      if (playlistId) {
        await addPlayerPlaylistItem(playlistId, createdMix.id, session);
      }
    }
    await refreshPlayerData();
  }, [playlists, refreshPlayerData, session]);

  const handleDeleteMix = useCallback(async (mix) => {
    if (!window.confirm(`Delete mix "${mix?.name}"?`)) return;
    try {
      await deleteVirtualMix(mix.id, session);
      await refreshPlayerData();
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete mix');
    }
  }, [refreshPlayerData, session]);

  const handleRenameMix = useCallback(async (mix) => {
    const name = window.prompt('Rename mix', mix?.name || '');
    const normalized = String(name || '').trim();
    if (!normalized || normalized === mix?.name) return;
    try {
      await updateVirtualMix(mix.id, { name: normalized }, session);
      await refreshPlayerData();
    } catch (renameError) {
      setError(renameError.message || 'Failed to rename mix');
    }
  }, [refreshPlayerData, session]);

  const activeQueueItem = activeQueueItems[activeIndex] || null;
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) || null;
  const currentLibraryFolder = folders.find((folder) => folder.id === libraryScopeFolderId) || null;
  const libraryVisibleItems = useMemo(() => {
    if (libraryScopeFolderId) {
      const scopedFolders = folders
        .filter((folder) => (folder.parentFolderId || null) === libraryScopeFolderId)
        .map((folder) => ({
          id: `folder:${folder.id}`,
          kind: 'folder',
          name: folder.name,
          folder,
        }));
      const scopedPlaylists = playlists
        .filter((playlist) => (playlist.folderId || null) === libraryScopeFolderId)
        .map((playlist) => ({
          id: `playlist:${playlist.id}`,
          kind: 'playlist',
          name: playlist.name,
          playlist,
        }));
      return [...scopedFolders, ...scopedPlaylists];
    }
    const playlistMixIds = new Set(
      Object.values(playlistItemsByPlaylistId || {})
        .flat()
        .map((item) => item?.mixId)
        .filter(Boolean)
        .map((mixId) => String(mixId))
    );
    const rootMixes = myMixes
      .filter((mix) => (mix.folderId || null) === null)
      .filter((mix) => !playlistMixIds.has(String(mix.id)))
      .map((mix) => ({
        id: `mix:${mix.id}`,
        kind: 'mix',
        name: mix.name || mix.projectName || 'Untitled mix',
        mix,
      }));
    const foldersFlat = folders.map((folder) => ({
      id: `folder:${folder.id}`,
      kind: 'folder',
      name: folder.name,
      folder,
    }));
    const playlistsFlat = playlists
      .filter((playlist) => (playlist.folderId || null) === null)
      .map((playlist) => ({
      id: `playlist:${playlist.id}`,
      kind: 'playlist',
      name: playlist.name,
      playlist,
    }));
    return [...foldersFlat, ...playlistsFlat, ...rootMixes];
  }, [folders, libraryScopeFolderId, myMixes, playlistItemsByPlaylistId, playlists]);
  const loopLabel = loopMode === PLAYER_LOOP_MODES.OFF
    ? 'Loop off'
    : (loopMode === PLAYER_LOOP_MODES.ALL ? 'Loop all' : 'Loop one');
  const LoopIcon = loopMode === PLAYER_LOOP_MODES.ONE ? Repeat1 : Repeat;
  const loopButtonClass = loopMode === PLAYER_LOOP_MODES.OFF
    ? 'text-gray-400'
    : 'text-blue-300';
  const shuffleButtonClass = shuffleEnabled ? 'text-blue-300' : 'text-gray-400';
  const isMuted = volume <= 0;
  const VolumeIcon = isMuted ? VolumeX : Volume2;
  const practiceControlItem = playbackEngine === 'realtime'
    ? realtimePlaybackRef.current?.item
    : null;
  const practiceControlsEnabled = isPracticePresetId(practiceControlItem?.presetId);
  const focusControlDisabled = !practiceControlsEnabled || isRendering;
  const focusStep = getPracticeFocusStep(practiceFocusControl);
  const focusSliderPosition = getPracticeFocusSliderPosition(practiceFocusControl);
  const panControlDisabled = !practiceControlsEnabled
    || isRendering
    || focusStep === 'omitted'
    || focusStep === 'solo';
  const visualPanRangeValue = sliderDragTooltip?.kind === 'pan'
    ? Math.max(0, Math.min(200, Number(sliderDragTooltip.value) || 0))
    : Math.max(0, Math.min(200, Number(practicePanRange) || 0));
  const practicePanRangePercent = (visualPanRangeValue / 200) * 100;
  const practicePanFocusAxisValue = 200 - (visualPanRangeValue / 2);
  const practicePanFocusAxisPercent = (practicePanFocusAxisValue / 200) * 100;
  const practicePanKnobPixel = Math.max(
    0,
    Math.min(PAN_INNER_TRACK_WIDTH_PX, Math.round((practicePanRangePercent / 100) * PAN_INNER_TRACK_WIDTH_PX))
  );
  const practicePanFocusAxisPixel = Math.max(
    0,
    Math.min(PAN_INNER_TRACK_WIDTH_PX, Math.round((practicePanFocusAxisPercent / 100) * PAN_INNER_TRACK_WIDTH_PX))
  );
  const PAN_HIGHLIGHT_LEFT_OFFSET_PERCENT = 8.125;
  const PAN_HIGHLIGHT_INNER_SPAN_PERCENT = 100 - (2 * PAN_HIGHLIGHT_LEFT_OFFSET_PERCENT);
  const practicePanHighlightPercent = Math.max(
    0,
    Math.min(
      100,
      PAN_HIGHLIGHT_LEFT_OFFSET_PERCENT
        + (practicePanRangePercent * (PAN_HIGHLIGHT_INNER_SPAN_PERCENT / 100))
    )
  );
  const practicePanHighlightPixel = Math.max(
    0,
    Math.min(PAN_TRACK_WIDTH_PX, Math.round((practicePanHighlightPercent / 100) * PAN_TRACK_WIDTH_PX))
  );
  const showPanRangeHighlight = sliderDragTooltip?.kind === 'pan' && !panControlDisabled;
  const showPanFocusAxisMarker = sliderDragTooltip?.kind === 'pan' && !panControlDisabled;
  const FocusIcon = focusStep === 'omitted'
    ? HeadphoneOff
    : (focusStep === 'solo' ? Headphones : Scale);

  useEffect(() => {
    if (panControlDisabled && sliderDragTooltip?.kind === 'pan') {
      setSliderDragTooltip(null);
    }
  }, [panControlDisabled, sliderDragTooltip]);

  const handleCycleLoopMode = useCallback(() => {
    setLoopMode((previous) => {
      if (previous === PLAYER_LOOP_MODES.OFF) return PLAYER_LOOP_MODES.ALL;
      if (previous === PLAYER_LOOP_MODES.ALL) return PLAYER_LOOP_MODES.ONE;
      return PLAYER_LOOP_MODES.OFF;
    });
  }, []);

  const handleSelectLibraryEntry = useCallback((entry) => {
    if (!entry) return;
    if (entry.kind === 'folder') {
      const folderId = entry.folder?.id || null;
      setLibraryScopeFolderId(folderId);
      setSelectedFolderId(folderId);
      setSelectedPlaylistId(null);
      setActiveIndex(-1);
      handleSelectCollection(PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES, folderId || 'root');
      return;
    }
    if (entry.kind === 'playlist' && entry.playlist?.id) {
      setSelectedPlaylistId(entry.playlist.id);
      setSelectedFolderId(null);
      setActiveIndex(-1);
      handleSelectCollection(PLAYER_COLLECTION_TYPES.PLAYLIST, entry.playlist.id);
      return;
    }
    if (entry.kind === 'mix' && entry.mix) {
      const queue = myDeviceQueue;
      const queueIndex = queue.findIndex((candidate) => String(candidate.mixId || '') === String(entry.mix.id));
      setSelectedFolderId(null);
      setSelectedPlaylistId(null);
      if (queueIndex >= 0) {
        handleSelectItem(PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES, 'root', queueIndex);
      } else {
        handleSelectCollection(PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES, 'root');
      }
    }
  }, [handleSelectCollection, handleSelectItem, myDeviceQueue]);

  const handleLibraryContextAction = useCallback(async (action) => {
    const entry = libraryContextMenu?.entry;
    setLibraryContextMenu(null);
    if (!entry) return;
    try {
      if (entry.kind === 'folder' && entry.folder) {
        if (action === 'rename') {
          await handleRenameFolder(entry.folder);
          return;
        }
        if (action === 'delete') {
          await handleDeleteFolder(entry.folder);
          return;
        }
        if (action === 'move') {
          const destination = selectFromPrompt(
            `Move folder "${entry.folder.name}" to`,
            [
              { value: '__root__', label: 'Root' },
              ...folders
                .filter((folder) => folder.id !== entry.folder.id)
                .map((folder) => ({ value: folder.id, label: folder.name })),
            ]
          );
          if (destination == null) return;
          await updatePlayerFolder(entry.folder.id, { parentFolderId: destination === '__root__' ? null : destination }, session);
          await refreshPlayerData();
        }
        return;
      }

      if (entry.kind === 'playlist' && entry.playlist) {
        if (action === 'rename') {
          await handleRenamePlaylist(entry.playlist);
          return;
        }
        if (action === 'delete') {
          await handleDeletePlaylist(entry.playlist);
          return;
        }
        if (action === 'move') {
          const destination = selectFromPrompt(
            `Move playlist "${entry.playlist.name}" to`,
            [
              { value: '__root__', label: 'Root' },
              ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
            ]
          );
          if (destination == null) return;
          await updatePlayerPlaylist(entry.playlist.id, { folderId: destination === '__root__' ? null : destination }, session);
          await refreshPlayerData();
        }
      }

      if (entry.kind === 'mix' && entry.mix) {
        if (action === 'rename') {
          await handleRenameMix(entry.mix);
          return;
        }
        if (action === 'delete') {
          await handleDeleteMix(entry.mix);
          return;
        }
        if (action === 'move') {
          const destination = selectFromPrompt(
            `Move mix "${entry.mix.name}" to`,
            [
              { value: '__root__', label: 'My Library (Root)' },
              ...playlists.map((playlist) => ({ value: `playlist:${playlist.id}`, label: `Playlist: ${playlist.name}` })),
            ]
          );
          if (destination == null) return;
          const sourcePlaylistId = entry.sourcePlaylistId || null;
          const sourcePlaylistItemId = entry.sourcePlaylistItemId || null;
          const destinationPlaylistId = String(destination).startsWith('playlist:')
            ? String(destination).slice('playlist:'.length)
            : null;
          if (sourcePlaylistId && destinationPlaylistId === sourcePlaylistId) {
            return;
          }
          if (sourcePlaylistId && sourcePlaylistItemId) {
            await deletePlayerPlaylistItem(sourcePlaylistId, sourcePlaylistItemId, session);
          }
          if (String(destination).startsWith('playlist:')) {
            const playlistId = destinationPlaylistId;
            if (!playlistId) return;
            const existingItems = playlistItemsByPlaylistId?.[playlistId] || [];
            const alreadyExists = existingItems.some((item) => String(item?.mixId || '') === String(entry.mix.id));
            if (alreadyExists) {
              setError('Mix already exists in selected playlist.');
              return;
            }
            await addPlayerPlaylistItem(playlistId, entry.mix.id, session);
          }
          await refreshPlayerData();
          return;
        }
        if (action === 'duplicate') {
          const duplicated = await createVirtualMix({
            projectId: entry.mix.projectId,
            name: `${entry.mix.name || 'Mix'} (Copy)`,
            presetId: entry.mix.presetId,
            presetVariantKey: entry.mix.presetVariantKey ?? null,
            folderId: null,
          }, session);
          if (entry.sourcePlaylistId) {
            await addPlayerPlaylistItem(entry.sourcePlaylistId, duplicated.id, session);
          }
          await refreshPlayerData();
          return;
        }
        if (action === 'new_from_project') {
          await promptCreateMixFromProject(entry.mix);
        }
      }
    } catch (contextError) {
      setError(contextError.message || 'Library action failed');
    }
  }, [
    folders,
    handleDeleteFolder,
    handleDeleteMix,
    handleDeletePlaylist,
    handleRenameFolder,
    handleRenameMix,
    handleRenamePlaylist,
    libraryContextMenu,
    playlistItemsByPlaylistId,
    playlists,
    promptCreateMixFromProject,
    refreshPlayerData,
    session,
  ]);

  const projectContextMenuStyle = useMemo(() => {
    if (!projectContextMenu) return null;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
    const x = Math.max(8, Math.min(projectContextMenu.x, viewportWidth - 172));
    const y = Math.max(8, Math.min(projectContextMenu.y, viewportHeight - 56));
    return { left: `${x}px`, top: `${y}px` };
  }, [projectContextMenu]);

  const libraryContextMenuStyle = useMemo(() => {
    if (!libraryContextMenu) return null;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
    const x = Math.max(8, Math.min(libraryContextMenu.x, viewportWidth - 172));
    const y = Math.max(8, Math.min(libraryContextMenu.y, viewportHeight - 240));
    return { left: `${x}px`, top: `${y}px` };
  }, [libraryContextMenu]);

  const handleCreateMixFromContextMenu = useCallback(async () => {
    const target = projectContextMenu?.mix;
    setProjectContextMenu(null);
    if (!target) return;
    try {
      await promptCreateMixFromProject(target);
    } catch (saveError) {
      setError(saveError.message || 'Failed to create mix');
    }
  }, [projectContextMenu, promptCreateMixFromProject]);

  const activePlaylistRows = useMemo(() => {
    if (!selectedPlaylist) return [];
    const playableItems = selectedPlaylistItems.filter((candidate) => !candidate.unavailable && candidate.mix);
    return selectedPlaylistItems.map((item) => ({
      id: item.id,
      unavailable: Boolean(item.unavailable || !item.mix),
      mix: item.mix || null,
      queueIndex: playableItems.findIndex((candidate) => candidate.id === item.id),
    }));
  }, [selectedPlaylist, selectedPlaylistItems]);

  const handlePlayPlaylistRow = useCallback(async (row) => {
    if (!selectedPlaylist || !row || row.unavailable || row.queueIndex < 0 || !row.mix) return;
    setSelectedPlaylistId(selectedPlaylist.id);
    setSelectedFolderId(null);
    setActiveCollectionType(PLAYER_COLLECTION_TYPES.PLAYLIST);
    setActiveCollectionId(selectedPlaylist.id);
    setActiveIndex(row.queueIndex);
    const queueItem = createQueueItemFromMix(row.mix, PLAYER_COLLECTION_TYPES.PLAYLIST, selectedPlaylist.id);
    if (!queueItem) return;
    await playMixItem(queueItem, row.queueIndex);
  }, [playMixItem, selectedPlaylist]);

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Apollo</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg bg-gray-700 p-0.5">
            <button
              type="button"
              disabled
              className="rounded-md px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white cursor-default"
              title="Current mode"
            >Player</button>
            <button
              onClick={onSwitchToDawDashboard}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
              title="Switch to DAW mode"
            >
              DAW
            </button>
          </div>

          <div className="relative" ref={profileMenuRef}>
            <button
              onClick={() => setProfileMenuOpen((previous) => !previous)}
              className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg p-2 flex items-center justify-center transition-colors"
              title="User menu"
            >
              <CircleUserRound size={18} />
            </button>
            {profileMenuOpen ? (
              <div className="absolute right-0 top-full mt-2 min-w-32 rounded-md border border-gray-700 bg-gray-800 shadow-lg z-30 overflow-hidden">
                <button
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onLogout();
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                >
                  Log out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4">
        <div className="h-full flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setLibraryScopeFolderId(null);
                setSelectedPlaylistId(null);
                setSelectedFolderId(null);
                setActiveCollectionType(PLAYER_COLLECTION_TYPES.TUTTI);
                setActiveCollectionId('tutti');
                setActiveIndex(-1);
              }}
              className="rounded-md bg-gray-800 border border-gray-700 p-2 text-gray-200 hover:bg-gray-700 transition-colors"
              title="Home"
            >
              <Home size={16} />
            </button>
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search"
                className="w-full rounded-md bg-gray-800 border border-gray-700 pl-9 pr-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-gray-500"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 flex gap-3">
            <div className={`${isLibraryCollapsed ? 'w-14' : 'w-80'} shrink-0 rounded-lg border border-gray-700 bg-gray-800/80 flex flex-col transition-all duration-200`}>
              <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
                {!isLibraryCollapsed ? (
                  libraryScopeFolderId ? (
                    <button
                      onClick={() => setLibraryScopeFolderId(null)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-semibold hover:bg-gray-700"
                      title="Back to full library"
                    >
                      <ChevronLeft size={13} />
                      {currentLibraryFolder?.name || 'My Library'}
                    </button>
                  ) : (
                    <h2 className="text-sm font-semibold">My Library</h2>
                  )
                ) : (
                  <span className="text-sm font-semibold">L</span>
                )}
                <div className="flex items-center gap-1">
                  {!isLibraryCollapsed ? (
                    <div className="relative" ref={libraryCreateMenuRef}>
                      <button
                        onClick={() => setLibraryCreateMenuOpen((previous) => !previous)}
                        className="rounded bg-gray-700 hover:bg-gray-600 p-1.5"
                        title="Create"
                      >
                        <Plus size={13} />
                      </button>
                      {libraryCreateMenuOpen ? (
                        <div className="absolute right-0 top-full mt-1 min-w-36 rounded-md border border-gray-700 bg-gray-800 shadow-xl overflow-hidden z-30">
                          <button
                            onClick={async () => {
                              setLibraryCreateMenuOpen(false);
                              await handleCreateFolder();
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                          >
                            Create Folder
                          </button>
                          <button
                            onClick={async () => {
                              setLibraryCreateMenuOpen(false);
                              await handleCreatePlaylist();
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                          >
                            Create Playlist
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <button
                    onClick={() => setIsLibraryCollapsed((previous) => !previous)}
                    className="rounded bg-gray-700 hover:bg-gray-600 p-1.5"
                    title={isLibraryCollapsed ? 'Expand library' : 'Collapse library'}
                  >
                    {isLibraryCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
                  </button>
                </div>
              </div>

              {!isLibraryCollapsed ? (
                <div className="flex-1 overflow-auto p-2 space-y-1">
                  {libraryVisibleItems.map((entry) => {
                    const isActive = entry.kind === 'folder'
                      ? (
                        activeCollectionType === PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES
                        && activeCollectionId === (entry.folder?.id || 'root')
                      )
                      : (
                        entry.kind === 'playlist'
                          ? (
                            activeCollectionType === PLAYER_COLLECTION_TYPES.PLAYLIST
                            && activeCollectionId === entry.playlist?.id
                          )
                          : (
                            activeCollectionType === PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES
                            && activeCollectionId === 'root'
                            && String(activeQueueItem?.mixId || '') === String(entry.mix?.id || '')
                          )
                      );
                    const EntryIcon = entry.kind === 'folder'
                      ? Folder
                      : (entry.kind === 'playlist' ? ListMusic : Play);
                    const subtitle = entry.kind === 'playlist'
                      ? 'Playlist'
                      : (entry.kind === 'mix' ? `${entry.mix?.musicalNumber || '0.0'} - Mix` : 'Folder');
                    return (
                      <div
                        key={entry.id}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setLibraryContextMenu({ entry, x: event.clientX, y: event.clientY });
                        }}
                        className={`group flex items-center gap-1 rounded-md pr-1 transition-colors ${
                          isActive ? 'bg-blue-700/30' : 'hover:bg-gray-700'
                        }`}
                      >
                        <button
                          onClick={() => handleSelectLibraryEntry(entry)}
                          onDoubleClick={async () => {
                            if (entry.kind === 'mix' && entry.mix) {
                              const queue = myDeviceQueue;
                              const queueIndex = queue.findIndex((candidate) => String(candidate.mixId || '') === String(entry.mix.id));
                              if (queueIndex >= 0) {
                                setSelectedFolderId(null);
                                setSelectedPlaylistId(null);
                                setActiveCollectionType(PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES);
                                setActiveCollectionId('root');
                                setActiveIndex(queueIndex);
                                await playQueueItem(queueIndex);
                              }
                            }
                          }}
                          className="flex-1 min-w-0 text-left px-2 py-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <EntryIcon size={13} className="text-gray-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-sm truncate">{entry.name}</div>
                              <div className="text-[11px] text-gray-500 truncate">{subtitle}</div>
                            </div>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                  {!libraryVisibleItems.length ? (
                    <div className="text-xs text-gray-500 px-2 py-2">No library items here.</div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex-1 min-w-0 rounded-lg border border-gray-700 bg-gray-800/80 flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700">
                <h2 className="text-sm font-semibold">
                  {selectedPlaylist && activeCollectionType === PLAYER_COLLECTION_TYPES.PLAYLIST
                    ? selectedPlaylist.name
                    : "This Year's Musical Numbers"}
                </h2>
              </div>
              <div className="grid grid-cols-[56px_minmax(0,1fr)_96px_34px] px-4 py-2 text-xs uppercase tracking-wide text-gray-400 border-b border-gray-700">
                <div>#</div>
                <div>Title</div>
                <div className="text-right">Total Time</div>
                <div />
              </div>
              <div className="flex-1 overflow-auto">
                {selectedPlaylist && activeCollectionType === PLAYER_COLLECTION_TYPES.PLAYLIST ? (
                  <>
                    {activePlaylistRows.map((row, index) => {
                      const rowTitle = row.unavailable
                        ? '[Unavailable]'
                        : `${row.mix?.name || row.mix?.projectName || 'Mix'}`;
                      const isActive = !row.unavailable && row.queueIndex >= 0 && activeIndex === row.queueIndex;
                      return (
                        <div
                          key={row.id}
                          onContextMenu={(event) => {
                            if (row.unavailable || !row.mix) return;
                            event.preventDefault();
                            setLibraryContextMenu({
                              entry: {
                                kind: 'mix',
                                mix: row.mix,
                                sourcePlaylistId: selectedPlaylist.id,
                                sourcePlaylistItemId: row.id,
                              },
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                          onClick={() => {
                            if (row.unavailable || row.queueIndex < 0) return;
                            handleSelectItem(PLAYER_COLLECTION_TYPES.PLAYLIST, selectedPlaylist.id, row.queueIndex);
                          }}
                          onDoubleClick={async () => {
                            await handlePlayPlaylistRow(row);
                          }}
                          className={`group grid grid-cols-[56px_minmax(0,1fr)_96px_34px] items-center px-4 py-2.5 text-sm transition-colors ${
                            row.unavailable
                              ? 'text-gray-500'
                              : (isActive ? 'bg-blue-700/20 cursor-pointer' : 'hover:bg-gray-700/60 cursor-pointer')
                          }`}
                        >
                          <div className="flex items-center pl-0.5 text-gray-300">
                            <span className="group-hover:hidden">{index + 1}</span>
                            {!row.unavailable ? <Play size={14} className="hidden group-hover:block" /> : null}
                          </div>
                          <div className="truncate">{rowTitle}</div>
                          <div className="text-right text-gray-400">--:--</div>
                          <div className="flex justify-end">
                            {!row.unavailable && row.mix ? (
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  setLibraryContextMenu({
                                    entry: {
                                      kind: 'mix',
                                      mix: row.mix,
                                      sourcePlaylistId: selectedPlaylist.id,
                                      sourcePlaylistItemId: row.id,
                                    },
                                    x: rect.right,
                                    y: rect.bottom + 4,
                                  });
                                }}
                                className="rounded p-1 text-gray-400 hover:text-white hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                title="Options"
                              >
                                <MoreHorizontal size={14} />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    {!activePlaylistRows.length ? (
                      <div className="text-xs text-gray-500 px-4 py-3">No playlist items.</div>
                    ) : null}
                  </>
                ) : (
                  <>
                    {(tuttiMixes || []).map((mix, index) => {
                      const isActive = (
                        activeCollectionType === PLAYER_COLLECTION_TYPES.TUTTI
                        && activeCollectionId === 'tutti'
                        && activeIndex === index
                      );
                      const listTitle = `${mix.musicalNumber || '0.0'} - ${mix.projectName || mix.name || 'Untitled Project'}`;
                      return (
                        <div
                          key={mix.id}
                          onClick={() => handleSelectItem(PLAYER_COLLECTION_TYPES.TUTTI, 'tutti', index)}
                          onDoubleClick={async () => {
                            await playQueueItem(index);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            handleSelectItem(PLAYER_COLLECTION_TYPES.TUTTI, 'tutti', index);
                            setProjectContextMenu({ mix, x: event.clientX, y: event.clientY });
                          }}
                          className={`group grid grid-cols-[56px_minmax(0,1fr)_96px_34px] items-center px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                            isActive ? 'bg-blue-700/20' : 'hover:bg-gray-700/60'
                          }`}
                        >
                          <div className="flex items-center pl-0.5 text-gray-300">
                            <span className="group-hover:hidden">{index + 1}</span>
                            <Play size={14} className="hidden group-hover:block" />
                          </div>
                          <div className="truncate text-gray-100">{listTitle}</div>
                          <div className="text-right text-gray-400">--:--</div>
                          <div className="flex justify-end">
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                const rect = event.currentTarget.getBoundingClientRect();
                                setProjectContextMenu({ mix, x: rect.right, y: rect.bottom + 4 });
                              }}
                              className="rounded p-1 text-gray-400 hover:text-white hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                              title="Options"
                            >
                              <MoreHorizontal size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {!tuttiMixes.length ? (
                      <div className="text-xs text-gray-500 px-4 py-3">No readable projects found.</div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {libraryContextMenu ? (
        <div
          ref={libraryContextMenuRef}
          className="fixed z-50 min-w-[160px] rounded-md border border-gray-700 bg-gray-800 shadow-xl overflow-hidden"
          style={libraryContextMenuStyle || undefined}
        >
          {libraryContextMenu.entry?.kind === 'mix' ? (
            <>
              <button
                onClick={async () => handleLibraryContextAction('rename')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                Rename
              </button>
              <button
                onClick={async () => handleLibraryContextAction('move')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                Move
              </button>
              <button
                onClick={async () => handleLibraryContextAction('duplicate')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                Create duplicate
              </button>
              <button
                onClick={async () => handleLibraryContextAction('delete')}
                className="w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-gray-700"
              >
                Delete
              </button>
              <button
                onClick={async () => handleLibraryContextAction('new_from_project')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                Create new mix from this project
              </button>
            </>
          ) : (
            <>
              <button
                onClick={async () => handleLibraryContextAction('rename')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                Rename
              </button>
              <button
                onClick={async () => handleLibraryContextAction('move')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                Move
              </button>
              <button
                onClick={async () => handleLibraryContextAction('delete')}
                className="w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-gray-700"
              >
                Delete
              </button>
            </>
          )}
        </div>
      ) : null}

      {projectContextMenu ? (
        <div
          ref={projectContextMenuRef}
          className="fixed z-50 min-w-[160px] rounded-md border border-gray-700 bg-gray-800 shadow-xl overflow-hidden"
          style={projectContextMenuStyle || undefined}
        >
          <button
            onClick={handleCreateMixFromContextMenu}
            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
          >
            Create mix
          </button>
        </div>
      ) : null}

      <div className="bg-gray-850 border-t border-gray-800 px-6 py-4">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(380px,760px)_minmax(0,1fr)] items-center gap-4">
          <div className="min-w-0 text-lg font-semibold text-gray-200">
            <div className="truncate" title={nowPlayingLabel || activeQueueItem?.name || ''}>
              {nowPlayingLabel || activeQueueItem?.name || 'No mix playing'}
            </div>
          </div>

	          <div className="w-full">
	            <div className="flex items-center justify-center gap-4 flex-wrap">
	              <div className="flex items-center justify-center gap-3">
	                <button
	                  onClick={() => setShuffleEnabled((previous) => !previous)}
	                  className={`rounded bg-gray-700 hover:bg-gray-600 p-3 disabled:opacity-50 ${shuffleButtonClass}`}
	                  disabled={!activeQueueItems.length || isRendering}
	                  title={shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
	                >
	                  <Shuffle size={20} />
	                </button>
	                <button
	                  onClick={handlePrevious}
	                  className="rounded bg-gray-700 hover:bg-gray-600 p-3 disabled:opacity-50"
	                  disabled={!activeQueueItems.length || isRendering}
	                  title="Previous"
	                >
	                  <SkipBack size={20} />
	                </button>
	                <button
	                  onClick={handleTogglePlay}
	                  className="rounded bg-blue-600 hover:bg-blue-700 p-3 disabled:opacity-50"
	                  disabled={!activeQueueItems.length || isRendering}
	                  title={isRendering ? 'Loading mix...' : (isPlaying ? 'Pause' : 'Play')}
	                >
	                  {isRendering ? <Loader2 size={20} className="animate-spin" /> : (isPlaying ? <Pause size={20} /> : <Play size={20} />)}
	                </button>
	                <button
	                  onClick={handleNext}
	                  className="rounded bg-gray-700 hover:bg-gray-600 p-3 disabled:opacity-50"
	                  disabled={!activeQueueItems.length || isRendering}
	                  title="Next"
	                >
	                  <SkipForward size={20} />
	                </button>
	                <button
	                  onClick={handleCycleLoopMode}
	                  className={`rounded bg-gray-700 hover:bg-gray-600 p-3 disabled:opacity-50 ${loopButtonClass}`}
	                  title={`${loopLabel} (click to cycle off -> all -> one)`}
	                  disabled={!activeQueueItems.length || isRendering}
	                >
	                  <LoopIcon size={20} />
	                </button>
	              </div>
	            </div>

            <div className="mt-3 flex items-center gap-3 w-full">
              <span className="text-sm text-gray-300">{formatClock(currentTimeSec)}</span>
              <input
                type="range"
                min="0"
                max={Math.max(durationSec, 0.001)}
                step="0.01"
                value={Math.min(currentTimeSec, durationSec || 0)}
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="flex-1 volume-slider volume-slider-lg cursor-pointer block"
              />
              <span className="text-sm text-gray-300">{formatClock(durationSec)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            {practiceControlsEnabled ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400" title="Practice focus">
                    <FocusIcon size={20} />
                  </span>
                  <div
                    className={`relative w-40 h-7 ${focusControlDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                    onMouseDown={(event) => {
                      if (event.detail > 1) return;
                      if (focusControlDisabled) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const relative = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100;
                      const clamped = Math.max(0, Math.min(100, relative));
                      const nextFocusIndex = resolvePracticeFocusIndexFromSlider(clamped);
                      setPracticeFocusControl(nextFocusIndex);
                      beginSliderDrag(event, {
                        kind: 'focus',
                        value: getPracticeFocusSliderPosition(nextFocusIndex),
                        min: 0,
                        max: 100,
                        step: 1,
                        disabled: false,
                      });
                    }}
                    onDoubleClick={() => openSliderEdit('focus', practiceFocusControl, focusControlDisabled)}
                    title="Practice focus"
                  >
                    <div className="absolute left-[13px] right-[13px] top-1/2 -translate-y-1/2 h-[26px] rounded-full bg-gray-800 border border-gray-600 pointer-events-none z-0" />
                    <div
                      className={`absolute left-0 top-1/2 -translate-y-1/2 h-[26px] w-[26px] rounded-full bg-gray-800 border pointer-events-none z-10 ${
                        focusStep === 'omitted' ? 'border-blue-400' : 'border-gray-600'
                      }`}
                    />
                    <div
                      className={`absolute right-0 top-1/2 -translate-y-1/2 h-[26px] w-[26px] rounded-full bg-gray-800 border pointer-events-none z-10 ${
                        focusStep === 'solo' ? 'border-blue-400' : 'border-gray-600'
                      }`}
                    />
                    <div className="absolute top-0 bottom-0 left-[13px] right-[13px] pointer-events-none z-20">
                      <div
                        className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-600"
                        style={{ left: `${focusSliderPosition}%` }}
                      />
                    </div>
                    {sliderDragTooltip?.kind === 'focus' && (
                      <div
                        className="absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                        style={{ marginBottom: '1px' }}
                      >
                        {formatSliderValue('focus', Number(sliderDragTooltip.value))}
                      </div>
                    )}
                    {sliderEditTooltip?.kind === 'focus' && (
                      <input
                        type="text"
                        value={sliderEditTooltip.text}
                        onChange={(event) => setSliderEditTooltip((previous) => (
                          previous ? { ...previous, text: event.target.value } : previous
                        ))}
                        onFocus={(event) => event.target.select()}
                        onBlur={commitSliderEdit}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            event.currentTarget.blur();
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            setSliderEditTooltip(null);
                          }
                        }}
                        className="absolute bottom-full left-1/2 -translate-x-1/2 w-14 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                        style={{ marginBottom: '1px' }}
                        autoFocus
                      />
                    )}
                  </div>
                </div>

                <div className={`flex items-center gap-2 ${panControlDisabled ? 'opacity-40' : ''}`}>
                  <span className="text-gray-400" title="Transformed pan range">
                    <ChevronsLeftRightEllipsis size={20} />
                  </span>
                  <div
                    className={`relative w-40 h-7 ${panControlDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    onMouseDown={(event) => {
                      if (event.detail > 1) return;
                      if (panControlDisabled) return;
                      beginSliderDrag(event, {
                        kind: 'pan',
                        value: practicePanRange,
                        min: 0,
                        max: 200,
                        step: 1,
                        disabled: false,
                      });
                    }}
                    onDoubleClick={() => openSliderEdit('pan', practicePanRange, panControlDisabled)}
                    title={panControlDisabled ? 'Transformed pan range disabled for Omitted/Solo focus' : 'Transformed pan range'}
                  >
                    <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[26px] rounded-full bg-gray-800 border border-gray-600 overflow-hidden pointer-events-none">
                    </div>
                    <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[26px] rounded-full overflow-hidden pointer-events-none">
                      <div
                        className={`absolute left-0 top-0 bottom-0 bg-gray-600 ${showPanRangeHighlight ? 'opacity-70' : 'opacity-0'}`}
                        style={{ width: `${practicePanHighlightPixel}px` }}
                      />
                    </div>
                    <div className="absolute top-0 bottom-0 left-[13px] right-[13px] pointer-events-none">
                      <div
                        className="absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-gray-600 z-20"
                        style={{ left: `${practicePanKnobPixel - 12}px` }}
                      />
                      {showPanFocusAxisMarker ? (
                        <div
                          className="absolute h-[10px] w-[10px] rounded-full bg-gray-200 z-30 pointer-events-none"
                          style={{
                            left: `${practicePanFocusAxisPixel}px`,
                            top: '50%',
                            transform: 'translate3d(-50%, -50%, 0)',
                            backfaceVisibility: 'hidden',
                            willChange: 'left',
                          }}
                        />
                      ) : null}
                    </div>
                    {sliderDragTooltip?.kind === 'pan' && (
                      <div
                        className="absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                        style={{ marginBottom: '1px' }}
                      >
                        {formatSliderValue('pan', Number(sliderDragTooltip.value))}
                      </div>
                    )}
                    {sliderEditTooltip?.kind === 'pan' && (
                      <input
                        type="text"
                        value={sliderEditTooltip.text}
                        onChange={(event) => setSliderEditTooltip((previous) => (
                          previous ? { ...previous, text: event.target.value } : previous
                        ))}
                        onFocus={(event) => event.target.select()}
                        onBlur={commitSliderEdit}
                        onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          event.currentTarget.blur();
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                          setSliderEditTooltip(null);
                        }
                      }}
                        className="absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                        style={{ marginBottom: '1px' }}
                        autoFocus
                      />
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            <div className="flex items-center gap-0">
              <button
                onClick={handleToggleMute}
                className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                <VolumeIcon size={20} />
              </button>
              <div className="relative">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={volume}
                  readOnly
                  onMouseDown={(event) => beginSliderDrag(event, {
                    kind: 'master',
                    value: volume,
                    min: 0,
                    max: 100,
                    step: 1,
                    disabled: isRendering,
                  })}
                  onDoubleClick={() => openSliderEdit('master', volume, isRendering)}
                  className="w-32 volume-slider volume-slider-lg cursor-pointer block"
                  title="Master Volume (double-click for numeric input)"
                />
                {sliderDragTooltip?.kind === 'master' && (
                  <div
                    className="absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                    style={{ marginBottom: '1px' }}
                  >
                    {formatSliderValue('master', Number(sliderDragTooltip.value))}
                  </div>
                )}
                {sliderEditTooltip?.kind === 'master' && (
                  <input
                    type="text"
                    value={sliderEditTooltip.text}
                    onChange={(event) => setSliderEditTooltip((previous) => (
                      previous ? { ...previous, text: event.target.value } : previous
                    ))}
                    onFocus={(event) => event.target.select()}
                    onBlur={commitSliderEdit}
                    onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                      setSliderEditTooltip(null);
                    }
                  }}
                    className="absolute bottom-full left-1/2 -translate-x-1/2 w-10 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                    style={{ marginBottom: '1px' }}
                    autoFocus
                  />
                )}
              </div>
            </div>
          </div>
        </div>
        {error ? (
          <div className="mt-1 text-xs text-red-300 text-center">{error}</div>
        ) : null}
        {loading ? (
          <div className="mt-1 text-xs text-gray-400 text-center">Loading player data...</div>
        ) : null}
      </div>
    </div>
  );
}

export default PlayerDashboard;
