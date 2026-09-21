import { useEffect, useRef, useState, useCallback } from 'react';
import { getToken, getUser } from './api';

export function useWebSocket(onEvent) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const heartbeatTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const token = getToken();
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname === 'localhost' && window.location.port === '3000'
      ? 'localhost:5000'
      : window.location.host;

    const wsUrl = `${protocol}//${host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);

      // Authenticate socket with JWT token
      ws.send(JSON.stringify({
        type: 'REGISTER',
        token
      }));

      // Start periodic heartbeats
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'HEARTBEAT'
          }));
        }
      }, 4000);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onEvent) {
          onEvent(data);
        }
      } catch (e) {
        console.error('Error parsing WS message:', e);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);

      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };

    ws.onerror = (err) => {
      console.warn('WebSocket error, will reconnect...', err);
      ws.close();
    };
  }, [onEvent]);

  useEffect(() => {
    connect();

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { isConnected };
}
