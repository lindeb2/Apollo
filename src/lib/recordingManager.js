import { msToSeconds } from '../utils/audio';

/**
 * Recording Manager
 * Handles browser microphone recording via MediaDevices API
 */
class RecordingManager {
  constructor() {
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.startTimeMs = 0;
    this.recordingTrackId = null;
  }

  /**
   * Request microphone permission and initialize
   */
  async init() {
    if (typeof navigator === 'undefined') {
      throw new Error('Microphone capture is only available in a browser context.');
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      const insecureReason =
        typeof window !== 'undefined' && window.isSecureContext === false
          ? ' This page is not in a secure context. Use https:// or localhost.'
          : '';
      throw new Error(
        `This browser cannot access the microphone because navigator.mediaDevices.getUserMedia is unavailable.${insecureReason}`
      );
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 44100,
        }
      });

      console.log('Recording: Microphone access granted');
      return true;
    } catch (error) {
      console.error('Recording: Failed to access microphone:', error);
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        throw new Error('Microphone access denied. Please grant permission to record.');
      }
      if (error?.name === 'NotFoundError') {
        throw new Error('No microphone was found on this device.');
      }
      if (error?.name === 'NotReadableError') {
        throw new Error('Microphone is already in use by another application.');
      }
      throw new Error(error?.message || 'Failed to access microphone.');
    }
  }

  /**
   * Start recording
   */
  async startRecording(trackId, currentTimeMs) {
    if (this.isRecording) {
      throw new Error('Already recording');
    }

    if (!this.mediaStream) {
      await this.init();
    }

    this.recordedChunks = [];
    this.startTimeMs = currentTimeMs;
    this.recordingTrackId = trackId;
    this.isRecording = true;

    // Pick a supported mime type when possible to avoid cross-browser failures.
    const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const supportedMime = mimeCandidates.find((mime) => {
      return typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mime);
    });

    this.mediaRecorder = supportedMime
      ? new MediaRecorder(this.mediaStream, { mimeType: supportedMime })
      : new MediaRecorder(this.mediaStream);

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };

    this.mediaRecorder.start(100); // Collect data every 100ms

    console.log(`Recording started on track ${trackId} at ${currentTimeMs}ms`);
  }

  /**
   * Stop recording and return audio data
   */
  async stopRecording() {
    if (!this.isRecording) {
      throw new Error('Not currently recording');
    }

    return new Promise((resolve, reject) => {
      this.mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
          const durationMs = Date.now() - this.startTimeMs;

          const result = {
            blob,
            startTimeMs: this.startTimeMs,
            durationMs,
            trackId: this.recordingTrackId,
          };

          this.isRecording = false;
          this.recordedChunks = [];
          this.recordingTrackId = null;

          console.log(`Recording stopped: ${durationMs}ms`);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Cancel recording without saving
   */
  cancelRecording() {
    if (this.isRecording && this.mediaRecorder) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.recordedChunks = [];
      this.recordingTrackId = null;
      console.log('Recording cancelled');
    }
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.cancelRecording();
    
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
  }
}

// Singleton instance
export const recordingManager = new RecordingManager();
