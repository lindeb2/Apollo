import path from 'path';
import fssync from 'fs';
import { config } from './config.js';

function relativeToDbRoot(storedPath) {
  const normalizedStoredPath = path.normalize(storedPath);
  const normalizedDbRoot = path.normalize(config.mediaDbRoot);

  if (
    path.isAbsolute(normalizedStoredPath)
    && normalizedStoredPath.startsWith(`${normalizedDbRoot}${path.sep}`)
  ) {
    return path.relative(normalizedDbRoot, normalizedStoredPath);
  }

  return null;
}

export function buildStoredMediaPath(mediaId, fileName) {
  return path.join(config.mediaDbRoot, `${mediaId}_${fileName}`);
}

export function resolveMediaPath(storedPath) {
  if (!storedPath) return config.mediaRoot;
  if (fssync.existsSync(storedPath)) return storedPath;

  const relativePath = relativeToDbRoot(storedPath);
  if (relativePath) {
    return path.join(config.mediaRoot, relativePath);
  }

  return path.join(config.mediaRoot, path.basename(storedPath));
}
