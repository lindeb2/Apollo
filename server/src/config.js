import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

actionValidate();

function resolveConfigPath(value, fallback) {
  const target = value || fallback;
  if (path.isAbsolute(target)) return target;
  return path.resolve(path.join(__dirname, '..'), target);
}

function actionValidate() {
  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

const mediaRoot = resolveConfigPath(process.env.MEDIA_ROOT, 'media');
const mediaDbRoot = resolveConfigPath(process.env.MEDIA_DB_ROOT, mediaRoot);

export const config = {
  port: Number(process.env.PORT || 8787),
  databaseUrl: process.env.DATABASE_URL,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  mediaRoot,
  mediaDbRoot,
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 524288000),
  defaultAdminUsername: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || 'changemechangeme',
  lockTimeoutSeconds: Number(process.env.RECORD_LOCK_TIMEOUT_SECONDS || 30),
  checkpointEveryOps: Number(process.env.CHECKPOINT_EVERY_OPS || 100),
  checkpointEverySeconds: Number(process.env.CHECKPOINT_EVERY_SECONDS || 30),
};
