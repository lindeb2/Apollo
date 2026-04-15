ALTER TABLE rbac_roles
ADD COLUMN IF NOT EXISTS empty_access_message TEXT NOT NULL DEFAULT '';

INSERT INTO rbac_roles(id, name, description, is_system, system_key, empty_access_message)
VALUES(
  'system-role-default-user',
  'Default user',
  '',
  TRUE,
  'default_user',
  'You do not currently have any permissions. Please contact an admin if you should.'
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = TRUE,
    system_key = EXCLUDED.system_key,
    empty_access_message = CASE
      WHEN COALESCE(rbac_roles.empty_access_message, '') = '' THEN EXCLUDED.empty_access_message
      ELSE rbac_roles.empty_access_message
    END,
    updated_at = NOW();

INSERT INTO rbac_role_memberships(role_id, user_id, added_by)
SELECT 'system-role-default-user', u.id, NULL
FROM users u
ON CONFLICT (role_id, user_id) DO NOTHING;

UPDATE users
SET is_active = TRUE,
    updated_at = NOW()
WHERE is_active = FALSE;
