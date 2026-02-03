import { 
  volumeToGain, 
  dbToGain, 
  equalPowerPan, 
  msToSeconds, 
  sanitizeFilename,
  getChoirPanMatrix 
} from '../utils/audio';
import { SAMPLE_RATE, TRACK_ROLES } from '../types/project';
import { getMediaBlob } from './db';

/**
 * Export Engine
 * Renders project to WAV files using OfflineAudioContext
 * Implements all 7 export presets with exact specifications
 */

/**
 * Export preset configurations
 */
const EXPORT_PRESETS = {
  INSTRUMENTAL: 'instrumental',
  ALL: 'all',
  LEAD: 'lead',
  LEADS_SEPARATE: 'leads_separate',
  ONLY_WHOLE_CHOIR: 'only_whole_choir',
  SEPARATE_CHOIR_PARTS: 'separate_choir_parts',
  SEPARATE_CHOIR_PARTS_OMITTED: 'separate_choir_parts_omitted',
};

/**
 * Main export function
 * Returns array of { filename, blob } objects
 */
export async function exportProject(project, preset, audioBuffers) {
  console.log(`Starting export: ${preset}`);

  switch (preset) {
    case EXPORT_PRESETS.INSTRUMENTAL:
      return [await exportInstrumental(project, audioBuffers)];
    
    case EXPORT_PRESETS.ALL:
      return [await exportAll(project, audioBuffers)];
    
    case EXPORT_PRESETS.LEAD:
      return [await exportLead(project, audioBuffers)];
    
    case EXPORT_PRESETS.LEADS_SEPARATE:
      return await exportLeadsSeparate(project, audioBuffers);
    
    case EXPORT_PRESETS.ONLY_WHOLE_CHOIR:
      return [await exportOnlyWholeChoir(project, audioBuffers)];
    
    case EXPORT_PRESETS.SEPARATE_CHOIR_PARTS:
      return await exportSeparateChoirParts(project, audioBuffers);
    
    case EXPORT_PRESETS.SEPARATE_CHOIR_PARTS_OMITTED:
      return await exportSeparateChoirPartsOmitted(project, audioBuffers);
    
    default:
      throw new Error(`Unknown export preset: ${preset}`);
  }
}

/**
 * Preset 1: Instrumental
 * Instrument tracks only
 */
async function exportInstrumental(project, audioBuffers) {
  const tracks = project.tracks.filter(t => t.role === TRACK_ROLES.INSTRUMENT);
  
  const filename = sanitizeFilename(`${project.projectName}_instrumental`) + '.wav';
  const blob = await renderTracks(project, tracks, audioBuffers, {});
  
  return { filename, blob };
}

/**
 * Preset 2: All
 * All tracks; leads +3 dB
 */
async function exportAll(project, audioBuffers) {
  const gainAdjustments = {};
  
  for (const track of project.tracks) {
    if (track.role === TRACK_ROLES.LEAD) {
      gainAdjustments[track.id] = dbToGain(3); // +3 dB
    }
  }
  
  const filename = sanitizeFilename(`${project.projectName}_all`) + '.wav';
  const blob = await renderTracks(project, project.tracks, audioBuffers, gainAdjustments);
  
  return { filename, blob };
}

/**
 * Preset 3: Lead
 * Lead + instrumental
 */
async function exportLead(project, audioBuffers) {
  const tracks = project.tracks.filter(t => 
    t.role === TRACK_ROLES.LEAD || t.role === TRACK_ROLES.INSTRUMENT
  );
  
  const filename = sanitizeFilename(`${project.projectName}_lead`) + '.wav';
  const blob = await renderTracks(project, tracks, audioBuffers, {});
  
  return { filename, blob };
}

/**
 * Preset 4: Leads Separate
 * One WAV per lead; target +6 dB, others -3 dB, instrumental included
 */
