const GROUP_ROW_HEIGHT = 40;
const ROOT_PARENT_ID = null;

function toNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function sortByOrder(a, b) {
  return toNumber(a.order, 0) - toNumber(b.order, 0);
}

function makeTrackNode(trackId, order = 0, parentId = ROOT_PARENT_ID) {
  return {
    id: crypto.randomUUID(),
    kind: 'track',
    parentId,
    order,
    trackId,
  };
}

export function getTrackHeight(track) {
  return track?.locked ? 70 : 100;
}

export function normalizeTrackTree(project) {
  if (!project) return project;
  const tracks = Array.isArray(project.tracks) ? project.tracks : [];
  const trackIds = new Set(tracks.map((track) => track.id));
  const rawNodes = Array.isArray(project.trackTree) ? project.trackTree : [];

  const normalizedNodes = [];
  const seenNodeIds = new Set();
  const seenTrackIds = new Set();

  for (const rawNode of rawNodes) {
    if (!rawNode || typeof rawNode !== 'object') continue;
    const rawKind = rawNode.kind ?? rawNode.type;
    const kind = rawKind === 'group' ? 'group' : (rawKind === 'track' ? 'track' : null);
    if (!kind) continue;
    const legacyNodeId = rawNode.id ?? rawNode.nodeId;
    const nodeId = typeof legacyNodeId === 'string' && legacyNodeId && !seenNodeIds.has(legacyNodeId)
      ? legacyNodeId
      : crypto.randomUUID();
    seenNodeIds.add(nodeId);

    const legacyParentId = rawNode.parentId ?? rawNode.parentNodeId;

    if (kind === 'track') {
      const legacyTrackId = rawNode.trackId ?? rawNode.track_id;
      if (!trackIds.has(legacyTrackId) || seenTrackIds.has(legacyTrackId)) {
        continue;
      }
      seenTrackIds.add(legacyTrackId);
      normalizedNodes.push({
        id: nodeId,
        kind: 'track',
        parentId: typeof legacyParentId === 'string' ? legacyParentId : ROOT_PARENT_ID,
        order: toNumber(rawNode.order, 0),
        trackId: legacyTrackId,
      });
      continue;
    }

    normalizedNodes.push({
      id: nodeId,
      kind: 'group',
      parentId: typeof legacyParentId === 'string' ? legacyParentId : ROOT_PARENT_ID,
      order: toNumber(rawNode.order, 0),
      name: typeof rawNode.name === 'string' && rawNode.name.trim() ? rawNode.name : 'Group',
      collapsed: Boolean(rawNode.collapsed),
    });
  }

  const nodeById = new Map(normalizedNodes.map((node) => [node.id, node]));
  for (const node of normalizedNodes) {
    if (node.parentId === ROOT_PARENT_ID) continue;
    const parent = nodeById.get(node.parentId);
    if (!parent || parent.kind !== 'group') {
      node.parentId = ROOT_PARENT_ID;
    }
  }

  const missingTrackIds = tracks
    .map((track) => track.id)
    .filter((trackId) => !seenTrackIds.has(trackId));
  const rootOrderBase = normalizedNodes
    .filter((node) => node.parentId === ROOT_PARENT_ID)
    .reduce((max, node) => Math.max(max, toNumber(node.order, 0)), -1);

  missingTrackIds.forEach((trackId, idx) => {
    normalizedNodes.push(makeTrackNode(trackId, rootOrderBase + idx + 1, ROOT_PARENT_ID));
  });

  const grouped = new Map();
  for (const node of normalizedNodes) {
    const key = node.parentId || '__root__';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(node);
  }
  for (const siblings of grouped.values()) {
    siblings.sort(sortByOrder);
    siblings.forEach((node, idx) => {
      node.order = idx;
    });
  }

  return { ...project, trackTree: normalizedNodes };
}

function getChildrenMap(trackTree) {
  const map = new Map();
  for (const node of trackTree) {
    const key = node.parentId || '__root__';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(node);
  }
  for (const siblings of map.values()) {
    siblings.sort(sortByOrder);
  }
  return map;
}

export function getTrackNodeByTrackId(project, trackId) {
  const trackTree = project?.trackTree || [];
  return trackTree.find((node) => node.kind === 'track' && node.trackId === trackId) || null;
}

