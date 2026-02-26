#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${ROOT_DIR}/certs"
KEY_PATH="${CERT_DIR}/dev.key"
CERT_PATH="${CERT_DIR}/dev.crt"
OPENSSL_BIN="${OPENSSL_BIN:-$(command -v openssl || true)}"

detect_dev_host() {
  local detected
  detected="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [[ -z "${detected}" ]]; then
    detected="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  echo "${detected}"
}

DEV_HOST="${1:-${DEV_HOST:-}}"
if [[ -z "${DEV_HOST}" ]]; then
  DEV_HOST="$(detect_dev_host)"
fi

if [[ -z "${OPENSSL_BIN}" ]]; then
  echo "openssl not found. Install openssl and retry." >&2
  exit 1
fi

if [[ -z "${DEV_HOST}" ]]; then
  echo "Could not detect LAN IP. Run: DEV_HOST=<lan-ip> npm run cert:lan" >&2
  exit 1
fi

mkdir -p "${CERT_DIR}"

if [[ -f "${KEY_PATH}" && -f "${CERT_PATH}" && "${FORCE_REGEN:-false}" != "true" ]]; then
  echo "Existing cert found at ${CERT_PATH}. Set FORCE_REGEN=true to replace it."
  exit 0
fi

echo "Generating local HTTPS cert for ${DEV_HOST}..."
"${OPENSSL_BIN}" req -x509 -nodes -newkey rsa:2048 -sha256 -days 365 \
  -keyout "${KEY_PATH}" \
  -out "${CERT_PATH}" \
  -subj "/CN=${DEV_HOST}" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${DEV_HOST}"

echo "Created:"
echo "- ${CERT_PATH}"
echo "- ${KEY_PATH}"
