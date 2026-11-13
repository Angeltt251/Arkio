-- =====================================================================
-- Arkio · Esquema inicial (MVP)
-- Plataforma Scrumban con bitácora histórica auditable.
--
-- Ejecutar en Supabase: SQL Editor → pegar y ejecutar,
-- o con la CLI: `supabase db push`.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. Tipos enumerados
-- ---------------------------------------------------------------------
create type public.workspace_role    as enum ('owner', 'admin', 'member');
create type public.project_role      as enum ('product_owner', 'scrum_master', 'developer', 'observer');
create type public.member_status     as enum ('active', 'invited', 'revoked');
create type public.project_status    as enum ('planning', 'active', 'paused', 'closed');
create type public.pbi_type          as enum ('story', 'bug', 'task', 'spike', 'improvement');
create type public.pbi_status        as enum ('new', 'refined', 'ready', 'in_sprint', 'done', 'discarded');
create type public.priority_level    as enum ('low', 'medium', 'high', 'critical');
create type public.severity_level    as enum ('minor', 'major', 'critical', 'blocker');
create type public.sprint_status     as enum ('planned', 'active', 'closed', 'cancelled');
create type public.scrum_event_type  as enum ('sprint_planning', 'daily_scrum', 'sprint_review', 'sprint_retrospective');
create type public.invitation_status as enum ('pending', 'accepted', 'declined', 'revoked', 'expired');
create type public.action_status     as enum ('pending', 'in_progress', 'done', 'dropped');

-- ---------------------------------------------------------------------
-- 2. Usuarios y espacios de trabajo
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  avatar_url  text,
  theme       text not null default 'system' check (theme in ('light', 'dark', 'system')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  owner_id    uuid not null references public.profiles (id),
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         public.workspace_role not null default 'member',
  status       public.member_status not null default 'active',
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ---------------------------------------------------------------------
-- 3. Proyectos, miembros e invitaciones
-- ---------------------------------------------------------------------
create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  key           text not null check (key ~ '^[A-Z][A-Z0-9]{1,5}$'),   -- prefijo de PBIs, ej: SAL → SAL-1
  name          text not null check (char_length(name) between 2 and 120),
  description   text,
  product_goal  text,
  status        public.project_status not null default 'planning',
  color         text not null default '#5B3FD6',
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  unique (workspace_id, key)
);

create table public.project_members (
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.project_role not null default 'developer',
  added_at    timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  project_id      uuid references public.projects (id) on delete cascade,
  email           text not null,
  workspace_role  public.workspace_role not null default 'member',
  project_role    public.project_role,
  token_hash      text not null unique,          -- se guarda solo el hash SHA-256 del token
  invited_by      uuid not null references public.profiles (id),
  status          public.invitation_status not null default 'pending',
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  responded_at    timestamptz
);

-- ---------------------------------------------------------------------
-- 4. Product Backlog y Sprints
-- ---------------------------------------------------------------------
create table public.backlog_items (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  seq                  integer not null,
  code                 text not null,                    -- ej: SAL-12 (lo asigna un trigger)
  type                 public.pbi_type not null default 'story',
  title                text not null,
  description          text,
  story_as_a           text,                             -- Como [rol]
  story_i_want         text,                             -- quiero [capacidad]
  story_so_that        text,                             -- para [beneficio]
  acceptance_criteria  text,
  priority             public.priority_level not null default 'medium',
  rank                 double precision not null default 0,   -- orden del backlog
  estimate             numeric(6, 2),
  status               public.pbi_status not null default 'new',
  parent_id            uuid references public.backlog_items (id),  -- para dividir PBIs
  created_by           uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  archived_at          timestamptz,
  unique (project_id, seq)
);

create table public.sprints (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  number        integer not null,
  goal          text not null,
  start_date    date not null,
  end_date      date not null,
  status        public.sprint_status not null default 'planned',
  close_reason  text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz,
  unique (project_id, number),
  check (end_date >= start_date),
  check (end_date - start_date <= 31)                -- Scrum: un mes o menos
);

create table public.sprint_items (
  sprint_id        uuid not null references public.sprints (id) on delete cascade,
  backlog_item_id  uuid not null references public.backlog_items (id) on delete cascade,
  added_at         timestamptz not null default now(),
  primary key (sprint_id, backlog_item_id)
);

-- ---------------------------------------------------------------------
-- 5. Tablero Kanban
-- ---------------------------------------------------------------------
create table public.boards (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null default 'Tablero principal',
  created_at  timestamptz not null default now()
);

