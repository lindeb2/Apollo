#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_HOST="${DEV_HOST:-}"
VITE_ARGS=("$@")
USE_HTTPS="${VITE_USE_HTTPS:-}"

if [[ ${#VITE_ARGS[@]} -gt 0 && "${VITE_ARGS[0]}" != -* ]]; then
  DEV_HOST="${VITE_ARGS[0]}"
  VITE_ARGS=("${VITE_ARGS[@]:1}")
fi

if [[ -z "${USE_HTTPS}" && -f "${ROOT_DIR}/.env" ]]; then
  USE_HTTPS="$(sed -n 's/^VITE_USE_HTTPS=//p' "${ROOT_DIR}/.env" | tail -n 1 | tr -d '[:space:]')"
fi

if [[ "${USE_HTTPS:-false}" == "true" ]]; then
  "${ROOT_DIR}/scripts/generate-lan-cert.sh" "${DEV_HOST:-}"
fi

cd "${ROOT_DIR}"
if [[ ${#VITE_ARGS[@]} -gt 0 ]]; then
  npx vite "${VITE_ARGS[@]}"
else
  npx vite
fi
