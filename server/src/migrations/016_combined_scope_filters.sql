ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS scope_group_name_value TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS scope_group_label TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS scope_part_name_value TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS scope_part_label TEXT;

UPDATE rbac_grants
SET scope_group_name_value = scope_name_value,
    scope_group_label = scope_label
WHERE scope_type = 'group_name'
  AND scope_name_value IS NOT NULL
  AND scope_group_name_value IS NULL;

UPDATE rbac_grants
SET scope_part_name_value = scope_name_value,
    scope_part_label = scope_label
WHERE scope_type = 'part_name'
  AND scope_name_value IS NOT NULL
  AND scope_part_name_value IS NULL;

ALTER TABLE rbac_grants
DROP CONSTRAINT IF EXISTS rbac_grants_scope_shape_check;

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

CREATE INDEX IF NOT EXISTS idx_rbac_grants_role_scope_filters
  ON rbac_grants(role_id, permission_key, scope_type, scope_show_id, scope_project_id, scope_track_id, scope_group_name_value, scope_part_name_value)
  WHERE role_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rbac_grants_user_scope_filters
  ON rbac_grants(user_id, permission_key, scope_type, scope_show_id, scope_project_id, scope_track_id, scope_group_name_value, scope_part_name_value)
  WHERE user_id IS NOT NULL;
