import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { useTheme, type ThemePreference } from '@/context/ThemeContext';
import { apiFetch, errorMessage } from '@/lib/api';
import { PROJECT_STATUS_LABEL, ROLE_LABEL } from '@/lib/format';
import { rememberStartPage, type EmailKind, type NotificationKind, type Preferences, type Profile } from '@/lib/profile';
import { PROJECT_COLORS, type ProjectTemplate } from '@/lib/projects';
import { supabase } from '@/lib/supabase';
import type { ProjectRole, ProjectStatus } from '@/types';

type Section = 'perfil' | 'seguridad' | 'apariencia' | 'notificaciones' | 'espacio' | 'proyecto' | 'permisos';
type WorkspaceRole = 'owner' | 'admin' | 'member';

interface WorkspaceSettings {
  membersCanCreateProjects: boolean;
  defaultTemplate: string;
  defaultSprintWeeks: number;
}

interface Workspace {
  id: string;
  name: string;
  role: WorkspaceRole;
  ownerId: string | null;
  settings: WorkspaceSettings;
}

interface Project {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string | null;
  productGoal: string | null;
  status: ProjectStatus;
  color: string;
  archivedAt: string | null;
  canManage: boolean;
  myRole: ProjectRole | null;
}

interface LabelUsage {
  id: string;
  name: string;
  color: string;
  taskCount: number;
}

const SECTIONS: { id: Section; label: string; icon: IconName; hint: string }[] = [
  { id: 'perfil', label: 'Perfil', icon: 'user', hint: 'Nombre, foto y datos de tu cuenta' },
  { id: 'seguridad', label: 'Seguridad', icon: 'lock', hint: 'Contraseña y sesiones abiertas' },
  { id: 'apariencia', label: 'Apariencia', icon: 'sun', hint: 'Tema, animaciones y página de inicio' },
  { id: 'notificaciones', label: 'Notificaciones', icon: 'bell', hint: 'Qué avisos recibes y por dónde' },
  { id: 'espacio', label: 'Espacio de trabajo', icon: 'workspaces', hint: 'Nombre y reglas del espacio' },
  { id: 'proyecto', label: 'Proyecto', icon: 'folder', hint: 'Datos, Product Goal y etiquetas' },
  { id: 'permisos', label: 'Permisos', icon: 'users', hint: 'Qué puede hacer cada rol' },
];

const WS_ROLE_LABEL: Record<WorkspaceRole, string> = { owner: 'Propietario', admin: 'Administrador', member: 'Miembro' };
const STATUSES: ProjectStatus[] = ['planning', 'active', 'paused', 'closed'];
const STATUS_TEXT: Record<ProjectStatus, string> = { ...(PROJECT_STATUS_LABEL as Record<ProjectStatus, string>), closed: 'Completado' };
const LABEL_COLORS = ['#64748B', '#447794', '#27AE60', '#F2994A', '#EB5757', '#9B51E0', '#E2B93B', '#2D9CDB'];

const START_PAGES = [
  { value: '/', label: 'Inicio (dashboard)' },
  { value: '/espacios', label: 'Espacios de trabajo' },
  { value: '/tableros', label: 'Tablero del Sprint en curso' },
  { value: '/backlog', label: 'Product Backlog' },
  { value: '/sprints', label: 'Sprints' },
  { value: '/reportes', label: 'Reportes' },
];

const NOTIFY_ROWS: { kind: NotificationKind; title: string; detail: string; email?: EmailKind }[] = [
  { kind: 'task_assigned', title: 'Te asignan una tarea', detail: 'Cuando alguien te agrega como responsable de una tarjeta.', email: 'task_assigned' },
  { kind: 'task_update', title: 'Cambios en tus tareas', detail: 'Cuando otra persona termina o bloquea una tarea donde eres responsable.' },
  { kind: 'sprint', title: 'Sprints de tus proyectos', detail: 'Cuando un Sprint comienza, se cierra o se cancela.', email: 'sprint' },
  { kind: 'retro_action', title: 'Acciones de mejora', detail: 'Cuando te asignan una acción en una Retrospectiva.', email: 'retro_action' },
  { kind: 'membership', title: 'Equipo y roles', detail: 'Cuando te agregan a un proyecto, cambian tu rol o aceptan tu invitación.' },
];

function isSection(value: string | null): value is Section {
  return SECTIONS.some((s) => s.id === value);
}

