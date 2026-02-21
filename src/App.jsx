import { useState, useEffect } from 'react';
import useStore from './store/useStore';
import Editor from './components/Editor';
import HostedLogin from './components/HostedLogin';
import HostedDashboard from './components/HostedDashboard';
import { audioManager } from './lib/audioManager';
import { importFromZIP } from './lib/projectPortability';
import { getMediaBlob, saveRemoteProjectMeta, storeMediaBlob } from './lib/db';
import { normalizeProjectName } from './utils/naming';
import {
  bootstrapServerProject,
  clearServerSession,
  createServerProject,
  createUser,
  getProjectPermissions,
  isServerModeEnabled,
  listServerProjects,
  listUsers,
  loadServerSession,
  login,
  logout,
  registerMedia,
  saveServerSession,
  setProjectPermission,
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
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function App() {
  const [view, setView] = useState('dashboard'); // 'dashboard' | 'editor'
  const [serverSession, setServerSession] = useState(loadServerSession());
  const [serverProjects, setServerProjects] = useState([]);
  const [serverUsers, setServerUsers] = useState([]);
  const [selectedServerProjectId, setSelectedServerProjectId] = useState(null);
  const [serverPermissions, setServerPermissions] = useState([]);
  const [serverError, setServerError] = useState('');
  const [serverLoading, setServerLoading] = useState(false);
  const [remoteEditorSession, setRemoteEditorSession] = useState(null);
  const { loadProject: loadProjectToStore } = useStore();

  const refreshServerData = async (projectIdOverride = null, sessionOverride = null) => {
    const activeSession = sessionOverride || serverSession;
    if (!activeSession) return;

    setServerLoading(true);
    setServerError('');
    try {
      const projects = await listServerProjects(activeSession);
      setServerProjects(projects);

      const effectiveProjectId = projectIdOverride ?? selectedServerProjectId;
      if (activeSession.user?.isAdmin) {
        const users = await listUsers(activeSession);
        setServerUsers(users);
      } else {
        setServerUsers([]);
      }

      if (effectiveProjectId) {
        const permissions = await getProjectPermissions(effectiveProjectId, activeSession);
        setServerPermissions(permissions);
      } else {
        setServerPermissions([]);
      }
    } catch (error) {
      setServerError(error.message || 'Failed to refresh server data');
    } finally {
      setServerLoading(false);
    }
  };

  useEffect(() => {
    if (!serverSession) return;
    refreshServerData(undefined, serverSession);
  }, [serverSession]);

  const handleServerLogin = async (username, password) => {
    setServerError('');
    setServerLoading(true);
    try {
      const session = await login(username, password);
      saveServerSession(session);
      setServerSession(session);
      await refreshServerData(undefined, session);
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
    setServerUsers([]);
    setServerPermissions([]);
    setSelectedServerProjectId(null);
    setRemoteEditorSession(null);
    setView('dashboard');
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
      setSelectedServerProjectId(projectMeta.id);
      setRemoteEditorSession({
        session: serverSession,
        serverProjectId: projectMeta.id,
        latestSeq: Number(payload.latestSeq || 0),
      });
      setView('editor');
    } catch (error) {
      setServerError(error.message || 'Failed to open project');
    } finally {
      setServerLoading(false);
    }
  };

  const handleCreateServerProject = async (name) => {
    setServerError('');
    setServerLoading(true);
    try {
      const created = await createServerProject(name, serverSession);
      await refreshServerData(created?.project?.id || null);
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
      const importedProjectId = crypto.randomUUID();
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

      await refreshServerData(created?.project?.id || null);
      await handleOpenServerProject(created.project);
    } catch (error) {
      setServerError(error.message || 'Failed to import ZIP project to server');
    } finally {
      setServerLoading(false);
    }
  };

  const handleCreateServerUser = async (username, password) => {
    try {
      await createUser({ username, password, isAdmin: false }, serverSession);
      await refreshServerData();
    } catch (error) {
      setServerError(error.message || 'Failed to create user');
    }
  };

  const handleUpdateServerPermission = async (projectId, userId, permission) => {
    try {
      await setProjectPermission(projectId, userId, permission, serverSession);
      setSelectedServerProjectId(projectId);
      await refreshServerData(projectId);
    } catch (error) {
      setServerError(error.message || 'Failed to update permission');
    }
  };

  const handleBackToDashboard = () => {
    setRemoteEditorSession(null);
    setView('dashboard');
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
      {view === 'dashboard' ? (
        serverSession ? (
          <HostedDashboard
            session={serverSession}
            projects={serverProjects}
            users={serverUsers}
            selectedProjectId={selectedServerProjectId}
            permissions={serverPermissions}
            onOpenProject={handleOpenServerProject}
            onCreateProject={handleCreateServerProject}
            onImportProject={handleImportServerProject}
            onRefresh={() => refreshServerData()}
            onLogout={handleServerLogout}
            onCreateUser={handleCreateServerUser}
            onUpdatePermission={handleUpdateServerPermission}
            loading={serverLoading}
            error={serverError}
          />
        ) : (
          <HostedLogin
            onLogin={handleServerLogin}
            loading={serverLoading}
            error={serverError}
          />
        )
      ) : (
        <Editor
          onBackToDashboard={handleBackToDashboard}
          remoteSession={
            remoteEditorSession
              ? {
                ...remoteEditorSession,
                session: loadServerSession() || remoteEditorSession.session,
              }
              : null
          }
        />
      )}
    </div>
  );
}

export default App;
