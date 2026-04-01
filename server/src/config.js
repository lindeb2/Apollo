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

function parseBoolean(value, fallback = false) {
  const normalized = String(firstDefined(value, fallback ? 'true' : 'false')).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function buildDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const protocol = firstDefined(process.env.DB_PROTOCOL, 'postgres');
  const user = firstDefined(process.env.DB_USER);
  const password = firstDefined(process.env.DB_PASSWORD);
  const host = 'localhost';
  const port = firstDefined(process.env.DB_PORT, '5432');
  const name = firstDefined(process.env.DB_NAME);

  if (!user || !password || !host || !name) return null;
  return `${protocol}://${user}:${password}@${host}:${port}/${name}`;
}

function buildOidcIssuer() {
  return firstDefined(
    process.env.OIDC_ISSUER,
    process.env.OIDC_ISSUER_LOCAL
  ) || '';
}

function buildOidcPublicIssuer(oidcIssuer) {
  return firstDefined(
    process.env.OIDC_PUBLIC_ISSUER,
    process.env.OIDC_ISSUER_LOCAL,
    oidcIssuer
  ) || '';
}

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildAppOrigin() {
  return normalizeOrigin(process.env.APP_ORIGIN);
}

function buildCorsOrigin(appOrigin) {
  return firstDefined(process.env.CORS_ORIGIN, appOrigin) || '*';
}

function buildOidcRedirectUri(appOrigin) {
  return firstDefined(
    process.env.OIDC_REDIRECT_URI,
    appOrigin ? `${appOrigin}/api/auth/oidc/callback` : ''
  ) || '';
}

function buildOidcPostLogoutRedirectUri(appOrigin) {
  return firstDefined(
    process.env.OIDC_POST_LOGOUT_REDIRECT_URI,
    appOrigin ? `${appOrigin}/` : ''
  ) || '';
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

  if (parseBoolean(process.env.OIDC_ENABLED, false)) {
    const oidcIssuer = buildOidcIssuer();
    const oidcRequired = {
      OIDC_ISSUER: oidcIssuer,
      OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
    };
    const oidcMissing = Object.entries(oidcRequired)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (oidcMissing.length > 0) {
      throw new Error(`Missing required OIDC environment variables: ${oidcMissing.join(', ')}`);
    }
  }
}

const mediaRoot = resolveConfigPath(process.env.MEDIA_ROOT, 'media');
const mediaDbRoot = resolveConfigPath(process.env.MEDIA_DB_ROOT, mediaRoot);
const oidcIssuer = buildOidcIssuer();
const oidcPublicIssuer = buildOidcPublicIssuer(oidcIssuer);
const appOrigin = buildAppOrigin();

export const config = {
  port: Number(process.env.API_PORT || 8787),
  appOrigin,
  databaseUrl: process.env.DATABASE_URL,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7),
  corsOrigin: buildCorsOrigin(appOrigin),
  mediaRoot,
  mediaDbRoot,
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 524288000),
  defaultAdminUsername: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || 'changemechangeme',
  lockTimeoutSeconds: Number(process.env.RECORD_LOCK_TIMEOUT_SECONDS || 30),
  checkpointEveryOps: Number(process.env.CHECKPOINT_EVERY_OPS || 100),
  checkpointEverySeconds: Number(process.env.CHECKPOINT_EVERY_SECONDS || 30),
  bootstrapLocalLoginEnabled: parseBoolean(process.env.BOOTSTRAP_LOCAL_LOGIN_ENABLED, true),
  cookieSecure: parseBoolean(process.env.COOKIE_SECURE, false),
  oidcEnabled: parseBoolean(process.env.OIDC_ENABLED, false),
  oidcIssuer,
  oidcPublicIssuer,
  oidcClientId: process.env.OIDC_CLIENT_ID || '',
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET || '',
  oidcRedirectUri: buildOidcRedirectUri(appOrigin),
  oidcScopes: process.env.OIDC_SCOPES || 'openid profile email',
  oidcPostLogoutRedirectUri: buildOidcPostLogoutRedirectUri(appOrigin),
  oidcAllowInsecureHttp: parseBoolean(process.env.OIDC_ALLOW_INSECURE_HTTP, false),
};
