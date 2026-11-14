import type { ProjectOption } from '@/hooks/useProjectResource';

/** Selector de proyecto de las páginas por proyecto (solo aparece si hay más de uno). */
export function ProjectSelect({ projects, value, onChange }: {
  projects: ProjectOption[] | null;
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (!projects || projects.length < 2) return null;
  return (
    <select className="select" aria-label="Proyecto" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}
