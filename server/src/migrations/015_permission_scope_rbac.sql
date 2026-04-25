ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS permission_key TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS scope_type TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS scope_show_id TEXT REFERENCES shows(id) ON DELETE CASCADE;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS scope_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS scope_track_id TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS scope_name_value TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS scope_label TEXT;

ALTER TABLE rbac_grants
DROP CONSTRAINT IF EXISTS rbac_grants_scope_type_check;

ALTER TABLE rbac_grants
DROP CONSTRAINT IF EXISTS rbac_grants_scope_shape_check;

UPDATE rbac_grants
SET permission_key = CASE
  WHEN capability = 'player_tutti' AND project_target_type IN ('group_name', 'part_name') THEN 'track_reader'
  WHEN capability = 'player_tutti' THEN 'project_reader'
  WHEN capability = 'project_read' THEN 'track_reader'
  WHEN capability = 'track_write_own' THEN 'track_creator'
  WHEN capability = 'track_write_scope' THEN 'track_manager'
  WHEN capability = 'manage_own_projects' THEN 'project_creator'
  WHEN capability = 'project_manager' THEN 'project_manager'
  WHEN access_level = 'write' THEN 'project_manager'
  ELSE 'track_reader'
END
WHERE permission_key IS NULL;

UPDATE rbac_grants
SET scope_type = CASE
  WHEN permission_key = 'show_creator' THEN 'all'
  WHEN COALESCE(show_target_type, '') = 'show'
    AND COALESCE(project_target_type, '') IN ('', 'all_projects') THEN 'show'
  WHEN COALESCE(project_target_type, '') = 'project' THEN 'project'
  WHEN COALESCE(project_target_type, '') IN ('group_name', 'part_name') THEN project_target_type
  WHEN COALESCE(scope_type, '') IN ('project', 'group_name', 'part_name') THEN scope_type
  ELSE 'all'
END
WHERE COALESCE(permission_key, '') <> '';

UPDATE rbac_grants
SET scope_show_id = show_target_show_id
WHERE scope_show_id IS NULL
  AND show_target_show_id IS NOT NULL
  AND scope_type IN ('show', 'project', 'track');

UPDATE rbac_grants
SET scope_project_id = project_target_project_id
WHERE scope_project_id IS NULL
  AND project_target_project_id IS NOT NULL
  AND scope_type IN ('project', 'track');

UPDATE rbac_grants g
SET scope_show_id = p.show_id
FROM projects p
WHERE g.scope_project_id = p.id
  AND g.scope_project_id IS NOT NULL
  AND g.scope_show_id IS NULL;

UPDATE rbac_grants
SET scope_name_value = COALESCE(project_target_value, scope_value)
WHERE scope_name_value IS NULL
  AND scope_type IN ('group_name', 'part_name')
  AND COALESCE(project_target_value, scope_value) IS NOT NULL;

UPDATE rbac_grants
SET scope_label = CASE
  WHEN scope_type = 'all' THEN 'All'
  WHEN scope_type = 'show' THEN COALESCE(show_target_label, scope_label)
  WHEN scope_type = 'project' THEN COALESCE(project_target_label, scope_label)
  WHEN scope_type IN ('group_name', 'part_name') THEN COALESCE(project_target_label, scope_label)
  ELSE scope_label
END
WHERE COALESCE(scope_label, '') = '';

UPDATE rbac_grants g
SET scope_label = s.name
FROM shows s
WHERE g.scope_type = 'show'
  AND g.scope_show_id = s.id
  AND COALESCE(g.scope_label, '') = '';

UPDATE rbac_grants g
SET scope_label = p.name
FROM projects p
WHERE g.scope_type = 'project'
  AND g.scope_project_id = p.id
  AND COALESCE(g.scope_label, '') = '';

UPDATE rbac_grants g
SET scope_label = t.display_name
FROM (
  SELECT tag_type, tag_value, MIN(display_name) AS display_name
  FROM project_access_tags
  GROUP BY tag_type, tag_value
) t
WHERE g.scope_type = t.tag_type
  AND g.scope_name_value = t.tag_value
  AND COALESCE(g.scope_label, '') = '';

UPDATE rbac_grants
SET scope_label = 'All'
WHERE scope_type = 'all'
  AND COALESCE(scope_label, '') = '';

ALTER TABLE rbac_grants
ADD CONSTRAINT rbac_grants_scope_type_check CHECK (
  scope_type IS NULL OR scope_type IN ('all', 'show', 'project', 'track', 'group_name', 'part_name')
);

ALTER TABLE rbac_grants
ADD CONSTRAINT rbac_grants_scope_shape_check CHECK (
  permission_key IS NULL
  OR (
    scope_type = 'all'
    AND scope_show_id IS NULL
    AND scope_project_id IS NULL
    AND scope_track_id IS NULL
    AND scope_name_value IS NULL
  )
  OR (
    scope_type = 'show'
    AND scope_show_id IS NOT NULL
    AND scope_project_id IS NULL
    AND scope_track_id IS NULL
    AND scope_name_value IS NULL
  )
  OR (
    scope_type = 'project'
    AND scope_project_id IS NOT NULL
    AND scope_track_id IS NULL
    AND scope_name_value IS NULL
  )
  OR (
    scope_type = 'track'
    AND scope_project_id IS NOT NULL
    AND scope_track_id IS NOT NULL
    AND scope_name_value IS NULL
  )
  OR (
    scope_type IN ('group_name', 'part_name')
    AND scope_show_id IS NULL
    AND scope_project_id IS NULL
    AND scope_track_id IS NULL
    AND scope_name_value IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_rbac_grants_role_permission_scope
  ON rbac_grants(role_id, permission_key, scope_type, scope_show_id, scope_project_id, scope_track_id, scope_name_value)
  WHERE role_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rbac_grants_user_permission_scope
  ON rbac_grants(user_id, permission_key, scope_type, scope_show_id, scope_project_id, scope_track_id, scope_name_value)
  WHERE user_id IS NOT NULL;
