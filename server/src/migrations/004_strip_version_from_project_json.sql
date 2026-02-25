-- Remove legacy "version" key from stored project JSON payloads.

UPDATE project_heads
SET latest_snapshot_json = latest_snapshot_json - 'version'
WHERE latest_snapshot_json ? 'version';

UPDATE project_snapshots
SET snapshot_json = snapshot_json - 'version'
WHERE snapshot_json ? 'version';

-- Also scrub historical ops that embed full project snapshots.
UPDATE project_ops
SET op_json = jsonb_set(op_json, '{project}', (op_json -> 'project') - 'version', false)
WHERE op_json ->> 'type' = 'project.replace'
  AND jsonb_typeof(op_json -> 'project') = 'object'
  AND (op_json -> 'project') ? 'version';

UPDATE project_ops
SET op_json = jsonb_set(op_json, '{updates}', (op_json -> 'updates') - 'version', false)
WHERE op_json ->> 'type' = 'project.update'
  AND jsonb_typeof(op_json -> 'updates') = 'object'
  AND (op_json -> 'updates') ? 'version';
