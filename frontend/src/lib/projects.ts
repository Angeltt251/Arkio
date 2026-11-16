/** Colores sugeridos para los proyectos (paleta Arkio + acentos). */
export const PROJECT_COLORS = ['#447794', '#2D5B75', '#123249', '#27AE60', '#F2994A', '#EB5757'];

export type ProjectType = 'software' | 'web' | 'mobile' | 'data' | 'research' | 'academic' | 'other';

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  software: 'Software',
  web: 'Aplicación web',
  mobile: 'App móvil',
  data: 'Datos / BI',
  research: 'Investigación',
  academic: 'Proyecto académico',
  other: 'Otro',
};

/** Clave sugerida a partir del nombre: "Sistema de Ventas" → "SDV". */
export function suggestKey(name: string): string {
  const words = name.normalize('NFD').replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3);
  return key.toUpperCase().replace(/^[0-9]+/, '').slice(0, 6);
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  columns: { name: string; wipLimit: number | null; isDone: boolean }[];
  tasks: { title: string; column: string; priority: string }[];
}
