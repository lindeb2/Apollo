import {
  clearServerSession,
  getWsUrl,
  loadServerSession,
  refreshSession,
  saveServerSession,
} from './serverApi';

export function createRealtimeSyncClient({
  session,
  projectId,
  knownSeq = 0,
  onJoined,
  onBroadcast,
  onAck,
  onLockState,
  onConnected,
  onDisconnected,
  onError,
}) {
  const wsUrl = getWsUrl();
  if (!wsUrl) {
    throw new Error('WebSocket URL is not configured. Set VITE_SERVER_WS_BASE.');
  }

  let ws = null;
  let reconnectTimer = null;
  let disposed = false;
  let connected = false;
  let currentKnownSeq = Number(knownSeq || 0);
  let authRefreshInFlight = false;

  const send = (type, payload = {}) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type, ...payload }));
    return true;
  };

  const connect = () => {
    if (disposed) return;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      connected = true;
      onConnected?.();
      const latestSession = loadServerSession();
      const accessToken = latestSession?.accessToken || '';
      send('auth.hello', { accessToken });
      send('project.join', {
        projectId,
        knownSeq: currentKnownSeq,
      });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        switch (message.type) {
          case 'project.joined':
            currentKnownSeq = Number(message.latestSeq || currentKnownSeq);
            onJoined?.(message);
            break;
          case 'op.broadcast':
            currentKnownSeq = Math.max(currentKnownSeq, Number(message.serverSeq || 0));
            onBroadcast?.(message);
            break;
          case 'op.ack':
            currentKnownSeq = Math.max(currentKnownSeq, Number(message.serverSeq || 0));
            onAck?.(message);
            break;
          case 'lock.state':
            onLockState?.(message);
            break;
          case 'error':
            if (message?.code === 'AUTH_REQUIRED' && !authRefreshInFlight) {
              authRefreshInFlight = true;
              const activeSession = loadServerSession();
              const refreshToken = activeSession?.refreshToken || '';
              if (refreshToken) {
                refreshSession(refreshToken)
                  .then((refreshed) => {
                    if (!refreshed?.accessToken || !refreshed?.refreshToken) return;
                    saveServerSession(refreshed);
                    if (ws && ws.readyState === WebSocket.OPEN) {
                      ws.close();
                    }
                  })
                  .catch((error) => {
                    if (/invalid refresh token/i.test(String(error?.message || ''))) {
                      clearServerSession();
                      onError?.({
                        code: 'AUTH_EXPIRED',
                        message: 'Session expired. Please log in again. Local edits continue unsynced.',
                      });
                    }
                  })
                  .finally(() => {
                    authRefreshInFlight = false;
                  });
              } else {
                authRefreshInFlight = false;
              }
            }
            onError?.(message);
            break;
          default:
            break;
        }
      } catch (error) {
        onError?.({ message: error.message || String(error) });
      }
    };

    ws.onclose = () => {
      connected = false;
      onDisconnected?.();
      if (!disposed && loadServerSession()?.accessToken) {
        reconnectTimer = setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => {
      // onclose handles reconnect path
    };
  };

  connect();

  return {
    get connected() {
      return connected;
    },
    get knownSeq() {
      return currentKnownSeq;
    },
    submitOp(op, clientOpId) {
      return send('op.submit', {
        projectId,
        clientOpId,
        op,
      });
    },
    acquireTrackLock(trackId) {
      return send('lock.acquire', { projectId, trackId });
    },
    heartbeatTrackLock(trackId) {
      return send('lock.heartbeat', { projectId, trackId });
    },
    releaseTrackLock(trackId) {
      return send('lock.release', { projectId, trackId });
    },
    dispose() {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
      }
    },
  };
}
