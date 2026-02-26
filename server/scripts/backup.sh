#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-./backups/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT_DIR"

echo "[backup] writing database dump..."
docker compose exec -T db pg_dump -U apollo apollo > "$OUT_DIR/db.sql"

echo "[backup] writing media archive..."
docker compose exec -T api sh -lc 'tar -czf - -C /data media' > "$OUT_DIR/media.tgz"

echo "[backup] done: $OUT_DIR"
