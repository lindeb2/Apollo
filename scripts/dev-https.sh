#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${ROOT_DIR}/certs"
KEY_PATH="${CERT_DIR}/dev.key"
CERT_PATH="${CERT_DIR}/dev.crt"
DEV_HOST="${1:-${DEV_HOST:-}}"

if [[ ! -f "${KEY_PATH}" || ! -f "${CERT_PATH}" ]]; then
  "${ROOT_DIR}/scripts/generate-lan-cert.sh" "${DEV_HOST:-}"
fi

cd "${ROOT_DIR}"
VITE_USE_HTTPS=true \
VITE_DEV_HOST=0.0.0.0 \
VITE_SERVER_API_BASE=/api \
VITE_SERVER_WS_BASE=/ws \
VITE_SSL_KEY_PATH="${KEY_PATH}" \
VITE_SSL_CERT_PATH="${CERT_PATH}" \
npx vite