export function SettingsPage() {
  const { token, isDemo } = useAuth();
  const [params, setParams] = useSearchParams();
  const section: Section = isSection(params.get('seccion')) ? (params.get('seccion') as Section) : 'perfil';
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = (id: Section) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('seccion', id);
      return next;
    });
  };

  const reload = useCallback(async () => {
    if (!token || isDemo) return;
    try {
      const [me, ws, pr] = await Promise.all([
        apiFetch<Profile>('/api/me', token),
        apiFetch<Workspace[]>('/api/workspaces', token),
        apiFetch<Project[]>('/api/projects', token),
      ]);
      setProfile(me);
      setWorkspaces(ws);
      setProjects(pr.filter((p) => !p.archivedAt));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo cargar tu configuración.'));
    }
  }, [token, isDemo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="settings">
      <div className="page-head">
        <div>
          <h1>Configuración</h1>
          <p className="muted">Tu cuenta, tus preferencias y las reglas de tus espacios y proyectos.</p>
        </div>
      </div>

      {isDemo && (
        <p className="form__error" role="status">Estás en modo demo: la configuración se guarda solo cuando la app está conectada a Supabase.</p>
      )}
      {error && <p className="form__error" role="alert">{error}</p>}

      <div className="settings__layout">
        <nav className="settings__nav" aria-label="Secciones de configuración">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={`settings__tab${s.id === section ? ' settings__tab--on' : ''}`}
              aria-current={s.id === section ? 'page' : undefined} onClick={() => go(s.id)}>
              <Icon name={s.icon} size={18} />
              <span>
                <strong>{s.label}</strong>
                <small>{s.hint}</small>
              </span>
            </button>
          ))}
        </nav>

        <section className="settings__panel" aria-labelledby="settings-title">
          <h2 id="settings-title" className="sr-only">{current.label}</h2>
          {!profile && !isDemo && !error ? (
            <div className="card settings__loading">Cargando…</div>
          ) : (
            <>
              {section === 'perfil' && <ProfileSection profile={profile} onSaved={setProfile} />}
              {section === 'seguridad' && <SecuritySection />}
              {section === 'apariencia' && <AppearanceSection profile={profile} onSaved={setProfile} />}
              {section === 'notificaciones' && <NotificationsSection profile={profile} onSaved={setProfile} />}
              {section === 'espacio' && (
                <WorkspaceSection workspaces={workspaces ?? []} onSaved={(ws) =>
                  setWorkspaces((list) => (list ?? []).map((w) => (w.id === ws.id ? ws : w)))} />
              )}
              {section === 'proyecto' && (
                <ProjectSection projects={projects ?? []} onSaved={(p) =>
                  setProjects((list) => (list ?? []).map((x) => (x.id === p.id ? p : x)))} />
              )}
              {section === 'permisos' && <PermissionsSection workspaces={workspaces ?? []} projects={projects ?? []} />}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ piezas comunes
function Panel({ title, icon, description, children, footer }: {
  title: string;
  icon: IconName;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="card settings__card">
      <header className="settings__card-head">
        <h3><Icon name={icon} size={19} className="card__icon" /> {title}</h3>
        {description && <p className="muted small">{description}</p>}
      </header>
      {children}
      {footer && <footer className="settings__card-foot">{footer}</footer>}
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={`switch${checked ? ' switch--on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch__knob" />
    </button>
  );
}

function SaveBar({ dirty, busy, saved, error, onReset }: {
  dirty: boolean;
  busy: boolean;
  saved: boolean;
  error: string | null;
  onReset?: () => void;
}) {
  return (
    <>
      {error && <p className="form__error" role="alert">{error}</p>}
      <div className="settings__save">
        <span className="muted small" role="status">
          {saved && !dirty ? <><Icon name="check" size={15} /> Cambios guardados</> : dirty ? 'Tienes cambios sin guardar' : ''}
        </span>
        {onReset && dirty && <button type="button" className="btn btn--ghost btn--sm" onClick={onReset}>Descartar</button>}
        <button className="btn btn--primary btn--sm" disabled={!dirty || busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </>
  );
}

function useSaver() {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };
  return { busy, saved, error, run, setSaved };
}

async function savePreferences(token: string | null, preferences: Preferences): Promise<Profile> {
  const profile = await apiFetch<Profile>('/api/me', token, { method: 'PATCH', body: JSON.stringify({ preferences }) });
  rememberStartPage(profile.preferences.startPage);
  return profile;
}

// ------------------------------------------------------------------ perfil
function ProfileSection({ profile, onSaved }: { profile: Profile | null; onSaved: (p: Profile) => void }) {
  const { token, user } = useAuth();
  const [name, setName] = useState(profile?.fullName ?? user?.fullName ?? '');
  const [avatar, setAvatar] = useState(profile?.avatarUrl ?? '');
  const { busy, saved, error, run } = useSaver();
  const avatarValid = avatar.trim() === '' || /^https:\/\/\S+$/.test(avatar.trim());
  const dirty = !!profile && (name.trim() !== profile.fullName || (avatar.trim() || null) !== profile.avatarUrl);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const updated = await apiFetch<Profile>('/api/me', token, {
        method: 'PATCH',
        body: JSON.stringify({ fullName: name.trim(), avatarUrl: avatar.trim() }),
      });
      onSaved(updated);
      // El nombre y la foto de la barra superior vienen de la sesión de Supabase
      await supabase?.auth.updateUser({ data: { full_name: updated.fullName, avatar_url: updated.avatarUrl } });
    }, 'No se pudo guardar tu perfil.');
  };

  return (
    <form onSubmit={submit}>
      <Panel title="Perfil" icon="user" description="Así te ven los demás en tableros, eventos y en la bitácora.">
        <div className="settings__profile">
          <Avatar name={name || 'Tú'} src={avatarValid && avatar.trim() ? avatar.trim() : null} size={84} />
          <div className="form" style={{ marginTop: 0, flex: 1 }}>
            <label className="field">
              <span>Nombre completo</span>
              <div className="input">
                <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </div>
            </label>
            <label className="field">
              <span>Foto de perfil (enlace https)</span>
              <div className="input">
                <input type="url" inputMode="url" placeholder="https://…/mi-foto.jpg" maxLength={500} value={avatar}
                  onChange={(e) => setAvatar(e.target.value)} aria-invalid={!avatarValid} />
              </div>
              <small className="muted">{avatarValid ? 'Déjalo vacío para usar tus iniciales.' : 'Debe ser un enlace que empiece con https://'}</small>
            </label>
          </div>
        </div>
        <dl className="settings__facts">
          <div><dt>Correo</dt><dd>{profile?.email ?? user?.email}</dd></div>
          {profile?.createdAt && (
            <div><dt>En Arkio desde</dt><dd>{new Date(profile.createdAt).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>
          )}
        </dl>
        <SaveBar dirty={dirty && avatarValid && name.trim().length >= 2} busy={busy} saved={saved} error={error}
          onReset={() => { setName(profile?.fullName ?? ''); setAvatar(profile?.avatarUrl ?? ''); }} />
      </Panel>
      <p className="muted small settings__note">
        Tu actividad queda en la <Link to="/bitacora">Bitácora</Link> de cada proyecto; ahí puedes filtrar por persona.
      </p>
    </form>
  );
}

// ------------------------------------------------------------------ seguridad
function SecuritySection() {
  const { user, signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { busy, saved, error, run } = useSaver();
  const [sessionMsg, setSessionMsg] = useState<string | null>(null);
  const [lastSignIn, setLastSignIn] = useState<string | null>(null);

  useEffect(() => {
    supabase?.auth.getUser().then(({ data }) => setLastSignIn(data.user?.last_sign_in_at ?? null));
  }, []);

  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = current.length > 0 && password.length >= 8 && password === confirm && password !== current;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !user) return;
    void run(async () => {
      // Confirmar la contraseña actual antes de cambiarla
      const check = await supabase!.auth.signInWithPassword({ email: user.email, password: current });
      if (check.error) throw new Error('La contraseña actual no es correcta.');
      const { error: err } = await supabase!.auth.updateUser({ password });
      if (err) throw new Error(err.message.includes('different') ? 'La nueva contraseña debe ser distinta de la actual.' : err.message);
      setCurrent('');
      setPassword('');
      setConfirm('');
    }, 'No se pudo cambiar la contraseña.');
  };

  const signOutOthers = async () => {
    if (!supabase) return;
    setSessionMsg(null);
    const { error: err } = await supabase.auth.signOut({ scope: 'others' });
    setSessionMsg(err ? `No se pudo: ${err.message}` : 'Listo: se cerraron tus sesiones en otros dispositivos y navegadores.');
  };

  if (!supabase) {
    return <Panel title="Seguridad" icon="lock" description="Disponible cuando la app está conectada a Supabase."><span /></Panel>;
  }

  return (
    <>
      <form onSubmit={submit}>
        <Panel title="Cambiar contraseña" icon="lock" description="Usa al menos 8 caracteres. Te pediremos la actual para confirmar que eres tú.">
          <div className="form" style={{ marginTop: 0 }}>
            <label className="field">
              <span>Contraseña actual</span>
              <div className="input"><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
            </label>
            <div className="dialog__row">
              <label className="field">
                <span>Nueva contraseña</span>
                <div className="input"><input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              </label>
              <label className="field">
                <span>Repite la nueva contraseña</span>
                <div className="input"><input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} /></div>
              </label>
            </div>
            {mismatch && <small className="muted">Las contraseñas no coinciden.</small>}
            {password.length > 0 && password.length < 8 && <small className="muted">Faltan {8 - password.length} caracteres.</small>}
          </div>
          {error && <p className="form__error" role="alert">{error}</p>}
          <div className="settings__save">
            <span className="muted small" role="status">{saved ? <><Icon name="check" size={15} /> Contraseña actualizada</> : ''}</span>
            <button className="btn btn--primary btn--sm" disabled={!valid || busy}>{busy ? 'Cambiando…' : 'Cambiar contraseña'}</button>
          </div>
        </Panel>
      </form>

      <Panel title="Sesiones" icon="logout" description="Si iniciaste sesión en un computador ajeno, ciérrala desde aquí.">
        <dl className="settings__facts">
          <div><dt>Cuenta</dt><dd>{user?.email}</dd></div>
          {lastSignIn && <div><dt>Último inicio de sesión</dt><dd>{new Date(lastSignIn).toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' })}</dd></div>}
        </dl>
        <div className="settings__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void signOutOthers()}>
            <Icon name="logout" size={16} /> Cerrar sesión en otros dispositivos
          </button>
          <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => void signOut()}>
            Cerrar sesión aquí
          </button>
        </div>
        {sessionMsg && <p className="muted small" role="status">{sessionMsg}</p>}
      </Panel>
    </>
  );
}

// ------------------------------------------------------------------ apariencia
function AppearanceSection({ profile, onSaved }: { profile: Profile | null; onSaved: (p: Profile) => void }) {
  const { token } = useAuth();
  const { preference, setPreference, reduceMotion, setReduceMotion } = useTheme();
  const [startPage, setStartPage] = useState(profile?.preferences.startPage ?? '/');
  const { error, run } = useSaver();

  const persist = (patch: Partial<Preferences>) => {
    if (!profile) return;
    void run(async () => onSaved(await savePreferences(token, { ...profile.preferences, ...patch })), 'No se pudo guardar la preferencia.');
  };

  const themes: { value: ThemePreference; label: string; icon: IconName }[] = [
    { value: 'light', label: 'Claro', icon: 'sun' },
    { value: 'dark', label: 'Oscuro', icon: 'moon' },
    { value: 'system', label: 'Según el sistema', icon: 'layers' },
  ];

  return (
    <>
      <Panel title="Tema" icon="sun" description="Se guarda en tu perfil: lo verás igual en cualquier computador.">
        <div className="theme-picker" role="radiogroup" aria-label="Tema">
          {themes.map((t) => (
            <button key={t.value} type="button" role="radio" aria-checked={preference === t.value}
              className={`theme-picker__option${preference === t.value ? ' theme-picker__option--on' : ''}`}
              onClick={() => setPreference(t.value)}>
              <span className={`theme-picker__preview theme-picker__preview--${t.value}`} aria-hidden="true">
                <span /><span /><span />
              </span>
              <span><Icon name={t.icon} size={16} /> {t.label}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Accesibilidad y navegación" icon="settings">
        <div className="settings__rows">
          <div className="settings__row">
            <div>
              <strong>Reducir animaciones</strong>
              <p className="muted small">Quita transiciones y movimientos de la interfaz.</p>
            </div>
            <Toggle label="Reducir animaciones" checked={reduceMotion}
              onChange={(v) => { setReduceMotion(v); persist({ reduceMotion: v }); }} />
          </div>
          <div className="settings__row">
            <div>
              <strong>Página al iniciar sesión</strong>
              <p className="muted small">Dónde llegas cada vez que entras a Arkio.</p>
            </div>
            <select className="select" value={startPage} aria-label="Página al iniciar sesión"
              onChange={(e) => { setStartPage(e.target.value); persist({ startPage: e.target.value }); }}>
              {START_PAGES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>
        {error && <p className="form__error" role="alert">{error}</p>}
      </Panel>
    </>
  );
}

// ------------------------------------------------------------------ notificaciones
function NotificationsSection({ profile, onSaved }: { profile: Profile | null; onSaved: (p: Profile) => void }) {
  const { token } = useAuth();
  const [prefs, setPrefs] = useState<Preferences | null>(profile?.preferences ?? null);
  const { busy, saved, error, run, setSaved } = useSaver();
  if (!profile || !prefs) return null;

  const dirty = JSON.stringify(prefs) !== JSON.stringify(profile.preferences);
  const setNotify = (kind: NotificationKind, on: boolean) => {
    setSaved(false);
    setPrefs({ ...prefs, notify: { ...prefs.notify, [kind]: on }, email: on || !(kind in prefs.email) ? prefs.email : { ...prefs.email, [kind]: false } });
  };
  const setEmail = (kind: EmailKind, on: boolean) => {
    setSaved(false);
    setPrefs({ ...prefs, email: { ...prefs.email, [kind]: on } });
  };
  const allOn = NOTIFY_ROWS.every((r) => prefs.notify[r.kind]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => onSaved(await savePreferences(token, prefs)), 'No se pudieron guardar tus notificaciones.');
  };

  return (
    <form onSubmit={submit}>
      <Panel title="Notificaciones" icon="bell"
        description={<>Los avisos llegan a la campana de arriba. Nunca te avisamos de lo que hiciste tú. El correo se envía a <strong>{profile.email}</strong>.</>}>
        <div className="notify-table" role="table" aria-label="Preferencias de notificación">
          <div className="notify-table__head" role="row">
            <span role="columnheader">Aviso</span>
            <span role="columnheader">En la app</span>
            <span role="columnheader">Por correo</span>
          </div>
          {NOTIFY_ROWS.map((row) => (
            <div key={row.kind} className="notify-table__row" role="row">
              <div role="cell">
                <strong>{row.title}</strong>
                <p className="muted small">{row.detail}</p>
              </div>
              <div role="cell"><Toggle label={`${row.title}: en la app`} checked={prefs.notify[row.kind]} onChange={(v) => setNotify(row.kind, v)} /></div>
              <div role="cell">
                {row.email
                  ? <Toggle label={`${row.title}: por correo`} checked={prefs.email[row.email]} disabled={!prefs.notify[row.kind]}
                      onChange={(v) => setEmail(row.email!, v)} />
                  : <span className="muted small">—</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="settings__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => {
            setSaved(false);
            setPrefs({ ...prefs, notify: Object.fromEntries(NOTIFY_ROWS.map((r) => [r.kind, !allOn])) as Preferences['notify'],
              email: allOn ? { task_assigned: false, sprint: false, retro_action: false } : prefs.email });
          }}>
            {allOn ? 'Silenciar todo' : 'Activar todo en la app'}
          </button>
        </div>
        <SaveBar dirty={dirty} busy={busy} saved={saved} error={error} onReset={() => setPrefs(profile.preferences)} />
      </Panel>
    </form>
  );
}

// ------------------------------------------------------------------ espacio de trabajo
function WorkspaceSection({ workspaces, onSaved }: { workspaces: Workspace[]; onSaved: (ws: Workspace) => void }) {
  const { token } = useAuth();
  const [selectedId, setSelectedId] = useState(workspaces[0]?.id ?? '');
  const ws = workspaces.find((w) => w.id === selectedId) ?? workspaces[0];
  const [name, setName] = useState(ws?.name ?? '');
  const [settings, setSettings] = useState<WorkspaceSettings | null>(ws?.settings ?? null);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const { busy, saved, error, run, setSaved } = useSaver();

  useEffect(() => {
    setName(ws?.name ?? '');
    setSettings(ws?.settings ?? null);
    setSaved(false);
  }, [ws?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (token) apiFetch<ProjectTemplate[]>('/api/templates', token).then(setTemplates).catch(() => setTemplates([]));
  }, [token]);

  if (!ws || !settings) {
    return (
      <Panel title="Espacio de trabajo" icon="workspaces">
        <p className="muted">Aún no perteneces a ningún espacio. <Link to="/espacios">Crea uno aquí</Link>.</p>
      </Panel>
    );
  }

  const isAdmin = ws.role !== 'member';
  const dirty = name.trim() !== ws.name || JSON.stringify(settings) !== JSON.stringify(ws.settings);
  const update = (patch: Partial<WorkspaceSettings>) => {
    setSaved(false);
    setSettings({ ...settings, ...patch });
  };
  const template = templates.find((t) => t.id === settings.defaultTemplate);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      onSaved(await apiFetch<Workspace>(`/api/workspaces/${ws.id}`, token, {
        method: 'PATCH', body: JSON.stringify({ name: name.trim(), settings }),
      }));
    }, 'No se pudo guardar el espacio.');
  };

  return (
    <form onSubmit={submit}>
      {workspaces.length > 1 && (
        <label className="field settings__picker">
          <span>Espacio</span>
          <select className="select" value={ws.id} onChange={(e) => setSelectedId(e.target.value)}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} · {WS_ROLE_LABEL[w.role]}</option>)}
          </select>
        </label>
      )}

      <Panel title={ws.name} icon="workspaces"
        description={isAdmin ? `Eres ${WS_ROLE_LABEL[ws.role].toLowerCase()}: puedes cambiar estas reglas.`
          : 'Solo el propietario y los administradores pueden cambiar estas reglas.'}>
        <fieldset className="settings__fieldset" disabled={!isAdmin}>
          <label className="field">
            <span>Nombre del espacio</span>
            <div className="input"><input required minLength={2} maxLength={80} value={name} onChange={(e) => { setSaved(false); setName(e.target.value); }} /></div>
          </label>

          <div className="settings__rows">
            <div className="settings__row">
              <div>
                <strong>Los miembros pueden crear proyectos</strong>
                <p className="muted small">Si lo desactivas, solo el propietario y los administradores crean proyectos.</p>
              </div>
              <Toggle label="Los miembros pueden crear proyectos" checked={settings.membersCanCreateProjects} disabled={!isAdmin}
                onChange={(v) => update({ membersCanCreateProjects: v })} />
            </div>
            <div className="settings__row">
              <div>
                <strong>Duración sugerida de los Sprints</strong>
                <p className="muted small">Se propone al planificar; siempre se puede cambiar (máximo un mes).</p>
              </div>
              <div className="chips" role="radiogroup" aria-label="Duración sugerida">
                {[1, 2, 3, 4].map((w) => (
                  <button key={w} type="button" role="radio" aria-checked={settings.defaultSprintWeeks === w}
                    className={`chip chip--plain${settings.defaultSprintWeeks === w ? ' chip--on' : ''}`}
                    onClick={() => update({ defaultSprintWeeks: w })}>
                    {w} {w === 1 ? 'semana' : 'semanas'}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings__row">
              <div>
                <strong>Tablero para proyectos nuevos</strong>
                <p className="muted small">{template ? template.columns.map((c) => c.name).join(' → ') : 'Columnas iniciales del tablero.'}</p>
              </div>
              <select className="select" value={settings.defaultTemplate} aria-label="Tablero para proyectos nuevos"
                onChange={(e) => update({ defaultTemplate: e.target.value })}>
                {(templates.length ? templates : [{ id: settings.defaultTemplate, name: settings.defaultTemplate }]).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>
        {isAdmin && <SaveBar dirty={dirty && name.trim().length >= 2} busy={busy} saved={saved} error={error}
          onReset={() => { setName(ws.name); setSettings(ws.settings); }} />}
      </Panel>

      <div className="settings__links">
        <Link to="/miembros" className="settings__link card"><Icon name="users" size={18} /> Miembros, roles e invitaciones <Icon name="arrowRight" size={16} /></Link>
        <Link to="/espacios" className="settings__link card"><Icon name="folder" size={18} /> Proyectos: completar, archivar o eliminar <Icon name="arrowRight" size={16} /></Link>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ proyecto
function ProjectSection({ projects, onSaved }: { projects: Project[]; onSaved: (p: Project) => void }) {
  const { token } = useAuth();
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState(() => params.get('proyecto') ?? projects[0]?.id ?? '');
  const project = projects.find((p) => p.id === selectedId) ?? projects[0];
  const [form, setForm] = useState(() => toForm(project));
  const { busy, saved, error, run, setSaved } = useSaver();

  useEffect(() => {
    setForm(toForm(project));
    setSaved(false);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project || !form) {
    return (
      <Panel title="Proyecto" icon="folder">
        <p className="muted">No tienes proyectos activos. <Link to="/espacios">Crea uno en Espacios de trabajo</Link>.</p>
      </Panel>
    );
  }

  const original = toForm(project)!;
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const set = (patch: Partial<NonNullable<typeof form>>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      onSaved(await apiFetch<Project>(`/api/projects/${project.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ ...form, name: form.name.trim() }),
      }));
    }, 'No se pudo guardar el proyecto.');
  };

  return (
    <>
      <label className="field settings__picker">
        <span>Proyecto</span>
        <select className="select" value={project.id} onChange={(e) => setSelectedId(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
        </select>
      </label>

      <form onSubmit={submit}>
        <Panel title="Datos del proyecto" icon="folder"
          description={project.canManage ? 'Product Owner, Scrum Master o administradores del espacio pueden editarlo.'
            : 'Solo lectura: lo editan el Product Owner, el Scrum Master o un administrador del espacio.'}>
          <fieldset className="settings__fieldset" disabled={!project.canManage}>
            <div className="dialog__row">
              <label className="field">
                <span>Nombre</span>
                <div className="input"><input required minLength={2} maxLength={120} value={form.name} onChange={(e) => set({ name: e.target.value })} /></div>
              </label>
              <label className="field">
                <span>Estado</span>
                <select className="select" value={form.status} onChange={(e) => set({ status: e.target.value as ProjectStatus })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Descripción</span>
              <div className="input"><input maxLength={500} value={form.description} onChange={(e) => set({ description: e.target.value })} /></div>
            </label>
            <label className="field">
              <span>Product Goal</span>
              <textarea className="textarea" rows={3} maxLength={1000} value={form.productGoal}
                placeholder="El objetivo de largo plazo que guía el Product Backlog"
                onChange={(e) => set({ productGoal: e.target.value })} />
            </label>
            <div className="field">
              <span>Color</span>
              <div className="color-row">
                {PROJECT_COLORS.map((c) => (
                  <button key={c} type="button" className={`color-dot${form.color === c ? ' color-dot--on' : ''}`} style={{ background: c }}
                    aria-label={`Color ${c}`} aria-pressed={form.color === c} onClick={() => set({ color: c })} />
                ))}
              </div>
            </div>
            <dl className="settings__facts">
              <div><dt>Clave</dt><dd>{project.key} <span className="muted small">(no cambia: identifica a los PBIs, ej. {project.key}-12)</span></dd></div>
              <div><dt>Tu rol</dt><dd>{project.myRole ? ROLE_LABEL[project.myRole] : 'Administrador del espacio'}</dd></div>
            </dl>
          </fieldset>
          {project.canManage && <SaveBar dirty={dirty && form.name.trim().length >= 2} busy={busy} saved={saved} error={error}
            onReset={() => setForm(original)} />}
        </Panel>
      </form>

      <LabelsPanel key={project.id} project={project} />

      <div className="settings__links">
        <Link to={`/tableros?proyecto=${project.id}`} className="settings__link card">
          <Icon name="boards" size={18} /> Columnas y límites WIP del tablero <Icon name="arrowRight" size={16} />
        </Link>
        <Link to={`/miembros?proyecto=${project.id}`} className="settings__link card">
          <Icon name="users" size={18} /> Equipo y roles Scrum del proyecto <Icon name="arrowRight" size={16} />
        </Link>
      </div>
    </>
  );
}

function toForm(project: Project | undefined) {
  if (!project) return null;
  return {
    name: project.name,
    description: project.description ?? '',
    productGoal: project.productGoal ?? '',
    status: project.status,
    color: project.color,
  };
}

function LabelsPanel({ project }: { project: Project }) {
  const { token } = useAuth();
  const [labels, setLabels] = useState<LabelUsage[] | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', color: '' });
  const [error, setError] = useState<string | null>(null);
  const canEdit = project.myRole !== 'observer';

  const load = useCallback(async () => {
    try {
      setLabels(await apiFetch<LabelUsage[]>(`/api/projects/${project.id}/labels`, token));
    } catch (err) {
      setError(errorMessage(err, 'No se pudieron cargar las etiquetas.'));
    }
  }, [project.id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (err) {
      setError(errorMessage(err, fallback));
      return false;
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (await act(() => apiFetch(`/api/projects/${project.id}/labels`, token, {
      method: 'POST', body: JSON.stringify({ name: name.trim(), color }),
    }), 'No se pudo crear la etiqueta.')) setName('');
  };

  const saveEdit = async (id: string) => {
    if (await act(() => apiFetch(`/api/labels/${id}`, token, {
      method: 'PATCH', body: JSON.stringify({ name: draft.name.trim(), color: draft.color }),
    }), 'No se pudo guardar la etiqueta.')) setEditing(null);
  };

  const remove = (label: LabelUsage) => {
    const msg = label.taskCount
      ? `¿Eliminar «${label.name}»? Se quitará de ${label.taskCount} ${label.taskCount === 1 ? 'tarjeta' : 'tarjetas'}.`
      : `¿Eliminar «${label.name}»?`;
    if (window.confirm(msg)) void act(() => apiFetch(`/api/labels/${label.id}`, token, { method: 'DELETE' }), 'No se pudo eliminar la etiqueta.');
  };

  return (
    <Panel title="Etiquetas del tablero" icon="tag"
      description="Clasifican las tarjetas con texto y color (el texto siempre se muestra, no solo el color).">
      {labels === null ? <p className="muted small">Cargando…</p> : labels.length === 0 ? (
        <p className="muted small">Este proyecto aún no tiene etiquetas.</p>
      ) : (
        <ul className="label-list">
          {labels.map((l) => (
            <li key={l.id} className="label-list__item">
              {editing === l.id ? (
                <>
                  <div className="input label-list__input">
                    <input autoFocus maxLength={30} value={draft.name} aria-label="Nombre de la etiqueta"
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); if (e.key === 'Enter') { e.preventDefault(); void saveEdit(l.id); } }} />
                  </div>
                  <div className="color-row color-row--sm">
                    {LABEL_COLORS.map((c) => (
                      <button key={c} type="button" className={`color-dot${draft.color === c ? ' color-dot--on' : ''}`} style={{ background: c }}
                        aria-label={`Color ${c}`} aria-pressed={draft.color === c} onClick={() => setDraft({ ...draft, color: c })} />
                    ))}
                  </div>
                  <button type="button" className="btn btn--primary btn--sm" disabled={!draft.name.trim()} onClick={() => void saveEdit(l.id)}>Guardar</button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Cancelar</button>
                </>
              ) : (
                <>
                  <span className="label-tag" style={{ ['--label' as string]: l.color }}><span className="label-tag__dot" />{l.name}</span>
                  <span className="muted small label-list__count">{l.taskCount} {l.taskCount === 1 ? 'tarjeta' : 'tarjetas'}</span>
                  {canEdit && (
                    <button type="button" className="icon-btn" aria-label={`Editar ${l.name}`}
                      onClick={() => { setEditing(l.id); setDraft({ name: l.name, color: l.color }); }}>
                      <Icon name="edit" size={16} />
                    </button>
                  )}
                  {project.canManage && (
                    <button type="button" className="icon-btn" aria-label={`Eliminar ${l.name}`} onClick={() => remove(l)}>
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form className="label-new" onSubmit={create}>
          <div className="input">
            <input maxLength={30} placeholder="Nueva etiqueta, ej: Frontend" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nueva etiqueta" />
          </div>
          <div className="color-row color-row--sm">
            {LABEL_COLORS.map((c) => (
              <button key={c} type="button" className={`color-dot${color === c ? ' color-dot--on' : ''}`} style={{ background: c }}
                aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />
            ))}
          </div>
          <button className="btn btn--primary btn--sm" disabled={!name.trim()}><Icon name="plus" size={15} /> Agregar</button>
        </form>
      )}
      {error && <p className="form__error" role="alert">{error}</p>}
    </Panel>
  );
}

// ------------------------------------------------------------------ permisos
const MATRIX: { action: string; who: [boolean, boolean, boolean, boolean, boolean] }[] = [
  // [Admin del espacio, Product Owner, Scrum Master, Developer, Observador]
  { action: 'Ver proyecto, tablero, eventos, bitácora e informes', who: [true, true, true, true, true] },
  { action: 'Crear y mover tareas, checklist y comentarios', who: [true, true, true, true, false] },
  { action: 'Crear y ordenar PBIs del Product Backlog', who: [true, true, true, true, false] },
  { action: 'Registrar eventos Scrum y acciones de mejora', who: [true, true, true, true, false] },
  { action: 'Planificar un Sprint (Sprint Planning)', who: [true, true, true, true, false] },
  { action: 'Iniciar, cerrar o cancelar Sprints', who: [true, true, true, false, false] },
  { action: 'Definir el Product Goal', who: [true, true, true, false, false] },
  { action: 'Configurar columnas y eliminar etiquetas', who: [true, true, true, false, false] },
  { action: 'Editar, completar o archivar el proyecto', who: [true, true, true, false, false] },
  { action: 'Agregar integrantes y cambiar roles Scrum', who: [true, true, true, false, false] },
  { action: 'Eliminar un proyecto sin Sprints', who: [true, false, false, false, false] },
];
const MATRIX_COLS = ['Admin. del espacio', 'Product Owner', 'Scrum Master', 'Developer', 'Observador'];

function PermissionsSection({ workspaces, projects }: { workspaces: Workspace[]; projects: Project[] }) {
  const byWorkspace = workspaces.map((w) => ({ ws: w, projects: projects.filter((p) => p.workspaceId === w.id) }));

  return (
    <>
      <Panel title="Tus roles" icon="user" description="Los roles Scrum no son jerarquías: describen responsabilidades. Los permisos técnicos se suman a ellos.">
        {byWorkspace.length === 0 ? <p className="muted small">Aún no perteneces a ningún espacio.</p> : (
          <div className="my-roles">
            {byWorkspace.map(({ ws, projects: list }) => (
              <div key={ws.id} className="my-roles__ws">
                <div className="my-roles__head">
                  <strong>{ws.name}</strong>
                  <span className={`pill ${ws.role === 'owner' ? 'pill--active' : 'pill--planning'}`}>{WS_ROLE_LABEL[ws.role]}</span>
                </div>
                {list.length > 0 && (
                  <ul>
                    {list.map((p) => (
                      <li key={p.id}>
                        <span className="notif__dot" style={{ background: p.color }} />
                        <span>{p.name}</span>
                        <span className="muted small">{p.myRole ? ROLE_LABEL[p.myRole] : 'Acceso como administrador'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Qué puede hacer cada rol" icon="lock"
        description="La API valida estos permisos en cada acción; ocultar un botón no es la única protección.">
        <div className="perm-table__wrap">
          <table className="perm-table">
            <thead>
              <tr>
                <th scope="col">Acción</th>
                {MATRIX_COLS.map((c) => <th key={c} scope="col">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((row) => (
                <tr key={row.action}>
                  <th scope="row">{row.action}</th>
                  {row.who.map((ok, i) => (
                    <td key={MATRIX_COLS[i]} aria-label={ok ? 'Sí' : 'No'}>
                      {ok ? <Icon name="check" size={16} className="perm-table__yes" /> : <span className="perm-table__no">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="muted small settings__bullets">
          <li><strong>Propietario</strong>: además renombra o elimina el espacio y nombra administradores.</li>
          <li>Los Sprints no se borran: se cierran o cancelan con motivo. La bitácora no se puede editar ni borrar.</li>
          <li>Los roles se cambian en <Link to="/miembros">Miembros</Link>.</li>
        </ul>
      </Panel>
    </>
  );
}
