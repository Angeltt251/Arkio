import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { PROJECT_COLORS, suggestKey, type ProjectTemplate } from '@/lib/projects';

interface Workspace {
  id: string;
  name: string;
}

const PRIORITY_LABEL: Record<string, string> = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function TemplatesPage() {
  const { token, isDemo } = useAuth();
  const [templates, setTemplates] = useState<ProjectTemplate[] | null>(null);
  const [category, setCategory] = useState('Todas');
  const [using, setUsing] = useState<ProjectTemplate | null>(null);
  const [preview, setPreview] = useState<ProjectTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || isDemo) return;
    apiFetch<ProjectTemplate[]>('/api/templates', token)
      .then(setTemplates)
      .catch((err) => setError(errorMessage(err, 'No se pudieron cargar las plantillas.')));
  }, [token, isDemo]);

  if (isDemo) {
    return (
      <div className="notice" role="status">
        Modo demo: configura Supabase en frontend/.env.local para crear proyectos desde plantillas.
      </div>
    );
  }

  const categories = ['Todas', ...new Set(templates?.map((t) => t.category) ?? [])];
  const visible = templates?.filter((t) => category === 'Todas' || t.category === category) ?? [];

  return (
    <div className="dashboard">
      <div className="page-head">
        <div>
          <h1>Plantillas</h1>
          <p className="muted">Crea un proyecto con su tablero y tareas iniciales ya preparados.</p>
        </div>
      </div>

      {error && <p className="form__error" role="alert">{error}</p>}

      {templates && (
        <div className="chips" role="tablist" aria-label="Categorías">
          {categories.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={category === c}
              className={`chip chip--plain${category === c ? ' chip--on' : ''}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      {!templates ? (
        <div className="skeleton-grid" aria-busy="true" aria-label="Cargando plantillas">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" />)}
        </div>
      ) : (
        <div className="templates">
          {visible.map((t) => (
            <article key={t.id} className="card template-card">
              <header className="template-card__head">
                <span className="template-card__icon"><Icon name={t.icon as IconName} size={22} /></span>
                <div>
                  <h2>{t.name}</h2>
                  <span className="pill pill--planning">{t.category}</span>
                </div>
              </header>
              <p className="muted small">{t.description}</p>

              <div className="template-cols" aria-label="Columnas del tablero">
                {t.columns.map((c) => (
                  <span key={c.name} className={`template-col${c.isDone ? ' template-col--done' : ''}`}
                    title={c.wipLimit ? `Límite WIP: ${c.wipLimit}` : undefined}>
                    {c.isDone && '✓ '}{c.name}{c.wipLimit ? ` · ${c.wipLimit}` : ''}
                  </span>
                ))}
              </div>

              <footer className="template-card__foot">
                <button type="button" className="link small" onClick={() => setPreview(t)}>
                  {t.tasks.length} {t.tasks.length === 1 ? 'tarea inicial' : 'tareas iniciales'}
                </button>
                <button type="button" className="btn btn--primary btn--sm" onClick={() => setUsing(t)}>
                  Usar plantilla
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}

      {preview && <TasksPreview template={preview} onClose={() => setPreview(null)} onUse={() => { setUsing(preview); setPreview(null); }} />}
      {using && <UseTemplateDialog template={using} token={token} onClose={() => setUsing(null)} />}
    </div>
  );
}

// ------------------------------------------------------------ vista previa de tareas
function TasksPreview({ template, onClose, onUse }: { template: ProjectTemplate; onClose: () => void; onUse: () => void }) {
  useEscape(onClose);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="dialog card" role="dialog" aria-modal="true" aria-label={`Tareas de ${template.name}`}>
        <header className="card__head">
          <h2><Icon name="templates" size={20} className="card__icon" /> {template.name}</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}><Icon name="close" size={18} /></button>
        </header>
        <ul className="member-list">
          {template.tasks.map((task) => (
            <li key={task.title} className="member-row">
              <div className="member-row__info">
                <strong style={{ whiteSpace: 'normal' }}>{task.title}</strong>
                <span className="muted small">En «{task.column}»</span>
              </div>
              <span className={`priority priority--${task.priority}`}>{PRIORITY_LABEL[task.priority] ?? task.priority}</span>
            </li>
          ))}
        </ul>
        <footer className="dialog__actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cerrar</button>
          <button type="button" className="btn btn--primary" onClick={onUse}>Usar plantilla</button>
        </footer>
      </section>
    </div>
  );
}

// ------------------------------------------------------------ crear proyecto desde la plantilla
function UseTemplateDialog({ template, token, onClose }: { template: ProjectTemplate; token: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const initialName = template.id === 'reservas' ? 'Reservas médicas' : '';
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [name, setName] = useState(initialName);
  const [key, setKey] = useState(suggestKey(initialName));
  const [keyTouched, setKeyTouched] = useState(false);
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  useEffect(() => {
    apiFetch<Workspace[]>('/api/workspaces', token)
      .then((list) => {
        setWorkspaces(list);
        setWorkspaceId(list[0]?.id ?? '');
      })
      .catch((err) => setError(errorMessage(err, 'No se pudieron cargar los espacios.')));
  }, [token]);

  const needsWorkspace = workspaces !== null && workspaces.length === 0;
  const keyValid = /^[A-Z][A-Z0-9]{1,5}$/.test(key);
  const canSubmit = name.trim().length >= 2 && keyValid && (needsWorkspace ? workspaceName.trim().length >= 2 : !!workspaceId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let targetId = workspaceId;
      if (needsWorkspace) {
        const ws = await apiFetch<Workspace>('/api/workspaces', token, {
          method: 'POST',
          body: JSON.stringify({ name: workspaceName.trim() }),
        });
        targetId = ws.id;
        setWorkspaces([ws]);
        setWorkspaceId(ws.id);
      }
      const project = await apiFetch<{ id: string }>(`/api/workspaces/${targetId}/projects`, token, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), key, color, template: template.id }),
      });
      navigate(`/tableros?proyecto=${project.id}`);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo crear el proyecto.'));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog card" onSubmit={submit} role="dialog" aria-modal="true" aria-label={`Usar ${template.name}`} noValidate>
        <header className="card__head">
          <h2><Icon name="plus" size={20} className="card__icon" /> Nuevo proyecto · {template.name}</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}><Icon name="close" size={18} /></button>
        </header>

        <div className="form" style={{ marginTop: 0 }}>
          {needsWorkspace ? (
            <label className="field">
              <span>Primero, nombra tu espacio de trabajo</span>
              <div className="input">
                <Icon name="workspaces" size={18} />
                <input autoFocus maxLength={80} placeholder="Ej: Taller de Proyectos 2026" value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)} />
              </div>
            </label>
          ) : (
            workspaces && workspaces.length > 1 && (
              <label className="field">
                <span>Espacio de trabajo</span>
                <select className="select" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                  {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
            )
          )}

          <label className="field">
            <span>Nombre del proyecto</span>
            <div className="input">
              <Icon name="folder" size={18} />
              <input autoFocus={!needsWorkspace} maxLength={120} placeholder="Ej: Sistema de Ventas" value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!keyTouched) setKey(suggestKey(e.target.value));
                }} />
            </div>
          </label>

          <label className="field">
            <span className="field__row">
              Clave <span className="muted small">Prefijo de las tareas (2 a 6 letras/números)</span>
            </span>
            <div className="input">
              <input maxLength={6} placeholder="SDV" value={key}
                onChange={(e) => {
                  setKeyTouched(true);
                  setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                }} />
            </div>
          </label>

          <div className="field">
            <span>Color</span>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {PROJECT_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
                  style={{
                    width: 30, height: 30, borderRadius: '50%', background: c, cursor: 'pointer',
                    border: color === c ? '3px solid var(--text)' : '3px solid transparent',
                  }} />
              ))}
            </div>
          </div>

          <p className="muted small">
            Se creará el tablero con {template.columns.length} columnas ({template.columns.map((c) => c.name).join(', ')})
            {template.tasks.length > 0 && ` y ${template.tasks.length} tareas iniciales`}. Luego puedes cambiarlo todo.
          </p>
        </div>

        {error && <p className="form__error" role="alert">{error}</p>}

        <footer className="dialog__actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !canSubmit}>{busy ? 'Creando…' : 'Crear proyecto'}</button>
        </footer>
      </form>
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}
