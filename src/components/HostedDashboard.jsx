import { useMemo, useState } from 'react';

function HostedDashboard({
  session,
  projects,
  users,
  selectedProjectId,
  permissions,
  onOpenProject,
  onCreateProject,
  onRefresh,
  onLogout,
  onCreateUser,
  onUpdatePermission,
  onImportProject,
  loading = false,
  error = '',
}) {
  const [newProjectName, setNewProjectName] = useState('');
  const [createMode, setCreateMode] = useState('create');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const permissionByUserId = useMemo(() => {
    const map = new Map();
    (permissions || []).forEach((item) => {
      map.set(item.userId, item);
    });
    return map;
  }, [permissions]);

  return (
    <div className="h-full bg-gray-900 text-white flex flex-col">
      <div className="border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">ChoirMaster Server</h1>
          <p className="text-xs text-gray-400">Signed in as {session?.user?.username}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="bg-gray-700 hover:bg-gray-600 rounded px-3 py-2 text-sm"
            onClick={onRefresh}
            disabled={loading}
          >
            Refresh
          </button>
          <button
            className="bg-gray-700 hover:bg-gray-600 rounded px-3 py-2 text-sm"
            onClick={onLogout}
          >
            Logout
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4 p-4 overflow-hidden">
        <div className="rounded border border-gray-700 bg-gray-800 p-3 overflow-auto">
          <div className="flex items-center gap-2 mb-3">
            <select
              className="rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
              value={createMode}
              onChange={(e) => setCreateMode(e.target.value)}
            >
              <option value="create">Create</option>
              <option value="import">Import ZIP</option>
            </select>
            {createMode === 'create' ? (
              <input
                className="flex-1 rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                placeholder="New project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
              />
            ) : (
              <label className="flex-1 rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-300 cursor-pointer hover:bg-gray-850">
                Select .zip project file
                <input
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    await onImportProject(file);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            <button
              className="rounded bg-green-600 hover:bg-green-700 px-3 py-2 text-sm disabled:bg-gray-700"
              disabled={createMode === 'import' || (createMode === 'create' && !newProjectName.trim()) || loading}
              onClick={async () => {
                if (createMode === 'create') {
                  await onCreateProject(newProjectName.trim());
                  setNewProjectName('');
                }
              }}
            >
              Create
            </button>
          </div>

          {error ? <p className="text-sm text-red-300 mb-2">{error}</p> : null}

          <div className="space-y-2">
            {(projects || []).map((project) => (
              <button
                key={project.id}
                className="w-full text-left rounded border border-gray-700 bg-gray-900 hover:bg-gray-850 px-3 py-3"
                onClick={() => onOpenProject(project)}
              >
                <div className="font-medium">{project.name}</div>
                <div className="text-xs text-gray-400 mt-1">
                  Seq: {project.latestSeq ?? 0} · Read: {project.canRead ? 'yes' : 'no'} · Write: {project.canWrite ? 'yes' : 'no'}
                </div>
              </button>
            ))}
            {projects?.length === 0 && (
              <div className="text-sm text-gray-400">No projects available.</div>
            )}
          </div>
        </div>

        {session?.user?.isAdmin ? (
          <div className="rounded border border-gray-700 bg-gray-800 p-3 overflow-auto">
            <h2 className="text-sm font-semibold mb-2">Admin</h2>

            <div className="mb-4 space-y-2">
              <div className="text-xs uppercase text-gray-400">Create User</div>
              <input
                className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                placeholder="Username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
              />
              <input
                type="password"
                className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                placeholder="Password (min 12 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button
                className="rounded bg-blue-600 hover:bg-blue-700 px-3 py-2 text-sm disabled:bg-gray-700"
                disabled={!newUsername.trim() || newPassword.length < 12}
                onClick={async () => {
                  await onCreateUser(newUsername.trim(), newPassword);
                  setNewUsername('');
                  setNewPassword('');
                }}
              >
                Add User
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase text-gray-400">Permissions {selectedProjectId ? `for ${selectedProjectId}` : ''}</div>
              {!selectedProjectId ? (
                <p className="text-sm text-gray-400">Open/select a project to edit permissions.</p>
              ) : (
                (users || []).map((user) => {
                  const permission = permissionByUserId.get(user.id) || { canRead: false, canWrite: false };
                  return (
                    <div key={user.id} className="rounded border border-gray-700 bg-gray-900 px-3 py-2">
                      <div className="text-sm font-medium">{user.username}</div>
                      <div className="mt-2 flex items-center gap-3 text-xs text-gray-300">
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={Boolean(permission.canRead)}
                            onChange={(e) => onUpdatePermission(selectedProjectId, user.id, {
                              canRead: e.target.checked,
                              canWrite: e.target.checked ? Boolean(permission.canWrite) : false,
                            })}
                          />
                          Read
                        </label>
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={Boolean(permission.canWrite)}
                            onChange={(e) => onUpdatePermission(selectedProjectId, user.id, {
                              canRead: e.target.checked ? true : Boolean(permission.canRead),
                              canWrite: e.target.checked,
                            })}
                          />
                          Write
                        </label>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="rounded border border-gray-700 bg-gray-800 p-3 overflow-auto">
            <h2 className="text-sm font-semibold mb-2">Permissions</h2>
            <p className="text-sm text-gray-400">Admin-only permission management panel.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default HostedDashboard;
