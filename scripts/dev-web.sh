#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${ROOT_DIR}/certs"
KEY_PATH="${CERT_DIR}/dev.key"
CERT_PATH="${CERT_DIR}/dev.crt"
DEV_HOST="${DEV_HOST:-}"
VITE_ARGS=("$@")

if [[ ${#VITE_ARGS[@]} -gt 0 && "${VITE_ARGS[0]}" != -* ]]; then
  DEV_HOST="${VITE_ARGS[0]}"
  VITE_ARGS=("${VITE_ARGS[@]:1}")
fi

"${ROOT_DIR}/scripts/generate-lan-cert.sh" "${DEV_HOST:-}"

cd "${ROOT_DIR}"
if [[ ${#VITE_ARGS[@]} -gt 0 ]]; then
  npx vite "${VITE_ARGS[@]}"
else
  npx vite
fi
