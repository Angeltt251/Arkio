import type { IconName } from '@/components/ui/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Para las páginas aún no construidas: qué iteración del plan las implementa. */
  iteration?: string;
  description?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Inicio', icon: 'home' },
  {
    to: '/tableros',
    label: 'Tableros',
    icon: 'boards',
    iteration: 'Iteración 4 · Tablero',
    description: 'Columnas configurables, tarjetas con responsables, etiquetas, checklist, límites WIP y bloqueos.',
  },
  {
    to: '/plantillas',
    label: 'Plantillas',
    icon: 'templates',
    iteration: 'Siguiente versión',
    description: 'Proyectos y tableros preconfigurados para comenzar rápido.',
  },
  {
    to: '/espacios',
    label: 'Espacios de trabajo',
    icon: 'workspaces',
    iteration: 'Iteración 1 · Acceso y espacios',
    description: 'Crear espacios y proyectos, con datos aislados entre espacios. La API ya está lista.',
  },
  {
    to: '/miembros',
    label: 'Miembros',
    icon: 'users',
    iteration: 'Iteración 1 · Acceso y espacios',
    description: 'Invitar por correo con enlace y vencimiento, asignar roles Scrum y revocar accesos. La API ya está lista.',
  },
  {
    to: '/bitacora',
    label: 'Bitácora',
    icon: 'logbook',
    iteration: 'Iteración 5 · Trazabilidad',
    description: 'Historial inmutable de quién hizo qué y cuándo, con filtros por integrante, fecha y entidad. La base de datos ya lo registra.',
  },
  {
    to: '/reportes',
    label: 'Reportes',
    icon: 'reports',
    iteration: 'Iteración 6 · Cierre e informes',
    description: 'Informe de Sprint, retrospectiva y bitácora exportables a PDF y CSV.',
  },
  {
    to: '/configuracion',
    label: 'Configuración',
    icon: 'settings',
    iteration: 'Iteración 1 · Acceso y espacios',
    description: 'Perfil, avatar, tema, permisos del espacio y notificaciones.',
  },
];
