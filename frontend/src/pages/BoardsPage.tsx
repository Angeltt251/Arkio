import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { connectRealtime } from '@/lib/realtime';

type Priority = 'low' | 'medium' | 'high' | 'critical';

interface Task {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: Priority;
  position: number;
  dueDate: string | null;
  isBlocked: boolean;
  blockedReason: string | null;
  assigneeIds: string[];
  completed: boolean;
}

interface Column {
  id: string;
  name: string;
  position: number;
  wipLimit: number | null;
  isDone: boolean;
  tasks: Task[];
}

interface Member {
  id: string;
  name: string;
  avatarUrl: string | null;
}

interface Board {
  projectId: string;
  projectName: string;
  projectKey: string;
  projectColor: string;
  canEdit: boolean;
  columns: Column[];
  members: Member[];
}

interface ProjectOption {
  id: string;
  name: string;
  color: string;
}

const PRIORITY_LABEL: Record<Priority, string> = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' };

const dueFmt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' });

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Quita la tarea de su columna y la inserta en `columnId` en la posición `index`. */
function moveLocally(columns: Column[], taskId: string, columnId: string, index: number): Column[] {
  const task = columns.flatMap((c) => c.tasks).find((t) => t.id === taskId);
  if (!task) return columns;
  const target = columns.find((c) => c.id === columnId);
  const moved = { ...task, columnId, completed: target?.isDone ?? task.completed };
  return columns.map((c) => {
    const tasks = c.tasks.filter((t) => t.id !== taskId);
    if (c.id === columnId) tasks.splice(Math.min(index, tasks.length), 0, moved);
    return { ...c, tasks };
  });
}

