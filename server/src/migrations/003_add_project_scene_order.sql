ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS scene_order INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_scene_order_min_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_scene_order_min_check
      CHECK (scene_order IS NULL OR scene_order >= 1);
  END IF;
END
$$;
