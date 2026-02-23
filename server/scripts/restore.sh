#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${1:-}"
if [[ -z "$BACKUP_DIR" ]]; then
  echo "usage: $0 <backup-dir>"
  exit 1
fi

if [[ ! -f "$BACKUP_DIR/db.sql" ]]; then
  echo "missing $BACKUP_DIR/db.sql"
  exit 1
fi
if [[ ! -f "$BACKUP_DIR/media.tgz" ]]; then
  echo "missing $BACKUP_DIR/media.tgz"
  exit 1
fi

echo "[restore] restoring database..."
cat "$BACKUP_DIR/db.sql" | docker compose exec -T db psql -U apollo -d apollo

echo "[restore] restoring media..."
cat "$BACKUP_DIR/media.tgz" | docker compose exec -T api sh -lc 'tar -xzf - -C /data'

echo "[restore] done"
