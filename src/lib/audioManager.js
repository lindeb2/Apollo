import {
  volumeToGain,
  msToSeconds,
  normalizePanLawDb,
  getPanLawCompensationGain,
  getPanLawHeadroomGain,
} from '../utils/audio';
import { SAMPLE_RATE } from '../types/project';
import { getEffectiveTrackMix } from '../utils/trackTree';

/**
 * Audio Manager
 * Handles Web Audio API playback, mixing, and rendering
 */
class AudioManager {
  constructor() {
    this.audioContext = null;
    this.masterGainNode = null;
    this.mediaCache = new Map(); // blobId -> AudioBuffer
    this.activeSources = new Map(); // trackId -> { source, gainNode, panNode }
    this.isPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.isInitializingPlayback = false; // Flag to prevent concurrent play() calls
    this.currentMasterVolume = 100;
    this.currentPanLawDb = normalizePanLawDb();
  }

  /**
   * Initialize Audio Context (must be called after user interaction)
   */
  async init() {
    if (this.audioContext) return;

    this.audioContext = new AudioContext({
      sampleRate: SAMPLE_RATE,
    });

    // Create master gain node
    this.masterGainNode = this.audioContext.createGain();
    this.masterGainNode.gain.value = this.getMasterOutputGain();
    this.masterGainNode.connect(this.audioContext.destination);
    
    console.log('AudioManager initialized', {
      sampleRate: this.audioContext.sampleRate,
      state: this.audioContext.state,
    });
  }

  /**
   * Ensure audio context is running (handle browser autoplay policies)
   */
  async resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Decode audio file to AudioBuffer
   */
  async decodeAudioFile(arrayBuffer) {
    if (!this.audioContext) {
      await this.init();
    }

    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    
    // Resample to 44.1kHz if needed
    if (audioBuffer.sampleRate !== SAMPLE_RATE) {
      console.log(`Resampling from ${audioBuffer.sampleRate}Hz to ${SAMPLE_RATE}Hz`);
      return await this.resampleAudioBuffer(audioBuffer);
    }

    return audioBuffer;
  }

  /**
   * Resample AudioBuffer to 44.1kHz
   */
  async resampleAudioBuffer(audioBuffer) {
    const duration = audioBuffer.duration;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const length = Math.ceil(duration * SAMPLE_RATE);

    const offlineContext = new OfflineAudioContext(
      numberOfChannels,
      length,
      SAMPLE_RATE
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(0);

    return await offlineContext.startRendering();
  }

  /**
   * Convert AudioBuffer to Blob (WAV format)
   */
  audioBufferToBlob(audioBuffer) {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    const bytesPerSample = 4; // 32-bit float

    // Calculate sizes
    const dataSize = numberOfChannels * length * bytesPerSample;
    const bufferSize = 44 + dataSize;

    // Create buffer
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // Write WAV header
    let offset = 0;

    // "RIFF" chunk descriptor
    this.writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, bufferSize - 8, true); offset += 4;
    this.writeString(view, offset, 'WAVE'); offset += 4;

    // "fmt " sub-chunk
    this.writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4; // fmt chunk size
    view.setUint16(offset, 3, true); offset += 2; // format = 3 (IEEE float)
    view.setUint16(offset, numberOfChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * numberOfChannels * bytesPerSample, true); offset += 4;
    view.setUint16(offset, numberOfChannels * bytesPerSample, true); offset += 2;
    view.setUint16(offset, bytesPerSample * 8, true); offset += 2;

    // "data" sub-chunk
    this.writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, dataSize, true); offset += 4;

    // Write audio data (interleaved)
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = audioBuffer.getChannelData(channel)[i];
        view.setFloat32(offset, sample, true);
        offset += 4;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  /**
   * Helper to write string to DataView
   */
  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * Load audio buffer from blob (with caching)
   */
  async loadAudioBuffer(blobId, blob) {
    // Check cache
    if (this.mediaCache.has(blobId)) {
      return this.mediaCache.get(blobId);
    }

    // Decode blob
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await this.decodeAudioFile(arrayBuffer);

    // Cache it
    this.mediaCache.set(blobId, audioBuffer);

    return audioBuffer;
  }

