import { randomUUID } from 'crypto';
import { config } from './config.js';
import { pool } from './db.js';
import { describeOidcBootstrapRule, matchesOidcBootstrapRule } from './oidcBootstrap.js';
import {
  addRoleMember,
  applyOidcRoleLinksForUser,
  assertUserCanLoseAdminRole,
  countActiveAdminUsers,
  SYSTEM_ROLE_ADMIN_KEY,
  SYSTEM_ROLE_DEFAULT_USER_KEY,
  ensureDefaultUserRoleMembership,
} from './rbac.js';

function buildUserSelectSql(alias = 'u') {
  return `${alias}.id,
          ${alias}.username,
          ${alias}.artist_display_name,
          ${alias}.artist_description,
          ${alias}.password_hash,
          EXISTS(
            SELECT 1
            FROM rbac_role_memberships rm
            JOIN rbac_roles r
              ON r.id = rm.role_id
            WHERE rm.user_id = ${alias}.id
              AND r.system_key = '${SYSTEM_ROLE_ADMIN_KEY}'
          ) AS is_admin,
          ${alias}.is_active,
          ${alias}.oidc_issuer,
          ${alias}.oidc_subject,
          ${alias}.oidc_email,
          ${alias}.oidc_display_name,
          ${alias}.created_at,
          ${alias}.updated_at`;
}

function sanitizeUsernameCandidate(value, fallback = 'user') {
  const normalized = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/@/g, '.')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/[-._]{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');

  return normalized || fallback;
}

function baseUsernameFromClaims(claims) {
  return sanitizeUsernameCandidate(
    claims?.preferredUsername
    || claims?.email?.split('@')[0]
    || claims?.displayName
    || claims?.subject
    || 'user'
  );
}

async function generateUniqueUsername(baseCandidate, excludeUserId = null, db = pool) {
  const base = sanitizeUsernameCandidate(baseCandidate);

  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const result = await db.query(
      `SELECT id
       FROM users
       WHERE username = $1
         AND ($2::text IS NULL OR id <> $2)
       LIMIT 1`,
      [candidate, excludeUserId]
    );
    if (result.rowCount === 0) {
      return candidate;
    }
  }

  throw new Error('Failed to derive a unique username for the OIDC user');
}

function mapAdminUserRow(row) {
  const hasPassword = Boolean(row.password_hash);
  const oidcLinked = Boolean(row.oidc_subject && row.oidc_issuer);
  return {
    id: row.id,
    username: row.username,
    artistDisplayName: row.artist_display_name || '',
    artistDescription: row.artist_description || '',
    isAdmin: Boolean(row.is_admin),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authSource: oidcLinked && hasPassword ? 'hybrid' : (oidcLinked ? 'oidc' : 'local'),
    hasPassword,
    oidcLinked,
    oidcIssuer: row.oidc_issuer || '',
    oidcEmail: row.oidc_email || '',
    oidcDisplayName: row.oidc_display_name || '',
    pendingOidc: oidcLinked && !row.is_active,
    roleCount: Number(row.role_count || 0),
    roles: Array.isArray(row.roles)
      ? row.roles.map((role) => ({
        id: role.id,
        name: role.name,
        isSystem: Boolean(role.isSystem),
        systemKey: role.systemKey || '',
      }))
      : [],
  };
}

export async function listUsersWithAuthDetails() {
  const result = await pool.query(
    `SELECT ${buildUserSelectSql('u')},
            (
              SELECT COUNT(*)::integer
              FROM rbac_role_memberships rm
              JOIN rbac_roles r
                ON r.id = rm.role_id
              WHERE rm.user_id = u.id
                AND r.system_key IS DISTINCT FROM '${SYSTEM_ROLE_DEFAULT_USER_KEY}'
            ) AS role_count,
            (
              SELECT COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'id', r.id,
                    'name', r.name,
                    'isSystem', r.is_system,
                    'systemKey', COALESCE(r.system_key, '')
                  )
                  ORDER BY r.is_system DESC, r.name ASC
                ),
                '[]'::jsonb
              )
              FROM rbac_role_memberships rm
              JOIN rbac_roles r
                ON r.id = rm.role_id
              WHERE rm.user_id = u.id
                AND r.system_key IS DISTINCT FROM '${SYSTEM_ROLE_DEFAULT_USER_KEY}'
            ) AS roles
     FROM users u
     ORDER BY username ASC`
  );
  return result.rows.map(mapAdminUserRow);
}

