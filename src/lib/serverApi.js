import { createEmptyProject } from '../types/project';

const API_BASE = import.meta.env.VITE_SERVER_API_BASE || '';
const WS_BASE = import.meta.env.VITE_SERVER_WS_BASE || '';

const SESSION_KEY = 'choirmaster.server.session';

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function isServerModeEnabled() {
  return Boolean(API_BASE || WS_BASE);
}

export function getApiBase() {
  return API_BASE;
}

export function getWsUrl() {
  if (WS_BASE) {
    if (WS_BASE.startsWith('ws://') || WS_BASE.startsWith('wss://')) return WS_BASE;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const normalized = WS_BASE.startsWith('/') ? WS_BASE : `/${WS_BASE}`;
    return `${protocol}//${window.location.host}${normalized}`;
  }

  if (!API_BASE) return '';
  if (API_BASE.startsWith('http://') || API_BASE.startsWith('https://')) {
    const origin = API_BASE.replace(/\/+$/, '').replace(/\/api$/, '');
    return origin.replace(/^http/i, 'ws') + '/ws';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const pathBase = API_BASE.startsWith('/') ? API_BASE : `/${API_BASE}`;
  const normalizedBase = pathBase.replace(/\/+$/, '').replace(/\/api$/, '');
  return `${protocol}//${window.location.host}${normalizedBase}/ws`;
}

export function saveServerSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadServerSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return null;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearServerSession() {
  localStorage.removeItem(SESSION_KEY);
}

async function apiFetch(path, options = {}, session = null, retryOnAuth = true) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof Blob) && !(options.body instanceof ArrayBuffer) && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (session?.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }

  const normalizedBase = (API_BASE || '').replace(/\/+$/, '');
  let normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedBase.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    normalizedPath = normalizedPath.slice(4);
  }

  const response = await fetch(`${normalizedBase}${normalizedPath}`, {
    ...options,
    headers,
    body: options.body instanceof Blob || options.body instanceof ArrayBuffer || options.body instanceof FormData
      ? options.body
      : (typeof options.body === 'string' ? options.body : (options.body ? JSON.stringify(options.body) : undefined)),
  });

  if (response.status === 401 && session?.refreshToken && retryOnAuth) {
    const refreshed = await refreshSession(session.refreshToken);
    saveServerSession(refreshed);
    return await apiFetch(path, options, refreshed, false);
  }

  if (!response.ok) {
    let errorMessage = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.error) errorMessage = body.error;
    } catch {
      // ignore parse failure
    }
    throw new Error(errorMessage);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await response.json();
  }

  return response;
}

export async function login(username, password) {
  const payload = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  return payload;
}

export async function refreshSession(refreshToken) {
  const payload = await apiFetch('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  }, null, false);
  return payload;
}

export async function logout(session) {
  await apiFetch('/api/auth/logout', {
    method: 'POST',
    body: { refreshToken: session?.refreshToken || null },
  }, session, false);
}

export async function listServerProjects(session) {
  const payload = await apiFetch('/api/projects', {}, session);
  return payload.projects || [];
}

export async function createServerProject(name, session, options = null) {
  const initial = options?.initialSnapshot && typeof options.initialSnapshot === 'object'
    ? options.initialSnapshot
    : createEmptyProject(name);
  const projectId = String(options?.projectId || initial.projectId || crypto.randomUUID());
  const projectName = String(options?.name || name || initial.projectName || '').trim();
  const snapshot = {
    ...initial,
    projectId,
    projectName: projectName || initial.projectName,
  };

  const payload = await apiFetch('/api/projects', {
    method: 'POST',
    body: {
      name: snapshot.projectName,
      projectId,
      initialSnapshot: snapshot,
    },
  }, session);
  return payload;
}

export async function bootstrapServerProject(projectId, session, knownSeq = 0) {
  return await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/bootstrap?knownSeq=${Number(knownSeq || 0)}`, {}, session);
}

export async function listUsers(session) {
  const payload = await apiFetch('/api/admin/users', {}, session);
  return payload.users || [];
}

export async function createUser(user, session) {
  return await apiFetch('/api/admin/users', {
    method: 'POST',
    body: user,
  }, session);
}

export async function updateUser(userId, updates, session) {
  return await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: updates,
  }, session);
}

export async function getProjectPermissions(projectId, session) {
  const payload = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/permissions`, {}, session);
  return payload.permissions || [];
}

export async function setProjectPermission(projectId, userId, permission, session) {
  return await apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/permissions/${encodeURIComponent(userId)}`,
    {
      method: 'PUT',
      body: permission,
    },
    session
  );
}

export async function registerMedia(payload, session) {
  return await apiFetch('/api/media/register', {
    method: 'POST',
    body: payload,
  }, session);
}

export async function uploadMedia(mediaId, blob, session) {
  await apiFetch(`/api/media/${encodeURIComponent(mediaId)}/content`, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
    },
    body: blob,
  }, session);
}

export async function resolveMedia(mediaIds, session) {
  return await apiFetch('/api/media/batch-resolve', {
    method: 'POST',
    body: { mediaIds },
  }, session);
}

export async function downloadMediaBlob(mediaId, session) {
  const response = await apiFetch(`/api/media/${encodeURIComponent(mediaId)}`, {
    method: 'GET',
  }, session);
  return await response.blob();
}

export async function forceCheckpoint(projectId, session) {
  return await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/checkpoint`, {
    method: 'POST',
    body: {},
  }, session);
}
