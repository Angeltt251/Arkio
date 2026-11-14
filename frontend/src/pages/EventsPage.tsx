import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { ProjectSelect } from '@/components/ui/ProjectSelect';
import { useEscape, useProjectResource } from '@/hooks/useProjectResource';
import { apiFetch, errorMessage } from '@/lib/api';
import {
  ACTION_STATUS_LABEL,
  EVENT_LABEL,
  formatDateTime,
  localDateTimeInput,
  type ActionStatus,
  type EventType,
  type Member,
  type ProjectHeader,
  type SprintStatus,
} from '@/lib/scrum';

interface RetroAction {
  id: string;
  description: string;
  ownerId: string | null;
  dueDate: string | null;
  status: ActionStatus;
}

interface ScrumEvent {
  id: string;
  sprintId: string;
  sprintNumber: number;
  type: EventType;
  heldAt: string;
  durationMinutes: number | null;
  notes: string | null;
  agreements: string | null;
  data: Record<string, string>;
  attendeeIds: string[];
  actions: RetroAction[];
  createdByName: string | null;
}

interface EventSprint {
  id: string;
  number: number;
  goal: string;
  status: SprintStatus;
}

interface EventsData extends ProjectHeader {
  sprints: EventSprint[];
  members: Member[];
  events: ScrumEvent[];
}

/** Datos propios de cada evento (sección 7.6 de la especificación). */
const EVENT_FIELDS: Record<EventType, { key: string; label: string; placeholder?: string }[]> = {
  sprint_planning: [
    { key: 'product_goal', label: 'Product Goal relacionado' },
    { key: 'sprint_goal', label: 'Sprint Goal' },
    { key: 'pbis', label: 'PBIs seleccionados' },
    { key: 'plan', label: 'Plan', placeholder: 'Cómo se hará el trabajo' },
  ],
  daily_scrum: [
    { key: 'progress', label: 'Progreso hacia el Sprint Goal' },
    { key: 'next_plan', label: 'Plan hasta la próxima Daily' },
    { key: 'blockers', label: 'Bloqueos', placeholder: 'Impedimentos que el equipo necesita resolver' },
  ],
  sprint_review: [
    { key: 'increment', label: 'Incremento inspeccionado' },
    { key: 'feedback', label: 'Feedback de los interesados' },
    { key: 'backlog_changes', label: 'Cambios al Product Backlog' },
  ],
  sprint_retrospective: [
    { key: 'went_well', label: 'Qué funcionó' },
    { key: 'difficulties', label: 'Dificultades' },
    { key: 'causes', label: 'Causas' },
  ],
};

const DEFAULT_DURATION: Record<EventType, number> = {
  sprint_planning: 120,
  daily_scrum: 15,
  sprint_review: 60,
  sprint_retrospective: 60,
};

const EVENT_HINT: Record<EventType, string> = {
  sprint_planning: 'Define por qué, qué y cómo del Sprint.',
  daily_scrum: 'Evento de 15 minutos para los Developers. No es un reporte de desempeño individual.',
  sprint_review: 'Se inspecciona el incremento con los interesados y se adapta el Product Backlog.',
  sprint_retrospective: 'El equipo busca formas de mejorar la calidad y la efectividad.',
};

