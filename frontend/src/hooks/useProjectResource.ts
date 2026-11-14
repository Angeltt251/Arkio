import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, errorMessage } from '@/lib/api';
import { connectRealtime } from '@/lib/realtime';

export interface ProjectOption {
  id: string;
  name: string;
  color: string;
}

/**
 * Proyecto elegido (parámetro `?proyecto=` de la URL) y datos de `path(projectId)`.
 * Recarga sola cuando otro integrante cambia algo en ese proyecto (WebSocket).
 */
export function useProjectResource<T>(path: (projectId: string) => string) {
  const { token } = useAuth();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadTimer = useRef<number | undefined>(undefined);

  const projectId = params.get('proyecto') ?? projects?.[0]?.id ?? null;
  const url = projectId ? path(projectId) : null;

  useEffect(() => {
    if (!token) return;
    apiFetch<ProjectOption[]>('/api/projects', token)
      .then(setProjects)
      .catch((err) => setError(errorMessage(err, 'No se pudieron cargar los proyectos.')));
  }, [token]);

  const reload = useCallback(async () => {
    if (!token || !url) return;
    try {
      setData(await apiFetch<T>(url, token));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo cargar la información.'));
    }
  }, [token, url]);

  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!token || !projectId) return;
    const close = connectRealtime(token, (msg) => {
      if (msg.type !== 'activity' || msg.data?.project_id !== projectId) return;
      window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => void reload(), 500);
    });
    return () => {
      window.clearTimeout(reloadTimer.current);
      close();
    };
  }, [token, projectId, reload]);

  const selectProject = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('proyecto', id);
    setParams(next);
  };

  return { token, projects, projectId, selectProject, data, setData, error, setError, reload };
}

/** Cierra un diálogo con la tecla Escape. */
export function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}
