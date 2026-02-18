import {
  volumeToGain,
  dbToGain,
  gainToDb,
  msToSeconds,
  normalizePanLawDb,
  getPanLawCompensationGain,
  getPanLawHeadroomGain,
} from '../utils/audio';
import lamejs from 'lamejs';
import {
  SAMPLE_RATE,
  DEFAULT_EXPORT_SETTINGS,
  normalizeExportSettings,
} from '../types/project';
import { applyChoirAutoPanToProject, normalizeAutoPanSettings } from '../utils/choirAutoPan';
import { getEffectiveTrackMix } from '../utils/trackTree';
import {
  TRACK_ROLE_CHOIR,
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  toCategoryRole,
} from '../utils/trackRoles';

export const EXPORT_PRESETS = {
  TUTTI: 'tutti',
  ACAPELLA: 'acapella',
  NO_LEAD: 'no_lead',
  NO_CHOIR: 'no_choir',
  INSTRUMENTAL: 'instrumental',
  LEAD_ONLY: 'lead_only',
  CHOIR_ONLY: 'choir_only',
  INSTRUMENT_PARTS: 'instrument_parts',
  LEAD_PARTS: 'lead_parts',
  CHOIR_PARTS: 'choir_parts',
  INSTRUMENT_PARTS_OMITTED: 'instrument_parts_omitted',
  LEAD_PARTS_OMITTED: 'lead_parts_omitted',
  CHOIR_PARTS_OMITTED: 'choir_parts_omitted',
};

export const EXPORT_PRESET_DEFINITIONS = [
  { id: EXPORT_PRESETS.TUTTI, label: 'Tutti', description: 'All tracks, no adjustments' },
  { id: EXPORT_PRESETS.ACAPELLA, label: 'No Instruments', description: 'Lead + choir' },
  { id: EXPORT_PRESETS.NO_LEAD, label: 'No Lead', description: 'Instrument + choir' },
  { id: EXPORT_PRESETS.NO_CHOIR, label: 'No Choir', description: 'Instrument + lead' },
  { id: EXPORT_PRESETS.INSTRUMENTAL, label: 'Instruments Only', description: 'Instrument only' },
  { id: EXPORT_PRESETS.LEAD_ONLY, label: 'Lead Only', description: 'Lead only' },
  { id: EXPORT_PRESETS.CHOIR_ONLY, label: 'Choir Only', description: 'Choir only' },
  { id: EXPORT_PRESETS.INSTRUMENT_PARTS, label: 'Instruments Parts', description: 'Practice mix per instrument track' },
  { id: EXPORT_PRESETS.LEAD_PARTS, label: 'Leads Parts', description: 'Practice mix per lead track' },
  { id: EXPORT_PRESETS.CHOIR_PARTS, label: 'Choir Parts', description: 'Practice mix per choir track' },
  { id: EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED, label: 'Instrument Parts Omitted', description: 'One mix per instrument omitted' },
  { id: EXPORT_PRESETS.LEAD_PARTS_OMITTED, label: 'Lead Parts Omitted', description: 'One mix per lead omitted' },
  { id: EXPORT_PRESETS.CHOIR_PARTS_OMITTED, label: 'Choir Parts Omitted', description: 'One mix per choir omitted (remaining choir auto-pan)' },
];

const VALID_PRESETS = new Set(EXPORT_PRESET_DEFINITIONS.map((preset) => preset.id));
const PRACTICE_FOCUS_PEAK_DB = -1;

function clampPan(pan) {
  return Math.max(-100, Math.min(100, Number(pan) || 0));
}

function getLeftRemapMax(transformedPanRange) {
  const control = Math.max(0, Math.min(200, Number(transformedPanRange) || 0));
  // 0 -> -100 (hard left), 100 -> 0 (left half), 200 -> 100 (identity)
  return control - 100;
}

function remapPanValue(value, oldMin, oldMax, newMin, newMax) {
  if (oldMax === oldMin) return (newMin + newMax) / 2;
  return newMin + ((value - oldMin) / (oldMax - oldMin)) * (newMax - newMin);
}