export function EventsPage() {
  const [sprintFilter, setSprintFilter] = useState('');
  const { token, projects, projectId, selectProject, data, setData, error, setError, reload } =
    useProjectResource<EventsData>((id) => `/api/projects/${id}/events${sprintFilter ? `?sprint_id=${sprintFilter}` : ''}`);
  const [editing, setEditing] = useState<ScrumEvent | EventType | null>(null);
  const [choosing, setChoosing] = useState(false);

  const membersById = new Map(data?.members.map((m) => [m.id, m]) ?? []);

  const setActionStatus = async (event: ScrumEvent, action: RetroAction, status: ActionStatus) => {
    try {
      const updated = await apiFetch<RetroAction>(`/api/retro-actions/${action.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setData((d) => d && {
        ...d,
        events: d.events.map((e) => (e.id === event.id ? { ...e, actions: e.actions.map((a) => (a.id === updated.id ? updated : a)) } : e)),
      });
    } catch (err) {
      setError(errorMessage(err, 'No se pudo actualizar la acción.'));
    }
  };

  if (projects && projects.length === 0) {
    return (
      <div className="dashboard">
        <div className="page-head"><div><h1>Eventos Scrum</h1></div></div>
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
          <h1>Eventos Scrum</h1>
          <p className="muted">Actas de Planning, Daily, Review y Retrospective con sus acuerdos.</p>
        </div>
        <div className="page-head__actions">
          <ProjectSelect projects={projects} value={projectId} onChange={(id) => { setSprintFilter(''); selectProject(id); }} />
          {data && data.sprints.length > 0 && (
            <select className="select" aria-label="Sprint" value={sprintFilter} onChange={(e) => setSprintFilter(e.target.value)}>
              <option value="">Todos los Sprints</option>
              {data.sprints.map((s) => <option key={s.id} value={s.id}>Sprint #{s.number}</option>)}
            </select>
          )}
          {data?.canEdit && data.sprints.length > 0 && (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setChoosing(true)}>
              <Icon name="plus" size={16} /> Registrar evento
            </button>
          )}
        </div>
      </div>

      {error && <p className="form__error" role="alert">{error}</p>}

      {!data ? (
        <div className="skeleton-grid" aria-busy="true" aria-label="Cargando eventos">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" />)}
        </div>
      ) : data.sprints.length === 0 ? (
        <div className="empty card">
          <p>Los eventos ocurren dentro de un Sprint.</p>
          <p className="muted small">El Sprint es el contenedor de todos los eventos: planifica uno para comenzar.</p>
          <Link to={`/sprints?proyecto=${data.projectId}`} className="btn btn--ghost btn--sm" style={{ justifySelf: 'center' }}>
            Ir a Sprints
          </Link>
        </div>
      ) : data.events.length === 0 ? (
        <div className="empty card"><p>Aún no hay eventos registrados.</p></div>
      ) : (
        <div className="event-list">
          {data.events.map((event) => (
            <article key={event.id} className={`card event-card event-card--${event.type}`}>
              <header className="card__head">
                <h2>
                  <Icon name="calendar" size={20} className="card__icon" /> {EVENT_LABEL[event.type]}
                  <span className="pill pill--closed">Sprint #{event.sprintNumber}</span>
                </h2>
                {data.canEdit && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(event)}>Editar</button>
                )}
              </header>
              <p className="muted small event-card__meta">
                {formatDateTime(event.heldAt)}
                {event.durationMinutes ? ` · ${event.durationMinutes} min` : ''}
                {event.createdByName ? ` · registrado por ${event.createdByName}` : ''}
              </p>
              {event.attendeeIds.length > 0 && (
                <div className="avatar-group" title="Asistentes">
                  {event.attendeeIds.map((id) => {
                    const m = membersById.get(id);
                    return m ? <Avatar key={id} name={m.name} src={m.avatarUrl} size={26} /> : null;
                  })}
                </div>
              )}
              <dl className="event-card__fields">
                {EVENT_FIELDS[event.type].filter((f) => event.data[f.key]).map((f) => (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{event.data[f.key]}</dd>
                  </div>
                ))}
                {event.agreements && <div><dt>Acuerdos</dt><dd>{event.agreements}</dd></div>}
                {event.notes && <div><dt>Notas</dt><dd>{event.notes}</dd></div>}
              </dl>
              {event.actions.length > 0 && (
                <>
                  <h3 className="section-title">Acciones de mejora</h3>
                  <ul className="action-list">
                    {event.actions.map((a) => (
                      <li key={a.id} className={a.status === 'done' || a.status === 'dropped' ? 'action-list__item--off' : undefined}>
                        <span className="action-list__desc">{a.description}</span>
                        <span className="muted small">
                          {a.ownerId ? membersById.get(a.ownerId)?.name ?? '—' : 'Sin responsable'}
                          {a.dueDate ? ` · ${a.dueDate.split('-').reverse().join('-')}` : ''}
                        </span>
                        <select className="select select--sm" aria-label="Estado de la acción" value={a.status}
                          disabled={!data.canEdit} onChange={(e) => void setActionStatus(event, a, e.target.value as ActionStatus)}>
                          {Object.entries(ACTION_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </article>
          ))}
        </div>
      )}

      {choosing && (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setChoosing(false)}>
          <div className="dialog card" role="dialog" aria-modal="true" aria-label="Tipo de evento">
            <header className="card__head">
              <h2><Icon name="calendar" size={20} className="card__icon" /> ¿Qué evento registras?</h2>
              <button type="button" className="icon-btn" aria-label="Cerrar" onClick={() => setChoosing(false)}>
                <Icon name="close" size={18} />
              </button>
            </header>
            <div className="event-types">
              {(Object.keys(EVENT_LABEL) as EventType[]).map((t) => (
                <button key={t} type="button" className="event-type" onClick={() => { setChoosing(false); setEditing(t); }}>
                  <strong>{EVENT_LABEL[t]}</strong>
                  <span className="muted small">{EVENT_HINT[t]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {editing && data && projectId && (
        <EventDialog event={typeof editing === 'string' ? null : editing}
          type={typeof editing === 'string' ? editing : editing.type}
          data={data} projectId={projectId} token={token} defaultSprint={sprintFilter}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------ registrar / editar acta
interface EventDialogProps {
  event: ScrumEvent | null;
  type: EventType;
  data: EventsData;
  projectId: string;
  token: string | null;
  defaultSprint: string;
  onClose: () => void;
  onSaved: () => void;
}

interface DraftAction {
  description: string;
  ownerId: string;
  dueDate: string;
}

function EventDialog({ event, type, data, projectId, token, defaultSprint, onClose, onSaved }: EventDialogProps) {
  const activeSprint = data.sprints.find((s) => s.status === 'active') ?? data.sprints[0];
  const [sprintId, setSprintId] = useState(event?.sprintId ?? (defaultSprint || activeSprint?.id || ''));
  const [heldAt, setHeldAt] = useState(localDateTimeInput(event ? new Date(event.heldAt) : new Date()));
  const [duration, setDuration] = useState(String(event?.durationMinutes ?? DEFAULT_DURATION[type]));
  const [fields, setFields] = useState<Record<string, string>>(event?.data ?? {});
  const [agreements, setAgreements] = useState(event?.agreements ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [attendees, setAttendees] = useState<string[]>(event?.attendeeIds ?? []);
  const [actions, setActions] = useState<DraftAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const minutes = duration.trim() ? Number(duration) : null;
  const longDaily = type === 'daily_scrum' && minutes != null && minutes > 15;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const newActions = actions
      .filter((a) => a.description.trim())
      .map((a) => ({ description: a.description.trim(), ownerId: a.ownerId || null, dueDate: a.dueDate || null }));
    const common = {
      heldAt: new Date(heldAt).toISOString(), durationMinutes: minutes, notes, agreements, data: fields,
      attendeeIds: attendees,
    };
    try {
      if (event) {
        await apiFetch(`/api/events/${event.id}`, token, { method: 'PATCH', body: JSON.stringify({ ...common, newActions }) });
      } else {
        await apiFetch(`/api/projects/${projectId}/events`, token, {
          method: 'POST',
          body: JSON.stringify({ ...common, sprintId, type, actions: newActions }),
        });
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'No se pudo guardar el evento.'));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog dialog--wide card" onSubmit={submit} role="dialog" aria-modal="true" aria-label={EVENT_LABEL[type]}>
        <header className="card__head">
          <h2><Icon name="calendar" size={20} className="card__icon" /> {EVENT_LABEL[type]}</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <p className="notice notice--compact" style={{ margin: 0 }}>{EVENT_HINT[type]}</p>

        <div className="form" style={{ marginTop: 0 }}>
          <div className="dialog__row dialog__row--3">
            <label className="field">
              <span>Sprint</span>
              <select className="select" value={sprintId} disabled={!!event} onChange={(e) => setSprintId(e.target.value)}>
                {data.sprints.map((s) => <option key={s.id} value={s.id}>Sprint #{s.number}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Fecha y hora</span>
              <input className="select" type="datetime-local" required value={heldAt} onChange={(e) => setHeldAt(e.target.value)} />
            </label>
            <label className="field">
              <span>Duración (min)</span>
              <div className="input">
                <input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ''))} />
              </div>
            </label>
          </div>
          {longDaily && <p className="form__error">La Daily Scrum es un evento de 15 minutos como máximo.</p>}

          <div className="field">
            <span>Asistentes</span>
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

          {EVENT_FIELDS[type].map((f) => (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <textarea className="textarea" rows={2} maxLength={5000} placeholder={f.placeholder} value={fields[f.key] ?? ''}
                onChange={(e) => setFields((d) => ({ ...d, [f.key]: e.target.value }))} />
            </label>
          ))}

          <label className="field">
            <span>Acuerdos</span>
            <textarea className="textarea" rows={2} maxLength={5000} value={agreements} onChange={(e) => setAgreements(e.target.value)} />
          </label>
          <label className="field">
            <span>Notas</span>
            <textarea className="textarea" rows={2} maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          {type === 'sprint_retrospective' && (
            <div className="field">
              <span className="field__row">
                Acciones de mejora <span className="muted small">Con responsable y fecha</span>
              </span>
              {event?.actions.map((a) => (
                <p key={a.id} className="small" style={{ margin: 0 }}>• {a.description} <span className="muted">({ACTION_STATUS_LABEL[a.status]})</span></p>
              ))}
              {actions.map((a, i) => (
                <div key={i} className="action-draft">
                  <div className="input">
                    <input maxLength={500} placeholder="Acción concreta" value={a.description}
                      onChange={(e) => setActions((list) => list.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                  </div>
                  <select className="select" aria-label="Responsable" value={a.ownerId}
                    onChange={(e) => setActions((list) => list.map((x, j) => (j === i ? { ...x, ownerId: e.target.value } : x)))}>
                    <option value="">Responsable…</option>
                    {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input className="select" type="date" aria-label="Fecha" value={a.dueDate}
                    onChange={(e) => setActions((list) => list.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
                  <button type="button" className="icon-btn icon-btn--sm" aria-label="Quitar acción"
                    onClick={() => setActions((list) => list.filter((_, j) => j !== i))}>
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ))}
              <button type="button" className="board-col__add"
                onClick={() => setActions((list) => [...list, { description: '', ownerId: '', dueDate: '' }])}>
                <Icon name="plus" size={16} /> Añadir acción
              </button>
            </div>
          )}
        </div>

        {error && <p className="form__error" role="alert">{error}</p>}

        <footer className="dialog__actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !sprintId || longDaily}>{busy ? 'Guardando…' : 'Guardar acta'}</button>
        </footer>
      </form>
    </div>
  );
}