export function BoardsPage() {
  const { token } = useAuth();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ columnId: string; index: number } | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const reloadTimer = useRef<number | undefined>(undefined);

  const projectId = params.get('proyecto') ?? projects?.[0]?.id ?? null;

  useEffect(() => {
    if (!token) return;
    apiFetch<ProjectOption[]>('/api/projects', token)
      .then(setProjects)
      .catch((err) => setError(errorMessage(err, 'No se pudieron cargar los proyectos.')));
  }, [token]);

  const loadBoard = useCallback(async () => {
    if (!token || !projectId) return;
    try {
      setBoard(await apiFetch<Board>(`/api/projects/${projectId}/board`, token));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo cargar el tablero.'));
    }
  }, [token, projectId]);

  useEffect(() => {
    setBoard(null);
    void loadBoard();
  }, [loadBoard]);

  // Tiempo real: si otro integrante cambia algo en este proyecto, recargar
  useEffect(() => {
    if (!token || !projectId) return;
    const close = connectRealtime(token, (msg) => {
      if (msg.type !== 'activity' || msg.data?.project_id !== projectId) return;
      window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => void loadBoard(), 500);
    });
    return () => {
      window.clearTimeout(reloadTimer.current);
      close();
    };
  }, [token, projectId, loadBoard]);

  const membersById = new Map(board?.members.map((m) => [m.id, m]) ?? []);

  // ------------------------------------------------------------ drag & drop
  const onDragOverColumn = (e: DragEvent<HTMLDivElement>, column: Column) => {
    if (!dragging) return;
    e.preventDefault();
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-task-id]')).filter(
      (el) => el.dataset.taskId !== dragging,
    );
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    if (dropTarget?.columnId !== column.id || dropTarget.index !== index) setDropTarget({ columnId: column.id, index });
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    const taskId = dragging;
    const target = dropTarget;
    setDragging(null);
    setDropTarget(null);
    if (!board || !taskId || !target) return;

    const previous = board.columns;
    setBoard({ ...board, columns: moveLocally(previous, taskId, target.columnId, target.index) });
    try {
      await apiFetch(`/api/tasks/${taskId}/move`, token, {
        method: 'POST',
        body: JSON.stringify({ columnId: target.columnId, index: target.index }),
      });
    } catch (err) {
      setBoard((b) => (b ? { ...b, columns: previous } : b));
      setError(errorMessage(err, 'No se pudo mover la tarea.'));
    }
  };

  // ------------------------------------------------------------ crear tarea
  const createTask = async (e: FormEvent, columnId: string) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || !projectId) return;
    try {
      const task = await apiFetch<Task>(`/api/projects/${projectId}/tasks`, token, {
        method: 'POST',
        body: JSON.stringify({ title, columnId }),
      });
      setBoard((b) =>
        b ? { ...b, columns: b.columns.map((c) => (c.id === columnId ? { ...c, tasks: [...c.tasks, task] } : c)) } : b,
      );
      setNewTitle('');
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo crear la tarea.'));
    }
  };

  const replaceTask = (task: Task) =>
    setBoard((b) =>
      b ? { ...b, columns: b.columns.map((c) => ({ ...c, tasks: c.tasks.map((t) => (t.id === task.id ? task : t)) })) } : b,
    );

  const removeTask = (taskId: string) =>
    setBoard((b) => (b ? { ...b, columns: b.columns.map((c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== taskId) })) } : b));

  // ------------------------------------------------------------ render
  if (projects && projects.length === 0) {
    return (
      <div className="dashboard">
        <div className="page-head">
          <div>
            <h1>Tableros</h1>
            <p className="muted">Organiza el trabajo del equipo en columnas.</p>
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
    <div className="dashboard board-page">
      <div className="page-head">
        <div>
          <h1>{board ? board.projectName : 'Tableros'}</h1>
          <p className="muted">
            {board?.canEdit === false
              ? 'Solo lectura: tu rol de observador no permite editar.'
              : 'Arrastra las tarjetas entre columnas para actualizar su estado.'}
          </p>
        </div>
        {projects && projects.length > 1 && (
          <select className="select" aria-label="Proyecto" value={projectId ?? ''}
            onChange={(e) => setParams({ proyecto: e.target.value })}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      {!board ? (
        <div className="skeleton-grid" aria-busy="true" aria-label="Cargando tablero">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      ) : (
        <div className="board" onDragEnd={() => { setDragging(null); setDropTarget(null); }}>
          {board.columns.map((column) => {
            const overLimit = column.wipLimit != null && column.tasks.length >= column.wipLimit;
            return (
              <section key={column.id} className={`board-col${dropTarget?.columnId === column.id ? ' board-col--over' : ''}`}
                aria-label={column.name}>
                <header className="board-col__head">
                  <h2>{column.name}</h2>
                  <span className={`board-col__count${overLimit ? ' board-col__count--limit' : ''}`}
                    title={column.wipLimit ? `Límite WIP: ${column.wipLimit}` : undefined}>
                    {column.tasks.length}{column.wipLimit ? ` / ${column.wipLimit}` : ''}
                  </span>
                </header>

                <div className="board-col__list" onDragOver={(e) => onDragOverColumn(e, column)} onDrop={onDrop}>
                  {column.tasks.map((task, i) => (
                    <div key={task.id}>
                      {dropTarget?.columnId === column.id && dropTarget.index === i && dragging !== task.id && (
                        <div className="board-drop" />
                      )}
                      <article data-task-id={task.id}
                        className={`task-card${dragging === task.id ? ' task-card--dragging' : ''}${task.isBlocked ? ' task-card--blocked' : ''}`}
                        draggable={board.canEdit}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', task.id);
                          setDragging(task.id);
                        }}
                        onClick={() => setEditing(task)}
                        onKeyDown={(e) => e.key === 'Enter' && setEditing(task)}
                        tabIndex={0} role="button" aria-label={`Abrir ${task.title}`}>
                        <div className="task-card__top">
                          <span className={`priority priority--${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
                          {task.isBlocked && <span className="task-card__blocked" title={task.blockedReason ?? ''}>Bloqueada</span>}
                        </div>
                        <h3 className={task.completed ? 'task-card__title--done' : undefined}>{task.title}</h3>
                        {(task.dueDate || task.assigneeIds.length > 0) && (
                          <footer className="task-card__foot">
                            <span className="muted small">
                              {task.dueDate ? dueFmt.format(new Date(`${task.dueDate}T12:00:00`)) : ''}
                            </span>
                            <div className="avatar-group">
                              {task.assigneeIds.map((id) => {
                                const m = membersById.get(id);
                                return m ? <Avatar key={id} name={m.name} src={m.avatarUrl} size={24} /> : null;
                              })}
                            </div>
                          </footer>
                        )}
                      </article>
                    </div>
                  ))}
                  {dropTarget?.columnId === column.id && dropTarget.index >= column.tasks.filter((t) => t.id !== dragging).length && (
                    <div className="board-drop" />
                  )}
                </div>

                {board.canEdit &&
                  (addingTo === column.id ? (
                    <form className="board-add" onSubmit={(e) => createTask(e, column.id)}>
                      <input autoFocus placeholder="Título de la tarea" maxLength={200} value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Escape' && setAddingTo(null)} />
                      <div className="board-add__actions">
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setAddingTo(null); setNewTitle(''); }}>
                          Cancelar
                        </button>
                        <button className="btn btn--primary btn--sm" disabled={!newTitle.trim()}>Añadir</button>
                      </div>
                    </form>
                  ) : (
                    <button type="button" className="board-col__add" onClick={() => { setAddingTo(column.id); setNewTitle(''); }}>
                      <Icon name="plus" size={16} /> Añadir tarea
                    </button>
                  ))}
              </section>
            );
          })}
        </div>
      )}

      {editing && board && (
        <TaskDialog task={editing} board={board} token={token}
          onClose={() => setEditing(null)}
          onSaved={(t) => { replaceTask(t); setEditing(null); }}
          onArchived={(id) => { removeTask(id); setEditing(null); }} />
      )}
    </div>
  );
}

interface TaskDialogProps {
  task: Task;
  board: Board;
  token: string | null;
  onClose: () => void;
  onSaved: (task: Task) => void;
  onArchived: (taskId: string) => void;
}

function TaskDialog({ task, board, token, onClose, onSaved, onArchived }: TaskDialogProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [assignees, setAssignees] = useState<string[]>(task.assigneeIds);
  const [isBlocked, setIsBlocked] = useState(task.isBlocked);
  const [blockedReason, setBlockedReason] = useState(task.blockedReason ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = !board.canEdit;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await apiFetch<Task>(`/api/tasks/${task.id}`, token, {
          method: 'PATCH',
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || null,
            priority,
            dueDate: dueDate || null,
            assigneeIds: assignees,
            isBlocked,
            blockedReason: isBlocked ? blockedReason.trim() || null : null,
          }),
        }),
      );
    } catch (err) {
      setError(errorMessage(err, 'No se pudo guardar la tarea.'));
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!window.confirm('¿Archivar esta tarea? Seguirá registrada en la bitácora.')) return;
    try {
      await apiFetch(`/api/tasks/${task.id}`, token, { method: 'DELETE' });
      onArchived(task.id);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo archivar la tarea.'));
    }
  };

  const column = board.columns.find((c) => c.id === task.columnId);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog card" onSubmit={save} role="dialog" aria-modal="true" aria-label="Editar tarea">
        <header className="card__head">
          <h2>
            <Icon name="boards" size={20} className="card__icon" /> {board.projectKey} · {column?.name}
          </h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <fieldset disabled={readOnly} className="form" style={{ border: 0, padding: 0, margin: 0 }}>
          <label className="field">
            <span>Título</span>
            <div className="input">
              <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </label>

          <label className="field">
            <span>Descripción</span>
            <textarea className="textarea" rows={4} maxLength={5000} value={description}
              placeholder="Detalles, criterios de aceptación…" onChange={(e) => setDescription(e.target.value)} />
          </label>

          <div className="dialog__row">
            <label className="field">
              <span>Prioridad</span>
              <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Fecha límite</span>
              <input className="select" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
          </div>

          <div className="field">
            <span>Responsables</span>
            <div className="chips">
              {board.members.map((m) => {
                const on = assignees.includes(m.id);
                return (
                  <button key={m.id} type="button" className={`chip${on ? ' chip--on' : ''}`} aria-pressed={on}
                    onClick={() => setAssignees((a) => (on ? a.filter((id) => id !== m.id) : [...a, m.id]))}>
                    <Avatar name={m.name} src={m.avatarUrl} size={20} /> {m.name}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="check">
            <input type="checkbox" checked={isBlocked} onChange={(e) => setIsBlocked(e.target.checked)} />
            Tarea bloqueada
          </label>
          {isBlocked && (
            <div className="input">
              <input maxLength={500} placeholder="¿Qué la bloquea?" value={blockedReason}
                onChange={(e) => setBlockedReason(e.target.value)} />
            </div>
          )}
        </fieldset>

        {error && <p className="form__error" role="alert">{error}</p>}

        {!readOnly && (
          <footer className="dialog__actions">
            <button type="button" className="btn btn--ghost btn--danger" onClick={archive}>Archivar</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn--primary" disabled={saving || !title.trim()}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </footer>
        )}
      </form>
    </div>
  );
}
