import JSZip from 'jszip';
import { exportProjectJSON, importProjectJSON, getMediaBlob } from './db';
import { normalizeProjectName } from '../utils/naming';

/**
 * Project Import/Export
 * Handles JSON and ZIP formats
 */

/**
 * Export project as JSON file
 * Contains metadata only, references blobs by ID
 */
export async function exportAsJSON(project) {
  const json = exportProjectJSON(project);
  const base = normalizeProjectName(project.projectName) || 'project';
  const filename = `${base}_project.json`;
  
  const blob = new Blob([json], { type: 'application/json' });
  return { blob, filename };
}

/**
 * Export project as ZIP file
 * Contains project.json + all audio files
 */
export async function exportAsZIP(project, mediaMap, exportBaseName = null, onProgress = null, signal = null) {
  const throwIfAborted = () => {
    if (signal?.aborted) {
      const error = new Error('Export cancelled');
      error.name = 'AbortError';
      throw error;
    }
  };

  const emitProgress = (phase, message, percent) => {
    if (!onProgress) return;
    onProgress({
      phase,
      message,
      percent: Math.max(0, Math.min(100, percent)),
    });
  };

  throwIfAborted();
  emitProgress('prepare', 'Preparing ZIP export...', 1);
  const zip = new JSZip();
  
  // Add project.json
  const projectJson = exportProjectJSON(project);
  zip.file('project.json', projectJson);
  
  // Add media folder with all audio files
  const mediaFolder = zip.folder('media');
  
  // Collect all unique blob IDs
  const blobIds = new Set();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      blobIds.add(clip.blobId);
    }
  }
  const blobIdList = Array.from(blobIds);
  const mediaCount = blobIdList.length;
  
  // Add each audio file
  const missingBlobIds = [];
  let processedMedia = 0;
  for (const blobId of blobIdList) {
    throwIfAborted();
    let media = mediaMap?.get(blobId);
    if (!media?.blob) {
      try {
        media = await getMediaBlob(blobId);
      } catch {
        missingBlobIds.push(blobId);
        processedMedia += 1;
        emitProgress(
          'collect',
          `Collecting media ${processedMedia}/${mediaCount}`,
          mediaCount > 0 ? (processedMedia / mediaCount) * 1 : 1
        );
        continue;
      }
    }

    if (media?.blob) {
      mediaFolder.file(`${blobId}.wav`, media.blob);
    } else {
      missingBlobIds.push(blobId);
    }
    processedMedia += 1;
    emitProgress(
      'collect',
      `Collecting media ${processedMedia}/${mediaCount}`,
      mediaCount > 0 ? (processedMedia / mediaCount) * 1 : 1
    );
  }

  if (missingBlobIds.length > 0) {
    throw new Error(
      `Cannot export ZIP: missing ${missingBlobIds.length} media file(s) in database.`
    );
  }
  
  emitProgress('compress', 'Compressing ZIP archive...', 1);
  throwIfAborted();
  // Generate ZIP
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  }, (metadata) => {
    throwIfAborted();
    emitProgress(
      'compress',
      `Compressing ZIP ${Math.round(metadata.percent)}%`,
      1 + (metadata.percent * 0.99)
    );
  });
  
  const base = normalizeProjectName(exportBaseName || project.projectName) || 'project';
  const filename = `${base}.zip`;
  
  emitProgress('done', 'ZIP export complete', 100);
  return { blob: zipBlob, filename };
}

/**
 * Import project from JSON file
 * Validates blob references exist in IndexedDB
 */
export async function importFromJSON(file) {
  const text = await file.text();
  const project = await importProjectJSON(text);
  return project;
}

/**
 * Import project from ZIP file
 * Extracts project.json and all media files
 */
export async function importFromZIP(file, storeMediaBlob, decodeAudioFile, onProjectParsed = null) {
  const zip = await JSZip.loadAsync(file);
  
  // Read project.json
  const projectFile = zip.file('project.json');
  if (!projectFile) {
    throw new Error('Invalid project ZIP: missing project.json');
  }
  
  const projectJson = await projectFile.async('text');
  const project = JSON.parse(projectJson);
  
  let resolvedProject = project;
  if (typeof onProjectParsed === 'function') {
    const parsedResult = await onProjectParsed(project);
    if (parsedResult === false) {
      return null;
    }
    if (parsedResult && typeof parsedResult === 'object') {
      resolvedProject = parsedResult;
    }
  }
  
  // Extract and store media files
  const mediaFolder = zip.folder('media');
  if (!mediaFolder) {
    throw new Error('Invalid project ZIP: missing media folder');
  }
  
  const mediaFiles = [];
  mediaFolder.forEach((relativePath, file) => {
    if (!file.dir) {
      mediaFiles.push({ relativePath, file });
    }
  });
  
  // Store each media file
  for (const { relativePath, file } of mediaFiles) {
    const blobId = relativePath.replace('.wav', '');
    const blob = await file.async('blob');
    
    // Decode audio
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await decodeAudioFile(arrayBuffer);
    
    // Store in IndexedDB
    await storeMediaBlob(relativePath, audioBuffer, blob, blobId);
    
    console.log(`Imported media: ${blobId}`);
  }
  
  return resolvedProject;
}

/**
 * Trigger browser download
 */
export function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
