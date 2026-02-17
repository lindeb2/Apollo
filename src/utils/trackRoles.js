export const TRACK_ROLE_INSTRUMENT = 'instrument';
export const TRACK_ROLE_LEAD = 'lead';
export const TRACK_ROLE_CHOIR = 'choir';
export const TRACK_ROLE_OTHER = 'other';

export const TRACK_CHOIR_PART_ROLES = [
  'choir-part-1',
  'choir-part-2',
  'choir-part-3',
  'choir-part-4',
  'choir-part-5',
];

export const GROUP_ROLE_NONE = 'group';
export const GROUP_ROLE_INSTRUMENTS = 'instruments';
export const GROUP_ROLE_LEADS = 'leads';
export const GROUP_ROLE_CHOIRS = 'choirs';
export const GROUP_ROLE_OTHERS = 'others';

export const TRACK_CATEGORY_ROLES = new Set([
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_CHOIR,
  TRACK_ROLE_OTHER,
]);

const GROUP_PARENT_ROLES = new Set([
  GROUP_ROLE_INSTRUMENTS,
  GROUP_ROLE_LEADS,
  GROUP_ROLE_CHOIRS,
  GROUP_ROLE_OTHERS,
]);

const GROUP_ALLOWED_ROLES = new Set([
  GROUP_ROLE_NONE,
  ...TRACK_CATEGORY_ROLES,
  ...TRACK_CHOIR_PART_ROLES,
  ...GROUP_PARENT_ROLES,
]);

export function isChoirPartRole(role) {
  return typeof role === 'string' && role.startsWith('choir-part-');
}

export function isChoirRole(role) {
  return role === TRACK_ROLE_CHOIR || isChoirPartRole(role);
}

export function isTrackRole(role) {
  return TRACK_CATEGORY_ROLES.has(role) || isChoirPartRole(role);
}

export function isGroupParentRole(role) {
  return GROUP_PARENT_ROLES.has(role);
}

export function isGroupRole(role) {
  return GROUP_ALLOWED_ROLES.has(role);
}

export function mapGroupParentRoleToTrackRole(role) {
  if (role === GROUP_ROLE_INSTRUMENTS) return TRACK_ROLE_INSTRUMENT;
  if (role === GROUP_ROLE_LEADS) return TRACK_ROLE_LEAD;
  if (role === GROUP_ROLE_CHOIRS) return TRACK_ROLE_CHOIR;
  if (role === GROUP_ROLE_OTHERS) return TRACK_ROLE_OTHER;
  return null;
}

export function normalizeTrackRole(role) {
  return isTrackRole(role) ? role : TRACK_ROLE_OTHER;
}

export function normalizeGroupRole(role) {
  return isGroupRole(role) ? role : GROUP_ROLE_NONE;
}

export function toCategoryRole(role) {
  const normalized = normalizeTrackRole(role);
  if (isChoirPartRole(normalized)) return TRACK_ROLE_CHOIR;
  return normalized;
}

export function groupRoleToTrackRole(role) {
  const normalized = normalizeGroupRole(role);
  if (normalized === GROUP_ROLE_NONE) return TRACK_ROLE_OTHER;
  if (isGroupParentRole(normalized)) return mapGroupParentRoleToTrackRole(normalized) || TRACK_ROLE_OTHER;
  return toCategoryRole(normalized);
}

export function getDefaultIconByRole(role) {
  const normalizedGroupRole = normalizeGroupRole(role);
  const normalizedTrackRole = toCategoryRole(role);

  if (isGroupParentRole(normalizedGroupRole)) {
    const mapped = mapGroupParentRoleToTrackRole(normalizedGroupRole);
    if (mapped === TRACK_ROLE_INSTRUMENT) return 'guitar';
    if (mapped === TRACK_ROLE_LEAD) return 'user';
    if (mapped === TRACK_ROLE_CHOIR) return 'users';
  }

  if (normalizedTrackRole === TRACK_ROLE_INSTRUMENT) return 'guitar';
  if (normalizedTrackRole === TRACK_ROLE_LEAD) return 'user';
  if (normalizedTrackRole === TRACK_ROLE_CHOIR) return 'users';
  return 'wave';
}

export function isTrackCategoryRole(role, categoryRole) {
  return toCategoryRole(role) === categoryRole;
}
