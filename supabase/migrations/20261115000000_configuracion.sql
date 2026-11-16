-- Módulo de Configuración: preferencias del usuario y notificaciones con enlace.
-- Solo agrega columnas; no modifica ni borra datos existentes.

alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;

alter table public.notifications
  add column if not exists kind       text not null default 'general',
  add column if not exists body       text,
  add column if not exists link       text,
  add column if not exists project_id uuid references public.projects (id) on delete cascade,
  add column if not exists actor_id   uuid references public.profiles (id) on delete set null;

create index if not exists notifications_user_recent on public.notifications (user_id, created_at desc);
