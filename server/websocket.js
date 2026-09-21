const { WebSocketServer, WebSocket } = require('ws');

let wss = null;
const stallStatusMap = new Map(); // stallId -> { lastSeen: number, isOnline: boolean }

function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.role = 'GUEST';
    ws.stallId = null;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === 'REGISTER') {
          ws.role = data.role || 'GUEST';
          ws.stallId = data.stall_id || 1;

          if (ws.role === 'STALL' && ws.stallId) {
            updateStallHeartbeat(ws.stallId, true);
          }
        }

        if (data.type === 'HEARTBEAT') {
          ws.isAlive = true;
          const stallId = data.stall_id || ws.stallId || 1;
          ws.stallId = stallId;
          updateStallHeartbeat(stallId, true);
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    });

    ws.on('close', () => {
      if (ws.role === 'STALL' && ws.stallId) {
        // Check if any other connection exists for this stall
        const hasOtherConns = Array.from(wss.clients).some(
          client => client !== ws && client.readyState === WebSocket.OPEN && client.role === 'STALL' && client.stallId === ws.stallId
        );
        if (!hasOtherConns) {
          updateStallHeartbeat(ws.stallId, false);
        }
      }
    });
  });

  // Check stall heartbeat freshness every 5 seconds
  setInterval(() => {
    const now = Date.now();
    stallStatusMap.forEach((status, stallId) => {
      // 12 second timeout for heartbeat
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

    // WebSocket ping/pong keepalive
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
    if (client.readyState === WebSocket.OPEN && client.role === 'ADMIN') {
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

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
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