function remapPansToSide(trackIds, basePanByTrackId, direction, transformedPanRange) {
  if (!trackIds.length) return {};

  const leftMax = getLeftRemapMax(transformedPanRange);
  const rightMin = -leftMax;
  const oldValues = trackIds.map((trackId) => clampPan(basePanByTrackId[trackId]));
  const oldMin = Math.min(...oldValues);
  const oldMax = Math.max(...oldValues);
  const newMin = direction === 'left' ? -100 : rightMin;
  const newMax = direction === 'left' ? leftMax : 100;
  const fixedValue = direction === 'left' ? newMin : newMax;

  const mapped = {};
  for (const trackId of trackIds) {
    if (oldMax === oldMin) {
      mapped[trackId] = fixedValue;
      continue;
    }
    mapped[trackId] = clampPan(
      remapPanValue(clampPan(basePanByTrackId[trackId]), oldMin, oldMax, newMin, newMax)
    );
  }
  return mapped;
}

function buildPracticePanMap({
  tracks,
  targetTrackIds,
  basePanByTrackId,
  transformedPanRange,
}) {
  const targetSet = new Set(targetTrackIds || []);
  const trackIds = tracks.map((track) => track.id);
  const leftIds = trackIds.filter((trackId) => !targetSet.has(trackId));
  const leftMax = getLeftRemapMax(transformedPanRange);
  const transformedCenterOnLeft = remapPanValue(0, -100, 100, -100, leftMax);
  const targetPan = clampPan(-transformedCenterOnLeft);

  const panMap = {
    ...remapPansToSide(leftIds, basePanByTrackId, 'left', transformedPanRange),
  };
  for (const trackId of trackIds) {
    if (targetSet.has(trackId)) {
      panMap[trackId] = clampPan(targetPan);
    }
  }
  return panMap;
}

function getAudioBufferPeak(audioBuffer) {
  if (!audioBuffer) return 0;
  let peak = 0;
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  return peak;
}

