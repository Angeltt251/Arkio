import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { apiFetch } from '@/lib/api';
import { rememberStartPage, type Profile } from '@/lib/profile';

/**
 * Trae las preferencias guardadas en el perfil (tema, animaciones, página de inicio) al entrar,
 * y guarda el tema cuando se cambia desde la barra superior.
 */
export function useProfileSync() {
  const { token, isDemo } = useAuth();
  const { preference, setPreference, setReduceMotion } = useTheme();
  const synced = useRef<string | null>(null);

  useEffect(() => {
    if (!token || isDemo) return;
    let cancelled = false;
    apiFetch<Profile>('/api/me', token)
      .then((profile) => {
        if (cancelled) return;
        synced.current = profile.theme;
        setPreference(profile.theme);
        setReduceMotion(profile.preferences.reduceMotion);
        rememberStartPage(profile.preferences.startPage);
      })
      .catch(() => {
        /* sin perfil: se queda con lo guardado en el navegador */
      });
    return () => {
      cancelled = true;
    };
  }, [token, isDemo, setPreference, setReduceMotion]);

  useEffect(() => {
    if (!token || synced.current === null || synced.current === preference) return;
    synced.current = preference;
    apiFetch('/api/me', token, { method: 'PATCH', body: JSON.stringify({ theme: preference }) }).catch(() => {
      /* se reintenta en el próximo cambio */
    });
  }, [token, preference]);
}
