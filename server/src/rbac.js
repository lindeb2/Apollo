import { randomUUID } from 'crypto';
import { pool } from './db.js';
import { matchesOidcBootstrapRule } from './oidcBootstrap.js';

export const ACCESS_LEVEL_READ = 'read';
export const ACCESS_LEVEL_WRITE = 'write';
export const ACCESS_LEVELS = [ACCESS_LEVEL_READ, ACCESS_LEVEL_WRITE];

export const PROJECT_TARGET_ALL_PROJECTS = 'all_projects';
export const PROJECT_TARGET_PROJECT = 'project';
export const PROJECT_TARGET_GROUP_NAME = 'group_name';
export const PROJECT_TARGET_PART_NAME = 'part_name';
export const PROJECT_TARGET_TYPES = [
  PROJECT_TARGET_ALL_PROJECTS,
  PROJECT_TARGET_PROJECT,
  PROJECT_TARGET_GROUP_NAME,
  PROJECT_TARGET_PART_NAME,
];

export const SHOW_TARGET_ALL_SHOWS = 'all_shows';
export const SHOW_TARGET_SHOW = 'show';
export const SHOW_TARGET_TYPES = [
  SHOW_TARGET_ALL_SHOWS,
  SHOW_TARGET_SHOW,
];

export const TRACK_SCOPE_GROUP_NAME = 'group_name';
export const TRACK_SCOPE_PART_NAME = 'part_name';
export const TRACK_SCOPE_TYPES = [
  TRACK_SCOPE_GROUP_NAME,
  TRACK_SCOPE_PART_NAME,
];

export const SCOPE_TYPE_ALL_PROJECTS = PROJECT_TARGET_ALL_PROJECTS;
export const SCOPE_TYPE_PROJECT = PROJECT_TARGET_PROJECT;
export const SCOPE_TYPE_GROUP_NAME = PROJECT_TARGET_GROUP_NAME;
export const SCOPE_TYPE_PART_NAME = PROJECT_TARGET_PART_NAME;
export const SCOPE_TYPES = PROJECT_TARGET_TYPES;

export const CAPABILITY_PLAYER_TUTTI = 'player_tutti';
export const CAPABILITY_PROJECT_READ = 'project_read';
export const CAPABILITY_TRACK_WRITE_OWN = 'track_write_own';
export const CAPABILITY_TRACK_WRITE_SCOPE = 'track_write_scope';
export const CAPABILITY_MANAGE_OWN_PROJECTS = 'manage_own_projects';
export const CAPABILITY_PROJECT_MANAGER = 'project_manager';
export const CAPABILITIES = [
  CAPABILITY_PLAYER_TUTTI,
  CAPABILITY_PROJECT_READ,
  CAPABILITY_TRACK_WRITE_OWN,
  CAPABILITY_TRACK_WRITE_SCOPE,
  CAPABILITY_MANAGE_OWN_PROJECTS,
  CAPABILITY_PROJECT_MANAGER,
];

export const SYSTEM_ROLE_ADMIN_ID = 'system-role-admin';
export const SYSTEM_ROLE_ADMIN_KEY = 'admin';
export const SYSTEM_ROLE_DEFAULT_USER_ID = 'system-role-default-user';
export const SYSTEM_ROLE_DEFAULT_USER_KEY = 'default_user';
export const DEFAULT_EMPTY_ACCESS_MESSAGE = 'You do not currently have any permissions. Please contact an admin if you should.';

const TRACK_ROLE_INSTRUMENT = 'instrument';
const TRACK_ROLE_LEAD = 'lead';
const TRACK_ROLE_CHOIR = 'choir';
const TRACK_ROLE_METRONOME = 'metronome';
const TRACK_ROLE_OTHER = 'other';
const GROUP_ROLE_NONE = 'group';
const GROUP_ROLE_INSTRUMENTS = 'instruments';
const GROUP_ROLE_LEADS = 'leads';
const GROUP_ROLE_CHOIRS = 'choirs';
const GROUP_ROLE_OTHERS = 'others';

const COUNTABLE_TRACK_ROLES = new Set([
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_CHOIR,
]);

const GROUP_PARENT_ROLES = new Set([
  GROUP_ROLE_INSTRUMENTS,
  GROUP_ROLE_LEADS,
  GROUP_ROLE_CHOIRS,
  GROUP_ROLE_OTHERS,
]);

const GROUP_ALLOWED_ROLES = new Set([
  GROUP_ROLE_NONE,
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_CHOIR,
  TRACK_ROLE_OTHER,
  ...Array.from({ length: 5 }, (_unused, idx) => `choir-part-${idx + 1}`),
  ...GROUP_PARENT_ROLES,
]);

const CAPABILITY_DEFINITIONS = [
  {
    value: CAPABILITY_PLAYER_TUTTI,
    label: 'Player tutti',
    projectTargetMode: 'scoped',
    requiresTrackScope: false,
    sortOrder: 0,
  },
  {
    value: CAPABILITY_PROJECT_READ,
    label: 'Project read',
    projectTargetMode: 'scoped',
    requiresTrackScope: false,
    sortOrder: 1,
  },
  {
    value: CAPABILITY_TRACK_WRITE_OWN,
    label: 'Write own tracks',
    projectTargetMode: 'scoped',
    requiresTrackScope: false,
    sortOrder: 2,
  },
  {
    value: CAPABILITY_TRACK_WRITE_SCOPE,
    label: 'Write scoped tracks',
    projectTargetMode: 'scoped',
    requiresTrackScope: true,
    sortOrder: 3,
  },
  {
    value: CAPABILITY_MANAGE_OWN_PROJECTS,
    label: 'Manage own projects',
    projectTargetMode: 'global_only',
    requiresTrackScope: false,
    sortOrder: 4,
  },
  {
    value: CAPABILITY_PROJECT_MANAGER,
    label: 'Project manager',
    projectTargetMode: 'scoped',
    requiresTrackScope: false,
    sortOrder: 5,
  },
];

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function toNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function sortByOrder(left, right) {
  return toNumber(left?.order, 0) - toNumber(right?.order, 0);
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function uniqueTextValues(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value))));
}

function isChoirPartRole(role) {
  return typeof role === 'string' && role.startsWith('choir-part-');
}

function isMetronomeRole(role) {
  return role === TRACK_ROLE_METRONOME;
}

function normalizeTrackRole(role) {
  if (
    role === TRACK_ROLE_INSTRUMENT
    || role === TRACK_ROLE_LEAD
    || role === TRACK_ROLE_CHOIR
    || role === TRACK_ROLE_METRONOME
    || role === TRACK_ROLE_OTHER
    || isChoirPartRole(role)
  ) {
    return role;
  }
  return TRACK_ROLE_OTHER;
}

function normalizeGroupRole(role) {
  return GROUP_ALLOWED_ROLES.has(role) ? role : GROUP_ROLE_NONE;
}

function toCategoryRole(role) {
  const normalized = normalizeTrackRole(role);
  return isChoirPartRole(normalized) ? TRACK_ROLE_CHOIR : normalized;
}

function isGroupParentRole(role) {
  return GROUP_PARENT_ROLES.has(role);
}

function mapGroupParentRoleToTrackRole(role) {
  if (role === GROUP_ROLE_INSTRUMENTS) return TRACK_ROLE_INSTRUMENT;
  if (role === GROUP_ROLE_LEADS) return TRACK_ROLE_LEAD;
  if (role === GROUP_ROLE_CHOIRS) return TRACK_ROLE_CHOIR;
  if (role === GROUP_ROLE_OTHERS) return TRACK_ROLE_OTHER;
  return null;
}

function buildNormalizedTrackTree(snapshot = {}) {
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  const rawNodes = Array.isArray(snapshot?.trackTree) ? snapshot.trackTree : [];
  const validTrackIds = new Set(tracks.map((track) => track.id));
  const seenTrackIds = new Set();
  const nodes = [];

  for (const rawNode of rawNodes) {
    if (!rawNode || typeof rawNode !== 'object') continue;
    const kind = rawNode.kind === 'group' || rawNode.type === 'group'
      ? 'group'
      : ((rawNode.kind === 'track' || rawNode.type === 'track') ? 'track' : null);
    if (!kind) continue;

    if (kind === 'track') {
      const trackId = rawNode.trackId ?? rawNode.track_id;
      if (!validTrackIds.has(trackId) || seenTrackIds.has(trackId)) {
        continue;
      }
      seenTrackIds.add(trackId);
      nodes.push({
        id: String(rawNode.id ?? `track-node:${trackId}`),
        kind: 'track',
        parentId: typeof rawNode.parentId === 'string' ? rawNode.parentId : null,
        order: toNumber(rawNode.order, 0),
        trackId,
      });
      continue;
    }

    nodes.push({
      id: String(rawNode.id ?? `group-node:${nodes.length}`),
      kind: 'group',
      parentId: typeof rawNode.parentId === 'string' ? rawNode.parentId : null,
      order: toNumber(rawNode.order, 0),
      name: normalizeText(rawNode.name) || 'Group',
      role: normalizeGroupRole(rawNode.role),
      collapsed: Boolean(rawNode.collapsed),
      muted: Boolean(rawNode.muted),
      soloed: Boolean(rawNode.soloed),
      volume: Math.max(0, Math.min(100, toNumber(rawNode.volume, 100))),
      pan: Math.max(-100, Math.min(100, toNumber(rawNode.pan, 0))),
    });
  }

  const rootNodes = nodes.filter((node) => !node.parentId);
  const nextRootOrder = rootNodes.reduce((max, node) => Math.max(max, toNumber(node.order, 0)), -1) + 1;

  tracks
    .filter((track) => !seenTrackIds.has(track.id))
    .forEach((track, idx) => {
      nodes.push({
        id: `track-node:${track.id}`,
        kind: 'track',
        parentId: null,
        order: nextRootOrder + idx,
        trackId: track.id,
      });
    });

  return nodes;
}

export function normalizeScopeValue(value) {
  const normalized = normalizeLowerText(value);
  return normalized || null;
}

export function normalizeAccessLevel(value) {
  const normalized = normalizeLowerText(value);
  if (normalized === ACCESS_LEVEL_READ || normalized === ACCESS_LEVEL_WRITE) {
    return normalized;
  }
  throw new Error('Invalid access level');
}

export function normalizeScopeType(value) {
  const normalized = normalizeLowerText(value);
  if (SCOPE_TYPES.includes(normalized)) {
    return normalized;
  }
  throw new Error('Invalid scope type');
}

export function accessLevelToFlags(accessLevel) {
  const normalized = normalizeAccessLevel(accessLevel);
  return {
    canRead: normalized === ACCESS_LEVEL_READ || normalized === ACCESS_LEVEL_WRITE,
    canWrite: normalized === ACCESS_LEVEL_WRITE,
  };
}

export function getHigherAccessLevel(currentLevel, nextLevel) {
  if (normalizeAccessLevel(currentLevel) === ACCESS_LEVEL_WRITE || normalizeAccessLevel(nextLevel) === ACCESS_LEVEL_WRITE) {
    return ACCESS_LEVEL_WRITE;
  }
  return ACCESS_LEVEL_READ;
}

function capabilityToLegacyAccessLevel(capability) {
  const normalized = normalizeCapability(capability);
  if (normalized === CAPABILITY_PROJECT_MANAGER) return ACCESS_LEVEL_WRITE;
  return ACCESS_LEVEL_READ;
}