create table public.board_columns (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null,
  position    integer not null,
  wip_limit   integer check (wip_limit is null or wip_limit > 0),
  is_done     boolean not null default false,       -- columna que marca la tarea como terminada
  unique (board_id, position) deferrable initially deferred
);

create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  column_id        uuid not null references public.board_columns (id),
  sprint_id        uuid references public.sprints (id),
  backlog_item_id  uuid references public.backlog_items (id),
  title            text not null,
  description      text,
  priority         public.priority_level not null default 'medium',
  severity         public.severity_level,             -- solo para defectos/incidentes
  position         double precision not null default 0,
  estimate         numeric(6, 2),
  start_date       date,
  due_date         date,
  is_blocked       boolean not null default false,
  blocked_reason   text,
  completed_at     timestamptz,                        -- lo maneja un trigger según la columna
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz
);

create table public.task_assignees (
  task_id   uuid not null references public.tasks (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (task_id, user_id)
);

create table public.task_dependencies (
  task_id             uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id  uuid not null references public.tasks (id) on delete cascade,
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create table public.labels (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null,
  color       text not null default '#64748B',
  unique (project_id, name)
);

create table public.task_labels (
  task_id   uuid not null references public.tasks (id) on delete cascade,
  label_id  uuid not null references public.labels (id) on delete cascade,
  primary key (task_id, label_id)
);

create table public.checklist_items (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  content     text not null,
  is_done     boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. Eventos Scrum y retrospectivas
-- ---------------------------------------------------------------------
create table public.scrum_events (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete cascade,
  sprint_id         uuid not null references public.sprints (id) on delete cascade,
  type              public.scrum_event_type not null,
  held_at           timestamptz not null,
  duration_minutes  integer check (duration_minutes > 0),
  notes             text,
  agreements        text,
  data              jsonb not null default '{}'::jsonb,  -- campos propios de cada evento (bien/mal/aprendimos…)
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.event_attendees (
  event_id  uuid not null references public.scrum_events (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  primary key (event_id, user_id)
);

create table public.retro_actions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  event_id     uuid not null references public.scrum_events (id) on delete cascade,
  description  text not null,
  owner_id     uuid references public.profiles (id),
  due_date     date,
  status       public.action_status not null default 'pending',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. Comentarios y adjuntos
-- ---------------------------------------------------------------------
create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  task_id     uuid references public.tasks (id) on delete cascade,
  event_id    uuid references public.scrum_events (id) on delete cascade,
  author_id   uuid not null references public.profiles (id),
  body        text not null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  check (num_nonnulls(task_id, event_id) = 1)
);

create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  task_id       uuid references public.tasks (id) on delete cascade,
  event_id      uuid references public.scrum_events (id) on delete cascade,
  storage_path  text not null,            -- ruta en Supabase Storage (bucket privado)
  file_name     text not null,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes <= 10485760),   -- 10 MB
  uploaded_by   uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  check (num_nonnulls(task_id, event_id) = 1)
);

-- ---------------------------------------------------------------------
-- 8. Bitácora (solo inserción) y notificaciones
-- ---------------------------------------------------------------------
create table public.activity_log (
  id            bigint generated always as identity primary key,
  -- Sin claves foráneas a propósito: la historia debe sobrevivir aunque se borre la entidad.
  workspace_id  uuid,
  project_id    uuid,
  actor_id      uuid,
  action        text not null,         -- created | updated | moved | status_changed | archived | restored | deleted | correction…
  entity_type   text not null,         -- nombre de la tabla afectada
  entity_id     uuid,
  changes       jsonb not null default '{}'::jsonb,   -- {campo: {old, new}} o la fila creada
  source        text not null default 'app',          -- app | api | sistema | supabase_dashboard
  created_at    timestamptz not null default now()
);

create table public.notifications (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  activity_id  bigint references public.activity_log (id) on delete cascade,
  title        text not null,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 9. Índices para consultas frecuentes
-- ---------------------------------------------------------------------
create index on public.workspace_members (user_id);
create index on public.projects (workspace_id) where archived_at is null;
create index on public.project_members (user_id);
create index on public.invitations (email) where status = 'pending';
create index on public.backlog_items (project_id, rank) where archived_at is null;
create index on public.sprints (project_id, status);
create index on public.board_columns (board_id, position);
create index on public.tasks (project_id, column_id, position) where archived_at is null;
create index on public.tasks (sprint_id);
create index on public.task_assignees (user_id);
create index on public.checklist_items (task_id, position);
create index on public.scrum_events (sprint_id, held_at);
create index on public.comments (task_id);
create index on public.activity_log (project_id, created_at desc);
create index on public.activity_log (actor_id, created_at desc);
create index on public.activity_log (workspace_id, created_at desc);
create index on public.notifications (user_id, created_at desc) where read_at is null;

-- =====================================================================
-- 10. Funciones auxiliares
-- =====================================================================

-- Usuario que ejecuta la acción. El backend (FastAPI) fija `app.user_id`
-- en cada transacción; desde el cliente se usa el JWT de Supabase.
create or replace function public.current_app_user()
returns uuid
language sql stable set search_path = public
as $$
  select coalesce(nullif(current_setting('app.user_id', true), '')::uuid, auth.uid())
$$;

create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid() and status = 'active'
  )
$$;

create or replace function public.is_workspace_admin(ws uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid()
      and status = 'active' and role in ('owner', 'admin')
  )
$$;

create or replace function public.is_project_member(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from project_members where project_id = p and user_id = auth.uid())
      or exists (select 1 from projects pr where pr.id = p and public.is_workspace_admin(pr.workspace_id))
$$;

-- Puede editar: cualquier miembro del proyecto que no sea observador, o un admin del espacio.
create or replace function public.can_edit_project(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
           select 1 from project_members
           where project_id = p and user_id = auth.uid() and role <> 'observer'
         )
      or exists (select 1 from projects pr where pr.id = p and public.is_workspace_admin(pr.workspace_id))
$$;

-- =====================================================================
-- 11. Triggers de negocio
-- =====================================================================

-- updated_at automático
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','workspaces','projects','backlog_items','sprints','tasks','scrum_events','retro_actions']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- Perfil automático al registrarse en Supabase Auth
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Al crear un espacio, el creador queda como propietario
create or replace function public.add_workspace_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into workspace_members (workspace_id, user_id, role, status)
  values (new.id, new.owner_id, 'owner', 'active')
  on conflict do nothing;
  return new;
end $$;

create trigger workspaces_add_owner
  after insert on public.workspaces
  for each row execute function public.add_workspace_owner();

-- Al crear un proyecto: tablero con columnas Scrumban por defecto
create or replace function public.create_default_board()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_board uuid;
begin
  insert into boards (project_id) values (new.id) returning id into v_board;
  insert into board_columns (board_id, project_id, name, position, is_done) values
    (v_board, new.id, 'Por hacer',   1, false),
    (v_board, new.id, 'En progreso', 2, false),
    (v_board, new.id, 'En revisión', 3, false),
    (v_board, new.id, 'Testing',     4, false),
    (v_board, new.id, 'Terminado',   5, true);
  return new;
end $$;

create trigger projects_default_board
  after insert on public.projects
  for each row execute function public.create_default_board();

-- Código correlativo de PBI (SAL-1, SAL-2…)
create or replace function public.assign_pbi_code()
returns trigger language plpgsql set search_path = public as $$
declare v_key text;
begin
  perform pg_advisory_xact_lock(hashtext('pbi:' || new.project_id::text));
  select coalesce(max(seq), 0) + 1 into new.seq from backlog_items where project_id = new.project_id;
  select key into v_key from projects where id = new.project_id;
  new.code := v_key || '-' || new.seq;
  if new.rank = 0 then new.rank := new.seq * 1000; end if;
  return new;
end $$;

create trigger backlog_items_code
  before insert on public.backlog_items
  for each row execute function public.assign_pbi_code();

-- Número correlativo de Sprint
create or replace function public.assign_sprint_number()
returns trigger language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('sprint:' || new.project_id::text));
  select coalesce(max(number), 0) + 1 into new.number from sprints where project_id = new.project_id;
  return new;
end $$;

create trigger sprints_number
  before insert on public.sprints
  for each row execute function public.assign_sprint_number();

-- Solo un Sprint activo por proyecto
create unique index one_active_sprint_per_project on public.sprints (project_id) where status = 'active';

-- completed_at según la columna "terminado"
create or replace function public.sync_task_completion()
returns trigger language plpgsql set search_path = public as $$
declare v_done boolean;
begin
  if tg_op = 'INSERT' or new.column_id is distinct from old.column_id then
    select is_done into v_done from board_columns where id = new.column_id;
    if v_done then
      new.completed_at := coalesce(new.completed_at, now());
    else
      new.completed_at := null;
    end if;
  end if;
  return new;
end $$;

create trigger tasks_completion
  before insert or update on public.tasks
  for each row execute function public.sync_task_completion();

-- =====================================================================
-- 12. BITÁCORA AUTOMÁTICA
-- Registra quién, cuándo, qué entidad, qué acción y valores antes/después.
-- Además avisa por NOTIFY para que el backend lo empuje por WebSocket.
-- =====================================================================
create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_new       jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old       jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row       jsonb := coalesce(v_new, v_old);
  v_changes   jsonb := '{}'::jsonb;
  v_action    text;
  v_key       text;
  v_project   uuid;
  v_workspace uuid;
  v_entity    uuid;
  v_id        bigint;
begin
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('updated_at', 'position', 'rank')
         and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;   -- solo cambió el orden visual: no ensuciar la bitácora
    end if;
    v_action := case
      when tg_table_name = 'tasks' and v_changes ? 'column_id' then 'moved'
      when v_changes ? 'archived_at' and v_new ->> 'archived_at' is null then 'restored'
      when v_changes ? 'archived_at' then 'archived'
      when v_changes ? 'status' then 'status_changed'
      else 'updated'
    end;
  elsif tg_op = 'INSERT' then
    v_action  := 'created';
    v_changes := v_new;
  else
    v_action  := 'deleted';
    v_changes := v_old;
  end if;
  v_changes := v_changes - 'token_hash';   -- nunca guardar el hash de invitaciones

  -- Resolver proyecto y espacio afectados
  v_project := case
    when tg_table_name = 'projects' then (v_row ->> 'id')::uuid
    else (v_row ->> 'project_id')::uuid
  end;
  if v_project is null and v_row ? 'task_id' then
    select project_id into v_project from tasks where id = (v_row ->> 'task_id')::uuid;
  end if;
  if v_project is null and v_row ? 'sprint_id' then
    select project_id into v_project from sprints where id = (v_row ->> 'sprint_id')::uuid;
  end if;

  v_workspace := case
    when tg_table_name = 'workspaces' then (v_row ->> 'id')::uuid
    else coalesce((v_row ->> 'workspace_id')::uuid,
                  (select workspace_id from projects where id = v_project))
  end;

  v_entity := coalesce(
    (v_row ->> 'id')::uuid,
    (v_row ->> 'task_id')::uuid,
    (v_row ->> 'sprint_id')::uuid,
    (v_row ->> 'project_id')::uuid
  );

  insert into activity_log (workspace_id, project_id, actor_id, action, entity_type, entity_id, changes, source)
  values (
    v_workspace, v_project, public.current_app_user(), v_action, tg_table_name, v_entity, v_changes,
    coalesce(nullif(current_setting('app.source', true), ''),
             case when public.current_app_user() is null then 'sistema' else 'app' end)
  )
  returning id into v_id;

  perform pg_notify('arkio_activity', json_build_object(
    'id', v_id, 'workspace_id', v_workspace, 'project_id', v_project,
    'action', v_action, 'entity_type', tg_table_name, 'entity_id', v_entity
  )::text);

  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'workspaces', 'workspace_members', 'projects', 'project_members', 'invitations',
    'backlog_items', 'sprints', 'sprint_items', 'board_columns', 'tasks', 'task_assignees',
    'task_labels', 'checklist_items', 'scrum_events', 'retro_actions', 'comments', 'attachments'
  ]
  loop
    execute format(
      'create trigger %I_activity after insert or update or delete on public.%I
         for each row execute function public.log_activity()', t, t);
  end loop;
end $$;

-- La bitácora es inmutable: nadie (ni un admin) puede editar o borrar historia.
-- Las correcciones se registran como un evento nuevo con action = 'correction'.
create or replace function public.prevent_activity_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'La bitácora es de solo lectura. Registra una corrección como un nuevo evento.';
end $$;

create trigger activity_log_no_update
  before update or delete on public.activity_log
  for each row execute function public.prevent_activity_mutation();

create trigger activity_log_no_truncate
  before truncate on public.activity_log
  for each statement execute function public.prevent_activity_mutation();

-- Sprints: no se borran, se cancelan o cierran con motivo
create or replace function public.prevent_sprint_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Los Sprints no se eliminan: ciérralos o cancélalos indicando el motivo.';
end $$;

create trigger sprints_no_delete
  before delete on public.sprints
  for each row execute function public.prevent_sprint_delete();

-- =====================================================================
-- 13. ROW LEVEL SECURITY
-- El backend se conecta con un rol de servidor y valida permisos en FastAPI;
-- RLS protege cualquier acceso directo desde el cliente con la anon key.
-- =====================================================================
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects          enable row level security;
alter table public.project_members   enable row level security;
alter table public.invitations       enable row level security;
alter table public.backlog_items     enable row level security;
alter table public.sprints           enable row level security;
alter table public.sprint_items      enable row level security;
alter table public.boards            enable row level security;
alter table public.board_columns     enable row level security;
alter table public.tasks             enable row level security;
alter table public.task_assignees    enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.labels            enable row level security;
alter table public.task_labels       enable row level security;
alter table public.checklist_items   enable row level security;
alter table public.scrum_events      enable row level security;
alter table public.event_attendees   enable row level security;
alter table public.retro_actions     enable row level security;
alter table public.comments          enable row level security;
alter table public.attachments       enable row level security;
alter table public.activity_log      enable row level security;
alter table public.notifications     enable row level security;

-- Perfiles: cada uno ve el suyo y el de quienes comparten espacio
create policy "perfil propio o compañero" on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from workspace_members a join workspace_members b using (workspace_id)
    where a.user_id = auth.uid() and b.user_id = profiles.id and a.status = 'active'
  )
);
create policy "editar perfil propio" on public.profiles for update using (id = auth.uid());

