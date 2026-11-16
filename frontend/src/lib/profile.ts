import type { ThemePreference } from '@/context/ThemeContext';

export type NotificationKind = 'task_assigned' | 'task_update' | 'sprint' | 'membership' | 'retro_action';
export type EmailKind = 'task_assigned' | 'sprint' | 'retro_action';

export interface Preferences {
  notify: Record<NotificationKind, boolean>;
  email: Record<EmailKind, boolean>;
  reduceMotion: boolean;
  startPage: string;
}

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  theme: ThemePreference;
  preferences: Preferences;
  createdAt: string | null;
}

export interface AppNotification {
  id: number;
  kind: NotificationKind | 'general';
  title: string;
  body: string | null;
  link: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  actorName: string | null;
  actorAvatar: string | null;
  readAt: string | null;
  createdAt: string;
}

const START_KEY = 'arkio.startPage';

/** Página a la que se llega después de iniciar sesión (Configuración → Apariencia). */
export function startPage(): string {
  try {
    return localStorage.getItem(START_KEY) || '/';
  } catch {
    return '/';
  }
}

export function rememberStartPage(path: string): void {
  try {
    localStorage.setItem(START_KEY, path);
  } catch {
    /* almacenamiento no disponible */
  }
}
