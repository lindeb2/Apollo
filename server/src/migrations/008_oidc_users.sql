ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS oidc_issuer TEXT,
  ADD COLUMN IF NOT EXISTS oidc_subject TEXT,
  ADD COLUMN IF NOT EXISTS oidc_email TEXT,
  ADD COLUMN IF NOT EXISTS oidc_display_name TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc_identity
  ON users(oidc_issuer, oidc_subject)
  WHERE oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL;
