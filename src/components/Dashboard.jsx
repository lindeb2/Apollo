import { useState, useEffect, useRef } from 'react';
import { FolderOpen, Plus, FileAudio, Upload, Settings } from 'lucide-react';
import { listProjects, deleteProject as deleteProjectFromDB, saveProject } from '../lib/db';
import { importFromJSON, importFromZIP } from '../lib/projectPortability';
import { audioManager } from '../lib/audioManager';
import { storeMediaBlob } from '../lib/db';
import { formatTime, PAN_LAW_OPTIONS_DB, normalizePanLawDb } from '../utils/audio';
import { AUTO_PAN_STRATEGIES } from '../utils/choirAutoPan';
import { normalizeProjectName } from '../utils/naming';

function Dashboard({ onOpenProject, onNewProject }) {
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioInputs, setAudioInputs] = useState([]);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [audioSettings, setAudioSettings] = useState({
    inputDeviceId: '',
    outputDeviceId: '',
    recordingOffsetMs: 0,
    defaultChoirPanning: 'off',
    defaultInvertedAutoPan: false,
    defaultManualChoirParts: false,
    defaultPanLawDb: -3,
    defaultExportGainDb: 4,
    defaultExportAttenuationDb: 4,
    defaultExportPanRange: 100,
  });
  const hasHydratedSettingsRef = useRef(false);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('choirmaster.settings');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      setAudioSettings((prev) => ({
        ...prev,
        ...parsed,
        recordingOffsetMs:
          typeof parsed.recordingOffsetMs === 'number'
            ? parsed.recordingOffsetMs
            : prev.recordingOffsetMs,
        defaultChoirPanning:
          typeof parsed.defaultChoirPanning === 'string'
            ? parsed.defaultChoirPanning
            : prev.defaultChoirPanning,
        defaultInvertedAutoPan:
          typeof parsed.defaultInvertedAutoPan === 'boolean'
            ? parsed.defaultInvertedAutoPan
            : prev.defaultInvertedAutoPan,
        defaultManualChoirParts:
          typeof parsed.defaultManualChoirParts === 'boolean'
            ? parsed.defaultManualChoirParts
            : prev.defaultManualChoirParts,
        defaultPanLawDb: normalizePanLawDb(parsed.defaultPanLawDb),
        defaultExportGainDb:
          typeof parsed.defaultExportGainDb === 'number'
            ? parsed.defaultExportGainDb
            : prev.defaultExportGainDb,
        defaultExportAttenuationDb:
          typeof parsed.defaultExportAttenuationDb === 'number'
            ? parsed.defaultExportAttenuationDb
            : prev.defaultExportAttenuationDb,
        defaultExportPanRange:
          typeof parsed.defaultExportPanRange === 'number'
            ? parsed.defaultExportPanRange
            : prev.defaultExportPanRange,
      }));
    } catch {
      // Ignore invalid settings
    }
  }, []);

  const choirPanOptions = [
    { id: 'off', label: 'Off' },
    ...AUTO_PAN_STRATEGIES,
  ];

  useEffect(() => {
    if (!hasHydratedSettingsRef.current) {
      hasHydratedSettingsRef.current = true;
      return;
    }
    localStorage.setItem('choirmaster.settings', JSON.stringify(audioSettings));
  }, [audioSettings]);

  const loadProjects = async () => {
    try {
      const projectList = await listProjects();
      // Sort by last modified, newest first
      projectList.sort((a, b) => b.lastModified - a.lastModified);
      setProjects(projectList);
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  };

  const handleCreateProject = () => {
    const normalizedName = normalizeProjectName(newProjectName);
    if (!normalizedName) return;
    onNewProject(normalizedName);
    setNewProjectName('');
    setShowNewProjectDialog(false);
  };

  const handleDeleteProject = async (projectId, e) => {
    e.stopPropagation();
    
    if (!confirm('Are you sure you want to delete this project?')) {
      return;
    }

    try {
      await deleteProjectFromDB(projectId);
      await loadProjects();
    } catch (error) {
      console.error('Failed to delete project:', error);
      alert('Failed to delete project: ' + error.message);
    }
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleImportProject = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsImporting(true);

    try {
      let project;

      if (file.name.endsWith('.json')) {
        // Import JSON
        project = await importFromJSON(file);
        console.log('Imported project from JSON');
      } else if (file.name.endsWith('.zip')) {
        // Import ZIP
        project = await importFromZIP(
          file,
          storeMediaBlob,
          audioManager.decodeAudioFile.bind(audioManager)
        );
        console.log('Imported project from ZIP');
      } else {
        throw new Error('Unsupported file format. Use .json or .zip');
      }

      // Save project to database
      await saveProject(project);

      // Reload projects list
      await loadProjects();

      alert('Project imported successfully!');
    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed: ' + error.message);
    } finally {
      setIsImporting(false);
      e.target.value = ''; // Reset file input
    }
  };

  const refreshAudioDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let devices = await navigator.mediaDevices.enumerateDevices();
    const hasLabels = devices.some((device) => device.label);
    if (!hasLabels) {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch {
        // Permission denied or unavailable; keep unlabeled devices
      }
    }
    setAudioInputs(devices.filter((device) => device.kind === 'audioinput'));
    setAudioOutputs(devices.filter((device) => device.kind === 'audiooutput'));
  };

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
    };
  }, []);

  const beginProjectRename = (project) => {
    setEditingProjectId(project.projectId);
    setEditingProjectName(project.projectName);
  };

  const commitProjectRename = async () => {
    if (!editingProjectId) return;
    const project = projects.find((p) => p.projectId === editingProjectId);
    if (!project) {
      setEditingProjectId(null);
      setEditingProjectName('');
      return;
    }
    const trimmed = normalizeProjectName(editingProjectName);
    if (trimmed && trimmed !== project.projectName) {
      const updated = { ...project, projectName: trimmed, lastModified: Date.now() };
      await saveProject(updated);
      await loadProjects();
    }
    setEditingProjectId(null);
    setEditingProjectName('');
  };

  const cancelProjectRename = () => {
    setEditingProjectId(null);
    setEditingProjectName('');
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">ChoirMaster</h1>
          <button
            className="p-2 rounded-md hover:bg-gray-700 text-gray-300"
            title="Settings"
            onClick={() => {
              setSettingsOpen(true);
              refreshAudioDevices();
            }}
          >
            <Settings size={18} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNewProjectDialog(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 flex items-center justify-center gap-2 transition-colors"
          >
            <Plus size={18} />
            <span className="text-sm font-semibold">New Project</span>
          </button>

          <label className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-4 py-2 flex items-center justify-center gap-2 transition-colors cursor-pointer">
            <Upload size={18} />
            <span className="text-sm font-semibold">
              {isImporting ? 'Importing...' : 'Import Project'}
            </span>
            <input
              type="file"
              accept=".json,.zip"
              onChange={handleImportProject}
              disabled={isImporting}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* New Project Dialog */}
          {showNewProjectDialog && (
            <div className="mb-6 bg-gray-800 border border-gray-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Create New Project</h2>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                placeholder="Enter project name..."
                className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2 mb-4 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreateProject}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 transition-colors"
                  disabled={!normalizeProjectName(newProjectName)}
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowNewProjectDialog(false);
                    setNewProjectName('');
                  }}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Recent Projects */}
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <FolderOpen size={20} />
              Recent Projects
            </h2>

            {projects.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <FileAudio size={48} className="mx-auto mb-4 opacity-50" />
                <p>No projects yet. Create one to get started!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {projects.map((project) => (
                  <div
                    key={project.projectId}
                    onClick={() => {
                      if (editingProjectId === project.projectId) return;
                      onOpenProject(project.projectId);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        project,
                      });
                    }}
                    className="bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg px-6 py-4 cursor-pointer transition-colors flex items-center justify-between"
                  >
                    <div className="flex-1">
                      {editingProjectId === project.projectId ? (
                        <input
                          type="text"
                          value={editingProjectName}
                          autoFocus
                          onChange={(e) => setEditingProjectName(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={commitProjectRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              commitProjectRename();
                            } else if (e.key === 'Escape') {
                              cancelProjectRename();
                            }
                          }}
                          className="font-semibold text-lg bg-transparent border-b border-blue-500 px-0 py-0 leading-none focus:outline-none w-full h-[28px]"
                        />
                      ) : (
                        <h3
                          className="font-semibold text-lg h-[28px] flex items-center"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            beginProjectRename(project);
                          }}
                        >
                          {project.projectName}
                        </h3>
                      )}
                      <div className="text-sm text-gray-400 mt-1">
                        <span>{project.tracks?.length || 0} tracks</span>
                        <span className="mx-2">•</span>
                        <span>Last modified: {formatDate(project.lastModified)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
            onClick={() => {
              beginProjectRename(contextMenu.project);
              setContextMenu(null);
            }}
          >
            Rename
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-red-300 hover:bg-gray-700"
            onClick={(e) => {
              handleDeleteProject(contextMenu.project.projectId, e);
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-800 shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
              <div className="text-sm font-semibold">Settings</div>
              <button
                className="text-gray-400 hover:text-gray-200"
                onClick={() => setSettingsOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="px-4 py-3">
              <div className="mb-3 text-xs uppercase tracking-wide text-gray-400">Audio</div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Input device</label>
                  <select
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={audioSettings.inputDeviceId}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({ ...prev, inputDeviceId: e.target.value }))
                    }
                  >
                    <option value="">Default</option>
                    {audioInputs.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Input ${device.deviceId.slice(0, 6)}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Output device</label>
                  <select
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={audioSettings.outputDeviceId}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({ ...prev, outputDeviceId: e.target.value }))
                    }
                  >
                    <option value="">Default</option>
                    {audioOutputs.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Output ${device.deviceId.slice(0, 6)}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Recording offset (ms)</label>
                  <input
                    type="number"
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={audioSettings.recordingOffsetMs}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({
                        ...prev,
                        recordingOffsetMs: Number(e.target.value),
                      }))
                    }
                  />
                </div>
                <button
                  className="text-xs text-gray-400 hover:text-gray-200"
                  onClick={refreshAudioDevices}
                >
                  Refresh device list
                </button>
              </div>

              <div className="mt-6 mb-3 text-xs uppercase tracking-wide text-gray-400">
                Default New Project Settings
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Default choir auto-pan (new projects)
                  </label>
                  <select
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={audioSettings.defaultChoirPanning}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({
                        ...prev,
                        defaultChoirPanning: e.target.value,
                      }))
                    }
                  >
                    {choirPanOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-600 bg-gray-900"
                    checked={audioSettings.defaultInvertedAutoPan}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({
                        ...prev,
                        defaultInvertedAutoPan: e.target.checked,
                      }))
                    }
                  />
                  <span>Inverted Auto Pan</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-600 bg-gray-900"
                    checked={audioSettings.defaultManualChoirParts}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({
                        ...prev,
                        defaultManualChoirParts: e.target.checked,
                      }))
                    }
                  />
                  <span>Manually select choir parts</span>
                </label>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Panning law</label>
                  <select
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={String(audioSettings.defaultPanLawDb)}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({
                        ...prev,
                        defaultPanLawDb: normalizePanLawDb(Number(e.target.value)),
                      }))
                    }
                  >
                    {PAN_LAW_OPTIONS_DB.map((value) => (
                      <option key={value} value={value}>
                        {`${value} dB`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">dB gain</label>
                  <input
                    type="number"
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={audioSettings.defaultExportGainDb}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({
                        ...prev,
                        defaultExportGainDb: Number(e.target.value),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">dB attenuation</label>
                  <input
                    type="number"
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={audioSettings.defaultExportAttenuationDb}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({
                        ...prev,
                        defaultExportAttenuationDb: Number(e.target.value),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">transformed pan range</label>
                  <input
                    type="number"
                    className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={audioSettings.defaultExportPanRange}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({
                        ...prev,
                        defaultExportPanRange: Number(e.target.value),
                      }))
                    }
                  />
                </div>
              </div>
            </div>
            <div className="border-t border-gray-700 px-4 py-3 flex justify-end">
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white rounded px-3 py-2 text-sm"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="bg-gray-800 border-t border-gray-700 mt-auto inline-flex items-center justify-center gap-1 px-4 py-4 text-sm text-gray-300">
        Created with
        <svg
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="inline-block h-4 w-4 fill-current"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"
          />
        </svg>
        by
        <a href="mailto:lindeb2@kth.se" className="link-underline text-gray-200">
          Johan Lindeberg
        </a>
      </div>
    </div>
  );
}

export default Dashboard;
