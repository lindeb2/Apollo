const INVALID_WINDOWS_FILENAME_CHARS_REGEX = /[\\/:*?"<>|]/g;
const INVALID_WINDOWS_FILENAME_CHARS_TEST_REGEX = /[\\/:*?"<>|]/;
const MUSICAL_NUMBER_PATTERN = /^[0-9]+\..+$/;

/**
 * Remove leading/trailing spaces and dots.
 */
export function trimNameEdges(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/^[\s.]+|[\s.]+$/g, '');
}

export function normalizeProjectName(name) {
  return trimNameEdges(name);
}

export function normalizeMusicalNumber(value) {
  return String(value || '').trim();
}

export function isValidMusicalNumber(value) {
  const normalized = normalizeMusicalNumber(value);
  return MUSICAL_NUMBER_PATTERN.test(normalized);
}

export function normalizeTrackName(name) {
  const trimmed = trimNameEdges(name);
  return trimmed.replace(INVALID_WINDOWS_FILENAME_CHARS_REGEX, '');
}

export function normalizeExportName(name) {
  return trimNameEdges(name);
}

export function hasInvalidExportNameChars(name) {
  return INVALID_WINDOWS_FILENAME_CHARS_TEST_REGEX.test(name || '');
}
