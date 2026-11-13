import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { mockDashboard } from '@/data/mockDashboard';
import { apiFetch } from '@/lib/api';
import { connectRealtime } from '@/lib/realtime';
import type { DashboardData } from '@/types';

type Source = 'api' | 'demo' | 'fallback';

/**
 * Carga el dashboard desde FastAPI y lo refresca en vivo vía WebSocket.
 * En modo demo, o si la API no responde, muestra datos de ejemplo.
 */
export function useDashboard() {
  const { token, isDemo } = useAuth();
  const [data, setData] = useState<DashboardData | null>(isDemo ? mockDashboard : null);
  const [source, setSource] = useState<Source>(isDemo ? 'demo' : 'api');
  const [loading, setLoading] = useState(!isDemo);
  const refreshTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    if (isDemo || !token) return;
    try {
      setData(await apiFetch<DashboardData>('/api/dashboard', token));
      setSource('api');
    } catch (error) {
      console.warn('[Arkio] No se pudo cargar el dashboard desde la API, usando datos de ejemplo.', error);
      setData(mockDashboard);
      setSource('fallback');
    } finally {
      setLoading(false);
    }
  }, [isDemo, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tiempo real: ante cualquier cambio en mis proyectos, recargar (agrupando ráfagas)
  useEffect(() => {
    if (isDemo || !token) return;
    const close = connectRealtime(token, (msg) => {
      if (msg.type !== 'activity') return;
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => void load(), 400);
    });
    return () => {
      window.clearTimeout(refreshTimer.current);
      close();
    };
  }, [isDemo, token, load]);

  return { data, loading, source, reload: load };
}
