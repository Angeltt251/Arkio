import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { useProjectResource } from '@/hooks/useProjectResource';
import { apiFetch } from '@/lib/api';
import { sprintRange } from '@/lib/format';
import { connectRealtime } from '@/lib/realtime';
import { SPRINT_STATUS_LABEL, type SprintStatus } from '@/lib/scrum';

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
  labelIds: string[];
  checklistTotal: number;
  checklistDone: number;
  backlogItemId: string | null;
  backlogItemCode: string | null;
  sprintNumber: number | null;
}

interface Label {
  id: string;
  name: string;
  color: string;
}

interface ChecklistItem {
  id: string;
  content: string;
  isDone: boolean;
  position: number;
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

interface BoardSprint {
  id: string;
  number: number;
  goal: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
}

interface Board {
  projectId: string;
  projectName: string;
  projectKey: string;
  projectColor: string;
  canEdit: boolean;
  canManageColumns: boolean;
  columns: Column[];
  members: Member[];
  labels: Label[];
  sprint: BoardSprint | null;
}

const LABEL_COLORS = ['#447794', '#22A06B', '#F08A24', '#E5487D', '#2F80ED', '#8B5CF6', '#64748B'];

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

/** `/tableros?proyecto=`: el tablero vive dentro del Sprint, así que abre el del Sprint en curso. */
export function BoardRedirect() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { projects, projectId, data, error } =
    useProjectResource<{ sprints: { id: string; status: SprintStatus }[] }>((id) => `/api/projects/${id}/sprints`);

  useEffect(() => {
    if (projects && projects.length === 0) navigate('/espacios', { replace: true });
    if (!data || !projectId) return;
    const sprint = data.sprints.find((s) => s.status === 'active') ?? data.sprints.find((s) => s.status === 'planned');
    const task = params.get('tarea');
    navigate(
      sprint
        ? `/sprints/${sprint.id}/tablero?proyecto=${projectId}${task ? `&tarea=${task}` : ''}`
        : `/sprints?proyecto=${projectId}`,
      { replace: true },
    );
  }, [projects, projectId, data, params, navigate]);

  return error ? <p className="form__error" role="alert">{error}</p> : null;
}

