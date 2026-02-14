import {
  volumeToGain,
  dbToGain,
  msToSeconds,
} from '../utils/audio';
import {
  SAMPLE_RATE,
  TRACK_ROLES,
  DEFAULT_EXPORT_SETTINGS,
  normalizeExportSettings,
} from '../types/project';
import { applyChoirAutoPanToProject, normalizeAutoPanSettings } from '../utils/choirAutoPan';

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
  { id: EXPORT_PRESETS.ACAPELLA, label: 'Acapella', description: 'Lead + choir' },
  { id: EXPORT_PRESETS.NO_LEAD, label: 'No Lead', description: 'Instrument + choir' },
  { id: EXPORT_PRESETS.NO_CHOIR, label: 'No Choir', description: 'Instrument + lead' },
  { id: EXPORT_PRESETS.INSTRUMENTAL, label: 'Instrumental', description: 'Instrument only' },
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

function isInstrumentTrack(track) {
  return track.role === TRACK_ROLES.INSTRUMENT;
}

function isLeadTrack(track) {
  return track.role === TRACK_ROLES.LEAD;
}

function isChoirTrack(track) {
  return typeof track.role === 'string' && track.role.startsWith('choir-part-');
}

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
  targetTrackId,
  basePanByTrackId,
  transformedPanRange,
}) {
  const trackIds = tracks.map((track) => track.id);
  const leftIds = trackIds.filter((trackId) => trackId !== targetTrackId);
  const leftMax = getLeftRemapMax(transformedPanRange);
  const transformedCenterOnLeft = remapPanValue(0, -100, 100, -100, leftMax);
  const targetPan = clampPan(-transformedCenterOnLeft);

  const panMap = {
    ...remapPansToSide(leftIds, basePanByTrackId, 'left', transformedPanRange),
  };
  if (trackIds.includes(targetTrackId)) {
    panMap[targetTrackId] = clampPan(targetPan);
  }
  return panMap;
}

