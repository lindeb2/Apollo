import { useEffect, useState } from 'react';
import { FolderOpen, Plus, Download, FileAudio, LogOut } from 'lucide-react';
import { isValidMusicalNumber, normalizeMusicalNumber, normalizeProjectName } from '../utils/naming';

function HostedDashboard({
  session,
  projects,
  onOpenProject,
  onCreateProject,
  onLogout,
  onImportProject,
  onDeleteProject,
  onRenameProject,
  onUpdateMusicalNumber,
  loading = false,
  error = '',
}) {
  const [newProjectName, setNewProjectName] = useState('');
  const [newMusicalNumber, setNewMusicalNumber] = useState('0.0');
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState('');

  const formatRelativeTime = (timestamp) => {
    const numeric = Number(timestamp);
    const value = Number.isFinite(numeric)
      ? numeric
      : Date.parse(String(timestamp || ''));
    if (!Number.isFinite(value)) return 'unknown';

    const diffMs = Date.now() - value;
    if (diffMs < 0) return 'just now';

    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;
    const weekMs = 7 * dayMs;
    const monthMs = 30 * dayMs;
    const yearMs = 365 * dayMs;

    if (diffMs < minuteMs) return 'just now';
    if (diffMs < hourMs) return `${Math.floor(diffMs / minuteMs)} min ago`;
    if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)} h ago`;
    if (diffMs < weekMs) return `${Math.floor(diffMs / dayMs)} d ago`;
    if (diffMs < monthMs) return `${Math.floor(diffMs / weekMs)} w ago`;
    if (diffMs < yearMs) return `${Math.floor(diffMs / monthMs)} mo ago`;
    return `${Math.floor(diffMs / yearMs)} y ago`;
  };

  const handleCreateProject = async () => {
    const normalizedName = normalizeProjectName(newProjectName);
    const normalizedMusicalNumber = normalizeMusicalNumber(newMusicalNumber);
    if (!normalizedName || !isValidMusicalNumber(normalizedMusicalNumber)) return;
    await onCreateProject(normalizedName, normalizedMusicalNumber);
    setNewProjectName('');
    setNewMusicalNumber('0.0');
    setShowNewProjectDialog(false);
  };

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const beginProjectRename = (project) => {
    setEditingProjectId(project.id);
    setEditingProjectName(project.name || '');
  };

  const commitProjectRename = async () => {
    if (!editingProjectId) return;
    const project = (projects || []).find((p) => p.id === editingProjectId);
    if (!project) {
      setEditingProjectId(null);
      setEditingProjectName('');
      return;
    }
    const normalized = normalizeProjectName(editingProjectName);
    if (normalized && normalized !== project.name) {
      await onRenameProject(project, normalized);
    }
    setEditingProjectId(null);
    setEditingProjectName('');
  };

  const cancelProjectRename = () => {
    setEditingProjectId(null);
    setEditingProjectName('');
  };

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Apollo</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNewProjectDialog(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 flex items-center justify-center gap-2 transition-colors disabled:bg-gray-700"
            disabled={loading}
          >
            <Plus size={18} />
            <span className="text-sm font-semibold">New Project</span>
          </button>

          <label className={`bg-green-600 hover:bg-green-700 text-white rounded-lg px-4 py-2 flex items-center justify-center gap-2 transition-colors cursor-pointer ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
            <Download size={18} />
            <span className="text-sm font-semibold">
              {isImporting ? 'Importing...' : 'Import Project'}
            </span>
            <input
              type="file"
              accept=".zip"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setIsImporting(true);
                try {
                  await onImportProject(file);
                } finally {
                  setIsImporting(false);
                  e.target.value = '';
                }
              }}
            />
          </label>

          <button
            onClick={onLogout}
            className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-4 py-2 flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut size={18} />
            <span className="text-sm font-semibold">Logout</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {showNewProjectDialog && (
            <div className="mb-6 bg-gray-800 border border-gray-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Create New Project</h2>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateProject();
                  }
                }}
                placeholder="Enter project name..."
                className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2 mb-4 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <input
                type="text"
                value={newMusicalNumber}
                onChange={(e) => setNewMusicalNumber(e.target.value)}
                placeholder="Musical number (e.g. 0.0, 2.1, 3.dk)"
                className={`w-full bg-gray-900 border rounded px-4 py-2 mb-2 focus:outline-none ${
                  isValidMusicalNumber(newMusicalNumber) ? 'border-gray-700 focus:border-blue-500' : 'border-red-500 focus:border-red-400'
                }`}
              />
              <p className="text-xs text-gray-400 mb-4">Must start with a number and dot, e.g. <code>0.0</code>, <code>2.1</code>, <code>3.dk</code>.</p>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateProject}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 transition-colors disabled:bg-gray-700"
                  disabled={
                    !normalizeProjectName(newProjectName)
                    || !isValidMusicalNumber(newMusicalNumber)
                    || loading
                  }
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowNewProjectDialog(false);
                    setNewProjectName('');
                    setNewMusicalNumber('0.0');
                  }}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error ? (
            <div className="mb-4 rounded border border-red-600/40 bg-red-900/20 px-4 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <FolderOpen size={20} />
              Recent Projects
            </h2>
          </div>

          {projects?.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <FileAudio size={48} className="mx-auto mb-4 opacity-50" />
              <p>No projects yet. Create one to get started!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => {
                    if (editingProjectId === project.id) return;
                    onOpenProject(project);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      project,
                    });
                  }}
                  className="bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg px-6 py-4 transition-colors flex items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="flex-1 text-left min-w-0">
                    {editingProjectId === project.id ? (
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
                      <h3 className="font-semibold text-lg h-[28px] flex items-center truncate">
                        {project.name}
                      </h3>
                    )}
                    <div className="text-sm text-gray-400 mt-1">
                      <span>Musical: {project.musicalNumber || '0.0'}</span>
                      <span className="mx-2">•</span>
                      <span>{project.trackCount ?? 0} tracks</span>
                      <span className="mx-2">•</span>
                      <span>Last modified: {formatRelativeTime(project.updatedAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
            className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
            onClick={async () => {
              const project = contextMenu.project;
              setContextMenu(null);
              const nextRaw = window.prompt(
                'Set musical number (must start with "<number>.", e.g. 2.1)',
                project.musicalNumber || '0.0'
              );
              if (nextRaw === null) return;
              const normalized = normalizeMusicalNumber(nextRaw);
              if (!isValidMusicalNumber(normalized)) {
                window.alert('Invalid musical number format. Example valid values: 0.0, 2.1, 3.dk');
                return;
              }
              await onUpdateMusicalNumber?.(project, normalized);
            }}
          >
            Set Musical Number
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-red-300 hover:bg-gray-700"
            onClick={async () => {
              setContextMenu(null);
              const confirmed = window.confirm(`Delete project "${contextMenu.project.name}"?`);
              if (!confirmed) return;
              await onDeleteProject(contextMenu.project);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default HostedDashboard;
