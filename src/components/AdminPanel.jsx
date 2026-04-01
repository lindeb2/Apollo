import { useEffect, useMemo, useState } from 'react';
import {
  getProjectPermissions,
  linkOidcIdentity,
  listUsers,
  setProjectPermission,
  updateUser,
} from '../lib/serverApi';

function PermissionToggle({
  checked,
  disabled = false,
  label,
  onChange,
}) {
  return (
    <label className={`inline-flex items-center gap-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        className="rounded border-gray-600 bg-gray-900"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function StatusPill({ children, tone = 'slate' }) {
  const toneClass = {
    slate: 'bg-gray-700 text-gray-200',
    green: 'bg-green-900/40 text-green-200',
    amber: 'bg-amber-900/40 text-amber-200',
    blue: 'bg-blue-900/40 text-blue-200',
  }[tone] || 'bg-gray-700 text-gray-200';

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${toneClass}`}>
      {children}
    </span>
  );
}

export default function AdminPanel({
  open = false,
  session = null,
  projects = [],
  onClose,
}) {
  const [tab, setTab] = useState('users');
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [panelError, setPanelError] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectPermissions, setProjectPermissions] = useState([]);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [linkTargets, setLinkTargets] = useState({});

  const activeUsers = useMemo(
    () => users.filter((user) => user.isActive),
    [users]
  );
  const pendingOidcUsers = useMemo(
    () => users.filter((user) => user.pendingOidc),
    [users]
  );
  const projectPermissionMap = useMemo(() => {
    const next = new Map();
    projectPermissions.forEach((permission) => {
      next.set(permission.userId, permission);
    });
    return next;
  }, [projectPermissions]);

  const loadUsers = async () => {
    setLoading(true);
    setPanelError('');
    try {
      const nextUsers = await listUsers(session);
      setUsers(nextUsers);
      setLinkTargets((previous) => {
        const next = { ...previous };
        nextUsers.forEach((user) => {
          if (!next[user.id]) {
            next[user.id] = '';
          }
        });
        return next;
      });
    } catch (error) {
      setPanelError(error.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const loadPermissions = async (projectId) => {
    if (!projectId) {
      setProjectPermissions([]);
      return;
    }

    setPermissionLoading(true);
    setPermissionError('');
    try {
      const nextPermissions = await getProjectPermissions(projectId, session);
      setProjectPermissions(nextPermissions);
    } catch (error) {
      setPermissionError(error.message || 'Failed to load project permissions');
    } finally {
      setPermissionLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    loadUsers();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!selectedProjectId && projects?.[0]?.id) {
      setSelectedProjectId(projects[0].id);
      return;
    }
    if (selectedProjectId) {
      loadPermissions(selectedProjectId);
    }
  }, [open, selectedProjectId, projects]);

  const handleUserUpdate = async (userId, updates) => {
    setPanelError('');
    try {
      await updateUser(userId, updates, session);
      await loadUsers();
    } catch (error) {
      setPanelError(error.message || 'Failed to update user');
    }
  };

  const handleLinkUser = async (pendingUserId) => {
    const targetUserId = String(linkTargets[pendingUserId] || '');
    if (!targetUserId) return;

    setPanelError('');
    try {
      await linkOidcIdentity(targetUserId, pendingUserId, session);
      await loadUsers();
      if (selectedProjectId) {
        await loadPermissions(selectedProjectId);
      }
    } catch (error) {
      setPanelError(error.message || 'Failed to link OIDC identity');
    }
  };

  const handlePermissionChange = async (userId, updates) => {
    if (!selectedProjectId) return;
    const current = projectPermissionMap.get(userId) || { canRead: false, canWrite: false };
    const next = {
      canRead: updates.canRead ?? current.canRead,
      canWrite: updates.canWrite ?? current.canWrite,
    };
    if (next.canWrite) {
      next.canRead = true;
    }
    if (!next.canRead) {
      next.canWrite = false;
    }

    setPermissionError('');
    try {
      await setProjectPermission(selectedProjectId, userId, next, session);
      await loadPermissions(selectedProjectId);
    } catch (error) {
      setPermissionError(error.message || 'Failed to update project permission');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-6xl rounded-xl border border-gray-700 bg-gray-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Admin</h2>
            <p className="text-sm text-gray-400">
              Manage OIDC users, activation, global roles and project access.
            </p>
          </div>
          <button
            type="button"
            className="rounded bg-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-600"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="border-b border-gray-700 px-5 py-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('users')}
            className={`rounded px-3 py-1.5 text-sm ${tab === 'users' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
          >
            Users
          </button>
          <button
            type="button"
            onClick={() => setTab('permissions')}
            className={`rounded px-3 py-1.5 text-sm ${tab === 'permissions' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
          >
            Project Access
          </button>
          <div className="ml-auto">
            <button
              type="button"
              onClick={loadUsers}
              className="rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-600"
            >
              Refresh
            </button>
          </div>
        </div>

        {(panelError || permissionError) ? (
          <div className="border-b border-red-600/30 bg-red-900/20 px-5 py-3 text-sm text-red-200">
            {panelError || permissionError}
          </div>
        ) : null}

        <div className="max-h-[80vh] overflow-auto p-5">
          {tab === 'users' ? (
            <div className="space-y-6">
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-300">Pending OIDC users</h3>
                  <StatusPill tone="amber">{pendingOidcUsers.length} pending</StatusPill>
                </div>
                {loading ? (
                  <div className="rounded border border-gray-700 bg-gray-900/40 px-4 py-3 text-sm text-gray-300">
                    Loading users...
                  </div>
                ) : pendingOidcUsers.length === 0 ? (
                  <div className="rounded border border-gray-700 bg-gray-900/40 px-4 py-3 text-sm text-gray-400">
                    No pending OIDC users.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingOidcUsers.map((user) => {
                      const eligibleTargets = activeUsers.filter((candidate) => candidate.id !== user.id);
                      return (
                        <div key={user.id} className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-base font-semibold text-white">{user.username}</div>
                            <StatusPill tone="amber">Pending activation</StatusPill>
                            <StatusPill tone="blue">{user.authSource}</StatusPill>
                            {user.oidcEmail ? <StatusPill>{user.oidcEmail}</StatusPill> : null}
                          </div>
                          <div className="text-sm text-gray-400">
                            {user.oidcDisplayName || 'No display name from provider'}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleUserUpdate(user.id, { isActive: true })}
                              className="rounded bg-green-700 px-3 py-2 text-sm text-white hover:bg-green-600"
                            >
                              Activate account
                            </button>
                            <select
                              value={linkTargets[user.id] || ''}
                              onChange={(event) => setLinkTargets((previous) => ({
                                ...previous,
                                [user.id]: event.target.value,
                              }))}
                              className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
                            >
                              <option value="">Link to existing account...</option>
                              {eligibleTargets.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.username}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleLinkUser(user.id)}
                              disabled={!linkTargets[user.id]}
                              className="rounded bg-blue-700 px-3 py-2 text-sm text-white hover:bg-blue-600 disabled:bg-gray-700"
                            >
                              Link identity
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-300">All users</h3>
                  <StatusPill>{users.length} total</StatusPill>
                </div>
                <div className="overflow-hidden rounded-lg border border-gray-700">
                  <table className="min-w-full divide-y divide-gray-700 text-sm">
                    <thead className="bg-gray-900/70 text-gray-300">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">User</th>
                        <th className="px-4 py-3 text-left font-medium">Auth</th>
                        <th className="px-4 py-3 text-left font-medium">Status</th>
                        <th className="px-4 py-3 text-left font-medium">Admin</th>
                        <th className="px-4 py-3 text-left font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700 bg-gray-900/30">
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-white">{user.username}</div>
                            <div className="text-xs text-gray-400">
                              {user.oidcDisplayName || user.oidcEmail || 'No OIDC profile metadata'}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex flex-wrap gap-2">
                              <StatusPill tone="blue">{user.authSource}</StatusPill>
                              {user.oidcLinked ? <StatusPill>{user.oidcIssuer}</StatusPill> : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <StatusPill tone={user.isActive ? 'green' : 'amber'}>
                              {user.isActive ? 'Active' : 'Inactive'}
                            </StatusPill>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <StatusPill tone={user.isAdmin ? 'green' : 'slate'}>
                              {user.isAdmin ? 'Admin' : 'User'}
                            </StatusPill>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleUserUpdate(user.id, { isActive: !user.isActive })}
                                className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-100 hover:bg-gray-600"
                              >
                                {user.isActive ? 'Deactivate' : 'Activate'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUserUpdate(user.id, { isAdmin: !user.isAdmin })}
                                className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-100 hover:bg-gray-600"
                              >
                                {user.isAdmin ? 'Remove admin' : 'Make admin'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-gray-300">Project</label>
                <select
                  value={selectedProjectId}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                  className="min-w-[280px] rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                >
                  <option value="">Select a project...</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.musicalNumber || '0.0'} - {project.name}
                    </option>
                  ))}
                </select>
              </div>

              {permissionLoading ? (
                <div className="rounded border border-gray-700 bg-gray-900/40 px-4 py-3 text-sm text-gray-300">
                  Loading project permissions...
                </div>
              ) : !selectedProjectId ? (
                <div className="rounded border border-gray-700 bg-gray-900/40 px-4 py-3 text-sm text-gray-400">
                  Select a project to manage access.
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-700">
                  <table className="min-w-full divide-y divide-gray-700 text-sm">
                    <thead className="bg-gray-900/70 text-gray-300">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">User</th>
                        <th className="px-4 py-3 text-left font-medium">Status</th>
                        <th className="px-4 py-3 text-left font-medium">Read</th>
                        <th className="px-4 py-3 text-left font-medium">Write</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700 bg-gray-900/30">
                      {users.map((user) => {
                        const permission = projectPermissionMap.get(user.id) || {
                          canRead: false,
                          canWrite: false,
                        };
                        const disabled = !user.isActive;
                        return (
                          <tr key={user.id}>
                            <td className="px-4 py-3">
                              <div className="font-medium text-white">{user.username}</div>
                              <div className="text-xs text-gray-400">{user.authSource}</div>
                            </td>
                            <td className="px-4 py-3">
                              <StatusPill tone={user.isActive ? 'green' : 'amber'}>
                                {user.isActive ? 'Active' : 'Inactive'}
                              </StatusPill>
                            </td>
                            <td className="px-4 py-3">
                              <PermissionToggle
                                checked={Boolean(permission.canRead)}
                                disabled={disabled}
                                label="Read"
                                onChange={(checked) => handlePermissionChange(user.id, { canRead: checked })}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <PermissionToggle
                                checked={Boolean(permission.canWrite)}
                                disabled={disabled}
                                label="Write"
                                onChange={(checked) => handlePermissionChange(user.id, { canWrite: checked })}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
