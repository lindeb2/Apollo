import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [retryTick, setRetryTick] = useState(0);

  const clientRef = useRef(null);
  const applyingRemoteRef = useRef(false);
  const lastSyncedSnapshotRef = useRef('');
  const uploadedBlobIdsRef = useRef(new Set());
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

  useEffect(() => {
    latestSeqRef.current = latestSeq;
  }, [latestSeq]);

  useEffect(() => {
    if (!enabled || !session || !projectId || !serverProjectId) return;

    let disposed = false;
    setLockByTrackId({});

    const applyRemoteSnapshot = async (snapshot, seq) => {
      if (!snapshot || typeof snapshot !== 'object') return;
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

    const ensureMediaUploaded = async (currentProject) => {
      const blobIds = collectBlobIds(currentProject);
      for (const blobId of blobIds) {
        if (uploadedBlobIdsRef.current.has(blobId)) continue;

        const media = await getMediaBlob(blobId);
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
    };

    const flushPending = async () => {
      const pending = await getPendingSyncOp(projectId);
      if (!pending?.payload) return;
      const payload = pending.payload;
      await ensureMediaUploaded(payload.project);
      const sent = clientRef.current?.submitOp(payload.op, payload.clientOpId);
      if (sent) {
        await clearPendingSyncOp(projectId);
      }
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
          await flushPending();
        },
        onDisconnected: () => {
          if (disposed) return;
          setConnected(false);
        },
        onJoined: async (message) => {
          if (disposed) return;
          const seq = Number(message.latestSeq || 0);
          if (message.snapshot) {
            await applyRemoteSnapshot(message.snapshot, seq);
          } else {
            setLatestSeq(seq);
          }
          if (Array.isArray(message.missingOps) && message.missingOps.length > 0) {
            for (const entry of message.missingOps) {
              if (entry?.op?.type === 'project.replace' && entry.op.project) {
                await applyRemoteSnapshot(entry.op.project, Number(entry.serverSeq || seq));
              }
            }
          }
          await flushPending();
        },
        onBroadcast: async (message) => {
          if (disposed) return;
          const seq = Number(message.serverSeq || 0);
          if (seq <= latestSeqRef.current) return;

          if (message?.op?.type === 'project.replace' && message.op.project) {
            await applyRemoteSnapshot(message.op.project, seq);
          } else {
            setLatestSeq(seq);
          }
        },
        onAck: async (message) => {
          if (disposed) return;
          const seq = Number(message.serverSeq || 0);
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
      if (clientRef.current) {
        clientRef.current.dispose();
        clientRef.current = null;
      }
    };
  }, [enabled, session, serverProjectId, projectId, updateProject, remoteSession?.latestSeq]);

  useEffect(() => {
    if (!enabled || !project || !projectId || !session) return;
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
        const blobIds = collectBlobIds(project);
        for (const blobId of blobIds) {
          if (uploadedBlobIdsRef.current.has(blobId)) continue;
          const media = await getMediaBlob(blobId);
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

        const sent = clientRef.current.submitOp(op, clientOpId);
        if (!sent) {
          await upsertPendingSyncOp(projectId, { op, clientOpId, project });
        }
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
  }, [enabled, project, projectId, session, retryTick]);

  return {
    connected,
    latestSeq,
    syncError,
    lockByTrackId,
    lockHelpers,
  };
}
