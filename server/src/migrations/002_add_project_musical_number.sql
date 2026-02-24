ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS musical_number TEXT NOT NULL DEFAULT '0.0';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_musical_number_format_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_musical_number_format_check
      CHECK (musical_number ~ '^[0-9]+\..+$');
  END IF;
END $$;
