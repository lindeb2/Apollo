import { useEffect, useRef, useState } from 'react';
import { Lock, Unlock, Volume2, VolumeX, Headphones, Mic, Music, Users, Waves, ChevronRight } from 'lucide-react';
import { TRACK_ROLES } from '../types/project';
import { dbToVolume, volumeToDb } from '../utils/audio';
import { AUTO_PAN_STRATEGIES } from '../utils/choirAutoPan';

const TRACK_HEIGHT = 100;
const LOCKED_TRACK_HEIGHT = 70;

function TrackList({
  tracks,
  onUpdateTrack,
  onSelectTrack,
  selectedTrackId,
  onAddTrack,
  onDeleteTrack,
  onSetAutoPanStrategy,
  onToggleAutoPanInverted,
  autoPanInverted = false,
  autoPanManualChoirParts = false,
  onReorderTrack,
  emptyContextMenu,
  onClearEmptyContextMenu,
}) {
  const listRef = useRef(null);
  const [editingName, setEditingName] = useState(null);
  const dragRef = useRef(null);
  const reorderDragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [dragTooltip, setDragTooltip] = useState(null);
  const [editTooltip, setEditTooltip] = useState(null);
  const [draggingTrackId, setDraggingTrackId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [typeMenuPos, setTypeMenuPos] = useState({ x: 0, y: 0 });
  const [choirMenuOpen, setChoirMenuOpen] = useState(false);
  const [choirMenuPos, setChoirMenuPos] = useState({ x: 0, y: 0 });
  const [autoPanMenuOpen, setAutoPanMenuOpen] = useState(false);
  const [autoPanMenuPos, setAutoPanMenuPos] = useState({ x: 0, y: 0 });
  const [isTypeTriggerHover, setIsTypeTriggerHover] = useState(false);
  const [isTypeMenuHover, setIsTypeMenuHover] = useState(false);
  const [isChoirTriggerHover, setIsChoirTriggerHover] = useState(false);
  const [isChoirMenuHover, setIsChoirMenuHover] = useState(false);
  const [isAutoPanTriggerHover, setIsAutoPanTriggerHover] = useState(false);
  const [isAutoPanMenuHover, setIsAutoPanMenuHover] = useState(false);
  const iconOptions = [
    { key: 'mic', Icon: Mic },
    { key: 'music', Icon: Music },
    { key: 'users', Icon: Users },
    { key: 'wave', Icon: Waves },
  ];
  
  useEffect(() => {
    if (!contextMenu || contextMenu.type !== 'track') {
      setTypeMenuOpen(false);
      setChoirMenuOpen(false);
      setAutoPanMenuOpen(false);
      setIsTypeTriggerHover(false);
      setIsTypeMenuHover(false);
      setIsChoirTriggerHover(false);
      setIsChoirMenuHover(false);
      setIsAutoPanTriggerHover(false);
      setIsAutoPanMenuHover(false);
    }
  }, [contextMenu]);

  useEffect(() => {
    const typeOpen = isTypeTriggerHover || isTypeMenuHover || isChoirTriggerHover || isChoirMenuHover;
    const choirOpen = isChoirTriggerHover || isChoirMenuHover;
    setTypeMenuOpen(typeOpen);
    setChoirMenuOpen(choirOpen);
  }, [isTypeTriggerHover, isTypeMenuHover, isChoirTriggerHover, isChoirMenuHover]);

  useEffect(() => {
    const autoOpen = isAutoPanTriggerHover || isAutoPanMenuHover;
    setAutoPanMenuOpen(autoOpen);
  }, [isAutoPanTriggerHover, isAutoPanMenuHover]);

  const openTypeMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTypeMenuPos({ x: rect.right, y: rect.top - 1 });
    setIsTypeTriggerHover(true);
  };

  const openChoirMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setChoirMenuPos({ x: rect.right, y: rect.top - 1 });
    setIsChoirTriggerHover(true);
  };

  const openAutoPanMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setAutoPanMenuPos({ x: rect.right, y: rect.top - 1 });
    setIsAutoPanTriggerHover(true);
  };

  const getDefaultIconKey = (role) => {
    if (role === TRACK_ROLES.INSTRUMENT) return 'music';
    if (role === TRACK_ROLES.LEAD) return 'mic';
    if (role.startsWith('choir-part')) return 'users';
    return 'wave';
  };

  const getIconForTrack = (track) => {
    const iconKey = track.icon || getDefaultIconKey(track.role);
    const option = iconOptions.find(opt => opt.key === iconKey);
    return option || iconOptions[0];
  };

  const cycleIcon = (track) => {
    const iconKey = track.icon || getDefaultIconKey(track.role);
    const currentIndex = iconOptions.findIndex(opt => opt.key === iconKey);
    const nextIndex = (currentIndex + 1) % iconOptions.length;
    onUpdateTrack(track.id, { icon: iconOptions[nextIndex].key });
  };

  const handleVolumeChange = (trackId, value) => {
    onUpdateTrack(trackId, { volume: parseFloat(value) });
  };

  const handlePanChange = (trackId, value) => {
    onUpdateTrack(trackId, { pan: parseFloat(value) });
  };

  const beginDrag = (e, trackId, type) => {
    e.preventDefault();
    e.stopPropagation();
    if (editTooltip) setEditTooltip(null);
    const startValue = type === 'volume'
      ? tracks.find(t => t.id === trackId)?.volume ?? 0
      : tracks.find(t => t.id === trackId)?.pan ?? 0;
    const rect = e.currentTarget.getBoundingClientRect();
    setDragTooltip({
      trackId,
      type,
      value: startValue,
      x: rect.left + rect.width / 2,
      y: rect.top - 6,
    });
    dragRef.current = {
      trackId,
      type,
      startX: e.clientX,
      startValue,
      width: rect.width,
      moved: false,
    };
  };

  const beginTrackReorder = (e, trackId) => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-track-interactive="true"]')) return;
    const container = listRef.current;
    if (!container) return;
    const rowMeta = tracks
      .map((track, index) => {
        const row = container.querySelector(`[data-track-row-id="${track.id}"]`);
        if (!row) return null;
        const rect = row.getBoundingClientRect();
        return {
          id: track.id,
          index,
          mid: rect.top + rect.height / 2,
        };
      })
      .filter(Boolean);
    if (rowMeta.length < 2) return;
    reorderDragRef.current = {
      trackId,
      startY: e.clientY,
      lastY: e.clientY,
      moved: false,
      rowMeta,
    };
    setDraggingTrackId(trackId);
  };

  const handleDragMove = (e) => {
    if (!dragRef.current) return;
    const { trackId, type, startX, startValue, width, moved } = dragRef.current;
    const deltaX = e.clientX - startX;
    if (!moved && Math.abs(deltaX) < 2) return;
    dragRef.current.moved = true;
    if (editTooltip) setEditTooltip(null);

    if (type === 'volume') {
      const range = 100;
      const next = Math.min(100, Math.max(0, startValue + (deltaX / width) * range));
      handleVolumeChange(trackId, next);
      setDragTooltip((prev) => prev ? { ...prev, value: next } : { trackId, type, value: next });
    } else {
      const range = 200; // -100 to +100
      const next = Math.min(100, Math.max(-100, startValue + (deltaX / width) * range));
      handlePanChange(trackId, next);
      setDragTooltip((prev) => prev ? { ...prev, value: next } : { trackId, type, value: next });
    }
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragTooltip(null);
  };

  const handleTrackReorderMove = (e) => {
    const dragState = reorderDragRef.current;
    if (!dragState) return;
    dragState.lastY = e.clientY;
    if (!dragState.moved && Math.abs(e.clientY - dragState.startY) < 4) return;
    dragState.moved = true;
    e.preventDefault();
  };

  const handleTrackReorderEnd = () => {
    const dragState = reorderDragRef.current;
    if (!dragState) return;
    reorderDragRef.current = null;
    setDraggingTrackId(null);
    if (!dragState.moved) return;

    const { rowMeta, trackId, lastY } = dragState;
    const fromIndex = rowMeta.findIndex((row) => row.id === trackId);
    if (fromIndex < 0) return;

    let insertIndex = rowMeta.length;
    for (let i = 0; i < rowMeta.length; i += 1) {
      if (lastY < rowMeta[i].mid) {
        insertIndex = i;
        break;
      }
    }
    if (insertIndex > fromIndex) {
      insertIndex -= 1;
    }
    if (insertIndex === fromIndex) return;
    onReorderTrack?.(trackId, insertIndex);
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const handleVolumeDoubleClick = (track, e) => {
    setDragTooltip(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const display = track.volume <= 0 ? '-∞' : volumeToDb(track.volume).toFixed(1);
    setEditTooltip({
      trackId: track.id,
      type: 'volume',
      text: display,
      x: rect.left + rect.width / 2,
      y: rect.top - 6,
    });
  };

  const handlePanDoubleClick = (track, e) => {
    setDragTooltip(null);
    const rect = e.currentTarget.getBoundingClientRect();
    setEditTooltip({
      trackId: track.id,
      type: 'pan',
      text: track.pan.toFixed(0),
      x: rect.left + rect.width / 2,
      y: rect.top - 6,
    });
  };

  const commitEditTooltip = (track) => {
    if (!editTooltip) return;
    const text = editTooltip.text.trim();
    if (editTooltip.type === 'volume') {
      if (!text) {
        handleVolumeChange(track.id, dbToVolume(0));
        setEditTooltip(null);
        return;
      }
      const normalized = text.toLowerCase();
      if (normalized === '-∞' || normalized === '-inf' || normalized === '-infinity') {
        handleVolumeChange(track.id, 0);
        setEditTooltip(null);
        return;
      }
      const parsed = parseFloat(text);
      if (!Number.isNaN(parsed)) {
        const clampedDb = Math.min(6, Math.max(-60, parsed));
        handleVolumeChange(track.id, dbToVolume(clampedDb));
      }
    } else {
      if (!text) {
        handlePanChange(track.id, 0);
        setEditTooltip(null);
        return;
      }
      const parsed = parseFloat(text);
      if (!Number.isNaN(parsed)) {
        handlePanChange(track.id, Math.min(100, Math.max(-100, parsed)));
      }
    }
    setEditTooltip(null);
  };

  useEffect(() => {
    const handleMove = (e) => {
      handleDragMove(e);
      handleTrackReorderMove(e);
    };
    const handleUp = () => {
      endDrag();
      handleTrackReorderEnd();
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    if (!emptyContextMenu) return;
    setContextMenu(emptyContextMenu);
    onClearEmptyContextMenu?.();
  }, [emptyContextMenu, onClearEmptyContextMenu]);


  const handleToggleLock = (trackId, currentLocked) => {
    onUpdateTrack(trackId, { locked: !currentLocked });
  };

  const handleToggleMute = (trackId, currentMuted) => {
    onUpdateTrack(trackId, { muted: !currentMuted });
  };

  const handleToggleSolo = (trackId, currentSoloed) => {
    onUpdateTrack(trackId, { soloed: !currentSoloed });
  };

  const handleNameChange = (trackId, newName) => {
    if (newName.trim()) {
      onUpdateTrack(trackId, { name: newName.trim() });
    }
    setEditingName(null);
  };

  const getRoleColor = (role) => {
    const colors = {
      'instrument': 'bg-purple-600',
      'lead': 'bg-blue-600',
      'choir-part-1': 'bg-green-600',
      'choir-part-2': 'bg-green-500',
      'choir-part-3': 'bg-green-400',
      'choir-part-4': 'bg-teal-500',
      'choir-part-5': 'bg-teal-400',
      'other': 'bg-gray-600',
    };
    return colors[role] || 'bg-gray-600';
  };

  if (!tracks || tracks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p>No tracks yet. Import audio files to get started.</p>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="flex flex-col min-h-full"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          type: 'empty',
        });
      }}
    >
      {tracks.map((track) => {
        const trackHeight = track.locked ? LOCKED_TRACK_HEIGHT : TRACK_HEIGHT;
        const { Icon: TrackIcon } = getIconForTrack(track);
        
        return (
          <div
            key={track.id}
            data-track-row-id={track.id}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                type: 'track',
                track,
              });
            }}
            onMouseDown={(e) => beginTrackReorder(e, track.id)}
            onClick={() => {
              if (suppressClickRef.current) return;
              onSelectTrack(track.id);
            }}
            className={`border-b border-gray-700 px-4 py-3 cursor-pointer ${
              selectedTrackId === track.id
                ? 'bg-gray-700'
                : 'bg-gray-800 hover:bg-gray-750'
            } ${track.locked ? 'bg-gray-850' : ''} ${draggingTrackId === track.id ? 'cursor-grabbing' : ''}`}
            style={{ 
              height: `${trackHeight}px`,
              minHeight: `${trackHeight}px`,
              maxHeight: `${trackHeight}px`,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '16px'
            }}
          >
            <div
              data-track-interactive="true"
              className="flex-shrink-0"
              onClick={() => onSelectTrack(track.id)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  cycleIcon(track);
                }}
                className={`w-14 h-14 rounded-lg ${getRoleColor(track.role)} text-white flex items-center justify-center`}
                title="Click to change icon"
              >
                <TrackIcon size={22} />
              </button>
            </div>

            <div className={`flex-1 min-w-0 flex flex-col ${track.locked ? 'justify-center gap-3' : 'gap-1'}`}>
              {/* Upper Row: Name */}
              {!track.locked && (
                <div
                  data-track-interactive="true"
                  className="flex items-center min-w-0"
                  onClick={() => onSelectTrack(track.id)}
                >
                  {editingName === track.id ? (
                    <input
                      type="text"
                      defaultValue={track.name}
                      autoFocus
                      onBlur={(e) => handleNameChange(track.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleNameChange(track.id, e.target.value);
                        } else if (e.key === 'Escape') {
                          setEditingName(null);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-transparent border-b border-blue-500 px-0 py-0 text-lg font-semibold leading-none focus:outline-none min-w-0 h-[28px]"
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingName(track.id);
                      }}
                      className="flex-1 text-lg font-semibold truncate min-w-0 h-[28px] flex items-center"
                      title="Double-click to edit"
                    >
                      {track.name}
                    </span>
                  )}
                </div>
              )}

              {/* Lower Row: Controls */}
              <div data-track-interactive="true" className="flex items-center gap-3">
                <div className="flex items-center gap-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleMute(track.id, track.muted);
                    }}
                    className={`w-7 h-7 flex items-center justify-center rounded-l-md rounded-r-none border border-gray-600 transition-colors ${
                      track.muted
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-800 hover:bg-gray-600 text-gray-300'
                    }`}
                    title={track.muted ? 'Unmute' : 'Mute'}
                  >
                    {track.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleSolo(track.id, track.soloed);
                    }}
                    className={`w-7 h-7 flex items-center justify-center rounded-r-md rounded-l-none border border-l-0 border-gray-600 transition-colors ${
                      track.soloed
                        ? 'bg-yellow-600 text-white'
                        : 'bg-gray-800 hover:bg-gray-600 text-gray-300'
                    }`}
                    title={track.soloed ? 'Unsolo' : 'Solo'}
                  >
                    <Headphones size={16} />
                  </button>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleLock(track.id, track.locked);
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-600 transition-colors bg-gray-800 hover:bg-gray-600 text-gray-300 -ml-1"
                  title={track.locked ? 'Unlock track' : 'Lock track'}
                >
                  {track.locked ? <Lock size={16} /> : <Unlock size={16} />}
                </button>

                <div
                  className="flex-1 flex items-center relative"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={track.volume}
                    readOnly
                    onMouseDown={(e) => {
                      if (e.detail > 1) return;
                      beginDrag(e, track.id, 'volume');
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleVolumeDoubleClick(track, e);
                    }}
                    className="w-full volume-slider volume-slider-lg cursor-pointer"
                  />
                  {dragTooltip?.trackId === track.id && dragTooltip.type === 'volume' && (
                    <div
                      className="fixed w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                      style={{ left: dragTooltip.x, top: dragTooltip.y, transform: 'translate(-50%, -100%)' }}
                    >
                      {dragTooltip.value <= 0 ? '-∞' : volumeToDb(dragTooltip.value).toFixed(1)}
                    </div>
                  )}
                  {editTooltip?.trackId === track.id && editTooltip.type === 'volume' && (
                    <input
                      type="text"
                      value={editTooltip.text}
                      onChange={(e) => setEditTooltip({ ...editTooltip, text: e.target.value })}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => commitEditTooltip(track)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          commitEditTooltip(track);
                        } else if (e.key === 'Escape') {
                          setEditTooltip(null);
                        }
                      }}
                      className="fixed w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                      style={{ left: editTooltip.x, top: editTooltip.y, transform: 'translate(-50%, -100%)' }}
                      autoFocus
                    />
                  )}
                </div>

                <div
                  className="relative w-8 h-8 flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="absolute inset-0 overflow-hidden">
                    <div className="absolute inset-0 pan-ring pointer-events-none" />
                    <div className="absolute left-1/2 top-1/2 w-6 h-6 rounded-full bg-gray-700 border border-gray-600 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
                    <div
                      className="absolute left-1/2 top-1/2 w-[3px] h-3 bg-gray-200 rounded-full origin-bottom pointer-events-none"
                      style={{
                        transform: `translate(-50%, -100%) rotate(${(track.pan / 100) * 135}deg)`,
                      }}
                    />
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={track.pan}
                    readOnly
                    onMouseDown={(e) => {
                      if (e.detail > 1) return;
                      beginDrag(e, track.id, 'pan');
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handlePanDoubleClick(track, e);
                    }}
                    className="absolute top-0 left-0 right-0 h-4 pan-knob opacity-0 cursor-pointer z-10 pointer-events-auto appearance-none touch-none"
                    aria-label="Pan"
                  />
                  {dragTooltip?.trackId === track.id && dragTooltip.type === 'pan' && (
                    <div
                      className="fixed w-12 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                      style={{ left: dragTooltip.x, top: dragTooltip.y, transform: 'translate(-50%, -100%)' }}
                    >
                      {Math.round(dragTooltip.value)}
                    </div>
                  )}
                  {editTooltip?.trackId === track.id && editTooltip.type === 'pan' && (
                    <input
                      type="text"
                      value={editTooltip.text}
                      onChange={(e) => setEditTooltip({ ...editTooltip, text: e.target.value })}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => commitEditTooltip(track)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          commitEditTooltip(track);
                        } else if (e.key === 'Escape') {
                          setEditTooltip(null);
                        }
                      }}
                      className="fixed w-12 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                      style={{ left: editTooltip.x, top: editTooltip.y, transform: 'translate(-50%, -100%)' }}
                      autoFocus
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {contextMenu && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {contextMenu.type === 'track' ? (
            <>
              <button
                className="w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700"
                onClick={() => {
                  setEditingName(contextMenu.track.id);
                  setContextMenu(null);
                }}
              >
                Rename track
              </button>
              <div className="relative">
                <div
                  className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 select-none w-full cursor-pointer"
                  onMouseEnter={openTypeMenu}
                  onMouseLeave={() => setIsTypeTriggerHover(false)}
                  style={{ backgroundColor: (isTypeTriggerHover || isTypeMenuHover || isChoirTriggerHover || isChoirMenuHover) ? '#374151' : undefined }}
                >
                  <div className="flex items-center justify-between w-full">
                  <span>Change track type</span>
                  <ChevronRight size={14} className="text-gray-400 ml-0.5" />
                  </div>
                </div>
              </div>

              {contextMenu.track.role?.startsWith('choir-part-') && (
                <div className="relative">
                  <div
                    className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 select-none w-full cursor-pointer"
                    onMouseEnter={openAutoPanMenu}
                    onMouseLeave={() => setIsAutoPanTriggerHover(false)}
                    style={{ backgroundColor: (isAutoPanTriggerHover || isAutoPanMenuHover) ? '#374151' : undefined }}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span>Auto-pan choir</span>
                      <ChevronRight size={14} className="text-gray-400 ml-0.5" />
                    </div>
                  </div>
                </div>
              )}

              <button
                className="w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-red-300 hover:bg-gray-700"
                onClick={() => {
                  onDeleteTrack?.(contextMenu.track.id);
                  setContextMenu(null);
                }}
              >
                Delete track
              </button>

              <div className="my-0.5 border-t border-gray-700" />
              <button
                className="w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700"
                onClick={() => {
                  onAddTrack?.();
                  setContextMenu(null);
                }}
              >
                Create new track
              </button>
            </>
          ) : (
            <button
              className="w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700"
              onClick={() => {
                onAddTrack?.();
                setContextMenu(null);
              }}
            >
              Create a track
            </button>
          )}
        </div>
      )}

      {contextMenu && typeMenuOpen && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden min-w-[20px]"
          style={{ left: typeMenuPos.x, top: typeMenuPos.y }}
          onMouseEnter={() => setIsTypeMenuHover(true)}
          onMouseLeave={() => setIsTypeMenuHover(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap"
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.INSTRUMENT });
              setContextMenu(null);
            }}
          >
            Instrument
          </button>
          <button
            className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap"
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.LEAD });
              setContextMenu(null);
            }}
          >
            Lead
          </button>
          {autoPanManualChoirParts ? (
            <div
              className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 select-none whitespace-nowrap cursor-pointer"
              onMouseEnter={openChoirMenu}
              onMouseLeave={() => setIsChoirTriggerHover(false)}
              style={{ backgroundColor: (isChoirTriggerHover || isChoirMenuHover) ? '#374151' : undefined }}
            >
              <div className="flex items-center justify-between w-full">
                <span>Choir part</span>
                <ChevronRight size={14} className="text-gray-400 ml-0.5" />
              </div>
            </div>
          ) : (
            <button
              className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap"
              onClick={() => {
                onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.CHOIR_PART_1 });
                setContextMenu(null);
              }}
            >
              Choir part
            </button>
          )}
          <button
            className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap"
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.OTHER });
              setContextMenu(null);
            }}
          >
            Other
          </button>
        </div>
      )}

      {contextMenu && choirMenuOpen && autoPanManualChoirParts && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden min-w-[25px]"
          style={{ left: choirMenuPos.x, top: choirMenuPos.y }}
          onMouseEnter={() => setIsChoirMenuHover(true)}
          onMouseLeave={() => setIsChoirMenuHover(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap"
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.CHOIR_PART_1 });
              setContextMenu(null);
            }}
          >
            1
          </button>
          <button
            className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap"
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.CHOIR_PART_2 });
              setContextMenu(null);
            }}
          >
            2
          </button>
          <button
            className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap"
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.CHOIR_PART_3 });
              setContextMenu(null);
            }}
          >
            3
          </button>
          <button
            className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap"
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.CHOIR_PART_4 });
              setContextMenu(null);
            }}
          >
            4
          </button>
          <button
            className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap"
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.CHOIR_PART_5 });
              setContextMenu(null);
            }}
          >
            5
          </button>
        </div>
      )}

      {contextMenu && autoPanMenuOpen && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden min-w-[120px]"
          style={{ left: autoPanMenuPos.x, top: autoPanMenuPos.y }}
          onMouseEnter={() => setIsAutoPanMenuHover(true)}
          onMouseLeave={() => setIsAutoPanMenuHover(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap"
            onClick={() => {
              onToggleAutoPanInverted?.();
              setContextMenu(null);
            }}
          >
            Inverted Auto Pan: {autoPanInverted ? 'On' : 'Off'}
          </button>
          <div className="my-0.5 border-t border-gray-700" />
          <button
            className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap"
            onClick={() => {
              onSetAutoPanStrategy?.('off');
              setContextMenu(null);
            }}
          >
            Off
          </button>
          {AUTO_PAN_STRATEGIES.map((option) => (
            <button
              key={option.id}
              className="block text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap"
              onClick={() => {
                onSetAutoPanStrategy?.(option.id);
                setContextMenu(null);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default TrackList;
