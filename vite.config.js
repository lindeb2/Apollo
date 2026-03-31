import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
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
      host: env.VITE_DEV_HOST || undefined,
      port: 3000,
      https,
      proxy: {
        '/api': {
          target: backendOrigin,
          changeOrigin: true,
        },
        '/ws': {
          target: backendOrigin,
          ws: true,
          changeOrigin: true,
        },
      },
    },
    build: {
      target: 'esnext',
    },
  };
});
