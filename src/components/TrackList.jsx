import { useEffect, useRef, useState } from 'react';
import { Lock, Unlock, Volume2, VolumeX, Headphones, Mic, Music, Users, Waves } from 'lucide-react';
import { TRACK_ROLES } from '../types/project';
import { dbToVolume, volumeToDb } from '../utils/audio';

const TRACK_HEIGHT = 120;
const LOCKED_TRACK_HEIGHT = 120; // Keep layout consistent for locked tracks

function TrackList({ tracks, onUpdateTrack, onSelectTrack, selectedTrackId }) {
  const [editingName, setEditingName] = useState(null);
  const dragRef = useRef(null);
  const [dragTooltip, setDragTooltip] = useState(null);
  const [editTooltip, setEditTooltip] = useState(null);
  const iconOptions = [
    { key: 'mic', Icon: Mic },
    { key: 'music', Icon: Music },
    { key: 'users', Icon: Users },
    { key: 'wave', Icon: Waves },
  ];

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
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      trackId,
      type,
      startX: e.clientX,
      startValue: type === 'volume'
        ? tracks.find(t => t.id === trackId)?.volume ?? 0
        : tracks.find(t => t.id === trackId)?.pan ?? 0,
      width: rect.width,
      moved: false,
    };
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
      setDragTooltip({ trackId, type, value: next });
    } else {
      const range = 200; // -100 to +100
      const next = Math.min(100, Math.max(-100, startValue + (deltaX / width) * range));
      handlePanChange(trackId, next);
      setDragTooltip({ trackId, type, value: next });
    }
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragTooltip(null);
  };

  const handleVolumeDoubleClick = (track) => {
    setDragTooltip(null);
    const display = track.volume <= 0 ? '-∞' : volumeToDb(track.volume).toFixed(1);
    setEditTooltip({ trackId: track.id, type: 'volume', text: display });
  };

  const handlePanDoubleClick = (track) => {
    setDragTooltip(null);
    setEditTooltip({ trackId: track.id, type: 'pan', text: track.pan.toFixed(0) });
  };

  const commitEditTooltip = (track) => {
    if (!editTooltip) return;
    const text = editTooltip.text.trim();
    if (editTooltip.type === 'volume') {
      if (!text) {
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
    const handleMove = (e) => handleDragMove(e);
    const handleUp = () => endDrag();
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

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
    <div className="flex flex-col">
      {tracks.map((track) => {
        const trackHeight = track.locked ? LOCKED_TRACK_HEIGHT : TRACK_HEIGHT;
        const { Icon: TrackIcon } = getIconForTrack(track);
        
        return (
          <div
            key={track.id}
            className={`border-b border-gray-700 px-4 py-3 cursor-pointer transition-colors ${
              selectedTrackId === track.id
                ? 'bg-gray-700'
                : 'bg-gray-800 hover:bg-gray-750'
            } ${track.locked ? 'bg-gray-850' : ''}`}
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

            <div className="flex-1 min-w-0 flex flex-col gap-3">
              {/* Upper Row: Name */}
              <div
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
                    className="flex-1 bg-transparent border-b border-blue-500 px-0 py-0 text-lg leading-tight focus:outline-none min-w-0"
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingName(track.id);
                    }}
                    className="flex-1 text-lg font-semibold truncate min-w-0"
                    title="Double-click to edit"
                  >
                    {track.name}
                  </span>
                )}
              </div>

              {/* Lower Row: Controls */}
              <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-0">
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

                <div className="flex-1 flex items-center relative">
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
                      handleVolumeDoubleClick(track);
                    }}
                    className="w-full volume-slider volume-slider-lg cursor-pointer"
                  />
                  {dragTooltip?.trackId === track.id && dragTooltip.type === 'volume' && (
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center">
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
                      className="absolute -top-8 left-1/2 -translate-x-1/2 w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none"
                      autoFocus
                    />
                  )}
                </div>

                <div className="relative w-8 h-8 flex-shrink-0">
                  <div className="absolute inset-0 pan-ring pointer-events-none" />
                  <div className="absolute left-1/2 top-1/2 w-6 h-6 rounded-full bg-gray-700 border border-gray-600 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
                  <div
                    className="absolute left-1/2 top-1/2 w-1 h-3 bg-gray-200 rounded-full origin-bottom pointer-events-none"
                    style={{
                      transform: `translate(-50%, -100%) rotate(${(track.pan / 100) * 135}deg)`,
                    }}
                  />
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
                      handlePanDoubleClick(track);
                    }}
                    className="absolute inset-0 pan-knob opacity-0 cursor-pointer z-10 pointer-events-auto appearance-none touch-none"
                    aria-label="Pan"
                  />
                  {dragTooltip?.trackId === track.id && dragTooltip.type === 'pan' && (
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-12 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center">
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
                      className="absolute -top-8 left-1/2 -translate-x-1/2 w-12 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none"
                      autoFocus
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default TrackList;
