ALTER TABLE virtual_mixes
  ADD COLUMN IF NOT EXISTS advanced_mix_json JSONB NOT NULL DEFAULT '{}'::jsonb;
