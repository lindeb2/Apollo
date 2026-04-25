ALTER TABLE users
  ADD COLUMN IF NOT EXISTS artist_description TEXT;

ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS producers JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS credits_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS music_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  group_type TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE music_groups
  ADD COLUMN IF NOT EXISTS group_type TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS guest_artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE projects p
SET credits_json = COALESCE(ph.latest_snapshot_json -> 'credits', '{}'::jsonb)
FROM project_heads ph
WHERE ph.project_id = p.id
  AND p.credits_json = '{}'::jsonb
  AND ph.latest_snapshot_json ? 'credits';
