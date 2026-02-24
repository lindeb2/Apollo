import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRealtimeSyncClient } from '../lib/realtimeSyncClient';
import {
  clearPendingSyncOp,
  getMediaBlob,
  getPendingSyncOp,
  loadRemoteProjectMeta,
  saveRemoteProjectMeta,
  upsertPendingSyncOp,
} from '../lib/db';
import {
  registerMedia,
  uploadMedia,
} from '../lib/serverApi';
import { createId } from '../utils/id';

async function hashBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  if (globalThis?.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const bytes = new Uint8Array(arrayBuffer);
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function collectBlobIds(project) {
  const ids = new Set();
  (project?.tracks || []).forEach((track) => {
    (track.clips || []).forEach((clip) => {
      if (clip?.blobId) ids.add(clip.blobId);
    });
  });
  return Array.from(ids);
}

function isMissingMediaBlobError(error) {
  const message = String(error?.message || '');
  return /^Media blob .+ not found$/.test(message);
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nearlyEqual(a, b, epsilon = 1e-6) {
  return Math.abs(toNumber(a) - toNumber(b)) <= epsilon;
}

function collectTrackById(project) {
  const map = new Map();
  (project?.tracks || []).forEach((track) => {
    if (track?.id) {
      map.set(track.id, track);
    }
  });
  return map;
}

function collectGroupNodeById(project) {
  const map = new Map();
  (project?.trackTree || []).forEach((node) => {
    if (node?.kind === 'group' && node?.id) {
      map.set(node.id, node);
    }
  });
  return map;
}

function collectClipStateById(project) {
  const map = new Map();
  (project?.tracks || []).forEach((track) => {
    (track?.clips || []).forEach((clip) => {
      if (!clip?.id) return;
      map.set(clip.id, {
        trackId: track.id,
        timelineStartMs: toNumber(clip.timelineStartMs, 0),
        cropStartMs: toNumber(clip.cropStartMs, 0),
        cropEndMs: toNumber(clip.cropEndMs, 0),
      });
    });
  });
  return map;
}

function buildRemoteAnimationDiff(previousProject, nextProject) {
  const changedTrackIds = new Set();
  const changedGroupNodeIds = new Set();
  const changedClipIds = new Set();
  const trackValueById = {};
  const groupValueById = {};
  const clipValueById = {};
  const fromMasterVolume = toNumber(previousProject?.masterVolume, 100);
  const toMasterVolume = toNumber(nextProject?.masterVolume, 100);

  const previousTracksById = collectTrackById(previousProject);
  const nextTracksById = collectTrackById(nextProject);
  nextTracksById.forEach((nextTrack, trackId) => {
    const previousTrack = previousTracksById.get(trackId);
    if (!previousTrack) return;
    const fromVolume = toNumber(previousTrack.volume, 100);
    const toVolume = toNumber(nextTrack.volume, 100);
    const fromPan = toNumber(previousTrack.pan, 0);
    const toPan = toNumber(nextTrack.pan, 0);
    if (
      !nearlyEqual(fromVolume, toVolume)
      || !nearlyEqual(fromPan, toPan)
    ) {
      changedTrackIds.add(trackId);
      trackValueById[trackId] = {
        fromVolume,
        toVolume,
        fromPan,
        toPan,
      };
    }
  });

  const previousGroupsById = collectGroupNodeById(previousProject);
  const nextGroupsById = collectGroupNodeById(nextProject);
  nextGroupsById.forEach((nextGroup, nodeId) => {
    const previousGroup = previousGroupsById.get(nodeId);
    if (!previousGroup) return;
    const fromVolume = toNumber(previousGroup.volume, 100);
    const toVolume = toNumber(nextGroup.volume, 100);
    const fromPan = toNumber(previousGroup.pan, 0);
    const toPan = toNumber(nextGroup.pan, 0);
    if (
      !nearlyEqual(fromVolume, toVolume)
      || !nearlyEqual(fromPan, toPan)
    ) {
      changedGroupNodeIds.add(nodeId);
      groupValueById[nodeId] = {
        fromVolume,
        toVolume,
        fromPan,
        toPan,
      };
    }
  });

  const previousClipStateById = collectClipStateById(previousProject);
  const nextClipStateById = collectClipStateById(nextProject);
  nextClipStateById.forEach((nextClipState, clipId) => {
    const previousClipState = previousClipStateById.get(clipId);
    if (!previousClipState) return;
    const fromTimelineStartMs = toNumber(previousClipState.timelineStartMs, 0);
    const toTimelineStartMs = toNumber(nextClipState.timelineStartMs, 0);
    const fromCropStartMs = toNumber(previousClipState.cropStartMs, 0);
    const toCropStartMs = toNumber(nextClipState.cropStartMs, 0);
    const fromCropEndMs = toNumber(previousClipState.cropEndMs, 0);
    const toCropEndMs = toNumber(nextClipState.cropEndMs, 0);
    if (
      previousClipState.trackId !== nextClipState.trackId
      || !nearlyEqual(fromTimelineStartMs, toTimelineStartMs)
      || !nearlyEqual(fromCropStartMs, toCropStartMs)
      || !nearlyEqual(fromCropEndMs, toCropEndMs)
    ) {
      changedClipIds.add(clipId);
      clipValueById[clipId] = {
        fromTrackId: previousClipState.trackId,
        toTrackId: nextClipState.trackId,
        fromTimelineStartMs,
        toTimelineStartMs,
        fromCropStartMs,
        toCropStartMs,
        fromCropEndMs,
        toCropEndMs,
      };
    }
  });

  return {
    changedTrackIds: Array.from(changedTrackIds),
    changedGroupNodeIds: Array.from(changedGroupNodeIds),
    changedClipIds: Array.from(changedClipIds),
    trackValueById,
    groupValueById,
    clipValueById,
    masterVolume: nearlyEqual(fromMasterVolume, toMasterVolume)
      ? null
      : {
        from: fromMasterVolume,
        to: toMasterVolume,
      },
  };
}

export default function useRealtimeProjectSync({
  enabled,
  project,
  remoteSession,
  updateProject,
}) {
  const [connected, setConnected] = useState(false);
  const [latestSeq, setLatestSeq] = useState(0);
  const [syncError, setSyncError] = useState('');
  const [lockByTrackId, setLockByTrackId] = useState({});
  const [remoteAnimation, setRemoteAnimation] = useState(null);
  const [joined, setJoined] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const clientRef = useRef(null);
  const projectRef = useRef(project);
  const applyingRemoteRef = useRef(false);
  const lastSyncedSnapshotRef = useRef('');
  const uploadedBlobIdsRef = useRef(new Set());
  const localClientOpIdsRef = useRef(new Set());
  const acknowledgedClientOpIdsRef = useRef(new Set());
  const latestSeqRef = useRef(0);
  const projectId = project?.projectId || null;
  const session = remoteSession?.session || null;
  const serverProjectId = remoteSession?.serverProjectId || projectId;

  const lockHelpers = useMemo(() => ({
    acquire(trackId) {
      return clientRef.current?.acquireTrackLock(trackId) || false;
    },
    heartbeat(trackId) {
      return clientRef.current?.heartbeatTrackLock(trackId) || false;
    },
    release(trackId) {
      return clientRef.current?.releaseTrackLock(trackId) || false;
    },
  }), []);

  const ensureMediaUploaded = useCallback(async (currentProject) => {
    if (!session) return;

    const blobIds = collectBlobIds(currentProject);
    for (const blobId of blobIds) {
      if (uploadedBlobIdsRef.current.has(blobId)) continue;

      let media;
      try {
        media = await getMediaBlob(blobId);
      } catch (error) {
        if (isMissingMediaBlobError(error)) {
          // Preserve forward progress for sync: keep submitting project updates even
          // if some historical media IDs are unavailable in local IndexedDB.
          continue;
        }
        throw error;
      }
      const sha256 = await hashBlob(media.blob);
      const registration = await registerMedia({
        mediaId: blobId,
        sha256,
        mimeType: media.blob.type || 'application/octet-stream',
        sizeBytes: media.blob.size,
        fileName: media.fileName || blobId,
      }, session);

      if (!registration.exists) {
        await uploadMedia(blobId, media.blob, session);
      }

      uploadedBlobIdsRef.current.add(blobId);
    }
  }, [session]);

  useEffect(() => {
    latestSeqRef.current = latestSeq;
  }, [latestSeq]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    if (!enabled || !session || !projectId || !serverProjectId) return;

    let disposed = false;
    setLockByTrackId({});
    setJoined(false);

    const applyRemoteSnapshot = async (snapshot, seq, options = {}) => {
      if (!snapshot || typeof snapshot !== 'object') return;

      const shouldAnimate = Boolean(options?.animateFromOtherClient && projectRef.current);
      let animationPayload = null;
      if (shouldAnimate) {
        const diff = buildRemoteAnimationDiff(projectRef.current, snapshot);
        if (
          diff.changedTrackIds.length > 0
          || diff.changedGroupNodeIds.length > 0
          || diff.changedClipIds.length > 0
          || diff.masterVolume
        ) {
          animationPayload = {
            token: createId(),
            durationMs: 800,
            easing: 'easeInOutQuint',
            ...diff,
          };
        }
      }

      if (animationPayload) {
        // Keep animation payload and incoming snapshot in sync to avoid a one-frame jump
        // where the UI renders "to" values before animation state is applied.
        flushSync(() => {
          setRemoteAnimation(animationPayload);
        });
      }

      applyingRemoteRef.current = true;
      const snapshotString = JSON.stringify(snapshot);
      lastSyncedSnapshotRef.current = snapshotString;
      updateProject(snapshot, 'Apply remote sync update', {
        skipUndo: true,
      });
      setLatestSeq(seq || 0);
      await saveRemoteProjectMeta({
        projectId,
        serverProjectId,
        latestSeq: seq || 0,
      });
      setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 0);
    };

    const flushPending = async () => {
      const pending = await getPendingSyncOp(projectId);
      if (!pending?.payload) return;
      const payload = pending.payload;
      await ensureMediaUploaded(payload.project);
      if (payload.clientOpId) {
        localClientOpIdsRef.current.add(String(payload.clientOpId));
      }
      clientRef.current?.submitOp(payload.op, payload.clientOpId);
    };

    (async () => {
      const remoteMeta = await loadRemoteProjectMeta(projectId);
      const knownSeq = Number(remoteMeta?.latestSeq || remoteSession?.latestSeq || 0);

      if (disposed) return;
      clientRef.current = createRealtimeSyncClient({
        session,
        projectId: serverProjectId,
        knownSeq,
        onConnected: async () => {
          if (disposed) return;
          setConnected(true);
          setSyncError('');
        },
        onDisconnected: () => {
          if (disposed) return;
          setConnected(false);
        },
        onJoined: async (message) => {
          if (disposed) return;
          setJoined(true);
          const seq = Number(message.latestSeq || 0);
          if (message.snapshot) {
            await applyRemoteSnapshot(message.snapshot, seq, {
              animateFromOtherClient: false,
            });
          } else {
            setLatestSeq(seq);
          }
          if (Array.isArray(message.missingOps) && message.missingOps.length > 0) {
            for (const entry of message.missingOps) {
              if (entry?.op?.type === 'project.replace' && entry.op.project) {
                await applyRemoteSnapshot(entry.op.project, Number(entry.serverSeq || seq), {
                  animateFromOtherClient: true,
                });
              }
            }
          }
          try {
            await flushPending();
          } catch (error) {
            if (!disposed) {
              setSyncError(error?.message || 'Failed to flush pending sync operations');
            }
          }
        },
        onBroadcast: async (message) => {
          if (disposed) return;
          const seq = Number(message.serverSeq || 0);
          if (seq < latestSeqRef.current) return;

          if (message?.op?.type === 'project.replace' && message.op.project) {
            const broadcastClientOpId = message?.clientOpId ? String(message.clientOpId) : '';
            const isOwnClientOp = Boolean(
              broadcastClientOpId
              && (
                localClientOpIdsRef.current.has(broadcastClientOpId)
                || acknowledgedClientOpIdsRef.current.has(broadcastClientOpId)
              )
            );
            if (isOwnClientOp && broadcastClientOpId) {
              localClientOpIdsRef.current.delete(broadcastClientOpId);
              acknowledgedClientOpIdsRef.current.delete(broadcastClientOpId);
            }
            await applyRemoteSnapshot(message.op.project, seq, {
              animateFromOtherClient: !isOwnClientOp,
            });
          } else {
            setLatestSeq(seq);
          }
        },
        onAck: async (message) => {
          if (disposed) return;
          const seq = Number(message.serverSeq || 0);
          const ackClientOpId = message?.clientOpId ? String(message.clientOpId) : '';
          if (ackClientOpId) {
            localClientOpIdsRef.current.delete(ackClientOpId);
            acknowledgedClientOpIdsRef.current.add(ackClientOpId);
            if (acknowledgedClientOpIdsRef.current.size > 256) {
              const oldest = acknowledgedClientOpIdsRef.current.values().next().value;
              if (oldest) acknowledgedClientOpIdsRef.current.delete(oldest);
            }
          }

          const pending = await getPendingSyncOp(projectId);

          if (pending?.payload?.clientOpId && pending.payload.clientOpId === message.clientOpId) {
            if (pending?.payload?.op?.type === 'project.replace' && pending.payload.op.project) {
              await applyRemoteSnapshot(pending.payload.op.project, seq || latestSeqRef.current, {
                animateFromOtherClient: false,
              });
            }
            await clearPendingSyncOp(projectId);
          }

          if (seq > 0) {
            setLatestSeq(seq);
            await saveRemoteProjectMeta({
              projectId,
              serverProjectId,
              latestSeq: seq,
            });
          }
        },
        onLockState: (message) => {
          if (disposed) return;
          setLockByTrackId((prev) => ({
            ...prev,
            [message.trackId]: {
              ownerUserId: message.ownerUserId,
              ownerName: message.ownerName,
              expiresAt: message.expiresAt,
            },
          }));
        },
        onError: (message) => {
          if (disposed) return;
          setSyncError(message?.message || 'Realtime sync error');
        },
      });
    })();

    return () => {
      disposed = true;
      setConnected(false);
      setJoined(false);
      if (clientRef.current) {
        clientRef.current.dispose();
        clientRef.current = null;
      }
      localClientOpIdsRef.current.clear();
      acknowledgedClientOpIdsRef.current.clear();
    };
  }, [enabled, session, serverProjectId, projectId, updateProject, remoteSession?.latestSeq, ensureMediaUploaded]);

  useEffect(() => {
    if (!enabled || !project || !projectId || !session || !joined) return;
    if (applyingRemoteRef.current) return;

    const snapshot = JSON.stringify(project);
    if (snapshot === lastSyncedSnapshotRef.current) return;
    lastSyncedSnapshotRef.current = snapshot;

    const send = async () => {
      const op = {
        type: 'project.replace',
        project,
      };
      const clientOpId = createId();
      if (!clientRef.current?.connected) {
        await upsertPendingSyncOp(projectId, { op, clientOpId, project });
        return;
      }

      try {
        await upsertPendingSyncOp(projectId, { op, clientOpId, project });
        await ensureMediaUploaded(project);

        localClientOpIdsRef.current.add(clientOpId);
        const sent = clientRef.current.submitOp(op, clientOpId);
        if (!sent) return;
      } catch (error) {
        setSyncError(error.message || 'Failed to sync project update');
        await upsertPendingSyncOp(projectId, { op, clientOpId, project });
        lastSyncedSnapshotRef.current = '';
        setTimeout(() => {
          setRetryTick((value) => value + 1);
        }, 2000);
      }
    };

    const timeoutId = setTimeout(() => {
      send().catch((error) => {
        setSyncError(error.message || 'Failed to sync project update');
      });
    }, 120);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [enabled, project, projectId, session, retryTick, ensureMediaUploaded, joined]);

  return {
    connected,
    latestSeq,
    syncError,
    remoteAnimation,
    lockByTrackId,
    lockHelpers,
  };
}
