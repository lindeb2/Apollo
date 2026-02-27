CREATE TABLE IF NOT EXISTS player_folders (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_folder_id TEXT REFERENCES player_folders(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_folders_owner_parent_order
  ON player_folders(owner_user_id, parent_folder_id, order_index);

CREATE INDEX IF NOT EXISTS idx_player_folders_owner_updated
  ON player_folders(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS virtual_mixes (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  preset_variant_key TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  folder_id TEXT REFERENCES player_folders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  CONSTRAINT virtual_mixes_visibility_check
    CHECK (visibility IN ('private', 'global'))
);

CREATE INDEX IF NOT EXISTS idx_virtual_mixes_owner_updated
  ON virtual_mixes(owner_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_virtual_mixes_project
  ON virtual_mixes(project_id);

CREATE INDEX IF NOT EXISTS idx_virtual_mixes_visibility_published
  ON virtual_mixes(visibility, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_virtual_mixes_folder
  ON virtual_mixes(folder_id);

CREATE TABLE IF NOT EXISTS player_playlists (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_playlists_owner_updated
  ON player_playlists(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS player_playlist_items (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES player_playlists(id) ON DELETE CASCADE,
  mix_id TEXT NOT NULL REFERENCES virtual_mixes(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_playlist_items_playlist_order_unique UNIQUE (playlist_id, order_index)
);

CREATE INDEX IF NOT EXISTS idx_player_playlist_items_playlist_order
  ON player_playlist_items(playlist_id, order_index);
