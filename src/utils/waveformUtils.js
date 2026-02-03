/**
 * Calculate the maximum peak amplitude across all audio buffers in the project
 * This is used to normalize waveforms so they all use the same amplitude scale
 * @param {Map} mediaCache - Map of blobId -> AudioBuffer from audioManager
 * @param {Array} tracks - Array of tracks from project
 * @returns {number} Maximum peak amplitude (0-1), or 1.0 if no audio found
 */
export function calculateGlobalPeakAmplitude(mediaCache, tracks) {
  let globalPeak = 0;

  // Iterate through all tracks and their clips
  for (const track of tracks) {
    for (const clip of track.clips) {
      const audioBuffer = mediaCache.get(clip.blobId);
      
      if (!audioBuffer) continue;

      // Find the peak amplitude in this audio buffer
      const numChannels = audioBuffer.numberOfChannels;
      const length = audioBuffer.length;

      for (let channel = 0; channel < numChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        
        for (let i = 0; i < length; i++) {
          const absSample = Math.abs(channelData[i]);
          if (absSample > globalPeak) {
            globalPeak = absSample;
          }
        }
      }
    }
  }

  // Return 1.0 if no audio found (prevents division by zero)
  return globalPeak > 0 ? globalPeak : 1.0;
}
