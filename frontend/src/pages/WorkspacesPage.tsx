import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { PROJECT_STATUS_LABEL } from '@/lib/format';
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
}

const COLORS = ['#447794', '#2D5B75', '#123249', '#27AE60', '#F2994A', '#EB5757'];

const ROLE_LABEL: Record<ProjectRole, string> = {
  product_owner: 'Product Owner',
  scrum_master: 'Scrum Master',
  developer: 'Developer',
  observer: 'Observador',
};

/** Clave sugerida a partir del nombre: "Sistema de Ventas" → "SDV". */
function suggestKey(name: string): string {
  const words = name.normalize('NFD').replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3);
  return key.toUpperCase().replace(/^[0-9]+/, '').slice(0, 6);
}

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
  const [color, setColor] = useState(COLORS[0]);
  const [myRole, setMyRole] = useState<ProjectRole>('product_owner');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

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
    setColor(COLORS[0]);
    setMyRole('product_owner');
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
        }),
      });
      setProjects((list) => [...list, project]);
      resetProjectForm();
      setShowProjectForm(false);
    } catch (err) {
      setProjectError(errorMessage(err, 'No se pudo crear el proyecto.'));
    } finally {
      setCreatingProject(false);
    }
  };

  if (isDemo) {
    return (
      <div className="notice" role="status">
        Modo demo: configura Supabase en frontend/.env.local para crear espacios y proyectos reales.
      </div>
    );
  }

  const keyValid = /^[A-Z][A-Z0-9]{1,5}$/.test(projectKey);
  const selected = workspaces.find((w) => w.id === selectedId) ?? null;

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

      {loadError && <p className="form__error" role="alert">{loadError}</p>}

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
                    {COLORS.map((c) => (
                      <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={color === c}
                        onClick={() => setColor(c)}
                        style={{
                          width: 30, height: 30, borderRadius: '50%', background: c, cursor: 'pointer',
                          border: color === c ? '3px solid var(--text)' : '3px solid transparent',
                        }} />
                    ))}
                  </div>
                </div>

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
              <div className="projects">
                {projects.map((p) => (
                  <article key={p.id} className="project-card">
                    <header className="project-card__head">
                      <span className="project-card__badge" style={{ background: p.color }}>
                        {p.name.charAt(0).toUpperCase()}
                      </span>
                      <div>
                        <h3>{p.name}</h3>
                        <span className={`pill pill--${p.status}`}>{PROJECT_STATUS_LABEL[p.status]}</span>
                      </div>
                    </header>
                    <p className="muted small">{p.key}{p.description ? ` · ${p.description}` : ''}</p>
                  </article>
                ))}
              </div>
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
    </div>
  );
}
