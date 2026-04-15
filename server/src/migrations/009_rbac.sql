CREATE TABLE IF NOT EXISTS rbac_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  system_key TEXT UNIQUE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rbac_role_memberships (
  role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, user_id)
);

CREATE TABLE IF NOT EXISTS rbac_grants (
  id TEXT PRIMARY KEY,
  role_id TEXT REFERENCES rbac_roles(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope_value TEXT,
  scope_label TEXT,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rbac_grants_principal_check CHECK (
    ((role_id IS NOT NULL)::integer + (user_id IS NOT NULL)::integer) = 1
  ),
  CONSTRAINT rbac_grants_access_level_check CHECK (access_level IN ('read', 'write')),
  CONSTRAINT rbac_grants_scope_type_check CHECK (scope_type IN ('all_projects', 'project', 'group_name', 'part_name')),
  CONSTRAINT rbac_grants_scope_shape_check CHECK (
    (scope_type = 'all_projects' AND scope_project_id IS NULL AND scope_value IS NULL)
    OR (scope_type = 'project' AND scope_project_id IS NOT NULL AND scope_value IS NULL)
    OR (scope_type IN ('group_name', 'part_name') AND scope_project_id IS NULL AND scope_value IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS project_access_tags (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_type TEXT NOT NULL,
  tag_value TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, tag_type, tag_value),
  CONSTRAINT project_access_tags_type_check CHECK (tag_type IN ('group_name', 'part_name'))
);

CREATE INDEX IF NOT EXISTS idx_rbac_role_memberships_user ON rbac_role_memberships(user_id, role_id);
CREATE INDEX IF NOT EXISTS idx_rbac_roles_system_key ON rbac_roles(system_key) WHERE system_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rbac_grants_role_scope ON rbac_grants(role_id, scope_type, scope_project_id, scope_value) WHERE role_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rbac_grants_user_scope ON rbac_grants(user_id, scope_type, scope_project_id, scope_value) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_access_tags_lookup ON project_access_tags(tag_type, tag_value, project_id);

INSERT INTO rbac_roles(id, name, description, is_system, system_key)
VALUES(
  'system-role-admin',
  'Admin',
  'System role with full access to everything.',
  TRUE,
  'admin'
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = TRUE,
    system_key = EXCLUDED.system_key,
    updated_at = NOW();

INSERT INTO rbac_role_memberships(role_id, user_id, added_by)
SELECT 'system-role-admin', u.id, NULL
FROM users u
WHERE COALESCE(u.is_admin, FALSE) = TRUE
ON CONFLICT (role_id, user_id) DO NOTHING;

INSERT INTO rbac_grants(
  id,
  role_id,
  user_id,
  access_level,
  scope_type,
  scope_project_id,
  scope_value,
  scope_label,
  granted_by
)
SELECT
  'legacy-project-permission-' || md5(pp.project_id || ':' || pp.user_id),
  NULL,
  pp.user_id,
  CASE WHEN COALESCE(pp.can_write, FALSE) = TRUE THEN 'write' ELSE 'read' END,
  'project',
  pp.project_id,
  NULL,
  NULL,
  pp.granted_by
FROM project_permissions pp
WHERE COALESCE(pp.can_read, FALSE) = TRUE OR COALESCE(pp.can_write, FALSE) = TRUE
ON CONFLICT (id) DO NOTHING;
