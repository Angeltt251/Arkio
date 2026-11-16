/** Textos y tipos compartidos por Backlog, Sprints y Eventos Scrum. */

export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type PbiType = 'story' | 'bug' | 'task' | 'spike' | 'improvement';
export type PbiStatus = 'new' | 'refined' | 'ready' | 'in_sprint' | 'done' | 'discarded';
export type SprintStatus = 'planned' | 'active' | 'closed' | 'cancelled';
export type EventType = 'sprint_planning' | 'daily_scrum' | 'sprint_review' | 'sprint_retrospective';
export type ActionStatus = 'pending' | 'in_progress' | 'done' | 'dropped';

export interface Member {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface ProjectHeader {
  projectId: string;
  projectName: string;
  projectKey: string;
  productGoal: string | null;
  /** Criterios que todo trabajo debe cumplir para considerarse terminado. */
  definitionOfDone: string[];
  canEdit: boolean;
  canManage: boolean;
}

export interface Pbi {
  id: string;
  code: string;
  type: PbiType;
  title: string;
  description: string | null;
  storyAsA: string | null;
  storyIWant: string | null;
  storySoThat: string | null;
  acceptanceCriteria: string | null;
  priority: Priority;
  estimate: number | null;
  status: PbiStatus;
  parentId: string | null;
  parentCode: string | null;
  sprintNumber: number | null;
  taskCount: number;
  tasksDone: number;
  archived: boolean;
}

/** Un PBI que estuvo en un Sprint y volvió sin terminar: el Product Owner debe decidir qué hacer con él. */
export const isReturned = (pbi: Pbi) => pbi.sprintNumber != null && ['new', 'refined', 'ready'].includes(pbi.status);

export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' };

export const PBI_TYPE_LABEL: Record<PbiType, string> = {
  story: 'Historia',
  bug: 'Defecto',
  task: 'Tarea técnica',
  spike: 'Investigación',
  improvement: 'Mejora',
};

export const PBI_STATUS_LABEL: Record<PbiStatus, string> = {
  new: 'Nuevo',
  refined: 'Refinado',
  ready: 'Listo',
  in_sprint: 'En Sprint',
  done: 'Terminado',
  discarded: 'Descartado',
};

export const SPRINT_STATUS_LABEL: Record<SprintStatus, string> = {
  planned: 'Planificado',
  active: 'En curso',
  closed: 'Cerrado',
  cancelled: 'Cancelado',
};

export const EVENT_LABEL: Record<EventType, string> = {
  sprint_planning: 'Sprint Planning',
  daily_scrum: 'Daily Scrum',
  sprint_review: 'Sprint Review',
  sprint_retrospective: 'Sprint Retrospective',
};

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En progreso',
  done: 'Hecha',
  dropped: 'Descartada',
};

/** Puntos sugeridos (Fibonacci): ayudan a estimar sin prometer exactitud. */
export const ESTIMATE_OPTIONS = [1, 2, 3, 5, 8, 13, 21];

const dateFmt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' });

export const formatDate = (iso: string) => dateFmt.format(new Date(`${iso.slice(0, 10)}T12:00:00`));
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

/** yyyy-mm-dd en hora local. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function daysBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(`${endIso}T12:00:00`).getTime() - new Date(`${startIso}T12:00:00`).getTime()) / 86_400_000);
}

/** Valor para <input type="datetime-local"> en hora local. */
export function localDateTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
