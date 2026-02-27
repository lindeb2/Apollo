import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleUserRound,
  ChevronLeft,
  ChevronRight,
  Folder,
  Home,
  Library,
  ListMusic,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat1,
  Repeat,
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
  deletePlayerFolder,
  deletePlayerPlaylist,
  deletePlayerPlaylistItem,
  deleteVirtualMix,
  downloadMediaBlob,
  fetchPlayerGlobalMixes,
  fetchPlayerMyDevice,
  fetchPlayerTuttiMixes,
  publishVirtualMix,
  unpublishVirtualMix,
  updatePlayerFolder,
  updatePlayerPlaylist,
} from '../lib/serverApi';
import { EXPORT_PRESET_DEFINITIONS, listPresetVariants, renderPresetVariant } from '../lib/exportEngine';
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
  onOpenDawProject,
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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [isLibraryCollapsed, setIsLibraryCollapsed] = useState(false);
  const [projectContextMenu, setProjectContextMenu] = useState(null);

  const audioRef = useRef(null);
  const objectUrlRef = useRef(null);
  const activeQueueRef = useRef([]);
  const activeIndexRef = useRef(-1);
  const loopModeRef = useRef(loopMode);
  const shuffleEnabledRef = useRef(shuffleEnabled);
  const lastNonZeroVolumeRef = useRef(Math.max(5, volume));
  const playQueueItemRef = useRef(null);
  const profileMenuRef = useRef(null);
  const projectContextMenuRef = useRef(null);

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

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = volume / 100;
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      setCurrentTimeSec(Number(audio.currentTime || 0));
    };
    const handleLoadedMetadata = () => {
      setDurationSec(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const handlePause = () => {
      setIsPlaying(false);
    };
    const handlePlay = () => {
      setIsPlaying(true);
    };
    const handleEnded = async () => {
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
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('ended', handleEnded);
      audioRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

  useEffect(() => {
    const handleDocumentClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
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
    if (!activeQueueItems.length) {
      setActiveIndex(-1);
      return;
    }
    if (activeIndex < 0 || activeIndex >= activeQueueItems.length) {
      setActiveIndex(0);
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

  const playQueueItem = useCallback(async (index) => {
    if (!session) return;
    if (!audioRef.current) return;
    if (index < 0 || index >= activeQueueItems.length) return;
    const item = activeQueueItems[index];
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

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      const url = URL.createObjectURL(rendered.blob);
      objectUrlRef.current = url;

      const audio = audioRef.current;
      audio.pause();
      audio.src = url;
      audio.currentTime = 0;
      setCurrentTimeSec(0);
      setDurationSec(0);
      setActiveIndex(index);
      setNowPlayingLabel(item.name || item.projectName || 'Mix');
      await audio.play();
    } catch (playError) {
      setIsPlaying(false);
      setError(playError.message || 'Playback failed');
    } finally {
      setIsRendering(false);
    }
  }, [activeQueueItems, ensureSnapshotAudioBuffers, session]);

  useEffect(() => {
    playQueueItemRef.current = playQueueItem;
  }, [playQueueItem]);

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
    if (!audioRef.current) return;
    if (!activeQueueItems.length) return;
    if (isPlaying) {
      audioRef.current.pause();
      return;
    }
    const startIndex = activeIndex >= 0 ? activeIndex : 0;
    await playQueueItem(startIndex);
  }, [activeIndex, activeQueueItems.length, isPlaying, playQueueItem]);

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
    if (!audioRef.current || !activeQueueItems.length) return;
    if (audioRef.current.currentTime > 3) {
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
  }, [activeIndex, activeQueueItems.length, loopMode, playQueueItem]);

  const handleSeek = useCallback((nextTimeSec) => {
    if (!audioRef.current) return;
    const safe = Math.max(0, Math.min(Number(nextTimeSec || 0), Number(durationSec || 0)));
    audioRef.current.currentTime = safe;
    setCurrentTimeSec(safe);
  }, [durationSec]);

  const handleVolumeChange = useCallback((nextValue) => {
    const numeric = Number(nextValue);
    const clamped = Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
    setVolume(clamped);
  }, []);

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

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt('Folder name');
    const normalized = String(name || '').trim();
    if (!normalized) return;
    try {
      await createPlayerFolder({ name: normalized, parentFolderId: null }, session);
      await refreshPlayerData();
    } catch (createError) {
      setError(createError.message || 'Failed to create folder');
    }
  }, [refreshPlayerData, session]);

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
      const playlist = await createPlayerPlaylist({ name: normalized }, session);
      setSelectedPlaylistId(playlist?.id || null);
      await refreshPlayerData();
    } catch (createError) {
      setError(createError.message || 'Failed to create playlist');
    }
  }, [refreshPlayerData, session]);

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

  const handleAddMixToPlaylist = useCallback(async (mix) => {
    if (!playlists.length) {
      setError('Create a playlist first.');
      return;
    }
    const playlistId = selectFromPrompt(
      'Select playlist',
      playlists.map((playlist) => ({ value: playlist.id, label: playlist.name }))
    );
    if (!playlistId) return;
    try {
      await addPlayerPlaylistItem(playlistId, mix.id, session);
      await refreshPlayerData();
    } catch (addError) {
      setError(addError.message || 'Failed to add mix to playlist');
    }
  }, [playlists, refreshPlayerData, session]);

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

    await createVirtualMix({
      projectId,
      name: normalizedMixName,
      presetId,
      presetVariantKey,
      folderId: selectedFolderId,
    }, session);
    await refreshPlayerData();
  }, [refreshPlayerData, selectedFolderId, session]);

  const handleTogglePublish = useCallback(async (mix) => {
    try {
      if (mix.visibility === 'global') {
        await unpublishVirtualMix(mix.id, session);
      } else {
        await publishVirtualMix(mix.id, session);
      }
      await refreshPlayerData();
    } catch (toggleError) {
      setError(toggleError.message || 'Failed to update mix visibility');
    }
  }, [refreshPlayerData, session]);

  const handleDeleteMix = useCallback(async (mix) => {
    if (!window.confirm(`Delete mix "${mix?.name}"?`)) return;
    try {
      await deleteVirtualMix(mix.id, session);
      await refreshPlayerData();
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete mix');
    }
  }, [refreshPlayerData, session]);

  const activeQueueItem = activeQueueItems[activeIndex] || null;
  const libraryItems = useMemo(() => {
    const folderEntries = [
      { id: 'folder:root', kind: 'folder', name: 'Root', folderId: null },
      ...folders.map((folder) => ({
        id: `folder:${folder.id}`,
        kind: 'folder',
        name: folder.name,
        folderId: folder.id,
      })),
    ];
    const mixEntries = myMixes.map((mix) => ({
      id: `mix:${mix.id}`,
      kind: 'mix',
      name: mix.name || mix.projectName || 'Untitled mix',
      mix,
    }));
    const playlistEntries = playlists.map((playlist) => ({
      id: `playlist:${playlist.id}`,
      kind: 'playlist',
      name: playlist.name,
      playlist,
    }));
    return [...folderEntries, ...mixEntries, ...playlistEntries];
  }, [folders, myMixes, playlists]);
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
      const folderId = entry.folderId || null;
      setSelectedFolderId(folderId);
      setSelectedPlaylistId(null);
      handleSelectCollection(PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES, folderId || 'root');
      return;
    }
    if (entry.kind === 'mix' && entry.mix) {
      const folderId = entry.mix.folderId || null;
      const collectionId = folderId || 'root';
      const queueIndex = myMixes
        .filter((candidate) => (candidate.folderId || null) === folderId)
        .findIndex((candidate) => candidate.id === entry.mix.id);
      setSelectedFolderId(folderId);
      setSelectedPlaylistId(null);
      if (queueIndex >= 0) {
        handleSelectItem(PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES, collectionId, queueIndex);
      } else {
        handleSelectCollection(PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES, collectionId);
      }
      return;
    }
    if (entry.kind === 'playlist' && entry.playlist?.id) {
      setSelectedPlaylistId(entry.playlist.id);
      setSelectedFolderId(null);
      handleSelectCollection(PLAYER_COLLECTION_TYPES.PLAYLIST, entry.playlist.id);
    }
  }, [handleSelectCollection, handleSelectItem, myMixes]);

  const projectContextMenuStyle = useMemo(() => {
    if (!projectContextMenu) return null;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
    const x = Math.max(8, Math.min(projectContextMenu.x, viewportWidth - 172));
    const y = Math.max(8, Math.min(projectContextMenu.y, viewportHeight - 56));
    return { left: `${x}px`, top: `${y}px` };
  }, [projectContextMenu]);

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
                  <div className="flex items-center gap-2">
                    <Library size={14} />
                    <h2 className="text-sm font-semibold">My Library</h2>
                  </div>
                ) : (
                  <Library size={14} className="text-gray-300" />
                )}
                <div className="flex items-center gap-1">
                  {!isLibraryCollapsed ? (
                    <>
                      <button
                        onClick={handleCreateFolder}
                        className="rounded bg-gray-700 hover:bg-gray-600 p-1.5"
                        title="Create folder"
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        onClick={handleCreatePlaylist}
                        className="rounded bg-gray-700 hover:bg-gray-600 p-1.5"
                        title="Create playlist"
                      >
                        <ListMusic size={13} />
                      </button>
                    </>
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
                  {libraryItems.map((entry) => {
                    const isActive = entry.kind === 'folder'
                      ? (
                        activeCollectionType === PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES
                        && activeCollectionId === (entry.folderId || 'root')
                      )
                      : (
                        entry.kind === 'mix'
                          ? (
                            activeCollectionType === PLAYER_COLLECTION_TYPES.MY_DEVICE_MIXES
                            && String(activeQueueItem?.mixId || '') === String(entry.mix?.id || '')
                          )
                          : (
                            activeCollectionType === PLAYER_COLLECTION_TYPES.PLAYLIST
                            && activeCollectionId === entry.playlist?.id
                          )
                      );
                    const EntryIcon = entry.kind === 'folder'
                      ? Folder
                      : (entry.kind === 'mix' ? Music2 : ListMusic);
                    const subtitle = entry.kind === 'mix'
                      ? `${entry.mix?.musicalNumber || '0.0'} - ${entry.mix?.projectName || 'Project'}`
                      : (entry.kind === 'playlist' ? 'Playlist' : 'Folder');
                    return (
                      <button
                        key={entry.id}
                        onClick={() => handleSelectLibraryEntry(entry)}
                        className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                          isActive ? 'bg-blue-700/30' : 'hover:bg-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <EntryIcon size={13} className="text-gray-400 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm truncate">{entry.name}</div>
                            <div className="text-[11px] text-gray-500 truncate">{subtitle}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {!libraryItems.length ? (
                    <div className="text-xs text-gray-500 px-2 py-2">No library items yet.</div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex-1 min-w-0 rounded-lg border border-gray-700 bg-gray-800/80 flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700">
                <h2 className="text-sm font-semibold">This Year&apos;s Musical Numbers</h2>
              </div>
              <div className="grid grid-cols-[56px_minmax(0,1fr)_96px_34px] px-4 py-2 text-xs uppercase tracking-wide text-gray-400 border-b border-gray-700">
                <div>#</div>
                <div>Title</div>
                <div className="text-right">Total Time</div>
                <div />
              </div>
              <div className="flex-1 overflow-auto">
                {(tuttiMixes || []).map((mix, index) => {
                  const isActive = (
                    activeCollectionType === PLAYER_COLLECTION_TYPES.TUTTI
                    && activeCollectionId === 'tutti'
                    && activeIndex === index
                  );
                  const listTitle = `${mix.musicalNumber || '0.0'} - ${mix.name || 'Untitled Project'}`;
                  return (
                    <div
                      key={mix.id}
                      onClick={() => handleSelectItem(PLAYER_COLLECTION_TYPES.TUTTI, 'tutti', index)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        handleSelectItem(PLAYER_COLLECTION_TYPES.TUTTI, 'tutti', index);
                        setProjectContextMenu({ mix, x: event.clientX, y: event.clientY });
                      }}
                      className={`group grid grid-cols-[56px_minmax(0,1fr)_96px_34px] items-center px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                        isActive ? 'bg-blue-700/20' : 'hover:bg-gray-700/60'
                      }`}
                    >
                      <div className="flex items-center text-gray-300">
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
              </div>
            </div>
          </div>
        </div>
      </div>

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

      <div className="bg-gray-850 border-t border-gray-800 px-4 py-3">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(320px,680px)_minmax(0,1fr)] items-center gap-3">
          <div className="min-w-0 text-xs text-gray-300">
            <div className="truncate" title={nowPlayingLabel || activeQueueItem?.name || ''}>
              {nowPlayingLabel || activeQueueItem?.name || 'No mix playing'}
            </div>
          </div>

          <div className="w-full">
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setShuffleEnabled((previous) => !previous)}
                className={`rounded bg-gray-700 hover:bg-gray-600 p-2 disabled:opacity-50 ${shuffleButtonClass}`}
                disabled={!activeQueueItems.length || isRendering}
                title={shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
              >
                <Shuffle size={16} />
              </button>
              <button
                onClick={handlePrevious}
                className="rounded bg-gray-700 hover:bg-gray-600 p-2 disabled:opacity-50"
                disabled={!activeQueueItems.length || isRendering}
                title="Previous"
              >
                <SkipBack size={16} />
              </button>
              <button
                onClick={handleTogglePlay}
                className="rounded bg-blue-600 hover:bg-blue-700 p-2 disabled:opacity-50"
                disabled={!activeQueueItems.length || isRendering}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button
                onClick={handleNext}
                className="rounded bg-gray-700 hover:bg-gray-600 p-2 disabled:opacity-50"
                disabled={!activeQueueItems.length || isRendering}
                title="Next"
              >
                <SkipForward size={16} />
              </button>
              <button
                onClick={handleCycleLoopMode}
                className={`rounded bg-gray-700 hover:bg-gray-600 p-2 disabled:opacity-50 ${loopButtonClass}`}
                title={`${loopLabel} (click to cycle off -> all -> one)`}
                disabled={!activeQueueItems.length || isRendering}
              >
                <LoopIcon size={16} />
              </button>
            </div>

            <div className="mt-2 flex items-center gap-2 w-full">
              <span className="text-xs text-gray-300">{formatClock(currentTimeSec)}</span>
              <input
                type="range"
                min="0"
                max={Math.max(durationSec, 0.001)}
                step="0.01"
                value={Math.min(currentTimeSec, durationSec || 0)}
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-xs text-gray-300">{formatClock(durationSec)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleToggleMute}
              className={`rounded bg-gray-700 hover:bg-gray-600 p-2 ${isMuted ? 'text-gray-300' : 'text-blue-300'}`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon size={16} />
            </button>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={volume}
              onChange={(e) => handleVolumeChange(e.target.value)}
              className="w-28"
            />
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
