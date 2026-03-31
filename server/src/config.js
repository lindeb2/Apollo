import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(path.join(__dirname, '..', '..'));

// Load the shared root .env for direct local runs; shell env still overrides file values.
dotenv.config({ path: path.join(projectRoot, '.env') });

actionValidate();

function firstDefined(...values) {
  return values.find((value) => value != null && String(value).trim() !== '');
}

function buildDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const protocol = firstDefined(process.env.DB_PROTOCOL, 'postgres');
  const user = firstDefined(process.env.DB_USER);
  const password = firstDefined(process.env.DB_PASSWORD);
  const host = firstDefined(process.env.DB_HOST_LOCAL);
  const port = firstDefined(process.env.DB_PORT, '5432');
  const name = firstDefined(process.env.DB_NAME);

  if (!user || !password || !host || !name) return null;
  return `${protocol}://${user}:${password}@${host}:${port}/${name}`;
}

function resolveConfigPath(value, fallback) {
  const target = value || fallback;
  if (path.isAbsolute(target)) return target;
  return path.resolve(path.join(__dirname, '..'), target);
}

function actionValidate() {
  const databaseUrl = buildDatabaseUrl();
  if (databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
  }

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