export async function findUserById(userId, db = pool) {
  const result = await db.query(
    `SELECT ${buildUserSelectSql('u')}
     FROM users u
     WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function findUserByOidcIdentity(issuer, subject, db = pool) {
  const result = await db.query(
    `SELECT ${buildUserSelectSql('u')}
     FROM users u
     WHERE oidc_issuer = $1 AND oidc_subject = $2`,
    [issuer, subject]
  );
  return result.rows[0] || null;
}

export async function touchUserLogin(userId) {
  await pool.query(
    `UPDATE users
     SET last_login_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );
}

export async function updateOidcProfile(userId, { email = '', displayName = '' }, db = pool) {
  await db.query(
    `UPDATE users
     SET oidc_email = $2,
         oidc_display_name = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, email || null, displayName || null]
  );
}

function normalizeArtistDisplayName(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length > 120) {
    throw new Error('Artist display name must be 120 characters or fewer');
  }
  return normalized || null;
}

function normalizeArtistDescription(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length > 2000) {
    throw new Error('Artist description must be 2000 characters or fewer');
  }
  return normalized || null;
}

export async function updateUserProfile(userId, { artistDisplayName = '', artistDescription = undefined }, db = pool) {
  const normalizedArtistDisplayName = normalizeArtistDisplayName(artistDisplayName);
  const shouldUpdateDescription = artistDescription !== undefined;
  const normalizedArtistDescription = shouldUpdateDescription
    ? normalizeArtistDescription(artistDescription)
    : null;
  const result = await db.query(
    `UPDATE users
     SET artist_display_name = $2,
         artist_description = CASE WHEN $3::boolean THEN $4::text ELSE artist_description END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING ${buildUserSelectSql('users')}`,
    [userId, normalizedArtistDisplayName, shouldUpdateDescription, normalizedArtistDescription]
  );
  return result.rows[0] || null;
}

function matchesInitialAdminClaim(claims) {
  return matchesOidcBootstrapRule(claims?.rawClaims || {}, config.oidcFirstAdminClaim);
}

function buildInitialAdminClaimError() {
  return `The first Apollo admin must match OIDC_FIRST_ADMIN_CLAIM (${describeOidcBootstrapRule(config.oidcFirstAdminClaim)})`;
}

async function promoteUserToInitialAdmin(userId, db = pool) {
  await db.query(
    `UPDATE users
     SET is_admin = TRUE,
         is_active = TRUE,
         updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );
  await ensureDefaultUserRoleMembership(userId, db);
  await addRoleMember('system-role-admin', userId, null, db);
}

