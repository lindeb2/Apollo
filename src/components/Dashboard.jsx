import { useState, useEffect } from 'react';
import { FolderOpen, Plus, Trash2, FileAudio, Upload } from 'lucide-react';
import { listProjects, deleteProject as deleteProjectFromDB, saveProject } from '../lib/db';
import { importFromJSON, importFromZIP } from '../lib/projectPortability';
import { audioManager } from '../lib/audioManager';
import { storeMediaBlob } from '../lib/db';
import { formatTime } from '../utils/audio';

function Dashboard({ onOpenProject, onNewProject }) {
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

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
    if (!newProjectName.trim()) return;
    onNewProject(newProjectName.trim());
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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <h1 className="text-2xl font-bold">ChoirMaster</h1>
        <p className="text-gray-400 text-sm">Browser-based choir practice file creator</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* New Project Button */}
            <button
              onClick={() => setShowNewProjectDialog(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-6 py-4 flex items-center justify-center gap-3 transition-colors"
            >
              <Plus size={24} />
              <span className="text-lg font-semibold">New Project</span>
            </button>

            {/* Import Project Button */}
            <label className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-6 py-4 flex items-center justify-center gap-3 transition-colors cursor-pointer">
              <Upload size={24} />
              <span className="text-lg font-semibold">
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
                  disabled={!newProjectName.trim()}
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
                    onClick={() => onOpenProject(project.projectId)}
                    className="bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg px-6 py-4 cursor-pointer transition-colors flex items-center justify-between group"
                  >
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">{project.projectName}</h3>
                      <div className="text-sm text-gray-400 mt-1">
                        <span>{project.tracks?.length || 0} tracks</span>
                        <span className="mx-2">•</span>
                        <span>Last modified: {formatDate(project.lastModified)}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteProject(project.projectId, e)}
                      className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 p-2 transition-all"
                      title="Delete project"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

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
