import { useRef, useEffect, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { msToSeconds } from '../utils/audio';

/**
 * Waveform component using wavesurfer.js
 * Displays waveform for a single clip
 * @param {number} globalPeakAmplitude - The maximum peak amplitude across the entire project (0-1)
 */
function Waveform({ 
  audioBuffer, 
  clipId, 
  cropStartMs, 
  cropEndMs, 
  sourceDurationMs,
  height = 80,
  color = '#4F8EF7',
  onReady,
  globalPeakAmplitude = 1.0, // Default to 1.0 if not provided
}) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [croppedBuffer, setCroppedBuffer] = useState(null);
  
  // Create a cropped and normalized version of the audio buffer for display
  useEffect(() => {
    if (!audioBuffer) return;
    
    const cropStartSec = msToSeconds(cropStartMs);
    const cropEndSec = msToSeconds(cropEndMs);
    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    
    // Calculate sample indices
    const startSample = Math.floor(cropStartSec * sampleRate);
    const endSample = Math.floor(cropEndSec * sampleRate);
    const numSamples = endSample - startSample;
    
    if (numSamples <= 0) {
      setCroppedBuffer(null);
      return;
    }
    
    // Create new AudioBuffer with only the cropped region
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const newCroppedBuffer = audioContext.createBuffer(
      numChannels,
      numSamples,
      sampleRate
    );
    
    // Copy the cropped audio data and apply global normalization
    // Scale based on the global peak so all waveforms use the same amplitude reference
    const scale = globalPeakAmplitude > 0 ? 1.0 / globalPeakAmplitude : 1.0;
    
    for (let channel = 0; channel < numChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const targetData = newCroppedBuffer.getChannelData(channel);
      
      for (let i = 0; i < numSamples; i++) {
        targetData[i] = sourceData[startSample + i] * scale;
      }
    }
    
    setCroppedBuffer(newCroppedBuffer);
  }, [audioBuffer, cropStartMs, cropEndMs, globalPeakAmplitude]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create WaveSurfer instance once per container/appearance.
    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: color,
      progressColor: '#2563EB',
      cursorColor: 'transparent',
      height: height,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: false,
      interact: false,
      hideScrollbar: true,
    });

    wavesurfer.on('ready', () => {
      setIsReady(true);
      onReady?.();
    });

    wavesurferRef.current = wavesurfer;

    return () => {
      wavesurfer.destroy();
      wavesurferRef.current = null;
    };
  }, [height, color, clipId]);

  useEffect(() => {
    if (!croppedBuffer || !wavesurferRef.current) return;
    setIsReady(false);
    wavesurferRef.current.loadBlob(audioBufferToBlob(croppedBuffer));
  }, [croppedBuffer, height, clipId]);

  return (
    <div 
      ref={containerRef} 
      className="w-full"
      style={{ height: `${height}px` }}
    />
  );
}

/**
 * Convert AudioBuffer to Blob for wavesurfer
 */
function audioBufferToBlob(audioBuffer) {
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

  // Write audio data (16-bit PCM)
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sample = audioBuffer.getChannelData(channel)[i];
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

export default Waveform;