export async function findOrCreateOidcUser(claims) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');

    const existing = await findUserByOidcIdentity(claims.issuer, claims.subject, client);
    const hasAdmin = (await countActiveAdminUsers(client)) > 0;

    console.log('[OIDC] Resolving local user', {
      issuer: claims.issuer,
      subject: claims.subject,
      email: claims.email || null,
      hasAdmin,
      existingUserId: existing?.id || null,
    });

    if (!hasAdmin && !matchesInitialAdminClaim(claims)) {
      throw new Error(buildInitialAdminClaimError());
    }

    if (existing) {
      await ensureDefaultUserRoleMembership(existing.id, client);
      await applyOidcRoleLinksForUser(existing.id, claims.rawClaims || {}, client);
      await updateOidcProfile(existing.id, {
        email: claims.email,
        displayName: claims.displayName,
      }, client);

      if (!hasAdmin) {
        await promoteUserToInitialAdmin(existing.id, client);
      }

      await client.query('COMMIT');
      const resolvedUser = await findUserById(existing.id);
      if (!resolvedUser) {
        throw new Error('OIDC login matched an existing user but could not load it back from the database');
      }
      console.log('[OIDC] Matched existing local user', {
        userId: resolvedUser.id,
        isActive: Boolean(resolvedUser.is_active),
        isAdmin: Boolean(resolvedUser.is_admin),
      });
      return resolvedUser;
    }

    const username = await generateUniqueUsername(baseUsernameFromClaims(claims), null, client);
    const id = randomUUID();
    const shouldBootstrapInitialAdmin = !hasAdmin;

    await client.query(
      `INSERT INTO users(
         id,
         username,
         password_hash,
         is_admin,
         is_active,
         oidc_issuer,
         oidc_subject,
         oidc_email,
         oidc_display_name
       )
       VALUES($1, $2, NULL, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        username,
        shouldBootstrapInitialAdmin,
        true,
        claims.issuer,
        claims.subject,
        claims.email || null,
        claims.displayName || null,
      ]
    );

    await ensureDefaultUserRoleMembership(id, client);
    await applyOidcRoleLinksForUser(id, claims.rawClaims || {}, client);
    if (shouldBootstrapInitialAdmin) {
      await addRoleMember('system-role-admin', id, null, client);
    }

    await client.query('COMMIT');
    const createdUser = await findUserById(id);
    if (!createdUser) {
      throw new Error('OIDC login inserted a local user row but could not load it back from the database');
    }
    console.log('[OIDC] Created local user', {
      userId: createdUser.id,
      username: createdUser.username,
      isActive: Boolean(createdUser.is_active),
      isAdmin: Boolean(createdUser.is_admin),
    });
    return createdUser;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function linkPendingOidcIdentityToUser({ sourceUserId, targetUserId }) {
  if (!sourceUserId || !targetUserId) {
    throw new Error('Both sourceUserId and targetUserId are required');
  }
  if (String(sourceUserId) === String(targetUserId)) {
    throw new Error('Source and target users must be different');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pendingResult = await client.query(
      `SELECT id,
              username,
              is_active,
              oidc_issuer,
              oidc_subject,
              oidc_email,
              oidc_display_name
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [sourceUserId]
    );
    const targetResult = await client.query(
      `SELECT id,
              oidc_issuer,
              oidc_subject
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [targetUserId]
    );

    const pending = pendingResult.rows[0];
    const target = targetResult.rows[0];

    if (!pending) {
      throw new Error('Pending OIDC user not found');
    }
    if (!target) {
      throw new Error('Target user not found');
    }
    if (!pending.oidc_issuer || !pending.oidc_subject) {
      throw new Error('Source user is not an OIDC-linked user');
    }
    if (pending.is_active) {
      throw new Error('Only inactive pending OIDC users can be linked');
    }
    if (target.oidc_issuer && target.oidc_subject) {
      throw new Error('Target user already has an OIDC identity linked');
    }

    await client.query(
      `UPDATE users
       SET oidc_issuer = $2,
           oidc_subject = $3,
           oidc_email = $4,
           oidc_display_name = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [
        targetUserId,
        pending.oidc_issuer,
        pending.oidc_subject,
        pending.oidc_email || null,
        pending.oidc_display_name || null,
      ]
    );

    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [sourceUserId]);
    await client.query('DELETE FROM users WHERE id = $1', [sourceUserId]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return await findUserById(targetUserId);
}

