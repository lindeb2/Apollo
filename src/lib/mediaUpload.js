import { registerMedia, uploadMedia } from './serverApi';

export async function hashBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  if (globalThis?.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  const bytes = new Uint8Array(arrayBuffer);
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

export async function registerAndUploadMediaBlob({
  mediaId,
  blob,
  fileName,
  mimeType,
  session,
}) {
  const safeMediaId = String(mediaId || '').trim();
  if (!safeMediaId) {
    throw new Error('Media upload requires a mediaId.');
  }
  if (!(blob instanceof Blob)) {
    throw new Error('Media upload requires a Blob payload.');
  }

  const registration = await registerMedia({
    mediaId: safeMediaId,
    sha256: await hashBlob(blob),
    mimeType: mimeType || blob.type || 'application/octet-stream',
    sizeBytes: blob.size,
    fileName: fileName || safeMediaId,
  }, session);

  const canonicalMediaId = String(registration?.mediaId || safeMediaId);
  if (!registration?.exists) {
    await uploadMedia(canonicalMediaId, blob, session);
  }

  return {
    mediaId: canonicalMediaId,
    exists: registration?.exists === true,
  };
}
