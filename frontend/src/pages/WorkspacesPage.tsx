import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { useEscape } from '@/hooks/useProjectResource';
import { apiFetch } from '@/lib/api';
import { PROJECT_STATUS_LABEL } from '@/lib/format';
import { PROJECT_COLORS, suggestKey, type ProjectTemplate } from '@/lib/projects';
import type { ProjectRole, ProjectStatus } from '@/types';

interface Workspace {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
}

interface Project {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  color: string;
  archivedAt: string | null;
  canManage: boolean;
  canDelete: boolean;
}

type View = 'active' | 'completed' | 'archived';

const VIEWS: { id: View; label: string }[] = [
  { id: 'active', label: 'En curso' },
  { id: 'completed', label: 'Completados' },
  { id: 'archived', label: 'Archivados' },
];

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'planning', label: 'Planificación' },
  { value: 'active', label: 'Activo' },
  { value: 'paused', label: 'En pausa' },
  { value: 'closed', label: 'Completado' },
];

function viewOf(p: Project): View {
  if (p.archivedAt) return 'archived';
  return p.status === 'closed' ? 'completed' : 'active';
}

const ROLE_LABEL: Record<ProjectRole, string> = {
  product_owner: 'Product Owner',
  scrum_master: 'Scrum Master',
  developer: 'Developer',
  observer: 'Observador',
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function WorkspacesPage() {
  const { token, isDemo } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [myRole, setMyRole] = useState<ProjectRole>('product_owner');
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [template, setTemplate] = useState('scrum');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

  const [view, setView] = useState<View>('active');
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [workspaceDialog, setWorkspaceDialog] = useState<'rename' | 'delete' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadWorkspaces = useCallback(async () => {
    if (isDemo || !token) return;
    try {
      const list = await apiFetch<Workspace[]>('/api/workspaces', token);
      setWorkspaces(list);
      setSelectedId((current) => current ?? list[0]?.id ?? null);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, 'No se pudieron cargar los espacios de trabajo.'));
    } finally {
      setLoading(false);
    }
  }, [isDemo, token]);

  const loadProjects = useCallback(async () => {
    if (!token || !selectedId) return setProjects([]);
    try {
      setProjects(await apiFetch<Project[]>(`/api/workspaces/${selectedId}/projects`, token));
    } catch (err) {
      setLoadError(errorMessage(err, 'No se pudieron cargar los proyectos.'));
    }
  }, [token, selectedId]);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (!token || isDemo) return;
    apiFetch<ProjectTemplate[]>('/api/templates', token).then(setTemplates).catch(() => setTemplates([]));
  }, [token, isDemo]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const createWorkspace = async (e: FormEvent) => {
    e.preventDefault();
    setWorkspaceError(null);
    setCreatingWorkspace(true);
    try {
      const ws = await apiFetch<Workspace>('/api/workspaces', token, {
        method: 'POST',
        body: JSON.stringify({ name: workspaceName.trim() }),
      });
      setWorkspaces((list) => [...list, ws]);
      setSelectedId(ws.id);
      setWorkspaceName('');
      setShowProjectForm(true);
    } catch (err) {
      setWorkspaceError(errorMessage(err, 'No se pudo crear el espacio.'));
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const resetProjectForm = () => {
    setProjectName('');
    setProjectKey('');
    setKeyTouched(false);
    setDescription('');
    setColor(PROJECT_COLORS[0]);
    setMyRole('product_owner');
    setTemplate('scrum');
    setProjectError(null);
  };

  const createProject = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    setProjectError(null);
    setCreatingProject(true);
    try {
      const project = await apiFetch<Project>(`/api/workspaces/${selectedId}/projects`, token, {
        method: 'POST',
        body: JSON.stringify({
          name: projectName.trim(),
          key: projectKey,
          description: description.trim() || null,
          color,
          myRole,
          template,
        }),
      });
      setProjects((list) => [...list, project]);
      setView('active');
      resetProjectForm();
      setShowProjectForm(false);
    } catch (err) {
      setProjectError(errorMessage(err, 'No se pudo crear el proyecto.'));
    } finally {
      setCreatingProject(false);
    }
  };

  const replaceProject = (project: Project) =>
    setProjects((list) => list.map((p) => (p.id === project.id ? project : p)));

  /** Completar, reabrir, archivar o restaurar: cada acción mueve la tarjeta a otra pestaña. */
  const runAction = async (project: Project, request: () => Promise<Project>, fallback: string) => {
    setBusyId(project.id);
    setActionError(null);
    try {
      replaceProject(await request());
    } catch (err) {
      setActionError(errorMessage(err, fallback));
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = (project: Project, status: ProjectStatus) =>
    runAction(project, () => apiFetch<Project>(`/api/projects/${project.id}`, token, {
      method: 'PATCH', body: JSON.stringify({ status }),
    }), 'No se pudo cambiar el estado.');

  const archive = (project: Project) =>
    runAction(project, () => apiFetch<Project>(`/api/projects/${project.id}/archive`, token, { method: 'POST' }),
      'No se pudo archivar.');

  const restore = (project: Project) =>
    runAction(project, () => apiFetch<Project>(`/api/projects/${project.id}/restore`, token, { method: 'POST' }),
      'No se pudo restaurar.');

  if (isDemo) {
    return (
      <div className="notice" role="status">
        Modo demo: configura Supabase en frontend/.env.local para crear espacios y proyectos reales.
      </div>
    );
  }

  const keyValid = /^[A-Z][A-Z0-9]{1,5}$/.test(projectKey);
  const selected = workspaces.find((w) => w.id === selectedId) ?? null;
  const counts = { active: 0, completed: 0, archived: 0 } as Record<View, number>;
  projects.forEach((p) => { counts[viewOf(p)] += 1; });
  const visible = projects.filter((p) => viewOf(p) === view);

  return (
    <div className="dashboard">
      <div className="page-head">
        <div>
          <h1>Espacios de trabajo</h1>
          <p className="muted">Crea un espacio y organiza tus proyectos dentro de él.</p>
        </div>
        {selected && !showProjectForm && (
          <button className="btn btn--primary" onClick={() => setShowProjectForm(true)}>
            <Icon name="plus" size={18} /> Nuevo Proyecto
          </button>
        )}
      </div>

      {(loadError || actionError) && <p className="form__error" role="alert">{actionError ?? loadError}</p>}

      {loading ? (
        <div className="skeleton" aria-busy="true" aria-label="Cargando espacios" />
      ) : (
        <div className="grid grid--main">
          <section className="card">
            <header className="card__head">
              <h2>
                <Icon name="layers" size={22} className="card__icon" />
                {selected ? `Proyectos de ${selected.name}` : 'Proyectos'}
              </h2>
              {workspaces.length > 1 && (
                <select className="select" value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value)}
                  aria-label="Espacio de trabajo">
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              )}
            </header>

            {showProjectForm && selected ? (
              <form className="form" onSubmit={createProject} noValidate>
                <label className="field">
                  <span>Nombre del proyecto</span>
                  <div className="input">
                    <Icon name="folder" size={18} />
                    <input autoFocus required minLength={2} maxLength={120} placeholder="Sistema de Ventas"
                      value={projectName}
                      onChange={(e) => {
                        setProjectName(e.target.value);
                        if (!keyTouched) setProjectKey(suggestKey(e.target.value));
                      }} />
                  </div>
                </label>

                <label className="field">
                  <span className="field__row">
                    Clave
                    <span className="muted small">Prefijo de las tareas, ej: SDV-12 (2 a 6 letras/números)</span>
                  </span>
                  <div className="input">
                    <input required maxLength={6} placeholder="SDV" value={projectKey}
                      onChange={(e) => {
                        setKeyTouched(true);
                        setProjectKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                      }} />
                  </div>
                </label>

                <label className="field">
                  <span>Descripción (opcional)</span>
                  <div className="input">
                    <input maxLength={500} placeholder="¿De qué trata el proyecto?" value={description}
                      onChange={(e) => setDescription(e.target.value)} />
                  </div>
                </label>

                <div className="field">
                  <span>Color</span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {PROJECT_COLORS.map((c) => (
                      <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={color === c}
                        onClick={() => setColor(c)}
                        style={{
                          width: 30, height: 30, borderRadius: '50%', background: c, cursor: 'pointer',
                          border: color === c ? '3px solid var(--text)' : '3px solid transparent',
                        }} />
                    ))}
                  </div>
                </div>

                {templates.length > 0 && (
                  <label className="field">
                    <span>Plantilla</span>
                    <select className="select" value={template} onChange={(e) => setTemplate(e.target.value)}>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <span className="muted small" style={{ fontWeight: 500 }}>
                      {templates.find((t) => t.id === template)?.columns.map((c) => c.name).join(' → ')}
                    </span>
                  </label>
                )}

                <label className="field">
                  <span>Mi rol en el proyecto</span>
                  <select className="select" value={myRole} onChange={(e) => setMyRole(e.target.value as ProjectRole)}>
                    {Object.entries(ROLE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>

                {projectError && <p className="form__error" role="alert">{projectError}</p>}

                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn--ghost"
                    onClick={() => { resetProjectForm(); setShowProjectForm(false); }}>
                    Cancelar
                  </button>
                  <button className="btn btn--primary"
                    disabled={creatingProject || projectName.trim().length < 2 || !keyValid}>
                    {creatingProject ? 'Creando…' : 'Crear proyecto'}
                  </button>
                </div>
              </form>
            ) : projects.length === 0 ? (
              <div className="empty">
                <p>{selected ? 'Este espacio aún no tiene proyectos.' : 'Primero crea un espacio de trabajo.'}</p>
                {selected && (
                  <button className="btn btn--primary btn--sm" style={{ justifySelf: 'center' }}
                    onClick={() => setShowProjectForm(true)}>
                    <Icon name="plus" size={16} /> Crear el primer proyecto
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="project-tabs" role="tablist" aria-label="Filtrar proyectos">
                  {VIEWS.map((v) => (
                    <button key={v.id} type="button" role="tab" aria-selected={view === v.id}
                      className={`chip chip--plain${view === v.id ? ' chip--on' : ''}`} onClick={() => setView(v.id)}>
                      {v.label} <span className="project-tabs__count">{counts[v.id]}</span>
                    </button>
                  ))}
                </div>

                {visible.length === 0 ? (
                  <div className="empty">
                    <p>
                      {view === 'active' ? 'No hay proyectos en curso.'
                        : view === 'completed' ? 'Aún no hay proyectos completados.' : 'No hay proyectos archivados.'}
                    </p>
                    <p className="muted small">
                      {view === 'archived'
                        ? 'Archivar guarda un proyecto fuera del menú sin perder su historia; puedes restaurarlo cuando quieras.'
                        : view === 'completed' ? 'Marca un proyecto como completado cuando termines de trabajar en él.' : ''}
                    </p>
                  </div>
                ) : (
                  <div className="projects">
                    {visible.map((p) => (
                      <ProjectCard key={p.id} project={p} busy={busyId === p.id}
                        onEdit={() => setEditing(p)}
                        onComplete={() => void setStatus(p, 'closed')}
                        onReopen={() => void setStatus(p, 'active')}
                        onArchive={() => void archive(p)}
                        onRestore={() => void restore(p)}
                        onDelete={() => setDeleting(p)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="card">
            <header className="card__head">
              <h2>
                <Icon name="workspaces" size={22} className="card__icon" /> Mis espacios
              </h2>
            </header>
            {workspaces.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
                {workspaces.map((w) => (
                  <li key={w.id}>
                    <button type="button" className={`btn btn--block ${w.id === selectedId ? 'btn--primary' : 'btn--ghost'}`}
                      style={{ justifyContent: 'space-between' }} onClick={() => setSelectedId(w.id)}>
                      <span>{w.name}</span>
                      <span className="small">{w.role === 'owner' ? 'Propietario' : w.role === 'admin' ? 'Admin' : 'Miembro'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selected && selected.role !== 'member' && (
              <div className="workspace-actions">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setWorkspaceDialog('rename')}>
                  <Icon name="edit" size={15} /> Renombrar
                </button>
                {selected.role === 'owner' && (
                  <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => setWorkspaceDialog('delete')}>
                    <Icon name="trash" size={15} /> Eliminar espacio
                  </button>
                )}
              </div>
            )}
            <form className="form" onSubmit={createWorkspace} noValidate>
              <label className="field">
                <span>{workspaces.length ? 'Nuevo espacio' : 'Crea tu primer espacio'}</span>
                <div className="input">
                  <Icon name="workspaces" size={18} />
                  <input required minLength={2} maxLength={80} placeholder="Ej: Taller de Proyectos 2026"
                    value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />
                </div>
              </label>
              {workspaceError && <p className="form__error" role="alert">{workspaceError}</p>}
              <button className="btn btn--ghost btn--block"
                disabled={creatingWorkspace || workspaceName.trim().length < 2}>
                {creatingWorkspace ? 'Creando…' : 'Crear espacio'}
              </button>
            </form>
          </section>
        </div>
      )}

      {editing && (
        <EditProjectDialog project={editing} token={token} onClose={() => setEditing(null)}
          onSaved={(p) => { replaceProject(p); setEditing(null); }} />
      )}
      {deleting && (
        <ConfirmDeleteDialog
          title={`Eliminar «${deleting.name}»`}
          message="Se borran para siempre su backlog, tablero y tareas. La bitácora conserva el registro de lo eliminado."
          expected={deleting.key} label={`Escribe la clave ${deleting.key} para confirmar`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await apiFetch(`/api/projects/${deleting.id}?confirm=${encodeURIComponent(deleting.key)}`, token, { method: 'DELETE' });
            setProjects((list) => list.filter((p) => p.id !== deleting.id));
            setDeleting(null);
          }} />
      )}
      {workspaceDialog === 'rename' && selected && (
        <RenameWorkspaceDialog workspace={selected} token={token} onClose={() => setWorkspaceDialog(null)}
          onSaved={(ws) => {
            setWorkspaces((list) => list.map((w) => (w.id === ws.id ? ws : w)));
            setWorkspaceDialog(null);
          }} />
      )}
      {workspaceDialog === 'delete' && selected && (
        <ConfirmDeleteDialog
          title={`Eliminar el espacio «${selected.name}»`}
          message="Se eliminan el espacio, sus proyectos, miembros e invitaciones. No se puede si algún proyecto tiene Sprints: archívalos en su lugar."
          expected={selected.name} label="Escribe el nombre del espacio para confirmar"
          onClose={() => setWorkspaceDialog(null)}
          onConfirm={async () => {
            await apiFetch(`/api/workspaces/${selected.id}?confirm=${encodeURIComponent(selected.name)}`, token, { method: 'DELETE' });
            const rest = workspaces.filter((w) => w.id !== selected.id);
            setWorkspaces(rest);
            setSelectedId(rest[0]?.id ?? null);
            setWorkspaceDialog(null);
          }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------ tarjeta y diálogos
interface ProjectCardProps {
  project: Project;
  busy: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}

function ProjectCard({ project: p, busy, onEdit, onComplete, onReopen, onArchive, onRestore, onDelete }: ProjectCardProps) {
  const view = viewOf(p);
  return (
    <article className={`project-card${view === 'archived' ? ' project-card--archived' : ''}`}>
      <header className="project-card__head">
        <span className="project-card__badge" style={{ background: p.color }}>
          {p.name.charAt(0).toUpperCase()}
        </span>
        <div>
          {view === 'archived' ? <h3>{p.name}</h3> : (
            <h3><Link to={`/tableros?proyecto=${p.id}`} className="project-card__link">{p.name}</Link></h3>
          )}
          <span className={`pill pill--${p.status}`}>
            {view === 'archived' ? 'Archivado' : p.status === 'closed' ? 'Completado' : PROJECT_STATUS_LABEL[p.status]}
          </span>
        </div>
      </header>
      <p className="muted small">{p.key}{p.description ? ` · ${p.description}` : ''}</p>

      {(p.canManage || p.canDelete) && (
        <footer className="project-card__actions">
          {p.canManage && view !== 'archived' && (
            <button type="button" className="icon-btn icon-btn--sm" title="Editar" aria-label={`Editar ${p.name}`}
              disabled={busy} onClick={onEdit}>
              <Icon name="edit" size={15} />
            </button>
          )}
          {p.canManage && view === 'active' && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onComplete}>
              <Icon name="check" size={15} /> Completar
            </button>
          )}
          {p.canManage && view === 'completed' && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onReopen}>
              <Icon name="undo" size={15} /> Reabrir
            </button>
          )}
          {p.canManage && view !== 'archived' && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onArchive}
              title="Guardar fuera del menú sin perder su historia">
              <Icon name="archive" size={15} /> Archivar
            </button>
          )}
          {p.canManage && view === 'archived' && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onRestore}>
              <Icon name="undo" size={15} /> Restaurar
            </button>
          )}
          {p.canDelete && (
            <button type="button" className="icon-btn icon-btn--sm project-card__delete" title="Eliminar"
              aria-label={`Eliminar ${p.name}`} disabled={busy} onClick={onDelete}>
              <Icon name="trash" size={15} />
            </button>
          )}
        </footer>
      )}
    </article>
  );
}

function EditProjectDialog({ project, token, onClose, onSaved }: {
  project: Project;
  token: string | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [color, setColor] = useState(project.color);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await apiFetch<Project>(`/api/projects/${project.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, color, status }),
      }));
    } catch (err) {
      setError(errorMessage(err, 'No se pudo guardar el proyecto.'));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog card" onSubmit={submit} role="dialog" aria-modal="true" aria-label="Editar proyecto">
        <header className="card__head">
          <h2><Icon name="edit" size={20} className="card__icon" /> Editar proyecto</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="form" style={{ marginTop: 0 }}>
          <label className="field">
            <span>Nombre</span>
            <div className="input">
              <input autoFocus required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </label>
          <label className="field">
            <span>Descripción</span>
            <div className="input">
              <input maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </label>
          <label className="field">
            <span>Estado</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <div className="field">
            <span>Color</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {PROJECT_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
                  style={{
                    width: 30, height: 30, borderRadius: '50%', background: c, cursor: 'pointer',
                    border: color === c ? '3px solid var(--text)' : '3px solid transparent',
                  }} />
              ))}
            </div>
          </div>
          <p className="muted small" style={{ margin: 0 }}>La clave {project.key} no cambia: identifica a los PBIs.</p>
        </div>
        {error && <p className="form__error" role="alert">{error}</p>}
        <footer className="dialog__actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || name.trim().length < 2}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </footer>
      </form>
    </div>
  );
}

function RenameWorkspaceDialog({ workspace, token, onClose, onSaved }: {
  workspace: Workspace;
  token: string | null;
  onClose: () => void;
  onSaved: (workspace: Workspace) => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await apiFetch<Workspace>(`/api/workspaces/${workspace.id}`, token, {
        method: 'PATCH', body: JSON.stringify({ name: name.trim() }),
      }));
    } catch (err) {
      setError(errorMessage(err, 'No se pudo renombrar el espacio.'));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog card" onSubmit={submit} role="dialog" aria-modal="true" aria-label="Renombrar espacio">
        <header className="card__head">
          <h2><Icon name="workspaces" size={20} className="card__icon" /> Renombrar espacio</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <label className="field">
          <span>Nombre</span>
          <div className="input">
            <input autoFocus required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </label>
        {error && <p className="form__error" role="alert">{error}</p>}
        <footer className="dialog__actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || name.trim().length < 2}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </footer>
      </form>
    </div>
  );
}

/** Eliminar para siempre: pide escribir la clave o el nombre para evitar accidentes. */
function ConfirmDeleteDialog({ title, message, expected, label, onClose, onConfirm }: {
  title: string;
  message: string;
  expected: string;
  label: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(errorMessage(err, 'No se pudo eliminar.'));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog card" onSubmit={submit} role="alertdialog" aria-modal="true" aria-label={title}>
        <header className="card__head">
          <h2><Icon name="trash" size={20} className="card__icon" /> {title}</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <p className="notice notice--compact" style={{ margin: 0 }}>{message} Esta acción no se puede deshacer.</p>
        <label className="field">
          <span>{label}</span>
          <div className="input">
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={expected} />
          </div>
        </label>
        {error && <p className="form__error" role="alert">{error}</p>}
        <footer className="dialog__actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--danger-solid btn--primary" disabled={busy || typed.trim() !== expected}>
            {busy ? 'Eliminando…' : 'Eliminar para siempre'}
          </button>
        </footer>
      </form>
    </div>
  );
}
