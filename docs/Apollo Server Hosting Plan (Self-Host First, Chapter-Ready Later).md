# Apollo Server Hosting Plan (LAN / Self-Host First, Chapter-Ready Later)

## Summary

Build a **hybrid local+server architecture** so users can upload, open, edit, and stream projects from a central server, while still keeping offline editing and later sync. This utilizes **realtime operation sync** with a **server-ordered sequence** to minimize overwrite risk by making the server order authoritative. Recording is protected by a **per-track lock** (one recorder per track at a time), with a 30s auto-release if the client drops. Audio storage uses the local filesystem for phase 1, with a clean migration path to chapter infrastructure later.

---

## Locked Decisions

* **Hosting (phase 1):** Local Area Network (LAN) / Localhost only.
* **Runtime:** Docker Compose.
* **Ingress:** None (Direct IP access via Docker port mapping).
* **Backend stack:** Node + Postgres.
* **Audio storage (phase 1):** Local filesystem.
* **Auth model:** Username + Password.
* **Permissions:** Per-user permission model, default no access; selected users granted full access. Writes require `canWrite=true`.
* **Sync model:** Realtime ops + server sequence via WebSocket.
* **Conflict behavior:** Server order wins (last op in server sequence for same field).
* **Drag sync granularity:** Commit on mouse-up only (no per-move op spam).
* **Offline behavior:** Queue ops locally, but recording disabled offline.
* **Recording lock:** Track-scoped lock while actively recording.
* **Lock timeout:** 30 seconds.
* **Lock UI:** If selected track is locked by another user, record button shows red lock icon; hover shows locker name.

---

## Current-State Gap (repo-grounded)

Current app is fully browser-local:

* Projects/audio stored in IndexedDB via Dexie (`/Users/johan/PycharmProjects/Apollo/src/lib/db.js`).
* App has no server API integration (`/Users/johan/PycharmProjects/Apollo/src/App.jsx`, `src/components/*`).
* Clips reference `blobId` and audio is loaded from local DB into `audioManager.mediaCache` (`/Users/johan/PycharmProjects/Apollo/src/components/Editor.jsx`, `src/lib/audioManager.js`).
* Export/import exists via JSON/ZIP (`/Users/johan/PycharmProjects/Apollo/src/lib/projectPortability.js`).

We need to add a server sync layer without breaking current editing/playback internals.

---

## Target Architecture

### 1) Services (self-host phase 1)

Docker Compose services:

1. `web` (static Vite build served via Nginx). *(Exposed directly to host machine via mapped ports, e.g., 80:80 or 3000:3000).*
2. `api` (Node REST API + WebSocket Gateway).
3. `db` (Postgres).

Persistent volumes:

* Postgres data volume.
* Filesystem media root (host bind mount, e.g. `/srv/apollo/media`).

### 2) Data Flow

1. User logs in.
2. Dashboard fetches project list from server (authorized).
3. Opening project fetches the latest snapshot state and `latestSeq`.
4. App ensures required audio exists locally; missing media blobs are fetched from server and cached into local Dexie media table.
5. User edits locally via Zustand + IndexedDB runtime.
6. `SyncEngine` subscribes to local mutation events, converts them to canonical ops, and sends ops over WebSocket.
7. Server applies incoming ops, generates immutable snapshots periodically (history/recovery), and broadcasts ops to connected clients.

### 3) Storage Split

* **Server:** Source of truth via monotonic `serverSeq` and append-only op log.
* **Client IndexedDB:** Working cache + offline op queue + media cache.

---

## Public Interfaces / API / Type Changes

### A) WebSocket Protocol

**Client -> Server**

* `auth.hello` `{accessToken}`
* `project.join` `{projectId, knownSeq}`
* `op.submit` `{projectId, clientOpId, op}`
* `lock.acquire` `{projectId, trackId}`
* `lock.heartbeat` `{projectId, trackId}`
* `lock.release` `{projectId, trackId}`

**Server -> Client**

* `project.joined` `{projectId, latestSeq, snapshot, missingOps[]}`
* `op.ack` `{clientOpId, serverSeq}`
* `op.broadcast` `{projectId, serverSeq, op, actor}`
* `lock.state` `{projectId, trackId, ownerUserId, ownerName, expiresAt}`
* `error` `{code, message, retryable}`

### B) REST Endpoints

**Auth & User/Admin**

* `POST /api/auth/login` -> `{accessToken, refreshToken, user}`
* `POST /api/auth/refresh`
* `POST /api/auth/logout`
* `GET /api/me`
* `POST /api/admin/users`, `GET /api/admin/users`, `PATCH /api/admin/users/:id`

**Projects & Sync State**

* `GET /api/projects`
* `POST /api/projects`
* `GET /api/projects/:id/bootstrap` -> latest snapshot + latestSeq
* `POST /api/projects/:id/checkpoint` (admin/system/internal)
* `GET /api/projects/:projectId/permissions`
* `PUT /api/projects/:projectId/permissions/:userId` -> `{canRead, canWrite}`

**Media**

* `POST /api/media/register` -> `{mediaId, exists}`
* `PUT /api/media/:mediaId/content`
* `GET /api/media/:mediaId` (supports HTTP Range)
* `POST /api/media/batch-resolve`

### C) Server DB Schema (Postgres)

Tables:

1. `users (id, username unique, password_hash, is_admin, is_active, created_at)`
2. `projects (id, name, created_by, created_at)`
3. `project_permissions (project_id, user_id, can_read, can_write, granted_by, updated_at)`
4. `project_ops` (append-only op log)
5. `project_heads` (latest sequence pointer)
6. `project_snapshots` (periodic materialized state checkpoints)
7. `record_locks` (track_id, owner_user_id, expires_at)
8. `media_objects (id, sha256 unique, mime_type, size_bytes, path, created_by, created_at)`
9. `project_media_refs (project_id, version_id, media_id)`

### D) Frontend Types & Sync Layer

* `SyncOp` (canonical operation)
* `SyncQueueItem` (offline pending op)
* `ProjectSyncState`: `connected`, `latestSeq`, `lastAckedSeq`, `queueDepth`, `hasServerDivergence`
* `RecordLockState` by track: `{lockedBy, lockedByName, expiresAt}`
* Local Dexie tables: `remoteProjects`, `syncQueue`

---

## Canonical Operation Set

All user mutations map to one of:

1. `track.create`
2. `track.update` (name/role/icon/mute/solo/volume/pan/order/parent)
3. `track.delete`
4. `group.create`
5. `group.update` (name/role/collapsed/mix fields/order/parent)
6. `group.delete`
7. `clip.create`
8. `clip.update` (position/crop/gain/muted/blobRef)
9. `clip.delete`
10. `project.update` (loop/masterVolume/settings)
11. `batch` (atomic grouped ops for actions like split/cut/paste)

UI drag/slider interactions send only final commit op at pointer-up. Client applies local optimistic update immediately, reconciled by server broadcast order.

---

## Conflict Handling (Server Sequence)

There is no explicit merge step.

* Server applies incoming ops in receive order -> assigns `serverSeq`.
* If two users edit same field, the later `serverSeq` value wins.
* If an op precondition fails (e.g., edit deleted clip), the server records a no-op rejection and sends an `error` + updated state hint. The client then rehydrates from the latest checkpoint + ops if needed.

---

## Recording Lock Behavior

### Acquire

* On Record click:

1. If offline -> deny recording (UI message).
2. Send `lock.acquire(projectId, trackId)`.
3. Start recording only after lock granted.

### Maintain

* Heartbeat every 10s while recording.
* Lock expires 30s after last heartbeat.

### Release

* On stop/cancel, send `lock.release`.
* On disconnect/crash, lock naturally expires at 30s timeout.

### UI

* If selected track is locked by another user: record button becomes red lock icon, tooltip/hover displays `Locked by <name>`.
* If lock owned by self: normal recording UI continues.

---

## Offline + Reconnect Rules

1. **Editing offline:** Allowed. Ops queued in Dexie `syncQueue`.
2. **Recording offline:** Blocked.
3. **Reconnect:** WebSocket reconnects -> joins with `knownSeq` -> applies missing server ops -> replays queued ops in original order.
4. **Replay Failure:** Mark failed queue item, auto-rehydrate project from server latest, keep failed ops for user-visible retry/debug panel.

---

## Implementation Phases

* **Phase 1 — Backend realtime core:** Add WebSocket gateway with auth + project rooms. Add `project_ops`, `project_heads`, `project_snapshots`. Implement op validation + sequencing + broadcast.
* **Phase 2 — Frontend SyncEngine:** Add websocket client, op encoder/decoder, and hook local mutation pipeline to op submit. Apply incoming ops deterministically.
* **Phase 3 — Offline queue + reconnect replay:** Add Dexie tables for queued ops + sync state. Implement replay and divergence recovery flow.
* **Phase 4 — Recording locks:** Backend lock table + heartbeat expiry worker. Frontend lock acquire/release + record button lock UI.
* **Phase 5 — Deploy (self-host):** Docker compose (web + api + postgres). Map web and API ports to host. Volumes for db + media. Env templates and backup scripts.
* **Phase 6 — Chapter migration readiness:** Keep storage behind adapter interface, replace filesystem adapter with S3 adapter later, and migrate DB.

---

## Testing & Acceptance Criteria

### Core Sync & E2E

* Two users connected, edits on different fields both persist.
* Same-field concurrent edit resolves by server sequence order. No manual merge dialog exists.
* Permissions block no-read/no-write users correctly.

### Offline

* Client can edit offline; queue depth increases.
* Reconnect replays ops and matches server state.
* Offline recording attempt is blocked with clear message.

### Recording Lock

* User A records track X; User B cannot record track X simultaneously.
* User B sees red lock icon and locker name on selected locked track.
* If User A disconnects, lock auto-releases within 30s.

### Durability & Media

* Restart services: latest project state reconstructs from snapshot + ops.
* Media fetch/stream still works for all referenced blobs; deduplication by sha256 works correctly.

---

## Operational Defaults

1. **Password policy:** Minimum length 12
2. **Session:** Access token 15 min, refresh token 7 days (httpOnly cookie)
3. **API rate limit:** Login and upload endpoints protected. *(Deprioritized for Phase 1; LAN environment implies trusted users).*
4. **Max upload size:** 500 MB per file (configurable)
5. **Initial permissions:** Strict-default-deny (admin grants read/write explicitly)
6. **Snapshot checkpoint:** Every 100 ops OR every 30s (whichever first), plus forced checkpoint on export request.

---

## Explicit Assumptions

1. “Stream latest version” / “Direct sync” means operation-level realtime sync over WebSocket and streaming required media, not real-time collaborative audio transport.
2. Server sequence order is authoritative conflict resolution.
3. Snapshot checkpoints are internal optimization/audit, not user-triggered saves.
4. Existing local project/edit model remains primary editor runtime; sync is additive.
5. Local filesystem media storage is fine for phase 1; chapter migration later should avoid frontend rewrites by preserving API contracts.