function getAudioBufferChannelPeak(audioBuffer, channelIndex) {
  if (!audioBuffer || channelIndex < 0 || channelIndex >= audioBuffer.numberOfChannels) {
    return 0;
  }
  let peak = 0;
  const data = audioBuffer.getChannelData(channelIndex);
  for (let i = 0; i < data.length; i += 1) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

export async function measureTuttiPeak(project, audioBuffers) {
  const mix = getEffectiveTrackMix(project);
  const trackStateById = mix.statesByTrackId;
  const activeTracks = (project.tracks || []).filter((track) => trackStateById.get(track.id)?.audible);
  if (!activeTracks.length) {
    return { peak: 0, peakDbfs: -Infinity };
  }
  const rendered = await renderTracksToAudioBuffer(project, activeTracks, audioBuffers, {}, {}, trackStateById);
  const peak = getAudioBufferPeak(rendered);
  return {
    peak,
    peakDbfs: peak > 0 ? gainToDb(peak) : -Infinity,
  };
}

async function buildPracticePeakNormalizedGainMap({
  project,
  tracks,
  audioBuffers,
  panAdjustments,
  targetTrackIds,
  trackStateById,
  practiceFocusDiffDb,
}) {
  const gainMap = {};
  if (!tracks.length) return gainMap;

  const targetSet = new Set(targetTrackIds || []);
  const focusTracks = tracks.filter((track) => targetSet.has(track.id));
  const backingTracks = tracks.filter((track) => !targetSet.has(track.id));

  let focusScale = 1;
  let backingScale = 1;
  const diffDb = Math.max(-6, Math.min(6, Number(practiceFocusDiffDb) || 0));
  const backingTargetPeakDb = PRACTICE_FOCUS_PEAK_DB - diffDb;

  if (focusTracks.length) {
    const focusBuffer = await renderTracksToAudioBuffer(
      project,
      focusTracks,
      audioBuffers,
      {},
      panAdjustments,
      trackStateById
    );
    const focusPeakRight = getAudioBufferChannelPeak(focusBuffer, 1);
    if (focusPeakRight > 0) {
      focusScale = dbToGain(PRACTICE_FOCUS_PEAK_DB) / focusPeakRight;
    }
  }

  if (backingTracks.length) {
    const backingBuffer = await renderTracksToAudioBuffer(
      project,
      backingTracks,
      audioBuffers,
      {},
      panAdjustments,
      trackStateById
    );
    const backingPeakLeft = getAudioBufferChannelPeak(backingBuffer, 0);
    if (backingPeakLeft > 0) {
      backingScale = dbToGain(backingTargetPeakDb) / backingPeakLeft;
    }
  }

  for (const track of tracks) {
    gainMap[track.id] = targetSet.has(track.id) ? focusScale : backingScale;
  }

  const mixedBuffer = await renderTracksToAudioBuffer(
    project,
    tracks,
    audioBuffers,
    gainMap,
    panAdjustments,
    trackStateById
  );
  const mixedPeak = getAudioBufferPeak(mixedBuffer);
  if (mixedPeak > 1) {
    const safetyScale = 1 / mixedPeak;
    for (const track of tracks) {
      gainMap[track.id] *= safetyScale;
    }
  }

  return gainMap;
}

function getAutoPannedChoirPanMap(project, choirTracks) {
  if (!choirTracks.length) return {};

  const tempProject = {
    ...project,
    autoPan: normalizeAutoPanSettings({
      ...project.autoPan,
      enabled: true,
    }),
    tracks: choirTracks.map((track) => ({ ...track, role: TRACK_ROLE_CHOIR })),
    trackTree: choirTracks.map((track, idx) => ({
      id: `auto-pan-${track.id}`,
      kind: 'track',
      parentId: null,
      order: idx,
      trackId: track.id,
    })),
  };

  const result = applyChoirAutoPanToProject(tempProject, { enabled: true });
  const mix = getEffectiveTrackMix(result.project);
  const panMap = {};
  for (const track of choirTracks) {
    const state = mix.statesByTrackId.get(track.id);
    panMap[track.id] = clampPan(Number.isFinite(state?.effectivePan) ? state.effectivePan : track.pan);
  }
  return panMap;
}

function createFileName(projectBase, label = '', format = 'wav') {
  const cleanLabel = (label || '').trim();
  return cleanLabel
    ? `${projectBase} - ${cleanLabel}.${format}`
    : `${projectBase}.${format}`;
}

function getRoleUnits(activeTracks, trackStateById, role) {
  const unitsById = new Map();
  for (const track of activeTracks) {
    const state = trackStateById.get(track.id);
    if (state?.effectiveRole !== role) continue;
    const unitId = state.roleUnitId || `track:${track.id}`;
    if (!unitsById.has(unitId)) {
      unitsById.set(unitId, {
        unitId,
        label: state.roleUnitName || track.name,
        trackIds: [],
      });
    }
    unitsById.get(unitId).trackIds.push(track.id);
  }
  return Array.from(unitsById.values());
}

function getChoirUnits(activeTracks, trackStateById) {
  const unitsById = new Map();
  for (const track of activeTracks) {
    const state = trackStateById.get(track.id);
    if (state?.effectiveRole !== TRACK_ROLE_CHOIR) continue;
    const unitId = state.choirUnitId || state.roleUnitId || `track:${track.id}`;
    if (!unitsById.has(unitId)) {
      unitsById.set(unitId, {
        unitId,
        label: state.choirUnitName || state.roleUnitName || track.name,
        trackIds: [],
      });
    }
    unitsById.get(unitId).trackIds.push(track.id);
  }
  return Array.from(unitsById.values());
}

function withExportLayout(files) {
  const hasPracticeNormal = files.some((file) => file.branch === 'normal');
  const hasPracticeOmitted = files.some((file) => file.branch === 'omitted');

  return files.map((file) => {
    const segments = [];
    if (file.branch === 'normal') {
      segments.push('Practice');
      if (hasPracticeNormal && hasPracticeOmitted) {
        segments.push('Normal');
      }
      if (file.subgroup && file.subgroupCount > 1) {
        segments.push(file.subgroup);
      }
    } else if (file.branch === 'omitted') {
      segments.push('Practice');
      if (hasPracticeNormal && hasPracticeOmitted) {
        segments.push('Omitted');
      }
      if (file.subgroup && file.subgroupCount > 1) {
        segments.push(file.subgroup);
      }
    }

    return {
      filename: file.filename,
      relativePath: segments.length ? `${segments.join('/')}/${file.filename}` : file.filename,
      blob: file.blob,
      presetId: file.presetId,
    };
  });
}

/**
 * Main export function.
 * Returns array of `{ filename, relativePath, blob, presetId }`.
 */
export async function exportProject(
  project,
  selectedPresets,
  audioBuffers,
  exportSettingsOverride = null,
  exportBaseName = null,
  format = 'wav'
) {
  const outputFormat = format === 'mp3' ? 'mp3' : 'wav';
  const presetIds = Array.isArray(selectedPresets)
    ? [...new Set(selectedPresets.filter((id) => VALID_PRESETS.has(id)))]
    : (VALID_PRESETS.has(selectedPresets) ? [selectedPresets] : []);

  if (!presetIds.length) {
    throw new Error('No export presets selected.');
  }

  const exportSettings = normalizeExportSettings({
    ...DEFAULT_EXPORT_SETTINGS,
    ...(project.exportSettings || {}),
    ...(exportSettingsOverride || {}),
  });

  const allTracks = project.tracks || [];
  const mix = getEffectiveTrackMix(project);
  const trackStateById = mix.statesByTrackId;
  const activeTracks = allTracks.filter((track) => trackStateById.get(track.id)?.audible);
  const effectiveRole = (track) => trackStateById.get(track.id)?.effectiveRole || toCategoryRole(track.role);
  const instrumentTracks = activeTracks.filter((track) => effectiveRole(track) === TRACK_ROLE_INSTRUMENT);
  const leadTracks = activeTracks.filter((track) => effectiveRole(track) === TRACK_ROLE_LEAD);
  const choirTracks = activeTracks.filter((track) => effectiveRole(track) === TRACK_ROLE_CHOIR);
  const instrumentUnits = getRoleUnits(activeTracks, trackStateById, TRACK_ROLE_INSTRUMENT);
  const leadUnits = getRoleUnits(activeTracks, trackStateById, TRACK_ROLE_LEAD);
  const choirUnits = getChoirUnits(activeTracks, trackStateById);
  const projectBase = exportBaseName || project.projectName || 'project';
  const files = [];

  for (const presetId of presetIds) {
    if (presetId === EXPORT_PRESETS.TUTTI) {
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'All', outputFormat),
        blob: await renderTracks(project, activeTracks, audioBuffers, {}, {}, outputFormat, trackStateById),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.ACAPELLA) {
      const tracks = activeTracks.filter((track) => (
        effectiveRole(track) === TRACK_ROLE_LEAD || effectiveRole(track) === TRACK_ROLE_CHOIR
      ));
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'Lead and Choir', outputFormat),
        blob: await renderTracks(project, tracks, audioBuffers, {}, {}, outputFormat, trackStateById),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.NO_LEAD) {
      const tracks = activeTracks.filter((track) => (
        effectiveRole(track) === TRACK_ROLE_INSTRUMENT || effectiveRole(track) === TRACK_ROLE_CHOIR
      ));
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'No Lead', outputFormat),
        blob: await renderTracks(project, tracks, audioBuffers, {}, {}, outputFormat, trackStateById),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.NO_CHOIR) {
      const tracks = activeTracks.filter((track) => (
        effectiveRole(track) === TRACK_ROLE_INSTRUMENT || effectiveRole(track) === TRACK_ROLE_LEAD
      ));
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'No Choir', outputFormat),
        blob: await renderTracks(project, tracks, audioBuffers, {}, {}, outputFormat, trackStateById),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.INSTRUMENTAL) {
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'Instruments Only', outputFormat),
        blob: await renderTracks(project, instrumentTracks, audioBuffers, {}, {}, outputFormat, trackStateById),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.LEAD_ONLY) {
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'Leads Only', outputFormat),
        blob: await renderTracks(project, leadTracks, audioBuffers, {}, {}, outputFormat, trackStateById),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.CHOIR_ONLY) {
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, 'Choir Only', outputFormat),
        blob: await renderTracks(project, choirTracks, audioBuffers, {}, {}, outputFormat, trackStateById),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.INSTRUMENT_PARTS) {
      for (const targetUnit of instrumentUnits) {
        const targetTrackIds = targetUnit.trackIds;
        const basePanByTrackId = Object.fromEntries(activeTracks.map((track) => [track.id, clampPan(trackStateById.get(track.id)?.effectivePan ?? track.pan)]));
        const panAdjustments = buildPracticePanMap({
          tracks: activeTracks,
          targetTrackIds,
          basePanByTrackId,
          transformedPanRange: exportSettings.transformedPanRange,
        });
        const gainAdjustments = await buildPracticePeakNormalizedGainMap({
          project,
          tracks: activeTracks,
          audioBuffers,
          panAdjustments,
          targetTrackIds,
          trackStateById,
          practiceFocusDiffDb: exportSettings.practiceFocusDiffDb,
        });
        files.push({
          presetId,
          branch: 'normal',
          subgroup: 'Instruments',
          subgroupCount: instrumentUnits.length,
          filename: createFileName(projectBase, targetUnit.label, outputFormat),
          blob: await renderTracks(project, activeTracks, audioBuffers, gainAdjustments, panAdjustments, outputFormat, trackStateById),
        });
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.LEAD_PARTS) {
      for (const targetUnit of leadUnits) {
        const targetTrackIds = targetUnit.trackIds;
        const basePanByTrackId = Object.fromEntries(activeTracks.map((track) => [track.id, clampPan(trackStateById.get(track.id)?.effectivePan ?? track.pan)]));
        const panAdjustments = buildPracticePanMap({
          tracks: activeTracks,
          targetTrackIds,
          basePanByTrackId,
          transformedPanRange: exportSettings.transformedPanRange,
        });
        const gainAdjustments = await buildPracticePeakNormalizedGainMap({
          project,
          tracks: activeTracks,
          audioBuffers,
          panAdjustments,
          targetTrackIds,
          trackStateById,
          practiceFocusDiffDb: exportSettings.practiceFocusDiffDb,
        });
        files.push({
          presetId,
          branch: 'normal',
          subgroup: 'Leads',
          subgroupCount: leadUnits.length,
          filename: createFileName(projectBase, targetUnit.label, outputFormat),
          blob: await renderTracks(project, activeTracks, audioBuffers, gainAdjustments, panAdjustments, outputFormat, trackStateById),
        });
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.CHOIR_PARTS) {
      for (const targetUnit of choirUnits) {
        const targetTrackIds = targetUnit.trackIds;
        const otherChoirTracks = choirTracks.filter((track) => !targetTrackIds.includes(track.id));
        const autoPannedChoirMap = getAutoPannedChoirPanMap(project, otherChoirTracks);
        const basePanByTrackId = Object.fromEntries(activeTracks.map((track) => [track.id, clampPan(trackStateById.get(track.id)?.effectivePan ?? track.pan)]));
        Object.assign(basePanByTrackId, autoPannedChoirMap);

        const panAdjustments = buildPracticePanMap({
          tracks: activeTracks,
          targetTrackIds,
          basePanByTrackId,
          transformedPanRange: exportSettings.transformedPanRange,
        });
        const gainAdjustments = await buildPracticePeakNormalizedGainMap({
          project,
          tracks: activeTracks,
          audioBuffers,
          panAdjustments,
          targetTrackIds,
          trackStateById,
          practiceFocusDiffDb: exportSettings.practiceFocusDiffDb,
        });
        files.push({
          presetId,
          branch: 'normal',
          subgroup: 'Choir',
          subgroupCount: choirUnits.length,
          filename: createFileName(projectBase, targetUnit.label, outputFormat),
          blob: await renderTracks(project, activeTracks, audioBuffers, gainAdjustments, panAdjustments, outputFormat, trackStateById),
        });
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED) {
      for (const omittedUnit of instrumentUnits) {
        const tracks = activeTracks.filter((track) => !omittedUnit.trackIds.includes(track.id));
        files.push({
          presetId,
          branch: 'omitted',
          subgroup: 'Instruments',
          subgroupCount: instrumentUnits.length,
          filename: createFileName(projectBase, `${omittedUnit.label} Omitted`, outputFormat),
          blob: await renderTracks(project, tracks, audioBuffers, {}, {}, outputFormat, trackStateById),
        });
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.LEAD_PARTS_OMITTED) {
      for (const omittedUnit of leadUnits) {
        const tracks = activeTracks.filter((track) => !omittedUnit.trackIds.includes(track.id));
        files.push({
          presetId,
          branch: 'omitted',
          subgroup: 'Leads',
          subgroupCount: leadUnits.length,
          filename: createFileName(projectBase, `${omittedUnit.label} Omitted`, outputFormat),
          blob: await renderTracks(project, tracks, audioBuffers, {}, {}, outputFormat, trackStateById),
        });
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.CHOIR_PARTS_OMITTED) {
      for (const omittedUnit of choirUnits) {
        const tracks = activeTracks.filter((track) => !omittedUnit.trackIds.includes(track.id));
        const remainingChoirTracks = choirTracks.filter((track) => !omittedUnit.trackIds.includes(track.id));
        const autoPannedChoirMap = getAutoPannedChoirPanMap(project, remainingChoirTracks);
        files.push({
          presetId,
          branch: 'omitted',
          subgroup: 'Choir',
          subgroupCount: choirUnits.length,
          filename: createFileName(projectBase, `${omittedUnit.label} Omitted`, outputFormat),
          blob: await renderTracks(project, tracks, audioBuffers, {}, autoPannedChoirMap, outputFormat, trackStateById),
        });
      }
    }
  }

  return withExportLayout(files);
}

async function renderTracksToAudioBuffer(project, tracks, audioBuffers, gainAdjustments = {}, panAdjustments = {}, trackStateById = null) {
  let maxDurationMs = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.timelineStartMs + (clip.cropEndMs - clip.cropStartMs);
      maxDurationMs = Math.max(maxDurationMs, clipEnd);
    }
  }

  // Render exactly to the last clip end (no extra tail padding).
  const length = Math.max(1, Math.ceil(msToSeconds(maxDurationMs) * SAMPLE_RATE));
  const offlineContext = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const panLawDb = normalizePanLawDb(project?.panLawDb);

  const masterGain = offlineContext.createGain();
  masterGain.gain.value = volumeToGain(project.masterVolume) * getPanLawHeadroomGain(panLawDb);
  masterGain.connect(offlineContext.destination);

  for (const track of tracks) {
    const effective = trackStateById?.get(track.id) || null;
    if (effective && !effective.audible) continue;

    const baseGain = Number.isFinite(effective?.effectiveGain)
      ? effective.effectiveGain
      : volumeToGain(track.volume);
    const adjustmentGain = gainAdjustments[track.id] || 1.0;
    const totalGain = baseGain * adjustmentGain;
    const totalPan = clampPan(
      panAdjustments[track.id] !== undefined
        ? panAdjustments[track.id]
        : (Number.isFinite(effective?.effectivePan) ? effective.effectivePan : track.pan)
    );
    const panLawCompensationGain = getPanLawCompensationGain(totalPan, panLawDb);

    for (const clip of track.clips) {
      if (clip.muted) continue;

      const audioBuffer = audioBuffers.get(clip.blobId);
      if (!audioBuffer) continue;

      const source = offlineContext.createBufferSource();
      source.buffer = audioBuffer;

      const gainNode = offlineContext.createGain();
      gainNode.gain.value = totalGain * dbToGain(clip.gainDb) * panLawCompensationGain;

      const panNode = offlineContext.createStereoPanner();
      panNode.pan.value = totalPan / 100;

      source.connect(gainNode);
      gainNode.connect(panNode);
      panNode.connect(masterGain);

      source.start(
        msToSeconds(clip.timelineStartMs),
        msToSeconds(clip.cropStartMs),
        msToSeconds(clip.cropEndMs - clip.cropStartMs)
      );
    }
  }

  return await offlineContext.startRendering();
}

async function renderTracks(project, tracks, audioBuffers, gainAdjustments = {}, panAdjustments = {}, format = 'wav', trackStateById = null) {
  const renderedBuffer = await renderTracksToAudioBuffer(
    project,
    tracks,
    audioBuffers,
    gainAdjustments,
    panAdjustments,
    trackStateById
  );
  return audioBufferToBlob(renderedBuffer, format === 'mp3' ? 'mp3' : 'wav');
}

function audioBufferToBlob(audioBuffer, format = 'wav') {
  if (format === 'mp3') {
    return audioBufferToMp3(audioBuffer);
  }
  return audioBufferToWav(audioBuffer);
}

function floatTo16BitPCM(floatArray) {
  const pcm = new Int16Array(floatArray.length);
  for (let i = 0; i < floatArray.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, floatArray[i]));
    pcm[i] = sample < 0 ? sample * 32768 : sample * 32767;
  }
  return pcm;
}

