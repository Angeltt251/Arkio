import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

interface ThemeContextValue {
  /** Tema que se ve ahora. */
  theme: Theme;
  /** Lo que eligió la persona: claro, oscuro o seguir al sistema. */
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  toggleTheme: () => void;
  reduceMotion: boolean;
  setReduceMotion: (on: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'arkio.theme';
const MOTION_KEY = 'arkio.reduceMotion';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // almacenamiento no disponible
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* almacenamiento no disponible */
  }
}

function initialPreference(): ThemePreference {
  const saved = read(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const [reduceMotion, setReduceMotion] = useState(() => read(MOTION_KEY) === '1');
  const theme = preference === 'system' ? system : preference;

  // Si sigue al sistema, cambia en vivo cuando el sistema cambia
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const onChange = () => setSystem(media.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    write(STORAGE_KEY, preference);
  }, [theme, preference]);

  useEffect(() => {
    if (reduceMotion) document.documentElement.dataset.reduceMotion = 'true';
    else delete document.documentElement.dataset.reduceMotion;
    write(MOTION_KEY, reduceMotion ? '1' : '0');
  }, [reduceMotion]);

  const toggleTheme = useCallback(() => setPreference(theme === 'light' ? 'dark' : 'light'), [theme]);

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference, toggleTheme, reduceMotion, setReduceMotion }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  return ctx;
}
