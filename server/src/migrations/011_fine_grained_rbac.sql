CREATE TABLE IF NOT EXISTS rbac_role_inheritance (
  role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  parent_role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, parent_role_id),
  CONSTRAINT rbac_role_inheritance_no_self_check CHECK (role_id <> parent_role_id)
);

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS capability TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS project_target_type TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS project_target_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS project_target_value TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS project_target_label TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS track_scope_type TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS track_scope_value TEXT;

ALTER TABLE rbac_grants
ADD COLUMN IF NOT EXISTS track_scope_label TEXT;

UPDATE rbac_grants
SET capability = CASE
  WHEN access_level = 'write' THEN 'project_manager'
  ELSE 'project_read'
END
WHERE capability IS NULL;

UPDATE rbac_grants
SET project_target_type = scope_type
WHERE project_target_type IS NULL
  AND scope_type IS NOT NULL;

UPDATE rbac_grants
SET project_target_project_id = scope_project_id
WHERE project_target_project_id IS NULL
  AND scope_project_id IS NOT NULL;

UPDATE rbac_grants
SET project_target_value = scope_value
WHERE project_target_value IS NULL
  AND scope_value IS NOT NULL;

UPDATE rbac_grants
SET project_target_label = scope_label
WHERE project_target_label IS NULL
  AND scope_label IS NOT NULL;

UPDATE rbac_grants g
SET project_target_label = p.name
FROM projects p
WHERE g.project_target_type = 'project'
  AND g.project_target_project_id = p.id
  AND COALESCE(g.project_target_label, '') = '';

UPDATE rbac_grants g
SET project_target_label = t.display_name
FROM (
  SELECT tag_type, tag_value, MIN(display_name) AS display_name
  FROM project_access_tags
  GROUP BY tag_type, tag_value
) t
WHERE g.project_target_type = t.tag_type
  AND g.project_target_value = t.tag_value
  AND COALESCE(g.project_target_label, '') = '';

UPDATE rbac_grants
SET project_target_label = 'All projects'
WHERE project_target_type = 'all_projects'
  AND COALESCE(project_target_label, '') = '';

CREATE INDEX IF NOT EXISTS idx_rbac_role_inheritance_role ON rbac_role_inheritance(role_id, parent_role_id);
CREATE INDEX IF NOT EXISTS idx_rbac_role_inheritance_parent ON rbac_role_inheritance(parent_role_id, role_id);
CREATE INDEX IF NOT EXISTS idx_rbac_grants_role_capability ON rbac_grants(role_id, capability, project_target_type, project_target_project_id, project_target_value) WHERE role_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rbac_grants_user_capability ON rbac_grants(user_id, capability, project_target_type, project_target_project_id, project_target_value) WHERE user_id IS NOT NULL;
