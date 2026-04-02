#!/bin/sh
set -eu

WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-8787}"
USE_HTTPS="${VITE_USE_HTTPS:-false}"
CERT_PATH="/app/certs/dev.crt"
KEY_PATH="/app/certs/dev.key"

write_common_config() {
  cat <<EOF
  root /usr/share/nginx/html;
  index index.html;
  client_max_body_size 500m;

  location / {
    try_files \$uri \$uri/ /index.html;
  }

  location /api/ {
    proxy_pass http://api:${API_PORT}/api/;
    proxy_http_version 1.1;
    proxy_set_header Host \$http_host;
    proxy_set_header X-Forwarded-Host \$http_host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /ws {
    proxy_pass http://api:${API_PORT}/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$http_host;
    proxy_set_header X-Forwarded-Host \$http_host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
EOF
}

if [ "${USE_HTTPS}" = "true" ]; then
  if [ ! -f "${CERT_PATH}" ] || [ ! -f "${KEY_PATH}" ]; then
    echo "HTTPS requested but cert files were not found. Expected key at \"${KEY_PATH}\" and cert at \"${CERT_PATH}\"." >&2
    exit 1
  fi

  cat > /etc/nginx/conf.d/default.conf <<EOF
server {
  listen ${WEB_PORT} ssl;
  listen [::]:${WEB_PORT} ssl;
  server_name _;
  ssl_certificate ${CERT_PATH};
  ssl_certificate_key ${KEY_PATH};
  ssl_protocols TLSv1.2 TLSv1.3;
$(write_common_config)
}
EOF
else
  cat > /etc/nginx/conf.d/default.conf <<EOF
server {
  listen ${WEB_PORT};
  listen [::]:${WEB_PORT};
  server_name _;
$(write_common_config)
}
EOF
fi

exec nginx -g 'daemon off;'
