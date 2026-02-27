import { useState, useEffect } from 'react';
import useStore from './store/useStore';
import Editor from './components/Editor';
import HostedLogin from './components/HostedLogin';
import HostedDashboard from './components/HostedDashboard';
import PlayerDashboard from './components/PlayerDashboard';
import { audioManager } from './lib/audioManager';
import { importFromZIP } from './lib/projectPortability';
import { deleteProject as deleteCachedProject, getMediaBlob, saveRemoteProjectMeta, storeMediaBlob } from './lib/db';
import { normalizeProjectName } from './utils/naming';
import { createId } from './utils/id';
import {
  bootstrapServerProject,
  clearServerSession,
  createServerProject,
  deleteServerProject,
  isServerModeEnabled,
  listServerProjects,
  loadServerSession,
  login,
  logout,
  renameServerProject,
  updateServerProjectMusicalNumber,
  registerMedia,
  saveServerSession,
  uploadMedia,
} from './lib/serverApi';

function collectBlobIds(project) {
  const ids = new Set();
  (project?.tracks || []).forEach((track) => {
    (track?.clips || []).forEach((clip) => {
      if (clip?.blobId) ids.add(clip.blobId);
    });
  });
  return Array.from(ids);
}

async function hashBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  if (globalThis?.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for non-secure contexts (e.g. LAN http) where SubtleCrypto is unavailable.
  const bytes = new Uint8Array(arrayBuffer);
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function App() {
  const [view, setView] = useState('player'); // 'player' | 'daw' | 'editor'
  const [serverSession, setServerSession] = useState(loadServerSession());
  const [serverProjects, setServerProjects] = useState([]);
  const [serverError, setServerError] = useState('');
  const [serverLoading, setServerLoading] = useState(false);
  const [remoteEditorSession, setRemoteEditorSession] = useState(null);
  const { loadProject: loadProjectToStore } = useStore();

  const refreshServerData = async (sessionOverride = null) => {
    const activeSession = sessionOverride || serverSession;
    if (!activeSession) return;

    setServerLoading(true);
    setServerError('');
    try {
      const projects = await listServerProjects(activeSession);
      setServerProjects(projects);
    } catch (error) {
      setServerError(error.message || 'Failed to refresh server data');
    } finally {
      setServerLoading(false);
    }
  };

  useEffect(() => {
    if (!serverSession) return;
    refreshServerData(serverSession);
  }, [serverSession]);

  useEffect(() => {
    const handleSessionUpdated = () => {
      setServerSession(loadServerSession());
    };
    window.addEventListener('apollo:server-session-updated', handleSessionUpdated);
    return () => {
      window.removeEventListener('apollo:server-session-updated', handleSessionUpdated);
    };
  }, []);

  const handleServerLogin = async (username, password) => {
    setServerError('');
    setServerLoading(true);
    try {
      const session = await login(username, password);
      saveServerSession(session);
      setServerSession(session);
      await refreshServerData(session);
      setView('player');
    } catch (error) {
      setServerError(error.message || 'Login failed');
    } finally {
      setServerLoading(false);
    }
  };

  const handleServerLogout = async () => {
    try {
      if (serverSession) {
        await logout(serverSession);
      }
    } catch {
      // ignore logout errors
    }
    clearServerSession();
    setServerSession(null);
    setServerProjects([]);
    setRemoteEditorSession(null);
    setView('player');
  };

  const handleOpenServerProject = async (projectMeta) => {
    setServerError('');
    setServerLoading(true);
    try {
      const payload = await bootstrapServerProject(projectMeta.id, serverSession, 0);
      await loadProjectToStore(payload.snapshot);
      await saveRemoteProjectMeta({
        projectId: payload.snapshot.projectId,
        serverProjectId: projectMeta.id,
        latestSeq: Number(payload.latestSeq || 0),
      });
      setRemoteEditorSession({
        session: serverSession,
        serverProjectId: projectMeta.id,
        latestSeq: Number(payload.latestSeq || 0),
        projectName: projectMeta?.name || payload?.project?.name || payload?.snapshot?.projectName || '',
        musicalNumber: projectMeta?.musicalNumber || payload?.snapshot?.musicalNumber || '0.0',
      });
      setView('editor');
    } catch (error) {
      setServerError(error.message || 'Failed to open project');
    } finally {
      setServerLoading(false);
    }
  };

  const handleCreateServerProject = async (name, musicalNumber) => {
    setServerError('');
    setServerLoading(true);
    try {
      const created = await createServerProject(name, serverSession, { musicalNumber });
      await refreshServerData();
      if (created?.project) {
        await handleOpenServerProject(created.project);
      }
    } catch (error) {
      setServerError(error.message || 'Failed to create project');
    } finally {
      setServerLoading(false);
    }
  };

  const handleImportServerProject = async (file) => {
    setServerError('');
    setServerLoading(true);
    try {
      if (!file?.name?.toLowerCase().endsWith('.zip')) {
        throw new Error('Only .zip project import is supported here.');
      }

      const importedProject = await importFromZIP(
        file,
        storeMediaBlob,
        audioManager.decodeAudioFile.bind(audioManager)
      );

      if (!importedProject) {
        throw new Error('Import cancelled.');
      }

      const importedName = normalizeProjectName(importedProject.projectName)
        || normalizeProjectName(file.name.replace(/\.zip$/i, ''))
        || 'Imported Project';
      const importedProjectId = createId();
      const snapshot = {
        ...importedProject,
        projectId: importedProjectId,
        projectName: importedName,
      };

      const created = await createServerProject(importedName, serverSession, {
        projectId: importedProjectId,
        initialSnapshot: snapshot,
      });

      const blobIds = collectBlobIds(snapshot);
      for (const blobId of blobIds) {
        const media = await getMediaBlob(blobId);
        const sha256 = await hashBlob(media.blob);
        const registration = await registerMedia({
          mediaId: blobId,
          sha256,
          mimeType: media.blob.type || 'application/octet-stream',
          sizeBytes: media.blob.size,
          fileName: media.fileName || `${blobId}.wav`,
        }, serverSession);

        if (!registration.exists) {
          await uploadMedia(blobId, media.blob, serverSession);
        }
      }

      await refreshServerData();
      await handleOpenServerProject(created.project);
    } catch (error) {
      setServerError(error.message || 'Failed to import ZIP project to server');
    } finally {
      setServerLoading(false);
    }
  };

  const handleDeleteServerProject = async (projectMeta) => {
    setServerError('');
    setServerLoading(true);
    try {
      await deleteServerProject(projectMeta.id, serverSession);
      await deleteCachedProject(projectMeta.id).catch(() => {});
      await refreshServerData();
    } catch (error) {
      setServerError(error.message || 'Failed to delete project');
    } finally {
      setServerLoading(false);
    }
  };

  const handleRenameServerProject = async (projectMeta, nextName) => {
    setServerError('');
    setServerLoading(true);
    try {
      await renameServerProject(projectMeta.id, nextName, serverSession);
      await refreshServerData();
    } catch (error) {
      setServerError(error.message || 'Failed to rename project');
    } finally {
      setServerLoading(false);
    }
  };

  const handleUpdateServerProjectMusicalNumber = async (projectMeta, musicalNumber) => {
    setServerError('');
    setServerLoading(true);
    try {
      await updateServerProjectMusicalNumber(projectMeta.id, musicalNumber, serverSession);
      await refreshServerData();
    } catch (error) {
      setServerError(error.message || 'Failed to update musical number');
    } finally {
      setServerLoading(false);
    }
  };

  const handleBackToDashboard = () => {
    setRemoteEditorSession(null);
    setView('daw');
  };

  const handleSwitchToPlayerMode = () => {
    setRemoteEditorSession(null);
    setView('player');
  };

  const handleSwitchToDawMode = () => {
    setRemoteEditorSession(null);
    setView('daw');
  };

  if (!isServerModeEnabled()) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-gray-900 text-white flex items-center justify-center p-6">
        <div className="max-w-xl rounded border border-gray-700 bg-gray-800 p-6">
          <h1 className="text-lg font-semibold mb-2">Server Mode Required</h1>
          <p className="text-sm text-gray-300 mb-2">
            This build is now server-only. Configure `VITE_SERVER_API_BASE` (and optional `VITE_SERVER_WS_BASE`) in your frontend env.
          </p>
          <p className="text-xs text-gray-400">
            Example: `VITE_SERVER_API_BASE=/api` when using docker compose web proxy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-900 text-white">
      {!serverSession ? (
        <HostedLogin
          onLogin={handleServerLogin}
          loading={serverLoading}
          error={serverError}
        />
      ) : view === 'editor' ? (
        <Editor
          onBackToDashboard={handleBackToDashboard}
          onSwitchToPlayerMode={handleSwitchToPlayerMode}
          remoteSession={
            remoteEditorSession
              ? {
                ...remoteEditorSession,
                session: serverSession || null,
              }
              : null
          }
        />
      ) : view === 'daw' ? (
          <HostedDashboard
            session={serverSession}
            projects={serverProjects}
            onOpenProject={handleOpenServerProject}
            onCreateProject={handleCreateServerProject}
            onImportProject={handleImportServerProject}
            onLogout={handleServerLogout}
            onDeleteProject={handleDeleteServerProject}
            onRenameProject={handleRenameServerProject}
            onUpdateMusicalNumber={handleUpdateServerProjectMusicalNumber}
            loading={serverLoading}
            error={serverError}
            onSwitchToPlayerMode={handleSwitchToPlayerMode}
          />
      ) : (
        <PlayerDashboard
          session={serverSession}
          onLogout={handleServerLogout}
          onSwitchToDawDashboard={handleSwitchToDawMode}
          onOpenDawProject={handleOpenServerProject}
        />
      )}
    </div>
  );
}

export default App;
