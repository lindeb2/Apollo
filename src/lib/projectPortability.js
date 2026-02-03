import JSZip from 'jszip';
import { exportProjectJSON, importProjectJSON } from './db';
import { sanitizeFilename } from '../utils/audio';

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
  const filename = sanitizeFilename(project.projectName) + '_project.json';
  
  const blob = new Blob([json], { type: 'application/json' });
  return { blob, filename };
}

/**
 * Export project as ZIP file
 * Contains project.json + all audio files
 */
export async function exportAsZIP(project, mediaMap) {
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
  
  // Add each audio file
  for (const blobId of blobIds) {
    const media = mediaMap.get(blobId);
    if (media && media.blob) {
      const filename = `${blobId}.wav`;
      mediaFolder.file(filename, media.blob);
    }
  }
  
  // Generate ZIP
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  
  const filename = sanitizeFilename(project.projectName) + '_project.zip';
  
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
export async function importFromZIP(file, storeMediaBlob, decodeAudioFile) {
  const zip = await JSZip.loadAsync(file);
  
  // Read project.json
  const projectFile = zip.file('project.json');
  if (!projectFile) {
    throw new Error('Invalid project ZIP: missing project.json');
  }
  
  const projectJson = await projectFile.async('text');
  const project = JSON.parse(projectJson);
  
  // Validate version
  if (project.version !== '1.0.0') {
    throw new Error(`Unsupported project version: ${project.version}`);
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
  
  return project;
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
