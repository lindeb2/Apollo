import * as oidcClient from 'openid-client';
import { config } from './config.js';
import {
  choosePreferredOrigin,
  getRequestOrigin,
  isLoopbackOrigin,
  replaceUrlOrigin,
} from './requestOrigin.js';

let cachedConfigurationPromise = null;

function stringClaim(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function resolveAppOrigin(req) {
  return choosePreferredOrigin(config.appOrigin, getRequestOrigin(req));
}

function resolveRedirectUri(req) {
  const appOrigin = resolveAppOrigin(req);
  if (appOrigin) return `${appOrigin}/api/auth/oidc/callback`;
  return config.oidcRedirectUri;
}

function resolvePostLogoutRedirectUri(req) {
  const appOrigin = resolveAppOrigin(req);
  if (appOrigin) return `${appOrigin}/`;
  return config.oidcPostLogoutRedirectUri;
}

function resolvePublicIssuer(req) {
  const configuredPublicIssuer = String(config.oidcPublicIssuer || '').trim();
  if (configuredPublicIssuer && !isLoopbackOrigin(configuredPublicIssuer)) {
    return configuredPublicIssuer;
  }

  const baseIssuer = configuredPublicIssuer || config.oidcIssuer;
  const requestOrigin = getRequestOrigin(req);
  if (!baseIssuer || !requestOrigin) return baseIssuer;

  const requestUrl = new URL(requestOrigin);
  const baseUrl = new URL(baseIssuer);
  baseUrl.hostname = requestUrl.hostname;
  return baseUrl.href;
}

function buildPublicUrl(urlLike, req) {
  const url = new URL(urlLike);
  const internalIssuer = config.oidcIssuer ? new URL(config.oidcIssuer) : null;
  const resolvedPublicIssuer = resolvePublicIssuer(req);
  const publicIssuer = resolvedPublicIssuer ? new URL(resolvedPublicIssuer) : null;

  if (!internalIssuer || !publicIssuer) {
    return url;
  }

  url.protocol = publicIssuer.protocol;
  url.username = publicIssuer.username;
  url.password = publicIssuer.password;
  url.host = publicIssuer.host;

  const internalBasePath = internalIssuer.pathname.replace(/\/$/, '');
  const publicBasePath = publicIssuer.pathname.replace(/\/$/, '');

  if (internalBasePath && url.pathname.startsWith(internalBasePath)) {
    const suffix = url.pathname.slice(internalBasePath.length);
    url.pathname = `${publicBasePath}${suffix || ''}` || '/';
  }

  return url;
}

export function isOidcEnabled() {
  return Boolean(config.oidcEnabled);
}

export async function getOidcConfiguration() {
  if (!isOidcEnabled()) {
    throw new Error('OIDC is not enabled');
  }

  if (!cachedConfigurationPromise) {
    const metadata = {
      redirect_uris: [config.oidcRedirectUri || 'http://localhost/api/auth/oidc/callback'],
      response_types: ['code'],
    };
    const authMethod = config.oidcClientSecret
      ? oidcClient.ClientSecretBasic(config.oidcClientSecret)
      : oidcClient.None();

    const discoveryOptions = config.oidcAllowInsecureHttp
      ? { execute: [oidcClient.allowInsecureRequests] }
      : undefined;

    cachedConfigurationPromise = oidcClient.discovery(
      new URL(config.oidcIssuer),
      config.oidcClientId,
      metadata,
      authMethod,
      discoveryOptions
    ).catch((error) => {
      cachedConfigurationPromise = null;
      throw error;
    });
  }

  return cachedConfigurationPromise;
}

export async function buildOidcAuthorizationRequest(req) {
  const configuration = await getOidcConfiguration();
  const redirectUri = resolveRedirectUri(req);
  const codeVerifier = oidcClient.randomPKCECodeVerifier();
  const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier);
  const state = oidcClient.randomState();
  const nonce = oidcClient.randomNonce();

  const url = oidcClient.buildAuthorizationUrl(configuration, {
    redirect_uri: redirectUri,
    scope: config.oidcScopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  return {
    url: buildPublicUrl(url, req),
    transaction: {
      state,
      nonce,
      codeVerifier,
      createdAt: Date.now(),
    },
  };
}

export async function completeOidcAuthorization(req, transaction) {
  const configuration = await getOidcConfiguration();
  const callbackUrl = new URL(resolveRedirectUri(req));

  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => callbackUrl.searchParams.append(key, String(item)));
      return;
    }
    if (value != null) {
      callbackUrl.searchParams.set(key, String(value));
    }
  });

  const tokens = await oidcClient.authorizationCodeGrant(configuration, callbackUrl, {
    pkceCodeVerifier: String(transaction?.codeVerifier || ''),
    expectedState: String(transaction?.state || ''),
    expectedNonce: String(transaction?.nonce || ''),
  });

  const idTokenClaims = tokens.claims() || {};
  let mergedClaims = { ...idTokenClaims };

  if (tokens.access_token && configuration.serverMetadata().userinfo_endpoint) {
    try {
      const userInfo = await oidcClient.fetchUserInfo(
        configuration,
        tokens.access_token,
        stringClaim(idTokenClaims.sub) || oidcClient.skipSubjectCheck
      );
      mergedClaims = {
        ...userInfo,
        ...mergedClaims,
      };
    } catch {
      // UserInfo is best-effort. The ID token claims remain the fallback.
    }
  }

  return {
    tokens,
    claims: {
      subject: stringClaim(idTokenClaims.sub),
      email: stringClaim(mergedClaims.email),
      displayName:
        stringClaim(mergedClaims.name)
        || stringClaim(mergedClaims.preferred_username)
        || stringClaim(mergedClaims.email),
      preferredUsername:
        stringClaim(mergedClaims.preferred_username)
        || stringClaim(mergedClaims.email)
        || stringClaim(mergedClaims.name)
        || stringClaim(idTokenClaims.sub),
      issuer: config.oidcIssuer,
    },
  };
}

export async function buildProviderLogoutUrl(req, idTokenHint = '') {
  if (!isOidcEnabled()) return '';
  const configuration = await getOidcConfiguration();
  if (!configuration.serverMetadata().end_session_endpoint) {
    return '';
  }

  const parameters = {};
  if (idTokenHint) {
    parameters.id_token_hint = idTokenHint;
  }
  const postLogoutRedirectUri = resolvePostLogoutRedirectUri(req);
  if (postLogoutRedirectUri) {
    parameters.post_logout_redirect_uri = postLogoutRedirectUri;
  }

  return replaceUrlOrigin(
    buildPublicUrl(oidcClient.buildEndSessionUrl(configuration, parameters), req),
    resolvePublicIssuer(req)
  )?.href || '';
}