export function getVisibleTimelineRows(project) {
  const normalized = normalizeTrackTree(project);
  const trackById = new Map((normalized.tracks || []).map((track) => [track.id, track]));
  const rows = [];
  const childrenMap = getChildrenMap(normalized.trackTree || []);

  const walk = (parentId, depth) => {
    const key = parentId || '__root__';
    const children = childrenMap.get(key) || [];
    for (const node of children) {
      if (node.kind === 'group') {
        rows.push({
          kind: 'group',
          nodeId: node.id,
          parentId: node.parentId || ROOT_PARENT_ID,
          depth,
          name: node.name,
          collapsed: Boolean(node.collapsed),
          height: GROUP_ROW_HEIGHT,
        });
        if (!node.collapsed) {
          walk(node.id, depth + 1);
        }
      } else {
        const track = trackById.get(node.trackId);
        if (!track) continue;
        rows.push({
          kind: 'track',
          nodeId: node.id,
          trackId: track.id,
          parentId: node.parentId || ROOT_PARENT_ID,
          depth,
          track,
          height: getTrackHeight(track),
        });
      }
    }
  };

  walk(ROOT_PARENT_ID, 0);
  return rows;
}

export function getVisibleTrackIds(project) {
  return getVisibleTimelineRows(project)
    .filter((row) => row.kind === 'track')
    .map((row) => row.trackId);
}

export function reorderTracksByTree(project) {
  if (!project) return project;
  const normalized = normalizeTrackTree(project);
  const childrenMap = getChildrenMap(normalized.trackTree || []);
  const orderedTrackIds = [];

  const walkAll = (parentId) => {
    const key = parentId || '__root__';
    const children = childrenMap.get(key) || [];
    for (const node of children) {
      if (node.kind === 'track') {
        orderedTrackIds.push(node.trackId);
      } else if (node.kind === 'group') {
        walkAll(node.id);
      }
    }
  };

  walkAll(ROOT_PARENT_ID);
  if (!orderedTrackIds.length) return project;
  const rank = new Map(orderedTrackIds.map((id, idx) => [id, idx]));
  const orderedTracks = [...normalized.tracks].sort((a, b) => {
    const ar = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
    const br = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
    return ar - br;
  });
  return { ...normalized, tracks: orderedTracks };
}

export function attachTrackNode(project, trackId, parentId = ROOT_PARENT_ID, index = null) {
  const normalized = normalizeTrackTree(project);
  const targetParentId = parentId || ROOT_PARENT_ID;
  const existing = getTrackNodeByTrackId(normalized, trackId);
  if (existing) {
    const currentParentId = existing.parentId || ROOT_PARENT_ID;
    if (currentParentId === targetParentId && index === null) {
      return normalized;
    }

    const nextTree = normalized.trackTree.filter((node) => node.id !== existing.id);

    const oldSiblings = nextTree
      .filter((node) => (node.parentId || ROOT_PARENT_ID) === currentParentId)
      .sort(sortByOrder);
    oldSiblings.forEach((sibling, idx) => {
      sibling.order = idx;
    });

    const targetSiblings = nextTree
      .filter((node) => (node.parentId || ROOT_PARENT_ID) === targetParentId)
      .sort(sortByOrder);
    const insertionIndex = index === null
      ? targetSiblings.length
      : Math.max(0, Math.min(index, targetSiblings.length));
    targetSiblings.forEach((sibling) => {
      if (sibling.order >= insertionIndex) {
        sibling.order += 1;
      }
    });

    nextTree.push({
      ...existing,
      parentId: targetParentId,
      order: insertionIndex,
    });

    return { ...normalized, trackTree: nextTree };
  }

  const siblings = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === targetParentId)
    .sort(sortByOrder);
  const insertionIndex = index === null ? siblings.length : Math.max(0, Math.min(index, siblings.length));

  for (const sibling of siblings) {
    if (sibling.order >= insertionIndex) {
      sibling.order += 1;
    }
  }

  return {
    ...normalized,
    trackTree: [
      ...normalized.trackTree,
      makeTrackNode(trackId, insertionIndex, targetParentId),
    ],
  };
}

export function removeTrackNode(project, trackId) {
  const normalized = normalizeTrackTree(project);
  const node = getTrackNodeByTrackId(normalized, trackId);
  if (!node) return normalized;
  const parentId = node.parentId || ROOT_PARENT_ID;
  const filtered = normalized.trackTree.filter((n) => n.id !== node.id);
  const siblings = filtered
    .filter((n) => (n.parentId || ROOT_PARENT_ID) === parentId)
    .sort(sortByOrder);
  siblings.forEach((sibling, idx) => {
    sibling.order = idx;
  });
  return { ...normalized, trackTree: filtered };
}