async function assertTransferUsers(sourceUserId, targetUserId, db = pool) {
  const normalizedSourceUserId = String(sourceUserId || '').trim();
  const normalizedTargetUserId = String(targetUserId || '').trim();
  if (!normalizedSourceUserId || !normalizedTargetUserId) {
    throw new Error('Both source and target users are required');
  }
  if (normalizedSourceUserId === normalizedTargetUserId) {
    throw new Error('Source and target users must be different');
  }

  const result = await db.query(
    `SELECT id, username
     FROM users
     WHERE id = ANY($1::text[])
     FOR UPDATE`,
    [[normalizedSourceUserId, normalizedTargetUserId]]
  );
  const usersById = new Map(result.rows.map((row) => [row.id, row]));
  if (!usersById.has(normalizedSourceUserId)) {
    throw new Error('Source user not found');
  }
  if (!usersById.has(normalizedTargetUserId)) {
    throw new Error('Target user not found');
  }
  return {
    sourceUser: usersById.get(normalizedSourceUserId),
    targetUser: usersById.get(normalizedTargetUserId),
  };
}

export async function transferUserOwnership({ sourceUserId, targetUserId }, db = pool) {
  const client = db === pool ? await pool.connect() : db;
  const release = db === pool;
  const counts = {};

  try {
    if (release) await client.query('BEGIN');
    const { targetUser } = await assertTransferUsers(sourceUserId, targetUserId, client);

    const updateCount = async (key, sql, values = [targetUserId, sourceUserId]) => {
      const result = await client.query(sql, values);
      counts[key] = result.rowCount;
    };

    await updateCount('shows', 'UPDATE shows SET created_by = $1 WHERE created_by = $2');
    await updateCount('projects', 'UPDATE projects SET created_by = $1 WHERE created_by = $2');
    await updateCount('playerFolders', 'UPDATE player_folders SET owner_user_id = $1, updated_at = NOW() WHERE owner_user_id = $2');
    await updateCount('virtualMixes', 'UPDATE virtual_mixes SET owner_user_id = $1, updated_at = NOW() WHERE owner_user_id = $2');
    await updateCount('playerPlaylists', 'UPDATE player_playlists SET owner_user_id = $1, updated_at = NOW() WHERE owner_user_id = $2');
    await updateCount(
      'recordLocks',
      'UPDATE record_locks SET owner_user_id = $1, owner_name = $3, updated_at = NOW() WHERE owner_user_id = $2',
      [targetUserId, sourceUserId, targetUser.username]
    );
    await updateCount('mediaObjects', 'UPDATE media_objects SET created_by = $1 WHERE created_by = $2');
    await updateCount('projectSnapshots', 'UPDATE project_snapshots SET created_by = $1 WHERE created_by = $2');
    await updateCount('projectOps', 'UPDATE project_ops SET user_id = $1 WHERE user_id = $2');
    await updateCount('projectPermissionsGranted', 'UPDATE project_permissions SET granted_by = $1 WHERE granted_by = $2');
    await updateCount('rbacRolesCreated', 'UPDATE rbac_roles SET created_by = $1 WHERE created_by = $2');
    await updateCount('rbacMembershipsAdded', 'UPDATE rbac_role_memberships SET added_by = $1 WHERE added_by = $2');
    await updateCount('rbacGrantsGranted', 'UPDATE rbac_grants SET granted_by = $1 WHERE granted_by = $2');
    await updateCount('rbacOidcLinksCreated', 'UPDATE rbac_role_oidc_links SET created_by = $1 WHERE created_by = $2');

    if (release) await client.query('COMMIT');
    return counts;
  } catch (error) {
    if (release) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (release) client.release();
  }
}

export async function deleteUserAccount({ userId, transferToUserId, actorUserId }) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedTransferToUserId = String(transferToUserId || '').trim();
  if (!normalizedUserId) {
    throw new Error('User id is required');
  }
  if (!normalizedTransferToUserId) {
    throw new Error('Ownership transfer target is required');
  }
  if (String(actorUserId || '') === normalizedUserId) {
    throw new Error('You cannot delete your own user');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await transferUserOwnership({
      sourceUserId: normalizedUserId,
      targetUserId: normalizedTransferToUserId,
    }, client);
    await assertUserCanLoseAdminRole(normalizedUserId, client);
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [normalizedUserId]);
    const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [normalizedUserId]);
    if (result.rowCount === 0) {
      throw new Error('User not found');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function toAdminUser(userRow) {
  return userRow ? mapAdminUserRow(userRow) : null;
}
