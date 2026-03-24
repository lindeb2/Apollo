#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_HOST="${DEV_HOST:-}"

"${ROOT_DIR}/scripts/generate-lan-cert.sh" "${DEV_HOST:-}"

cd "${ROOT_DIR}"
docker compose up --build "$@"
