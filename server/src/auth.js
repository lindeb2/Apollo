import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';
import { getAccessTokenCookie } from './sessionCookies.js';

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      isAdmin: Boolean(user.is_admin),
    },
    config.jwtAccessSecret,
    { expiresIn: config.accessTokenTtl }
  );
}

export function signRefreshToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      isAdmin: Boolean(user.is_admin),
      type: 'refresh',
    },
    config.jwtRefreshSecret,
    { expiresIn: `${config.refreshTokenTtlDays}d` }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtAccessSecret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwtRefreshSecret);
}

export async function persistRefreshToken(token, userId) {
  await pool.query(
    `INSERT INTO refresh_tokens(token, user_id, expires_at)
     VALUES($1, $2, NOW() + ($3 || ' days')::INTERVAL)
     ON CONFLICT (token) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         expires_at = EXCLUDED.expires_at`,
    [token, userId, String(config.refreshTokenTtlDays)]
  );
}

export async function revokeRefreshToken(token) {
  await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
}

export async function isRefreshTokenPersisted(token) {
  const result = await pool.query(
    'SELECT token FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
    [token]
  );
  return result.rowCount > 0;
}

export function parseBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export function getAccessTokenFromRequest(req) {
  return parseBearerToken(req) || getAccessTokenCookie(req) || null;
}

function toAuthenticatedUser(payload) {
  return {
    id: payload.sub,
    username: payload.username,
    isAdmin: Boolean(payload.isAdmin),
  };
}

export function tryAuthenticateRequest(req) {
  const token = getAccessTokenFromRequest(req);
  if (!token) return null;
  try {
    const payload = verifyAccessToken(token);
    return toAuthenticatedUser(payload);
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const token = getAccessTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Missing access token' });
    return;
  }
  const user = tryAuthenticateRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired access token' });
    return;
  }
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  next();
}

export async function requireProjectPermission(req, res, permission = 'read') {
  const projectId = req.params.id || req.params.projectId;
  if (!projectId) {
    res.status(400).json({ error: 'Missing project id' });
    return null;
  }
  if (req.user?.isAdmin) {
    return { projectId, canRead: true, canWrite: true };
  }

  const result = await pool.query(
    `SELECT can_read, can_write
     FROM project_permissions
     WHERE project_id = $1 AND user_id = $2`,
    [projectId, req.user.id]
  );

  const row = result.rows[0];
  const canRead = Boolean(row?.can_read);
  const canWrite = Boolean(row?.can_write);

  if (permission === 'read' && !canRead) {
    res.status(403).json({ error: 'No read permission for this project' });
    return null;
  }
  if (permission === 'write' && !canWrite) {
    res.status(403).json({ error: 'No write permission for this project' });
    return null;
  }

  return { projectId, canRead, canWrite };
}

export async function getProjectPermission(userId, projectId, isAdmin = false) {
  if (isAdmin) return { canRead: true, canWrite: true };
  const result = await pool.query(
    `SELECT can_read, can_write
     FROM project_permissions
     WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId]
  );
  if (result.rowCount === 0) return { canRead: false, canWrite: false };
  return {
    canRead: Boolean(result.rows[0].can_read),
    canWrite: Boolean(result.rows[0].can_write),
  };
}
