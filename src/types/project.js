import { dbToVolume, normalizePanLawDb, DEFAULT_PAN_LAW_DB } from '../utils/audio';
import { DEFAULT_AUTO_PAN_SETTINGS } from '../utils/choirAutoPan';

/**
 * Project data model types (authoritative)
 * All time values are in milliseconds
 */

export const TRACK_ROLES = {
  INSTRUMENT: 'instrument',
  LEAD: 'lead',
  CHOIR_PART_1: 'choir-part-1',
  CHOIR_PART_2: 'choir-part-2',
  CHOIR_PART_3: 'choir-part-3',
  CHOIR_PART_4: 'choir-part-4',
  CHOIR_PART_5: 'choir-part-5',
  OTHER: 'other',
};

export const SAMPLE_RATE = 44100;
export const DEFAULT_EXPORT_SETTINGS = {
  gainDb: 4,
  attenuationDb: 4,
  transformedPanRange: 100,
};

export function normalizeExportSettings(settings = {}) {
  const next = {
    ...DEFAULT_EXPORT_SETTINGS,
    ...settings,
  };
  const gainDb = Number(next.gainDb);
  const attenuationDb = Number(next.attenuationDb);
  const transformedPanRange = Number(next.transformedPanRange);
  next.gainDb = Number.isFinite(gainDb) ? Math.max(0, Math.min(24, gainDb)) : DEFAULT_EXPORT_SETTINGS.gainDb;
  next.attenuationDb = Number.isFinite(attenuationDb)
    ? Math.max(0, Math.min(24, attenuationDb))
    : DEFAULT_EXPORT_SETTINGS.attenuationDb;
  next.transformedPanRange = Number.isFinite(transformedPanRange)
    ? Math.max(0, Math.min(200, transformedPanRange))
    : DEFAULT_EXPORT_SETTINGS.transformedPanRange;
  return next;
}

/**
 * @typedef {Object} Clip
 * @property {string} id - UUID
 * @property {string} blobId - IndexedDB blob reference
 * @property {number} timelineStartMs - Position on timeline in milliseconds
 * @property {number} sourceStartMs - Start position in source audio (ms)
 * @property {number} sourceDurationMs - Duration of source audio (ms)
 * @property {number} cropStartMs - Crop start offset (ms)
 * @property {number} cropEndMs - Crop end offset (ms)
 * @property {number} gainDb - Gain adjustment in dB
 * @property {boolean} muted - Clip mute state
 */

/**
 * @typedef {Object} Track
 * @property {string} id - UUID
 * @property {string} name - Track name
 * @property {string} role - Track role (from TRACK_ROLES)
 * @property {string} icon - Track icon key
 * @property {boolean} locked - Lock state (locked tracks are non-draggable)
 * @property {number} volume - Volume (0-100, maps to -60dB to 0dB)
 * @property {number} pan - Pan (-100 to +100, maps to -1 to +1)
 * @property {boolean} muted - Mute state
 * @property {boolean} soloed - Solo state
 * @property {Clip[]} clips - Array of clips on this track
 */

/**
 * @typedef {Object} Loop
 * @property {boolean} enabled - Loop enabled state
 * @property {number} startMs - Loop start in milliseconds
 * @property {number} endMs - Loop end in milliseconds
 */

/**
 * @typedef {Object} Project
 * @property {string} version - Project format version
 * @property {string} projectId - UUID
 * @property {string} projectName - Project name
 * @property {number} sampleRate - Sample rate (always 44100)
 * @property {number} masterVolume - Master volume (0-100)
 * @property {Object} autoPan - Auto-pan configuration
 * @property {boolean} autoPan.enabled - Auto-pan enabled
 * @property {string} autoPan.strategy - Auto-pan strategy id
 * @property {boolean} autoPan.inverted - Invert pan direction
 * @property {boolean} autoPan.manualChoirParts - Use manual choir part selection
 * @property {number} autoPan.rangeLimit - Max pan range
 * @property {number} autoPan.spreadK - Spread factor
 * @property {number} panLawDb - Pan law in dB at center (0, -3, -4.5, -6)
 * @property {Object} exportSettings - Export configuration
 * @property {number} exportSettings.gainDb - Practice target gain boost in dB
 * @property {number} exportSettings.attenuationDb - Practice non-target attenuation in dB
 * @property {number} exportSettings.transformedPanRange - Pan transform range control (0-200)
 * @property {Array} trackTree - Hierarchy nodes for groups/tracks
 * @property {Track[]} tracks - Array of tracks
 * @property {Loop} loop - Loop configuration
 * @property {number} undoStackSize - Max undo stack size (100)
 */

/**
 * Create a new empty project
 */
export function createEmptyProject(
  name = 'Untitled Project',
  autoPan = null,
  exportSettings = null,
  panLawDb = DEFAULT_PAN_LAW_DB
) {
  return {
    version: '1.0.0',
    projectId: crypto.randomUUID(),
    projectName: name,
    sampleRate: SAMPLE_RATE,
    masterVolume: dbToVolume(0),
    autoPan: autoPan ?? { ...DEFAULT_AUTO_PAN_SETTINGS },
    panLawDb: normalizePanLawDb(panLawDb),
    exportSettings: normalizeExportSettings(exportSettings || {}),
    trackTree: [],
    tracks: [],
    loop: { enabled: false, startMs: 0, endMs: 0 },
    undoStackSize: 100,
  };
}

/**
 * Create a new track
 */
export function createTrack(name, role = TRACK_ROLES.OTHER, locked = false) {
  const defaultIconByRole = {
    [TRACK_ROLES.INSTRUMENT]: 'music',
    [TRACK_ROLES.LEAD]: 'mic',
    [TRACK_ROLES.CHOIR_PART_1]: 'users',
    [TRACK_ROLES.CHOIR_PART_2]: 'users',
    [TRACK_ROLES.CHOIR_PART_3]: 'users',
    [TRACK_ROLES.CHOIR_PART_4]: 'users',
    [TRACK_ROLES.CHOIR_PART_5]: 'users',
    [TRACK_ROLES.OTHER]: 'wave',
  };

  return {
    id: crypto.randomUUID(),
    name,
    role,
    icon: defaultIconByRole[role] || 'wave',
    locked,
    volume: dbToVolume(0),
    pan: 0,
    muted: false,
    soloed: false,
    clips: [],
  };
}

/**
 * Create a new clip
 */
export function createClip(blobId, timelineStartMs, sourceDurationMs) {
  return {
    id: crypto.randomUUID(),
    blobId,
    timelineStartMs,
    sourceStartMs: 0,
    sourceDurationMs,
    cropStartMs: 0,
    cropEndMs: sourceDurationMs,
    gainDb: 0.0,
    muted: false,
  };
}