function capabilityDefinition(capability) {
  return CAPABILITY_DEFINITIONS.find((entry) => entry.value === capability) || null;
}

export function normalizeCapability(value) {
  const normalized = normalizeLowerText(value);
  if (CAPABILITIES.includes(normalized)) {
    return normalized;
  }
  throw new Error('Invalid capability');
}

export function normalizeProjectTargetType(value) {
  return normalizeScopeType(value);
}

export function normalizeShowTargetType(value) {
  const normalized = normalizeLowerText(value || SHOW_TARGET_ALL_SHOWS);
  if (SHOW_TARGET_TYPES.includes(normalized)) {
    return normalized;
  }
  throw new Error('Invalid show target type');
}

export function normalizeTrackScopeType(value) {
  const normalized = normalizeLowerText(value);
  if (TRACK_SCOPE_TYPES.includes(normalized)) {
    return normalized;
  }
  throw new Error('Invalid track scope type');
}

function addTag(tagsByKey, tagType, displayName) {
  const trimmedLabel = normalizeText(displayName);
  const normalizedValue = normalizeScopeValue(trimmedLabel);
  if (!trimmedLabel || !normalizedValue) return;
  const key = `${tagType}:${normalizedValue}`;
  if (tagsByKey.has(key)) return;
  tagsByKey.set(key, {
    tagType,
    tagValue: normalizedValue,
    displayName: trimmedLabel,
  });
}

function buildChildrenMap(nodes = []) {
  const map = new Map();
  for (const node of nodes) {
    const key = node.parentId || '__root__';
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(node);
  }
  for (const siblings of map.values()) {
    siblings.sort(sortByOrder);
  }
  return map;
}

function collectTrackBindingInfo(snapshot = {}) {
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const nodes = buildNormalizedTrackTree(snapshot);
  const childrenByParent = buildChildrenMap(nodes);
  const infoByTrackId = new Map();

  const walk = (parentId, inherited) => {
    const key = parentId || '__root__';
    const children = childrenByParent.get(key) || [];

    for (const node of children) {
      const nodeParentRole = inherited.parentRole;
      const isImmediateChildOfParentRole = Boolean(nodeParentRole && inherited.parentGroupId === parentId);

      if (node.kind === 'group') {
        const normalizedGroupValue = normalizeScopeValue(node.name);
        const nextAncestorGroupValues = normalizedGroupValue
          ? [...inherited.ancestorGroupValues, normalizedGroupValue]
          : [...inherited.ancestorGroupValues];
        const next = {
          ancestorGroupValues: nextAncestorGroupValues,
          parentRole: inherited.parentRole,
          parentGroupId: inherited.parentGroupId,
          parentUnitName: inherited.parentUnitName,
          forcedRole: inherited.forcedRole,
          forcedUnitName: inherited.forcedUnitName,
          choirRole: inherited.choirRole,
          choirUnitName: inherited.choirUnitName,
        };

        if (isImmediateChildOfParentRole) {
          next.parentUnitName = node.name;
          if (nodeParentRole === TRACK_ROLE_CHOIR) {
            next.choirRole = next.choirRole || TRACK_ROLE_CHOIR;
            next.choirUnitName = next.parentUnitName;
          }
        }

        const groupRole = normalizeGroupRole(node.role);
        if (isGroupParentRole(groupRole)) {
          const mappedRole = mapGroupParentRoleToTrackRole(groupRole);
          next.parentRole = mappedRole;
          next.parentGroupId = node.id;
          next.parentUnitName = null;
          next.forcedRole = null;
          next.forcedUnitName = null;
          if (mappedRole === TRACK_ROLE_CHOIR) {
            next.choirRole = TRACK_ROLE_CHOIR;
            next.choirUnitName = null;
          } else {
            next.choirRole = null;
            next.choirUnitName = null;
          }
        } else if (groupRole !== GROUP_ROLE_NONE && !nodeParentRole) {
          const categoryRole = toCategoryRole(groupRole);
          next.forcedRole = categoryRole;
          next.forcedUnitName = node.name;
          if (categoryRole === TRACK_ROLE_CHOIR) {
            next.choirRole = isChoirPartRole(groupRole) ? groupRole : TRACK_ROLE_CHOIR;
            next.choirUnitName = next.forcedUnitName;
          } else {
            next.choirRole = null;
            next.choirUnitName = null;
          }
        }

        walk(node.id, next);
        continue;
      }

      const track = trackById.get(node.trackId);
      if (!track) continue;

      const ownRole = toCategoryRole(track.role);
      const inheritedRole = inherited.parentRole || inherited.forcedRole || null;
      const effectiveRole = isMetronomeRole(track.role)
        ? TRACK_ROLE_METRONOME
        : (inheritedRole || ownRole);
      const isImmediateTrackChildOfParentRole = Boolean(inherited.parentRole && inherited.parentGroupId === parentId);

      let roleUnitName = null;
      if (COUNTABLE_TRACK_ROLES.has(effectiveRole)) {
        if (inherited.parentRole && effectiveRole === inherited.parentRole) {
          roleUnitName = isImmediateTrackChildOfParentRole
            ? track.name
            : (inherited.parentUnitName || track.name);
        } else if (inherited.forcedRole && effectiveRole === inherited.forcedRole) {
          roleUnitName = inherited.forcedUnitName || track.name;
        } else {
          roleUnitName = track.name;
        }
      }

      let choirUnitName = null;
      if (effectiveRole === TRACK_ROLE_CHOIR) {
        if (inherited.parentRole === TRACK_ROLE_CHOIR) {
          choirUnitName = isImmediateTrackChildOfParentRole
            ? track.name
            : (inherited.parentUnitName || roleUnitName || track.name);
        } else {
          choirUnitName = inherited.choirUnitName || roleUnitName || track.name;
        }
      }

      const derivedPartValues = new Set();
      if (effectiveRole === TRACK_ROLE_INSTRUMENT || effectiveRole === TRACK_ROLE_LEAD) {
        const normalized = normalizeScopeValue(roleUnitName);
        if (normalized) derivedPartValues.add(normalized);
      }
      if (effectiveRole === TRACK_ROLE_CHOIR) {
        const normalized = normalizeScopeValue(choirUnitName);
        if (normalized) derivedPartValues.add(normalized);
      }

      infoByTrackId.set(track.id, {
        trackId: track.id,
        nodeId: node.id,
        parentId: node.parentId || null,
        createdByUserId: normalizeText(track.createdByUserId) || null,
        accessScopeType: TRACK_SCOPE_TYPES.includes(normalizeLowerText(track.accessScopeType))
          ? normalizeLowerText(track.accessScopeType)
          : null,
        accessScopeValue: normalizeScopeValue(track.accessScopeValue),
        derivedGroupValues: new Set(inherited.ancestorGroupValues),
        derivedPartValues,
      });
    }
  };

  walk(null, {
    ancestorGroupValues: [],
    parentRole: null,
    parentGroupId: null,
    parentUnitName: null,
    forcedRole: null,
    forcedUnitName: null,
    choirRole: null,
    choirUnitName: null,
  });

  for (const track of tracks) {
    if (infoByTrackId.has(track.id) || isMetronomeRole(track.role)) continue;
    const normalizedTrackName = normalizeScopeValue(track.name);
    const derivedPartValues = new Set();
    const effectiveRole = toCategoryRole(track.role);
    if (
      effectiveRole === TRACK_ROLE_INSTRUMENT
      || effectiveRole === TRACK_ROLE_LEAD
      || effectiveRole === TRACK_ROLE_CHOIR
    ) {
      if (normalizedTrackName) {
        derivedPartValues.add(normalizedTrackName);
      }
    }
    infoByTrackId.set(track.id, {
      trackId: track.id,
      nodeId: `track-node:${track.id}`,
      parentId: null,
      createdByUserId: normalizeText(track.createdByUserId) || null,
      accessScopeType: TRACK_SCOPE_TYPES.includes(normalizeLowerText(track.accessScopeType))
        ? normalizeLowerText(track.accessScopeType)
        : null,
      accessScopeValue: normalizeScopeValue(track.accessScopeValue),
      derivedGroupValues: new Set(),
      derivedPartValues,
    });
  }

  return infoByTrackId;
}

export function extractProjectAccessTags(snapshot = {}) {
  const tagsByKey = new Map();
  const trackTree = Array.isArray(snapshot?.trackTree) ? snapshot.trackTree : [];
  for (const node of trackTree) {
    if (node?.kind !== 'group') continue;
    addTag(tagsByKey, PROJECT_TARGET_GROUP_NAME, node?.name);
  }

  const trackBindings = collectTrackBindingInfo(snapshot);
  for (const info of trackBindings.values()) {
    info.derivedPartValues.forEach((value) => addTag(tagsByKey, PROJECT_TARGET_PART_NAME, value));
  }

  return Array.from(tagsByKey.values()).sort((left, right) => {
    if (left.tagType !== right.tagType) return left.tagType.localeCompare(right.tagType);
    return left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });
}

export async function replaceProjectAccessTags(db, projectId, snapshot = {}) {
  await db.query('DELETE FROM project_access_tags WHERE project_id = $1', [projectId]);
  const tags = extractProjectAccessTags(snapshot);
  for (const tag of tags) {
    await db.query(
      `INSERT INTO project_access_tags(project_id, tag_type, tag_value, display_name)
       VALUES($1, $2, $3, $4)`,
      [projectId, tag.tagType, tag.tagValue, tag.displayName]
    );
  }
}

export async function syncAllProjectAccessTags(db = pool) {
  const result = await db.query(
    `SELECT project_id AS "projectId", latest_snapshot_json AS "snapshot"
     FROM project_heads`
  );
  for (const row of result.rows) {
    await replaceProjectAccessTags(db, row.projectId, row.snapshot || {});
  }
}

function buildTagMapFromRows(rows = []) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.projectId)) {
      map.set(row.projectId, {
        [PROJECT_TARGET_GROUP_NAME]: new Set(),
        [PROJECT_TARGET_PART_NAME]: new Set(),
      });
    }
    const tags = map.get(row.projectId);
    if (row.tagType === PROJECT_TARGET_GROUP_NAME || row.tagType === PROJECT_TARGET_PART_NAME) {
      tags[row.tagType].add(row.tagValue);
    }
  }
  return map;
}

function mapRoleRow(row) {
  const systemKey = row.systemKey || row.system_key || '';
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    emptyAccessMessage: row.emptyAccessMessage || row.empty_access_message || '',
    isSystem: Boolean(row.isSystem ?? row.is_system),
    systemKey,
    membersHidden: systemKey === SYSTEM_ROLE_DEFAULT_USER_KEY,
    memberCount: Number(row.memberCount || row.member_count || 0),
    grantCount: Number(row.grantCount || row.grant_count || 0),
    parentCount: Number(row.parentCount || row.parent_count || 0),
    linkCount: Number(row.linkCount || row.link_count || 0),
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null,
  };
}

export function getCapabilityCatalog() {
  return CAPABILITY_DEFINITIONS.map((entry) => ({ ...entry }));
}

export function getCapabilityLabel(capability) {
  return capabilityDefinition(normalizeCapability(capability))?.label || capability;
}

