CREATE TABLE IF NOT EXISTS rbac_role_oidc_links (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  claim_path TEXT NOT NULL DEFAULT '',
  claim_value TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rbac_role_oidc_links_value_check CHECK (LENGTH(TRIM(claim_value)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rbac_role_oidc_links_unique
  ON rbac_role_oidc_links(role_id, LOWER(claim_path), claim_value);

CREATE INDEX IF NOT EXISTS idx_rbac_role_oidc_links_role
  ON rbac_role_oidc_links(role_id);

ALTER TABLE rbac_role_memberships
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE rbac_role_memberships
ADD COLUMN IF NOT EXISTS source_oidc_link_id TEXT REFERENCES rbac_role_oidc_links(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rbac_role_memberships_source_check'
  ) THEN
    ALTER TABLE rbac_role_memberships
    ADD CONSTRAINT rbac_role_memberships_source_check
    CHECK (source IN ('manual', 'system', 'oidc_link'));
  END IF;
END $$;

UPDATE rbac_role_memberships rm
SET source = 'system'
FROM rbac_roles r
WHERE rm.role_id = r.id
  AND r.system_key = 'default_user';

UPDATE rbac_role_memberships
SET source = 'manual'
WHERE COALESCE(source, '') = '';

CREATE INDEX IF NOT EXISTS idx_rbac_role_memberships_source
  ON rbac_role_memberships(source, source_oidc_link_id);
