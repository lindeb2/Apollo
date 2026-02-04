import { useState } from 'react';
import { Lock, Unlock, Volume2, VolumeX } from 'lucide-react';
import { volumeToDb, dbToVolume } from '../utils/audio';
import { TRACK_ROLES } from '../types/project';

const TRACK_HEIGHT = 140; // Increased from 120 to prevent overflow
const LOCKED_TRACK_HEIGHT = 40; // Increased to accommodate waveforms

// Define role cycle order
const ROLE_ORDER = [
  TRACK_ROLES.INSTRUMENT,
  TRACK_ROLES.LEAD,
  TRACK_ROLES.CHOIR_PART_1,
  TRACK_ROLES.CHOIR_PART_2,
  TRACK_ROLES.CHOIR_PART_3,
  TRACK_ROLES.CHOIR_PART_4,
  TRACK_ROLES.CHOIR_PART_5,
  TRACK_ROLES.OTHER,
];

function TrackList({ tracks, onUpdateTrack, onSelectTrack, selectedTrackId }) {
  const [editingName, setEditingName] = useState(null);

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

  const handleRoleClick = (trackId, currentRole) => {
    const currentIndex = ROLE_ORDER.indexOf(currentRole);
    const nextIndex = (currentIndex + 1) % ROLE_ORDER.length;
    const nextRole = ROLE_ORDER[nextIndex];
    onUpdateTrack(trackId, { role: nextRole });
  };

  const getRoleLabel = (role) => {
    const labels = {
      'instrument': 'Inst',
      'lead': 'Lead',
      'choir-part-1': 'C1',
      'choir-part-2': 'C2',
      'choir-part-3': 'C3',
      'choir-part-4': 'C4',
      'choir-part-5': 'C5',
      'other': 'Other',
    };
    return labels[role] || role;
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
        
        return (
          <div
            key={track.id}
            onClick={() => onSelectTrack(track.id)}
            className={`border-b border-gray-700 px-3 py-2 cursor-pointer transition-colors ${
              selectedTrackId === track.id
                ? 'bg-gray-700'
                : 'bg-gray-800 hover:bg-gray-750'
            } ${track.locked ? 'bg-gray-850 border-l-4 border-l-gray-600' : ''}`}
            style={{ 
              height: `${trackHeight}px`,
              minHeight: `${trackHeight}px`,
              maxHeight: `${trackHeight}px`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: track.locked ? 'center' : 'space-between'
            }}
          >
            {track.locked ? (
              // Compact locked track view
              <div className="flex items-center gap-2">
                {/* Lock Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleLock(track.id, track.locked);
                  }}
                  className="p-1 rounded transition-colors flex-shrink-0 text-gray-500 hover:text-gray-400"
                  title="Unlock track"
                >
                  <Lock size={16} />
                </button>

                {/* Track Name (smaller for locked) */}
                <span className="flex-1 text-sm text-gray-400 truncate italic min-w-0">
                  {track.name}
                </span>
              </div>
            ) : (
              // Full track view
              <>
                {/* Top Row: Name, Role, Controls */}
                <div className="flex items-center gap-2 mb-1">
                  {/* Lock Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleLock(track.id, track.locked);
                    }}
                    className="p-1 rounded transition-colors flex-shrink-0 text-gray-500 hover:text-gray-400"
                    title="Lock track"
                  >
                    <Unlock size={14} />
                  </button>

                  {/* Track Name */}
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
                      className="flex-1 bg-transparent border-b border-blue-500 px-0 py-0 text-sm leading-tight focus:outline-none min-w-0"
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingName(track.id);
                      }}
                      className="flex-1 text-sm font-medium truncate min-w-0"
                      title="Double-click to edit"
                    >
                      {track.name}
                    </span>
                  )}

                  {/* Role Badge (Clickable) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRoleClick(track.id, track.role);
                    }}
                    className={`text-xs ${getRoleColor(track.role)} hover:opacity-80 transition-opacity px-2 py-1 rounded flex-shrink-0 font-semibold text-white`}
                    title={`Click to change role (current: ${track.role})`}
                  >
                    {getRoleLabel(track.role)}
                  </button>

                  {/* Mute Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleMute(track.id, track.muted);
                    }}
                    className={`p-1 rounded transition-colors flex-shrink-0 ${
                      track.muted
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                    title={track.muted ? 'Unmute' : 'Mute'}
                  >
                    {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>

                  {/* Solo Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleSolo(track.id, track.soloed);
                    }}
                    className={`px-2 py-1 rounded text-xs font-semibold transition-colors flex-shrink-0 ${
                      track.soloed
                        ? 'bg-yellow-600 text-white'
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                    title={track.soloed ? 'Unsolo' : 'Solo'}
                  >
                    S
                  </button>
                </div>

                {/* Middle Row: Volume Control */}
                <div className="mb-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-gray-400">Vol</label>
                    <span className="text-xs text-gray-500">
                      {volumeToDb(track.volume).toFixed(1)} dB
                    </span>
                  </div>
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
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                </div>

                {/* Bottom Row: Pan Control */}
                <div className="mb-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-gray-400">Pan</label>
                    <span className="text-xs text-gray-500">
                      {track.pan > 0 ? 'R' : track.pan < 0 ? 'L' : 'C'}
                      {track.pan !== 0 ? Math.abs(track.pan) : ''}
                    </span>
                  </div>
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
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default TrackList;
