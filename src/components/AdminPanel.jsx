import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleUserRound, MoreHorizontal, Plus } from 'lucide-react';
import {
  addRbacRoleMember,
  addUserRole,
  createRbacRole,
  createRbacRoleOidcLink,
  deleteUser,
  deleteRbacRole,
  deleteRbacRoleGrant,
  deleteRbacRoleOidcLink,
  getRbacCatalog,
  getRbacRole,
  listRbacRoles,
  listUsers,
  removeRbacRoleMember,
  removeUserRole,
  saveRbacRoleGrant,
  transferUserOwnership,
  updateRbacRole,
} from '../lib/serverApi';

function Badge({ children, tone = 'slate' }) {
  const toneClass = {
    slate: 'bg-gray-700 text-gray-200',
    blue: 'bg-blue-900/40 text-blue-200',
    amber: 'bg-amber-900/40 text-amber-200',
    green: 'bg-green-900/40 text-green-200',
  }[tone] || 'bg-gray-700 text-gray-200';

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${toneClass}`}>
      {children}
    </span>
  );
}

function Panel({ title, actions = null, children }) {
  return (
    <section className="rounded-xl border border-gray-700 bg-gray-900/40">
      <div className="flex items-center justify-between gap-3 border-b border-gray-700 px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200">{title}</h3>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Empty({ children }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-700 bg-gray-950/50 px-4 py-4 text-sm text-gray-400">
      {children}
    </div>
  );
}

function ToggleSwitch({
  checked,
  disabled = false,
  onChange,
  title,
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (!disabled) onChange?.(!checked);
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition ${
        checked
          ? 'border-blue-500 bg-blue-600'
          : 'border-gray-600 bg-gray-800'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-blue-400'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function CompactAccessSection({
  actions = null,
  children,
  count = null,
  title,
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950/50">
      <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-gray-200">{title}</h3>
          {count !== null ? (
            <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-semibold text-gray-400">
              {count}
            </span>
          ) : null}
        </div>
        {actions}
      </div>
      <div className="divide-y divide-gray-800">{children}</div>
    </section>
  );
}

function CompactAccessRow({
  actions = null,
  badges = null,
  muted = false,
  title,
  titleAttr,
}) {
  return (
    <div
      title={titleAttr}
      className={`grid grid-cols-[1fr,auto] items-center gap-4 px-4 py-2.5 transition hover:bg-gray-900/70 ${
        muted ? 'opacity-70' : ''
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold text-white">{title}</span>
        {badges ? (
          <span className="flex min-w-0 shrink-0 items-center gap-2">
            {badges}
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2">{actions}</div>
    </div>
  );
}

function roleTypeLabel(role) {
  if (role?.systemKey === 'admin') return 'Admin';
  if (role?.systemKey === 'default_user') return 'Automatic';
  return role?.isSystem ? 'System' : 'Custom';
}

const CAPABILITY_HELP = {
  player_tutti: 'Player only: listen to the built-in tutti mix. Cannot open DAW or create custom mixes.',
  project_read: 'Can open DAW read-only and create personal practice mixes. Includes tutti listening.',
  track_write_own: 'Can create, edit, delete, and lock tracks owned by this user. Includes project read.',
  track_write_scope: 'Can create, edit, delete, and lock tracks for the selected group or part scope. Includes project read.',
  manage_own_projects: 'Can create projects and fully manage projects created by this user. Does not allow access management.',
  project_manager: 'Can fully manage targeted projects: metadata, tracks, media references, locks, and deletion. Does not allow access management.',
};

const GENERAL_PERMISSION_DEFINITIONS = [
  { capability: 'player_tutti', showTargetType: 'all_shows', projectTargetType: 'all_projects' },
  { capability: 'project_read', showTargetType: 'all_shows', projectTargetType: 'all_projects' },
  { capability: 'track_write_own', showTargetType: 'all_shows', projectTargetType: 'all_projects' },
  { capability: 'manage_own_projects', showTargetType: 'all_shows', projectTargetType: null },
  { capability: 'project_manager', showTargetType: 'all_shows', projectTargetType: 'all_projects' },
];

const CAPABILITY_COVERAGE = {
  player_tutti: ['player_tutti'],
  project_read: ['player_tutti', 'project_read'],
  track_write_own: ['player_tutti', 'project_read', 'track_write_own'],
  track_write_scope: ['player_tutti', 'project_read', 'track_write_scope'],
  manage_own_projects: ['manage_own_projects'],
  project_manager: [
    'player_tutti',
    'project_read',
    'track_write_own',
    'track_write_scope',
    'project_manager',
  ],
};

function getCapabilityHelp(capability) {
  return CAPABILITY_HELP[capability] || 'This permission controls what the user can do in Apollo.';
}

function getCapabilityLabel(catalog, capability) {
  const option = (catalog?.capabilities || []).find((candidate) => candidate.value === capability);
  return option?.label || capability || 'Access';
}

function isGeneralGrant(grant) {
  if (!grant?.capability) return false;
  if ((grant.showTargetType || 'all_shows') !== 'all_shows') return false;
  if (grant.capability === 'track_write_scope') return false;
  if (grant.capability === 'manage_own_projects') return !grant.projectTargetType;
  return grant.projectTargetType === 'all_projects';
}

function isSpecificGrant(grant) {
  return Boolean(grant?.capability) && !isGeneralGrant(grant);
}

function generalGrantMatches(grant, definition) {
  if (!grant || !definition) return false;
  return (
    grant.capability === definition.capability
    && (grant.showTargetType || 'all_shows') === (definition.showTargetType || 'all_shows')
    && (grant.showTargetShowId || null) === (definition.showTargetShowId || null)
    && (grant.projectTargetType || null) === (definition.projectTargetType || null)
  );
}

function buildGeneralGrantPayload(definition) {
  return {
    capability: definition.capability,
    showTargetType: definition.showTargetType || 'all_shows',
    showTargetShowId: definition.showTargetShowId || null,
    projectTargetType: definition.projectTargetType,
    projectTargetProjectId: null,
    projectTargetValue: null,
    trackScopeType: null,
    trackScopeValue: null,
  };
}

function trackScopeMatches(left, right) {
  return (
    (left?.trackScopeType || null) === (right?.trackScopeType || null)
    && String(left?.trackScopeValue || '') === String(right?.trackScopeValue || '')
  );
}

function capabilityCovers(broaderCapability, narrowerCapability) {
  return (CAPABILITY_COVERAGE[broaderCapability] || [broaderCapability]).includes(narrowerCapability);
}

function generalGrantCoversGrant(generalGrant, grant) {
  if (!generalGrant || !grant || !isSpecificGrant(grant)) return false;
  if (generalGrant.capability === 'manage_own_projects') return false;
  if ((generalGrant.showTargetType || 'all_shows') !== 'all_shows') return false;
  if (generalGrant.projectTargetType !== 'all_projects') return false;
  if (!capabilityCovers(generalGrant.capability, grant.capability)) return false;
  if (generalGrant.capability === 'track_write_scope' && grant.capability === 'track_write_scope') {
    return trackScopeMatches(generalGrant, grant);
  }
  return true;
}

function isGrantRedundant(grant, allGrants) {
  return allGrants.some((candidate) => (
    candidate.id !== grant.id
    && generalGrantCoversGrant(candidate, grant)
  ));
}

function getGrantHoverTitle(grant) {
  const parts = [getCapabilityHelp(grant.capability)];
  if (grant.sourceType === 'inherited' && grant.sourceRoleName) {
    parts.push(`Inherited from ${grant.sourceRoleName}.`);
  }
  if (grant.isRedundant) {
    parts.push('Redundant because a broader access already covers this.');
  }
  return parts.filter(Boolean).join(' ');
}

function formatGrantLabel(grant) {
  const capabilityLabel = grant.capabilityLabel || grant.capability || grant.accessLevel || 'Access';
  const showTargetType = grant.showTargetType || 'all_shows';
  const showTargetLabel = grant.showTargetLabel || '';
  const projectTargetType = grant.projectTargetType || grant.scopeType || null;
  const projectTargetLabel = grant.projectTargetLabel || grant.scopeLabel || grant.projectTargetValue || grant.scopeValue || '';
  const trackScopeType = grant.trackScopeType || null;
  const trackScopeLabel = grant.trackScopeLabel || grant.trackScopeValue || '';

  const showLabel = showTargetType === 'show' ? `${showTargetLabel || 'Show'} / ` : '';
  let targetLabel = 'All projects';
  if (projectTargetType === 'project') targetLabel = projectTargetLabel || 'Project';
  if (projectTargetType === 'group_name') targetLabel = `Group: ${projectTargetLabel || ''}`;
  if (projectTargetType === 'part_name') targetLabel = `Part: ${projectTargetLabel || ''}`;
  if (!projectTargetType) targetLabel = 'All own projects';

  if (grant.capability === 'track_write_scope' && trackScopeType && trackScopeLabel) {
    const scopePrefix = trackScopeType === 'group_name' ? 'Track group' : 'Track part';
    return `${capabilityLabel} • ${showLabel}${targetLabel} • ${scopePrefix}: ${trackScopeLabel}`;
  }

  return `${capabilityLabel} • ${showLabel}${targetLabel}`;
}

function GrantList({ grants = [], canRemove = true, onRemove }) {
  if (!grants.length) {
    return (
      <div className="p-4">
        <Empty>No access rules.</Empty>
      </div>
    );
  }

  return (
    <>
      {grants.map((grant) => {
        const inherited = grant.sourceType === 'inherited';
        const removable = canRemove && !inherited;
        const badges = (inherited || grant.isRedundant) ? (
          <>
            {inherited && grant.sourceRoleName ? (
              <Badge tone="amber">Inherited from {grant.sourceRoleName}</Badge>
            ) : null}
            {grant.isRedundant ? <Badge>Redundant</Badge> : null}
          </>
        ) : null;
        return (
          <CompactAccessRow
            key={grant.id}
            title={formatGrantLabel(grant)}
            titleAttr={getGrantHoverTitle(grant)}
            badges={badges}
            muted={grant.isRedundant}
            actions={removable ? (
              <button
                type="button"
                onClick={() => onRemove?.(grant)}
                className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-100 hover:bg-gray-700"
              >
                Remove
              </button>
            ) : null}
          />
        );
      })}
    </>
  );
}

function GrantEditor({
  catalog,
  disabled = false,
  excludedCapabilities = [],
  onSave,
  targetMode = 'all',
}) {
  const excludedCapabilitySet = new Set(excludedCapabilities);
  const capabilityOptions = (catalog?.capabilities || []).filter((option) => (
    !excludedCapabilitySet.has(option.value)
    && (targetMode !== 'specific' || option.projectTargetMode !== 'global_only')
  ));
  const projectTargetOptions = catalog?.projectTargetTypes || [];
  const showTargetOptions = catalog?.showTargetTypes || [
    { value: 'all_shows', label: 'All shows' },
    { value: 'show', label: 'Show' },
  ];
  const trackScopeOptions = catalog?.trackScopeTypes || [];

  const [capability, setCapability] = useState(capabilityOptions[0]?.value || 'player_tutti');
  const [showTargetType, setShowTargetType] = useState(showTargetOptions[0]?.value || 'all_shows');
  const [showTargetShowId, setShowTargetShowId] = useState('');
  const [projectTargetType, setProjectTargetType] = useState(projectTargetOptions[0]?.value || 'all_projects');
  const [projectTargetProjectId, setProjectTargetProjectId] = useState('');
  const [projectTargetValue, setProjectTargetValue] = useState('');
  const [trackScopeType, setTrackScopeType] = useState(trackScopeOptions[0]?.value || 'group_name');
  const [trackScopeValue, setTrackScopeValue] = useState('');

  useEffect(() => {
    if (!capabilityOptions.some((option) => option.value === capability)) {
      setCapability(capabilityOptions[0]?.value || 'player_tutti');
    }
  }, [capability, capabilityOptions]);

  useEffect(() => {
    if (!projectTargetOptions.some((option) => option.value === projectTargetType)) {
      setProjectTargetType(projectTargetOptions[0]?.value || 'all_projects');
    }
  }, [projectTargetOptions, projectTargetType]);

  useEffect(() => {
    if (!showTargetOptions.some((option) => option.value === showTargetType)) {
      setShowTargetType(showTargetOptions[0]?.value || 'all_shows');
    }
  }, [showTargetOptions, showTargetType]);

  const capabilityMeta = capabilityOptions.find((option) => option.value === capability) || null;
  const projectTargetMode = capabilityMeta?.projectTargetMode || 'scoped';
  const requiresTrackScope = capabilityMeta?.requiresTrackScope === true;

  const namedTargetOptions = projectTargetType === 'group_name'
    ? (catalog?.groupNames || [])
    : (projectTargetType === 'part_name' ? (catalog?.partNames || []) : []);
  const namedTrackScopeOptions = trackScopeType === 'group_name'
    ? (catalog?.groupNames || [])
    : (catalog?.partNames || []);
  const projectOptions = showTargetType === 'show' && showTargetShowId
    ? (catalog?.projects || []).filter((project) => project.showId === showTargetShowId)
    : (catalog?.projects || []);

  const canSubmit = !disabled && (() => {
    if (showTargetType === 'show' && !showTargetShowId) return false;
    if (projectTargetMode === 'global_only') {
      return !requiresTrackScope || Boolean(trackScopeValue);
    }
    const hasProjectTarget = (
      projectTargetType === 'all_projects'
      || (projectTargetType === 'project' && projectTargetProjectId)
      || ((projectTargetType === 'group_name' || projectTargetType === 'part_name') && projectTargetValue)
    );
    if (!hasProjectTarget) return false;
    if (requiresTrackScope) {
      return Boolean(trackScopeType && trackScopeValue);
    }
    return true;
  })();

  const reset = () => {
    setCapability(capabilityOptions[0]?.value || 'player_tutti');
    setShowTargetType(showTargetOptions[0]?.value || 'all_shows');
    setShowTargetShowId('');
    setProjectTargetType(projectTargetOptions[0]?.value || 'all_projects');
    setProjectTargetProjectId('');
    setProjectTargetValue('');
    setTrackScopeType(trackScopeOptions[0]?.value || 'group_name');
    setTrackScopeValue('');
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSave?.({
      capability,
      showTargetType,
      showTargetShowId: showTargetType === 'show' ? showTargetShowId : null,
      projectTargetType: projectTargetMode === 'global_only' ? null : projectTargetType,
      projectTargetProjectId: projectTargetMode === 'global_only'
        ? null
        : (projectTargetType === 'project' ? projectTargetProjectId : null),
      projectTargetValue: projectTargetMode === 'global_only'
        ? null
        : ((projectTargetType === 'group_name' || projectTargetType === 'part_name') ? projectTargetValue : null),
      trackScopeType: requiresTrackScope ? trackScopeType : null,
      trackScopeValue: requiresTrackScope ? trackScopeValue : null,
    });
    reset();
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-950/60 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <select
          value={capability}
          disabled={disabled}
          onChange={(event) => {
            setCapability(event.target.value);
            setProjectTargetProjectId('');
            setProjectTargetValue('');
            setTrackScopeValue('');
          }}
          className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
        >
          {capabilityOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={showTargetType}
          disabled={disabled}
          onChange={(event) => {
            setShowTargetType(event.target.value);
            setShowTargetShowId('');
            setProjectTargetProjectId('');
          }}
          className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
        >
          {showTargetOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {projectTargetMode !== 'global_only' ? (
          <select
            value={projectTargetType}
            disabled={disabled}
            onChange={(event) => {
              setProjectTargetType(event.target.value);
              setProjectTargetProjectId('');
              setProjectTargetValue('');
            }}
            className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          >
            {projectTargetOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300">
            Applies to own projects in the selected show scope
          </div>
        )}
      </div>

      {showTargetType === 'show' ? (
        <select
          value={showTargetShowId}
          disabled={disabled}
          onChange={(event) => {
            setShowTargetShowId(event.target.value);
            setProjectTargetProjectId('');
          }}
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
        >
          <option value="">Select show...</option>
          {(catalog?.shows || []).map((show) => (
            <option key={show.id} value={show.id}>
              {show.name}
            </option>
          ))}
        </select>
      ) : null}

      {projectTargetMode !== 'global_only' && projectTargetType === 'project' ? (
        <select
          value={projectTargetProjectId}
          disabled={disabled}
          onChange={(event) => setProjectTargetProjectId(event.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
        >
          <option value="">Select project...</option>
          {projectOptions.map((project) => (
            <option key={project.id} value={project.id}>
              {project.showName ? `${project.showName} / ` : ''}{project.musicalNumber ? `${project.musicalNumber} - ` : ''}{project.name}
            </option>
          ))}
        </select>
      ) : null}

      {projectTargetMode !== 'global_only' && (projectTargetType === 'group_name' || projectTargetType === 'part_name') ? (
        <select
          value={projectTargetValue}
          disabled={disabled}
          onChange={(event) => setProjectTargetValue(event.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
        >
          <option value="">Select...</option>
          {namedTargetOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      {requiresTrackScope ? (
        <div className="grid gap-3 md:grid-cols-2">
          <select
            value={trackScopeType}
            disabled={disabled}
            onChange={(event) => {
              setTrackScopeType(event.target.value);
              setTrackScopeValue('');
            }}
            className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          >
            {trackScopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={trackScopeValue}
            disabled={disabled}
            onChange={(event) => setTrackScopeValue(event.target.value)}
            className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          >
            <option value="">Select track scope...</option>
            {namedTrackScopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:bg-gray-700"
        >
          Add access
        </button>
      </div>
    </div>
  );
}

export default function AdminPanel({
  session = null,
  onClose,
  onLogout,
}) {
  const [tab, setTab] = useState('roles');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState({ shows: [], projects: [], groupNames: [], partNames: [] });
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedRole, setSelectedRole] = useState(null);
  const [roleDetailTab, setRoleDetailTab] = useState('permissions');
  const [newRoleName, setNewRoleName] = useState('');
  const [roleNameDraft, setRoleNameDraft] = useState('');
  const [defaultMessageDraft, setDefaultMessageDraft] = useState('');
  const [parentRoleIdsDraft, setParentRoleIdsDraft] = useState([]);
  const [pendingRoleMemberId, setPendingRoleMemberId] = useState('');
  const [pendingChildRoleId, setPendingChildRoleId] = useState('');
  const [oidcClaimPathDraft, setOidcClaimPathDraft] = useState('');
  const [oidcClaimValueDraft, setOidcClaimValueDraft] = useState('');
  const [oidcDescriptionDraft, setOidcDescriptionDraft] = useState('');
  const [roleSearch, setRoleSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [expandedUserRoleIds, setExpandedUserRoleIds] = useState([]);
  const [rolePickerUserId, setRolePickerUserId] = useState('');
  const [userActionMenuId, setUserActionMenuId] = useState('');
  const [userActionModal, setUserActionModal] = useState(null);
  const [showRedundantAccesses, setShowRedundantAccesses] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const rolePickerRef = useRef(null);
  const userActionMenuRef = useRef(null);

  const loadBaseData = async () => {
    const [nextRoles, nextUsers, nextCatalog] = await Promise.all([
      listRbacRoles(session),
      listUsers(session),
      getRbacCatalog(session),
    ]);
    setRoles(nextRoles);
    setUsers(nextUsers);
    setCatalog(nextCatalog || {
      projects: [],
      shows: [],
      groupNames: [],
      partNames: [],
      capabilities: [],
      showTargetTypes: [],
      projectTargetTypes: [],
      trackScopeTypes: [],
    });
    setSelectedRoleId((current) => (
      nextRoles.some((role) => role.id === current) ? current : ''
    ));
  };

  const loadRole = async (roleId = selectedRoleId) => {
    if (!roleId) {
      setSelectedRole(null);
      return;
    }
    const role = await getRbacRole(roleId, session);
    setSelectedRole(role);
    setRoleNameDraft(role?.name || '');
    setDefaultMessageDraft(role?.emptyAccessMessage || '');
    setParentRoleIdsDraft((role?.parents || []).map((parent) => parent.id));
  };

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      setLoading(true);
      setError('');
      try {
        await loadBaseData();
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load admin data.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    boot();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!selectedRoleId) {
      setSelectedRole(null);
      setRoleNameDraft('');
      setDefaultMessageDraft('');
      setParentRoleIdsDraft([]);
      return;
    }
    loadRole(selectedRoleId).catch((loadError) => {
      setError(loadError.message || 'Failed to load role.');
    });
  }, [selectedRoleId]);

  useEffect(() => {
    setRoleDetailTab('permissions');
    setPendingRoleMemberId('');
    setPendingChildRoleId('');
    setOidcClaimPathDraft('');
    setOidcClaimValueDraft('');
    setOidcDescriptionDraft('');
    setShowRedundantAccesses(false);
  }, [selectedRoleId]);

  useEffect(() => {
    const handleDocumentClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
      }
      if (!rolePickerRef.current?.contains(event.target)) {
        setRolePickerUserId('');
      }
      if (!userActionMenuRef.current?.contains(event.target)) {
        setUserActionMenuId('');
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  const filteredRoles = useMemo(() => (
    roles.filter((role) => role.name.toLowerCase().includes(roleSearch.trim().toLowerCase()))
  ), [roles, roleSearch]);

  const filteredUsers = useMemo(() => (
    users.filter((user) => {
      const query = userSearch.trim().toLowerCase();
      if (!query) return true;
      return (
        String(user.username || '').toLowerCase().includes(query)
        || String(user.oidcEmail || '').toLowerCase().includes(query)
        || String(user.oidcDisplayName || '').toLowerCase().includes(query)
      );
    })
  ), [users, userSearch]);

  const availableRoleMembers = useMemo(() => {
    const currentIds = new Set((selectedRole?.members || []).map((member) => member.id));
    return users.filter((user) => !currentIds.has(user.id));
  }, [selectedRole, users]);

  const availableChildRoles = useMemo(() => {
    if (!selectedRole || selectedRole.isSystem) return [];
    const currentIds = new Set((selectedRole.childRoles || []).map((role) => role.id));
    return roles.filter((role) => (
      !role.isSystem
      && role.id !== selectedRole.id
      && !currentIds.has(role.id)
    ));
  }, [roles, selectedRole]);

  const includableRoles = useMemo(() => {
    if (!selectedRole || selectedRole.isSystem) return [];
    const childRoleIds = new Set((selectedRole.childRoles || []).map((role) => role.id));
    return roles.filter((role) => (
      !role.isSystem
      && role.id !== selectedRole.id
      && !childRoleIds.has(role.id)
    ));
  }, [roles, selectedRole]);

  const customAssignableRoles = useMemo(() => (
    roles.filter((role) => role.systemKey !== 'default_user')
  ), [roles]);

  const expandedUserRoleIdSet = useMemo(() => new Set(expandedUserRoleIds), [expandedUserRoleIds]);

  const roleGrants = useMemo(() => (selectedRole?.grants || []), [selectedRole]);
  const inheritedRoleGrants = useMemo(() => (selectedRole?.inheritedGrants || []), [selectedRole]);
  const allRoleGrants = useMemo(() => ([
    ...roleGrants,
    ...inheritedRoleGrants,
  ]), [roleGrants, inheritedRoleGrants]);

  const generalPermissionRows = useMemo(() => (
    GENERAL_PERMISSION_DEFINITIONS.map((definition) => {
      const directGrant = roleGrants.find((grant) => generalGrantMatches(grant, definition)) || null;
      const inheritedGrants = inheritedRoleGrants.filter((grant) => generalGrantMatches(grant, definition));
      return {
        ...definition,
        label: getCapabilityLabel(catalog, definition.capability),
        directGrant,
        inheritedGrants,
      };
    })
  ), [catalog, inheritedRoleGrants, roleGrants]);

  const specificRoleGrants = useMemo(() => {
    const grants = allRoleGrants
      .filter(isSpecificGrant)
      .map((grant) => ({
        ...grant,
        isRedundant: isGrantRedundant(grant, allRoleGrants),
      }));
    return showRedundantAccesses ? grants : grants.filter((grant) => !grant.isRedundant);
  }, [allRoleGrants, showRedundantAccesses]);

  const runAction = async (action, fallbackMessage) => {
    setSaving(true);
    setError('');
    try {
      await action();
    } catch (actionError) {
      setError(actionError.message || fallbackMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) return;
    await runAction(async () => {
      const createdRole = await createRbacRole({ name: newRoleName.trim() }, session);
      setNewRoleName('');
      await loadBaseData();
      setSelectedRoleId(createdRole.id);
    }, 'Failed to create role.');
  };

  const handleSaveRole = async () => {
    if (!selectedRole) return;
    await runAction(async () => {
      if (selectedRole.systemKey === 'default_user') {
        await updateRbacRole(selectedRole.id, {
          emptyAccessMessage: defaultMessageDraft,
        }, session);
      } else if (!selectedRole.isSystem) {
        await updateRbacRole(selectedRole.id, {
          name: roleNameDraft.trim(),
          parentRoleIds: parentRoleIdsDraft,
        }, session);
      }
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to save role.');
  };

  const handleSaveIncludedRoles = async () => {
    if (!selectedRole || selectedRole.isSystem) return;
    await runAction(async () => {
      await updateRbacRole(selectedRole.id, {
        parentRoleIds: parentRoleIdsDraft,
      }, session);
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to save included roles.');
  };

  const handleDeleteRole = async () => {
    if (!selectedRole || selectedRole.isSystem) return;
    if (!window.confirm(`Delete "${selectedRole.name}"?`)) return;
    await runAction(async () => {
      await deleteRbacRole(selectedRole.id, session);
      await loadBaseData();
    }, 'Failed to delete role.');
  };

  const handleAddRoleMember = async () => {
    if (!selectedRole || !pendingRoleMemberId) return;
    await runAction(async () => {
      await addRbacRoleMember(selectedRole.id, pendingRoleMemberId, session);
      setPendingRoleMemberId('');
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to add member.');
  };

  const handleRemoveRoleMember = async (userId) => {
    if (!selectedRole) return;
    await runAction(async () => {
      await removeRbacRoleMember(selectedRole.id, userId, session);
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to remove member.');
  };

  const handleSaveRoleGrant = async (grant) => {
    if (!selectedRole) return;
    await runAction(async () => {
      await saveRbacRoleGrant(selectedRole.id, grant, session);
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to save role access.');
  };

  const handleDeleteRoleGrant = async (grant) => {
    if (!selectedRole) return;
    await runAction(async () => {
      await deleteRbacRoleGrant(selectedRole.id, grant.id, session);
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to remove role access.');
  };

  const handleToggleGeneralPermission = async (definition, shouldEnable) => {
    if (!selectedRole) return;
    const directGrant = roleGrants.find((grant) => generalGrantMatches(grant, definition));
    if (shouldEnable && !directGrant) {
      await handleSaveRoleGrant(buildGeneralGrantPayload(definition));
      return;
    }
    if (!shouldEnable && directGrant) {
      await handleDeleteRoleGrant(directGrant);
    }
  };

  const handleSaveRoleOidcLink = async () => {
    if (!selectedRole || !oidcClaimValueDraft.trim()) return;
    await runAction(async () => {
      await createRbacRoleOidcLink(selectedRole.id, {
        claimPath: oidcClaimPathDraft.trim(),
        claimValue: oidcClaimValueDraft.trim(),
        description: oidcDescriptionDraft.trim(),
      }, session);
      setOidcClaimPathDraft('');
      setOidcClaimValueDraft('');
      setOidcDescriptionDraft('');
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to save OIDC link.');
  };

  const handleDeleteRoleOidcLink = async (link) => {
    if (!selectedRole || !link?.id) return;
    await runAction(async () => {
      await deleteRbacRoleOidcLink(selectedRole.id, link.id, session);
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to remove OIDC link.');
  };

  const handleAddChildRole = async () => {
    if (!selectedRole || !pendingChildRoleId) return;
    await runAction(async () => {
      const childRole = await getRbacRole(pendingChildRoleId, session);
      const nextParentRoleIds = Array.from(new Set([
        ...(childRole?.parents || []).map((role) => role.id),
        selectedRole.id,
      ]));
      await updateRbacRole(pendingChildRoleId, { parentRoleIds: nextParentRoleIds }, session);
      setPendingChildRoleId('');
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to add role member.');
  };

  const handleRemoveChildRole = async (childRoleId) => {
    if (!selectedRole || !childRoleId) return;
    await runAction(async () => {
      const childRole = await getRbacRole(childRoleId, session);
      const nextParentRoleIds = (childRole?.parents || [])
        .map((role) => role.id)
        .filter((roleId) => roleId !== selectedRole.id);
      await updateRbacRole(childRoleId, { parentRoleIds: nextParentRoleIds }, session);
      await loadBaseData();
      await loadRole(selectedRole.id);
    }, 'Failed to remove role member.');
  };

  const toggleExpandedUserRoles = (userId) => {
    setExpandedUserRoleIds((current) => (
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    ));
  };

  const handleSetUserRoleFromList = async (userId, roleId, shouldHaveRole) => {
    if (!userId || !roleId) return;
    await runAction(async () => {
      if (shouldHaveRole) {
        await addUserRole(userId, roleId, session);
      } else {
        await removeUserRole(userId, roleId, session);
      }
      await loadBaseData();
      if (selectedRoleId === roleId || selectedRoleId === 'system-role-admin') {
        await loadRole(selectedRoleId);
      }
    }, shouldHaveRole ? 'Failed to add role.' : 'Failed to remove role.');
  };

  const openUserActionModal = (type, user) => {
    if (!user) return;
    if (type === 'delete' && !window.confirm(`Delete ${user.username}?`)) {
      return;
    }
    const fallbackTargetUserId = users.find((candidate) => candidate.id !== user.id)?.id || '';
    setUserActionMenuId('');
    setUserActionModal({
      type,
      userId: user.id,
      targetUserId: fallbackTargetUserId,
    });
  };

  const handleConfirmUserAction = async () => {
    if (!userActionModal?.userId || !userActionModal.targetUserId) return;
    const { type, userId, targetUserId } = userActionModal;
    await runAction(async () => {
      if (type === 'transfer') {
        await transferUserOwnership(userId, targetUserId, session);
      } else if (type === 'delete') {
        await deleteUser(userId, targetUserId, session);
      }
      setUserActionModal(null);
      setExpandedUserRoleIds((current) => current.filter((id) => id !== userId));
      setRolePickerUserId((current) => (current === userId ? '' : current));
      await loadBaseData();
      if (selectedRoleId) {
        await loadRole(selectedRoleId);
      }
    }, type === 'transfer' ? 'Failed to transfer ownership.' : 'Failed to delete user.');
  };

  const canEditRoleName = selectedRole && !selectedRole.isSystem;
  const canEditRoleGrants = selectedRole && selectedRole.systemKey !== 'admin';
  const canEditRoleLinks = selectedRole && selectedRole.systemKey !== 'default_user';
  const canEditRoleChildren = selectedRole && !selectedRole.isSystem;
  const canEditRoleParents = selectedRole && !selectedRole.isSystem;
  const canShowMembers = selectedRole && selectedRole.systemKey !== 'default_user';
  const canEditDefaultMessage = (
    selectedRole?.systemKey === 'default_user'
    && (selectedRole.grants?.length || 0) === 0
    && (selectedRole.inheritedGrants?.length || 0) === 0
  );
  const userActionModalUser = userActionModal
    ? users.find((user) => user.id === userActionModal.userId)
    : null;
  const userActionTargetUsers = userActionModal
    ? users.filter((user) => user.id !== userActionModal.userId)
    : [];

  return (
    <div className="h-full w-full overflow-hidden bg-gray-900 text-white">
      <div className="flex h-full w-full flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-gray-700 bg-gray-800 px-4 py-3">
          <div>
            <h1 className="text-2xl font-bold">Apollo</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-lg bg-gray-700 p-0.5">
              <button
                type="button"
                disabled
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                title="Current page"
              >
                ADMIN
              </button>
            </div>
            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setProfileMenuOpen((previous) => !previous)}
                className="flex items-center justify-center rounded-lg bg-gray-700 p-2 text-white transition-colors hover:bg-gray-600"
                title="User menu"
              >
                <CircleUserRound size={18} />
              </button>
              {profileMenuOpen ? (
                <div className="absolute right-0 top-full z-30 mt-2 min-w-32 overflow-hidden rounded-md border border-gray-700 bg-gray-800 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onClose?.();
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                  >
                    Go to app
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onLogout?.();
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <div className="border-b border-red-700/40 bg-red-900/20 px-5 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full flex-col overflow-hidden md:flex-row">
            <aside className="shrink-0 border-b border-gray-800 bg-gray-950 p-3 md:w-60 md:border-b-0 md:border-r">
              <nav className="flex gap-2 overflow-x-auto md:block md:space-y-2 md:overflow-visible">
                <button
                  type="button"
                  onClick={() => setTab('roles')}
                  className={`relative flex min-w-36 items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition md:w-full ${
                    tab === 'roles'
                      ? 'bg-gray-800 text-white ring-1 ring-blue-500/40'
                      : 'text-gray-400 hover:bg-gray-900 hover:text-gray-100'
                  }`}
                >
                  {tab === 'roles' ? (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-blue-500" />
                  ) : null}
                  <span className="pl-2 font-medium">Roles</span>
                  <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs text-gray-400">
                    {roles.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('users')}
                  className={`relative flex min-w-36 items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition md:w-full ${
                    tab === 'users'
                      ? 'bg-gray-800 text-white ring-1 ring-blue-500/40'
                      : 'text-gray-400 hover:bg-gray-900 hover:text-gray-100'
                  }`}
                >
                  {tab === 'users' ? (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-blue-500" />
                  ) : null}
                  <span className="pl-2 font-medium">Users</span>
                  <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs text-gray-400">
                    {users.length}
                  </span>
                </button>
              </nav>
            </aside>

            <div className="min-w-0 flex-1 overflow-auto p-5">
              {loading ? (
                <Empty>Loading...</Empty>
              ) : tab === 'roles' ? (
                selectedRole ? (
                  <div className="grid gap-5 xl:grid-cols-[280px,1fr]">
                    <aside className="space-y-3 rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                      <button
                        type="button"
                        onClick={() => setSelectedRoleId('')}
                        className="w-full rounded-lg bg-gray-800 px-3 py-2 text-left text-sm font-semibold text-gray-100 hover:bg-gray-700"
                      >
                        Back to roles
                      </button>
                      <input
                        type="text"
                        value={roleSearch}
                        onChange={(event) => setRoleSearch(event.target.value)}
                        placeholder="Search roles"
                        className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                      />
                      <div className="space-y-1">
                        {filteredRoles.map((role) => (
                          <button
                            key={role.id}
                            type="button"
                            onClick={() => setSelectedRoleId(role.id)}
                            className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                              role.id === selectedRoleId
                                ? 'bg-gray-800 text-white ring-1 ring-blue-500/40'
                                : 'text-gray-300 hover:bg-gray-900 hover:text-white'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                              <span className="min-w-0 truncate font-medium">{role.name}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </aside>

                    <div className="space-y-5">
                      <Panel
                        title="Role"
                        actions={(
                          <div className="flex gap-2">
                            {(canEditRoleName || canEditDefaultMessage) ? (
                              <button
                                type="button"
                                disabled={saving || (canEditRoleName ? !roleNameDraft.trim() : false)}
                                onClick={handleSaveRole}
                                className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:bg-gray-700"
                              >
                                Save
                              </button>
                            ) : null}
                            {!selectedRole.isSystem ? (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={handleDeleteRole}
                                className="rounded bg-red-700 px-3 py-2 text-sm text-white hover:bg-red-600 disabled:bg-gray-700"
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        )}
                      >
                        <div className="space-y-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xl font-semibold text-white">{selectedRole.name}</span>
                            <Badge tone={selectedRole.systemKey === 'default_user' ? 'amber' : 'blue'}>
                              {roleTypeLabel(selectedRole)}
                            </Badge>
                            <Badge>{selectedRole.systemKey === 'default_user' ? 'Automatic' : `${selectedRole.memberCount || 0} members`}</Badge>
                            {selectedRole.linkCount ? <Badge tone="green">{selectedRole.linkCount} links</Badge> : null}
                          </div>

                          {canEditRoleName ? (
                            <input
                              type="text"
                              value={roleNameDraft}
                              onChange={(event) => setRoleNameDraft(event.target.value)}
                              className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                            />
                          ) : null}

                          {selectedRole.systemKey === 'default_user' ? (
                            <div className="space-y-2">
                              <div className="text-sm text-gray-300">No-access message</div>
                              <textarea
                                value={defaultMessageDraft}
                                disabled={!canEditDefaultMessage}
                                onChange={(event) => setDefaultMessageDraft(event.target.value)}
                                rows={1}
                                className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 disabled:opacity-60"
                              />
                            </div>
                          ) : null}
                        </div>
                      </Panel>

                      <div className="flex flex-wrap gap-2 border-b border-gray-700">
                        {[
                          ['permissions', 'Permissions'],
                          ['links', 'Links'],
                          ['members', 'Members'],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setRoleDetailTab(value)}
                            className={`border-b-2 px-3 py-2 text-sm font-semibold ${
                              roleDetailTab === value
                                ? 'border-blue-500 text-white'
                                : 'border-transparent text-gray-400 hover:text-gray-100'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {roleDetailTab === 'permissions' ? (
                        selectedRole.systemKey === 'admin' ? (
                          <Empty>Admin has full access automatically.</Empty>
                        ) : (
                          <div className="space-y-5">
                            <CompactAccessSection
                              title="Included roles"
                              count={parentRoleIdsDraft.length}
                              actions={canEditRoleParents ? (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={handleSaveIncludedRoles}
                                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:bg-gray-700"
                                >
                                  Save
                                </button>
                              ) : null}
                            >
                              {canEditRoleParents ? (
                                <>
                                  {includableRoles.map((role) => {
                                    const checked = parentRoleIdsDraft.includes(role.id);
                                    return (
                                      <CompactAccessRow
                                        key={role.id}
                                        title={role.name}
                                        actions={(
                                          <ToggleSwitch
                                            checked={checked}
                                            disabled={saving}
                                            title={checked ? 'Remove included role' : 'Include role'}
                                            onChange={(nextChecked) => {
                                              setParentRoleIdsDraft((current) => (
                                                nextChecked
                                                  ? Array.from(new Set([...current, role.id]))
                                                  : current.filter((roleId) => roleId !== role.id)
                                              ));
                                            }}
                                          />
                                        )}
                                      />
                                    );
                                  })}
                                  {!includableRoles.length ? (
                                    <div className="p-4">
                                      <Empty>No custom roles can be included.</Empty>
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <div className="p-4">
                                  <Empty>System roles cannot include other roles.</Empty>
                                </div>
                              )}
                            </CompactAccessSection>

                            <CompactAccessSection
                              title="General permissions"
                              count={generalPermissionRows.filter((row) => row.directGrant || row.inheritedGrants.length).length}
                            >
                                {generalPermissionRows.map((row) => {
                                  const inheritedSources = row.inheritedGrants
                                    .map((grant) => grant.sourceRoleName)
                                    .filter(Boolean);
                                  const checked = Boolean(row.directGrant || row.inheritedGrants.length);
                                  const inheritedOnly = !row.directGrant && row.inheritedGrants.length > 0;
                                  const disabled = !canEditRoleGrants || saving || inheritedOnly;
                                  const hoverTitle = [
                                    getCapabilityHelp(row.capability),
                                    inheritedSources.length
                                      ? `Inherited from ${Array.from(new Set(inheritedSources)).join(', ')}.`
                                      : '',
                                  ].filter(Boolean).join(' ');
                                  return (
                                    <CompactAccessRow
                                      key={`${row.capability}-${row.projectTargetType || 'global'}`}
                                      title={row.label}
                                      titleAttr={hoverTitle}
                                      muted={inheritedOnly}
                                      badges={inheritedSources.length ? (
                                        <>
                                          <Badge tone="amber">
                                            Inherited from {Array.from(new Set(inheritedSources)).join(', ')}
                                          </Badge>
                                        </>
                                      ) : null}
                                      actions={(
                                        <ToggleSwitch
                                          checked={checked}
                                          disabled={disabled}
                                          title={hoverTitle}
                                          onChange={(nextChecked) => handleToggleGeneralPermission(row, nextChecked)}
                                        />
                                      )}
                                    />
                                  );
                                })}
                            </CompactAccessSection>

                            <CompactAccessSection
                              title="Specific access"
                              count={specificRoleGrants.length}
                              actions={(
                                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-300">
                                  <input
                                    type="checkbox"
                                    checked={showRedundantAccesses}
                                    onChange={(event) => setShowRedundantAccesses(event.target.checked)}
                                    className="h-4 w-4 rounded border-gray-600 bg-gray-950 accent-blue-600"
                                  />
                                  Show redundant accesses
                                </label>
                              )}
                            >
                              {canEditRoleGrants ? (
                                <div className="border-b border-gray-800 p-4">
                                  <GrantEditor
                                    catalog={catalog}
                                    disabled={saving}
                                    excludedCapabilities={['manage_own_projects']}
                                    onSave={handleSaveRoleGrant}
                                    targetMode="specific"
                                  />
                                </div>
                              ) : null}
                              <GrantList
                                grants={specificRoleGrants}
                                canRemove={Boolean(canEditRoleGrants)}
                                onRemove={handleDeleteRoleGrant}
                              />
                            </CompactAccessSection>
                          </div>
                        )
                      ) : null}

                      {roleDetailTab === 'links' ? (
                        <div className="space-y-5">
                          {canEditRoleLinks ? (
                            <Panel title="Add link">
                              <div className="grid gap-3 lg:grid-cols-[1fr,1fr,auto]">
                                <input
                                  type="text"
                                  value={oidcClaimPathDraft}
                                  onChange={(event) => setOidcClaimPathDraft(event.target.value)}
                                  placeholder="Claim path"
                                  className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                                />
                                <input
                                  type="text"
                                  value={oidcClaimValueDraft}
                                  onChange={(event) => setOidcClaimValueDraft(event.target.value)}
                                  placeholder="Value"
                                  className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                                />
                                <button
                                  type="button"
                                  disabled={!oidcClaimValueDraft.trim() || saving}
                                  onClick={handleSaveRoleOidcLink}
                                  className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:bg-gray-700"
                                >
                                  Add
                                </button>
                              </div>
                              <input
                                type="text"
                                value={oidcDescriptionDraft}
                                onChange={(event) => setOidcDescriptionDraft(event.target.value)}
                                placeholder="Description"
                                className="mt-3 w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                              />
                            </Panel>
                          ) : null}

                          <Panel title="Links">
                            {!selectedRole.oidcLinks?.length ? (
                              <Empty>No links.</Empty>
                            ) : (
                              <div className="space-y-2">
                                {selectedRole.oidcLinks.map((link) => (
                                  <div
                                    key={link.id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-3"
                                  >
                                    <div className="min-w-0">
                                      <div className="font-medium text-white">
                                        {link.claimPath ? `${link.claimPath} = ${link.claimValue}` : link.claimValue}
                                      </div>
                                      {link.description ? (
                                        <div className="text-sm text-gray-400">{link.description}</div>
                                      ) : null}
                                    </div>
                                    {canEditRoleLinks ? (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteRoleOidcLink(link)}
                                        className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-100 hover:bg-gray-600"
                                      >
                                        Remove
                                      </button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            )}
                          </Panel>
                        </div>
                      ) : null}

                      {roleDetailTab === 'members' ? (
                        canShowMembers ? (
                          <div className="space-y-5">
                            <Panel title="Users">
                              <div className="space-y-4">
                                <div className="flex flex-col gap-2 md:flex-row">
                                  <select
                                    value={pendingRoleMemberId}
                                    onChange={(event) => setPendingRoleMemberId(event.target.value)}
                                    className="flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                                  >
                                    <option value="">Add user...</option>
                                    {availableRoleMembers.map((user) => (
                                      <option key={user.id} value={user.id}>
                                        {user.username}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    disabled={!pendingRoleMemberId || saving}
                                    onClick={handleAddRoleMember}
                                    className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:bg-gray-700"
                                  >
                                    Add
                                  </button>
                                </div>

                                {!selectedRole.members?.length ? (
                                  <Empty>No members.</Empty>
                                ) : (
                                  <div className="space-y-2">
                                    {selectedRole.members.map((member) => (
                                      <div
                                        key={member.id}
                                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-3"
                                      >
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-medium text-white">{member.username}</span>
                                          {member.isAdmin ? <Badge tone="blue">Admin</Badge> : null}
                                          {member.source === 'oidc_link' ? <Badge tone="green">OIDC</Badge> : null}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveRoleMember(member.id)}
                                          className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-100 hover:bg-gray-600"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </Panel>

                            {canEditRoleChildren ? (
                              <Panel title="Roles">
                                <div className="space-y-4">
                                  <div className="flex flex-col gap-2 md:flex-row">
                                    <select
                                      value={pendingChildRoleId}
                                      onChange={(event) => setPendingChildRoleId(event.target.value)}
                                      className="flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
                                    >
                                      <option value="">Add role...</option>
                                      {availableChildRoles.map((role) => (
                                        <option key={role.id} value={role.id}>
                                          {role.name}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      disabled={!pendingChildRoleId || saving}
                                      onClick={handleAddChildRole}
                                      className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:bg-gray-700"
                                    >
                                      Add
                                    </button>
                                  </div>

                                  {!selectedRole.childRoles?.length ? (
                                    <Empty>No role members.</Empty>
                                  ) : (
                                    <div className="space-y-2">
                                      {selectedRole.childRoles.map((role) => (
                                        <div
                                          key={role.id}
                                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-3"
                                        >
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium text-white">{role.name}</span>
                                            <Badge>{roleTypeLabel(role)}</Badge>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => handleRemoveChildRole(role.id)}
                                            className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-100 hover:bg-gray-600"
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </Panel>
                            ) : null}
                          </div>
                        ) : (
                          <Empty>Automatic for all users.</Empty>
                        )
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-5xl space-y-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h2 className="text-2xl font-bold text-white">Roles</h2>
                        <div className="text-sm text-gray-400">{roles.length} roles</div>
                      </div>
                      <div className="flex flex-col gap-2 md:min-w-96 md:flex-row">
                        <input
                          type="text"
                          value={newRoleName}
                          onChange={(event) => setNewRoleName(event.target.value)}
                          placeholder="Role name"
                          className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 md:flex-1"
                        />
                        <button
                          type="button"
                          disabled={!newRoleName.trim() || saving}
                          onClick={handleCreateRole}
                          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:bg-gray-700"
                        >
                          Create role
                        </button>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={roleSearch}
                      onChange={(event) => setRoleSearch(event.target.value)}
                      placeholder="Search roles"
                      className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-100"
                    />

                    <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950/50">
                      <div className="grid grid-cols-[1fr,140px] gap-4 border-b border-gray-800 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 md:grid-cols-[1fr,150px,120px]">
                        <span>Role</span>
                        <span>Members</span>
                        <span className="hidden md:block">Links</span>
                      </div>
                      {filteredRoles.map((role) => (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => setSelectedRoleId(role.id)}
                          className="grid w-full grid-cols-[1fr,140px] items-center gap-4 border-b border-gray-800 px-4 py-4 text-left last:border-b-0 hover:bg-gray-900 md:grid-cols-[1fr,150px,120px]"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-semibold text-white">{role.name}</span>
                              <Badge tone={role.systemKey === 'default_user' ? 'amber' : 'blue'}>
                                {roleTypeLabel(role)}
                              </Badge>
                            </div>
                          </div>
                          <span className="text-sm text-gray-300">
                            {role.systemKey === 'default_user' ? 'Automatic' : role.memberCount || 0}
                          </span>
                          <span className="hidden text-sm text-gray-300 md:block">{role.linkCount || 0}</span>
                        </button>
                      ))}
                      {!filteredRoles.length ? (
                        <div className="px-4 py-6">
                          <Empty>No roles found.</Empty>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              ) : (
                <div className="mx-auto max-w-6xl space-y-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-white">Users</h2>
                      <div className="text-sm text-gray-400">{users.length} users</div>
                    </div>
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(event) => setUserSearch(event.target.value)}
                      placeholder="Search users"
                      className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-100 md:w-96"
                    />
                  </div>

                  <div className="overflow-visible rounded-xl border border-gray-800 bg-gray-950/50">
                    <div className="grid grid-cols-[1.1fr,1.6fr,40px] gap-4 border-b border-gray-800 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 lg:grid-cols-[1.2fr,1fr,1.5fr,40px]">
                      <span>User</span>
                      <span className="hidden lg:block">Identity</span>
                      <span>Roles</span>
                      <span />
                    </div>
                    {filteredUsers.map((user) => {
                      const userRoles = Array.isArray(user.roles) ? user.roles : [];
                      const isExpanded = expandedUserRoleIdSet.has(user.id);
                      const visibleRoles = isExpanded ? userRoles : userRoles.slice(0, 1);
                      const collapsedExtraRoleCount = Math.max(userRoles.length - 1, 0);
                      const userRoleIds = new Set(userRoles.map((role) => role.id));
                      return (
                        <div
                          key={user.id}
                          className="group grid grid-cols-[1.1fr,1.6fr,40px] items-center gap-4 border-b border-gray-800 px-4 py-4 last:border-b-0 hover:bg-gray-900/70 lg:grid-cols-[1.2fr,1fr,1.5fr,40px]"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-white">{user.username}</div>
                            <div className="mt-1 truncate text-xs text-gray-500 lg:hidden">
                              {user.oidcDisplayName || user.oidcEmail || 'No identity'}
                            </div>
                          </div>
                          <div className="hidden min-w-0 lg:block">
                            <div className="truncate text-sm text-gray-300">
                              {user.oidcDisplayName || user.oidcEmail || '-'}
                            </div>
                            {user.oidcDisplayName && user.oidcEmail ? (
                              <div className="truncate text-xs text-gray-500">{user.oidcEmail}</div>
                            ) : null}
                          </div>
                          <div className="relative flex min-w-0 flex-wrap items-center gap-2">
                            {visibleRoles.map((role) => (
                              <span
                                key={role.id}
                                className="max-w-48 truncate rounded bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-100"
                              >
                                {role.name}
                              </span>
                            ))}
                            {!userRoles.length ? (
                              <span className="text-sm text-gray-500">No roles</span>
                            ) : null}
                            {collapsedExtraRoleCount > 0 ? (
                              <button
                                type="button"
                                title={isExpanded ? 'Hide extra roles' : 'Show all roles'}
                                onClick={() => toggleExpandedUserRoles(user.id)}
                                className="rounded bg-gray-800 px-2.5 py-1 text-xs font-semibold text-gray-100 hover:bg-gray-700"
                              >
                                {isExpanded ? '-' : `+${collapsedExtraRoleCount}`}
                              </button>
                            ) : null}
                            {customAssignableRoles.length ? (
                              <div
                                className="relative"
                                ref={rolePickerUserId === user.id ? rolePickerRef : null}
                              >
                                <button
                                  type="button"
                                  title="Add role"
                                  disabled={saving}
                                  onClick={() => setRolePickerUserId((current) => (current === user.id ? '' : user.id))}
                                  className="flex h-6 w-6 items-center justify-center rounded bg-gray-800 text-gray-200 opacity-0 transition hover:bg-gray-700 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                                >
                                  <Plus size={13} />
                                </button>
                                {rolePickerUserId === user.id ? (
                                  <div className="absolute right-0 top-full z-40 mt-2 max-h-72 w-64 overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-2 shadow-2xl">
                                    {customAssignableRoles.map((role) => {
                                      const checked = userRoleIds.has(role.id);
                                      return (
                                      <label
                                        key={role.id}
                                        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-100 hover:bg-gray-800"
                                      >
                                        <span className="truncate">{role.name}</span>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={saving}
                                          onChange={(event) => handleSetUserRoleFromList(user.id, role.id, event.target.checked)}
                                          className="h-4 w-4 rounded border-gray-600 bg-gray-950 accent-blue-600"
                                        />
                                      </label>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          <div
                            className="relative flex justify-end"
                            ref={userActionMenuId === user.id ? userActionMenuRef : null}
                          >
                            <button
                              type="button"
                              title="More actions"
                              onClick={() => setUserActionMenuId((current) => (current === user.id ? '' : user.id))}
                              className="flex h-8 w-8 items-center justify-center rounded bg-gray-800 text-gray-300 opacity-0 transition hover:bg-gray-700 hover:text-white group-hover:opacity-100 focus:opacity-100"
                            >
                              <MoreHorizontal size={17} />
                            </button>
                            {userActionMenuId === user.id ? (
                              <div className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 p-1 shadow-2xl">
                                <button
                                  type="button"
                                  onClick={() => openUserActionModal('transfer', user)}
                                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-100 hover:bg-gray-800"
                                >
                                  Transfer all ownership
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openUserActionModal('delete', user)}
                                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 hover:bg-red-950/40"
                                >
                                  Delete user
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    {!filteredUsers.length ? (
                      <div className="px-4 py-6">
                        <Empty>No users found.</Empty>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {userActionModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-5 shadow-2xl">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-white">
                {userActionModal.type === 'delete' ? 'Delete user' : 'Transfer ownership'}
              </h2>
              <p className="text-sm text-gray-400">
                {userActionModal.type === 'delete'
                  ? `Choose who should receive all ownership from ${userActionModalUser?.username || 'this user'} before deletion.`
                  : `Transfer all ownership from ${userActionModalUser?.username || 'this user'} to another user.`}
              </p>
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-sm text-gray-300" htmlFor="ownership-transfer-target">
                Transfer ownership to
              </label>
              <select
                id="ownership-transfer-target"
                value={userActionModal.targetUserId}
                onChange={(event) => setUserActionModal((current) => (
                  current ? { ...current, targetUserId: event.target.value } : current
                ))}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
              >
                <option value="">Select user...</option>
                {userActionTargetUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUserActionModal(null)}
                className="rounded bg-gray-800 px-4 py-2 text-sm text-gray-100 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !userActionModal.targetUserId}
                onClick={handleConfirmUserAction}
                className={`rounded px-4 py-2 text-sm text-white disabled:bg-gray-700 ${
                  userActionModal.type === 'delete'
                    ? 'bg-red-700 hover:bg-red-600'
                    : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                {userActionModal.type === 'delete' ? 'Delete user' : 'Transfer ownership'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
