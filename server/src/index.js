import fs from 'fs/promises';
import fssync from 'fs';
import { randomUUID } from 'crypto';
import http from 'http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';
import bcrypt from 'bcryptjs';

import { config } from './config.js';
import { buildStoredMediaPath, resolveMediaPath } from './mediaPaths.js';
import { pool, runMigrations, ensureDefaultAdmin, closeDb } from './db.js';
import {
  authenticateCredentials,
  getProjectPermission,
  isRefreshTokenPersisted,
  persistRefreshToken,
  requireAdmin,
  requireAuth,
  requireProjectPermission,
  revokeRefreshToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './auth.js';

const app = express();
const server = http.createServer(app);
const wsServer = new WebSocketServer({ noServer: true });

const clients = new Set();
const projectRooms = new Map();

function nowIso() {
  return new Date().toISOString();
}

function toSafeName(name, fallback = 'file') {
  return (name || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function normalizeMusicalNumber(value) {
  return String(value || '').trim();
}

function isValidMusicalNumber(value) {
  return /^[0-9]+\..+$/.test(normalizeMusicalNumber(value));
}

function normalizeSceneOrder(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return NaN;
  return numeric;
}

function parseMusicalNumberSegments(value) {
  return normalizeMusicalNumber(value)
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function classifyMusicalToken(token) {
  if (/^dk$/i.test(token)) return 0;
  if (/^\d+$/.test(token)) return 1;
  return 2;
}

function compareMusicalNumbers(leftRaw, rightRaw) {
  const left = parseMusicalNumberSegments(leftRaw);
  const right = parseMusicalNumberSegments(rightRaw);
  const leftMajor = Number.parseInt(left[0] || '0', 10);
  const rightMajor = Number.parseInt(right[0] || '0', 10);

  if (leftMajor !== rightMajor) return leftMajor - rightMajor;

  const maxParts = Math.max(left.length, right.length);
  for (let i = 1; i < maxParts; i += 1) {
    const leftPart = left[i];
    const rightPart = right[i];

    if (leftPart == null && rightPart == null) return 0;
    if (leftPart == null) return -1;
    if (rightPart == null) return 1;

    const leftKind = classifyMusicalToken(leftPart);
    const rightKind = classifyMusicalToken(rightPart);
    if (leftKind !== rightKind) return leftKind - rightKind;

    if (leftKind === 1) {
      const leftNumber = Number.parseInt(leftPart, 10);
      const rightNumber = Number.parseInt(rightPart, 10);
      if (leftNumber !== rightNumber) return leftNumber - rightNumber;
      continue;
    }

    const textCompare = leftPart.localeCompare(rightPart, undefined, {
      sensitivity: 'base',
      numeric: true,
    });
    if (textCompare !== 0) return textCompare;
  }

  return 0;
}

function compareProjectsByMusicalOrder(left, right) {
  const musicalCompare = compareMusicalNumbers(left?.musicalNumber, right?.musicalNumber);
  if (musicalCompare !== 0) return musicalCompare;

  // Optional explicit per-scene order inside same X.* bucket.
  const leftSceneOrder = normalizeSceneOrder(left?.sceneOrder);
  const rightSceneOrder = normalizeSceneOrder(right?.sceneOrder);
  const leftHasSceneOrder = Number.isFinite(leftSceneOrder);
  const rightHasSceneOrder = Number.isFinite(rightSceneOrder);

  if (leftHasSceneOrder && rightHasSceneOrder && leftSceneOrder !== rightSceneOrder) {
    return leftSceneOrder - rightSceneOrder;
  }
  if (leftHasSceneOrder && !rightHasSceneOrder) return -1;
  if (!leftHasSceneOrder && rightHasSceneOrder) return 1;

  const nameCompare = String(left?.name || '').localeCompare(String(right?.name || ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  if (nameCompare !== 0) return nameCompare;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

async function ensureMediaRoot() {
  await fs.mkdir(config.mediaRoot, { recursive: true });
}

function roomFor(projectId) {
  if (!projectRooms.has(projectId)) {
    projectRooms.set(projectId, new Set());
  }
  return projectRooms.get(projectId);
}

function sendWs(ws, type, payload = {}) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcastToProject(projectId, type, payload = {}, excludeWs = null) {
  const room = roomFor(projectId);
  room.forEach((ws) => {
    if (excludeWs && ws === excludeWs) return;
    sendWs(ws, type, payload);
  });
}

async function applyOpToSnapshot(currentSnapshot, op) {
  if (!op || typeof op !== 'object') return currentSnapshot;
  if (op.type === 'project.replace' && op.project && typeof op.project === 'object') {
    return op.project;
  }
  if (op.type === 'project.update' && op.updates && typeof op.updates === 'object') {
    return {
      ...currentSnapshot,
      ...op.updates,
    };
  }
  return currentSnapshot;
}

function collectSnapshotMediaIds(snapshot) {
  const ids = new Set();
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  tracks.forEach((track) => {
    const clips = Array.isArray(track?.clips) ? track.clips : [];
    clips.forEach((clip) => {
      const blobId = typeof clip?.blobId === 'string' ? clip.blobId : null;
      if (blobId) {
        ids.add(blobId);
      }
    });
  });
  return Array.from(ids);
}

async function appendProjectOp({ projectId, userId, clientOpId, op }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const headResult = await client.query(
      `SELECT latest_seq, latest_snapshot_json, last_checkpoint_at
       FROM project_heads
       WHERE project_id = $1
       FOR UPDATE`,
      [projectId]
    );

    if (headResult.rowCount === 0) {
      throw new Error('Project head missing');
    }

    const head = headResult.rows[0];
    const latestSeq = Number(head.latest_seq || 0);
    const maxOpSeqResult = await client.query(
      `SELECT COALESCE(MAX(server_seq), 0) AS max_op_seq
       FROM project_ops
       WHERE project_id = $1`,
      [projectId]
    );
    const maxOpSeq = Number(maxOpSeqResult.rows?.[0]?.max_op_seq || 0);
    const nextSeq = Math.max(latestSeq, maxOpSeq) + 1;
    const currentSnapshot = head.latest_snapshot_json || {};
    const nextSnapshot = await applyOpToSnapshot(currentSnapshot, op);

    const projectMetadataUpdates = [];
    const projectMetadataValues = [projectId];
    let metadataIdx = 2;
    const nextProjectName = String(nextSnapshot?.projectName || '').trim();
    const currentProjectName = String(currentSnapshot?.projectName || '').trim();
    if (nextProjectName && nextProjectName !== currentProjectName) {
      projectMetadataUpdates.push(`name = $${metadataIdx++}`);
      projectMetadataValues.push(nextProjectName);
    }

    const nextMusicalNumber = normalizeMusicalNumber(nextSnapshot?.musicalNumber || '');
    const currentMusicalNumber = normalizeMusicalNumber(currentSnapshot?.musicalNumber || '');
    if (nextMusicalNumber) {
      if (!isValidMusicalNumber(nextMusicalNumber)) {
        throw new Error('Invalid musicalNumber in operation payload');
      }
      if (nextMusicalNumber !== currentMusicalNumber) {
        projectMetadataUpdates.push(`musical_number = $${metadataIdx++}`);
        projectMetadataValues.push(nextMusicalNumber);
      }
    }

    await client.query(
      `INSERT INTO project_ops(project_id, server_seq, client_op_id, user_id, op_json)
       VALUES($1, $2, $3, $4, $5::jsonb)`,
      [projectId, nextSeq, clientOpId || null, userId, JSON.stringify(op || {})]
    );

    if (projectMetadataUpdates.length > 0) {
      await client.query(
        `UPDATE projects
         SET ${projectMetadataUpdates.join(', ')}
         WHERE id = $1`,
        projectMetadataValues
      );
    }

    const checkpointEveryMs = config.checkpointEverySeconds * 1000;
    const lastCheckpointAt = head.last_checkpoint_at ? new Date(head.last_checkpoint_at).getTime() : 0;
    const shouldCheckpoint = (nextSeq % config.checkpointEveryOps === 0)
      || (Date.now() - lastCheckpointAt >= checkpointEveryMs)
      || latestSeq === 0;

    await client.query(
      `UPDATE project_heads
       SET latest_seq = $2,
           latest_snapshot_json = $3::jsonb,
           updated_at = NOW(),
           last_checkpoint_at = CASE WHEN $4 THEN NOW() ELSE last_checkpoint_at END
       WHERE project_id = $1`,
      [projectId, nextSeq, JSON.stringify(nextSnapshot), shouldCheckpoint]
    );

    const mediaIds = collectSnapshotMediaIds(nextSnapshot);
    if (mediaIds.length > 0) {
      await client.query(
        `INSERT INTO project_media_refs(project_id, media_id, snapshot_id)
         SELECT $1, m.id, NULL
         FROM unnest($2::text[]) AS t(id)
         JOIN media_objects m ON m.id = t.id
         ON CONFLICT (project_id, media_id) DO NOTHING`,
        [projectId, mediaIds]
      );
    }

    if (shouldCheckpoint) {
      await client.query(
        `INSERT INTO project_snapshots(project_id, server_seq, snapshot_json, created_by)
         VALUES($1, $2, $3::jsonb, $4)`,
        [projectId, nextSeq, JSON.stringify(nextSnapshot), userId]
      );
    }

    await client.query('COMMIT');

    return {
      serverSeq: nextSeq,
      snapshot: nextSnapshot,
      checkpointed: shouldCheckpoint,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function fetchProjectBootstrap(projectId, knownSeq = 0) {
  const [headResult, projectResult] = await Promise.all([
    pool.query(
      `SELECT latest_seq, latest_snapshot_json
       FROM project_heads
       WHERE project_id = $1`,
      [projectId]
    ),
    pool.query(
      `SELECT id, name
       FROM projects
       WHERE id = $1`,
      [projectId]
    ),
  ]);

  if (headResult.rowCount === 0 || projectResult.rowCount === 0) {
    throw new Error('Project not found');
  }

  const head = headResult.rows[0];
  const latestSeq = Number(head.latest_seq || 0);
  const snapshot = head.latest_snapshot_json || {};

  let missingOps = [];
  const seq = Number(knownSeq || 0);
  if (seq > 0 && seq < latestSeq) {
    const opsResult = await pool.query(
      `SELECT server_seq, op_json, user_id
       FROM project_ops
       WHERE project_id = $1 AND server_seq > $2
       ORDER BY server_seq ASC
       LIMIT 5000`,
      [projectId, seq]
    );
    missingOps = opsResult.rows.map((row) => ({
      serverSeq: Number(row.server_seq),
      op: row.op_json,
      actor: { userId: row.user_id },
    }));
  }

  return {
    project: {
      id: projectResult.rows[0].id,
      name: projectResult.rows[0].name,
    },
    latestSeq,
    snapshot,
    missingOps,
  };
}

async function broadcastLockState(projectId, trackId) {
  const result = await pool.query(
    `SELECT owner_user_id, owner_name, expires_at
     FROM record_locks
     WHERE project_id = $1 AND track_id = $2`,
    [projectId, trackId]
  );

  if (result.rowCount === 0) {
    broadcastToProject(projectId, 'lock.state', {
      projectId,
      trackId,
      ownerUserId: null,
      ownerName: null,
      expiresAt: null,
    });
    return;
  }

  const row = result.rows[0];
  broadcastToProject(projectId, 'lock.state', {
    projectId,
    trackId,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    expiresAt: row.expires_at,
  });
}

async function sendProjectLockStatesToClient(projectId, ws) {
  const result = await pool.query(
    `SELECT track_id, owner_user_id, owner_name, expires_at
     FROM record_locks
     WHERE project_id = $1 AND expires_at > NOW()`,
    [projectId]
  );

  result.rows.forEach((row) => {
    sendWs(ws, 'lock.state', {
      projectId,
      trackId: row.track_id,
      ownerUserId: row.owner_user_id,
      ownerName: row.owner_name,
      expiresAt: row.expires_at,
    });
  });
}

async function cleanupExpiredLocks() {
  const result = await pool.query(
    `DELETE FROM record_locks
     WHERE expires_at < NOW()
     RETURNING project_id, track_id`
  );
  if (!result.rowCount) return;
  await Promise.all(result.rows.map((row) => broadcastLockState(row.project_id, row.track_id)));
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeOptionalText(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeOrderIndex(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) return NaN;
  return numeric;
}

function canMutateOwnedEntity(ownerUserId, user) {
  return Boolean(user?.isAdmin) || String(ownerUserId) === String(user?.id || '');
}

async function loadPlayerFolderById(folderId) {
  const result = await pool.query(
    `SELECT id,
            owner_user_id AS "ownerUserId",
            name,
            parent_folder_id AS "parentFolderId",
            order_index AS "orderIndex",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM player_folders
     WHERE id = $1`,
    [folderId]
  );
  return result.rows[0] || null;
}

async function loadVirtualMixById(mixId) {
  const result = await pool.query(
    `SELECT id,
            owner_user_id AS "ownerUserId",
            project_id AS "projectId",
            name,
            preset_id AS "presetId",
            preset_variant_key AS "presetVariantKey",
            visibility,
            folder_id AS "folderId",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            published_at AS "publishedAt"
     FROM virtual_mixes
     WHERE id = $1`,
    [mixId]
  );
  return result.rows[0] || null;
}

async function loadPlaylistById(playlistId) {
  const result = await pool.query(
    `SELECT id,
            owner_user_id AS "ownerUserId",
            name,
            folder_id AS "folderId",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM player_playlists
     WHERE id = $1`,
    [playlistId]
  );
  return result.rows[0] || null;
}

app.use(cors({
  origin: config.corsOrigin === '*' ? true : config.corsOrigin,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', now: nowIso() });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await authenticateCredentials(username, password);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    await persistRefreshToken(refreshToken, user.id);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        isAdmin: Boolean(user.is_admin),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = req.body?.refreshToken;
    if (!refreshToken) {
      res.status(400).json({ error: 'Missing refresh token' });
      return;
    }

    const persisted = await isRefreshTokenPersisted(refreshToken);
    if (!persisted) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const payload = verifyRefreshToken(refreshToken);
    const userResult = await pool.query(
      'SELECT id, username, is_admin, is_active FROM users WHERE id = $1',
      [payload.sub]
    );
    if (userResult.rowCount === 0 || !userResult.rows[0].is_active) {
      res.status(401).json({ error: 'User is not active' });
      return;
    }

    const user = userResult.rows[0];
    const newAccess = signAccessToken(user);
    const newRefresh = signRefreshToken(user);
    await revokeRefreshToken(refreshToken);
    await persistRefreshToken(newRefresh, user.id);

    res.json({
      accessToken: newAccess,
      refreshToken: newRefresh,
      user: {
        id: user.id,
        username: user.username,
        isAdmin: Boolean(user.is_admin),
      },
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const refreshToken = req.body?.refreshToken;
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to logout' });
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      isAdmin: req.user.isAdmin,
    },
  });
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const isAdmin = Boolean(req.body?.isAdmin);

    if (!username || !password || password.length < 12) {
      res.status(400).json({ error: 'Username and password (>=12 chars) are required' });
      return;
    }

    const id = randomUUID();
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users(id, username, password_hash, is_admin, is_active)
       VALUES($1, $2, $3, $4, TRUE)`,
      [id, username, hash, isAdmin]
    );

    res.status(201).json({ id, username, isAdmin });
  } catch (error) {
    if (String(error?.message || '').includes('users_username_key')) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  const result = await pool.query(
    `SELECT id, username, is_admin AS "isAdmin", is_active AS "isActive", created_at AS "createdAt"
     FROM users
     ORDER BY username ASC`
  );
  res.json({ users: result.rows });
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const updates = [];
    const values = [];
    let idx = 1;

    if (typeof req.body?.isActive === 'boolean') {
      updates.push(`is_active = $${idx++}`);
      values.push(req.body.isActive);
    }
    if (typeof req.body?.isAdmin === 'boolean') {
      updates.push(`is_admin = $${idx++}`);
      values.push(req.body.isAdmin);
    }
    if (typeof req.body?.password === 'string' && req.body.password.length > 0) {
      if (req.body.password.length < 12) {
        res.status(400).json({ error: 'Password must be at least 12 characters' });
        return;
      }
      const hash = await bcrypt.hash(req.body.password, 12);
      updates.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    if (!updates.length) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const result = await pool.query(
      `UPDATE users
       SET ${updates.join(', ')}
       WHERE id = $${idx}
       RETURNING id, username, is_admin AS "isAdmin", is_active AS "isActive"`,
      values
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.get('/api/projects', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT p.id, p.name,
            p.musical_number AS "musicalNumber",
            p.scene_order AS "sceneOrder",
            pp.can_read AS "canRead",
            pp.can_write AS "canWrite",
            ph.latest_seq AS "latestSeq",
            COALESCE(jsonb_array_length(ph.latest_snapshot_json -> 'tracks'), 0) AS "trackCount",
            ph.updated_at AS "updatedAt"
     FROM projects p
     LEFT JOIN project_permissions pp
       ON pp.project_id = p.id AND pp.user_id = $1
     LEFT JOIN project_heads ph
       ON ph.project_id = p.id
     WHERE $2::boolean = TRUE OR COALESCE(pp.can_read, FALSE) = TRUE`,
    [req.user.id, req.user.isAdmin]
  );
  const sortedProjects = [...result.rows].sort(compareProjectsByMusicalOrder);
  res.json({ projects: sortedProjects });
});

app.post('/api/projects', requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const initialSnapshot = req.body?.initialSnapshot;
    const requestedMusicalNumber = normalizeMusicalNumber(
      req.body?.musicalNumber ?? initialSnapshot?.musicalNumber ?? '0.0'
    );
    const requestedSceneOrder = normalizeSceneOrder(req.body?.sceneOrder);

    if (!name) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }
    if (!isValidMusicalNumber(requestedMusicalNumber)) {
      res.status(400).json({ error: 'Musical number must start with "<number>." (example: 2.1)' });
      return;
    }
    if (Number.isNaN(requestedSceneOrder)) {
      res.status(400).json({ error: 'sceneOrder must be an integer >= 1 when provided' });
      return;
    }

    const projectId = String(req.body?.projectId || randomUUID());
    const snapshot = initialSnapshot && typeof initialSnapshot === 'object'
      ? { ...initialSnapshot, projectId, projectName: name, musicalNumber: requestedMusicalNumber }
      : {
        projectId,
        projectName: name,
        musicalNumber: requestedMusicalNumber,
        sampleRate: 44100,
        masterVolume: 100,
        tracks: [],
        trackTree: [],
        loop: { enabled: false, startMs: 0, endMs: 0 },
      };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO projects(id, name, musical_number, scene_order, created_by)
         VALUES($1, $2, $3, $4, $5)`,
        [projectId, name, requestedMusicalNumber, requestedSceneOrder, req.user.id]
      );

      await client.query(
        `INSERT INTO project_heads(project_id, latest_seq, latest_snapshot_json)
         VALUES($1, 0, $2::jsonb)`,
        [projectId, JSON.stringify(snapshot)]
      );

      await client.query(
        `INSERT INTO project_permissions(project_id, user_id, can_read, can_write, granted_by)
         VALUES($1, $2, TRUE, TRUE, $3)
         ON CONFLICT (project_id, user_id)
         DO UPDATE SET can_read = TRUE, can_write = TRUE, granted_by = EXCLUDED.granted_by, updated_at = NOW()`,
        [projectId, req.user.id, req.user.id]
      );

      await client.query(
        `INSERT INTO project_snapshots(project_id, server_seq, snapshot_json, created_by)
         VALUES($1, 0, $2::jsonb, $3)`,
        [projectId, JSON.stringify(snapshot), req.user.id]
      );

      const mediaIds = collectSnapshotMediaIds(snapshot);
      if (mediaIds.length > 0) {
        await client.query(
          `INSERT INTO project_media_refs(project_id, media_id, snapshot_id)
           SELECT $1, m.id, NULL
           FROM unnest($2::text[]) AS t(id)
           JOIN media_objects m ON m.id = t.id
           ON CONFLICT (project_id, media_id) DO NOTHING`,
          [projectId, mediaIds]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.status(201).json({
      project: {
        id: projectId,
        name,
        musicalNumber: requestedMusicalNumber,
        sceneOrder: requestedSceneOrder,
        latestSeq: 0,
      },
      snapshot,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  const permission = await requireProjectPermission(req, res, 'write');
  if (!permission) return;

  const client = await pool.connect();
  let orphanMedia = [];
  try {
    await client.query('BEGIN');

    const mediaRefRows = await client.query(
      `SELECT media_id
       FROM project_media_refs
       WHERE project_id = $1`,
      [permission.projectId]
    );
    const candidateMediaIds = mediaRefRows.rows.map((row) => row.media_id);

    const deletedProject = await client.query(
      `DELETE FROM projects
       WHERE id = $1
       RETURNING id`,
      [permission.projectId]
    );

    if (deletedProject.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (candidateMediaIds.length > 0) {
      const orphanRows = await client.query(
        `SELECT mo.id, mo.path
         FROM media_objects mo
         WHERE mo.id = ANY($1::text[])
           AND NOT EXISTS (
             SELECT 1
             FROM project_media_refs r
             WHERE r.media_id = mo.id
           )`,
        [candidateMediaIds]
      );
      orphanMedia = orphanRows.rows;
      const orphanIds = orphanMedia.map((row) => row.id);
      if (orphanIds.length > 0) {
        await client.query(
          `DELETE FROM media_objects
           WHERE id = ANY($1::text[])`,
          [orphanIds]
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Failed to delete project' });
    return;
  } finally {
    client.release();
  }

  // Best-effort file cleanup after DB commit.
  await Promise.all(orphanMedia.map(async (row) => {
    if (!row?.path) return;
    try {
      await fs.unlink(resolveMediaPath(row.path));
    } catch {
      // ignore missing file/delete errors
    }
  }));

  res.json({ ok: true, projectId: permission.projectId });
});

app.patch('/api/projects/:id', requireAuth, async (req, res) => {
  const permission = await requireProjectPermission(req, res, 'write');
  if (!permission) return;

  try {
    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');
    const hasMusicalNumber = Object.prototype.hasOwnProperty.call(req.body || {}, 'musicalNumber');
    const hasSceneOrder = Object.prototype.hasOwnProperty.call(req.body || {}, 'sceneOrder');
    if (!hasName && !hasMusicalNumber && !hasSceneOrder) {
      res.status(400).json({ error: 'At least one field is required' });
      return;
    }

    const updates = [];
    const values = [permission.projectId];
    let idx = 2;
    const snapshotMetadataUpdates = {};

    if (hasName) {
      const name = String(req.body?.name || '').trim();
      if (!name) {
        res.status(400).json({ error: 'Project name is required' });
        return;
      }
      updates.push(`name = $${idx++}`);
      values.push(name);
      snapshotMetadataUpdates.projectName = name;
    }

    if (hasMusicalNumber) {
      const musicalNumber = normalizeMusicalNumber(req.body?.musicalNumber);
      if (!isValidMusicalNumber(musicalNumber)) {
        res.status(400).json({ error: 'Musical number must start with "<number>." (example: 2.1)' });
        return;
      }
      updates.push(`musical_number = $${idx++}`);
      values.push(musicalNumber);
      snapshotMetadataUpdates.musicalNumber = musicalNumber;
    }

    if (hasSceneOrder) {
      const sceneOrder = normalizeSceneOrder(req.body?.sceneOrder);
      if (Number.isNaN(sceneOrder)) {
        res.status(400).json({ error: 'sceneOrder must be an integer >= 1 when provided' });
        return;
      }
      updates.push(`scene_order = $${idx++}`);
      values.push(sceneOrder);
    }

    const client = await pool.connect();
    let updated;
    let broadcastPayload = null;
    try {
      await client.query('BEGIN');
      updated = await client.query(
        `UPDATE projects
         SET ${updates.join(', ')}
         WHERE id = $1
         RETURNING id, name, musical_number AS "musicalNumber", scene_order AS "sceneOrder"`,
        values
      );

      if (updated.rowCount > 0 && Object.keys(snapshotMetadataUpdates).length > 0) {
        const headResult = await client.query(
          `SELECT latest_seq, latest_snapshot_json
           FROM project_heads
           WHERE project_id = $1
           FOR UPDATE`,
          [permission.projectId]
        );
        if (headResult.rowCount === 0) {
          await client.query('ROLLBACK');
          res.status(404).json({ error: 'Project head missing' });
          return;
        }

        const head = headResult.rows[0];
        const maxOpSeqResult = await client.query(
          `SELECT COALESCE(MAX(server_seq), 0) AS max_op_seq
           FROM project_ops
           WHERE project_id = $1`,
          [permission.projectId]
        );
        const headLatestSeq = Number(head.latest_seq || 0);
        const maxOpSeq = Number(maxOpSeqResult.rows?.[0]?.max_op_seq || 0);
        const nextSeq = Math.max(headLatestSeq, maxOpSeq) + 1;
        const nextSnapshot = {
          ...(head.latest_snapshot_json || {}),
          ...snapshotMetadataUpdates,
        };
        const op = {
          type: 'project.replace',
          project: nextSnapshot,
        };

        await client.query(
          `INSERT INTO project_ops(project_id, server_seq, client_op_id, user_id, op_json)
           VALUES($1, $2, NULL, $3, $4::jsonb)`,
          [permission.projectId, nextSeq, req.user.id, JSON.stringify(op)]
        );

        await client.query(
          `UPDATE project_heads
           SET latest_seq = $2,
               latest_snapshot_json = $3::jsonb,
               updated_at = NOW()
           WHERE project_id = $1`,
          [permission.projectId, nextSeq, JSON.stringify(nextSnapshot)]
        );

        await client.query(
          `INSERT INTO project_snapshots(project_id, server_seq, snapshot_json, created_by)
           VALUES($1, $2, $3::jsonb, $4)`,
          [permission.projectId, nextSeq, JSON.stringify(nextSnapshot), req.user.id]
        );

        broadcastPayload = {
          projectId: permission.projectId,
          serverSeq: nextSeq,
          clientOpId: null,
          op,
          actor: {
            userId: req.user.id,
            username: req.user.username,
          },
        };
      } else if (updated.rowCount > 0) {
        await client.query(
          `UPDATE project_heads
           SET updated_at = NOW()
           WHERE project_id = $1`,
          [permission.projectId]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (updated.rowCount === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (broadcastPayload) {
      broadcastToProject(permission.projectId, 'op.broadcast', broadcastPayload);
    }

    res.json({ project: updated.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

app.get('/api/projects/:id/bootstrap', requireAuth, async (req, res) => {
  const permission = await requireProjectPermission(req, res, 'read');
  if (!permission) return;

  try {
    const knownSeq = Number(req.query.knownSeq || 0);
    const payload = await fetchProjectBootstrap(permission.projectId, knownSeq);
    res.json(payload);
  } catch (error) {
    console.error(error);
    res.status(404).json({ error: 'Project not found' });
  }
});

app.post('/api/projects/:id/checkpoint', requireAuth, async (req, res) => {
  const permission = await requireProjectPermission(req, res, 'write');
  if (!permission) return;

  const headResult = await pool.query(
    `SELECT latest_seq, latest_snapshot_json
     FROM project_heads
     WHERE project_id = $1`,
    [permission.projectId]
  );
  if (headResult.rowCount === 0) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const head = headResult.rows[0];
  await pool.query(
    `INSERT INTO project_snapshots(project_id, server_seq, snapshot_json, created_by)
     VALUES($1, $2, $3::jsonb, $4)`,
    [permission.projectId, Number(head.latest_seq || 0), JSON.stringify(head.latest_snapshot_json || {}), req.user.id]
  );

  await pool.query(
    `UPDATE project_heads
     SET last_checkpoint_at = NOW(), updated_at = NOW()
     WHERE project_id = $1`,
    [permission.projectId]
  );

  res.json({ ok: true, latestSeq: Number(head.latest_seq || 0) });
});

app.get('/api/projects/:projectId/permissions', requireAuth, async (req, res) => {
  const permission = await requireProjectPermission(req, res, 'read');
  if (!permission) return;

  const result = await pool.query(
    `SELECT pp.user_id AS "userId",
            u.username,
            pp.can_read AS "canRead",
            pp.can_write AS "canWrite",
            pp.updated_at AS "updatedAt"
     FROM project_permissions pp
     JOIN users u ON u.id = pp.user_id
     WHERE pp.project_id = $1
     ORDER BY u.username ASC`,
    [permission.projectId]
  );

  res.json({ permissions: result.rows });
});

app.put('/api/projects/:projectId/permissions/:userId', requireAuth, async (req, res) => {
  const permission = await requireProjectPermission(req, res, 'write');
  if (!permission) return;

  const canRead = Boolean(req.body?.canRead);
  const canWrite = Boolean(req.body?.canWrite);

  await pool.query(
    `INSERT INTO project_permissions(project_id, user_id, can_read, can_write, granted_by)
     VALUES($1, $2, $3, $4, $5)
     ON CONFLICT (project_id, user_id)
     DO UPDATE SET can_read = EXCLUDED.can_read,
                   can_write = EXCLUDED.can_write,
                   granted_by = EXCLUDED.granted_by,
                   updated_at = NOW()`,
    [permission.projectId, req.params.userId, canRead, canWrite, req.user.id]
  );

  res.json({ ok: true });
});

app.get('/api/player/my-device', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = Boolean(req.user.isAdmin);
    const [folderResult, mixResult, playlistResult, playlistItemResult] = await Promise.all([
      pool.query(
        `SELECT id,
                owner_user_id AS "ownerUserId",
                name,
                parent_folder_id AS "parentFolderId",
                order_index AS "orderIndex",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
         FROM player_folders
         WHERE owner_user_id = $1
         ORDER BY parent_folder_id NULLS FIRST, order_index ASC, name ASC`,
        [userId]
      ),
      pool.query(
        `SELECT vm.id,
                vm.owner_user_id AS "ownerUserId",
                vm.project_id AS "projectId",
                vm.name,
                vm.preset_id AS "presetId",
                vm.preset_variant_key AS "presetVariantKey",
                vm.visibility,
                vm.folder_id AS "folderId",
                vm.created_at AS "createdAt",
                vm.updated_at AS "updatedAt",
                vm.published_at AS "publishedAt",
                p.name AS "projectName",
                p.musical_number AS "musicalNumber",
                p.scene_order AS "sceneOrder",
                CASE WHEN $2::boolean THEN TRUE ELSE COALESCE(pp.can_read, FALSE) END AS "canRead",
                CASE WHEN $2::boolean THEN TRUE ELSE COALESCE(pp.can_write, FALSE) END AS "canWrite"
         FROM virtual_mixes vm
         JOIN projects p
           ON p.id = vm.project_id
         LEFT JOIN project_permissions pp
           ON pp.project_id = p.id AND pp.user_id = $1
         WHERE vm.owner_user_id = $1
         ORDER BY vm.updated_at DESC`,
        [userId, isAdmin]
      ),
      pool.query(
        `SELECT id,
                owner_user_id AS "ownerUserId",
                name,
                folder_id AS "folderId",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
         FROM player_playlists
         WHERE owner_user_id = $1
         ORDER BY updated_at DESC, created_at DESC`,
        [userId]
      ),
      pool.query(
        `SELECT pli.id,
                pli.playlist_id AS "playlistId",
                pli.mix_id AS "mixId",
                pli.order_index AS "orderIndex",
                pli.created_at AS "createdAt",
                vm.owner_user_id AS "mixOwnerUserId",
                vm.project_id AS "projectId",
                vm.name AS "mixName",
                vm.preset_id AS "presetId",
                vm.preset_variant_key AS "presetVariantKey",
                vm.visibility AS "mixVisibility",
                vm.folder_id AS "mixFolderId",
                vm.created_at AS "mixCreatedAt",
                vm.updated_at AS "mixUpdatedAt",
                vm.published_at AS "mixPublishedAt",
                p.name AS "projectName",
                p.musical_number AS "musicalNumber",
                p.scene_order AS "sceneOrder",
                CASE
                  WHEN vm.id IS NULL THEN FALSE
                  WHEN $2::boolean THEN TRUE
                  WHEN vm.owner_user_id = $1 THEN TRUE
                  WHEN vm.visibility = 'global' AND COALESCE(pp.can_read, FALSE) = TRUE THEN TRUE
                  ELSE FALSE
                END AS "mixReadable",
                CASE
                  WHEN vm.id IS NULL THEN FALSE
                  WHEN $2::boolean THEN TRUE
                  ELSE COALESCE(pp.can_write, FALSE)
                END AS "projectCanWrite"
         FROM player_playlist_items pli
         JOIN player_playlists pl
           ON pl.id = pli.playlist_id
         LEFT JOIN virtual_mixes vm
           ON vm.id = pli.mix_id
         LEFT JOIN projects p
           ON p.id = vm.project_id
         LEFT JOIN project_permissions pp
           ON pp.project_id = p.id AND pp.user_id = $1
         WHERE pl.owner_user_id = $1
         ORDER BY pli.playlist_id ASC, pli.order_index ASC`,
        [userId, isAdmin]
      ),
    ]);

    const playlistItemsByPlaylistId = {};
    playlistResult.rows.forEach((playlist) => {
      playlistItemsByPlaylistId[playlist.id] = [];
    });

    playlistItemResult.rows.forEach((row) => {
      const readable = Boolean(row.mixReadable);
      const mix = readable
        ? {
          id: row.mixId,
          ownerUserId: row.mixOwnerUserId,
          projectId: row.projectId,
          name: row.mixName,
          presetId: row.presetId,
          presetVariantKey: row.presetVariantKey,
          visibility: row.mixVisibility,
          folderId: row.mixFolderId,
          createdAt: row.mixCreatedAt,
          updatedAt: row.mixUpdatedAt,
          publishedAt: row.mixPublishedAt,
          projectName: row.projectName,
          musicalNumber: row.musicalNumber,
          sceneOrder: row.sceneOrder,
          canRead: true,
          canWrite: Boolean(row.projectCanWrite),
        }
        : null;
      const item = {
        id: row.id,
        playlistId: row.playlistId,
        mixId: row.mixId,
        orderIndex: Number(row.orderIndex || 0),
        createdAt: row.createdAt,
        unavailable: !readable,
        mix,
      };
      if (!playlistItemsByPlaylistId[row.playlistId]) {
        playlistItemsByPlaylistId[row.playlistId] = [];
      }
      playlistItemsByPlaylistId[row.playlistId].push(item);
    });

    res.json({
      folders: folderResult.rows,
      mixes: mixResult.rows,
      playlists: playlistResult.rows,
      playlistItemsByPlaylistId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load player library' });
  }
});

app.get('/api/player/tutti', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name,
              p.musical_number AS "musicalNumber",
              p.scene_order AS "sceneOrder",
              CASE WHEN $2::boolean THEN TRUE ELSE COALESCE(pp.can_read, FALSE) END AS "canRead",
              CASE WHEN $2::boolean THEN TRUE ELSE COALESCE(pp.can_write, FALSE) END AS "canWrite"
       FROM projects p
       LEFT JOIN project_permissions pp
         ON pp.project_id = p.id AND pp.user_id = $1
       WHERE $2::boolean = TRUE OR COALESCE(pp.can_read, FALSE) = TRUE`,
      [req.user.id, Boolean(req.user.isAdmin)]
    );

    const projects = [...result.rows].sort(compareProjectsByMusicalOrder);
    res.json({
      mixes: projects.map((project) => ({
        id: `tutti:${project.id}`,
        projectId: project.id,
        name: project.name,
        presetId: 'tutti',
        presetVariantKey: null,
        musicalNumber: project.musicalNumber,
        sceneOrder: project.sceneOrder,
        canWrite: Boolean(project.canWrite),
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load tutti mixes' });
  }
});

app.get('/api/player/mixes/global', requireAuth, async (req, res) => {
  try {
    const isAdmin = Boolean(req.user.isAdmin);
    const result = await pool.query(
      `SELECT vm.id,
              vm.owner_user_id AS "ownerUserId",
              vm.project_id AS "projectId",
              vm.name,
              vm.preset_id AS "presetId",
              vm.preset_variant_key AS "presetVariantKey",
              vm.visibility,
              vm.folder_id AS "folderId",
              vm.created_at AS "createdAt",
              vm.updated_at AS "updatedAt",
              vm.published_at AS "publishedAt",
              p.name AS "projectName",
              p.musical_number AS "musicalNumber",
              p.scene_order AS "sceneOrder",
              u.username AS "ownerUsername",
              CASE WHEN $1::boolean THEN TRUE ELSE COALESCE(pp.can_write, FALSE) END AS "canWrite"
       FROM virtual_mixes vm
       JOIN projects p
         ON p.id = vm.project_id
       JOIN users u
         ON u.id = vm.owner_user_id
       LEFT JOIN project_permissions pp
         ON pp.project_id = p.id AND pp.user_id = $2
       WHERE vm.visibility = 'global'
         AND ($1::boolean = TRUE OR COALESCE(pp.can_read, FALSE) = TRUE)
       ORDER BY vm.published_at DESC NULLS LAST, vm.updated_at DESC`,
      [isAdmin, req.user.id]
    );
    res.json({ mixes: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load global mixes' });
  }
});

app.post('/api/player/folders', requireAuth, async (req, res) => {
  try {
    const name = normalizeText(req.body?.name);
    const parentFolderId = normalizeOptionalText(req.body?.parentFolderId);
    const orderIndexRaw = normalizeOrderIndex(req.body?.orderIndex);
    const orderIndex = Number.isNaN(orderIndexRaw) ? null : orderIndexRaw;
    if (!name) {
      res.status(400).json({ error: 'Folder name is required' });
      return;
    }
    if (Number.isNaN(orderIndexRaw)) {
      res.status(400).json({ error: 'orderIndex must be an integer >= 0 when provided' });
      return;
    }

    if (parentFolderId) {
      const parentFolder = await loadPlayerFolderById(parentFolderId);
      if (!parentFolder || parentFolder.ownerUserId !== req.user.id) {
        res.status(400).json({ error: 'Parent folder not found' });
        return;
      }
    }

    const result = await pool.query(
      `INSERT INTO player_folders(id, owner_user_id, name, parent_folder_id, order_index)
       VALUES($1, $2, $3, $4, $5)
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 name,
                 parent_folder_id AS "parentFolderId",
                 order_index AS "orderIndex",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [randomUUID(), req.user.id, name, parentFolderId, orderIndex ?? 0]
    );

    res.status(201).json({ folder: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

app.patch('/api/player/folders/:id', requireAuth, async (req, res) => {
  try {
    const folder = await loadPlayerFolderById(req.params.id);
    if (!folder) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    if (!canMutateOwnedEntity(folder.ownerUserId, req.user)) {
      res.status(403).json({ error: 'No permission to edit this folder' });
      return;
    }

    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');
    const hasParentFolderId = Object.prototype.hasOwnProperty.call(req.body || {}, 'parentFolderId');
    const hasOrderIndex = Object.prototype.hasOwnProperty.call(req.body || {}, 'orderIndex');
    if (!hasName && !hasParentFolderId && !hasOrderIndex) {
      res.status(400).json({ error: 'At least one field is required' });
      return;
    }

    const updates = [];
    const values = [folder.id];
    let idx = 2;

    if (hasName) {
      const nextName = normalizeText(req.body?.name);
      if (!nextName) {
        res.status(400).json({ error: 'Folder name is required' });
        return;
      }
      updates.push(`name = $${idx++}`);
      values.push(nextName);
    }

    if (hasParentFolderId) {
      const nextParentFolderId = normalizeOptionalText(req.body?.parentFolderId);
      if (nextParentFolderId) {
        if (nextParentFolderId === folder.id) {
          res.status(400).json({ error: 'Folder cannot be parent of itself' });
          return;
        }
        const parentFolder = await loadPlayerFolderById(nextParentFolderId);
        if (!parentFolder || parentFolder.ownerUserId !== folder.ownerUserId) {
          res.status(400).json({ error: 'Parent folder not found' });
          return;
        }

        const cycleCheck = await pool.query(
          `WITH RECURSIVE descendants AS (
             SELECT id
             FROM player_folders
             WHERE id = $1
             UNION ALL
             SELECT pf.id
             FROM player_folders pf
             JOIN descendants d
               ON pf.parent_folder_id = d.id
           )
           SELECT 1
           FROM descendants
           WHERE id = $2
           LIMIT 1`,
          [folder.id, nextParentFolderId]
        );
        if (cycleCheck.rowCount > 0) {
          res.status(400).json({ error: 'Cannot move folder into itself or descendant folder' });
          return;
        }
      }
      updates.push(`parent_folder_id = $${idx++}`);
      values.push(nextParentFolderId);
    }

    if (hasOrderIndex) {
      const nextOrderIndex = normalizeOrderIndex(req.body?.orderIndex);
      if (Number.isNaN(nextOrderIndex)) {
        res.status(400).json({ error: 'orderIndex must be an integer >= 0 when provided' });
        return;
      }
      updates.push(`order_index = $${idx++}`);
      values.push(nextOrderIndex ?? 0);
    }

    const result = await pool.query(
      `UPDATE player_folders
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 name,
                 parent_folder_id AS "parentFolderId",
                 order_index AS "orderIndex",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      values
    );

    res.json({ folder: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

app.delete('/api/player/folders/:id', requireAuth, async (req, res) => {
  try {
    const folder = await loadPlayerFolderById(req.params.id);
    if (!folder) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    if (!canMutateOwnedEntity(folder.ownerUserId, req.user)) {
      res.status(403).json({ error: 'No permission to delete this folder' });
      return;
    }

    const countResult = await pool.query(
      `SELECT
          (SELECT COUNT(*)::integer FROM player_folders WHERE parent_folder_id = $1) AS "childCount",
          (SELECT COUNT(*)::integer FROM virtual_mixes WHERE folder_id = $1) AS "mixCount"`,
      [folder.id]
    );
    const childCount = Number(countResult.rows?.[0]?.childCount || 0);
    const mixCount = Number(countResult.rows?.[0]?.mixCount || 0);
    if (childCount > 0 || mixCount > 0) {
      res.status(409).json({ error: 'Folder is not empty' });
      return;
    }

    await pool.query(`DELETE FROM player_folders WHERE id = $1`, [folder.id]);
    res.json({ ok: true, folderId: folder.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

app.post('/api/player/mixes', requireAuth, async (req, res) => {
  try {
    const projectId = normalizeText(req.body?.projectId);
    const name = normalizeText(req.body?.name);
    const presetId = normalizeText(req.body?.presetId);
    const presetVariantKey = normalizeOptionalText(req.body?.presetVariantKey);
    const folderId = normalizeOptionalText(req.body?.folderId);
    if (!projectId || !name || !presetId) {
      res.status(400).json({ error: 'projectId, name, and presetId are required' });
      return;
    }

    const projectExists = await pool.query(
      `SELECT id
       FROM projects
       WHERE id = $1`,
      [projectId]
    );
    if (projectExists.rowCount === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const permission = await getProjectPermission(req.user.id, projectId, req.user.isAdmin);
    if (!permission.canRead) {
      res.status(403).json({ error: 'No read permission for source project' });
      return;
    }

    if (folderId) {
      const folder = await loadPlayerFolderById(folderId);
      if (!folder || folder.ownerUserId !== req.user.id) {
        res.status(400).json({ error: 'Folder not found' });
        return;
      }
    }

    const result = await pool.query(
      `INSERT INTO virtual_mixes(
          id, owner_user_id, project_id, name, preset_id, preset_variant_key, visibility, folder_id
       )
       VALUES($1, $2, $3, $4, $5, $6, 'private', $7)
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 project_id AS "projectId",
                 name,
                 preset_id AS "presetId",
                 preset_variant_key AS "presetVariantKey",
                 visibility,
                 folder_id AS "folderId",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt",
                 published_at AS "publishedAt"`,
      [randomUUID(), req.user.id, projectId, name, presetId, presetVariantKey, folderId]
    );
    res.status(201).json({ mix: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create virtual mix' });
  }
});

app.patch('/api/player/mixes/:id', requireAuth, async (req, res) => {
  try {
    const mix = await loadVirtualMixById(req.params.id);
    if (!mix) {
      res.status(404).json({ error: 'Mix not found' });
      return;
    }
    if (!canMutateOwnedEntity(mix.ownerUserId, req.user)) {
      res.status(403).json({ error: 'No permission to edit this mix' });
      return;
    }

    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');
    const hasPresetId = Object.prototype.hasOwnProperty.call(req.body || {}, 'presetId');
    const hasPresetVariantKey = Object.prototype.hasOwnProperty.call(req.body || {}, 'presetVariantKey');
    const hasFolderId = Object.prototype.hasOwnProperty.call(req.body || {}, 'folderId');
    if (!hasName && !hasPresetId && !hasPresetVariantKey && !hasFolderId) {
      res.status(400).json({ error: 'At least one field is required' });
      return;
    }

    const updates = [];
    const values = [mix.id];
    let idx = 2;

    if (hasName) {
      const nextName = normalizeText(req.body?.name);
      if (!nextName) {
        res.status(400).json({ error: 'Mix name is required' });
        return;
      }
      updates.push(`name = $${idx++}`);
      values.push(nextName);
    }

    if (hasPresetId) {
      const nextPresetId = normalizeText(req.body?.presetId);
      if (!nextPresetId) {
        res.status(400).json({ error: 'presetId is required' });
        return;
      }
      updates.push(`preset_id = $${idx++}`);
      values.push(nextPresetId);
    }

    if (hasPresetVariantKey) {
      const nextVariant = normalizeOptionalText(req.body?.presetVariantKey);
      updates.push(`preset_variant_key = $${idx++}`);
      values.push(nextVariant);
    }

    if (hasFolderId) {
      const nextFolderId = normalizeOptionalText(req.body?.folderId);
      if (nextFolderId) {
        const folder = await loadPlayerFolderById(nextFolderId);
        if (!folder || folder.ownerUserId !== mix.ownerUserId) {
          res.status(400).json({ error: 'Folder not found' });
          return;
        }
      }
      updates.push(`folder_id = $${idx++}`);
      values.push(nextFolderId);
    }

    const result = await pool.query(
      `UPDATE virtual_mixes
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 project_id AS "projectId",
                 name,
                 preset_id AS "presetId",
                 preset_variant_key AS "presetVariantKey",
                 visibility,
                 folder_id AS "folderId",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt",
                 published_at AS "publishedAt"`,
      values
    );
    res.json({ mix: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update mix' });
  }
});

app.delete('/api/player/mixes/:id', requireAuth, async (req, res) => {
  try {
    const mix = await loadVirtualMixById(req.params.id);
    if (!mix) {
      res.status(404).json({ error: 'Mix not found' });
      return;
    }
    if (!canMutateOwnedEntity(mix.ownerUserId, req.user)) {
      res.status(403).json({ error: 'No permission to delete this mix' });
      return;
    }

    await pool.query(`DELETE FROM virtual_mixes WHERE id = $1`, [mix.id]);
    res.json({ ok: true, mixId: mix.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete mix' });
  }
});

app.post('/api/player/mixes/:id/publish', requireAuth, async (req, res) => {
  try {
    const mix = await loadVirtualMixById(req.params.id);
    if (!mix) {
      res.status(404).json({ error: 'Mix not found' });
      return;
    }
    if (!canMutateOwnedEntity(mix.ownerUserId, req.user)) {
      res.status(403).json({ error: 'No permission to publish this mix' });
      return;
    }
    const result = await pool.query(
      `UPDATE virtual_mixes
       SET visibility = 'global',
           published_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 project_id AS "projectId",
                 name,
                 preset_id AS "presetId",
                 preset_variant_key AS "presetVariantKey",
                 visibility,
                 folder_id AS "folderId",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt",
                 published_at AS "publishedAt"`,
      [mix.id]
    );
    res.json({ mix: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to publish mix' });
  }
});

app.post('/api/player/mixes/:id/unpublish', requireAuth, async (req, res) => {
  try {
    const mix = await loadVirtualMixById(req.params.id);
    if (!mix) {
      res.status(404).json({ error: 'Mix not found' });
      return;
    }
    if (!canMutateOwnedEntity(mix.ownerUserId, req.user)) {
      res.status(403).json({ error: 'No permission to unpublish this mix' });
      return;
    }
    const result = await pool.query(
      `UPDATE virtual_mixes
       SET visibility = 'private',
           published_at = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 project_id AS "projectId",
                 name,
                 preset_id AS "presetId",
                 preset_variant_key AS "presetVariantKey",
                 visibility,
                 folder_id AS "folderId",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt",
                 published_at AS "publishedAt"`,
      [mix.id]
    );
    res.json({ mix: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to unpublish mix' });
  }
});

app.post('/api/player/playlists', requireAuth, async (req, res) => {
  try {
    const name = normalizeText(req.body?.name);
    const folderId = normalizeOptionalText(req.body?.folderId);
    if (!name) {
      res.status(400).json({ error: 'Playlist name is required' });
      return;
    }
    if (folderId) {
      const folder = await loadPlayerFolderById(folderId);
      if (!folder || folder.ownerUserId !== req.user.id) {
        res.status(400).json({ error: 'Folder not found' });
        return;
      }
    }
    const result = await pool.query(
      `INSERT INTO player_playlists(id, owner_user_id, name, folder_id)
       VALUES($1, $2, $3, $4)
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 name,
                 folder_id AS "folderId",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [randomUUID(), req.user.id, name, folderId]
    );
    res.status(201).json({ playlist: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

app.patch('/api/player/playlists/:id', requireAuth, async (req, res) => {
  try {
    const playlist = await loadPlaylistById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    if (!canMutateOwnedEntity(playlist.ownerUserId, req.user)) {
      res.status(403).json({ error: 'No permission to edit this playlist' });
      return;
    }
    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');
    const hasFolderId = Object.prototype.hasOwnProperty.call(req.body || {}, 'folderId');
    if (!hasName && !hasFolderId) {
      res.status(400).json({ error: 'At least one field is required' });
      return;
    }

    const updates = [];
    const values = [playlist.id];
    let idx = 2;

    if (hasName) {
      const name = normalizeText(req.body?.name);
      if (!name) {
        res.status(400).json({ error: 'Playlist name is required' });
        return;
      }
      updates.push(`name = $${idx++}`);
      values.push(name);
    }

    if (hasFolderId) {
      const folderId = normalizeOptionalText(req.body?.folderId);
      if (folderId) {
        const folder = await loadPlayerFolderById(folderId);
        if (!folder || folder.ownerUserId !== playlist.ownerUserId) {
          res.status(400).json({ error: 'Folder not found' });
          return;
        }
      }
      updates.push(`folder_id = $${idx++}`);
      values.push(folderId);
    }

    const result = await pool.query(
      `UPDATE player_playlists
       SET ${updates.join(', ')},
           updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 owner_user_id AS "ownerUserId",
                 name,
                 folder_id AS "folderId",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      values
    );
    res.json({ playlist: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update playlist' });
  }
});

app.delete('/api/player/playlists/:id', requireAuth, async (req, res) => {
  try {
    const playlist = await loadPlaylistById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    if (!canMutateOwnedEntity(playlist.ownerUserId, req.user)) {
      res.status(403).json({ error: 'No permission to delete this playlist' });
      return;
    }
    await pool.query(`DELETE FROM player_playlists WHERE id = $1`, [playlist.id]);
    res.json({ ok: true, playlistId: playlist.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

app.post('/api/player/playlists/:id/items', requireAuth, async (req, res) => {
  try {
    const playlist = await loadPlaylistById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    if (!canMutateOwnedEntity(playlist.ownerUserId, req.user)) {
      res.status(403).json({ error: 'No permission to edit this playlist' });
      return;
    }

    const mixId = normalizeText(req.body?.mixId);
    if (!mixId) {
      res.status(400).json({ error: 'mixId is required' });
      return;
    }
    const mixPermission = await pool.query(
      `SELECT vm.id,
              vm.owner_user_id AS "ownerUserId",
              CASE
                WHEN $3::boolean THEN TRUE
                WHEN vm.owner_user_id = $2 THEN TRUE
                WHEN vm.visibility = 'global' AND COALESCE(pp.can_read, FALSE) = TRUE THEN TRUE
                ELSE FALSE
              END AS "canUse"
       FROM virtual_mixes vm
       JOIN projects p
         ON p.id = vm.project_id
       LEFT JOIN project_permissions pp
         ON pp.project_id = p.id AND pp.user_id = $2
       WHERE vm.id = $1`,
      [mixId, req.user.id, Boolean(req.user.isAdmin)]
    );
    if (mixPermission.rowCount === 0) {
      res.status(404).json({ error: 'Mix not found' });
      return;
    }
    if (!Boolean(mixPermission.rows[0].canUse)) {
      res.status(403).json({ error: 'No permission to use this mix in playlist' });
      return;
    }

    const nextIndexResult = await pool.query(
      `SELECT COALESCE(MAX(order_index), -1) + 1 AS "nextIndex"
       FROM player_playlist_items
       WHERE playlist_id = $1`,
      [playlist.id]
    );
    const nextIndex = Number(nextIndexResult.rows?.[0]?.nextIndex || 0);
    const result = await pool.query(
      `INSERT INTO player_playlist_items(id, playlist_id, mix_id, order_index)
       VALUES($1, $2, $3, $4)
       RETURNING id,
                 playlist_id AS "playlistId",
                 mix_id AS "mixId",
                 order_index AS "orderIndex",
                 created_at AS "createdAt"`,
      [randomUUID(), playlist.id, mixId, nextIndex]
    );
    await pool.query(
      `UPDATE player_playlists
       SET updated_at = NOW()
       WHERE id = $1`,
      [playlist.id]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add playlist item' });
  }
});

app.patch('/api/player/playlists/:id/items/reorder', requireAuth, async (req, res) => {
  try {
    const playlist = await loadPlaylistById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    if (!canMutateOwnedEntity(playlist.ownerUserId, req.user)) {
      res.status(403).json({ error: 'No permission to reorder this playlist' });
      return;
    }

    const orderedItemIds = Array.isArray(req.body?.orderedItemIds)
      ? req.body.orderedItemIds.map((value) => String(value))
      : null;
    if (!orderedItemIds) {
      res.status(400).json({ error: 'orderedItemIds array is required' });
      return;
    }
    if (new Set(orderedItemIds).size !== orderedItemIds.length) {
      res.status(400).json({ error: 'orderedItemIds must not contain duplicates' });
      return;
    }

    const existingResult = await pool.query(
      `SELECT id
       FROM player_playlist_items
       WHERE playlist_id = $1
       ORDER BY order_index ASC, created_at ASC`,
      [playlist.id]
    );
    const existingIds = existingResult.rows.map((row) => row.id);
    if (existingIds.length !== orderedItemIds.length) {
      res.status(400).json({ error: 'orderedItemIds must include all playlist item ids exactly once' });
      return;
    }
    const existingSet = new Set(existingIds);
    const allKnown = orderedItemIds.every((id) => existingSet.has(id));
    if (!allKnown) {
      res.status(400).json({ error: 'orderedItemIds contains unknown item ids' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < orderedItemIds.length; i += 1) {
        await client.query(
          `UPDATE player_playlist_items
           SET order_index = $3
           WHERE playlist_id = $1 AND id = $2`,
          [playlist.id, orderedItemIds[i], -(i + 1)]
        );
      }
      for (let i = 0; i < orderedItemIds.length; i += 1) {
        await client.query(
          `UPDATE player_playlist_items
           SET order_index = $3
           WHERE playlist_id = $1 AND id = $2`,
          [playlist.id, orderedItemIds[i], i]
        );
      }
      await client.query(
        `UPDATE player_playlists
         SET updated_at = NOW()
         WHERE id = $1`,
        [playlist.id]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to reorder playlist items' });
  }
});

app.delete('/api/player/playlists/:id/items/:itemId', requireAuth, async (req, res) => {
  try {
    const playlist = await loadPlaylistById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    if (!canMutateOwnedEntity(playlist.ownerUserId, req.user)) {
      res.status(403).json({ error: 'No permission to edit this playlist' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const deleted = await client.query(
        `DELETE FROM player_playlist_items
         WHERE playlist_id = $1 AND id = $2
         RETURNING id`,
        [playlist.id, req.params.itemId]
      );
      if (deleted.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Playlist item not found' });
        return;
      }

      const remaining = await client.query(
        `SELECT id
         FROM player_playlist_items
         WHERE playlist_id = $1
         ORDER BY order_index ASC, created_at ASC`,
        [playlist.id]
      );
      for (let i = 0; i < remaining.rows.length; i += 1) {
        await client.query(
          `UPDATE player_playlist_items
           SET order_index = $3
           WHERE playlist_id = $1 AND id = $2`,
          [playlist.id, remaining.rows[i].id, i]
        );
      }
      await client.query(
        `UPDATE player_playlists
         SET updated_at = NOW()
         WHERE id = $1`,
        [playlist.id]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.json({ ok: true, itemId: req.params.itemId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete playlist item' });
  }
});

app.post('/api/media/register', requireAuth, async (req, res) => {
  try {
    const mediaId = String(req.body?.mediaId || randomUUID());
    const sha256 = String(req.body?.sha256 || '').trim();
    const mimeType = String(req.body?.mimeType || 'application/octet-stream');
    const sizeBytes = Number(req.body?.sizeBytes || 0);
    const fileName = toSafeName(String(req.body?.fileName || mediaId));

    if (!sha256 || sizeBytes <= 0) {
      res.status(400).json({ error: 'sha256 and sizeBytes are required' });
      return;
    }

    const existing = await pool.query(
      `SELECT id
       FROM media_objects
       WHERE sha256 = $1 OR id = $2`,
      [sha256, mediaId]
    );

    if (existing.rowCount > 0) {
      res.json({ mediaId: existing.rows[0].id, exists: true });
      return;
    }

    const diskPath = buildStoredMediaPath(mediaId, fileName);
    await pool.query(
      `INSERT INTO media_objects(id, sha256, mime_type, size_bytes, path, created_by)
       VALUES($1, $2, $3, $4, $5, $6)`,
      [mediaId, sha256, mimeType, sizeBytes, diskPath, req.user.id]
    );

    res.status(201).json({ mediaId, exists: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to register media' });
  }
});

app.put('/api/media/:mediaId/content', requireAuth, express.raw({ type: '*/*', limit: config.maxUploadBytes }), async (req, res) => {
  try {
    const mediaId = req.params.mediaId;
    const recordResult = await pool.query(
      `SELECT path, size_bytes AS "sizeBytes"
       FROM media_objects
       WHERE id = $1`,
      [mediaId]
    );

    if (recordResult.rowCount === 0) {
      res.status(404).json({ error: 'Media not registered' });
      return;
    }

    const record = recordResult.rows[0];
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (buffer.length === 0) {
      res.status(400).json({ error: 'Missing binary payload' });
      return;
    }

    if (Number(record.sizeBytes || 0) !== buffer.length) {
      res.status(400).json({ error: 'Upload size mismatch' });
      return;
    }

    const diskPath = resolveMediaPath(record.path);
    await fs.writeFile(diskPath, buffer);
    res.json({ ok: true, mediaId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to store media content' });
  }
});

app.get('/api/media/:mediaId', requireAuth, async (req, res) => {
  try {
    const mediaId = req.params.mediaId;
    const result = await pool.query(
      `SELECT path, mime_type AS "mimeType", size_bytes AS "sizeBytes"
       FROM media_objects
       WHERE id = $1`,
      [mediaId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }

    const media = result.rows[0];
    const diskPath = resolveMediaPath(media.path);
    if (!fssync.existsSync(diskPath)) {
      res.status(404).json({ error: 'Media file is missing on disk' });
      return;
    }

    const stat = await fs.stat(diskPath);
    const totalSize = Number(stat.size || 0);

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (!match) {
        res.status(416).end();
        return;
      }
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : totalSize - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= totalSize) {
        res.status(416).end();
        return;
      }

      res.status(206);
      res.setHeader('Content-Type', media.mimeType || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', end - start + 1);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      fssync.createReadStream(diskPath, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Content-Type', media.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', totalSize);
    fssync.createReadStream(diskPath).pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to stream media' });
  }
});

app.post('/api/media/batch-resolve', requireAuth, async (req, res) => {
  try {
    const mediaIds = Array.isArray(req.body?.mediaIds) ? req.body.mediaIds.slice(0, 5000) : [];
    if (!mediaIds.length) {
      res.json({ found: [] });
      return;
    }

    const result = await pool.query(
      `SELECT id
       FROM media_objects
       WHERE id = ANY($1::text[])`,
      [mediaIds]
    );
    const found = new Set(result.rows.map((row) => row.id));
    res.json({
      found: mediaIds.filter((id) => found.has(id)),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to resolve media ids' });
  }
});

wsServer.on('connection', (ws) => {
  ws.session = {
    userId: null,
    username: null,
    isAdmin: false,
    joinedProjects: new Set(),
  };
  clients.add(ws);

  ws.on('message', async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString('utf8'));
    } catch (error) {
      sendWs(ws, 'error', { code: 'BAD_JSON', message: 'Invalid JSON payload', retryable: false });
      return;
    }

    try {
      switch (message.type) {
        case 'auth.hello': {
          const token = String(message.accessToken || '');
          if (!token) {
            sendWs(ws, 'error', { code: 'AUTH_REQUIRED', message: 'accessToken is required', retryable: false });
            return;
          }
          const payload = verifyAccessToken(token);
          ws.session.userId = payload.sub;
          ws.session.username = payload.username;
          ws.session.isAdmin = Boolean(payload.isAdmin);
          sendWs(ws, 'auth.ok', {
            user: {
              id: ws.session.userId,
              username: ws.session.username,
              isAdmin: ws.session.isAdmin,
            },
          });
          return;
        }

        case 'project.join': {
          if (!ws.session.userId) {
            sendWs(ws, 'error', { code: 'AUTH_REQUIRED', message: 'Authenticate first', retryable: false });
            return;
          }
          const projectId = String(message.projectId || '');
          const knownSeq = Number(message.knownSeq || 0);
          if (!projectId) {
            sendWs(ws, 'error', { code: 'BAD_REQUEST', message: 'projectId is required', retryable: false });
            return;
          }

          const permission = await getProjectPermission(ws.session.userId, projectId, ws.session.isAdmin);
          if (!permission.canRead) {
            sendWs(ws, 'error', { code: 'NO_READ_PERMISSION', message: 'No read permission', retryable: false });
            return;
          }

          const payload = await fetchProjectBootstrap(projectId, knownSeq);
          ws.session.joinedProjects.add(projectId);
          roomFor(projectId).add(ws);

          sendWs(ws, 'project.joined', {
            projectId,
            latestSeq: payload.latestSeq,
            snapshot: payload.snapshot,
            missingOps: payload.missingOps,
          });
          await sendProjectLockStatesToClient(projectId, ws);
          return;
        }

        case 'op.submit': {
          if (!ws.session.userId) {
            sendWs(ws, 'error', { code: 'AUTH_REQUIRED', message: 'Authenticate first', retryable: false });
            return;
          }
          const projectId = String(message.projectId || '');
          const clientOpId = String(message.clientOpId || randomUUID());
          const op = message.op;

          if (!projectId || !op || typeof op !== 'object') {
            sendWs(ws, 'error', { code: 'BAD_REQUEST', message: 'projectId and op are required', retryable: false });
            return;
          }

          const permission = await getProjectPermission(ws.session.userId, projectId, ws.session.isAdmin);
          if (!permission.canWrite) {
            sendWs(ws, 'error', { code: 'NO_WRITE_PERMISSION', message: 'No write permission', retryable: false });
            return;
          }

          const result = await appendProjectOp({
            projectId,
            userId: ws.session.userId,
            clientOpId,
            op,
          });

          sendWs(ws, 'op.ack', {
            projectId,
            clientOpId,
            serverSeq: result.serverSeq,
          });

          broadcastToProject(projectId, 'op.broadcast', {
            projectId,
            serverSeq: result.serverSeq,
            clientOpId,
            op,
            actor: {
              userId: ws.session.userId,
              username: ws.session.username,
            },
          });
          return;
        }

        case 'lock.acquire': {
          if (!ws.session.userId) {
            sendWs(ws, 'error', { code: 'AUTH_REQUIRED', message: 'Authenticate first', retryable: false });
            return;
          }
          const projectId = String(message.projectId || '');
          const trackId = String(message.trackId || '');
          if (!projectId || !trackId) {
            sendWs(ws, 'error', { code: 'BAD_REQUEST', message: 'projectId and trackId are required', retryable: false });
            return;
          }

          const permission = await getProjectPermission(ws.session.userId, projectId, ws.session.isAdmin);
          if (!permission.canWrite) {
            sendWs(ws, 'error', { code: 'NO_WRITE_PERMISSION', message: 'No write permission', retryable: false });
            return;
          }

          const client = await pool.connect();
          let locked = false;
          try {
            await client.query('BEGIN');
            const lockResult = await client.query(
              `SELECT owner_user_id, expires_at
               FROM record_locks
               WHERE project_id = $1 AND track_id = $2
               FOR UPDATE`,
              [projectId, trackId]
            );

            if (lockResult.rowCount === 0) {
              locked = true;
            } else {
              const row = lockResult.rows[0];
              const isExpired = row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : true;
              const ownedBySelf = row.owner_user_id === ws.session.userId;
              locked = isExpired || ownedBySelf;
            }

            if (!locked) {
              await client.query('ROLLBACK');
              await broadcastLockState(projectId, trackId);
              sendWs(ws, 'error', {
                code: 'TRACK_LOCKED',
                message: 'Track is currently locked by another user',
                retryable: true,
              });
              break;
            }

            await client.query(
              `INSERT INTO record_locks(project_id, track_id, owner_user_id, owner_name, expires_at)
               VALUES($1, $2, $3, $4, NOW() + ($5 || ' seconds')::INTERVAL)
               ON CONFLICT (project_id, track_id)
               DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id,
                             owner_name = EXCLUDED.owner_name,
                             expires_at = EXCLUDED.expires_at,
                             updated_at = NOW()`,
              [projectId, trackId, ws.session.userId, ws.session.username, String(config.lockTimeoutSeconds)]
            );

            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }

          await broadcastLockState(projectId, trackId);
          sendWs(ws, 'lock.acquired', { projectId, trackId, ownerUserId: ws.session.userId });
          return;
        }

        case 'lock.heartbeat': {
          if (!ws.session.userId) {
            sendWs(ws, 'error', { code: 'AUTH_REQUIRED', message: 'Authenticate first', retryable: false });
            return;
          }
          const projectId = String(message.projectId || '');
          const trackId = String(message.trackId || '');
          if (!projectId || !trackId) {
            sendWs(ws, 'error', { code: 'BAD_REQUEST', message: 'projectId and trackId are required', retryable: false });
            return;
          }

          const result = await pool.query(
            `UPDATE record_locks
             SET expires_at = NOW() + ($4 || ' seconds')::INTERVAL,
                 updated_at = NOW()
             WHERE project_id = $1 AND track_id = $2 AND owner_user_id = $3
             RETURNING track_id`,
            [projectId, trackId, ws.session.userId, String(config.lockTimeoutSeconds)]
          );

          if (result.rowCount > 0) {
            await broadcastLockState(projectId, trackId);
          }
          return;
        }

        case 'lock.release': {
          if (!ws.session.userId) {
            sendWs(ws, 'error', { code: 'AUTH_REQUIRED', message: 'Authenticate first', retryable: false });
            return;
          }
          const projectId = String(message.projectId || '');
          const trackId = String(message.trackId || '');
          if (!projectId || !trackId) {
            sendWs(ws, 'error', { code: 'BAD_REQUEST', message: 'projectId and trackId are required', retryable: false });
            return;
          }

          await pool.query(
            `DELETE FROM record_locks
             WHERE project_id = $1 AND track_id = $2 AND owner_user_id = $3`,
            [projectId, trackId, ws.session.userId]
          );

          await broadcastLockState(projectId, trackId);
          return;
        }

        default:
          sendWs(ws, 'error', { code: 'UNKNOWN_TYPE', message: `Unknown message type: ${message.type}`, retryable: false });
      }
    } catch (error) {
      console.error(error);
      sendWs(ws, 'error', {
        code: 'SERVER_ERROR',
        message: error.message || 'Unexpected server error',
        retryable: true,
      });
    }
  });

  ws.on('close', async () => {
    clients.delete(ws);
    ws.session?.joinedProjects?.forEach((projectId) => {
      const room = roomFor(projectId);
      room.delete(ws);
      if (room.size === 0) {
        projectRooms.delete(projectId);
      }
    });
  });
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }

  wsServer.handleUpgrade(req, socket, head, (ws) => {
    wsServer.emit('connection', ws, req);
  });
});

async function start() {
  await ensureMediaRoot();
  await runMigrations();
  await ensureDefaultAdmin();

  server.listen(config.port, () => {
    console.log(`Apollo server listening on http://0.0.0.0:${config.port}`);
  });

  setInterval(() => {
    cleanupExpiredLocks().catch((error) => {
      console.error('Failed to cleanup expired locks', error);
    });
  }, 5000).unref();
}

start().catch(async (error) => {
  console.error('Failed to start server', error);
  await closeDb();
  process.exit(1);
});

process.on('SIGINT', async () => {
  await closeDb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDb();
  process.exit(0);
});
