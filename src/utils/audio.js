/**
 * Audio utility functions
 * Handles volume/pan conversions per spec
 */

/**
 * Convert volume slider value (0-100) to decibels
 * Spec: dB = -60 + (slider / 100) * 60
 */
export function volumeToDb(sliderValue) {
  return -60 + (sliderValue / 100) * 60;
}

/**
 * Convert decibels to volume slider value (0-100)
 */
export function dbToVolume(db) {
  return ((db + 60) / 60) * 100;
}

/**
 * Convert decibels to linear gain
 * Spec: gain = 10^(dB / 20)
 */
export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

/**
 * Convert linear gain to decibels
 */
export function gainToDb(gain) {
  return 20 * Math.log10(gain);
}

/**
 * Convert volume slider value directly to linear gain
 */
export function volumeToGain(sliderValue) {
  const db = volumeToDb(sliderValue);
  return dbToGain(db);
}

/**
 * Convert pan slider value (-100 to +100) to normalized pan (-1 to +1)
 */
export function panToNormalized(sliderValue) {
  return sliderValue / 100;
}

/**
 * Convert normalized pan (-1 to +1) to slider value (-100 to +100)
 */
export function normalizedToPan(normalized) {
  return normalized * 100;
}

/**
 * Apply equal-power panning law
 * Returns [leftGain, rightGain] for a given pan position (-1 to +1)
 * 
 * Equal-power panning maintains constant power output:
 * - Pan -1 (full left): L=1, R=0
 * - Pan 0 (center): L=√2/2, R=√2/2
 * - Pan +1 (full right): L=0, R=1
 */
export function equalPowerPan(pan) {
  // Clamp pan to [-1, 1]
  const p = Math.max(-1, Math.min(1, pan));
  
  // Equal-power law using sine/cosine
  const angle = (p + 1) * Math.PI / 4; // Maps [-1,1] to [0, π/2]
  
  const leftGain = Math.cos(angle);
  const rightGain = Math.sin(angle);
  
  return [leftGain, rightGain];
}

/**
 * Sanitize filename for export
 * Spec: ASCII only, lowercase, spaces → '_'
 */
export function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Convert milliseconds to seconds
 */
export function msToSeconds(ms) {
  return ms / 1000;
}

/**
 * Convert seconds to milliseconds
 */
export function secondsToMs(seconds) {
  return seconds * 1000;
}

/**
 * Format time as MM:SS.mmm
 */
export function formatTime(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor(ms % 1000);
  
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

/**
 * Vertical drag to gain adjustment
 * Spec: 100 px = ±6.0 dB
 */
export function pixelsToDbChange(deltaY) {
  return -(deltaY / 100) * 6.0; // Negative because drag down = decrease
}

/**
 * Get choir panning matrix for N parts
 * Spec exact values
 */
export function getChoirPanMatrix(numParts) {
  const matrices = {
    1: [0],
    2: [30, -30],
    3: [0, 40, -40],
    4: [25, -65, 65, -25],
    5: [0, 70, -70, 35, -35],
  };
  
  return matrices[numParts] || [0];
}
