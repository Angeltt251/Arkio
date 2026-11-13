const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

/** "Hace 5 min", "Hace 2 h", "Ayer"… */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'Hace un momento';
  if (abs < 3600) return `Hace ${Math.round(abs / 60)} min`;
  if (abs < 86400) return `Hace ${Math.round(abs / 3600)} h`;
  const text = rtf.format(Math.round(seconds / 86400), 'day');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const monthFmt = new Intl.DateTimeFormat('es-CL', { month: 'short' });

/** "Del 10 al 24 Nov, 2026" */
export function sprintRange(startIso: string, endIso: string): string {
  const start = new Date(`${startIso}T12:00:00`);
  const end = new Date(`${endIso}T12:00:00`);
  const month = (d: Date) => {
    const m = monthFmt.format(d).replace('.', '');
    return m.charAt(0).toUpperCase() + m.slice(1);
  };
  const startText = start.getMonth() === end.getMonth() ? `${start.getDate()}` : `${start.getDate()} ${month(start)}`;
  return `Del ${startText} al ${end.getDate()} ${month(end)}, ${end.getFullYear()}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

const AVATAR_COLORS = ['#7C5CFC', '#22A06B', '#F08A24', '#2F80ED', '#E5487D', '#0EA5A4', '#9B51E0', '#D9822B'];

export function colorFor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export const ROLE_LABEL: Record<string, string> = {
  product_owner: 'Product Owner',
  scrum_master: 'Scrum Master',
  developer: 'Developer',
  observer: 'Observador',
};

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  planning: 'Planificación',
  active: 'Activo',
  paused: 'En pausa',
  closed: 'Cerrado',
};
