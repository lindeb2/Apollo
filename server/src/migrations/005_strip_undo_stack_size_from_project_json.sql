-- Remove legacy "undoStackSize" key from stored project JSON payloads.

UPDATE project_heads
SET latest_snapshot_json = latest_snapshot_json - 'undoStackSize'
WHERE latest_snapshot_json ? 'undoStackSize';

UPDATE project_snapshots
SET snapshot_json = snapshot_json - 'undoStackSize'
WHERE snapshot_json ? 'undoStackSize';

-- Also scrub historical ops that embed full project snapshots.
UPDATE project_ops
SET op_json = jsonb_set(op_json, '{project}', (op_json -> 'project') - 'undoStackSize', false)
WHERE op_json ->> 'type' = 'project.replace'
  AND jsonb_typeof(op_json -> 'project') = 'object'
  AND (op_json -> 'project') ? 'undoStackSize';

UPDATE project_ops
SET op_json = jsonb_set(op_json, '{updates}', (op_json -> 'updates') - 'undoStackSize', false)
WHERE op_json ->> 'type' = 'project.update'
  AND jsonb_typeof(op_json -> 'updates') = 'object'
  AND (op_json -> 'updates') ? 'undoStackSize';