export function createGroupNode(project, name = 'Group', parentId = ROOT_PARENT_ID, index = null) {
  const normalized = normalizeTrackTree(project);
  const siblings = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === (parentId || ROOT_PARENT_ID))
    .sort(sortByOrder);
  const insertionIndex = index === null ? siblings.length : Math.max(0, Math.min(index, siblings.length));
  for (const sibling of siblings) {
    if (sibling.order >= insertionIndex) sibling.order += 1;
  }
  const nextNode = {
    id: crypto.randomUUID(),
    kind: 'group',
    parentId: parentId || ROOT_PARENT_ID,
    order: insertionIndex,
    name: name || 'Group',
    collapsed: false,
  };
  return { ...normalized, trackTree: [...normalized.trackTree, nextNode] };
}

export function renameGroupNode(project, groupNodeId, name) {
  const normalized = normalizeTrackTree(project);
  return {
    ...normalized,
    trackTree: normalized.trackTree.map((node) => (
      node.id === groupNodeId && node.kind === 'group'
        ? { ...node, name: name || node.name }
        : node
    )),
  };
}

export function toggleGroupCollapsed(project, groupNodeId) {
  const normalized = normalizeTrackTree(project);
  return {
    ...normalized,
    trackTree: normalized.trackTree.map((node) => (
      node.id === groupNodeId && node.kind === 'group'
        ? { ...node, collapsed: !node.collapsed }
        : node
    )),
  };
}

function isDescendant(nodeById, maybeDescendantId, ancestorId) {
  let current = nodeById.get(maybeDescendantId);
  while (current && current.parentId) {
    if (current.parentId === ancestorId) return true;
    current = nodeById.get(current.parentId);
  }
  return false;
}

export function moveTrackTreeNode(project, nodeId, targetNodeId, placement = 'after') {
  const normalized = normalizeTrackTree(project);
  const nodeById = new Map(normalized.trackTree.map((node) => [node.id, node]));
  const moving = nodeById.get(nodeId);
  const target = nodeById.get(targetNodeId);
  if (!moving || !target || moving.id === target.id) return normalized;

  let newParentId = target.parentId || ROOT_PARENT_ID;
  if (placement === 'inside') {
    if (target.kind !== 'group') return normalized;
    if (moving.kind === 'group' && isDescendant(nodeById, target.id, moving.id)) {
      return normalized;
    }
    newParentId = target.id;
  }

  const siblingsOfTarget = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === (newParentId || ROOT_PARENT_ID) && node.id !== moving.id)
    .sort(sortByOrder);

  let insertionIndex = siblingsOfTarget.length;
  if (placement !== 'inside') {
    const targetIndex = siblingsOfTarget.findIndex((node) => node.id === target.id);
    if (targetIndex === -1) return normalized;
    insertionIndex = placement === 'before' ? targetIndex : targetIndex + 1;
  }

  const oldParentId = moving.parentId || ROOT_PARENT_ID;
  const oldSiblings = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === oldParentId && node.id !== moving.id)
    .sort(sortByOrder);
  oldSiblings.forEach((sibling, idx) => { sibling.order = idx; });

  const newSiblings = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === (newParentId || ROOT_PARENT_ID) && node.id !== moving.id)
    .sort(sortByOrder);
  const clampedIndex = Math.max(0, Math.min(insertionIndex, newSiblings.length));
  newSiblings.splice(clampedIndex, 0, moving);
  newSiblings.forEach((sibling, idx) => {
    sibling.parentId = newParentId;
    sibling.order = idx;
  });

  return reorderTracksByTree({ ...normalized, trackTree: [...normalized.trackTree] });
}

export function deleteGroupPromoteChildren(project, groupNodeId) {
  const normalized = normalizeTrackTree(project);
  const group = normalized.trackTree.find((node) => node.id === groupNodeId && node.kind === 'group');
  if (!group) return normalized;

  const parentId = group.parentId || ROOT_PARENT_ID;
  const siblings = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === parentId && node.id !== group.id)
    .sort(sortByOrder);
  const children = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === group.id)
    .sort(sortByOrder);

  const groupIndex = toNumber(group.order, siblings.length);
  const merged = [...siblings];
  merged.splice(groupIndex, 0, ...children);
  merged.forEach((node, idx) => {
    node.parentId = parentId;
    node.order = idx;
  });

  const nextTree = normalized.trackTree.filter((node) => node.id !== group.id);
  return reorderTracksByTree({ ...normalized, trackTree: nextTree });
}
