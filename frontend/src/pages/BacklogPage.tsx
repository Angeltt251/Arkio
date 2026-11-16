import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { ProjectSelect } from '@/components/ui/ProjectSelect';
import { useEscape, useProjectResource } from '@/hooks/useProjectResource';
import { apiFetch, errorMessage } from '@/lib/api';
import {
  ESTIMATE_OPTIONS,
  PBI_STATUS_LABEL,
  PBI_TYPE_LABEL,
  PRIORITY_LABEL,
  isReturned,
  type Pbi,
  type PbiStatus,
  type PbiType,
  type Priority,
  type ProjectHeader,
} from '@/lib/scrum';

interface Backlog extends ProjectHeader {
  items: Pbi[];
}

type StatusFilter = 'open' | 'all' | PbiStatus;

const OPEN_STATUSES: PbiStatus[] = ['new', 'refined', 'ready', 'in_sprint'];

export function BacklogPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { token, projects, projectId, selectProject, data: backlog, setData, error, setError, reload } =
    useProjectResource<Backlog>((id) => `/api/projects/${id}/backlog${showArchived ? '?include_archived=true' : ''}`);
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Pbi | 'new' | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goal, setGoal] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (backlog?.items ?? []).filter((i) => {
      if (filter === 'open' && !OPEN_STATUSES.includes(i.status) && !i.archived) return false;
      if (filter !== 'open' && filter !== 'all' && i.status !== filter) return false;
      return !q || `${i.code} ${i.title} ${i.storyIWant ?? ''}`.toLowerCase().includes(q);
    });
  }, [backlog, filter, query]);

  const canReorder = !!backlog?.canEdit && filter !== 'all' && !query.trim();
  const returned = (backlog?.items ?? []).filter((i) => !i.archived && isReturned(i));
  const points = visible.filter((i) => !i.archived).reduce((sum, i) => sum + (i.estimate ?? 0), 0);

  const saveGoal = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    try {
      await apiFetch(`/api/projects/${projectId}/product-goal`, token, {
        method: 'PUT',
        body: JSON.stringify({ productGoal: goal.trim() || null }),
      });
      setEditingGoal(false);
      await reload();
    } catch (err) {
      setError(errorMessage(err, 'No se pudo guardar el Product Goal.'));
    }
  };

  /** Mueve un PBI a la posición que ocupa `target` dentro del backlog completo. */
  const moveTo = async (pbiId: string, targetVisibleIndex: number) => {
    if (!backlog) return;
    const all = backlog.items.filter((i) => !i.archived);
    const without = all.filter((i) => i.id !== pbiId);
    const visibleWithout = visible.filter((i) => i.id !== pbiId && !i.archived);
    const anchor = visibleWithout[targetVisibleIndex];
    const index = anchor ? without.findIndex((i) => i.id === anchor.id) : without.length;
    const moving = all.find((i) => i.id === pbiId);
    if (!moving) return;
    const previous = backlog.items;
    const reordered = [...without];
    reordered.splice(index, 0, moving);
    setData({ ...backlog, items: [...reordered, ...backlog.items.filter((i) => i.archived)] });
    try {
      await apiFetch(`/api/backlog-items/${pbiId}/move`, token, { method: 'POST', body: JSON.stringify({ index }) });
    } catch (err) {
      setData((b) => (b ? { ...b, items: previous } : b));
      setError(errorMessage(err, 'No se pudo reordenar el backlog.'));
    }
  };

  const onDragOver = (e: DragEvent<HTMLOListElement>) => {
    if (!dragging) return;
    e.preventDefault();
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-pbi-id]')).filter(
      (el) => el.dataset.pbiId !== dragging,
    );
    let index = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    if (index !== dropIndex) setDropIndex(index);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragging && dropIndex !== null) void moveTo(dragging, dropIndex);
    setDragging(null);
    setDropIndex(null);
  };

  if (projects && projects.length === 0) {
    return (
      <div className="dashboard">
        <div className="page-head">
          <div>
            <h1>Product Backlog</h1>
            <p className="muted">Lista ordenada de lo necesario para mejorar el producto.</p>
          </div>
        </div>
        <div className="empty">
          <p>Aún no tienes proyectos.</p>
          <Link to="/espacios" className="btn btn--primary btn--sm" style={{ justifySelf: 'center' }}>
            <Icon name="plus" size={16} /> Crear un proyecto
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="page-head">
        <div>
          <h1>Product Backlog</h1>
          <p className="muted">
            {backlog?.canEdit === false
              ? 'Solo lectura: tu rol de observador no permite editar.'
              : 'Lo más importante arriba. Arrastra para reordenar y abre un elemento para refinarlo.'}
          </p>
        </div>
        <ProjectSelect projects={projects} value={projectId} onChange={selectProject} />
      </div>

      {error && <p className="form__error" role="alert">{error}</p>}

      {!backlog ? (
        <div className="skeleton-grid" aria-busy="true" aria-label="Cargando backlog">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" />)}
        </div>
      ) : (
        <>
          <section className="card goal-card">
            <header className="card__head">
              <h2><Icon name="target" size={20} className="card__icon" /> Product Goal</h2>
              <span className="muted small">Paso 4 · se define antes de crear el backlog</span>
              {backlog.canManage && !editingGoal && (
                <button type="button" className="btn btn--ghost btn--sm"
                  onClick={() => { setGoal(backlog.productGoal ?? ''); setEditingGoal(true); }}>
                  {backlog.productGoal ? 'Editar' : 'Definir'}
                </button>
              )}
            </header>
            {editingGoal ? (
              <form className="form" onSubmit={saveGoal} style={{ marginTop: 0 }}>
                <textarea className="textarea" rows={3} maxLength={1000} autoFocus value={goal}
                  placeholder="El objetivo a largo plazo del producto: qué valor queremos lograr y para quién."
                  onChange={(e) => setGoal(e.target.value)} />
                <div className="board-add__actions">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingGoal(false)}>Cancelar</button>
                  <button className="btn btn--primary btn--sm">Guardar</button>
                </div>
              </form>
            ) : backlog.productGoal ? (
              <p className="goal-card__text">{backlog.productGoal}</p>
            ) : (
              <p className="muted small">
                Aún no hay Product Goal. Es el objetivo general del producto y orienta qué entra al backlog y en qué orden.{' '}
                {backlog.canManage ? 'Defínelo para poder crear PBIs.' : 'Lo define el Product Owner; hasta entonces no se pueden crear PBIs.'}
              </p>
            )}
          </section>

          <DefinitionOfDoneCard backlog={backlog} projectId={projectId} token={token} onSaved={reload} onError={setError} />

          {returned.length > 0 && (
            <p className="notice notice--compact" role="status">
              {returned.length === 1 ? '1 PBI volvió' : `${returned.length} PBIs volvieron`} de un Sprint sin terminar
              ({returned.map((i) => i.code).join(', ')}). El Product Owner decide si siguen, cambian de orden o se descartan.
            </p>
          )}
          <div className="backlog-toolbar">
            <div className="search backlog-toolbar__search">
              <Icon name="search" size={17} />
              <input type="search" placeholder="Buscar por código o título" value={query}
                onChange={(e) => setQuery(e.target.value)} aria-label="Buscar en el backlog" />
            </div>
            <select className="select" aria-label="Estado" value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)}>
              <option value="open">Pendientes</option>
              <option value="all">Todos</option>
              {Object.entries(PBI_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <label className="check">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Archivados
            </label>
            <span className="muted small backlog-toolbar__sum">
              {visible.length} {visible.length === 1 ? 'elemento' : 'elementos'} · {points} pts
            </span>
            {backlog.canEdit && (
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing('new')}
                disabled={!backlog.productGoal} title={backlog.productGoal ? undefined : 'Primero define el Product Goal'}>
                <Icon name="plus" size={16} /> Nuevo PBI
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="empty card">
              <p>{backlog.items.length ? 'Ningún elemento coincide con el filtro.' : 'El Product Backlog está vacío.'}</p>
              {backlog.canEdit && !backlog.items.length && (
                <p className="muted small">
                  {backlog.productGoal
                    ? 'Crea el primer PBI: una historia de usuario, un defecto o una mejora.'
                    : 'Primero define el Product Goal; después crea y ordena los PBIs.'}
                </p>
              )}
            </div>
          ) : (
            <ol className="pbi-list card" onDragOver={onDragOver} onDrop={onDrop}
              onDragEnd={() => { setDragging(null); setDropIndex(null); }}>
              {visible.map((item) => {
                const reorderable = canReorder && !item.archived;
                const openItems = visible.filter((v) => !v.archived);
                const openIndex = openItems.findIndex((v) => v.id === item.id);
                const dropHere = !!dragging && dragging !== item.id &&
                  visible.filter((v) => v.id !== dragging).findIndex((v) => v.id === item.id) === dropIndex;
                return (
                  <li key={item.id} data-pbi-id={item.id}
                    className={`pbi-row${dragging === item.id ? ' pbi-row--dragging' : ''}${item.archived ? ' pbi-row--archived' : ''}${dropHere ? ' pbi-row--drop' : ''}`}
                    draggable={reorderable}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', item.id);
                      setDragging(item.id);
                    }}>
                    {reorderable && (
                      <span className="pbi-row__order">
                        <button type="button" className="icon-btn icon-btn--sm" aria-label={`Subir ${item.code}`}
                          disabled={openIndex === 0} onClick={() => void moveTo(item.id, openIndex - 1)}>▲</button>
                        <button type="button" className="icon-btn icon-btn--sm" aria-label={`Bajar ${item.code}`}
                          disabled={openIndex === openItems.length - 1} onClick={() => void moveTo(item.id, openIndex + 1)}>▼</button>
                      </span>
                    )}
                    <button type="button" className="pbi-row__main" onClick={() => setEditing(item)}>
                      <span className="pbi-row__code">{item.code}</span>
                      <span className="pbi-row__title">
                        <strong>{item.title}</strong>
                        {item.storyIWant && (
                          <span className="muted small">
                            Como {item.storyAsA || '…'}, quiero {item.storyIWant}{item.storySoThat ? `, para ${item.storySoThat}` : ''}
                          </span>
                        )}
                      </span>
                      <span className="pbi-row__meta">
                        <span className="pill pill--closed">{PBI_TYPE_LABEL[item.type]}</span>
                        <span className={`priority priority--${item.priority}`}>{PRIORITY_LABEL[item.priority]}</span>
                        <span className={`pill pbi-status pbi-status--${item.status}`}>{PBI_STATUS_LABEL[item.status]}</span>
                        {isReturned(item) ? (
                          <span className="pill pill--returned" title="Volvió sin terminar: requiere una nueva decisión">
                            Volvió del Sprint #{item.sprintNumber}
                          </span>
                        ) : item.sprintNumber && <span className="muted small">Sprint #{item.sprintNumber}</span>}
                        {item.taskCount > 0 && (
                          <span className="muted small" title="Tareas terminadas en el tablero">
                            <Icon name="check" size={13} /> {item.tasksDone}/{item.taskCount}
                          </span>
                        )}
                        {item.archived && <span className="log-tag log-tag--soft">Archivado</span>}
                      </span>
                      <span className="pbi-row__estimate" title="Estimación (puntos)">
                        {item.estimate ?? '—'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}

      {editing && backlog && projectId && (
        <PbiDialog item={editing === 'new' ? null : editing} backlog={backlog} projectId={projectId} token={token}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------ Definition of Done
function DefinitionOfDoneCard({ backlog, projectId, token, onSaved, onError }: {
  backlog: Backlog;
  projectId: string | null;
  token: string | null;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [criteria, setCriteria] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const dod = backlog.definitionOfDone;

  const add = () => {
    const text = draft.trim();
    if (text.length >= 2 && !criteria.includes(text)) setCriteria((c) => [...c, text]);
    setDraft('');
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    const pending = draft.trim();
    const list = pending.length >= 2 && !criteria.includes(pending) ? [...criteria, pending] : criteria;
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${projectId}`, token, {
        method: 'PATCH', body: JSON.stringify({ definitionOfDone: list }),
      });
      setEditing(false);
      setDraft('');
      await onSaved();
    } catch (err) {
      onError(errorMessage(err, 'No se pudo guardar la Definition of Done.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card goal-card" id="dod">
      <header className="card__head">
        <h2><Icon name="check" size={20} className="card__icon" /> Definition of Done</h2>
        <span className="muted small">Paso 6 · obligatoria antes de la Sprint Planning</span>
        {backlog.canManage && !editing && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setCriteria(dod); setEditing(true); }}>
            {dod.length ? 'Editar' : 'Definir'}
          </button>
        )}
      </header>
      {editing ? (
        <form className="form" onSubmit={save} style={{ marginTop: 0 }}>
          {criteria.length > 0 && (
            <ul className="dod-list">
              {criteria.map((c, i) => (
                <li key={c}>
                  <Icon name="check" size={15} />
                  <span style={{ flex: 1 }}>{c}</span>
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={`Quitar «${c}»`}
                    onClick={() => setCriteria((list) => list.filter((_, j) => j !== i))}>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="dod-edit">
            <div className="input">
              <input autoFocus maxLength={200} value={draft} aria-label="Nuevo criterio"
                placeholder="Ej: El código está revisado por otro integrante"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={add} disabled={draft.trim().length < 2}>
              <Icon name="plus" size={15} /> Agregar
            </button>
          </div>
          <div className="board-add__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>Cancelar</button>
            <button className="btn btn--primary btn--sm" disabled={busy || criteria.length + (draft.trim().length >= 2 ? 1 : 0) === 0}>
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      ) : dod.length ? (
        <ul className="dod-list">
          {dod.map((c) => <li key={c}><Icon name="check" size={15} /> {c}</li>)}
        </ul>
      ) : (
        <p className="muted small">
          Aún no está definida. Indica cuándo un trabajo se considera terminado y cumple los estándares de calidad
          (pruebas, revisión, documentación…). {backlog.canManage ? '' : 'La define el Product Owner o el Scrum Master.'}
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------ crear / refinar PBI
interface PbiDialogProps {
  item: Pbi | null;
  backlog: Backlog;
  projectId: string;
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}

function PbiDialog({ item, backlog, projectId, token, onClose, onSaved }: PbiDialogProps) {
  const [type, setType] = useState<PbiType>(item?.type ?? 'story');
  const [title, setTitle] = useState(item?.title ?? '');
  const [asA, setAsA] = useState(item?.storyAsA ?? '');
  const [iWant, setIWant] = useState(item?.storyIWant ?? '');
  const [soThat, setSoThat] = useState(item?.storySoThat ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [criteria, setCriteria] = useState(item?.acceptanceCriteria ?? '');
  const [priority, setPriority] = useState<Priority>(item?.priority ?? 'medium');
  const [estimate, setEstimate] = useState(item?.estimate != null ? String(item.estimate) : '');
  const [status, setStatus] = useState<PbiStatus>(item?.status ?? 'new');
  const [splitting, setSplitting] = useState(false);
  const [parts, setParts] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const readOnly = !backlog.canEdit || !!item?.archived;
  const estimateValue = estimate.trim() === '' ? null : Number(estimate.replace(',', '.'));
  const estimateValid = estimateValue === null || (Number.isFinite(estimateValue) && estimateValue >= 0 && estimateValue <= 999);

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onSaved();
    } catch (err) {
      setError(errorMessage(err, fallback));
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      type, title: title.trim(), storyAsA: asA, storyIWant: iWant, storySoThat: soThat, description,
      acceptanceCriteria: criteria, priority, estimate: estimateValue,
      ...(item && item.status !== 'in_sprint' ? { status } : {}),
    };
    void run(async () => {
      await apiFetch(item ? `/api/backlog-items/${item.id}` : `/api/projects/${projectId}/backlog-items`, token, {
        method: item ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
    }, 'No se pudo guardar el PBI.');
  };

  const split = () => {
    const titles = parts.split('\n').map((t) => t.trim()).filter(Boolean);
    void run(async () => {
      await apiFetch(`/api/backlog-items/${item!.id}/split`, token, { method: 'POST', body: JSON.stringify({ titles }) });
    }, 'No se pudo dividir el PBI.');
  };

  const archive = () => {
    if (!item) return;
    if (!item.archived && !window.confirm('¿Archivar este PBI? Seguirá registrado en la bitácora y podrás restaurarlo.')) return;
    void run(async () => {
      await apiFetch(`/api/backlog-items/${item.id}${item.archived ? '/restore' : ''}`, token, {
        method: item.archived ? 'POST' : 'DELETE',
      });
    }, 'No se pudo actualizar el PBI.');
  };

  const canSplit = !!item && !readOnly && !['in_sprint', 'done', 'discarded'].includes(item.status);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog dialog--wide card" onSubmit={save} role="dialog" aria-modal="true"
        aria-label={item ? `Editar ${item.code}` : 'Nuevo PBI'}>
        <header className="card__head">
          <h2>
            <Icon name="list" size={20} className="card__icon" />
            {item ? `${item.code}${item.parentCode ? ` · derivado de ${item.parentCode}` : ''}` : `Nuevo PBI en ${backlog.projectKey}`}
          </h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <fieldset disabled={readOnly} className="form" style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="dialog__row">
            <label className="field">
              <span>Tipo</span>
              <select className="select" value={type} onChange={(e) => setType(e.target.value as PbiType)}>
                {Object.entries(PBI_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Prioridad</span>
              <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Título</span>
            <div className="input">
              <input required minLength={2} maxLength={200} value={title} autoFocus={!item}
                placeholder="Ej: Iniciar sesión con correo" onChange={(e) => setTitle(e.target.value)} />
            </div>
          </label>

          {type === 'story' && (
            <div className="field">
              <span>Historia de usuario</span>
              <div className="story">
                <label><span>Como</span><input maxLength={200} placeholder="[rol]" value={asA} onChange={(e) => setAsA(e.target.value)} /></label>
                <label><span>quiero</span><input maxLength={500} placeholder="[capacidad]" value={iWant} onChange={(e) => setIWant(e.target.value)} /></label>
                <label><span>para</span><input maxLength={500} placeholder="[beneficio]" value={soThat} onChange={(e) => setSoThat(e.target.value)} /></label>
              </div>
            </div>
          )}

          <label className="field">
            <span className="field__row">
              Criterios de aceptación <span className="muted small">Uno por línea, verificables</span>
            </span>
            <textarea className="textarea" rows={4} maxLength={5000} value={criteria}
              placeholder={'Dado que…, cuando…, entonces…\nEl sistema muestra un mensaje si la contraseña es incorrecta'}
              onChange={(e) => setCriteria(e.target.value)} />
          </label>

          <label className="field">
            <span>Descripción</span>
            <textarea className="textarea" rows={3} maxLength={5000} value={description}
              placeholder="Contexto, notas del refinamiento, enlaces…" onChange={(e) => setDescription(e.target.value)} />
          </label>

          <div className="dialog__row">
            <label className="field">
              <span className="field__row">Estimación <span className="muted small">puntos</span></span>
              <div className="input">
                <input inputMode="decimal" list="estimate-options" placeholder="Sin estimar" value={estimate}
                  onChange={(e) => setEstimate(e.target.value.replace(/[^0-9.,]/g, ''))} />
              </div>
              <datalist id="estimate-options">
                {ESTIMATE_OPTIONS.map((n) => <option key={n} value={n} />)}
              </datalist>
            </label>
            {item && (
              <label className="field">
                <span>Estado</span>
                {item.status === 'in_sprint' ? (
                  <p className="muted small" style={{ margin: '0.6rem 0 0' }}>En el Sprint #{item.sprintNumber}: cambia al cerrarlo.</p>
                ) : (
                  <select className="select" value={status} onChange={(e) => setStatus(e.target.value as PbiStatus)}>
                    {(['new', 'refined', 'ready', 'done', 'discarded'] as PbiStatus[]).map((s) => (
                      <option key={s} value={s}>{PBI_STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                )}
              </label>
            )}
          </div>
        </fieldset>

        {splitting && (
          <div className="column-delete">
            <p className="small">
              Escribe una parte por línea. Se crearán como PBIs nuevos justo debajo y {item?.code} quedará como «Descartado».
            </p>
            <textarea className="textarea" rows={4} autoFocus value={parts} onChange={(e) => setParts(e.target.value)}
              placeholder={'Login con correo\nRecuperar contraseña'} />
            <div className="board-add__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSplitting(false)}>Cancelar</button>
              <button type="button" className="btn btn--primary btn--sm" disabled={busy || parts.split('\n').filter((t) => t.trim()).length < 2}
                onClick={split}>Dividir</button>
            </div>
          </div>
        )}

        {error && <p className="form__error" role="alert">{error}</p>}

        {backlog.canEdit && (
          <footer className="dialog__actions">
            {item && item.status !== 'in_sprint' && (
              <button type="button" className={`btn btn--ghost${item.archived ? '' : ' btn--danger'}`} disabled={busy} onClick={archive}>
                {item.archived ? 'Restaurar' : 'Archivar'}
              </button>
            )}
            {canSplit && !splitting && (
              <button type="button" className="btn btn--ghost" onClick={() => setSplitting(true)}>Dividir</button>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancelar</button>
            {!readOnly && (
              <button className="btn btn--primary" disabled={busy || title.trim().length < 2 || !estimateValid}>
                {busy ? 'Guardando…' : item ? 'Guardar' : 'Crear PBI'}
              </button>
            )}
          </footer>
        )}
      </form>
    </div>
  );
}