export async function getRoleBySystemKey(systemKey, db = pool) {
  const result = await db.query(
    `SELECT r.id,
            r.name,
            description,
            empty_access_message AS "emptyAccessMessage",
            is_system AS "isSystem",
            system_key AS "systemKey",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            (SELECT COUNT(*)::integer FROM rbac_role_memberships rm WHERE rm.role_id = r.id) AS "memberCount",
            (SELECT COUNT(*)::integer FROM rbac_grants g WHERE g.role_id = r.id) AS "grantCount",
            (SELECT COUNT(*)::integer FROM rbac_role_inheritance ri WHERE ri.role_id = r.id) AS "parentCount",
            (SELECT COUNT(*)::integer FROM rbac_role_oidc_links ol WHERE ol.role_id = r.id) AS "linkCount"
     FROM rbac_roles r
     WHERE system_key = $1
     LIMIT 1`,
    [systemKey]
  );
  return result.rows[0] ? mapRoleRow(result.rows[0]) : null;
}

export async function getAdminRole(db = pool) {
  return await getRoleBySystemKey(SYSTEM_ROLE_ADMIN_KEY, db);
}

export async function getDefaultUserRole(db = pool) {
  return await getRoleBySystemKey(SYSTEM_ROLE_DEFAULT_USER_KEY, db);
}

function isAdminSystemRole(role) {
  return role?.systemKey === SYSTEM_ROLE_ADMIN_KEY;
}

function isDefaultUserSystemRole(role) {
  return role?.systemKey === SYSTEM_ROLE_DEFAULT_USER_KEY;
}

async function assertRoleExists(roleId, db = pool) {
  const role = await getRoleById(roleId, db);
  if (!role) {
    throw new Error('Role not found');
  }
  return role;
}

async function assertRoleDefinitionEditable(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (role.isSystem) {
    throw new Error('System roles cannot be renamed or deleted');
  }
  return role;
}

async function assertRoleGrantEditable(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (isAdminSystemRole(role)) {
    throw new Error('Admin role grants cannot be modified');
  }
  return role;
}

async function assertRoleMembershipEditable(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (isDefaultUserSystemRole(role)) {
    throw new Error('Default user membership is automatic');
  }
  return role;
}

async function assertRoleInheritanceEditable(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (role.isSystem) {
    throw new Error('System roles cannot participate in role inheritance');
  }
  return role;
}

export async function userHasAdminRole(userId, db = pool) {
  const result = await db.query(
    `SELECT EXISTS(
       SELECT 1
       FROM rbac_role_memberships rm
       JOIN rbac_roles r
         ON r.id = rm.role_id
       WHERE rm.user_id = $1
         AND r.system_key = $2
     ) AS "isAdmin"`,
    [userId, SYSTEM_ROLE_ADMIN_KEY]
  );
  return Boolean(result.rows[0]?.isAdmin);
}

export async function countActiveAdminUsers(db = pool) {
  const result = await db.query(
    `SELECT COUNT(*)::integer AS "count"
     FROM users u
     JOIN rbac_role_memberships rm
       ON rm.user_id = u.id
     JOIN rbac_roles r
       ON r.id = rm.role_id
     WHERE u.is_active = TRUE
       AND r.system_key = $1`,
    [SYSTEM_ROLE_ADMIN_KEY]
  );
  return Number(result.rows[0]?.count || 0);
}

export async function assertUserCanLoseAdminRole(userId, db = pool) {
  const isAdmin = await userHasAdminRole(userId, db);
  if (!isAdmin) return;
  const userResult = await db.query('SELECT is_active AS "isActive" FROM users WHERE id = $1', [userId]);
  const user = userResult.rows[0];
  if (!user?.isActive) return;
  const activeAdminCount = await countActiveAdminUsers(db);
  if (activeAdminCount <= 1) {
    throw new Error('At least one active admin user must remain');
  }
}

export async function listRoles(db = pool) {
  const result = await db.query(
    `SELECT r.id,
            r.name,
            r.description,
            r.empty_access_message AS "emptyAccessMessage",
            r.is_system AS "isSystem",
            r.system_key AS "systemKey",
            r.created_at AS "createdAt",
            r.updated_at AS "updatedAt",
            (SELECT COUNT(*)::integer FROM rbac_role_memberships rm WHERE rm.role_id = r.id) AS "memberCount",
            (SELECT COUNT(*)::integer FROM rbac_grants g WHERE g.role_id = r.id) AS "grantCount",
            (SELECT COUNT(*)::integer FROM rbac_role_inheritance ri WHERE ri.role_id = r.id) AS "parentCount",
            (SELECT COUNT(*)::integer FROM rbac_role_oidc_links ol WHERE ol.role_id = r.id) AS "linkCount"
     FROM rbac_roles r
     ORDER BY CASE
       WHEN r.system_key = 'admin' THEN 0
       WHEN r.system_key = 'default_user' THEN 1
       WHEN r.is_system THEN 2
       ELSE 3
     END,
     r.name ASC`
  );
  return result.rows.map(mapRoleRow);
}

export async function getRoleById(roleId, db = pool) {
  const result = await db.query(
    `SELECT r.id,
            r.name,
            r.description,
            r.empty_access_message AS "emptyAccessMessage",
            r.is_system AS "isSystem",
            r.system_key AS "systemKey",
            r.created_at AS "createdAt",
            r.updated_at AS "updatedAt",
            (SELECT COUNT(*)::integer FROM rbac_role_memberships rm WHERE rm.role_id = r.id) AS "memberCount",
            (SELECT COUNT(*)::integer FROM rbac_grants g WHERE g.role_id = r.id) AS "grantCount",
            (SELECT COUNT(*)::integer FROM rbac_role_inheritance ri WHERE ri.role_id = r.id) AS "parentCount",
            (SELECT COUNT(*)::integer FROM rbac_role_oidc_links ol WHERE ol.role_id = r.id) AS "linkCount"
     FROM rbac_roles r
     WHERE r.id = $1`,
    [roleId]
  );
  return result.rowCount === 0 ? null : mapRoleRow(result.rows[0]);
}

export async function createRole({ name, description = '' }, actorUserId = null, db = pool) {
  const trimmedName = normalizeText(name);
  if (!trimmedName) {
    throw new Error('Role name is required');
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO rbac_roles(id, name, description, created_by)
     VALUES($1, $2, $3, $4)`,
    [id, trimmedName, normalizeText(description), actorUserId]
  );
  return await getRoleById(id, db);
}

export async function listRoleParents(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (role.isSystem) return [];
  const result = await db.query(
    `SELECT r.id,
            r.name,
            r.description,
            r.empty_access_message AS "emptyAccessMessage",
            r.is_system AS "isSystem",
            r.system_key AS "systemKey",
            r.created_at AS "createdAt",
            r.updated_at AS "updatedAt",
            (SELECT COUNT(*)::integer FROM rbac_role_memberships rm WHERE rm.role_id = r.id) AS "memberCount",
            (SELECT COUNT(*)::integer FROM rbac_grants g WHERE g.role_id = r.id) AS "grantCount",
            (SELECT COUNT(*)::integer FROM rbac_role_inheritance ri2 WHERE ri2.role_id = r.id) AS "parentCount",
            (SELECT COUNT(*)::integer FROM rbac_role_oidc_links ol WHERE ol.role_id = r.id) AS "linkCount"
     FROM rbac_role_inheritance ri
     JOIN rbac_roles r
       ON r.id = ri.parent_role_id
     WHERE ri.role_id = $1
     ORDER BY r.name ASC`,
    [roleId]
  );
  return result.rows.map(mapRoleRow);
}

export async function listRoleChildren(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (role.isSystem) return [];
  const result = await db.query(
    `SELECT r.id,
            r.name,
            r.description,
            r.empty_access_message AS "emptyAccessMessage",
            r.is_system AS "isSystem",
            r.system_key AS "systemKey",
            r.created_at AS "createdAt",
            r.updated_at AS "updatedAt",
            (SELECT COUNT(*)::integer FROM rbac_role_memberships rm WHERE rm.role_id = r.id) AS "memberCount",
            (SELECT COUNT(*)::integer FROM rbac_grants g WHERE g.role_id = r.id) AS "grantCount",
            (SELECT COUNT(*)::integer FROM rbac_role_inheritance ri2 WHERE ri2.role_id = r.id) AS "parentCount",
            (SELECT COUNT(*)::integer FROM rbac_role_oidc_links ol WHERE ol.role_id = r.id) AS "linkCount"
     FROM rbac_role_inheritance ri
     JOIN rbac_roles r
       ON r.id = ri.role_id
     WHERE ri.parent_role_id = $1
     ORDER BY r.name ASC`,
    [roleId]
  );
  return result.rows.map(mapRoleRow);
}

async function assertRoleParentsValid(roleId, parentRoleIds, db = pool) {
  await assertRoleInheritanceEditable(roleId, db);
  const normalizedParentIds = uniqueTextValues(parentRoleIds);
  if (normalizedParentIds.includes(roleId)) {
    throw new Error('Role cannot inherit from itself');
  }
  if (!normalizedParentIds.length) {
    return [];
  }

  const parentResult = await db.query(
    `SELECT id,
            is_system AS "isSystem"
     FROM rbac_roles
     WHERE id = ANY($1::text[])`,
    [normalizedParentIds]
  );
  if (parentResult.rowCount !== normalizedParentIds.length) {
    throw new Error('Parent role not found');
  }
  if (parentResult.rows.some((row) => row.isSystem)) {
    throw new Error('System roles cannot participate in role inheritance');
  }

  const cycleResult = await db.query(
    `WITH RECURSIVE ancestors(id) AS (
       SELECT unnest($1::text[])
       UNION
       SELECT ri.parent_role_id
       FROM rbac_role_inheritance ri
       JOIN ancestors a
         ON ri.role_id = a.id
     )
     SELECT 1
     FROM ancestors
     WHERE id = $2
     LIMIT 1`,
    [normalizedParentIds, roleId]
  );
  if (cycleResult.rowCount > 0) {
    throw new Error('Role inheritance cannot contain cycles');
  }

  return normalizedParentIds;
}

export async function setRoleParents(roleId, parentRoleIds = [], db = pool) {
  const normalizedParentIds = await assertRoleParentsValid(roleId, parentRoleIds, db);
  const client = db === pool ? await pool.connect() : db;
  const release = db === pool;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM rbac_role_inheritance WHERE role_id = $1', [roleId]);
    for (const parentRoleId of normalizedParentIds) {
      await client.query(
        `INSERT INTO rbac_role_inheritance(role_id, parent_role_id)
         VALUES($1, $2)
         ON CONFLICT (role_id, parent_role_id) DO NOTHING`,
        [roleId, parentRoleId]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (release) client.release();
  }
}

export async function updateRole(roleId, { name, description, emptyAccessMessage, parentRoleIds } = {}, db = pool) {
  const role = await assertRoleExists(roleId, db);

  if (isAdminSystemRole(role)) {
    throw new Error('Admin role cannot be modified');
  }

  if (isDefaultUserSystemRole(role)) {
    if (name !== undefined || description !== undefined || parentRoleIds !== undefined) {
      throw new Error('Default user role cannot be modified');
    }
    if (emptyAccessMessage === undefined) {
      throw new Error('No valid role fields to update');
    }
    await db.query(
      `UPDATE rbac_roles
       SET empty_access_message = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [roleId, normalizeText(emptyAccessMessage) || DEFAULT_EMPTY_ACCESS_MESSAGE]
    );
    return await getRoleById(roleId, db);
  }

  const client = db === pool ? await pool.connect() : db;
  const release = db === pool;
  try {
    await client.query('BEGIN');
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      const trimmedName = normalizeText(name);
      if (!trimmedName) {
        throw new Error('Role name is required');
      }
      updates.push(`name = $${idx++}`);
      values.push(trimmedName);
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(normalizeText(description));
    }
    if (emptyAccessMessage !== undefined) {
      throw new Error('Only the default user role can store a no-access message');
    }

    if (updates.length) {
      updates.push('updated_at = NOW()');
      values.push(roleId);
      await client.query(
        `UPDATE rbac_roles
         SET ${updates.join(', ')}
         WHERE id = $${idx}`,
        values
      );
    }

    if (parentRoleIds !== undefined) {
      await setRoleParents(roleId, parentRoleIds, client);
    }

    if (!updates.length && parentRoleIds === undefined) {
      throw new Error('No valid role fields to update');
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (release) client.release();
  }
  return await getRoleById(roleId, db);
}

