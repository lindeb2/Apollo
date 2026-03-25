# Player Mode + DAW Mode Split (Full-System Implementation Plan)

## Summary
Implement a new default post-login **Player Mode** dashboard with 3 windows, keep current dashboard as **DAW Dashboard**, and add a global **Player/DAW mode toggle**.  
Player Mode will be playback-first, server-canonical, and based on **virtual mixes** (no rendered audio storage).  
Virtual mixes are **private by default**, can be published globally by **creator/admin only**, and always use the **latest DAW project snapshot on Play**.

## Locked Product Decisions (from this planning session)
- Delivery scope: **Full system**.
- Login landing: **Player Mode**.
- Mode switching: **Global header toggle** visible in Player Dashboard, DAW Dashboard, and Editor.
- Current `HostedDashboard`: keep as **DAW Dashboard**.
- My Device “saved files”: means **saved virtual mix entries**.
- Folder contents: **mix entries only**.
- Playlist model: **mix entries**.
- Playlist placement: **inside My Device**.
- Tutti window: one entry per project, each is the project’s **Tutti** mix.
- Queue semantics: `next/previous/loop` operate on the **current visible collection**.
- Loop modes in V1: `off | one | all`.
- V1 transport: listed controls + **seek/progress**.
- DAW-to-player bridge: refresh snapshot **on Play press** (not live mid-playback).
- Mix defaults: **private**.
- Mix edit/delete/publish/unpublish: **creator + admin**.
- Mix templates in V1: **existing export presets**.
- Multi-output presets: choose a **target part/variant on save**.
- Player Mode V1: **playback only** (no export/download UI there).

## Public API / Interface / Type Changes

### Backend DB migration
Create `server/src/migrations/006_player_mode_library.sql` with:

1. `player_folders`
- `id TEXT PK`
- `owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `name TEXT NOT NULL`
- `parent_folder_id TEXT NULL REFERENCES player_folders(id) ON DELETE CASCADE`
- `order_index INTEGER NOT NULL DEFAULT 0`
- `created_at`, `updated_at`
- Indexes on `(owner_user_id, parent_folder_id, order_index)` and `(owner_user_id, updated_at desc)`.

2. `virtual_mixes`
- `id TEXT PK`
- `owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE`
- `name TEXT NOT NULL`
- `preset_id TEXT NOT NULL`
- `preset_variant_key TEXT NULL` (for multi-output preset target)
- `visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','global'))`
- `folder_id TEXT NULL REFERENCES player_folders(id) ON DELETE SET NULL`
- `created_at`, `updated_at`, `published_at`
- Indexes on `(owner_user_id, updated_at desc)`, `(project_id)`, `(visibility, published_at desc)`, `(folder_id)`.