function audioBufferToMp3(audioBuffer, bitrateKbps = 192) {
  const channelCount = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const encoder = new lamejs.Mp3Encoder(channelCount, sampleRate, bitrateKbps);
  const blockSize = 1152;
  const mp3Chunks = [];

  if (channelCount === 1) {
    const mono = floatTo16BitPCM(audioBuffer.getChannelData(0));
    for (let i = 0; i < mono.length; i += blockSize) {
      const mp3buf = encoder.encodeBuffer(mono.subarray(i, i + blockSize));
      if (mp3buf.length > 0) {
        mp3Chunks.push(new Uint8Array(mp3buf));
      }
    }
  } else {
    const left = floatTo16BitPCM(audioBuffer.getChannelData(0));
    const right = floatTo16BitPCM(audioBuffer.getChannelData(1));
    for (let i = 0; i < left.length; i += blockSize) {
      const mp3buf = encoder.encodeBuffer(
        left.subarray(i, i + blockSize),
        right.subarray(i, i + blockSize)
      );
      if (mp3buf.length > 0) {
        mp3Chunks.push(new Uint8Array(mp3buf));
      }
    }
  }

  const end = encoder.flush();
  if (end.length > 0) {
    mp3Chunks.push(new Uint8Array(end));
  }

  return new Blob(mp3Chunks, { type: 'audio/mpeg' });
}

function audioBufferToWav(audioBuffer) {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const dataSize = numberOfChannels * length * bytesPerSample;
  const bufferSize = 44 + dataSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);
  let offset = 0;

  writeString(view, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, bufferSize - 8, true); offset += 4;
  writeString(view, offset, 'WAVE'); offset += 4;
  writeString(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numberOfChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * numberOfChannels * bytesPerSample, true); offset += 4;
  view.setUint16(offset, numberOfChannels * bytesPerSample, true); offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true); offset += 2;
  writeString(view, offset, 'data'); offset += 4;
  view.setUint32(offset, dataSize, true); offset += 4;

  for (let i = 0; i < length; i += 1) {
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      let sample = audioBuffer.getChannelData(channel)[i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 32768 : sample * 32767;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