  /**
   * Play project from current time
   */
  async play(project, currentTimeMs) {
    // Prevent concurrent play() calls - if already initializing, stop first
    if (this.isInitializingPlayback) {
      console.log('Play called while already initializing - stopping first');
      this.stop();
      // Wait a bit for stop to complete
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.isInitializingPlayback = true;

    try {
      if (!this.audioContext) {
        await this.init();
      }

      await this.resume();

      this.isPlaying = true;
      this.startTime = this.audioContext.currentTime - msToSeconds(currentTimeMs);
      this.currentMasterVolume = Number.isFinite(Number(project?.masterVolume))
        ? Number(project.masterVolume)
        : this.currentMasterVolume;
      this.currentPanLawDb = normalizePanLawDb(project?.panLawDb);
      this.applyMasterGain();
      const mix = getEffectiveTrackMix(project);

      // Start all tracks
      for (const track of project.tracks) {
        await this.playTrack(track, currentTimeMs, mix.statesByTrackId.get(track.id));
      }
    } finally {
      this.isInitializingPlayback = false;
    }
  }

  /**
   * Play a single track
   */
  async playTrack(track, currentTimeMs, effectiveState) {
    // Skip if track has no clips
    if (!track.clips || track.clips.length === 0) return;
    if (!effectiveState?.audible) return;

    // Play all clips that should be audible at current time or in the future
    for (const clip of track.clips) {
      if (clip.muted) continue;
      const clipStartTimeMs = clip.timelineStartMs;
      const clipDurationMs = clip.cropEndMs - clip.cropStartMs;
      const clipEndTimeMs = clipStartTimeMs + clipDurationMs;

      // Skip clips that have already ended
      if (clipEndTimeMs < currentTimeMs) continue;

      // Load audio buffer from cache
      if (!this.mediaCache.has(clip.blobId)) {
        console.warn(`Audio buffer not loaded for clip ${clip.id}`);
        continue;
      }

      const audioBuffer = this.mediaCache.get(clip.blobId);

      // Create source
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Create gain node
      const gainNode = this.audioContext.createGain();
      const baseGain = Number.isFinite(effectiveState.effectiveGain)
        ? effectiveState.effectiveGain
        : volumeToGain(track.volume);
      const clipGain = Math.pow(10, clip.gainDb / 20);

      // Create pan node
      const panNode = this.audioContext.createStereoPanner();
      const effectivePan = Number.isFinite(effectiveState.effectivePan) ? effectiveState.effectivePan : track.pan;
      panNode.pan.value = effectivePan / 100;
      gainNode.gain.value = this.getClipOutputGain(baseGain, clipGain, effectivePan);

      // Connect: source -> gain -> pan -> master -> destination
      source.connect(gainNode);
      gainNode.connect(panNode);
      panNode.connect(this.masterGainNode);

      // Calculate playback timing
      const offset = msToSeconds(clip.cropStartMs);
      const duration = msToSeconds(clipDurationMs);

      if (clipStartTimeMs > currentTimeMs) {
        // Clip starts in the future
        const when = this.audioContext.currentTime + msToSeconds(clipStartTimeMs - currentTimeMs);
        source.start(when, offset, duration);
      } else {
        // Clip is currently playing
        const elapsedInClip = currentTimeMs - clipStartTimeMs;
        if (elapsedInClip < clipDurationMs) {
          const remainingDuration = msToSeconds(clipDurationMs - elapsedInClip);
          source.start(this.audioContext.currentTime, offset + msToSeconds(elapsedInClip), remainingDuration);
        }
      }

      // Store active source (use unique key for multiple clips)
      const sourceKey = `${track.id}-${clip.id}`;
      this.activeSources.set(sourceKey, {
        source,
        gainNode,
        panNode,
        baseGain,
        clipGain,
        effectivePan,
      });

      // Auto-cleanup when done
      source.onended = () => {
        // Only delete if this is still the current source for this key
        // (prevents old sources from deleting new ones with the same key)
        const current = this.activeSources.get(sourceKey);
        if (current && current.source === source) {
          this.activeSources.delete(sourceKey);
        }
      };
    }
  }

  /**
   * Stop playback
   */
  stop() {
    this.isPlaying = false;
    this.pauseTime = 0;
    this.isInitializingPlayback = false;

    // Stop all active sources
    for (const [trackId, nodes] of this.activeSources.entries()) {
      try {
        // Use stop(0) to immediately stop even sources scheduled for future
        nodes.source.stop(0);
      } catch (e) {
        // Ignore errors if already stopped
      }
    }

    this.activeSources.clear();
  }

  /**
   * Pause playback
   */
  async pause(currentTimeMs) {
    // Wait for any ongoing play() initialization to complete
    while (this.isInitializingPlayback) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.isPlaying = false;
    this.pauseTime = currentTimeMs;
    this.isInitializingPlayback = false;

    // Stop all active sources
    const sourcesToStop = Array.from(this.activeSources.entries());
    for (const [trackId, nodes] of sourcesToStop) {
      try {
        nodes.source.stop(0);
      } catch (e) {
        // Ignore errors (source might already be stopped)
      }
    }

    this.activeSources.clear();
  }

  /**
   * Set master volume
   */
  setMasterVolume(volume) {
    this.currentMasterVolume = Number.isFinite(Number(volume))
      ? Number(volume)
      : this.currentMasterVolume;
    this.applyMasterGain();
  }

  setPanLawDb(panLawDb) {
    this.currentPanLawDb = normalizePanLawDb(panLawDb);
    this.applyMasterGain();

    for (const nodes of this.activeSources.values()) {
      nodes.gainNode.gain.value = this.getClipOutputGain(
        nodes.baseGain,
        nodes.clipGain,
        nodes.effectivePan
      );
    }
  }

  /**
   * Update track volume in real-time
   */
  updateTrackVolume(trackId, volume) {
    const gain = volumeToGain(volume);
    for (const [sourceKey, nodes] of this.activeSources.entries()) {
      if (sourceKey === trackId || sourceKey.startsWith(`${trackId}-`)) {
        nodes.baseGain = gain;
        nodes.gainNode.gain.value = this.getClipOutputGain(
          nodes.baseGain,
          nodes.clipGain,
          nodes.effectivePan
        );
      }
    }
  }

  /**
   * Update track pan in real-time
   */
  updateTrackPan(trackId, pan) {
    for (const [sourceKey, nodes] of this.activeSources.entries()) {
      if (sourceKey === trackId || sourceKey.startsWith(`${trackId}-`)) {
        nodes.effectivePan = pan;
        nodes.panNode.pan.value = pan / 100;
        nodes.gainNode.gain.value = this.getClipOutputGain(
          nodes.baseGain,
          nodes.clipGain,
          nodes.effectivePan
        );
      }
    }
  }

  /**
   * Update effective track mix (inherited gain/pan) in real-time
   */
  updateTrackMix(trackId, effectiveGain, effectivePan) {
    for (const [sourceKey, nodes] of this.activeSources.entries()) {
      if (sourceKey === trackId || sourceKey.startsWith(`${trackId}-`)) {
        if (Number.isFinite(effectiveGain)) {
          nodes.baseGain = effectiveGain;
        }
        if (Number.isFinite(effectivePan)) {
          nodes.effectivePan = effectivePan;
          nodes.panNode.pan.value = effectivePan / 100;
        }
        nodes.gainNode.gain.value = this.getClipOutputGain(
          nodes.baseGain,
          nodes.clipGain,
          nodes.effectivePan
        );
      }
    }
  }

  /**
   * Get current playback time
   */
  getCurrentTime() {
    if (!this.isPlaying || !this.audioContext) return this.pauseTime;
    
    const elapsed = this.audioContext.currentTime - this.startTime;
    return elapsed * 1000; // Convert to ms
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.stop();
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.mediaCache.clear();
    this.activeSources.clear();
  }

  getMasterOutputGain() {
    return volumeToGain(this.currentMasterVolume) * getPanLawHeadroomGain(this.currentPanLawDb);
  }

  applyMasterGain() {
    if (!this.masterGainNode) return;
    this.masterGainNode.gain.value = this.getMasterOutputGain();
  }

  getClipOutputGain(baseGain, clipGain, pan) {
    const panCompensation = getPanLawCompensationGain(pan, this.currentPanLawDb);
    return baseGain * clipGain * panCompensation;
  }
}

// Singleton instance
export const audioManager = new AudioManager();
