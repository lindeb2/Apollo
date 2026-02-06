import { useState, useEffect } from 'react';
import useStore from './store/useStore';
import { listProjects, loadProject, deleteProject } from './lib/db';
import Dashboard from './components/Dashboard';
import Editor from './components/Editor';

function App() {
  const [view, setView] = useState('dashboard'); // 'dashboard' | 'editor'
  const { project, loadProject: loadProjectToStore, initProject } = useStore();

  // Load project from IndexedDB into store
  const handleOpenProject = async (projectId) => {
    try {
      const projectData = await loadProject(projectId);
      await loadProjectToStore(projectData);
      setView('editor');
    } catch (error) {
      console.error('Failed to load project:', error);
      alert('Failed to load project: ' + error.message);
    }
  };

  // Create new project
  const handleNewProject = (name) => {
    initProject(name);
    setView('editor');
  };

  // Return to dashboard
  const handleBackToDashboard = () => {
    setView('dashboard');
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-900 text-white">
      {view === 'dashboard' ? (
        <Dashboard
          onOpenProject={handleOpenProject}
          onNewProject={handleNewProject}
        />
      ) : (
        <Editor onBackToDashboard={handleBackToDashboard} />
      )}
    </div>
  );
}

export default App;
