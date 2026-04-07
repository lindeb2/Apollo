import { randomUUID } from 'crypto';
import { config } from './config.js';
import { pool } from './db.js';
import { describeOidcBootstrapRule, matchesOidcBootstrapRule } from './oidcBootstrap.js';

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
  };
}

export async function listUsersWithAuthDetails() {
  const result = await pool.query(
    `SELECT id,
            username,
            password_hash,
            is_admin,
            is_active,
            oidc_issuer,
            oidc_subject,
            oidc_email,
            oidc_display_name,
            created_at,
            updated_at
     FROM users
     ORDER BY username ASC`
  );
  return result.rows.map(mapAdminUserRow);
}

export async function findUserById(userId, db = pool) {
  const result = await db.query(
    `SELECT id,
            username,
            password_hash,
            is_admin,
            is_active,
            oidc_issuer,
            oidc_subject,
            oidc_email,
            oidc_display_name,
            created_at,
            updated_at
     FROM users
     WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function findUserByOidcIdentity(issuer, subject, db = pool) {
  const result = await db.query(
    `SELECT id,
            username,
            password_hash,
            is_admin,
            is_active,
            oidc_issuer,
            oidc_subject,
            oidc_email,
            oidc_display_name,
            created_at,
            updated_at
     FROM users
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
}

export async function findOrCreateOidcUser(claims) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');

    const existing = await findUserByOidcIdentity(claims.issuer, claims.subject, client);
    const adminResult = await client.query(
      `SELECT EXISTS(
         SELECT 1
         FROM users
         WHERE is_admin = TRUE
       ) AS "hasAdmin"`
    );
    const hasAdmin = Boolean(adminResult.rows[0]?.hasAdmin);

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
        shouldBootstrapInitialAdmin,
        claims.issuer,
        claims.subject,
        claims.email || null,
        claims.displayName || null,
      ]
    );

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

export function toAdminUser(userRow) {
  return userRow ? mapAdminUserRow(userRow) : null;
}
