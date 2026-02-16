import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Headphones,
  Mic,
  Music,
  Users,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import { TRACK_ROLES } from '../types/project';
import { dbToVolume, volumeToDb } from '../utils/audio';
import { AUTO_PAN_STRATEGIES } from '../utils/choirAutoPan';
import { normalizeTrackName } from '../utils/naming';
import {
  GROUP_ROLE_CHOIRS,
  GROUP_ROLE_INSTRUMENTS,
  GROUP_ROLE_LEADS,
  getDefaultIconByRole,
  isChoirRole,
  isGroupParentRole,
} from '../utils/trackRoles';

const TRACK_HEIGHT = 100;

function TrackList({
  tracks,
  rows,
  onUpdateTrack,
  onUpdateGroup,
  onCreateSubtrack,
  onSelectRow,
  onSelectTrack,
  selectedNodeId,
  selectedTrackId,
  onAddTrack,
  onDeleteTrack,
  onSetAutoPanStrategy,
  onToggleAutoPanInverted,
  autoPanInverted = false,
  autoPanManualChoirParts = false,
  onReorderTrack,
  onMoveNode,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onToggleGroupCollapse,
  emptyContextMenu,
  onClearEmptyContextMenu,
}) {
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const reorderDragRef = useRef(null);
  const suppressClickRef = useRef(false);

  const [editingName, setEditingName] = useState(null);
  const [dragTooltip, setDragTooltip] = useState(null);
  const [editTooltip, setEditTooltip] = useState(null);
  const [draggingNodeId, setDraggingNodeId] = useState(null);
  const [rowDragPreview, setRowDragPreview] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);

  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [typeMenuPos, setTypeMenuPos] = useState({ x: 0, y: 0 });
  const [choirMenuOpen, setChoirMenuOpen] = useState(false);
  const [choirMenuPos, setChoirMenuPos] = useState({ x: 0, y: 0 });
  const [autoPanMenuOpen, setAutoPanMenuOpen] = useState(false);
  const [autoPanMenuPos, setAutoPanMenuPos] = useState({ x: 0, y: 0 });
  const [groupTypeMenuOpen, setGroupTypeMenuOpen] = useState(false);
  const [groupTypeMenuPos, setGroupTypeMenuPos] = useState({ x: 0, y: 0 });
  const [groupTrackTypeMenuOpen, setGroupTrackTypeMenuOpen] = useState(false);
  const [groupTrackTypeMenuPos, setGroupTrackTypeMenuPos] = useState({ x: 0, y: 0 });
  const [groupPartTypeMenuOpen, setGroupPartTypeMenuOpen] = useState(false);
  const [groupPartTypeMenuPos, setGroupPartTypeMenuPos] = useState({ x: 0, y: 0 });

  const [isTypeTriggerHover, setIsTypeTriggerHover] = useState(false);
  const [isTypeMenuHover, setIsTypeMenuHover] = useState(false);
  const [isChoirTriggerHover, setIsChoirTriggerHover] = useState(false);
  const [isChoirMenuHover, setIsChoirMenuHover] = useState(false);
  const [isAutoPanTriggerHover, setIsAutoPanTriggerHover] = useState(false);
  const [isAutoPanMenuHover, setIsAutoPanMenuHover] = useState(false);
  const [isGroupTypeTriggerHover, setIsGroupTypeTriggerHover] = useState(false);
  const [isGroupTypeMenuHover, setIsGroupTypeMenuHover] = useState(false);
  const [isGroupTrackTypeTriggerHover, setIsGroupTrackTypeTriggerHover] = useState(false);
  const [isGroupTrackTypeMenuHover, setIsGroupTrackTypeMenuHover] = useState(false);
  const [isGroupPartTypeTriggerHover, setIsGroupPartTypeTriggerHover] = useState(false);
  const [isGroupPartTypeMenuHover, setIsGroupPartTypeMenuHover] = useState(false);

  const trackMap = useMemo(() => new Map((tracks || []).map((track) => [track.id, track])), [tracks]);
  const visibleRows = useMemo(() => {
    if (Array.isArray(rows) && rows.length > 0) {
      return rows;
    }
    return (tracks || []).map((track) => ({
      kind: 'track',
      nodeId: track.id,
      trackId: track.id,
      track,
      depth: 0,
      height: TRACK_HEIGHT,
    }));
  }, [rows, tracks]);
  const rowByNodeId = useMemo(
    () => new Map((visibleRows || []).map((row) => [row.nodeId, row])),
    [visibleRows]
  );

  const iconOptions = useMemo(() => [
    { key: 'mic', Icon: Mic },
    { key: 'music', Icon: Music },
    { key: 'users', Icon: Users },
    { key: 'wave', Icon: Waves },
  ], []);

  const menuItemClass = 'w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap';

  const selectRow = (row) => {
    if (!row) return;
    onSelectRow?.(row);
    if (row.kind === 'track') {
      const trackId = row.trackId || row.track?.id;
      if (trackId) onSelectTrack?.(trackId);
    }
  };

  const getInheritedParentGroupRole = (row) => {
    let parentId = row?.parentId ?? null;
    while (parentId) {
      const parentRow = rowByNodeId.get(parentId);
      if (!parentRow || parentRow.kind !== 'group') return null;
      if (isGroupParentRole(parentRow.role)) {
        return parentRow.role;
      }
      parentId = parentRow.parentId ?? null;
    }
    return null;
  };

  const setGlobalDragCursor = (active) => {
    document.body.classList.toggle('row-drag-cursor', active);
    document.body.style.userSelect = active ? 'none' : '';
  };

  const getDropTarget = (rowMeta, fromIndex, pointerY) => {
    if (!rowMeta.length) return null;

    const metaIndexByNodeId = new Map(rowMeta.map((meta, idx) => [meta.nodeId, idx]));
    const getLastDescendantIndex = (groupIndex) => {
      const groupDepth = rowMeta[groupIndex]?.depth ?? 0;
      let last = groupIndex;
      for (let i = groupIndex + 1; i < rowMeta.length; i += 1) {
        if ((rowMeta[i]?.depth ?? 0) <= groupDepth) break;
        last = i;
      }
      return last;
    };

    let hoverIndex = rowMeta.findIndex((meta) => pointerY < meta.bottom);
    if (hoverIndex === -1) hoverIndex = rowMeta.length - 1;

    const hovered = rowMeta[hoverIndex];
    if (!hovered) return null;

    let target = hovered;
    let placement = 'after';

    if (hovered.kind === 'group') {
      // Hovering the parent row always means drop inside that group.
      placement = 'inside';
    } else {
      const bottomHalf = pointerY >= hovered.mid;
      const parentGroupIndex = hovered.parentId ? metaIndexByNodeId.get(hovered.parentId) : undefined;
      const hasParentGroup = Number.isInteger(parentGroupIndex) && rowMeta[parentGroupIndex]?.kind === 'group';
      const isLastVisibleInParent = hasParentGroup
        ? hoverIndex === getLastDescendantIndex(parentGroupIndex)
        : false;

      if (hasParentGroup && isLastVisibleInParent) {
        if (bottomHalf) {
          // Bottom half of the last child exits the parent group.
          target = rowMeta[parentGroupIndex];
          placement = 'after';
        } else {
          // Top half of the last child stays inside as the last child.
          placement = 'after';
        }
      } else {
        placement = bottomHalf ? 'after' : 'before';
      }
    }

    const targetIndex = rowMeta.findIndex((meta) => meta.nodeId === target.nodeId);
    let insertAnchorIndex = targetIndex;
    if (target.kind === 'group' && (placement === 'after' || placement === 'inside')) {
      // In flattened preview, both "inside as last child" and "after group"
      // land after the group's visible descendants.
      insertAnchorIndex = getLastDescendantIndex(targetIndex);
    }

    let insertIndex = insertAnchorIndex;
    if (placement === 'after' || placement === 'inside') {
      insertIndex = insertAnchorIndex + 1;
    }
    if (insertIndex > fromIndex) {
      insertIndex -= 1;
    }
    insertIndex = Math.max(0, Math.min(rowMeta.length, insertIndex));

    const targetDepth = placement === 'inside' ? target.depth + 1 : target.depth;
    return {
      target,
      placement,
      insertIndex,
      targetDepth,
    };
  };

  const getRowDragOffsetY = (rowIndex, rowNodeId) => {
    if (!rowDragPreview?.moved) return 0;
    const { nodeId, fromIndex, insertIndex, rowHeight, deltaY } = rowDragPreview;
    if (rowNodeId === nodeId) return deltaY;
    if (insertIndex < fromIndex && rowIndex >= insertIndex && rowIndex < fromIndex) {
      return rowHeight;
    }
    if (insertIndex > fromIndex && rowIndex > fromIndex && rowIndex <= insertIndex) {
      return -rowHeight;
    }
    return 0;
  };

  useEffect(() => {
    if (!contextMenu || contextMenu.type !== 'track') {
      setTypeMenuOpen(false);
      setChoirMenuOpen(false);
      setAutoPanMenuOpen(false);
      setIsTypeTriggerHover(false);
      setIsTypeMenuHover(false);
      setIsChoirTriggerHover(false);
      setIsChoirMenuHover(false);
      setIsAutoPanTriggerHover(false);
      setIsAutoPanMenuHover(false);
    }
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu || contextMenu.type !== 'group') {
      setGroupTypeMenuOpen(false);
      setGroupTrackTypeMenuOpen(false);
      setGroupPartTypeMenuOpen(false);
      setIsGroupTypeTriggerHover(false);
      setIsGroupTypeMenuHover(false);
      setIsGroupTrackTypeTriggerHover(false);
      setIsGroupTrackTypeMenuHover(false);
      setIsGroupPartTypeTriggerHover(false);
      setIsGroupPartTypeMenuHover(false);
    }
  }, [contextMenu]);

  useEffect(() => {
    const typeOpen = isTypeTriggerHover || isTypeMenuHover || isChoirTriggerHover || isChoirMenuHover;
    const choirOpen = isChoirTriggerHover || isChoirMenuHover;
    setTypeMenuOpen(typeOpen);
    setChoirMenuOpen(choirOpen);
  }, [isTypeTriggerHover, isTypeMenuHover, isChoirTriggerHover, isChoirMenuHover]);

  useEffect(() => {
    const autoOpen = isAutoPanTriggerHover || isAutoPanMenuHover;
    setAutoPanMenuOpen(autoOpen);
  }, [isAutoPanTriggerHover, isAutoPanMenuHover]);

  useEffect(() => {
    const typeOpen = isGroupTypeTriggerHover
      || isGroupTypeMenuHover
      || isGroupTrackTypeTriggerHover
      || isGroupTrackTypeMenuHover
      || isGroupPartTypeTriggerHover
      || isGroupPartTypeMenuHover;
    const groupTrackOpen = isGroupTrackTypeTriggerHover || isGroupTrackTypeMenuHover;
    const groupPartOpen = isGroupPartTypeTriggerHover || isGroupPartTypeMenuHover;
    setGroupTypeMenuOpen(typeOpen);
    setGroupTrackTypeMenuOpen(groupTrackOpen);
    setGroupPartTypeMenuOpen(groupPartOpen);
  }, [
    isGroupTypeTriggerHover,
    isGroupTypeMenuHover,
    isGroupTrackTypeTriggerHover,
    isGroupTrackTypeMenuHover,
    isGroupPartTypeTriggerHover,
    isGroupPartTypeMenuHover,
  ]);

  useEffect(() => {
    const handleMove = (e) => {
      handleDragMove(e);
      handleRowReorderMove(e);
    };
    const handleUp = () => {
      endDrag();
      handleRowReorderEnd();
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      setGlobalDragCursor(false);
    };
  }, []);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    if (!emptyContextMenu) return;
    setContextMenu(emptyContextMenu);
    onClearEmptyContextMenu?.();
  }, [emptyContextMenu, onClearEmptyContextMenu]);

  const openTypeMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTypeMenuPos({ x: rect.right + 1, y: rect.top - 1 });
    setIsTypeTriggerHover(true);
  };

  const openChoirMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setChoirMenuPos({ x: rect.right + 1, y: rect.top - 1 });
    setIsChoirTriggerHover(true);
  };

  const openAutoPanMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setAutoPanMenuPos({ x: rect.right + 1, y: rect.top - 1 });
    setIsAutoPanTriggerHover(true);
  };

  const openGroupTypeMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setGroupTypeMenuPos({ x: rect.right + 1, y: rect.top - 1 });
    setIsGroupTypeTriggerHover(true);
  };

  const openGroupTrackTypeMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setGroupTrackTypeMenuPos({ x: rect.right + 1, y: rect.top - 1 });
    setIsGroupTrackTypeTriggerHover(true);
  };

  const openGroupPartTypeMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setGroupPartTypeMenuPos({ x: rect.right + 1, y: rect.top - 1 });
    setIsGroupPartTypeTriggerHover(true);
  };

  const getDefaultIconKey = (role) => {
    return getDefaultIconByRole(role);
  };

  const getIconForTrack = (track) => {
    const iconKey = track.icon || getDefaultIconKey(track.role);
    const option = iconOptions.find((opt) => opt.key === iconKey);
    return option || iconOptions[0];
  };

  const cycleIcon = (track) => {
    const iconKey = track.icon || getDefaultIconKey(track.role);
    const currentIndex = iconOptions.findIndex((opt) => opt.key === iconKey);
    const nextIndex = (currentIndex + 1) % iconOptions.length;
    onUpdateTrack(track.id, { icon: iconOptions[nextIndex].key });
  };

  const handleVolumeChange = (trackId, value) => {
    onUpdateTrack(trackId, { volume: parseFloat(value) });
  };

  const handlePanChange = (trackId, value) => {
    onUpdateTrack(trackId, { pan: parseFloat(value) });
  };

  const handleGroupVolumeChange = (groupNodeId, value) => {
    onUpdateGroup?.(groupNodeId, { volume: parseFloat(value) });
  };

  const handleGroupPanChange = (groupNodeId, value) => {
    onUpdateGroup?.(groupNodeId, { pan: parseFloat(value) });
  };

  const beginDrag = (e, entityId, type, startValue, onChange) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (editTooltip) setEditTooltip(null);
    const rect = e.currentTarget.getBoundingClientRect();
    setDragTooltip({
      entityId,
      type,
      value: startValue,
      x: rect.left + rect.width / 2,
      y: rect.top - 6,
    });
    dragRef.current = {
      entityId,
      type,
      startX: e.clientX,
      startValue,
      width: rect.width,
      moved: false,
      onChange,
    };
  };

  const beginRowReorder = (e, row) => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-track-interactive="true"]')) return;
    e.preventDefault();

    const container = listRef.current;
    if (!container) return;

    const rowMeta = visibleRows
      .map((candidate, index) => {
        const rowElement = container.querySelector(`[data-tree-row-id="${candidate.nodeId}"]`);
        if (!rowElement) return null;
        const rect = rowElement.getBoundingClientRect();
        return {
          index,
          nodeId: candidate.nodeId,
          kind: candidate.kind,
          trackId: candidate.trackId || null,
          parentId: candidate.parentId ?? null,
          depth: candidate.depth ?? 0,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          mid: rect.top + rect.height / 2,
        };
      })
      .filter(Boolean);

    if (rowMeta.length < 2) return;
    const fromIndex = rowMeta.findIndex((meta) => meta.nodeId === row.nodeId);
    if (fromIndex < 0) return;

    reorderDragRef.current = {
      nodeId: row.nodeId,
      kind: row.kind,
      trackId: row.trackId || null,
      fromIndex,
      rowHeight: row.height,
      startY: e.clientY,
      lastY: e.clientY,
      moved: false,
      rowMeta,
      lastDropTarget: null,
    };
    setRowDragPreview({
      nodeId: row.nodeId,
      fromIndex,
      insertIndex: fromIndex,
      rowHeight: row.height,
      deltaY: 0,
      moved: false,
      targetDepth: row.depth ?? 0,
    });
    setDraggingNodeId(row.nodeId);
  };

  const handleDragMove = (e) => {
    if (!dragRef.current) return;
    const { entityId, type, startX, startValue, width, moved, onChange } = dragRef.current;
    const deltaX = e.clientX - startX;
    if (!moved && Math.abs(deltaX) < 2) return;
    dragRef.current.moved = true;
    if (editTooltip) setEditTooltip(null);

    if (type === 'volume') {
      const range = 100;
      const next = Math.min(100, Math.max(0, startValue + (deltaX / width) * range));
      onChange?.(next);
      setDragTooltip((prev) => (prev ? { ...prev, value: next } : { entityId, type, value: next }));
    } else {
      const range = 200;
      const next = Math.min(100, Math.max(-100, startValue + (deltaX / width) * range));
      onChange?.(next);
      setDragTooltip((prev) => (prev ? { ...prev, value: next } : { entityId, type, value: next }));
    }
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragTooltip(null);
  };

  const handleRowReorderMove = (e) => {
    const dragState = reorderDragRef.current;
    if (!dragState) return;
    dragState.lastY = e.clientY;
    const deltaY = e.clientY - dragState.startY;
    if (!dragState.moved && Math.abs(deltaY) < 4) return;
    if (!dragState.moved) {
      setGlobalDragCursor(true);
    }
    dragState.moved = true;
    const dropTarget = getDropTarget(dragState.rowMeta, dragState.fromIndex, e.clientY);
    if (!dropTarget) return;
    dragState.lastDropTarget = dropTarget;
    setRowDragPreview((prev) => {
      if (!prev || prev.nodeId !== dragState.nodeId) return prev;
      return {
        ...prev,
        insertIndex: dropTarget.insertIndex,
        targetDepth: dropTarget.targetDepth,
        deltaY,
        moved: true,
      };
    });
    e.preventDefault();
  };

  const handleRowReorderEnd = () => {
    const dragState = reorderDragRef.current;
    if (!dragState) return;

    reorderDragRef.current = null;
    setDraggingNodeId(null);
    setRowDragPreview(null);
    setGlobalDragCursor(false);

    if (!dragState.moved) return;

    const { rowMeta, nodeId, trackId, lastY, fromIndex } = dragState;
    const dropTarget = dragState.lastDropTarget || getDropTarget(rowMeta, fromIndex, lastY);
    if (!dropTarget) return;
    const { target, placement, insertIndex } = dropTarget;

    if (target.nodeId === nodeId) return;

    if (onMoveNode) {
      onMoveNode(nodeId, target.nodeId, placement);
    } else if (trackId && target.trackId && placement !== 'inside') {
      onReorderTrack?.(trackId, insertIndex);
    }

    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const openEditTooltip = (entityId, type, text, e) => {
    setDragTooltip(null);
    const rect = e.currentTarget.getBoundingClientRect();
    setEditTooltip({
      entityId,
      type,
      text,
      x: rect.left + rect.width / 2,
      y: rect.top - 6,
    });
  };

  const handleVolumeDoubleClick = (entityId, currentVolume, e) => {
    const display = currentVolume <= 0 ? '-∞' : volumeToDb(currentVolume).toFixed(1);
    openEditTooltip(entityId, 'volume', display, e);
  };

  const handlePanDoubleClick = (entityId, currentPan, e) => {
    openEditTooltip(entityId, 'pan', currentPan.toFixed(0), e);
  };

  const commitEditTooltip = ({ onVolumeChange, onPanChange }) => {
    if (!editTooltip) return;

    const text = editTooltip.text.trim();
    if (editTooltip.type === 'volume') {
      if (!text) {
        onVolumeChange?.(dbToVolume(0));
        setEditTooltip(null);
        return;
      }
      const normalized = text.toLowerCase();
      if (normalized === '-∞' || normalized === '-inf' || normalized === '-infinity') {
        onVolumeChange?.(0);
        setEditTooltip(null);
        return;
      }
      const parsed = parseFloat(text);
      if (!Number.isNaN(parsed)) {
        const clampedDb = Math.min(6, Math.max(-60, parsed));
        onVolumeChange?.(dbToVolume(clampedDb));
      }
    } else {
      if (!text) {
        onPanChange?.(0);
        setEditTooltip(null);
        return;
      }
      const parsed = parseFloat(text);
      if (!Number.isNaN(parsed)) {
        onPanChange?.(Math.min(100, Math.max(-100, parsed)));
      }
    }

    setEditTooltip(null);
  };

  const handleToggleMute = (trackId, currentMuted) => {
    onUpdateTrack(trackId, { muted: !currentMuted });
  };

  const handleToggleSolo = (trackId, currentSoloed) => {
    onUpdateTrack(trackId, { soloed: !currentSoloed });
  };

  const handleToggleGroupMute = (groupNodeId, currentMuted) => {
    onUpdateGroup?.(groupNodeId, { muted: !currentMuted });
  };

  const handleToggleGroupSolo = (groupNodeId, currentSoloed) => {
    onUpdateGroup?.(groupNodeId, { soloed: !currentSoloed });
  };

  const handleNameChange = (trackId, newName) => {
    const normalizedName = normalizeTrackName(newName);
    if (normalizedName) {
      onUpdateTrack(trackId, { name: normalizedName });
    }
    setEditingName(null);
  };

  const handleRenameGroup = (groupRow) => {
    const nextNameRaw = window.prompt('Rename group', groupRow.name);
    if (nextNameRaw === null) return;
    const normalizedName = normalizeTrackName(nextNameRaw);
    if (!normalizedName) return;
    onRenameGroup?.(groupRow.nodeId, normalizedName);
  };

  const handleGroupNameChange = (groupNodeId, newName) => {
    const normalizedName = normalizeTrackName(newName);
    if (normalizedName) {
      onRenameGroup?.(groupNodeId, normalizedName);
    }
    setEditingName(null);
  };

  const getRoleColor = (role) => {
    const colors = {
      instrument: 'bg-purple-600',
      lead: 'bg-blue-600',
      choir: 'bg-green-600',
      'choir-part-1': 'bg-green-600',
      'choir-part-2': 'bg-green-500',
      'choir-part-3': 'bg-green-400',
      'choir-part-4': 'bg-teal-500',
      'choir-part-5': 'bg-teal-400',
      instruments: 'bg-purple-700',
      leads: 'bg-blue-700',
      choirs: 'bg-green-700',
      others: 'bg-gray-700',
      other: 'bg-gray-600',
      group: 'bg-gray-600',
    };
    return colors[role] || 'bg-gray-600';
  };

  if (!visibleRows.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p>No tracks yet. Import audio files to get started.</p>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="flex flex-col min-h-full"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          type: 'empty',
        });
      }}
    >
      {visibleRows.map((row, rowIndex) => {
        const offsetY = getRowDragOffsetY(rowIndex, row.nodeId);
        const isDragging = draggingNodeId === row.nodeId;
        const isActivelyDragging = isDragging && Boolean(rowDragPreview?.moved);
        const previewDepth = isActivelyDragging
          ? (rowDragPreview?.targetDepth ?? row.depth ?? 0)
          : (row.depth ?? 0);
        const hasRowMotion = Boolean(rowDragPreview?.moved);
        const rowMotionStyle = hasRowMotion
          ? {
              transform: `translateY(${offsetY}px)`,
              transition: 'none',
              position: 'relative',
              zIndex: isDragging ? 30 : 1,
              boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.35)' : undefined,
              willChange: 'transform',
            }
          : {};

        if (row.kind === 'group') {
          const groupCollapsed = Boolean(row.collapsed);
          const groupIconKey = getDefaultIconKey(row.role);
          const GroupIcon = groupIconKey === 'music'
            ? Music
            : (groupIconKey === 'mic' ? Mic : (groupIconKey === 'users' ? Users : Waves));
          const isSelectedRow = selectedNodeId === row.nodeId;

          return (
            <div
              key={row.nodeId}
              data-tree-row-id={row.nodeId}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  type: 'group',
                  group: row,
                });
              }}
              onMouseDown={(e) => beginRowReorder(e, row)}
              onClick={() => {
                if (suppressClickRef.current) return;
                selectRow(row);
              }}
              className={`border-b border-gray-700 cursor-pointer ${
                isSelectedRow
                  ? 'bg-gray-700'
                  : 'bg-gray-800 hover:bg-gray-750'
              } ${isActivelyDragging ? 'cursor-grabbing' : ''}`}
              style={{
                height: `${row.height}px`,
                minHeight: `${row.height}px`,
                maxHeight: `${row.height}px`,
                ...rowMotionStyle,
              }}
            >
              <div
                className="h-full flex items-center gap-4 pr-4"
                style={{ paddingLeft: `${16 + previewDepth * 16}px` }}
              >
                <div
                  data-track-interactive="true"
                  className="flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className={`w-14 h-14 rounded-lg ${getRoleColor(row.role)} text-white flex items-center justify-center`}>
                    <GroupIcon size={22} />
                  </div>
                </div>

                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div
                    className="flex items-center min-w-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectRow(row);
                    }}
                  >
                    {editingName === `group:${row.nodeId}` ? (
                      <input
                        type="text"
                        defaultValue={row.name}
                        autoFocus
                        onBlur={(e) => handleGroupNameChange(row.nodeId, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleGroupNameChange(row.nodeId, e.target.value);
                          } else if (e.key === 'Escape') {
                            setEditingName(null);
                          }
                        }}
                        data-track-interactive="true"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 bg-transparent border-b border-blue-500 px-0 py-0 text-lg font-semibold leading-none focus:outline-none min-w-0 h-[28px]"
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingName(`group:${row.nodeId}`);
                        }}
                        className="flex-1 text-lg font-semibold truncate min-w-0 h-[28px] flex items-center select-none"
                        title="Double-click to edit"
                      >
                        {row.name}
                      </span>
                    )}
                  </div>

                  <div data-track-interactive="true" className="flex items-center gap-3">
                    <div className="flex items-center gap-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleGroupMute(row.nodeId, row.muted);
                        }}
                        className={`w-7 h-7 flex items-center justify-center rounded-l-md rounded-r-none border border-gray-600 transition-colors ${
                          row.muted ? 'bg-red-600 text-white' : 'bg-gray-800 hover:bg-gray-600 text-gray-300'
                        }`}
                        title={row.muted ? 'Unmute group' : 'Mute group'}
                      >
                        {row.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleGroupSolo(row.nodeId, row.soloed);
                        }}
                        className={`w-7 h-7 flex items-center justify-center rounded-r-md rounded-l-none border border-l-0 border-gray-600 transition-colors ${
                          row.soloed ? 'bg-yellow-600 text-white' : 'bg-gray-800 hover:bg-gray-600 text-gray-300'
                        }`}
                        title={row.soloed ? 'Unsolo group' : 'Solo group'}
                      >
                        <Headphones size={16} />
                      </button>
                    </div>

                    <button
                      data-track-interactive="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleGroupCollapse?.(row.nodeId);
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-600 transition-colors bg-gray-800 hover:bg-gray-600 text-gray-300 -ml-1"
                      title={groupCollapsed ? 'Expand group' : 'Collapse group'}
                    >
                      {groupCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </button>

                    <div
                      className="flex-1 flex items-center relative"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="0.1"
                        value={row.volume ?? 100}
                        readOnly
                        onMouseDown={(e) => {
                          if (e.detail > 1) return;
                          beginDrag(
                            e,
                            row.nodeId,
                            'volume',
                            row.volume ?? 100,
                            (next) => handleGroupVolumeChange(row.nodeId, next)
                          );
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleVolumeDoubleClick(row.nodeId, row.volume ?? 100, e);
                        }}
                        className="w-full volume-slider volume-slider-lg cursor-pointer"
                      />
                      {dragTooltip?.entityId === row.nodeId && dragTooltip.type === 'volume' && (
                        <div
                          className="fixed w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                          style={{ left: dragTooltip.x, top: dragTooltip.y, transform: 'translate(-50%, -100%)' }}
                        >
                          {dragTooltip.value <= 0 ? '-∞' : volumeToDb(dragTooltip.value).toFixed(1)}
                        </div>
                      )}
                      {editTooltip?.entityId === row.nodeId && editTooltip.type === 'volume' && (
                        <input
                          type="text"
                          value={editTooltip.text}
                          onChange={(e) => setEditTooltip({ ...editTooltip, text: e.target.value })}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => commitEditTooltip({
                            onVolumeChange: (next) => handleGroupVolumeChange(row.nodeId, next),
                            onPanChange: (next) => handleGroupPanChange(row.nodeId, next),
                          })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              commitEditTooltip({
                                onVolumeChange: (next) => handleGroupVolumeChange(row.nodeId, next),
                                onPanChange: (next) => handleGroupPanChange(row.nodeId, next),
                              });
                            } else if (e.key === 'Escape') {
                              setEditTooltip(null);
                            }
                          }}
                          className="fixed w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                          style={{ left: editTooltip.x, top: editTooltip.y, transform: 'translate(-50%, -100%)' }}
                          autoFocus
                        />
                      )}
                    </div>

                    <div
                      className="relative w-8 h-8 flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <div className="absolute inset-0 overflow-hidden">
                        <div className="absolute inset-0 pan-ring pointer-events-none" />
                        <div className="absolute left-1/2 top-1/2 w-6 h-6 rounded-full bg-gray-700 border border-gray-600 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
                        <div
                          className="absolute left-1/2 top-1/2 w-[3px] h-3 bg-gray-200 rounded-full origin-bottom pointer-events-none"
                          style={{ transform: `translate(-50%, -100%) rotate(${((row.pan ?? 0) / 100) * 135}deg)` }}
                        />
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        step="1"
                        value={row.pan ?? 0}
                        readOnly
                        onMouseDown={(e) => {
                          if (e.detail > 1) return;
                          beginDrag(
                            e,
                            row.nodeId,
                            'pan',
                            row.pan ?? 0,
                            (next) => handleGroupPanChange(row.nodeId, next)
                          );
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handlePanDoubleClick(row.nodeId, row.pan ?? 0, e);
                        }}
                        className="absolute top-0 left-0 right-0 h-4 pan-knob opacity-0 cursor-pointer z-10 pointer-events-auto appearance-none touch-none"
                        aria-label="Group pan"
                      />
                      {dragTooltip?.entityId === row.nodeId && dragTooltip.type === 'pan' && (
                        <div
                          className="fixed w-12 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                          style={{ left: dragTooltip.x, top: dragTooltip.y, transform: 'translate(-50%, -100%)' }}
                        >
                          {Math.round(dragTooltip.value)}
                        </div>
                      )}
                      {editTooltip?.entityId === row.nodeId && editTooltip.type === 'pan' && (
                        <input
                          type="text"
                          value={editTooltip.text}
                          onChange={(e) => setEditTooltip({ ...editTooltip, text: e.target.value })}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => commitEditTooltip({
                            onVolumeChange: (next) => handleGroupVolumeChange(row.nodeId, next),
                            onPanChange: (next) => handleGroupPanChange(row.nodeId, next),
                          })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              commitEditTooltip({
                                onVolumeChange: (next) => handleGroupVolumeChange(row.nodeId, next),
                                onPanChange: (next) => handleGroupPanChange(row.nodeId, next),
                              });
                            } else if (e.key === 'Escape') {
                              setEditTooltip(null);
                            }
                          }}
                          className="fixed w-12 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                          style={{ left: editTooltip.x, top: editTooltip.y, transform: 'translate(-50%, -100%)' }}
                          autoFocus
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        const track = row.track || trackMap.get(row.trackId);
        if (!track) return null;

        const trackHeight = row.height || TRACK_HEIGHT;
        const { Icon: TrackIcon } = getIconForTrack(track);
        const isSelectedRow = selectedNodeId
          ? selectedNodeId === row.nodeId
          : selectedTrackId === track.id;

        return (
          <div
            key={row.nodeId}
            data-tree-row-id={row.nodeId}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                type: 'track',
                track,
                row,
              });
            }}
            onMouseDown={(e) => beginRowReorder(e, row)}
            onClick={() => {
              if (suppressClickRef.current) return;
              selectRow(row);
            }}
            className={`border-b border-gray-700 cursor-pointer ${
              isSelectedRow ? 'bg-gray-700' : 'bg-gray-800 hover:bg-gray-750'
            } ${isActivelyDragging ? 'cursor-grabbing' : ''}`}
            style={{
              height: `${trackHeight}px`,
              minHeight: `${trackHeight}px`,
              maxHeight: `${trackHeight}px`,
              ...rowMotionStyle,
            }}
          >
            <div
              className="h-full flex items-center gap-4 pr-4"
              style={{ paddingLeft: `${16 + previewDepth * 16}px` }}
            >
                <div
                  data-track-interactive="true"
                  className="flex-shrink-0"
                  onClick={() => selectRow(row)}
                >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    cycleIcon(track);
                  }}
                  className={`w-14 h-14 rounded-lg ${getRoleColor(track.role)} text-white flex items-center justify-center`}
                  title="Click to change icon"
                >
                  <TrackIcon size={22} />
                </button>
              </div>

              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div
                  className="flex items-center min-w-0"
                  onClick={() => selectRow(row)}
                >
                  {editingName === track.id ? (
                    <input
                      type="text"
                      defaultValue={track.name}
                      autoFocus
                      onBlur={(e) => handleNameChange(track.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleNameChange(track.id, e.target.value);
                        } else if (e.key === 'Escape') {
                          setEditingName(null);
                        }
                      }}
                      data-track-interactive="true"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-transparent border-b border-blue-500 px-0 py-0 text-lg font-semibold leading-none focus:outline-none min-w-0 h-[28px]"
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingName(track.id);
                      }}
                      className="flex-1 text-lg font-semibold truncate min-w-0 h-[28px] flex items-center select-none"
                      title="Double-click to edit"
                    >
                      {track.name}
                    </span>
                  )}
                </div>

                <div data-track-interactive="true" className="flex items-center gap-3">
                  <div className="flex items-center gap-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleMute(track.id, track.muted);
                      }}
                      className={`w-7 h-7 flex items-center justify-center rounded-l-md rounded-r-none border border-gray-600 transition-colors ${
                        track.muted ? 'bg-red-600 text-white' : 'bg-gray-800 hover:bg-gray-600 text-gray-300'
                      }`}
                      title={track.muted ? 'Unmute' : 'Mute'}
                    >
                      {track.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSolo(track.id, track.soloed);
                      }}
                      className={`w-7 h-7 flex items-center justify-center rounded-r-md rounded-l-none border border-l-0 border-gray-600 transition-colors ${
                        track.soloed ? 'bg-yellow-600 text-white' : 'bg-gray-800 hover:bg-gray-600 text-gray-300'
                      }`}
                      title={track.soloed ? 'Unsolo' : 'Solo'}
                    >
                      <Headphones size={16} />
                    </button>
                  </div>

                  <div
                    className="flex-1 flex items-center relative"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="0.1"
                      value={track.volume}
                      readOnly
                      onMouseDown={(e) => {
                        if (e.detail > 1) return;
                        beginDrag(
                          e,
                          track.id,
                          'volume',
                          track.volume,
                          (next) => handleVolumeChange(track.id, next)
                        );
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleVolumeDoubleClick(track.id, track.volume, e);
                      }}
                      className="w-full volume-slider volume-slider-lg cursor-pointer"
                    />
                    {dragTooltip?.entityId === track.id && dragTooltip.type === 'volume' && (
                      <div
                        className="fixed w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                        style={{ left: dragTooltip.x, top: dragTooltip.y, transform: 'translate(-50%, -100%)' }}
                      >
                        {dragTooltip.value <= 0 ? '-∞' : volumeToDb(dragTooltip.value).toFixed(1)}
                      </div>
                    )}
                    {editTooltip?.entityId === track.id && editTooltip.type === 'volume' && (
                      <input
                        type="text"
                        value={editTooltip.text}
                        onChange={(e) => setEditTooltip({ ...editTooltip, text: e.target.value })}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => commitEditTooltip({
                          onVolumeChange: (next) => handleVolumeChange(track.id, next),
                          onPanChange: (next) => handlePanChange(track.id, next),
                        })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            commitEditTooltip({
                              onVolumeChange: (next) => handleVolumeChange(track.id, next),
                              onPanChange: (next) => handlePanChange(track.id, next),
                            });
                          } else if (e.key === 'Escape') {
                            setEditTooltip(null);
                          }
                        }}
                        className="fixed w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                        style={{ left: editTooltip.x, top: editTooltip.y, transform: 'translate(-50%, -100%)' }}
                        autoFocus
                      />
                    )}
                  </div>

                  <div
                    className="relative w-8 h-8 flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="absolute inset-0 overflow-hidden">
                      <div className="absolute inset-0 pan-ring pointer-events-none" />
                      <div className="absolute left-1/2 top-1/2 w-6 h-6 rounded-full bg-gray-700 border border-gray-600 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
                      <div
                        className="absolute left-1/2 top-1/2 w-[3px] h-3 bg-gray-200 rounded-full origin-bottom pointer-events-none"
                        style={{ transform: `translate(-50%, -100%) rotate(${(track.pan / 100) * 135}deg)` }}
                      />
                    </div>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      step="1"
                      value={track.pan}
                      readOnly
                      onMouseDown={(e) => {
                        if (e.detail > 1) return;
                        beginDrag(
                          e,
                          track.id,
                          'pan',
                          track.pan,
                          (next) => handlePanChange(track.id, next)
                        );
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handlePanDoubleClick(track.id, track.pan, e);
                      }}
                      className="absolute top-0 left-0 right-0 h-4 pan-knob opacity-0 cursor-pointer z-10 pointer-events-auto appearance-none touch-none"
                      aria-label="Pan"
                    />
                    {dragTooltip?.entityId === track.id && dragTooltip.type === 'pan' && (
                      <div
                        className="fixed w-12 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                        style={{ left: dragTooltip.x, top: dragTooltip.y, transform: 'translate(-50%, -100%)' }}
                      >
                        {Math.round(dragTooltip.value)}
                      </div>
                    )}
                    {editTooltip?.entityId === track.id && editTooltip.type === 'pan' && (
                      <input
                        type="text"
                        value={editTooltip.text}
                        onChange={(e) => setEditTooltip({ ...editTooltip, text: e.target.value })}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => commitEditTooltip({
                          onVolumeChange: (next) => handleVolumeChange(track.id, next),
                          onPanChange: (next) => handlePanChange(track.id, next),
                        })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            commitEditTooltip({
                              onVolumeChange: (next) => handleVolumeChange(track.id, next),
                              onPanChange: (next) => handlePanChange(track.id, next),
                            });
                          } else if (e.key === 'Escape') {
                            setEditTooltip(null);
                          }
                        }}
                        className="fixed w-12 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                        style={{ left: editTooltip.x, top: editTooltip.y, transform: 'translate(-50%, -100%)' }}
                        autoFocus
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {contextMenu && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {contextMenu.type === 'track' && contextMenu.track ? (
            <>
              <button
                className={menuItemClass}
                onClick={() => {
                  setEditingName(contextMenu.track.id);
                  setContextMenu(null);
                }}
              >
                Rename track
              </button>

              {getInheritedParentGroupRole(contextMenu.row) ? (
                <div className="w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-500 whitespace-nowrap select-none">
                  Change track type (inherited)
                </div>
              ) : (
                <div className="relative">
                  <div
                    className={`${menuItemClass} select-none cursor-pointer`}
                    onMouseEnter={openTypeMenu}
                    onMouseLeave={() => setIsTypeTriggerHover(false)}
                    style={{
                      backgroundColor: (isTypeTriggerHover || isTypeMenuHover || isChoirTriggerHover || isChoirMenuHover)
                        ? '#374151'
                        : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span>Change track type</span>
                      <ChevronRight size={14} className="text-gray-400 ml-0.5" />
                    </div>
                  </div>
                </div>
              )}

              {isChoirRole(contextMenu.track.role) && (
                <div className="relative">
                  <div
                    className={`${menuItemClass} select-none cursor-pointer`}
                    onMouseEnter={openAutoPanMenu}
                    onMouseLeave={() => setIsAutoPanTriggerHover(false)}
                    style={{
                      backgroundColor: (isAutoPanTriggerHover || isAutoPanMenuHover) ? '#374151' : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span>Auto-pan choir</span>
                      <ChevronRight size={14} className="text-gray-400 ml-0.5" />
                    </div>
                  </div>
                </div>
              )}

              <button
                className="w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-red-300 hover:bg-gray-700 whitespace-nowrap"
                onClick={() => {
                  onDeleteTrack?.(contextMenu.track.id);
                  setContextMenu(null);
                }}
              >
                Delete track
              </button>

              <div className="my-0.5 border-t border-gray-700" />

              <button
                className={menuItemClass}
                onClick={() => {
                  onAddTrack?.({
                    parentId: contextMenu.row?.parentId || null,
                    afterNodeId: contextMenu.row?.nodeId || null,
                  });
                  setContextMenu(null);
                }}
              >
                Create track
              </button>
              <button
                className={menuItemClass}
                onClick={() => {
                  onCreateSubtrack?.(contextMenu.track.id);
                  setContextMenu(null);
                }}
              >
                Create subtrack
              </button>
            </>
          ) : null}

          {contextMenu.type === 'group' && contextMenu.group ? (
            <>
              <button
                className={menuItemClass}
                onClick={() => {
                  handleRenameGroup(contextMenu.group);
                  setContextMenu(null);
                }}
              >
                Rename group
              </button>
              {getInheritedParentGroupRole(contextMenu.group) ? (
                <div className="w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-500 whitespace-nowrap select-none">
                  Change track type (inherited)
                </div>
              ) : (
                <div className="relative">
                  <div
                    className={`${menuItemClass} select-none cursor-pointer`}
                    onMouseEnter={openGroupTypeMenu}
                    onMouseLeave={() => setIsGroupTypeTriggerHover(false)}
                    style={{
                      backgroundColor: (
                        isGroupTypeTriggerHover
                        || isGroupTypeMenuHover
                        || isGroupTrackTypeTriggerHover
                        || isGroupTrackTypeMenuHover
                        || isGroupPartTypeTriggerHover
                        || isGroupPartTypeMenuHover
                      )
                        ? '#374151'
                        : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span>Change track type</span>
                      <ChevronRight size={14} className="text-gray-400 ml-0.5" />
                    </div>
                  </div>
                </div>
              )}
              <button
                className={menuItemClass}
                onClick={() => {
                  onToggleGroupCollapse?.(contextMenu.group.nodeId);
                  setContextMenu(null);
                }}
              >
                {contextMenu.group.collapsed ? 'Expand group' : 'Collapse group'}
              </button>
              <button
                className="w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-red-300 hover:bg-gray-700 whitespace-nowrap"
                onClick={() => {
                  onDeleteGroup?.(contextMenu.group.nodeId);
                  setContextMenu(null);
                }}
              >
                Delete group
              </button>

              <div className="my-0.5 border-t border-gray-700" />

              <button
                className={menuItemClass}
                onClick={() => {
                  onAddTrack?.({
                    parentId: contextMenu.group.parentId || null,
                    afterNodeId: contextMenu.group.nodeId,
                  });
                  setContextMenu(null);
                }}
              >
                Create track
              </button>
              <button
                className={menuItemClass}
                onClick={() => {
                  onAddTrack?.(contextMenu.group.nodeId);
                  setContextMenu(null);
                }}
              >
                Create subtrack
              </button>
            </>
          ) : null}

          {contextMenu.type === 'empty' ? (
            <>
              <button
                className={menuItemClass}
                onClick={() => {
                  onAddTrack?.();
                  setContextMenu(null);
                }}
              >
                Create a track
              </button>
            </>
          ) : null}
        </div>
      )}

      {contextMenu && contextMenu.type === 'track' && contextMenu.track && typeMenuOpen && !getInheritedParentGroupRole(contextMenu.row) && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden min-w-[120px]"
          style={{ left: typeMenuPos.x, top: typeMenuPos.y }}
          onMouseEnter={() => setIsTypeMenuHover(true)}
          onMouseLeave={() => setIsTypeMenuHover(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.INSTRUMENT });
              setContextMenu(null);
            }}
          >
            Instrument
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.LEAD });
              setContextMenu(null);
            }}
          >
            Lead
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.CHOIR });
              setContextMenu(null);
            }}
          >
            Choir Part
          </button>

          {autoPanManualChoirParts && (
            <div
              className={`${menuItemClass} select-none cursor-pointer`}
              onMouseEnter={openChoirMenu}
              onMouseLeave={() => setIsChoirTriggerHover(false)}
              style={{ backgroundColor: (isChoirTriggerHover || isChoirMenuHover) ? '#374151' : undefined }}
            >
              <div className="flex items-center justify-between w-full">
                <span>Choir part</span>
                <ChevronRight size={14} className="text-gray-400 ml-0.5" />
              </div>
            </div>
          )}

          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.OTHER });
              setContextMenu(null);
            }}
          >
            Other
          </button>
        </div>
      )}

      {contextMenu && contextMenu.type === 'track' && contextMenu.track && choirMenuOpen && autoPanManualChoirParts && !getInheritedParentGroupRole(contextMenu.row) && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden min-w-[25px]"
          style={{ left: choirMenuPos.x, top: choirMenuPos.y }}
          onMouseEnter={() => setIsChoirMenuHover(true)}
          onMouseLeave={() => setIsChoirMenuHover(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.CHOIR_PART_1 });
              setContextMenu(null);
            }}
          >
            1
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.CHOIR_PART_2 });
              setContextMenu(null);
            }}
          >
            2
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.CHOIR_PART_3 });
              setContextMenu(null);
            }}
          >
            3
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.CHOIR_PART_4 });
              setContextMenu(null);
            }}
          >
            4
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateTrack?.(contextMenu.track.id, { role: TRACK_ROLES.CHOIR_PART_5 });
              setContextMenu(null);
            }}
          >
            5
          </button>
        </div>
      )}

      {contextMenu && contextMenu.type === 'group' && contextMenu.group && groupTypeMenuOpen && !getInheritedParentGroupRole(contextMenu.group) && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden min-w-[140px]"
          style={{ left: groupTypeMenuPos.x, top: groupTypeMenuPos.y }}
          onMouseEnter={() => setIsGroupTypeMenuHover(true)}
          onMouseLeave={() => setIsGroupTypeMenuHover(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {!contextMenu.group.parentId ? (
            <>
              <div
                className={`${menuItemClass} select-none cursor-pointer`}
                onMouseEnter={openGroupTrackTypeMenu}
                onMouseLeave={() => setIsGroupTrackTypeTriggerHover(false)}
                style={{ backgroundColor: (isGroupTrackTypeTriggerHover || isGroupTrackTypeMenuHover) ? '#374151' : undefined }}
              >
                <div className="flex items-center justify-between w-full">
                  <span>Group track</span>
                  <ChevronRight size={14} className="text-gray-400 ml-0.5" />
                </div>
              </div>
              <div
                className={`${menuItemClass} select-none cursor-pointer`}
                onMouseEnter={openGroupPartTypeMenu}
                onMouseLeave={() => setIsGroupPartTypeTriggerHover(false)}
                style={{ backgroundColor: (isGroupPartTypeTriggerHover || isGroupPartTypeMenuHover) ? '#374151' : undefined }}
              >
                <div className="flex items-center justify-between w-full">
                  <span>Part track</span>
                  <ChevronRight size={14} className="text-gray-400 ml-0.5" />
                </div>
              </div>
              <button
                className={menuItemClass}
                onClick={() => {
                  onUpdateGroup?.(contextMenu.group.nodeId, { role: TRACK_ROLES.OTHER });
                  setContextMenu(null);
                }}
              >
                Other
              </button>
            </>
          ) : (
            <>
              <button
                className={menuItemClass}
                onClick={() => {
                  onUpdateGroup?.(contextMenu.group.nodeId, { role: TRACK_ROLES.INSTRUMENT });
                  setContextMenu(null);
                }}
              >
                Instrument
              </button>
              <button
                className={menuItemClass}
                onClick={() => {
                  onUpdateGroup?.(contextMenu.group.nodeId, { role: TRACK_ROLES.LEAD });
                  setContextMenu(null);
                }}
              >
                Lead
              </button>
              <button
                className={menuItemClass}
                onClick={() => {
                  onUpdateGroup?.(contextMenu.group.nodeId, { role: TRACK_ROLES.CHOIR });
                  setContextMenu(null);
                }}
              >
                Choir Part
              </button>
              <button
                className={menuItemClass}
                onClick={() => {
                  onUpdateGroup?.(contextMenu.group.nodeId, { role: TRACK_ROLES.OTHER });
                  setContextMenu(null);
                }}
              >
                Other
              </button>
            </>
          )}
        </div>
      )}

      {contextMenu && contextMenu.type === 'group' && contextMenu.group && groupTrackTypeMenuOpen && !contextMenu.group.parentId && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden min-w-[130px]"
          style={{ left: groupTrackTypeMenuPos.x, top: groupTrackTypeMenuPos.y }}
          onMouseEnter={() => setIsGroupTrackTypeMenuHover(true)}
          onMouseLeave={() => setIsGroupTrackTypeMenuHover(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateGroup?.(contextMenu.group.nodeId, { role: GROUP_ROLE_INSTRUMENTS });
              setContextMenu(null);
            }}
          >
            Instruments
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateGroup?.(contextMenu.group.nodeId, { role: GROUP_ROLE_LEADS });
              setContextMenu(null);
            }}
          >
            Leads
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateGroup?.(contextMenu.group.nodeId, { role: GROUP_ROLE_CHOIRS });
              setContextMenu(null);
            }}
          >
            Choir
          </button>
        </div>
      )}

      {contextMenu && contextMenu.type === 'group' && contextMenu.group && groupPartTypeMenuOpen && !contextMenu.group.parentId && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden min-w-[120px]"
          style={{ left: groupPartTypeMenuPos.x, top: groupPartTypeMenuPos.y }}
          onMouseEnter={() => setIsGroupPartTypeMenuHover(true)}
          onMouseLeave={() => setIsGroupPartTypeMenuHover(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateGroup?.(contextMenu.group.nodeId, { role: TRACK_ROLES.INSTRUMENT });
              setContextMenu(null);
            }}
          >
            Instrument
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateGroup?.(contextMenu.group.nodeId, { role: TRACK_ROLES.LEAD });
              setContextMenu(null);
            }}
          >
            Lead
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              onUpdateGroup?.(contextMenu.group.nodeId, { role: TRACK_ROLES.CHOIR });
              setContextMenu(null);
            }}
          >
            Choir Part
          </button>
        </div>
      )}

      {contextMenu && contextMenu.type === 'track' && contextMenu.track && autoPanMenuOpen && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden min-w-[140px]"
          style={{ left: autoPanMenuPos.x, top: autoPanMenuPos.y }}
          onMouseEnter={() => setIsAutoPanMenuHover(true)}
          onMouseLeave={() => setIsAutoPanMenuHover(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            className={menuItemClass}
            onClick={() => {
              onToggleAutoPanInverted?.();
              setContextMenu(null);
            }}
          >
            Inverted Auto Pan: {autoPanInverted ? 'On' : 'Off'}
          </button>

          <div className="my-0.5 border-t border-gray-700" />

          <button
            className={menuItemClass}
            onClick={() => {
              onSetAutoPanStrategy?.('off');
              setContextMenu(null);
            }}
          >
            Off
          </button>
          {AUTO_PAN_STRATEGIES.map((option) => (
            <button
              key={option.id}
              className={menuItemClass}
              onClick={() => {
                onSetAutoPanStrategy?.(option.id);
                setContextMenu(null);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default TrackList;
