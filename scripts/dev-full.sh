#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USE_HTTPS="${VITE_USE_HTTPS:-}"

if [[ -z "${USE_HTTPS}" && -f "${ROOT_DIR}/.env" ]]; then
  USE_HTTPS="$(sed -n 's/^VITE_USE_HTTPS=//p' "${ROOT_DIR}/.env" | tail -n 1 | tr -d '[:space:]')"
fi

if [[ "${USE_HTTPS:-false}" == "true" ]]; then
  "${ROOT_DIR}/scripts/generate-lan-cert.sh"
fi

cd "${ROOT_DIR}"
docker compose up --build "$@"
