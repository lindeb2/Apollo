import { useState } from 'react';
import { Lock, Unlock, Volume2, VolumeX, Headphones, Mic, Music, Users, Waves } from 'lucide-react';
import { TRACK_ROLES } from '../types/project';

const TRACK_HEIGHT = 120;
const LOCKED_TRACK_HEIGHT = 120; // Keep layout consistent for locked tracks

function TrackList({ tracks, onUpdateTrack, onSelectTrack, selectedTrackId }) {
  const [editingName, setEditingName] = useState(null);
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
            } ${track.locked ? 'bg-gray-850 border-l-4 border-l-gray-600' : ''}`}
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

                <div className="flex-1 flex items-center">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={track.volume}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleVolumeChange(track.id, e.target.value);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full volume-slider volume-slider-lg cursor-pointer"
                  />
                </div>

                <div className="relative w-12 h-12 flex-shrink-0">
                  <div className="absolute inset-0 rounded-full bg-gray-800 border border-gray-600 shadow-inner pointer-events-none" />
                  <div className="absolute inset-1 rounded-full bg-gray-700 shadow-inner pointer-events-none" />
                  <div
                    className="absolute left-1/2 top-1/2 w-1 h-3 bg-gray-200 rounded-full origin-bottom pointer-events-none"
                    style={{
                      transform: `translate(-50%, -100%) rotate(${(track.pan / 100) * 135}deg)`,
                    }}
                  />
                  <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 rounded-full bg-emerald-400 -translate-x-1/2 -translate-y-5 pointer-events-none" />
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={track.pan}
                    onChange={(e) => {
                      e.stopPropagation();
                      handlePanChange(track.id, e.target.value);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-0 pan-knob opacity-0 cursor-pointer z-10 pointer-events-auto appearance-none touch-none"
                    aria-label="Pan"
                  />
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
