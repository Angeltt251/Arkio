import type { IconName } from '@/components/ui/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Para las páginas aún no construidas: qué iteración del plan las implementa. */
  iteration?: string;
  description?: string;
}

/** Secciones generales: no dependen de un proyecto. */
export const GLOBAL_ITEMS: NavItem[] = [
  { to: '/', label: 'Inicio', icon: 'home' },
  { to: '/espacios', label: 'Espacios de trabajo', icon: 'workspaces' },
  { to: '/miembros', label: 'Miembros', icon: 'users' },
];

/** Secciones de un proyecto: el menú las abre con `?proyecto=` del proyecto elegido. */
export const PROJECT_ITEMS: NavItem[] = [
  { to: '/backlog', label: 'Product Backlog', icon: 'list' },
  { to: '/sprints', label: 'Sprints', icon: 'rocket' },
  { to: '/tableros', label: 'Tablero', icon: 'boards' },
  { to: '/eventos', label: 'Eventos Scrum', icon: 'calendar' },
  { to: '/bitacora', label: 'Bitácora', icon: 'logbook' },
  { to: '/reportes', label: 'Reportes', icon: 'reports' },
];

export const SETTINGS_ITEMS: NavItem[] = [
  {
    to: '/configuracion',
    label: 'Configuración',
    icon: 'settings',
    iteration: 'Iteración 1 · Acceso y espacios',
    description: 'Perfil, avatar, tema, permisos del espacio y notificaciones.',
  },
];

export const NAV_ITEMS: NavItem[] = [...GLOBAL_ITEMS, ...PROJECT_ITEMS, ...SETTINGS_ITEMS];