async function exportLeadsSeparate(project, audioBuffers) {
  const leadTracks = project.tracks.filter(t => t.role === TRACK_ROLES.LEAD);
  const instrumentTracks = project.tracks.filter(t => t.role === TRACK_ROLES.INSTRUMENT);
  const choirTracks = project.tracks.filter(t => 
    t.role.startsWith('choir-part-')
  );
  
  const results = [];
  
  for (const targetLead of leadTracks) {
    const gainAdjustments = {};
    const panAdjustments = {};
    
    // Target lead: +6 dB
    gainAdjustments[targetLead.id] = dbToGain(6);
    
    // Other leads: -3 dB
    for (const lead of leadTracks) {
      if (lead.id !== targetLead.id) {
        gainAdjustments[lead.id] = dbToGain(-3);
      }
    }
    
    // Choir: -3 dB
    for (const choir of choirTracks) {
      gainAdjustments[choir.id] = dbToGain(-3);
    }
    
    // Include all tracks
    const tracks = [...leadTracks, ...choirTracks, ...instrumentTracks];
    
    const filename = sanitizeFilename(`${project.projectName}_lead_${targetLead.name}`) + '.wav';
    const blob = await renderTracks(project, tracks, audioBuffers, gainAdjustments, panAdjustments);
    
    results.push({ filename, blob });
  }
  
  return results;
}

/**
 * Preset 5: Only Whole Choir
 * Choir tracks only
 */
async function exportOnlyWholeChoir(project, audioBuffers) {
  const tracks = project.tracks.filter(t => t.role.startsWith('choir-part-'));
  
  const filename = sanitizeFilename(`${project.projectName}_choir`) + '.wav';
  const blob = await renderTracks(project, tracks, audioBuffers, {});
  
  return { filename, blob };
}

/**
 * Preset 6: Separate Choir Parts (practice)
 * Target +6 dB / +30 pan, Others -6 dB / -30 pan, Instruments -3 dB
 */
async function exportSeparateChoirParts(project, audioBuffers) {
  const choirTracks = project.tracks.filter(t => t.role.startsWith('choir-part-'));
  const instrumentTracks = project.tracks.filter(t => t.role === TRACK_ROLES.INSTRUMENT);
  
  // Determine choir panning matrix
  const numChoirs = choirTracks.length;
  const panMatrix = getChoirPanMatrix(numChoirs);
  
  const results = [];
  
  for (let i = 0; i < choirTracks.length; i++) {
    const targetChoir = choirTracks[i];
    const gainAdjustments = {};
    const panAdjustments = {};
    
    // Target choir: +6 dB, +30 pan
    gainAdjustments[targetChoir.id] = dbToGain(6);
    panAdjustments[targetChoir.id] = 30;
    
    // Other choirs: -6 dB, -30 pan
    for (let j = 0; j < choirTracks.length; j++) {
      if (i !== j) {
        const choir = choirTracks[j];
        gainAdjustments[choir.id] = dbToGain(-6);
        panAdjustments[choir.id] = -30;
      }
    }
    
    // Instruments: -3 dB
    for (const instr of instrumentTracks) {
      gainAdjustments[instr.id] = dbToGain(-3);
    }
    
    const tracks = [...choirTracks, ...instrumentTracks];
    
    const filename = sanitizeFilename(`${project.projectName}_choir_${targetChoir.name}`) + '.wav';
    const blob = await renderTracks(project, tracks, audioBuffers, gainAdjustments, panAdjustments);
    
    results.push({ filename, blob });
  }
  
  return results;
}

/**
 * Preset 7: Separate Choir Parts Omitted
 * Target muted, others normal
 */
async function exportSeparateChoirPartsOmitted(project, audioBuffers) {
  const choirTracks = project.tracks.filter(t => t.role.startsWith('choir-part-'));
  const instrumentTracks = project.tracks.filter(t => t.role === TRACK_ROLES.INSTRUMENT);
  
  const results = [];
  
  for (const omittedChoir of choirTracks) {
    // Filter out the omitted choir
    const includedChoirs = choirTracks.filter(c => c.id !== omittedChoir.id);
    const tracks = [...includedChoirs, ...instrumentTracks];
    
    const filename = sanitizeFilename(`${project.projectName}_choir_omit_${omittedChoir.name}`) + '.wav';
    const blob = await renderTracks(project, tracks, audioBuffers, {}, {});
    
    results.push({ filename, blob });
  }
  
  return results;
}

/**
 * Core rendering function
 * Renders tracks to WAV using OfflineAudioContext
 */
