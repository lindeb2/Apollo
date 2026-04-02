/**
 * Audio utility functions
 * Handles volume/pan conversions per spec
 */

const MIN_VOLUME_DB = -60;
const MAX_VOLUME_DB = 6;
const MIN_VOLUME_GAIN = 0.001;
const VOLUME_GAIN_SCALE = 1.994;
const CLIP_GAIN_MIN_DB = -24;
const CLIP_GAIN_MAX_DB = 24;
export const PAN_LAW_OPTIONS_DB = [0, -3, -4.5, -6];
export const DEFAULT_PAN_LAW_DB = -3;

/**
 * Convert volume slider value (0-100) to decibels
 * dB = 20 * log10(0.001 + (1.994 * x^2))
 */
export function volumeToDb(sliderValue) {
  const position = Math.max(0, Math.min(1, sliderValue / 100));
  const gain = MIN_VOLUME_GAIN + (VOLUME_GAIN_SCALE * position * position);
  return gainToDb(gain);
}

/**
 * Convert decibels to volume slider value (0-100)
 */
export function dbToVolume(db) {
  if (!Number.isFinite(db)) return 0;
  const gain = dbToGain(db);
  const normalized = (gain - MIN_VOLUME_GAIN) / VOLUME_GAIN_SCALE;
  const position = Math.sqrt(Math.max(0, normalized));
  return Math.min(100, Math.max(0, position * 100));
}

/**
 * Convert clip gain dB (-24..+24) to normalized slider position (0..1)
 * Uses the same curve as volume sliders, remapped to clip gain range.
 */
export function clipGainDbToPosition(db) {
  const clamped = Math.max(CLIP_GAIN_MIN_DB, Math.min(CLIP_GAIN_MAX_DB, db));
  const normalized = (clamped - CLIP_GAIN_MIN_DB) / (CLIP_GAIN_MAX_DB - CLIP_GAIN_MIN_DB);
  const baseDb = MIN_VOLUME_DB + normalized * (MAX_VOLUME_DB - MIN_VOLUME_DB);
  return dbToVolume(baseDb) / 100;
}

/**
 * Convert normalized slider position (0..1) to clip gain dB (-24..+24)
 * Uses the same curve as volume sliders, remapped to clip gain range.
 */
export function positionToClipGainDb(position) {
  const clampedPos = Math.max(0, Math.min(1, position));
  const baseDb = volumeToDb(clampedPos * 100);
  const normalized = (baseDb - MIN_VOLUME_DB) / (MAX_VOLUME_DB - MIN_VOLUME_DB);
  const db = CLIP_GAIN_MIN_DB + normalized * (CLIP_GAIN_MAX_DB - CLIP_GAIN_MIN_DB);
  return Math.max(CLIP_GAIN_MIN_DB, Math.min(CLIP_GAIN_MAX_DB, db));
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
  const position = Math.max(0, Math.min(1, sliderValue / 100));
  return MIN_VOLUME_GAIN + (VOLUME_GAIN_SCALE * position * position);
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

export function normalizePanLawDb(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_PAN_LAW_DB;
  const allowed = PAN_LAW_OPTIONS_DB.find((option) => Math.abs(option - numeric) < 0.001);
  return allowed ?? DEFAULT_PAN_LAW_DB;
}

/**
 * Gain compensation applied before StereoPannerNode so selected pan law
 * is respected while still using WebAudio's panner curve.
 */
export function getPanLawCompensationGain(pan, panLawDb = DEFAULT_PAN_LAW_DB) {
  const normalizedPan = Math.max(-1, Math.min(1, (Number(pan) || 0) / 100));
  const normalizedLawDb = normalizePanLawDb(panLawDb);
  const centerGainTarget = dbToGain(normalizedLawDb);
  const stereoPannerCenterGain = Math.SQRT1_2;
  const centerCompensation = centerGainTarget / stereoPannerCenterGain;
  const towardCenter = 1 - Math.abs(normalizedPan);
  return 1 + ((centerCompensation - 1) * towardCenter);
}

/**
 * Global headroom to avoid clipping introduced by positive pan-law compensation.
 * (Only needed when compensation can exceed unity, e.g. 0 dB pan law.)
 */
export function getPanLawHeadroomGain(panLawDb = DEFAULT_PAN_LAW_DB) {
  const centerCompensation = getPanLawCompensationGain(0, panLawDb);
  return 1 / Math.max(1, centerCompensation);
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
  const dbChange = -(deltaY / 100) * 6.0; // Negative because drag down = decrease
  return Object.is(dbChange, -0) ? 0 : dbChange;
}
