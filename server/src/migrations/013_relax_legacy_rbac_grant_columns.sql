ALTER TABLE rbac_grants
ALTER COLUMN access_level DROP NOT NULL;

ALTER TABLE rbac_grants
ALTER COLUMN scope_type DROP NOT NULL;
