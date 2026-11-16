-- Ciclo de vida del proyecto: descripción del espacio, tipo y responsable del proyecto,
-- Definition of Done y resumen guardado al cerrar cada Sprint.
-- Solo agrega columnas; no modifica ni borra datos existentes.

alter table public.workspaces
  add column if not exists description text check (description is null or char_length(description) <= 500);

alter table public.projects
  add column if not exists project_type text not null default 'software'
    check (project_type in ('software', 'web', 'mobile', 'data', 'research', 'academic', 'other')),
  add column if not exists lead_id uuid references public.profiles (id) on delete set null,
  -- Lista de criterios (texto) que debe cumplir todo trabajo para considerarse terminado
  add column if not exists definition_of_done jsonb not null default '[]'::jsonb
    check (jsonb_typeof(definition_of_done) = 'array');

-- Resultados, pendientes, acuerdos y métricas del Sprint al momento de cerrarlo (no cambia después)
alter table public.sprints
  add column if not exists summary jsonb;
