CREATE TABLE IF NOT EXISTS shows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO shows(id, name, order_index)
VALUES('show-metaspexet-2026', 'METAspexet 2026', 0)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    updated_at = NOW();

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS show_id TEXT REFERENCES shows(id) ON DELETE RESTRICT;

UPDATE projects
SET show_id = 'show-metaspexet-2026'
WHERE show_id IS NULL;

ALTER TABLE projects
ALTER COLUMN show_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_show_order
  ON projects(show_id, musical_number, scene_order, name);

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS show_target_type TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS show_target_show_id TEXT REFERENCES shows(id) ON DELETE CASCADE;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS show_target_label TEXT;

UPDATE rbac_grants
SET show_target_type = 'all_shows',
    show_target_show_id = NULL,
    show_target_label = 'All shows'
WHERE show_target_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_rbac_grants_role_show_target
  ON rbac_grants(role_id, show_target_type, show_target_show_id)
  WHERE role_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rbac_grants_user_show_target
  ON rbac_grants(user_id, show_target_type, show_target_show_id)
  WHERE user_id IS NOT NULL;
