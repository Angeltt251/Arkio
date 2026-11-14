import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { ProjectSelect } from '@/components/ui/ProjectSelect';
import { useEscape, useProjectResource } from '@/hooks/useProjectResource';
import { apiFetch, errorMessage } from '@/lib/api';
import { sprintRange } from '@/lib/format';
import {
  PBI_STATUS_LABEL,
  SPRINT_STATUS_LABEL,
  addDays,
  daysBetween,
  formatDate,
  isoDate,
  type Member,
  type Pbi,
  type PbiStatus,
  type ProjectHeader,
  type SprintStatus,
} from '@/lib/scrum';

interface SprintPbi {
  id: string;
  code: string;
  title: string;
  estimate: number | null;
  status: PbiStatus;
  taskCount: number;
  tasksDone: number;
}

interface Sprint {
  id: string;
  number: number;
  goal: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  closeReason: string | null;
  closedAt: string | null;
  items: SprintPbi[];
  pointsTotal: number;
  pointsDone: number;
  taskCount: number;
  tasksDone: number;
}

interface SprintsData extends ProjectHeader {
  sprints: Sprint[];
  candidates: Pbi[];
  velocity: number | null;
  members: Member[];
}

const WEEK_OPTIONS = [1, 2, 3, 4];
const STATUS_PILL: Record<SprintStatus, string> = {
  planned: 'pill--sprint-planned',
  active: 'pill--active',
  closed: 'pill--closed',
  cancelled: 'pill--paused',
};

export function SprintsPage() {
  const { token, projects, projectId, selectProject, data, error, reload } =
    useProjectResource<SprintsData>((id) => `/api/projects/${id}/sprints`);
  const [planning, setPlanning] = useState(false);
  const [closing, setClosing] = useState<Sprint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const open = data?.sprints.filter((s) => s.status === 'active' || s.status === 'planned') ?? [];
  const history = data?.sprints.filter((s) => s.status === 'closed' || s.status === 'cancelled') ?? [];
  const hasActive = open.some((s) => s.status === 'active');

  const start = async (sprint: Sprint) => {
    setBusy(sprint.id);
    setActionError(null);
    try {
      await apiFetch(`/api/sprints/${sprint.id}/start`, token, { method: 'POST' });
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, 'No se pudo iniciar el Sprint.'));
    } finally {
      setBusy(null);
    }
  };

  if (projects && projects.length === 0) {
    return (
      <div className="dashboard">
        <div className="page-head"><div><h1>Sprints</h1></div></div>
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
          <h1>Sprints</h1>
          <p className="muted">Sprint Planning: duración, PBIs seleccionados y un Sprint Goal claro.</p>
        </div>
        <div className="page-head__actions">
          <ProjectSelect projects={projects} value={projectId} onChange={selectProject} />
          {data?.canEdit && (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setPlanning(true)}>
              <Icon name="plus" size={16} /> Planificar Sprint
            </button>
          )}
        </div>
      </div>

      {(error || actionError) && <p className="form__error" role="alert">{actionError ?? error}</p>}

      {!data ? (
        <div className="skeleton-grid" aria-busy="true" aria-label="Cargando sprints">
          {Array.from({ length: 2 }, (_, i) => <div key={i} className="skeleton" />)}
        </div>
      ) : (
        <>
          {open.length === 0 && (
            <div className="empty card">
              <p>No hay un Sprint en curso.</p>
              <p className="muted small">
                {data.candidates.length
                  ? `Hay ${data.candidates.length} PBIs disponibles en el backlog para planificar.`
                  : 'Primero agrega elementos al Product Backlog.'}
              </p>
              {!data.candidates.length && (
                <Link to={`/backlog?proyecto=${data.projectId}`} className="btn btn--ghost btn--sm" style={{ justifySelf: 'center' }}>
                  Ir al Product Backlog
                </Link>
              )}
            </div>
          )}

          {open.map((sprint) => (
            <SprintCard key={sprint.id} sprint={sprint}>
              {data.canManage && (
                <div className="sprint-box__actions">
                  {sprint.status === 'planned' && (
                    <button type="button" className="btn btn--primary btn--sm" disabled={busy === sprint.id || hasActive}
                      title={hasActive ? 'Cierra el Sprint en curso antes de iniciar otro' : undefined}
                      onClick={() => void start(sprint)}>
                      Iniciar Sprint
                    </button>
                  )}
                  <Link to={`/tableros?proyecto=${data.projectId}`} className="btn btn--ghost btn--sm">Ver tablero</Link>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setClosing(sprint)}>
                    {sprint.status === 'planned' ? 'Cancelar' : 'Cerrar Sprint'}
                  </button>
                </div>
              )}
            </SprintCard>
          ))}

          {history.length > 0 && (
            <>
              <h2 className="section-title">Historial</h2>
              {history.map((sprint) => <SprintCard key={sprint.id} sprint={sprint} compact />)}
            </>
          )}
        </>
      )}

      {planning && data && projectId && (
        <PlanningDialog data={data} projectId={projectId} token={token} hasActive={hasActive}
          onClose={() => setPlanning(false)}
          onCreated={() => { setPlanning(false); void reload(); }} />
      )}
      {closing && (
        <CloseDialog sprint={closing} token={token} onClose={() => setClosing(null)}
          onClosed={() => { setClosing(null); void reload(); }} />
      )}
    </div>
  );
}