/** Tablero de un Sprint: las columnas del proyecto con solo las tareas de ese Sprint. */
export function BoardsPage() {
  const { token } = useAuth();
  const { sprintId } = useParams();
  const [params, setParams] = useSearchParams();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ columnId: string; index: number } | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [columnEditing, setColumnEditing] = useState<Column | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const reloadTimer = useRef<number | undefined>(undefined);

  const projectId = board?.projectId ?? null;
  const sprint = board?.sprint ?? null;

  const loadBoard = useCallback(async () => {
    if (!token || !sprintId) return;
    try {
      setBoard(await apiFetch<Board>(`/api/sprints/${sprintId}/board`, token));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo cargar el tablero.'));
    }
  }, [token, sprintId]);

  useEffect(() => {
    setBoard(null);
    void loadBoard();
  }, [loadBoard]);

  // El menú lateral reconoce el proyecto por `?proyecto=`
  const urlProject = params.get('proyecto');
  useEffect(() => {
    if (!projectId || urlProject === projectId) return;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('proyecto', projectId);
      return next;
    }, { replace: true });
  }, [projectId, urlProject, setParams]);

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

  // Enlace desde una notificación: ?tarea=<id> abre esa tarjeta
  const taskParam = params.get('tarea');
  useEffect(() => {
    if (!board || !taskParam) return;
    const task = board.columns.flatMap((c) => c.tasks).find((t) => t.id === taskParam);
    if (task) setEditing(task);
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('tarea');
      return next;
    }, { replace: true });
  }, [board, taskParam, setParams]);

  const membersById = new Map(board?.members.map((m) => [m.id, m]) ?? []);
  const labelsById = new Map(board?.labels.map((l) => [l.id, l]) ?? []);

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
        body: JSON.stringify({
          title, columnId, description: newDescription.trim() || null, priority: newPriority, sprintId: sprint?.id ?? null,
        }),
      });
      setBoard((b) =>
        b ? { ...b, columns: b.columns.map((c) => (c.id === columnId ? { ...c, tasks: [...c.tasks, task] } : c)) } : b,
      );
      setNewTitle('');
      setNewDescription('');
      setNewPriority('medium');
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo crear la tarea.'));
    }
  };

  const createColumn = async (e: FormEvent) => {
    e.preventDefault();
    const name = newColumnName.trim();
    if (!name || !projectId) return;
    try {
      const column = await apiFetch<Column>(`/api/projects/${projectId}/columns`, token, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setBoard((b) => (b ? { ...b, columns: [...b.columns, column] } : b));
      setNewColumnName('');
      setAddingColumn(false);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo crear la columna.'));
    }
  };

  const replaceTask = (task: Task) =>
    setBoard((b) =>
      b ? { ...b, columns: b.columns.map((c) => ({ ...c, tasks: c.tasks.map((t) => (t.id === task.id ? task : t)) })) } : b,
    );

  const removeTask = (taskId: string) =>
    setBoard((b) => (b ? { ...b, columns: b.columns.map((c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== taskId) })) } : b));

  // ------------------------------------------------------------ render
  return (
    <div className="dashboard board-page">
      <div className="page-head">
        <div>
          <Link to={`/sprints${projectId ? `?proyecto=${projectId}` : ''}`} className="back-link muted small">
            <Icon name="arrowRight" size={14} className="back-link__icon" /> Sprints
          </Link>
          <h1>
            {sprint ? `Tablero del Sprint #${sprint.number}` : 'Tablero del Sprint'}
            {sprint && (
              <span className={`pill pill--${sprint.status === 'active' ? 'active' : sprint.status === 'planned' ? 'sprint-planned' : 'closed'}`}>
                <span className="dot" /> {SPRINT_STATUS_LABEL[sprint.status]}
              </span>
            )}
          </h1>
          {sprint && (
            <p className="muted">
              <strong>Sprint Goal:</strong> {sprint.goal} · {sprintRange(sprint.startDate, sprint.endDate)}
            </p>
          )}
          <p className="muted small">
            {board?.canEdit === false
              ? sprint && !['planned', 'active'].includes(sprint.status)
                ? 'Sprint terminado: el tablero queda como registro de solo lectura.'
                : 'Solo lectura: tu rol de observador no permite editar.'
              : 'Arrastra las tarjetas entre columnas para actualizar su estado.'}
          </p>
        </div>
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
                  <h2>
                    {column.name}
                    {column.isDone && <span className="board-col__done" title="Las tareas aquí cuentan como terminadas">✓</span>}
                  </h2>
                  <div className="board-col__tools">
                    <span className={`board-col__count${overLimit ? ' board-col__count--limit' : ''}`}
                      title={column.wipLimit ? `Límite WIP: ${column.wipLimit}` : undefined}>
                      {column.tasks.length}{column.wipLimit ? ` / ${column.wipLimit}` : ''}
                    </span>
                    {board.canManageColumns && (
                      <button type="button" className="board-col__menu" aria-label={`Opciones de la columna ${column.name}`}
                        title="Opciones de la columna" onClick={() => setColumnEditing(column)}>
                        ⋯
                      </button>
                    )}
                  </div>
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
                          {task.backlogItemCode && (
                            <span className="task-card__pbi" title={task.sprintNumber ? `Sprint #${task.sprintNumber}` : undefined}>
                              {task.backlogItemCode}
                            </span>
                          )}
                        </div>
                        {task.labelIds.length > 0 && (
                          <div className="task-card__labels">
                            {task.labelIds.map((id) => {
                              const label = labelsById.get(id);
                              return label ? <LabelTag key={id} label={label} /> : null;
                            })}
                          </div>
                        )}
                        <h3 className={task.completed ? 'task-card__title--done' : undefined}>{task.title}</h3>
                        {task.description && <p className="task-card__desc">{task.description}</p>}
                        {(task.dueDate || task.assigneeIds.length > 0 || task.checklistTotal > 0) && (
                          <footer className="task-card__foot">
                            <span className="muted small task-card__info">
                              {task.dueDate ? dueFmt.format(new Date(`${task.dueDate}T12:00:00`)) : ''}
                              {task.checklistTotal > 0 && (
                                <span className={task.checklistDone === task.checklistTotal ? 'task-card__check--done' : undefined}
                                  title="Checklist">
                                  <Icon name="check" size={13} /> {task.checklistDone}/{task.checklistTotal}
                                </span>
                              )}
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
                      <textarea className="textarea" rows={2} maxLength={5000} placeholder="Descripción (opcional)"
                        value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
                      <select className="select" aria-label="Prioridad" value={newPriority}
                        onChange={(e) => setNewPriority(e.target.value as Priority)}>
                        {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>Prioridad {label.toLowerCase()}</option>
                        ))}
                      </select>
                      <div className="board-add__actions">
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setAddingTo(null); setNewTitle(''); }}>
                          Cancelar
                        </button>
                        <button className="btn btn--primary btn--sm" disabled={!newTitle.trim()}>Añadir</button>
                      </div>
                    </form>
                  ) : (
                    <button type="button" className="board-col__add"
                      onClick={() => { setAddingTo(column.id); setNewTitle(''); setNewDescription(''); setNewPriority('medium'); }}>
                      <Icon name="plus" size={16} /> Añadir tarea
                    </button>
                  ))}
              </section>
            );
          })}

          {board.canManageColumns && (
            <section className="board-col board-col--new" aria-label="Nueva columna">
              {addingColumn ? (
                <form className="board-add" onSubmit={createColumn}>
                  <input autoFocus placeholder="Nombre de la columna" maxLength={60} value={newColumnName}
                    onChange={(e) => setNewColumnName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setAddingColumn(false)} />
                  <div className="board-add__actions">
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setAddingColumn(false); setNewColumnName(''); }}>
                      Cancelar
                    </button>
                    <button className="btn btn--primary btn--sm" disabled={!newColumnName.trim()}>Crear columna</button>
                  </div>
                </form>
              ) : (
                <button type="button" className="board-col__add" onClick={() => setAddingColumn(true)}>
                  <Icon name="plus" size={16} /> Añadir columna
                </button>
              )}
            </section>
          )}
        </div>
      )}

      {columnEditing && board && (
        <ColumnDialog column={columnEditing} board={board} token={token}
          onClose={() => setColumnEditing(null)}
          onChanged={() => { setColumnEditing(null); void loadBoard(); }}
          onDeleted={() => { setColumnEditing(null); void loadBoard(); }} />
      )}

      {editing && board && (
        <TaskDialog task={editing} board={board} token={token}
          onClose={() => setEditing(null)}
          onSaved={(t) => { replaceTask(t); setEditing(null); }}
          onLabelCreated={(label) => setBoard((b) => (b ? { ...b, labels: [...b.labels, label].sort((x, y) => x.name.localeCompare(y.name)) } : b))}
          onChecklistChanged={(id, total, done) => {
            setBoard((b) => b && {
              ...b,
              columns: b.columns.map((c) => ({ ...c, tasks: c.tasks.map((t) => (t.id === id ? { ...t, checklistTotal: total, checklistDone: done } : t)) })),
            });
          }}
          onMoved={(id, columnId) =>
            setBoard((b) => (b ? { ...b, columns: moveLocally(b.columns, id, columnId, Number.MAX_SAFE_INTEGER) } : b))}
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
  onMoved: (taskId: string, columnId: string) => void;
  onLabelCreated: (label: Label) => void;
  onChecklistChanged: (taskId: string, total: number, done: number) => void;
}

interface PbiOption {
  id: string;
  code: string;
  title: string;
  archived: boolean;
}

function LabelTag({ label }: { label: Label }) {
  return (
    <span className="label-tag" style={{ ['--label' as string]: label.color }}>
      <span className="label-tag__dot" aria-hidden="true" /> {label.name}
    </span>
  );
}

function TaskDialog({ task, board, token, onClose, onSaved, onArchived, onMoved, onLabelCreated, onChecklistChanged }: TaskDialogProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [assignees, setAssignees] = useState<string[]>(task.assigneeIds);
  const [isBlocked, setIsBlocked] = useState(task.isBlocked);
  const [blockedReason, setBlockedReason] = useState(task.blockedReason ?? '');
  const [columnId, setColumnId] = useState(task.columnId);
  const [labelIds, setLabelIds] = useState<string[]>(task.labelIds);
  const [newLabel, setNewLabel] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(LABEL_COLORS[0]);
  const [backlogItemId, setBacklogItemId] = useState(task.backlogItemId ?? '');
  const [pbis, setPbis] = useState<PbiOption[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [newItem, setNewItem] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = !board.canEdit;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    apiFetch<ChecklistItem[]>(`/api/tasks/${task.id}/checklist`, token)
      .then(setChecklist)
      .catch(() => setChecklist([]));
    apiFetch<{ items: PbiOption[] }>(`/api/projects/${board.projectId}/backlog`, token)
      .then((b) => setPbis(b.items))
      .catch(() => setPbis([]));
  }, [task.id, board.projectId, token]);

  const updateChecklist = (items: ChecklistItem[]) => {
    setChecklist(items);
    onChecklistChanged(task.id, items.length, items.filter((i) => i.isDone).length);
  };

  const addItem = async () => {
    const content = newItem.trim();
    if (!content || !checklist) return;
    try {
      const item = await apiFetch<ChecklistItem>(`/api/tasks/${task.id}/checklist`, token, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      updateChecklist([...checklist, item]);
      setNewItem('');
    } catch (err) {
      setError(errorMessage(err, 'No se pudo agregar el elemento.'));
    }
  };

  const toggleItem = async (item: ChecklistItem) => {
    if (!checklist) return;
    try {
      const updated = await apiFetch<ChecklistItem>(`/api/checklist/${item.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ isDone: !item.isDone }),
      });
      updateChecklist(checklist.map((i) => (i.id === updated.id ? updated : i)));
    } catch (err) {
      setError(errorMessage(err, 'No se pudo actualizar el checklist.'));
    }
  };

  const removeItem = async (item: ChecklistItem) => {
    if (!checklist) return;
    try {
      await apiFetch(`/api/checklist/${item.id}`, token, { method: 'DELETE' });
      updateChecklist(checklist.filter((i) => i.id !== item.id));
    } catch (err) {
      setError(errorMessage(err, 'No se pudo quitar el elemento.'));
    }
  };

  const createLabel = async () => {
    const name = newLabel.trim();
    if (!name) return;
    try {
      const label = await apiFetch<Label>(`/api/projects/${board.projectId}/labels`, token, {
        method: 'POST',
        body: JSON.stringify({ name, color: newLabelColor }),
      });
      onLabelCreated(label);
      setLabelIds((ids) => [...ids, label.id]);
      setNewLabel('');
    } catch (err) {
      setError(errorMessage(err, 'No se pudo crear la etiqueta.'));
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (columnId !== task.columnId) {
        const target = board.columns.find((c) => c.id === columnId);
        await apiFetch(`/api/tasks/${task.id}/move`, token, {
          method: 'POST',
          body: JSON.stringify({ columnId, index: target?.tasks.length ?? 0 }),
        });
        onMoved(task.id, columnId);
      }
      onSaved(
        await apiFetch<Task>(`/api/tasks/${task.id}`, token, {
          method: 'PATCH',
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || null,
            priority,
            dueDate: dueDate || null,
            assigneeIds: assignees,
            labelIds,
            backlogItemId: backlogItemId || null,
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

          <label className="field">
            <span>Estado (columna)</span>
            <select className="select" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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

          <label className="field">
            <span>PBI asociado</span>
            <select className="select" value={backlogItemId} onChange={(e) => setBacklogItemId(e.target.value)}>
              <option value="">Sin PBI</option>
              {pbis.filter((p) => !p.archived || p.id === backlogItemId).map((p) => (
                <option key={p.id} value={p.id}>{p.code} · {p.title}</option>
              ))}
            </select>
          </label>

          <div className="field">
            <span>Etiquetas</span>
            <div className="chips">
              {board.labels.map((label) => {
                const on = labelIds.includes(label.id);
                return (
                  <button key={label.id} type="button" className={`chip chip--plain${on ? ' chip--on' : ''}`} aria-pressed={on}
                    onClick={() => setLabelIds((ids) => (on ? ids.filter((id) => id !== label.id) : [...ids, label.id]))}>
                    <LabelTag label={label} />
                  </button>
                );
              })}
            </div>
            <div className="label-new">
              <div className="input">
                <input maxLength={30} placeholder="Nueva etiqueta" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createLabel(); } }} />
              </div>
              <div className="label-new__colors" role="radiogroup" aria-label="Color de la etiqueta">
                {LABEL_COLORS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={newLabelColor === c} aria-label={`Color ${c}`}
                    className={`label-swatch${newLabelColor === c ? ' label-swatch--on' : ''}`} style={{ background: c }}
                    onClick={() => setNewLabelColor(c)} />
                ))}
              </div>
              <button type="button" className="btn btn--ghost btn--sm" disabled={!newLabel.trim()} onClick={() => void createLabel()}>
                Crear
              </button>
            </div>
          </div>

          <div className="field">
            <span className="field__row">
              Checklist
              {checklist && checklist.length > 0 && (
                <span className="muted small">{checklist.filter((i) => i.isDone).length}/{checklist.length}</span>
              )}
            </span>
            {checklist === null ? (
              <p className="muted small" style={{ margin: 0 }}>Cargando…</p>
            ) : (
              <ul className="checklist">
                {checklist.map((item) => (
                  <li key={item.id}>
                    <label className="check">
                      <input type="checkbox" checked={item.isDone} onChange={() => void toggleItem(item)} />
                      <span className={item.isDone ? 'task-card__title--done' : undefined}>{item.content}</span>
                    </label>
                    {!readOnly && (
                      <button type="button" className="icon-btn icon-btn--sm" aria-label={`Quitar ${item.content}`}
                        onClick={() => void removeItem(item)}>
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!readOnly && (
              <div className="label-new">
                <div className="input">
                  <input maxLength={300} placeholder="Agregar elemento" value={newItem} onChange={(e) => setNewItem(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addItem(); } }} />
                </div>
                <button type="button" className="btn btn--ghost btn--sm" disabled={!newItem.trim()} onClick={() => void addItem()}>
                  Agregar
                </button>
              </div>
            )}
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

// ------------------------------------------------------------ opciones de columna
interface ColumnDialogProps {
  column: Column;
  board: Board;
  token: string | null;
  onClose: () => void;
  onChanged: (columns: Column[]) => void;
  onDeleted: () => void;
}

function ColumnDialog({ column, board, token, onClose, onChanged, onDeleted }: ColumnDialogProps) {
  const [name, setName] = useState(column.name);
  const [wipLimit, setWipLimit] = useState(column.wipLimit ? String(column.wipLimit) : '');
  const [isDone, setIsDone] = useState(column.isDone);
  const [moveTo, setMoveTo] = useState(board.columns.find((c) => c.id !== column.id)?.id ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const index = board.columns.findIndex((c) => c.id === column.id);
  const others = board.columns.filter((c) => c.id !== column.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err, fallback));
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const limit = wipLimit.trim() ? Number(wipLimit) : null;
      const updated = await apiFetch<Column>(`/api/columns/${column.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), wipLimit: limit, isDone }),
      });
      onChanged(board.columns.map((c) => (c.id === updated.id ? updated : c)));
    }, 'No se pudo guardar la columna.');
  };

  const move = (to: number) =>
    run(async () => {
      onChanged(await apiFetch<Column[]>(`/api/columns/${column.id}/move`, token, {
        method: 'POST',
        body: JSON.stringify({ index: to }),
      }));
    }, 'No se pudo mover la columna.');

  const remove = () =>
    run(async () => {
      const query = column.tasks.length ? `?move_to=${moveTo}` : '';
      await apiFetch(`/api/columns/${column.id}${query}`, token, { method: 'DELETE' });
      onDeleted();
    }, 'No se pudo eliminar la columna.');

  const wipValid = !wipLimit.trim() || (/^\d+$/.test(wipLimit.trim()) && Number(wipLimit) >= 1);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog card" onSubmit={save} role="dialog" aria-modal="true" aria-label="Opciones de la columna">
        <header className="card__head">
          <h2><Icon name="boards" size={20} className="card__icon" /> Columna «{column.name}»</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="form" style={{ marginTop: 0 }}>
          <label className="field">
            <span>Nombre</span>
            <div className="input">
              <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </label>

          <label className="field">
            <span className="field__row">
              Límite WIP <span className="muted small">Máximo de tareas a la vez (vacío = sin límite)</span>
            </span>
            <div className="input">
              <input inputMode="numeric" placeholder="Sin límite" value={wipLimit}
                onChange={(e) => setWipLimit(e.target.value.replace(/[^0-9]/g, ''))} />
            </div>
          </label>

          <label className="check">
            <input type="checkbox" checked={isDone} onChange={(e) => setIsDone(e.target.checked)} />
            Las tareas en esta columna cuentan como terminadas
          </label>

          <div className="field">
            <span>Posición</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy || index === 0} onClick={() => move(index - 1)}>
                ← Mover a la izquierda
              </button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy || index === board.columns.length - 1}
                onClick={() => move(index + 1)}>
                Mover a la derecha →
              </button>
            </div>
          </div>
        </div>

        {error && <p className="form__error" role="alert">{error}</p>}

        <footer className="dialog__actions">
          <button type="button" className="btn btn--ghost btn--danger" disabled={busy || others.length === 0}
            title={others.length === 0 ? 'El tablero debe tener al menos una columna' : undefined}
            onClick={() => setConfirmDelete(true)}>
            Eliminar columna
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !name.trim() || !wipValid}>Guardar</button>
        </footer>

        {confirmDelete && (
          <div className="column-delete" role="alertdialog" aria-label="Confirmar eliminación">
            <p className="small">
              {column.tasks.length
                ? <>Esta columna tiene <strong>{column.tasks.length}</strong> {column.tasks.length === 1 ? 'tarea' : 'tareas'}. ¿A qué columna las movemos?</>
                : <>¿Eliminar la columna «{column.name}»? Quedará registrado en la bitácora.</>}
            </p>
            {column.tasks.length > 0 && (
              <select className="select" aria-label="Mover tareas a" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <div className="board-add__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmDelete(false)}>No, volver</button>
              <button type="button" className="btn btn--primary btn--sm btn--danger-solid" disabled={busy} onClick={remove}>
                Sí, eliminar
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
