import { config } from './config.js';

export const ACCESS_COOKIE_NAME = 'apollo_access_token';
export const REFRESH_COOKIE_NAME = 'apollo_refresh_token';
export const OIDC_TXN_COOKIE_NAME = 'apollo_oidc_txn';
export const OIDC_ID_TOKEN_COOKIE_NAME = 'apollo_oidc_id_token';

const COOKIE_PATH = '/';
const SAME_SITE = 'lax';
const OIDC_TXN_MAX_AGE_MS = 10 * 60 * 1000;

function baseCookieOptions(overrides = {}) {
  return {
    httpOnly: true,
    sameSite: SAME_SITE,
    secure: config.cookieSecure,
    path: COOKIE_PATH,
    ...overrides,
  };
}

function encodeJsonCookie(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJsonCookie(value) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function setSessionCookies(res, { accessToken, refreshToken, refreshMaxAgeMs, oidcIdToken = '' }) {
  res.cookie(ACCESS_COOKIE_NAME, accessToken, baseCookieOptions());
  res.cookie(
    REFRESH_COOKIE_NAME,
    refreshToken,
    baseCookieOptions({ maxAge: refreshMaxAgeMs })
  );
  if (oidcIdToken) {
    res.cookie(
      OIDC_ID_TOKEN_COOKIE_NAME,
      oidcIdToken,
      baseCookieOptions({ maxAge: refreshMaxAgeMs })
    );
  } else {
    clearCookie(res, OIDC_ID_TOKEN_COOKIE_NAME);
  }
}

export function clearSessionCookies(res) {
  clearCookie(res, ACCESS_COOKIE_NAME);
  clearCookie(res, REFRESH_COOKIE_NAME);
  clearCookie(res, OIDC_ID_TOKEN_COOKIE_NAME);
}

export function setOidcTransactionCookie(res, transaction) {
  res.cookie(
    OIDC_TXN_COOKIE_NAME,
    encodeJsonCookie(transaction),
    baseCookieOptions({ maxAge: OIDC_TXN_MAX_AGE_MS })
  );
}

export function readOidcTransactionCookie(req) {
  return decodeJsonCookie(req.cookies?.[OIDC_TXN_COOKIE_NAME]);
}

export function clearOidcTransactionCookie(res) {
  clearCookie(res, OIDC_TXN_COOKIE_NAME);
}

export function getAccessTokenCookie(req) {
  return String(req.cookies?.[ACCESS_COOKIE_NAME] || '').trim();
}

export function getRefreshTokenCookie(req) {
  return String(req.cookies?.[REFRESH_COOKIE_NAME] || '').trim();
}

export function getOidcIdTokenCookie(req) {
  return String(req.cookies?.[OIDC_ID_TOKEN_COOKIE_NAME] || '').trim();
}

export function getRefreshCookieLifetimeMs() {
  return config.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
}

export function parseCookieHeader(headerValue) {
  const cookies = {};
  String(headerValue || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex <= 0) return;
      const name = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
    });
  return cookies;
}

function clearCookie(res, name) {
  res.clearCookie(name, baseCookieOptions());
}
