ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE projects p
SET published = CASE
  WHEN LOWER(ph.latest_snapshot_json ->> 'published') = 'true' THEN TRUE
  ELSE FALSE
END
FROM project_heads ph
WHERE ph.project_id = p.id
  AND ph.latest_snapshot_json ? 'published';

UPDATE project_heads
SET latest_snapshot_json = jsonb_set(
      COALESCE(latest_snapshot_json, '{}'::jsonb),
      '{published}',
      'false'::jsonb,
      true
    )
WHERE NOT (COALESCE(latest_snapshot_json, '{}'::jsonb) ? 'published');

CREATE INDEX IF NOT EXISTS idx_projects_published_show
  ON projects(published, show_id, musical_number, scene_order, name);
