const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');

let wss = null;
const stallStatusMap = new Map(); // stallId -> { lastSeen: number, isOnline: boolean }

function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.isAuthenticated = false;
    ws.role = 'GUEST';
    ws.stallId = null;

    // Close unauthenticated sockets after 5 seconds
    const authTimeout = setTimeout(() => {
      if (!ws.isAuthenticated) {
        try {
          ws.close(4001, 'Authentication timeout');
        } catch (e) {}
      }
    }, 5000);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === 'REGISTER' || data.type === 'AUTH') {
          const token = data.token;
          if (!token) {
            return;
          }

          jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err || !decoded) {
              try { ws.close(4002, 'Invalid token'); } catch (e) {}
              return;
            }

            clearTimeout(authTimeout);
            ws.isAuthenticated = true;
            ws.role = decoded.role;
            ws.stallId = decoded.stall_id || (decoded.role === 'STALL_USER' ? 1 : null);

            if (ws.role === 'STALL_USER' && ws.stallId) {
              updateStallHeartbeat(ws.stallId, true);
            }
          });
        }

        if (data.type === 'HEARTBEAT' && ws.isAuthenticated) {
          ws.isAlive = true;
          if (ws.role === 'STALL_USER' && ws.stallId) {
            updateStallHeartbeat(ws.stallId, true);
          }
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (ws.isAuthenticated && ws.role === 'STALL_USER' && ws.stallId) {
        const hasOtherConns = Array.from(wss.clients).some(
          client => client !== ws && client.readyState === WebSocket.OPEN && client.isAuthenticated && client.role === 'STALL_USER' && client.stallId === ws.stallId
        );
        if (!hasOtherConns) {
          updateStallHeartbeat(ws.stallId, false);
        }
      }
    });
  });

  // Heartbeat freshness check (5-second loop, 12s timeout)
  setInterval(() => {
    const now = Date.now();
    stallStatusMap.forEach((status, stallId) => {
      if (status.isOnline && now - status.lastSeen > 12000) {
        status.isOnline = false;
        broadcastToAdmins({
          type: 'STALL_STATUS_CHANGE',
          stall_id: stallId,
          isOnline: false,
          lastSeen: status.lastSeen
        });
      }
    });

    if (wss) {
      wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }
  }, 5000);

  console.log('WebSocket server initialized on path /ws');
}

function updateStallHeartbeat(stallId, isOnline) {
  const previous = stallStatusMap.get(stallId);
  const now = Date.now();

  const isStatusChanged = !previous || previous.isOnline !== isOnline;
  stallStatusMap.set(stallId, { lastSeen: now, isOnline });

  if (isStatusChanged) {
    broadcastToAdmins({
      type: 'STALL_STATUS_CHANGE',
      stall_id: stallId,
      isOnline,
      lastSeen: now
    });
  }
}

function broadcastToAdmins(payload) {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.isAuthenticated && client.role === 'ADMIN') {
      client.send(msg);
    }
  });
}

function broadcastEvent(eventType, payload) {
  if (!wss) return;
  const msg = JSON.stringify({
    type: eventType,
    payload,
    timestamp: new Date().toISOString()
  });

  const eventStallId = payload.stall_id;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
      if (client.role === 'ADMIN') {
        client.send(msg);
      } else if (client.role === 'STALL_USER' && client.stallId === eventStallId) {
        client.send(msg);
      }
    }
  });
}

function getStallStatus(stallId = 1) {
  const status = stallStatusMap.get(stallId);
  if (!status) {
    return { isOnline: false, lastSeen: null };
  }
  const isOnline = status.isOnline && (Date.now() - status.lastSeen <= 12000);
  return { isOnline, lastSeen: status.lastSeen };
}

module.exports = {
  initWebSocket,
  broadcastEvent,
  broadcastToAdmins,
  getStallStatus
};