-- Espacios
create policy "ver espacios propios" on public.workspaces for select using (public.is_workspace_member(id));
create policy "crear espacio" on public.workspaces for insert with check (owner_id = auth.uid());
create policy "editar espacio (admin)" on public.workspaces for update using (public.is_workspace_admin(id));

create policy "ver miembros del espacio" on public.workspace_members for select using (public.is_workspace_member(workspace_id));
create policy "gestionar miembros (admin)" on public.workspace_members for all
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));

create policy "ver invitaciones (admin)" on public.invitations for select using (public.is_workspace_admin(workspace_id));

-- Proyectos
create policy "ver proyectos" on public.projects for select using (public.is_project_member(id));
create policy "crear proyecto" on public.projects for insert with check (public.is_workspace_member(workspace_id));
create policy "editar proyecto" on public.projects for update using (public.can_edit_project(id));

create policy "ver miembros del proyecto" on public.project_members for select using (public.is_project_member(project_id));
create policy "gestionar miembros del proyecto" on public.project_members for all
  using (exists (select 1 from projects p where p.id = project_id and public.is_workspace_admin(p.workspace_id)))
  with check (exists (select 1 from projects p where p.id = project_id and public.is_workspace_admin(p.workspace_id)));

-- Tablas que cuelgan directamente de un proyecto (lectura: miembros; escritura: no observadores)
do $$
declare t text;
begin
  foreach t in array array['backlog_items','sprints','boards','board_columns','tasks','labels','scrum_events','retro_actions','comments','attachments']
  loop
    execute format('create policy "leer %1$s" on public.%1$I for select using (public.is_project_member(project_id))', t);
    execute format('create policy "crear %1$s" on public.%1$I for insert with check (public.can_edit_project(project_id))', t);
    execute format('create policy "editar %1$s" on public.%1$I for update using (public.can_edit_project(project_id))', t);
  end loop;