function SprintCard({ sprint, compact = false, children }: { sprint: Sprint; compact?: boolean; children?: React.ReactNode }) {
  const percent = sprint.taskCount ? Math.round((sprint.tasksDone * 100) / sprint.taskCount) : 0;
  return (
    <section className={`card sprint-box${compact ? ' sprint-box--compact' : ''}`}>
      <header className="card__head">
        <h2>
          <Icon name="rocket" size={20} className="card__icon" /> Sprint #{sprint.number}
          <span className={`pill ${STATUS_PILL[sprint.status]}`}><span className="dot" /> {SPRINT_STATUS_LABEL[sprint.status]}</span>
        </h2>
        <span className="muted small">{sprintRange(sprint.startDate, sprint.endDate)}</span>
      </header>
      <p className="sprint-box__goal"><strong>Sprint Goal:</strong> {sprint.goal}</p>
      {sprint.closeReason && <p className="muted small">Motivo: {sprint.closeReason}</p>}

      <div className="progress" aria-label="Avance de tareas">
        <div className="progress__track"><div className="progress__bar" style={{ width: `${percent}%` }} /></div>
        <span>{sprint.tasksDone}/{sprint.taskCount} tareas · {sprint.pointsDone}/{sprint.pointsTotal} pts</span>
      </div>

      {!compact && (
        <ul className="sprint-box__items">
          {sprint.items.map((i) => (
            <li key={i.id}>
              <span className="pbi-row__code">{i.code}</span>
              <span className="sprint-box__title">{i.title}</span>
              <span className="muted small">{i.tasksDone}/{i.taskCount} tareas</span>
              <span className={`pill pbi-status pbi-status--${i.status}`}>{PBI_STATUS_LABEL[i.status]}</span>
              <span className="pbi-row__estimate">{i.estimate ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
      {children}
    </section>
  );
}

// ------------------------------------------------------------ Sprint Planning
interface PlanningDialogProps {
  data: SprintsData;
  projectId: string;
  token: string | null;
  hasActive: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function PlanningDialog({ data, projectId, token, hasActive, onClose, onCreated }: PlanningDialogProps) {
  const today = isoDate(new Date());
  const [weeks, setWeeks] = useState<number | null>(2);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 13));
  const [goal, setGoal] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [plan, setPlan] = useState('');
  const [attendees, setAttendees] = useState<string[]>(data.members.map((m) => m.id));
  const [createTasks, setCreateTasks] = useState(true);
  const [startNow, setStartNow] = useState(!hasActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const chosen = data.candidates.filter((c) => selected.includes(c.id));
  const points = chosen.reduce((sum, c) => sum + (c.estimate ?? 0), 0);
  const unestimated = chosen.filter((c) => c.estimate == null);
  const unrefined = chosen.filter((c) => c.status === 'new');
  const pendingParents = chosen.filter((c) => c.parentId && !selected.includes(c.parentId) && c.parentCode);
  const length = daysBetween(startDate, endDate) + 1;
  const datesValid = !!startDate && !!endDate && length >= 1 && length <= 32;

  const pickWeeks = (w: number) => {
    setWeeks(w);
    setEndDate(addDays(startDate, w * 7 - 1));
  };

  const changeStart = (value: string) => {
    setStartDate(value);
    if (value && weeks) setEndDate(addDays(value, weeks * 7 - 1));
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${projectId}/sprints`, token, {
        method: 'POST',
        body: JSON.stringify({
          goal: goal.trim(), startDate, endDate, itemIds: selected, startNow: startNow && !hasActive,
          createTasks, plan: plan.trim() || null, attendeeIds: attendees,
        }),
      });
      onCreated();
    } catch (err) {
      setError(errorMessage(err, 'No se pudo crear el Sprint.'));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog dialog--wide card" onSubmit={submit} role="dialog" aria-modal="true" aria-label="Sprint Planning">
        <header className="card__head">
          <h2><Icon name="rocket" size={20} className="card__icon" /> Sprint Planning</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="form" style={{ marginTop: 0 }}>
          <div className="field">
            <span className="field__row">1. Duración <span className="muted small">Scrum recomienda un mes o menos, fija y consistente</span></span>
            <div className="chips">
              {WEEK_OPTIONS.map((w) => (
                <button key={w} type="button" className={`chip chip--plain${weeks === w ? ' chip--on' : ''}`} aria-pressed={weeks === w}
                  onClick={() => pickWeeks(w)}>
                  {w} {w === 1 ? 'semana' : 'semanas'}
                </button>
              ))}
            </div>
            <div className="dialog__row">
              <label className="field">
                <span className="small">Inicio</span>
                <input className="select" type="date" required value={startDate} onChange={(e) => changeStart(e.target.value)} />
              </label>
              <label className="field">
                <span className="small">Término</span>
                <input className="select" type="date" required min={startDate} value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); setWeeks(null); }} />
              </label>
            </div>
            {!datesValid && <p className="form__error">El Sprint debe durar entre 1 día y un mes.</p>}
          </div>

          <div className="field">
            <span className="field__row">
              2. PBIs seleccionados
              <span className="muted small">
                {chosen.length} · {points} pts{data.velocity != null ? ` · velocidad promedio ${data.velocity} pts` : ''}
              </span>
            </span>
            {data.candidates.length === 0 ? (
              <p className="muted small">No hay PBIs disponibles. Agrégalos primero en el Product Backlog.</p>
            ) : (
              <ul className="pick-list">
                {data.candidates.map((c) => (
                  <li key={c.id}>
                    <label className="check">
                      <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                      <span className="pbi-row__code">{c.code}</span>
                      <span className="pick-list__title">{c.title}</span>
                      <span className={`pill pbi-status pbi-status--${c.status}`}>{PBI_STATUS_LABEL[c.status]}</span>
                      <span className="pbi-row__estimate">{c.estimate ?? '—'}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {(unestimated.length > 0 || unrefined.length > 0 || pendingParents.length > 0 ||
              (data.velocity != null && points > data.velocity * 1.2)) && (
              <ul className="notice notice--compact planning-warnings">
                {data.velocity != null && points > data.velocity * 1.2 && (
                  <li>Seleccionaste {points} pts y el equipo suele terminar ~{data.velocity}. Revisen la capacidad.</li>
                )}
                {unestimated.length > 0 && <li>Sin estimar: {unestimated.map((c) => c.code).join(', ')}.</li>}
                {unrefined.length > 0 && <li>Aún sin refinar: {unrefined.map((c) => c.code).join(', ')}.</li>}
                {pendingParents.length > 0 && (
                  <li>Derivados de otro PBI: {pendingParents.map((c) => `${c.code} (de ${c.parentCode})`).join(', ')}. Revisen dependencias.</li>
                )}
              </ul>
            )}
          </div>

          <label className="field">
            <span className="field__row">3. Sprint Goal <span className="muted small">Por qué vale la pena este Sprint, en lenguaje claro</span></span>
            <textarea className="textarea" rows={2} required minLength={5} maxLength={500} value={goal}
              placeholder="Ej: Los usuarios pueden registrarse e iniciar sesión de forma segura"
              onChange={(e) => setGoal(e.target.value)} />
          </label>

          <label className="field">
            <span className="field__row">4. Plan de los Developers <span className="muted small">Opcional</span></span>
            <textarea className="textarea" rows={3} maxLength={5000} value={plan}
              placeholder="Cómo se descompone el trabajo y quién parte con qué…" onChange={(e) => setPlan(e.target.value)} />
          </label>

          {data.members.length > 0 && (
            <div className="field">
              <span>Participantes</span>
              <div className="chips">
                {data.members.map((m) => {
                  const on = attendees.includes(m.id);
                  return (
                    <button key={m.id} type="button" className={`chip${on ? ' chip--on' : ''}`} aria-pressed={on}
                      onClick={() => setAttendees((a) => (on ? a.filter((id) => id !== m.id) : [...a, m.id]))}>
                      <Avatar name={m.name} src={m.avatarUrl} size={20} /> {m.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label className="check">
            <input type="checkbox" checked={createTasks} onChange={(e) => setCreateTasks(e.target.checked)} />
            Crear una tarjeta en el tablero por cada PBI (los Developers la descomponen en tareas)
          </label>
          <label className="check">
            <input type="checkbox" checked={startNow && !hasActive} disabled={hasActive} onChange={(e) => setStartNow(e.target.checked)} />
            {hasActive ? 'Ya hay un Sprint en curso: este quedará planificado' : 'Iniciar el Sprint ahora'}
          </label>
        </div>

        {error && <p className="form__error" role="alert">{error}</p>}

        <footer className="dialog__actions">
          <span className="muted small">{datesValid ? `${formatDate(startDate)} → ${formatDate(endDate)} (${length} días)` : ''}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !datesValid || selected.length === 0 || goal.trim().length < 5}>
            {busy ? 'Creando…' : 'Confirmar Sprint'}
          </button>
        </footer>
      </form>
    </div>
  );
}

// ------------------------------------------------------------ cerrar / cancelar
function CloseDialog({ sprint, token, onClose, onClosed }: {
  sprint: Sprint;
  token: string | null;
  onClose: () => void;
  onClosed: () => void;
}) {
  const [outcome, setOutcome] = useState<'closed' | 'cancelled'>(sprint.status === 'planned' ? 'cancelled' : 'closed');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const pending = sprint.items.filter((i) => i.taskCount === 0 || i.tasksDone < i.taskCount);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sprints/${sprint.id}/close`, token, {
        method: 'POST',
        body: JSON.stringify({ outcome, reason: reason.trim() || null }),
      });
      onClosed();
    } catch (err) {
      setError(errorMessage(err, 'No se pudo cerrar el Sprint.'));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog card" onSubmit={submit} role="dialog" aria-modal="true" aria-label={`Cerrar Sprint #${sprint.number}`}>
        <header className="card__head">
          <h2><Icon name="rocket" size={20} className="card__icon" /> Sprint #{sprint.number}</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="form" style={{ marginTop: 0 }}>
          {sprint.status === 'active' && (
            <label className="check">
              <input type="radio" name="outcome" checked={outcome === 'closed'} onChange={() => setOutcome('closed')} />
              Cerrar: el Sprint terminó
            </label>
          )}
          <label className="check">
            <input type="radio" name="outcome" checked={outcome === 'cancelled'} onChange={() => setOutcome('cancelled')} />
            Cancelar: el Sprint Goal quedó obsoleto
          </label>
          <label className="field">
            <span>Motivo {outcome === 'cancelled' ? '(obligatorio)' : '(opcional)'}</span>
            <textarea className="textarea" rows={3} maxLength={1000} required={outcome === 'cancelled'} value={reason}
              onChange={(e) => setReason(e.target.value)} />
          </label>
          <p className="notice notice--compact">
            {outcome === 'closed' && pending.length > 0
              ? `${pending.length} PBI${pending.length === 1 ? '' : 's'} con tareas pendientes ${pending.length === 1 ? 'vuelve' : 'vuelven'} al Product Backlog como «Listo». `
              : outcome === 'closed' ? 'Todos los PBIs quedarán como «Terminado». ' : 'Los PBIs vuelven al Product Backlog como «Listo». '}
            El Sprint no se borra: su historia queda en la bitácora.
          </p>
        </div>
        {error && <p className="form__error" role="alert">{error}</p>}
        <footer className="dialog__actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost" onClick={onClose}>Volver</button>
          <button className="btn btn--primary" disabled={busy || (outcome === 'cancelled' && !reason.trim())}>
            {outcome === 'closed' ? 'Cerrar Sprint' : 'Cancelar Sprint'}
          </button>
        </footer>
      </form>
    </div>
  );
}
