import Dexie from 'dexie';

/**
 * ChoirMaster IndexedDB Database
 * 
 * Stores:
 * - projects: Full project metadata and state
 * - media: Audio blob storage with metadata
 * - undo: Undo/redo history (last 100 actions per project)
 * - exportDirs: Last-used export directory handles
 */
class ChoirMasterDB extends Dexie {
  constructor() {
    super('ChoirMasterDB');
    
    this.version(1).stores({
      // Projects table
      // Primary key: projectId
      projects: 'projectId, projectName, lastModified',
      
      // Media blobs table
      // Primary key: blobId
      // Stores audio data as Blob objects
      media: 'blobId, fileName, sampleRate, durationMs, channels, createdAt',
      
      // Undo/redo history table
      // Composite key: [projectId, actionIndex]
      // Stores last 100 actions per project (circular buffer)
      undo: '[projectId+actionIndex], projectId, actionIndex, timestamp',
    });

    this.version(2).stores({
      projects: 'projectId, projectName, lastModified',
      media: 'blobId, fileName, sampleRate, durationMs, channels, createdAt',
      undo: '[projectId+actionIndex], projectId, actionIndex, timestamp',
      exportDirs: 'id, updatedAt',
    });

    this.projects = this.table('projects');
    this.media = this.table('media');
    this.undo = this.table('undo');
    this.exportDirs = this.table('exportDirs');
  }
}

// Singleton instance
export const db = new ChoirMasterDB();

/**
 * Save a project to IndexedDB
 */
export async function saveProject(project) {
  const projectData = {
    ...project,
    lastModified: Date.now(),
  };
  
  await db.projects.put(projectData);
  
  // Update localStorage for recent projects list
  updateRecentProjects(project.projectId, project.projectName);
  
  return projectData;
}

/**
 * Load a project from IndexedDB
 */
export async function loadProject(projectId) {
  const project = await db.projects.get(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }
  return project;
}

/**
 * Delete a project and its undo history
 */
export async function deleteProject(projectId) {
  await db.transaction('rw', [db.projects, db.undo], async () => {
    await db.projects.delete(projectId);
    await db.undo.where('projectId').equals(projectId).delete();
  });
  
  // Update recent projects
  const recent = getRecentProjects().filter(p => p.id !== projectId);
  localStorage.setItem('choirmaster_recent_projects', JSON.stringify(recent));
}

/**
 * List all projects
 */
export async function listProjects() {
  return await db.projects.toArray();
}

/**
 * Store audio blob in media table
 */
export async function storeMediaBlob(fileName, audioBuffer, blob, blobId = null) {
  const id = blobId || crypto.randomUUID();
  
  const mediaData = {
    blobId: id,
    fileName,
    sampleRate: audioBuffer.sampleRate,
    durationMs: (audioBuffer.duration * 1000), // Convert to ms
    channels: audioBuffer.numberOfChannels,
    blob, // Store the actual Blob
    createdAt: Date.now(),
  };
  
  await db.media.put(mediaData);
  
  return id;
}

/**
 * Retrieve media blob
 */
export async function getMediaBlob(blobId) {
  const media = await db.media.get(blobId);
  if (!media) {
    throw new Error(`Media blob ${blobId} not found`);
  }
  return media;
}

/**
 * Check if media blob exists
 */
export async function mediaExists(blobId) {
  const count = await db.media.where('blobId').equals(blobId).count();
  return count > 0;
}

/**
 * Save undo/redo action (circular buffer, max 100)
 */
export async function saveUndoAction(projectId, action, currentIndex) {
  const actionIndex = currentIndex % 100; // Circular buffer
  
  const undoData = {
    projectId,
    actionIndex,
    action,
    timestamp: Date.now(),
  };
  
  await db.undo.put(undoData);
}

/**
 * Load undo history for a project
 */
export async function loadUndoHistory(projectId) {
  const actions = await db.undo
    .where('projectId')
    .equals(projectId)
    .sortBy('actionIndex');
  
  return actions.map(a => a.action);
}

/**
 * Clear undo history for a project
 */
export async function clearUndoHistory(projectId) {
  await db.undo.where('projectId').equals(projectId).delete();
}

/**
 * Recent projects management (localStorage)
 */
function updateRecentProjects(projectId, projectName) {
  const recent = getRecentProjects();
  
  // Remove if already exists
  const filtered = recent.filter(p => p.id !== projectId);
  
  // Add to front
  filtered.unshift({
    id: projectId,
    name: projectName,
    timestamp: Date.now(),
  });
  
  // Keep only last 10
  const limited = filtered.slice(0, 10);
  
  localStorage.setItem('choirmaster_recent_projects', JSON.stringify(limited));
}

export function getRecentProjects() {
  try {
    const data = localStorage.getItem('choirmaster_recent_projects');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Save directory handle for export location.
 */
export async function saveExportDirectoryHandle(id, handle) {
  await db.exportDirs.put({
    id,
    handle,
    updatedAt: Date.now(),
  });
}

/**
 * Load directory handle for export location.
 */
export async function loadExportDirectoryHandle(id) {
  const row = await db.exportDirs.get(id);
  return row?.handle || null;
}

/**
 * Export utilities
 */

/**
 * Export project as JSON
 * Returns project metadata only (references blobs by ID)
 */
export function exportProjectJSON(project) {
  return JSON.stringify(project, null, 2);
}

/**
 * Import project from JSON
 * Validates that all referenced blobs exist in IndexedDB
 */
export async function importProjectJSON(jsonString) {
  const project = JSON.parse(jsonString);
  
  // Validate version
  if (project.version !== '1.0.0') {
    throw new Error(`Unsupported project version: ${project.version}`);
  }
  
  // Collect all referenced blob IDs
  const blobIds = new Set();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      blobIds.add(clip.blobId);
    }
  }
  
  // Verify all blobs exist
  const missingBlobs = [];
  for (const blobId of blobIds) {
    const exists = await mediaExists(blobId);
    if (!exists) {
      missingBlobs.push(blobId);
    }
  }
  
  if (missingBlobs.length > 0) {
    throw new Error(
      `Missing audio blobs: ${missingBlobs.join(', ')}. ` +
      `Please import using ZIP format to restore all audio data.`
    );
  }
  
  // Save project
  await saveProject(project);
  
  return project;
}
