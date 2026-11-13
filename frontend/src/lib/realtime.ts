import { API_URL } from './api';

export interface RealtimeMessage {
  type: 'ready' | 'activity';
  data?: {
    id: number;
    project_id: string | null;
    workspace_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
  };
}

/**
 * Abre el WebSocket del backend y se reconecta solo (espera creciente hasta 30 s).
 * Devuelve una función para cerrarlo.
 */
export function connectRealtime(token: string, onMessage: (msg: RealtimeMessage) => void): () => void {
  const wsUrl = `${API_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
  let socket: WebSocket | null = null;
  let retries = 0;
  let closedByUser = false;
  let pingTimer: number | undefined;
  let retryTimer: number | undefined;

  const open = () => {
    socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      retries = 0;
      pingTimer = window.setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send('ping'), 25_000);
    };
    socket.onmessage = (event) => {
      if (event.data === 'pong') return;
      try {
        onMessage(JSON.parse(event.data) as RealtimeMessage);
      } catch {
        /* mensaje no JSON */
      }
    };
    socket.onclose = () => {
      window.clearInterval(pingTimer);
      if (closedByUser) return;
      const delay = Math.min(30_000, 1_000 * 2 ** retries++);
      retryTimer = window.setTimeout(open, delay);
    };
  };

  open();
  return () => {
    closedByUser = true;
    window.clearInterval(pingTimer);
    window.clearTimeout(retryTimer);
    socket?.close();
  };
}