end $$;

-- Tablas que cuelgan de una tarea
do $$
declare t text;
begin
  foreach t in array array['task_assignees','task_labels','checklist_items','task_dependencies']
  loop
    execute format('create policy "leer %1$s" on public.%1$I for select using (
      exists (select 1 from public.tasks tk where tk.id = task_id and public.is_project_member(tk.project_id)))', t);
    execute format('create policy "escribir %1$s" on public.%1$I for all using (
      exists (select 1 from public.tasks tk where tk.id = task_id and public.can_edit_project(tk.project_id)))
      with check (
      exists (select 1 from public.tasks tk where tk.id = task_id and public.can_edit_project(tk.project_id)))', t);
  end loop;
end $$;

create policy "leer sprint_items" on public.sprint_items for select using (
  exists (select 1 from sprints s where s.id = sprint_id and public.is_project_member(s.project_id)));
create policy "escribir sprint_items" on public.sprint_items for all
  using (exists (select 1 from sprints s where s.id = sprint_id and public.can_edit_project(s.project_id)))
  with check (exists (select 1 from sprints s where s.id = sprint_id and public.can_edit_project(s.project_id)));

create policy "leer asistentes" on public.event_attendees for select using (
  exists (select 1 from scrum_events e where e.id = event_id and public.is_project_member(e.project_id)));
create policy "escribir asistentes" on public.event_attendees for all
  using (exists (select 1 from scrum_events e where e.id = event_id and public.can_edit_project(e.project_id)))
  with check (exists (select 1 from scrum_events e where e.id = event_id and public.can_edit_project(e.project_id)));

-- Bitácora: solo lectura para miembros (incluye observador/profesor). Sin políticas de escritura.
create policy "leer bitácora" on public.activity_log for select using (
  (project_id is not null and public.is_project_member(project_id))
  or (project_id is null and workspace_id is not null and public.is_workspace_member(workspace_id))
);

create policy "mis notificaciones" on public.notifications for select using (user_id = auth.uid());
create policy "marcar leída" on public.notifications for update using (user_id = auth.uid());