function buildPracticeGainMap({ tracks, targetTrackId, gainDb, attenuationDb }) {
  const gainMap = {};
  for (const track of tracks) {
    if (track.id === targetTrackId) {
      gainMap[track.id] = dbToGain(gainDb);
    } else {
      gainMap[track.id] = dbToGain(-attenuationDb);
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
    tracks: choirTracks.map((track) => ({ ...track })),
  };

  const result = applyChoirAutoPanToProject(tempProject, { enabled: true });
  const panMap = {};
  for (const track of result.project.tracks) {
    panMap[track.id] = clampPan(track.pan);
  }
  return panMap;
}

function createFileName(projectBase, suffix = '') {
  return `${projectBase}${suffix}.wav`;
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
  exportBaseName = null
) {
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
  const activeTracks = allTracks.filter((track) => !track.muted);
  const instrumentTracks = activeTracks.filter(isInstrumentTrack);
  const leadTracks = activeTracks.filter(isLeadTrack);
  const choirTracks = activeTracks.filter(isChoirTrack);
  const projectBase = exportBaseName || project.projectName || 'project';
  const files = [];

  for (const presetId of presetIds) {
    if (presetId === EXPORT_PRESETS.TUTTI) {
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase),
        blob: await renderTracks(project, activeTracks, audioBuffers),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.ACAPELLA) {
      const tracks = activeTracks.filter((track) => isLeadTrack(track) || isChoirTrack(track));
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, '_Acapella'),
        blob: await renderTracks(project, tracks, audioBuffers),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.NO_LEAD) {
      const tracks = activeTracks.filter((track) => isInstrumentTrack(track) || isChoirTrack(track));
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, '_NoLead'),
        blob: await renderTracks(project, tracks, audioBuffers),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.NO_CHOIR) {
      const tracks = activeTracks.filter((track) => isInstrumentTrack(track) || isLeadTrack(track));
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, '_NoChoir'),
        blob: await renderTracks(project, tracks, audioBuffers),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.INSTRUMENTAL) {
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, '_Instrumental'),
        blob: await renderTracks(project, instrumentTracks, audioBuffers),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.LEAD_ONLY) {
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, '_Leads'),
        blob: await renderTracks(project, leadTracks, audioBuffers),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.CHOIR_ONLY) {
      files.push({
        presetId,
        branch: null,
        subgroup: null,
        subgroupCount: 0,
        filename: createFileName(projectBase, '_Choir'),
        blob: await renderTracks(project, choirTracks, audioBuffers),
      });
      continue;
    }

    if (presetId === EXPORT_PRESETS.INSTRUMENT_PARTS) {
      for (const targetTrack of instrumentTracks) {
        const basePanByTrackId = Object.fromEntries(activeTracks.map((track) => [track.id, clampPan(track.pan)]));
        const panAdjustments = buildPracticePanMap({
          tracks: activeTracks,
          targetTrackId: targetTrack.id,
          basePanByTrackId,
          transformedPanRange: exportSettings.transformedPanRange,
        });
        const gainAdjustments = buildPracticeGainMap({
          tracks: activeTracks,
          targetTrackId: targetTrack.id,
          gainDb: exportSettings.gainDb,
          attenuationDb: exportSettings.attenuationDb,
        });
        files.push({
          presetId,
          branch: 'normal',
          subgroup: 'Instruments',
          subgroupCount: instrumentTracks.length,
          filename: createFileName(projectBase, `_${targetTrack.name}`),
          blob: await renderTracks(project, activeTracks, audioBuffers, gainAdjustments, panAdjustments),
        });
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.LEAD_PARTS) {
      for (const targetTrack of leadTracks) {
        const basePanByTrackId = Object.fromEntries(activeTracks.map((track) => [track.id, clampPan(track.pan)]));
        const panAdjustments = buildPracticePanMap({
          tracks: activeTracks,
          targetTrackId: targetTrack.id,
          basePanByTrackId,
          transformedPanRange: exportSettings.transformedPanRange,
        });
        const gainAdjustments = buildPracticeGainMap({
          tracks: activeTracks,
          targetTrackId: targetTrack.id,
          gainDb: exportSettings.gainDb,
          attenuationDb: exportSettings.attenuationDb,
        });
        files.push({
          presetId,
          branch: 'normal',
          subgroup: 'Leads',
          subgroupCount: leadTracks.length,
          filename: createFileName(projectBase, `_${targetTrack.name}`),
          blob: await renderTracks(project, activeTracks, audioBuffers, gainAdjustments, panAdjustments),
        });
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.CHOIR_PARTS) {
      for (const targetTrack of choirTracks) {
        const otherChoirTracks = choirTracks.filter((track) => track.id !== targetTrack.id);
        const autoPannedChoirMap = getAutoPannedChoirPanMap(project, otherChoirTracks);
        const basePanByTrackId = Object.fromEntries(activeTracks.map((track) => [track.id, clampPan(track.pan)]));
        Object.assign(basePanByTrackId, autoPannedChoirMap);

        const panAdjustments = buildPracticePanMap({
          tracks: activeTracks,
          targetTrackId: targetTrack.id,
          basePanByTrackId,
          transformedPanRange: exportSettings.transformedPanRange,
        });
        const gainAdjustments = buildPracticeGainMap({
          tracks: activeTracks,
          targetTrackId: targetTrack.id,
          gainDb: exportSettings.gainDb,
          attenuationDb: exportSettings.attenuationDb,
        });
        files.push({
          presetId,
          branch: 'normal',
          subgroup: 'Choir',
          subgroupCount: choirTracks.length,
          filename: createFileName(projectBase, `_${targetTrack.name}`),
          blob: await renderTracks(project, activeTracks, audioBuffers, gainAdjustments, panAdjustments),
        });
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED) {
      for (const omittedTrack of instrumentTracks) {
        const tracks = activeTracks.filter((track) => track.id !== omittedTrack.id);
        files.push({
          presetId,
          branch: 'omitted',
          subgroup: 'Instruments',
          subgroupCount: instrumentTracks.length,
          filename: createFileName(projectBase, `_${omittedTrack.name}_Omitted`),
          blob: await renderTracks(project, tracks, audioBuffers),
        });
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.LEAD_PARTS_OMITTED) {
      for (const omittedTrack of leadTracks) {
        const tracks = activeTracks.filter((track) => track.id !== omittedTrack.id);
        files.push({
          presetId,
          branch: 'omitted',
          subgroup: 'Leads',
          subgroupCount: leadTracks.length,
          filename: createFileName(projectBase, `_${omittedTrack.name}_Omitted`),
          blob: await renderTracks(project, tracks, audioBuffers),
        });
      }
      continue;
    }

    if (presetId === EXPORT_PRESETS.CHOIR_PARTS_OMITTED) {
      for (const omittedTrack of choirTracks) {
        const tracks = activeTracks.filter((track) => track.id !== omittedTrack.id);
        const remainingChoirTracks = choirTracks.filter((track) => track.id !== omittedTrack.id);
        const autoPannedChoirMap = getAutoPannedChoirPanMap(project, remainingChoirTracks);
        files.push({
          presetId,
          branch: 'omitted',
          subgroup: 'Choir',
          subgroupCount: choirTracks.length,
          filename: createFileName(projectBase, `_${omittedTrack.name}_Omitted`),
          blob: await renderTracks(project, tracks, audioBuffers, {}, autoPannedChoirMap),
        });
      }
    }
  }

  const laidOutFiles = withExportLayout(files);
  if (laidOutFiles.length === 1) {
    const single = laidOutFiles[0];
    const filename = `${projectBase}.wav`;
    const segments = single.relativePath.split('/').filter(Boolean);
    if (segments.length) {
      segments[segments.length - 1] = filename;
    }
    return [{
      ...single,
      filename,
      relativePath: segments.length ? segments.join('/') : filename,
    }];
  }
  return laidOutFiles;
}

async function renderTracks(project, tracks, audioBuffers, gainAdjustments = {}, panAdjustments = {}) {
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

  const masterGain = offlineContext.createGain();
  masterGain.gain.value = volumeToGain(project.masterVolume);
  masterGain.connect(offlineContext.destination);

  for (const track of tracks) {
    if (track.muted) continue;

    const baseGain = volumeToGain(track.volume);
    const adjustmentGain = gainAdjustments[track.id] || 1.0;
    const totalGain = baseGain * adjustmentGain;
    const totalPan = clampPan(
      panAdjustments[track.id] !== undefined ? panAdjustments[track.id] : track.pan
    );

    for (const clip of track.clips) {
      if (clip.muted) continue;

      const audioBuffer = audioBuffers.get(clip.blobId);
      if (!audioBuffer) continue;

      const source = offlineContext.createBufferSource();
      source.buffer = audioBuffer;

      const gainNode = offlineContext.createGain();
      gainNode.gain.value = totalGain * dbToGain(clip.gainDb);

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

  const renderedBuffer = await offlineContext.startRendering();
  return audioBufferToWav(renderedBuffer);
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
