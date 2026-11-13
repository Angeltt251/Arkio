import type { DashboardData } from '@/types';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Datos de ejemplo para el modo demo (sin Supabase) o si la API no responde. */
export const mockDashboard: DashboardData = {
  stats: {
    activeProjects: { value: 3, delta: 1, deltaKind: 'absolute', trend: [1, 1, 2, 2, 2, 3, 3] },
    sprintsInProgress: { value: 1, delta: 0, deltaKind: 'absolute', trend: [0, 1, 1, 0, 1, 1, 1] },
    completedTasks: { value: 24, delta: 12, deltaKind: 'percent', trend: [9, 11, 10, 14, 17, 16, 24] },
    teamMembers: { value: 5, delta: 0, deltaKind: 'absolute', trend: [3, 4, 4, 5, 4, 5, 5] },
  },
  projects: [
    {
      id: 'p1',
      name: 'Sistema Salud',
      color: '#447794',
      status: 'active',
      sprintNumber: 1,
      sprintDays: 10,
      progress: 70,
      members: [
        { id: 'u1', name: 'María López' },
        { id: 'u2', name: 'Carlos Pérez' },
        { id: 'u3', name: 'Ana Torres' },
      ],
      extraMembers: 1,
    },
    {
      id: 'p2',
      name: 'E-commerce',
      color: '#2F80ED',
      status: 'active',
      sprintNumber: 2,
      sprintDays: 15,
      progress: 45,
      members: [
        { id: 'u4', name: 'Valentina Rojas' },
        { id: 'u5', name: 'Diego Muñoz' },
        { id: 'u2', name: 'Carlos Pérez' },
      ],
      extraMembers: 1,
    },
    {
      id: 'p3',
      name: 'Marketing Digital',
      color: '#1E9E5A',
      status: 'planning',
      sprintNumber: null,
      sprintDays: null,
      progress: 0,
      members: [
        { id: 'u6', name: 'Fernanda Soto' },
        { id: 'u7', name: 'Tomás Vega' },
        { id: 'u1', name: 'María López' },
      ],
      extraMembers: 0,
    },
  ],
  currentSprint: {
    id: 's1',
    projectId: 'p1',
    projectName: 'Sistema Salud',
    number: 1,
    startDate: '2026-11-10',
    endDate: '2026-11-24',
    workingDays: 10,
    goal: 'Permitir a los pacientes crear una cuenta e iniciar sesión para acceder al sistema.',
    progress: 70,
    status: 'active',
  },
  activity: [
    {
      id: 4,
      actorName: 'María López',
      message: 'movió la tarjeta “Validar formularios” a',
      highlight: 'En revisión',
      kind: 'move',
      createdAt: minutesAgo(5),
    },
    {
      id: 3,
      actorName: 'Carlos Pérez',
      message: 'comentó: “Listo para pruebas”',
      kind: 'comment',
      createdAt: minutesAgo(12),
    },
    { id: 2, actorName: 'José Flores', message: 'creó el Sprint #1', kind: 'create', createdAt: minutesAgo(60) },
    {
      id: 1,
      actorName: 'Ana Torres',
      message: 'añadió la etiqueta',
      highlight: 'Backend',
      kind: 'label',
      createdAt: minutesAgo(120),
    },
  ],
  burndown: {
    sprintId: 's1',
    sprintLabel: 'Sprint #1',
    points: [20, 18, 17, 15, 15, 12, 10, 7, 5, 1].map((real, i) => ({
      label: `Día ${i + 1}`,
      ideal: Math.round((20 - (20 * i) / 9) * 100) / 100,
      real,
    })),
  },
  unreadNotifications: 2,
};