3. `player_playlists`
- `id TEXT PK`
- `owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `name TEXT NOT NULL`
- `created_at`, `updated_at`
- Index on `(owner_user_id, updated_at desc)`.

4. `player_playlist_items`
- `id TEXT PK`
- `playlist_id TEXT NOT NULL REFERENCES player_playlists(id) ON DELETE CASCADE`
- `mix_id TEXT NOT NULL REFERENCES virtual_mixes(id) ON DELETE CASCADE`
- `order_index INTEGER NOT NULL`
- `created_at`
- Unique `(playlist_id, order_index)`.
- Index `(playlist_id, order_index)`.

### Backend REST endpoints (`server/src/index.js`)
Add authenticated endpoints:

1. `GET /api/player/my-device`
- Returns `{ folders, mixes, playlists, playlistItemsByPlaylistId }`.
- Includes only owner data (admin can query own by default; no cross-user listing in V1).

2. `GET /api/player/tutti`
- Returns one computed entry per readable project:
- `{ id: "tutti:<projectId>", projectId, name, musicalNumber, presetId: "tutti", presetVariantKey: null, canWrite }`.

3. `GET /api/player/mixes/global`
- Returns globally published mixes filtered to projects current user can read.

4. `POST /api/player/folders`
5. `PATCH /api/player/folders/:id`
6. `DELETE /api/player/folders/:id`
- Delete rule in V1: reject non-empty folders with `409`.

7. `POST /api/player/mixes`
- Body: `{ projectId, name, presetId, presetVariantKey, folderId? }`.
- Visibility always starts as `private`.

8. `PATCH /api/player/mixes/:id`
- Rename, move folder, change preset/variant (owner/admin only).

9. `DELETE /api/player/mixes/:id`
- Owner/admin only; cascades playlist item removal via FK.

10. `POST /api/player/mixes/:id/publish`
11. `POST /api/player/mixes/:id/unpublish`
- Owner/admin only.

12. `POST /api/player/playlists`
13. `PATCH /api/player/playlists/:id`
14. `DELETE /api/player/playlists/:id`
15. `POST /api/player/playlists/:id/items`
- Body: `{ mixId }`.
16. `PATCH /api/player/playlists/:id/items/reorder`
- Body: `{ orderedItemIds: string[] }`.
17. `DELETE /api/player/playlists/:id/items/:itemId`

### Frontend API client (`src/lib/serverApi.js`)
Add typed client functions for all endpoints above and normalize responses.

### New frontend domain types
Create `src/types/player.js`:
- `PlayerFolder`
- `VirtualMix`
- `PlayerPlaylist`
- `PlayerPlaylistItem`
- `TuttiEntry`
- `PlayerQueueItem`
- `LoopMode = 'off' | 'one' | 'all'`

### Export/preset resolver interface (shared for DAW export + Player playback)
Refactor `src/lib/exportEngine.js` to expose a reusable resolver:
- `listPresetVariants(project, presetId, exportSettings) -> PresetVariant[]`
- `resolvePresetVariantPlaybackPlan(project, presetId, presetVariantKey, exportSettings) -> { derivedProject, label }`
This removes duplication and guarantees Player playback matches preset semantics.

## Frontend Implementation Plan

### App shell and mode routing
Modify [src/App.jsx](/Users/johan/PycharmProjects/Apollo/src/App.jsx):
- Replace `view: 'dashboard' | 'editor'` with `view: 'auth' | 'player' | 'dawDashboard' | 'editor'`.
- Post-login default route: `player`.
- Keep current `HostedDashboard` as DAW dashboard route.
- Add global mode toggle state/actions.

### New Player UI
Create:
- `src/components/PlayerDashboard.jsx`
- `src/components/player/PlayerTransportBar.jsx`
- `src/components/player/MyDevicePane.jsx`
- `src/components/player/TuttiPane.jsx`
- `src/components/player/BrowseMixesPane.jsx`

Behavior:
- My Device pane: folders, private mixes, playlists, playlist contents.
- Tutti pane: one computed entry per project (tutti preset).
- Browse Mixes pane: globally published mixes.
- Collection selection determines active queue source.

### DAW and Editor headers
Update:
- [src/components/HostedDashboard.jsx](/Users/johan/PycharmProjects/Apollo/src/components/HostedDashboard.jsx) to include Player/DAW toggle and DAW naming.
- [src/components/Editor.jsx](/Users/johan/PycharmProjects/Apollo/src/components/Editor.jsx) header to include global mode toggle.
- Keep existing back behavior to DAW dashboard, plus direct toggle to Player mode.
- Disable mode switch while recording.

### Player playback engine behavior
- Use existing `audioManager` and media caching path.
- On Play:
1. Resolve queue item to `projectId`, `presetId`, `presetVariantKey`.
2. Fetch latest project head/snapshot (`bootstrap`).
3. Build derived playback project with shared preset resolver.
4. Ensure required media blobs exist locally (reuse loader pattern currently in Editor).
5. Start playback.
- Implement transport:
- play/pause
- previous/next
- volume
- seek/progress
- loop off/one/all
- Queue semantics:
- current collection only
- visible sort order defines sequence
- loop `all` wraps, `one` repeats current.

## Permission and Visibility Rules
- Private mix visibility: owner + admin only.
- Global mix visibility: users with read permission on source project + admin.
- Edit/delete/publish/unpublish: owner + admin only.
- Playlist/folder CRUD: owner only (admin override allowed).
- Moving mix between folders never changes mix ID, so playlist links remain valid.

## Data/Behavior Edge Rules (V1 defaults)
- Folders are hierarchical but can contain only mixes.
- Playlists are separate entities in My Device (not folder contents).
- Folder delete is blocked when non-empty.
- If a playlist item points to mix no longer readable/deleted, item is marked unavailable in UI and skipped on playback.
- `Previous` behavior default: if elapsed > 3s, restart current item; else go to previous queue item.

## File-Level Change Map
- [src/App.jsx](/Users/johan/PycharmProjects/Apollo/src/App.jsx)
- [src/lib/serverApi.js](/Users/johan/PycharmProjects/Apollo/src/lib/serverApi.js)
- [src/components/HostedDashboard.jsx](/Users/johan/PycharmProjects/Apollo/src/components/HostedDashboard.jsx)
- [src/components/Editor.jsx](/Users/johan/PycharmProjects/Apollo/src/components/Editor.jsx)
- `src/components/PlayerDashboard.jsx` (new)
- `src/components/player/*` (new)
- `src/types/player.js` (new)
- [src/lib/exportEngine.js](/Users/johan/PycharmProjects/Apollo/src/lib/exportEngine.js)
- [server/src/index.js](/Users/johan/PycharmProjects/Apollo/server/src/index.js)
- `server/src/migrations/006_player_mode_library.sql` (new)

## Test Plan and Acceptance Scenarios

### Automated (Vitest)
1. Preset variant resolver tests
- single-output presets resolve one variant.
- multi-output presets resolve variant by `presetVariantKey`.
- derived playback plan matches expected track inclusion/pan/gain for known fixtures.

2. Queue/loop logic tests
- next/previous over collection boundaries.
- loop `off/one/all` behavior.
- previous-button restart threshold behavior.

3. Permission-gating utility tests
- visibility and action entitlement (owner/admin/reader).

### Manual integration checks
1. Login now lands on Player dashboard.
2. Global mode toggle works from Player, DAW dashboard, and Editor.
3. DAW dashboard retains existing project create/import/open flow.
4. Tutti pane shows one entry per readable project.
5. Create private mix from preset and variant; appears in My Device.
6. Move mix between folders; playlist references remain valid.
7. Publish/unpublish allowed only for creator/admin.
8. Browse Mixes lists only published readable mixes.
9. DAW edit/save project, switch to Player, press Play: latest change is reflected without export.
10. Transport controls and seek/progress behave correctly across all collections.

## Assumptions and Defaults
- “Saved files” means virtual mix definitions, not rendered audio files.
- Player Mode V1 does not include export/download actions.
- Existing `/api/projects` and realtime DAW sync remain intact; Player uses them for latest-on-play bridging.
- No schema changes to core project snapshot format are required for V1.