export async function deleteRole(roleId, db = pool) {
  await assertRoleDefinitionEditable(roleId, db);
  await db.query('DELETE FROM rbac_roles WHERE id = $1', [roleId]);
}

function serializeOidcLinkRow(row) {
  return {
    id: row.id,
    roleId: row.role_id || row.roleId,
    claimPath: row.claim_path || row.claimPath || '',
    claimValue: row.claim_value || row.claimValue || '',
    description: row.description || '',
    createdBy: row.created_by || row.createdBy || null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function buildOidcLinkRule(link) {
  const claimPath = normalizeText(link?.claim_path || link?.claimPath);
  const claimValue = normalizeText(link?.claim_value || link?.claimValue);
  return claimPath ? `${claimPath}=${claimValue}` : claimValue;
}

async function assertRoleOidcLinkEditable(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (isDefaultUserSystemRole(role)) {
    throw new Error('Default user role links are automatic');
  }
  return role;
}

export async function listRoleOidcLinks(roleId, db = pool) {
  await assertRoleExists(roleId, db);
  const result = await db.query(
    `SELECT id,
            role_id,
            claim_path,
            claim_value,
            description,
            created_by,
            created_at,
            updated_at
     FROM rbac_role_oidc_links
     WHERE role_id = $1
     ORDER BY claim_path ASC, claim_value ASC, created_at ASC`,
    [roleId]
  );
  return result.rows.map(serializeOidcLinkRow);
}

export async function createRoleOidcLink(roleId, { claimPath = '', claimValue = '', description = '' } = {}, actorUserId = null, db = pool) {
  await assertRoleOidcLinkEditable(roleId, db);
  const normalizedClaimPath = normalizeText(claimPath);
  const normalizedClaimValue = normalizeText(claimValue);
  if (!normalizedClaimValue) {
    throw new Error('OIDC link value is required');
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO rbac_role_oidc_links(id, role_id, claim_path, claim_value, description, created_by)
     VALUES($1, $2, $3, $4, $5, $6)`,
    [id, roleId, normalizedClaimPath, normalizedClaimValue, normalizeText(description), actorUserId]
  );
  const result = await db.query(
    `SELECT id,
            role_id,
            claim_path,
            claim_value,
            description,
            created_by,
            created_at,
            updated_at
     FROM rbac_role_oidc_links
     WHERE id = $1`,
    [id]
  );
  return serializeOidcLinkRow(result.rows[0]);
}

export async function deleteRoleOidcLink(roleId, linkId, db = pool) {
  await assertRoleOidcLinkEditable(roleId, db);
  const result = await db.query(
    `DELETE FROM rbac_role_oidc_links
     WHERE id = $1
       AND role_id = $2
     RETURNING id`,
    [linkId, roleId]
  );
  if (result.rowCount === 0) {
    throw new Error('OIDC link not found');
  }
}

export async function applyOidcRoleLinksForUser(userId, rawClaims = {}, db = pool) {
  const result = await db.query(
    `SELECT ol.id,
            ol.role_id,
            ol.claim_path,
            ol.claim_value
     FROM rbac_role_oidc_links ol
     JOIN rbac_roles r
       ON r.id = ol.role_id
     WHERE r.system_key IS DISTINCT FROM $1
     ORDER BY ol.created_at ASC`,
    [SYSTEM_ROLE_DEFAULT_USER_KEY]
  );

  const matchedLinksByRoleId = new Map();
  for (const link of result.rows) {
    if (matchesOidcBootstrapRule(rawClaims || {}, buildOidcLinkRule(link))) {
      matchedLinksByRoleId.set(link.role_id, link.id);
    }
  }

  for (const [roleId, linkId] of matchedLinksByRoleId.entries()) {
    await db.query(
      `INSERT INTO rbac_role_memberships(role_id, user_id, added_by, source, source_oidc_link_id)
       VALUES($1, $2, NULL, 'oidc_link', $3)
       ON CONFLICT (role_id, user_id) DO UPDATE
       SET source = CASE
             WHEN rbac_role_memberships.source = 'oidc_link' THEN 'oidc_link'
             ELSE rbac_role_memberships.source
           END,
           source_oidc_link_id = CASE
             WHEN rbac_role_memberships.source = 'oidc_link' THEN EXCLUDED.source_oidc_link_id
             ELSE rbac_role_memberships.source_oidc_link_id
           END`,
      [roleId, userId, linkId]
    );
  }

  return Array.from(matchedLinksByRoleId.keys());
}

export async function listRoleMembers(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (isDefaultUserSystemRole(role)) {
    return [];
  }
  const result = await db.query(
    `SELECT u.id,
            u.username,
            u.is_active AS "isActive",
            EXISTS(
              SELECT 1
              FROM rbac_role_memberships arm
              JOIN rbac_roles ar
                ON ar.id = arm.role_id
              WHERE arm.user_id = u.id
                AND ar.system_key = $2
            ) AS "isAdmin",
            rm.source,
            rm.created_at AS "addedAt"
     FROM rbac_role_memberships rm
     JOIN users u
       ON u.id = rm.user_id
     WHERE rm.role_id = $1
     ORDER BY u.username ASC`,
    [roleId, SYSTEM_ROLE_ADMIN_KEY]
  );
  return result.rows.map((row) => ({
    id: row.id,
    username: row.username,
    isActive: Boolean(row.isActive),
    isAdmin: Boolean(row.isAdmin),
    source: row.source || 'manual',
    addedAt: row.addedAt,
  }));
}

export async function addRoleMember(roleId, userId, actorUserId = null, db = pool) {
  await assertRoleMembershipEditable(roleId, db);
  const userResult = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (userResult.rowCount === 0) {
    throw new Error('User not found');
  }
  await db.query(
    `INSERT INTO rbac_role_memberships(role_id, user_id, added_by, source)
     VALUES($1, $2, $3, 'manual')
     ON CONFLICT (role_id, user_id) DO NOTHING`,
    [roleId, userId, actorUserId]
  );
}

export async function removeRoleMember(roleId, userId, db = pool) {
  const role = await assertRoleMembershipEditable(roleId, db);
  if (role.systemKey === SYSTEM_ROLE_ADMIN_KEY) {
    await assertUserCanLoseAdminRole(userId, db);
  }
  await db.query(
    `DELETE FROM rbac_role_memberships
     WHERE role_id = $1 AND user_id = $2`,
    [roleId, userId]
  );
}

export async function listUserRoles(userId, { includeDefaultUserRole = false } = {}, db = pool) {
  const result = await db.query(
    `SELECT r.id,
            r.name,
            r.description,
            r.empty_access_message AS "emptyAccessMessage",
            r.is_system AS "isSystem",
            r.system_key AS "systemKey",
            r.created_at AS "createdAt",
            r.updated_at AS "updatedAt",
            (SELECT COUNT(*)::integer FROM rbac_role_memberships rm2 WHERE rm2.role_id = r.id) AS "memberCount",
            (SELECT COUNT(*)::integer FROM rbac_grants g WHERE g.role_id = r.id) AS "grantCount",
            (SELECT COUNT(*)::integer FROM rbac_role_inheritance ri WHERE ri.role_id = r.id) AS "parentCount",
            (SELECT COUNT(*)::integer FROM rbac_role_oidc_links ol WHERE ol.role_id = r.id) AS "linkCount"
     FROM rbac_role_memberships rm
     JOIN rbac_roles r
       ON r.id = rm.role_id
     WHERE rm.user_id = $1
       AND ($2::boolean = TRUE OR r.system_key IS DISTINCT FROM $3)
     ORDER BY r.is_system DESC, r.name ASC`,
    [userId, includeDefaultUserRole, SYSTEM_ROLE_DEFAULT_USER_KEY]
  );
  return result.rows.map(mapRoleRow);
}

export async function ensureDefaultUserRoleMembership(userId, db = pool) {
  const userResult = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (userResult.rowCount === 0) {
    throw new Error('User not found');
  }
  await db.query(
    `INSERT INTO rbac_role_memberships(role_id, user_id, added_by, source)
     VALUES($1, $2, NULL, 'system')
     ON CONFLICT (role_id, user_id) DO NOTHING`,
    [SYSTEM_ROLE_DEFAULT_USER_ID, userId]
  );
}

async function listResolvedRoleIdsForUser(userId, db = pool) {
  const result = await db.query(
    `WITH RECURSIVE resolved(role_id) AS (
       SELECT rm.role_id
       FROM rbac_role_memberships rm
       WHERE rm.user_id = $1
       UNION
       SELECT ri.parent_role_id
       FROM rbac_role_inheritance ri
       JOIN resolved r
         ON ri.role_id = r.role_id
     )
     SELECT DISTINCT role_id AS id
     FROM resolved`,
    [userId]
  );
  return result.rows.map((row) => row.id);
}

function serializeGrantRow(row) {
  const capability = normalizeCapability(row.capability);
  const projectTargetType = row.project_target_type || row.projectTargetType || null;
  const projectTargetProjectId = row.project_target_project_id || row.projectTargetProjectId || null;
  const projectTargetValue = row.project_target_value || row.projectTargetValue || null;
  const projectTargetLabel = row.project_target_label || row.projectTargetLabel || '';
  const showTargetType = row.show_target_type || row.showTargetType || SHOW_TARGET_ALL_SHOWS;
  const showTargetShowId = row.show_target_show_id || row.showTargetShowId || null;
  const showTargetLabel = row.show_target_label || row.showTargetLabel || (showTargetType === SHOW_TARGET_ALL_SHOWS ? 'All shows' : '');
  const trackScopeType = row.track_scope_type || row.trackScopeType || null;
  const trackScopeValue = row.track_scope_value || row.trackScopeValue || null;
  const trackScopeLabel = row.track_scope_label || row.trackScopeLabel || '';
  const compatibility = capabilityToLegacyAccessLevel(capability);
  return {
    id: row.id,
    capability,
    capabilityLabel: getCapabilityLabel(capability),
    projectTargetType,
    projectTargetProjectId,
    projectTargetValue,
    projectTargetLabel,
    showTargetType,
    showTargetShowId,
    showTargetLabel,
    trackScopeType,
    trackScopeValue,
    trackScopeLabel,
    roleId: row.role_id || row.roleId || null,
    userId: row.user_id || row.userId || null,
    grantedBy: row.granted_by || row.grantedBy || null,
    sourceType: row.sourceType || row.source_type || 'direct',
    sourceRoleId: row.sourceRoleId || row.source_role_id || null,
    sourceRoleName: row.sourceRoleName || row.source_role_name || '',
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,

    accessLevel: compatibility,
    canRead: capability !== CAPABILITY_PLAYER_TUTTI,
    canWrite: capability === CAPABILITY_PROJECT_MANAGER,
    scopeType: projectTargetType,
    scopeProjectId: projectTargetProjectId,
    scopeValue: projectTargetValue,
    scopeLabel: projectTargetLabel,
  };
}

export async function listResolvedGrantsForUser(userId, db = pool) {
  const roleIds = await listResolvedRoleIdsForUser(userId, db);
  const result = await db.query(
    `SELECT g.id,
            g.role_id,
            g.user_id,
            g.capability,
            g.project_target_type,
            g.project_target_project_id,
            g.project_target_value,
            g.project_target_label,
            g.show_target_type,
            g.show_target_show_id,
            g.show_target_label,
            g.track_scope_type,
            g.track_scope_value,
            g.track_scope_label,
            g.granted_by,
            g.created_at,
            g.updated_at,
            'direct' AS "sourceType",
            NULL::text AS "sourceRoleId",
            NULL::text AS "sourceRoleName"
     FROM rbac_grants g
     WHERE g.user_id = $1
     UNION ALL
     SELECT g.id,
            g.role_id,
            g.user_id,
            g.capability,
            g.project_target_type,
            g.project_target_project_id,
            g.project_target_value,
            g.project_target_label,
            g.show_target_type,
            g.show_target_show_id,
            g.show_target_label,
            g.track_scope_type,
            g.track_scope_value,
            g.track_scope_label,
            g.granted_by,
            g.created_at,
            g.updated_at,
            'role' AS "sourceType",
            r.id AS "sourceRoleId",
            r.name AS "sourceRoleName"
     FROM rbac_grants g
     JOIN rbac_roles r
       ON r.id = g.role_id
     WHERE g.role_id = ANY($2::text[])`,
    [userId, roleIds.length ? roleIds : ['']]
  );
  return result.rows.map(serializeGrantRow);
}

async function loadProjectTagRows(projectIds = null, db = pool) {
  const hasProjectIds = Array.isArray(projectIds) && projectIds.length > 0;
  const result = await db.query(
    `SELECT project_id AS "projectId",
            tag_type AS "tagType",
            tag_value AS "tagValue"
     FROM project_access_tags
     WHERE $1::boolean = FALSE OR project_id = ANY($2::text[])`,
    [hasProjectIds, hasProjectIds ? projectIds : []]
  );
  return result.rows;
}

async function loadProjectRows(projectIds = [], db = pool) {
  const normalizedProjectIds = uniqueTextValues(projectIds);
  if (!normalizedProjectIds.length) return [];
  const result = await db.query(
    `SELECT p.id,
            p.name,
            p.created_by AS "createdByUserId",
            p.musical_number AS "musicalNumber",
            p.scene_order AS "sceneOrder",
            p.show_id AS "showId",
            s.name AS "showName"
     FROM projects p
     LEFT JOIN shows s
       ON s.id = p.show_id
     WHERE p.id = ANY($1::text[])`,
    [normalizedProjectIds]
  );
  return result.rows;
}

async function loadProjectRow(projectId, db = pool) {
  const rows = await loadProjectRows([projectId], db);
  return rows[0] || null;
}

function normalizeProjectTargetShape(grant = {}) {
  return {
    projectTargetType: grant.projectTargetType || grant.scopeType || null,
    projectTargetProjectId: grant.projectTargetProjectId || grant.scopeProjectId || null,
    projectTargetValue: grant.projectTargetValue || grant.scopeValue || null,
  };
}

function normalizeShowTargetShape(grant = {}) {
  return {
    showTargetType: grant.showTargetType || grant.show_target_type || SHOW_TARGET_ALL_SHOWS,
    showTargetShowId: grant.showTargetShowId || grant.show_target_show_id || null,
  };
}

function grantMatchesShow(grant, projectShowId = null) {
  const shape = normalizeShowTargetShape(grant);
  if (!shape.showTargetType || shape.showTargetType === SHOW_TARGET_ALL_SHOWS) return true;
  if (shape.showTargetType === SHOW_TARGET_SHOW) {
    return Boolean(projectShowId) && String(shape.showTargetShowId || '') === String(projectShowId);
  }
  return false;
}

function grantMatchesProject(grant, projectOrId, projectTags = null) {
  if (!grant) return false;
  const projectId = typeof projectOrId === 'object'
    ? (projectOrId?.id || projectOrId?.projectId)
    : projectOrId;
  const projectShowId = typeof projectOrId === 'object'
    ? (projectOrId?.showId || projectOrId?.show_id)
    : null;
  if (!grantMatchesShow(grant, projectShowId)) return false;
  const shape = normalizeProjectTargetShape(grant);
  if (shape.projectTargetType === PROJECT_TARGET_ALL_PROJECTS) return true;
  if (shape.projectTargetType === PROJECT_TARGET_PROJECT) {
    return String(shape.projectTargetProjectId || '') === String(projectId || '');
  }
  if (!projectTags) return false;
  if (shape.projectTargetType === PROJECT_TARGET_GROUP_NAME) {
    return projectTags[PROJECT_TARGET_GROUP_NAME]?.has(normalizeScopeValue(shape.projectTargetValue)) || false;
  }
  if (shape.projectTargetType === PROJECT_TARGET_PART_NAME) {
    return projectTags[PROJECT_TARGET_PART_NAME]?.has(normalizeScopeValue(shape.projectTargetValue)) || false;
  }
  return false;
}

function emptyProjectAccessSummary() {
  return {
    canListenTutti: false,
    canReadProject: false,
    canCreateMixes: false,
    canWriteOwnTracks: false,
    canWriteScopedTracks: false,
    canManageOwnProject: false,
    canManageProject: false,
    canCreateProjects: false,
    editableTrackScopes: [],
    compatibility: {
      canRead: false,
      canWrite: false,
    },
  };
}

function mergeEditableTrackScope(scopesMap, grant) {
  const trackScopeType = grant.trackScopeType || grant.track_scope_type || null;
  const trackScopeValue = normalizeScopeValue(grant.trackScopeValue || grant.track_scope_value || null);
  const trackScopeLabel = normalizeText(grant.trackScopeLabel || grant.track_scope_label || grant.scopeLabel || trackScopeValue || '');
  if (!trackScopeType || !trackScopeValue) return;
  const key = `${trackScopeType}:${trackScopeValue}`;
  if (scopesMap.has(key)) return;
  scopesMap.set(key, {
    type: trackScopeType,
    value: trackScopeValue,
    label: trackScopeLabel || trackScopeValue,
  });
}

function canGrantRead(capability) {
  const normalized = normalizeCapability(capability);
  return (
    normalized === CAPABILITY_PROJECT_READ
    || normalized === CAPABILITY_TRACK_WRITE_OWN
    || normalized === CAPABILITY_TRACK_WRITE_SCOPE
    || normalized === CAPABILITY_PROJECT_MANAGER
  );
}

function buildProjectAccessSummary(userId, project, grants = [], projectTags = null, isAdmin = false) {
  const summary = emptyProjectAccessSummary();
  const normalizedUserId = normalizeText(userId);
  const createdByUserId = normalizeText(project?.createdByUserId || project?.created_by || '');
  const editableTrackScopes = new Map();
  let hasManageOwnProjects = false;

  if (isAdmin) {
    return {
      ...summary,
      canListenTutti: true,
      canReadProject: true,
      canCreateMixes: true,
      canWriteOwnTracks: true,
      canWriteScopedTracks: true,
      canManageOwnProject: true,
      canManageProject: true,
      canCreateProjects: true,
      editableTrackScopes: [],
      compatibility: {
        canRead: true,
        canWrite: true,
      },
    };
  }

  for (const grant of grants) {
    const capability = normalizeCapability(grant.capability);
    if (capability === CAPABILITY_MANAGE_OWN_PROJECTS) {
      if (grantMatchesShow(grant, project?.showId || project?.show_id || null)) {
        hasManageOwnProjects = true;
      }
      continue;
    }
    if (!grantMatchesProject(grant, project, projectTags)) continue;
    if (capability === CAPABILITY_PLAYER_TUTTI) {
      summary.canListenTutti = true;
      continue;
    }
    if (capability === CAPABILITY_PROJECT_READ) {
      summary.canReadProject = true;
      continue;
    }
    if (capability === CAPABILITY_TRACK_WRITE_OWN) {
      summary.canWriteOwnTracks = true;
      summary.canReadProject = true;
      continue;
    }
    if (capability === CAPABILITY_TRACK_WRITE_SCOPE) {
      summary.canWriteScopedTracks = true;
      summary.canReadProject = true;
      mergeEditableTrackScope(editableTrackScopes, grant);
      continue;
    }
    if (capability === CAPABILITY_PROJECT_MANAGER) {
      summary.canManageProject = true;
      continue;
    }
  }

  summary.canCreateProjects = hasManageOwnProjects;
  summary.canManageOwnProject = hasManageOwnProjects && Boolean(createdByUserId && createdByUserId === normalizedUserId);

  if (summary.canManageOwnProject || summary.canManageProject) {
    summary.canListenTutti = true;
    summary.canReadProject = true;
    summary.canCreateMixes = true;
  } else if (summary.canReadProject || summary.canWriteOwnTracks || summary.canWriteScopedTracks) {
    summary.canListenTutti = true;
    summary.canCreateMixes = true;
  }

  summary.editableTrackScopes = Array.from(editableTrackScopes.values()).sort((left, right) => (
    left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true })
  ));
  summary.compatibility = {
    canRead: summary.canReadProject,
    canWrite: summary.canManageOwnProject || summary.canManageProject,
  };
  return summary;
}

export function resolveProjectAccessFromGrantRows(grants = [], projectId, projectTags = null, isAdmin = false) {
  if (isAdmin) {
    return { canRead: true, canWrite: true };
  }
  let accessLevel = null;
  for (const grant of grants) {
    const capability = grant.capability ? normalizeCapability(grant.capability) : null;
    if (capability) {
      if (!grantMatchesProject(grant, projectId, projectTags)) continue;
      if (capability === CAPABILITY_PROJECT_MANAGER) {
        return { canRead: true, canWrite: true };
      }
      if (
        capability === CAPABILITY_PROJECT_READ
        || capability === CAPABILITY_TRACK_WRITE_OWN
        || capability === CAPABILITY_TRACK_WRITE_SCOPE
      ) {
        accessLevel = ACCESS_LEVEL_READ;
      }
      continue;
    }

    if (!grantMatchesProject(grant, projectId, projectTags)) continue;
    accessLevel = accessLevel ? getHigherAccessLevel(accessLevel, grant.accessLevel) : normalizeAccessLevel(grant.accessLevel);
    if (accessLevel === ACCESS_LEVEL_WRITE) {
      return { canRead: true, canWrite: true };
    }
  }
  if (!accessLevel) return { canRead: false, canWrite: false };
  return accessLevelToFlags(accessLevel);
}

async function loadUserGrantContext(userId, projectIds = [], db = pool) {
  const normalizedProjectIds = uniqueTextValues(projectIds);
  const [isAdmin, grants, tagRows, projectRows] = await Promise.all([
    userHasAdminRole(userId, db),
    listResolvedGrantsForUser(userId, db),
    loadProjectTagRows(normalizedProjectIds, db),
    loadProjectRows(normalizedProjectIds, db),
  ]);
  return {
    isAdmin,
    grants,
    tagMap: buildTagMapFromRows(tagRows),
    projectById: new Map(projectRows.map((row) => [row.id, row])),
  };
}

export async function getProjectAccess(userId, projectId, db = pool) {
  const project = await loadProjectRow(projectId, db);
  if (!project) return emptyProjectAccessSummary();
  const { isAdmin, grants, tagMap } = await loadUserGrantContext(userId, [projectId], db);
  return buildProjectAccessSummary(userId, project, grants, tagMap.get(projectId) || null, isAdmin);
}

export async function getProjectAccessMap(userId, projectRowsOrIds = [], db = pool) {
  const rows = Array.isArray(projectRowsOrIds) ? projectRowsOrIds : [];
  const normalizedProjectIds = uniqueTextValues(rows.map((entry) => String(entry?.id || entry?.projectId || entry || '')).filter(Boolean));
  const result = new Map();
  if (!normalizedProjectIds.length) return result;

  const { isAdmin, grants, tagMap, projectById } = await loadUserGrantContext(userId, normalizedProjectIds, db);

  for (const projectId of normalizedProjectIds) {
    const incomingRow = rows.find((entry) => String(entry?.id || entry?.projectId || entry || '') === projectId);
    const project = {
      ...(projectById.get(projectId) || { id: projectId }),
      createdByUserId: incomingRow?.createdByUserId ?? incomingRow?.created_by ?? projectById.get(projectId)?.createdByUserId ?? null,
      musicalNumber: incomingRow?.musicalNumber ?? projectById.get(projectId)?.musicalNumber ?? null,
      sceneOrder: incomingRow?.sceneOrder ?? projectById.get(projectId)?.sceneOrder ?? null,
      showId: incomingRow?.showId ?? incomingRow?.show_id ?? projectById.get(projectId)?.showId ?? null,
      showName: incomingRow?.showName ?? incomingRow?.show_name ?? projectById.get(projectId)?.showName ?? '',
      name: incomingRow?.name ?? projectById.get(projectId)?.name ?? '',
    };
    result.set(projectId, buildProjectAccessSummary(userId, project, grants, tagMap.get(projectId) || null, isAdmin));
  }

  return result;
}

export async function getProjectPermission(userId, projectId, _legacyIsAdmin = false, db = pool) {
  const access = await getProjectAccess(userId, projectId, db);
  return {
    canRead: Boolean(access.compatibility.canRead),
    canWrite: Boolean(access.compatibility.canWrite),
  };
}

export async function getProjectPermissionMap(userId, projectIds = [], db = pool) {
  const accessMap = await getProjectAccessMap(userId, projectIds, db);
  const result = new Map();
  accessMap.forEach((access, projectId) => {
    result.set(projectId, {
      canRead: Boolean(access.compatibility.canRead),
      canWrite: Boolean(access.compatibility.canWrite),
    });
  });
  return result;
}

export async function requireProjectPermission(req, res, permission = ACCESS_LEVEL_READ) {
  const projectId = req.params.id || req.params.projectId;
  if (!projectId) {
    res.status(400).json({ error: 'Missing project id' });
    return null;
  }
  const access = await getProjectAccess(req.user.id, projectId);
  if (permission === ACCESS_LEVEL_WRITE && !access.compatibility.canWrite) {
    res.status(403).json({ error: 'No write permission for this project' });
    return null;
  }
  if (permission === ACCESS_LEVEL_READ && !access.compatibility.canRead) {
    res.status(403).json({ error: 'No read permission for this project' });
    return null;
  }
  return {
    projectId,
    access,
    canRead: access.compatibility.canRead,
    canWrite: access.compatibility.canWrite,
  };
}

export async function getProjectAccessCatalog(db = pool) {
  const [showsResult, projectsResult, groupResult, partResult] = await Promise.all([
    db.query(
      `SELECT id, name, order_index AS "orderIndex"
       FROM shows
       ORDER BY order_index ASC, name ASC`
    ),
    db.query(
      `SELECT p.id,
              p.name,
              p.musical_number AS "musicalNumber",
              p.scene_order AS "sceneOrder",
              p.show_id AS "showId",
              s.name AS "showName"
       FROM projects p
       LEFT JOIN shows s
         ON s.id = p.show_id
       ORDER BY s.order_index ASC, s.name ASC, p.musical_number ASC, p.scene_order ASC NULLS LAST, p.name ASC`
    ),
    db.query(
      `SELECT tag_value AS value,
              MIN(display_name) AS label,
              COUNT(DISTINCT project_id)::integer AS "projectCount"
       FROM project_access_tags
       WHERE tag_type = $1
       GROUP BY tag_value
       ORDER BY MIN(display_name) ASC`,
      [PROJECT_TARGET_GROUP_NAME]
    ),
    db.query(
      `SELECT tag_value AS value,
              MIN(display_name) AS label,
              COUNT(DISTINCT project_id)::integer AS "projectCount"
       FROM project_access_tags
       WHERE tag_type = $1
       GROUP BY tag_value
       ORDER BY MIN(display_name) ASC`,
      [PROJECT_TARGET_PART_NAME]
    ),
  ]);
  return {
    shows: showsResult.rows,
    projects: projectsResult.rows,
    groupNames: groupResult.rows,
    partNames: partResult.rows,
    capabilities: getCapabilityCatalog(),
    showTargetTypes: [
      { value: SHOW_TARGET_ALL_SHOWS, label: 'All shows' },
      { value: SHOW_TARGET_SHOW, label: 'Show' },
    ],
    projectTargetTypes: [
      { value: PROJECT_TARGET_ALL_PROJECTS, label: 'All projects' },
      { value: PROJECT_TARGET_PROJECT, label: 'Project' },
      { value: PROJECT_TARGET_GROUP_NAME, label: 'Group name' },
      { value: PROJECT_TARGET_PART_NAME, label: 'Part name' },
    ],
    trackScopeTypes: [
      { value: TRACK_SCOPE_GROUP_NAME, label: 'Group name' },
      { value: TRACK_SCOPE_PART_NAME, label: 'Part name' },
    ],
  };
}

async function resolveProjectTargetPayload(input, capability, db = pool) {
  const normalizedCapability = normalizeCapability(capability);
  if (normalizedCapability === CAPABILITY_MANAGE_OWN_PROJECTS) {
    return {
      projectTargetType: null,
      projectTargetProjectId: null,
      projectTargetValue: null,
      projectTargetLabel: '',
    };
  }

  const projectTargetType = normalizeProjectTargetType(input?.projectTargetType ?? input?.scopeType);
  if (projectTargetType === PROJECT_TARGET_ALL_PROJECTS) {
    return {
      projectTargetType,
      projectTargetProjectId: null,
      projectTargetValue: null,
      projectTargetLabel: 'All projects',
    };
  }

  if (projectTargetType === PROJECT_TARGET_PROJECT) {
    const projectTargetProjectId = normalizeText(input?.projectTargetProjectId ?? input?.scopeProjectId);
    if (!projectTargetProjectId) {
      throw new Error('projectTargetProjectId is required for project-target grants');
    }
    const projectResult = await db.query(
      `SELECT p.id,
              p.name,
              p.musical_number AS "musicalNumber",
              s.name AS "showName"
       FROM projects p
       LEFT JOIN shows s
         ON s.id = p.show_id
       WHERE p.id = $1`,
      [projectTargetProjectId]
    );
    if (projectResult.rowCount === 0) {
      throw new Error('Selected project not found');
    }
    const project = projectResult.rows[0];
    return {
      projectTargetType,
      projectTargetProjectId,
      projectTargetValue: null,
      projectTargetLabel: `${project.showName ? `${project.showName} / ` : ''}${project.musicalNumber ? `${project.musicalNumber} - ` : ''}${project.name}`,
    };
  }

  const projectTargetValue = normalizeScopeValue(input?.projectTargetValue ?? input?.scopeValue);
  if (!projectTargetValue) {
    throw new Error('projectTargetValue is required for named project targets');
  }
  const result = await db.query(
    `SELECT tag_value AS value,
            MIN(display_name) AS label
     FROM project_access_tags
     WHERE tag_type = $1
       AND tag_value = $2
     GROUP BY tag_value
     LIMIT 1`,
    [projectTargetType, projectTargetValue]
  );
  if (result.rowCount === 0) {
    throw new Error('Selected project target was not found');
  }
  return {
    projectTargetType,
    projectTargetProjectId: null,
    projectTargetValue,
    projectTargetLabel: result.rows[0].label || projectTargetValue,
  };
}

async function resolveShowTargetPayload(input, db = pool) {
  const showTargetType = normalizeShowTargetType(input?.showTargetType);
  if (showTargetType === SHOW_TARGET_ALL_SHOWS) {
    return {
      showTargetType,
      showTargetShowId: null,
      showTargetLabel: 'All shows',
    };
  }

  const showTargetShowId = normalizeText(input?.showTargetShowId);
  if (!showTargetShowId) {
    throw new Error('showTargetShowId is required for show-target grants');
  }
  const showResult = await db.query(
    `SELECT id, name
     FROM shows
     WHERE id = $1`,
    [showTargetShowId]
  );
  if (showResult.rowCount === 0) {
    throw new Error('Selected show not found');
  }
  return {
    showTargetType,
    showTargetShowId,
    showTargetLabel: showResult.rows[0].name,
  };
}

async function resolveTrackScopePayload(input, capability, db = pool) {
  const normalizedCapability = normalizeCapability(capability);
  if (normalizedCapability !== CAPABILITY_TRACK_WRITE_SCOPE) {
    return {
      trackScopeType: null,
      trackScopeValue: null,
      trackScopeLabel: '',
    };
  }

  const trackScopeType = normalizeTrackScopeType(input?.trackScopeType);
  const trackScopeValue = normalizeScopeValue(input?.trackScopeValue);
  if (!trackScopeValue) {
    throw new Error('trackScopeValue is required for scoped track grants');
  }
  const result = await db.query(
    `SELECT tag_value AS value,
            MIN(display_name) AS label
     FROM project_access_tags
     WHERE tag_type = $1
       AND tag_value = $2
     GROUP BY tag_value
     LIMIT 1`,
    [trackScopeType, trackScopeValue]
  );
  if (result.rowCount === 0) {
    throw new Error('Selected track scope was not found');
  }
  return {
    trackScopeType,
    trackScopeValue,
    trackScopeLabel: result.rows[0].label || trackScopeValue,
  };
}

async function resolveGrantPayload(input, db = pool) {
  const capability = normalizeCapability(
    input?.capability
    ?? (input?.accessLevel === ACCESS_LEVEL_WRITE ? CAPABILITY_PROJECT_MANAGER : CAPABILITY_PROJECT_READ)
  );
  const projectTarget = await resolveProjectTargetPayload(input, capability, db);
  const showTarget = await resolveShowTargetPayload(input, db);
  const trackScope = await resolveTrackScopePayload(input, capability, db);
  return {
    capability,
    ...projectTarget,
    ...showTarget,
    ...trackScope,
  };
}

export async function listUserDirectGrants(userId, db = pool) {
  const result = await db.query(
    `SELECT id,
            role_id,
            user_id,
            capability,
            project_target_type,
            project_target_project_id,
            project_target_value,
            project_target_label,
            show_target_type,
            show_target_show_id,
            show_target_label,
            track_scope_type,
            track_scope_value,
            track_scope_label,
            granted_by,
            created_at,
            updated_at
     FROM rbac_grants
     WHERE user_id = $1
     ORDER BY capability ASC, project_target_label ASC, created_at ASC`,
    [userId]
  );
  return result.rows.map(serializeGrantRow);
}

export async function listRoleGrants(roleId, db = pool) {
  const result = await db.query(
    `SELECT id,
            role_id,
            user_id,
            capability,
            project_target_type,
            project_target_project_id,
            project_target_value,
            project_target_label,
            show_target_type,
            show_target_show_id,
            show_target_label,
            track_scope_type,
            track_scope_value,
            track_scope_label,
            granted_by,
            created_at,
            updated_at
     FROM rbac_grants
     WHERE role_id = $1
     ORDER BY capability ASC, project_target_label ASC, created_at ASC`,
    [roleId]
  );
  return result.rows.map(serializeGrantRow);
}

export async function listRoleInheritedGrants(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (role.isSystem) return [];
  const result = await db.query(
    `WITH RECURSIVE ancestors(role_id, depth) AS (
       SELECT parent_role_id, 1
       FROM rbac_role_inheritance
       WHERE role_id = $1
       UNION
       SELECT ri.parent_role_id, a.depth + 1
       FROM rbac_role_inheritance ri
       JOIN ancestors a
         ON ri.role_id = a.role_id
     )
     SELECT DISTINCT ON (g.id)
            g.id,
            g.role_id,
            g.user_id,
            g.capability,
            g.project_target_type,
            g.project_target_project_id,
            g.project_target_value,
            g.project_target_label,
            g.show_target_type,
            g.show_target_show_id,
            g.show_target_label,
            g.track_scope_type,
            g.track_scope_value,
            g.track_scope_label,
            g.granted_by,
            g.created_at,
            g.updated_at,
            'inherited' AS "sourceType",
            r.id AS "sourceRoleId",
            r.name AS "sourceRoleName"
     FROM ancestors a
     JOIN rbac_grants g
       ON g.role_id = a.role_id
     JOIN rbac_roles r
       ON r.id = g.role_id
     ORDER BY g.id, a.depth ASC, r.name ASC`,
    [roleId]
  );
  return result.rows.map(serializeGrantRow);
}

async function upsertGrantForPrincipal(principalField, principalId, input, actorUserId = null, db = pool) {
  const resolved = await resolveGrantPayload(input, db);
  const existing = await db.query(
    `SELECT id
     FROM rbac_grants
     WHERE ${principalField} = $1
       AND capability = $2
       AND COALESCE(project_target_type, '') = COALESCE($3, '')
       AND COALESCE(project_target_project_id, '') = COALESCE($4, '')
       AND COALESCE(project_target_value, '') = COALESCE($5, '')
       AND COALESCE(show_target_type, '') = COALESCE($6, '')
       AND COALESCE(show_target_show_id, '') = COALESCE($7, '')
       AND COALESCE(track_scope_type, '') = COALESCE($8, '')
       AND COALESCE(track_scope_value, '') = COALESCE($9, '')
     LIMIT 1`,
    [
      principalId,
      resolved.capability,
      resolved.projectTargetType,
      resolved.projectTargetProjectId,
      resolved.projectTargetValue,
      resolved.showTargetType,
      resolved.showTargetShowId,
      resolved.trackScopeType,
      resolved.trackScopeValue,
    ]
  );

  if (existing.rowCount > 0) {
    await db.query(
      `UPDATE rbac_grants
       SET project_target_label = $2,
           show_target_label = $3,
           track_scope_label = $4,
           granted_by = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, resolved.projectTargetLabel, resolved.showTargetLabel, resolved.trackScopeLabel, actorUserId]
    );
    const updated = await db.query(
      `SELECT id,
              role_id,
              user_id,
              capability,
              project_target_type,
              project_target_project_id,
              project_target_value,
              project_target_label,
              show_target_type,
              show_target_show_id,
              show_target_label,
              track_scope_type,
              track_scope_value,
              track_scope_label,
              granted_by,
              created_at,
              updated_at
       FROM rbac_grants
       WHERE id = $1`,
      [existing.rows[0].id]
    );
    return serializeGrantRow(updated.rows[0]);
  }

  const id = randomUUID();
  const columns = principalField === 'role_id'
    ? ['id', 'role_id', 'capability', 'project_target_type', 'project_target_project_id', 'project_target_value', 'project_target_label', 'show_target_type', 'show_target_show_id', 'show_target_label', 'track_scope_type', 'track_scope_value', 'track_scope_label', 'granted_by']
    : ['id', 'user_id', 'capability', 'project_target_type', 'project_target_project_id', 'project_target_value', 'project_target_label', 'show_target_type', 'show_target_show_id', 'show_target_label', 'track_scope_type', 'track_scope_value', 'track_scope_label', 'granted_by'];
  const values = principalField === 'role_id'
    ? [id, principalId, resolved.capability, resolved.projectTargetType, resolved.projectTargetProjectId, resolved.projectTargetValue, resolved.projectTargetLabel, resolved.showTargetType, resolved.showTargetShowId, resolved.showTargetLabel, resolved.trackScopeType, resolved.trackScopeValue, resolved.trackScopeLabel, actorUserId]
    : [id, principalId, resolved.capability, resolved.projectTargetType, resolved.projectTargetProjectId, resolved.projectTargetValue, resolved.projectTargetLabel, resolved.showTargetType, resolved.showTargetShowId, resolved.showTargetLabel, resolved.trackScopeType, resolved.trackScopeValue, resolved.trackScopeLabel, actorUserId];
  const placeholders = columns.map((_, idx) => `$${idx + 1}`);
  await db.query(
    `INSERT INTO rbac_grants(${columns.join(', ')})
     VALUES(${placeholders.join(', ')})`,
    values
  );
  return serializeGrantRow({
    id,
    [principalField === 'role_id' ? 'role_id' : 'user_id']: principalId,
    capability: resolved.capability,
    project_target_type: resolved.projectTargetType,
    project_target_project_id: resolved.projectTargetProjectId,
    project_target_value: resolved.projectTargetValue,
    project_target_label: resolved.projectTargetLabel,
    show_target_type: resolved.showTargetType,
    show_target_show_id: resolved.showTargetShowId,
    show_target_label: resolved.showTargetLabel,
    track_scope_type: resolved.trackScopeType,
    track_scope_value: resolved.trackScopeValue,
    track_scope_label: resolved.trackScopeLabel,
    granted_by: actorUserId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function upsertRoleGrant(roleId, input, actorUserId = null, db = pool) {
  await assertRoleGrantEditable(roleId, db);
  return await upsertGrantForPrincipal('role_id', roleId, input, actorUserId, db);
}

export async function upsertUserGrant(userId, input, actorUserId = null, db = pool) {
  const userResult = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (userResult.rowCount === 0) {
    throw new Error('User not found');
  }
  return await upsertGrantForPrincipal('user_id', userId, input, actorUserId, db);
}

export async function deleteGrant(grantId, db = pool) {
  const grantResult = await db.query(
    `SELECT id, role_id AS "roleId"
     FROM rbac_grants
     WHERE id = $1`,
    [grantId]
  );
  if (grantResult.rowCount === 0) {
    throw new Error('Grant not found');
  }
  if (grantResult.rows[0].roleId) {
    await assertRoleGrantEditable(grantResult.rows[0].roleId, db);
  }
  await db.query('DELETE FROM rbac_grants WHERE id = $1', [grantId]);
}

export async function syncLegacyProjectPermission(userId, projectId, { canRead, canWrite }, actorUserId = null, db = pool) {
  const write = Boolean(canWrite);
  const read = write || Boolean(canRead);
  if (!read) {
    await db.query(
      `DELETE FROM rbac_grants
       WHERE user_id = $1
         AND capability IN ($2, $3)
         AND project_target_type = $4
         AND project_target_project_id = $5`,
      [userId, CAPABILITY_PROJECT_READ, CAPABILITY_PROJECT_MANAGER, PROJECT_TARGET_PROJECT, projectId]
    );
    return null;
  }
  return await upsertUserGrant(userId, {
    capability: write ? CAPABILITY_PROJECT_MANAGER : CAPABILITY_PROJECT_READ,
    projectTargetType: PROJECT_TARGET_PROJECT,
    projectTargetProjectId: projectId,
  }, actorUserId, db);
}

function projectLevelWriteEnabled(access) {
  return Boolean(access?.canManageProject || access?.canManageOwnProject);
}

function hasTrackLevelWrite(access) {
  return Boolean(access?.canWriteOwnTracks || access?.canWriteScopedTracks || projectLevelWriteEnabled(access));
}

function snapshotTrackMap(snapshot = {}) {
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  return new Map(tracks.map((track) => [track.id, track]));
}

function snapshotGroupNodeMap(snapshot = {}) {
  const nodes = buildNormalizedTrackTree(snapshot).filter((node) => node.kind === 'group');
  return new Map(nodes.map((node) => [node.id, node]));
}

function snapshotTrackNodeMap(snapshot = {}) {
  const nodes = buildNormalizedTrackTree(snapshot).filter((node) => node.kind === 'track');
  return new Map(nodes.map((node) => [node.trackId, node]));
}

function normalizeTrackForWriteComparison(track = {}) {
  return {
    id: track.id,
    name: track.name,
    role: track.role,
    icon: track.icon,
    volume: track.volume,
    pan: track.pan,
    muted: Boolean(track.muted),
    soloed: Boolean(track.soloed),
    clips: Array.isArray(track.clips) ? track.clips.map((clip) => ({
      id: clip.id,
      blobId: clip.blobId,
      timelineStartMs: clip.timelineStartMs,
      sourceStartMs: clip.sourceStartMs,
      sourceDurationMs: clip.sourceDurationMs,
      cropStartMs: clip.cropStartMs,
      cropEndMs: clip.cropEndMs,
      gainDb: clip.gainDb,
      muted: Boolean(clip.muted),
    })) : [],
    createdByUserId: normalizeText(track.createdByUserId) || null,
    accessScopeType: TRACK_SCOPE_TYPES.includes(normalizeLowerText(track.accessScopeType))
      ? normalizeLowerText(track.accessScopeType)
      : null,
    accessScopeValue: normalizeScopeValue(track.accessScopeValue),
  };
}

function stripTrackWriteRestrictedShape(track = {}) {
  const normalized = normalizeTrackForWriteComparison(track);
  return {
    ...normalized,
    role: null,
    createdByUserId: null,
    accessScopeType: null,
    accessScopeValue: null,
  };
}

function normalizeGroupForComparison(node = {}) {
  return {
    id: node.id,
    parentId: node.parentId || null,
    order: toNumber(node.order, 0),
    name: node.name,
    collapsed: Boolean(node.collapsed),
    muted: Boolean(node.muted),
    soloed: Boolean(node.soloed),
    volume: toNumber(node.volume, 100),
    pan: toNumber(node.pan, 0),
    role: normalizeGroupRole(node.role),
  };
}

function normalizeTopLevelForRestrictedWrite(snapshot = {}) {
  return {
    projectId: snapshot.projectId,
    projectName: snapshot.projectName,
    musicalNumber: snapshot.musicalNumber,
    sampleRate: snapshot.sampleRate,
    masterVolume: snapshot.masterVolume,
    autoPan: snapshot.autoPan || null,
    exportSettings: snapshot.exportSettings || null,
    loop: snapshot.loop || null,
  };
}

function trackMatchesEditableScope(trackInfo, access) {
  if (!access?.editableTrackScopes?.length || !trackInfo) return false;
  if (trackInfo.accessScopeType && trackInfo.accessScopeValue) {
    return access.editableTrackScopes.some((scope) => (
      scope.type === trackInfo.accessScopeType
      && scope.value === trackInfo.accessScopeValue
    ));
  }
  return access.editableTrackScopes.some((scope) => {
    if (scope.type === TRACK_SCOPE_GROUP_NAME) {
      return trackInfo.derivedGroupValues?.has(scope.value) || false;
    }
    if (scope.type === TRACK_SCOPE_PART_NAME) {
      return trackInfo.derivedPartValues?.has(scope.value) || false;
    }
    return false;
  });
}

function trackIsEditable(trackInfo, access, userId, projectCreatedByUserId = null) {
  if (projectLevelWriteEnabled(access)) return true;
  if (!trackInfo) return false;
  const normalizedUserId = normalizeText(userId);
  const fallbackOwnerUserId = normalizeText(projectCreatedByUserId);
  if (access?.canWriteOwnTracks) {
    const ownerUserId = normalizeText(trackInfo.createdByUserId) || fallbackOwnerUserId;
    if (ownerUserId && ownerUserId === normalizedUserId) {
      return true;
    }
  }
  if (access?.canWriteScopedTracks && trackMatchesEditableScope(trackInfo, access)) {
    return true;
  }
  return false;
}

function chooseEditableScopeForNewTrack(track, access, inferredTrackInfo = null) {
  const explicitType = TRACK_SCOPE_TYPES.includes(normalizeLowerText(track?.accessScopeType))
    ? normalizeLowerText(track.accessScopeType)
    : null;
  const explicitValue = normalizeScopeValue(track?.accessScopeValue);

  if (explicitType && explicitValue) {
    const matching = access?.editableTrackScopes?.find((scope) => scope.type === explicitType && scope.value === explicitValue);
    if (!matching) {
      throw new Error('New track scope is not permitted for this project');
    }
    return matching;
  }

  if (inferredTrackInfo && Array.isArray(access?.editableTrackScopes) && access.editableTrackScopes.length > 0) {
    const matchingScopes = access.editableTrackScopes.filter((scope) => {
      if (scope.type === TRACK_SCOPE_GROUP_NAME) {
        return inferredTrackInfo.derivedGroupValues?.has(scope.value) || false;
      }
      if (scope.type === TRACK_SCOPE_PART_NAME) {
        return inferredTrackInfo.derivedPartValues?.has(scope.value) || false;
      }
      return false;
    });
    if (matchingScopes.length === 1) {
      return matchingScopes[0];
    }
    if (matchingScopes.length > 1) {
      throw new Error('New scoped tracks must resolve to exactly one permitted scope');
    }
  }

  if (Array.isArray(access?.editableTrackScopes) && access.editableTrackScopes.length === 1) {
    return access.editableTrackScopes[0];
  }

  if (Array.isArray(access?.editableTrackScopes) && access.editableTrackScopes.length > 1) {
    throw new Error('New scoped tracks must choose one of the permitted scopes');
  }

  return null;
}

function cloneTrackWithStampedAccess(track, { userId, scope = null }) {
  const nextTrack = {
    ...track,
    createdByUserId: normalizeText(track?.createdByUserId) || normalizeText(userId) || null,
  };
  if (scope) {
    nextTrack.accessScopeType = scope.type;
    nextTrack.accessScopeValue = scope.value;
  }
  return nextTrack;
}

export async function validateAndTransformProjectWrite({
  userId,
  project,
  access,
  currentSnapshot,
  nextSnapshot,
}) {
  if (projectLevelWriteEnabled(access)) {
    return nextSnapshot;
  }

  if (!hasTrackLevelWrite(access)) {
    throw new Error('You do not have permission to edit this project');
  }

  if (stableJson(normalizeTopLevelForRestrictedWrite(currentSnapshot)) !== stableJson(normalizeTopLevelForRestrictedWrite(nextSnapshot))) {
    throw new Error('Project-level settings require project manager access');
  }

  const currentGroupMap = snapshotGroupNodeMap(currentSnapshot);
  const nextGroupMap = snapshotGroupNodeMap(nextSnapshot);
  if (currentGroupMap.size !== nextGroupMap.size) {
    throw new Error('Group changes require project manager access');
  }
  for (const [groupId, currentGroup] of currentGroupMap.entries()) {
    const nextGroup = nextGroupMap.get(groupId);
    if (!nextGroup || stableJson(normalizeGroupForComparison(currentGroup)) !== stableJson(normalizeGroupForComparison(nextGroup))) {
      throw new Error('Group changes require project manager access');
    }
  }

  const currentTracks = snapshotTrackMap(currentSnapshot);
  const nextTracks = snapshotTrackMap(nextSnapshot);
  const currentTrackNodes = snapshotTrackNodeMap(currentSnapshot);
  const nextTrackNodes = snapshotTrackNodeMap(nextSnapshot);
  const currentTrackInfo = collectTrackBindingInfo(currentSnapshot);
  const nextTrackInfo = collectTrackBindingInfo(nextSnapshot);
  const projectCreatedByUserId = normalizeText(project?.createdByUserId || project?.created_by || '');

  const nextTracksArray = Array.isArray(nextSnapshot?.tracks) ? [...nextSnapshot.tracks] : [];
  const nextTrackIndexById = new Map(nextTracksArray.map((track, index) => [track.id, index]));

  for (const [trackId, currentTrack] of currentTracks.entries()) {
    if (!nextTracks.has(trackId)) {
      if (!trackIsEditable(currentTrackInfo.get(trackId), access, userId, projectCreatedByUserId)) {
        throw new Error('You can only delete tracks that you are allowed to edit');
      }
    }
  }

  for (const [trackId, nextTrack] of nextTracks.entries()) {
    if (!currentTracks.has(trackId)) {
      if (access?.canWriteOwnTracks) {
        nextTracksArray[nextTrackIndexById.get(trackId)] = cloneTrackWithStampedAccess(nextTrack, { userId });
      } else if (access?.canWriteScopedTracks) {
        const scope = chooseEditableScopeForNewTrack(nextTrack, access, nextTrackInfo.get(trackId) || null);
        nextTracksArray[nextTrackIndexById.get(trackId)] = cloneTrackWithStampedAccess(nextTrack, { userId, scope });
      } else {
        throw new Error('You cannot create tracks in this project');
      }
      continue;
    }

    const editable = trackIsEditable(currentTrackInfo.get(trackId), access, userId, projectCreatedByUserId);
    if (stableJson(normalizeTrackForWriteComparison(currentTrack)) === stableJson(normalizeTrackForWriteComparison(nextTrack))) {
      continue;
    }
    if (!editable) {
      throw new Error('You can only edit tracks that you are allowed to edit');
    }
    if (stableJson(stripTrackWriteRestrictedShape(currentTrack)) !== stableJson(stripTrackWriteRestrictedShape(nextTrack))) {
      throw new Error('Track role and scope changes require project manager access');
    }
  }

  for (const [trackId, currentNode] of currentTrackNodes.entries()) {
    const nextNode = nextTrackNodes.get(trackId);
    if (!nextNode) continue;
    if (currentNode.parentId === nextNode.parentId && toNumber(currentNode.order, 0) === toNumber(nextNode.order, 0)) {
      continue;
    }
    if (!trackIsEditable(currentTrackInfo.get(trackId), access, userId, projectCreatedByUserId)) {
      throw new Error('You can only move tracks that you are allowed to edit');
    }
    if ((currentNode.parentId || null) !== (nextNode.parentId || null)) {
      const nextInfo = nextTrackInfo.get(trackId) || currentTrackInfo.get(trackId);
      if (!access?.canWriteScopedTracks) {
        throw new Error('Moving tracks between groups requires project manager access');
      }
      if (nextInfo?.accessScopeType === TRACK_SCOPE_GROUP_NAME) {
        const nextGroupMapForMove = snapshotGroupNodeMap(nextSnapshot);
        const nextParentGroup = nextNode.parentId ? nextGroupMapForMove.get(nextNode.parentId) : null;
        const nextParentGroupValue = normalizeScopeValue(nextParentGroup?.name);
        if (!nextParentGroupValue || nextParentGroupValue !== nextInfo.accessScopeValue) {
          throw new Error('Moving this track would break its allowed scope');
        }
      } else {
        throw new Error('Moving tracks between groups requires project manager access');
      }
    }
  }

  return {
    ...nextSnapshot,
    tracks: nextTracksArray,
  };
}

export function canUserMutateTrack({ access, track, trackInfoById, userId, projectCreatedByUserId = null }) {
  const trackInfo = trackInfoById?.get(track?.id) || null;
  return trackIsEditable(trackInfo, access, userId, projectCreatedByUserId);
}

export function getEditableTrackScopeChoices(access = null) {
  return Array.isArray(access?.editableTrackScopes) ? access.editableTrackScopes : [];
}

export function buildTrackAccessInfoMap(snapshot = {}) {
  return collectTrackBindingInfo(snapshot);
}

export async function canCreateProjectsInShow(userId, showId, db = pool) {
  const isAdmin = await userHasAdminRole(userId, db);
  if (isAdmin) return true;
  const grants = await listResolvedGrantsForUser(userId, db);
  return grants.some((grant) => (
    grant.capability === CAPABILITY_MANAGE_OWN_PROJECTS
    && grantMatchesShow(grant, showId)
  ));
}

export async function getUserAccessSummary(userId, db = pool) {
  await ensureDefaultUserRoleMembership(userId, db);
  const defaultRole = await getDefaultUserRole(db);
  const defaultRoleGrantCountResult = defaultRole
    ? await db.query(
      `SELECT COUNT(*)::integer AS "count"
       FROM rbac_grants
       WHERE role_id = $1`,
      [defaultRole.id]
    )
    : { rows: [{ count: 0 }] };
  const defaultRoleHasGrants = Number(defaultRoleGrantCountResult.rows?.[0]?.count || 0) > 0;
  const emptyAccessMessage = normalizeText(defaultRole?.emptyAccessMessage) || DEFAULT_EMPTY_ACCESS_MESSAGE;
  const isAdmin = await userHasAdminRole(userId, db);
  const grants = await listResolvedGrantsForUser(userId, db);
  const canCreateProjects = isAdmin || grants.some((grant) => grant.capability === CAPABILITY_MANAGE_OWN_PROJECTS);

  const projectRowsResult = await db.query(
    `SELECT p.id,
            p.created_by AS "createdByUserId",
            p.show_id AS "showId",
            s.name AS "showName"
     FROM projects p
     LEFT JOIN shows s
       ON s.id = p.show_id`
  );
  const accessMap = await getProjectAccessMap(userId, projectRowsResult.rows, db);
  const hasProjectAccess = Array.from(accessMap.values()).some((access) => (
    access.canListenTutti
    || access.canReadProject
    || access.canManageOwnProject
    || access.canManageProject
  ));

  const hasAnyAccess = Boolean(isAdmin || canCreateProjects || hasProjectAccess);
  return {
    hasAnyAccess,
    showNoAccessMessage: !hasAnyAccess,
    emptyAccessMessage,
    defaultRoleHasGrants,
    canCreateProjects,
  };
}
