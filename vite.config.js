import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function attachForwardedHeaders(proxy, forwardedProto) {
  const setHeaders = (proxyReq, req) => {
    if (req.headers.host) {
      proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
    }
    proxyReq.setHeader('X-Forwarded-Proto', forwardedProto);
  };

  proxy.on('proxyReq', setHeaders);
  proxy.on('proxyReqWs', setHeaders);
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverHost = env.VITE_DEV_HOST || '0.0.0.0';
  const serverPort = Number(env.WEB_PORT || env.VITE_DEV_PORT || 3000);
  const useHttps = env.VITE_USE_HTTPS === 'true';
  const sslKeyPath = env.VITE_SSL_KEY_PATH || path.join(process.cwd(), 'certs/dev.key');
  const sslCertPath = env.VITE_SSL_CERT_PATH || path.join(process.cwd(), 'certs/dev.crt');
  const backendOrigin = env.VITE_BACKEND_ORIGIN || 'http://localhost:8787';

  let https = false;
  if (useHttps) {
    if (!fs.existsSync(sslKeyPath) || !fs.existsSync(sslCertPath)) {
      throw new Error(
        `HTTPS requested but cert files were not found. Expected key at "${sslKeyPath}" and cert at "${sslCertPath}".`
      );
    }

    https = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath),
    };
  }

  return {
    plugins: [react()],
    server: {
      host: serverHost,
      port: serverPort,
      strictPort: true,
      https,
      proxy: {
        '/api': {
          target: backendOrigin,
          changeOrigin: true,
          configure(proxy) {
            attachForwardedHeaders(proxy, useHttps ? 'https' : 'http');
          },
        },
        '/ws': {
          target: backendOrigin,
          ws: true,
          changeOrigin: true,
          configure(proxy) {
            attachForwardedHeaders(proxy, useHttps ? 'https' : 'http');
          },
        },
      },
    },
    preview: {
      host: serverHost,
      port: serverPort,
      strictPort: true,
    },
    build: {
      target: 'esnext',
    },
  };
});
