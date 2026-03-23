ALTER TABLE player_playlists
  ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES player_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_player_playlists_folder
  ON player_playlists(folder_id);