async function renderTracks(project, tracks, audioBuffers, gainAdjustments = {}, panAdjustments = {}) {
  // Calculate total duration
  let maxDurationMs = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.timelineStartMs + (clip.cropEndMs - clip.cropStartMs);
      maxDurationMs = Math.max(maxDurationMs, clipEnd);
    }
  }
  
  const durationSeconds = Math.ceil(msToSeconds(maxDurationMs)) + 1; // Add 1 second buffer
  const length = durationSeconds * SAMPLE_RATE;
  
  // Create offline context
  const offlineContext = new OfflineAudioContext(2, length, SAMPLE_RATE);
  
  // Master gain (from project)
  const masterGain = offlineContext.createGain();
  masterGain.gain.value = volumeToGain(project.masterVolume);
  masterGain.connect(offlineContext.destination);
  
  // Render each track
  for (const track of tracks) {
    // Skip muted tracks
    if (track.muted) continue;
    
    // Calculate track gain
    const baseGain = volumeToGain(track.volume);
    const adjustmentGain = gainAdjustments[track.id] || 1.0;
    const totalGain = baseGain * adjustmentGain;
    
    // Calculate track pan
    const basePan = track.pan;
    const adjustmentPan = panAdjustments[track.id] || 0;
    const totalPan = Math.max(-100, Math.min(100, basePan + adjustmentPan));
    
    // Render each clip
    for (const clip of track.clips) {
      if (clip.muted) continue;
      
      const audioBuffer = audioBuffers.get(clip.blobId);
      if (!audioBuffer) {
        console.warn(`Audio buffer not found for clip ${clip.id}`);
        continue;
      }
      
      // Create source
      const source = offlineContext.createBufferSource();
      source.buffer = audioBuffer;
      
      // Create gain node
      const gainNode = offlineContext.createGain();
      const clipGain = dbToGain(clip.gainDb);
      gainNode.gain.value = totalGain * clipGain;
      
      // Create pan node
      const panNode = offlineContext.createStereoPanner();
      panNode.pan.value = totalPan / 100;
      
      // Connect
      source.connect(gainNode);
      gainNode.connect(panNode);
      panNode.connect(masterGain);
      
      // Schedule
      const startTime = msToSeconds(clip.timelineStartMs);
      const offset = msToSeconds(clip.cropStartMs);
      const duration = msToSeconds(clip.cropEndMs - clip.cropStartMs);
      
      source.start(startTime, offset, duration);
    }
  }
  
  // Render
  console.log(`Rendering ${durationSeconds}s at ${SAMPLE_RATE}Hz...`);
  const renderedBuffer = await offlineContext.startRendering();
  console.log('Rendering complete');
  
  // Convert to WAV blob
  const wavBlob = audioBufferToWav(renderedBuffer);
  
  return wavBlob;
}

/**
 * Convert AudioBuffer to 16-bit PCM WAV Blob
 * No limiter, no normalization, no dithering (per spec)
 */
function audioBufferToWav(audioBuffer) {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2; // 16-bit
  
  const dataSize = numberOfChannels * length * bytesPerSample;
  const bufferSize = 44 + dataSize;
  
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);
  
  let offset = 0;
  
  // RIFF chunk
  writeString(view, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, bufferSize - 8, true); offset += 4;
  writeString(view, offset, 'WAVE'); offset += 4;
  
  // fmt chunk
  writeString(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2; // PCM
  view.setUint16(offset, numberOfChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * numberOfChannels * bytesPerSample, true); offset += 4;
  view.setUint16(offset, numberOfChannels * bytesPerSample, true); offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true); offset += 2;
  
  // data chunk
  writeString(view, offset, 'data'); offset += 4;
  view.setUint32(offset, dataSize, true); offset += 4;
  
  // Write audio data (16-bit PCM, interleaved)
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      let sample = audioBuffer.getChannelData(channel)[i];
      
      // Clamp to [-1, 1]
      sample = Math.max(-1, Math.min(1, sample));
      
      // Convert to 16-bit integer
      const intSample = sample < 0 ? sample * 32768 : sample * 32767;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }
  
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Trigger browser download
 */
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

export { EXPORT_PRESETS };
