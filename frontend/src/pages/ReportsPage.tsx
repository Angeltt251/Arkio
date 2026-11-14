import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BurndownChart } from '@/components/dashboard/BurndownChart';
import { Icon } from '@/components/ui/Icon';
import { ProjectSelect } from '@/components/ui/ProjectSelect';
import { useEscape, useProjectResource } from '@/hooks/useProjectResource';
import { apiDownload, errorMessage } from '@/lib/api';
import { sprintRange } from '@/lib/format';
import {
  PBI_STATUS_LABEL,
  PBI_TYPE_LABEL,
  SPRINT_STATUS_LABEL,
  formatDate,
  type PbiStatus,
  type PbiType,
  type ProjectHeader,
  type SprintStatus,
} from '@/lib/scrum';

type GoalStatus = 'achieved' | 'partial' | 'not_achieved' | 'cancelled' | 'in_progress' | 'planned';
type Audience = 'client' | 'team';

interface ReportPbi {
  code: string;
  title: string;
  type: PbiType;
  estimate: number | null;
  status: PbiStatus;
  finished: boolean;
  taskCount: number;
  tasksDone: number;
}

interface SprintReport {
  id: string;
  number: number;
  goal: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  closeReason: string | null;
  daysTotal: number;
  daysElapsed: number;
  pbisTotal: number;
  pbisDone: number;
  pointsTotal: number;
  pointsDone: number;
  taskCount: number;
  tasksDone: number;
  tasksBlocked: number;
  tasksOverdue: number;
  completion: number;
  goalStatus: GoalStatus;
  events: Record<string, number>;
  burndown: { day: string; remaining: number | null; ideal: number }[];
  pbis: ReportPbi[];
}

interface ReportsData extends ProjectHeader {
  projectColor: string;
  totals: {
    sprintsClosed: number;
    velocity: number | null;
    pbisTotal: number;
    pbisDone: number;
    pointsRemaining: number;
    openActions: number;
    backlogByStatus: Partial<Record<PbiStatus, number>>;
  };
  sprints: SprintReport[];
}

/** Qué se descarga: el informe de un Sprint o el del proyecto completo. */
type PdfTarget = { kind: 'sprint'; sprint: SprintReport } | { kind: 'project' };

const GOAL_LABEL: Record<GoalStatus, string> = {
  achieved: 'Objetivo cumplido',
  partial: 'Objetivo parcialmente cumplido',
  not_achieved: 'Objetivo no cumplido',
  cancelled: 'Sprint cancelado',
  in_progress: 'Sprint en curso',
  planned: 'Sprint planificado',
};
const GOAL_PILL: Record<GoalStatus, string> = {
  achieved: 'pill--active',
  partial: 'pill--paused',
  not_achieved: 'pill--danger',
  cancelled: 'pill--closed',
  in_progress: 'pill--sprint-planned',
  planned: 'pill--closed',
};
const BACKLOG_ORDER: PbiStatus[] = ['new', 'refined', 'ready', 'in_sprint', 'done', 'discarded'];

const num = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 1 });
const shortDay = (iso: string) => formatDate(iso).replace(/\s+\d{4}$/, '').replace(/\.$/, '');

export function ReportsPage() {
  const { token, projects, projectId, selectProject, data, error } =
    useProjectResource<ReportsData>((id) => `/api/projects/${id}/reports`);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Al cambiar de proyecto: el Sprint en curso o el último cerrado
  useEffect(() => {
    if (!data) return;
    setSelectedId((current) =>
      current && data.sprints.some((s) => s.id === current)
        ? current
        : (data.sprints.find((s) => s.status === 'active') ?? data.sprints.find((s) => s.status !== 'planned') ?? data.sprints[0])?.id ?? null,
    );
  }, [data]);

  const sprint = data?.sprints.find((s) => s.id === selectedId) ?? null;
  const key = data?.projectKey.toLowerCase() ?? 'proyecto';

  const csv = async (id: string, path: string, filename: string) => {
    setBusy(id);
    setActionError(null);
    try {
      await apiDownload(path, token, filename);
    } catch (err) {
      setActionError(errorMessage(err, 'No se pudo exportar.'));
    } finally {
      setBusy(null);
    }
  };

  if (projects && projects.length === 0) {
    return (
      <div className="dashboard">
        <div className="page-head"><div><h1>Reportes</h1></div></div>
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
          <h1>Reportes</h1>
          <p className="muted">Informes de Sprint y del proyecto en PDF para el cliente o el equipo, y datos en CSV.</p>
        </div>
        <div className="page-head__actions">
          <ProjectSelect projects={projects} value={projectId} onChange={selectProject} />
          {data && (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setPdf({ kind: 'project' })}>
              <Icon name="reports" size={16} /> Informe del proyecto
            </button>
          )}
        </div>
      </div>

      {(error || actionError) && <p className="form__error" role="alert">{actionError ?? error}</p>}

      {!data ? (
        <div className="skeleton-grid" aria-busy="true" aria-label="Cargando reportes">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" />)}
        </div>
      ) : (
        <>
          <section className="report-kpis" aria-label="Resumen del proyecto">
            <Kpi label="Sprints cerrados" value={String(data.totals.sprintsClosed)} />
            <Kpi label="Velocidad" value={data.totals.velocity != null ? `${num(data.totals.velocity)} pts` : '—'}
              hint="Promedio de los últimos 3 Sprints cerrados: una referencia, no una meta." />
            <Kpi label="Product Backlog terminado" value={`${data.totals.pbisDone}/${data.totals.pbisTotal}`}
              percent={data.totals.pbisTotal ? Math.round((100 * data.totals.pbisDone) / data.totals.pbisTotal) : 0} />
            <Kpi label="Puntos por hacer" value={num(data.totals.pointsRemaining)} />
            <Kpi label="Acciones de mejora abiertas" value={String(data.totals.openActions)} />
          </section>

          <section className="card">
            <header className="card__head">
              <h2><Icon name="download" size={20} className="card__icon" /> Exportar datos del proyecto (CSV)</h2>
            </header>
            <div className="report-exports">
              <ExportButton busy={busy === 'backlog'} label="Product Backlog"
                onClick={() => void csv('backlog', `/api/projects/${data.projectId}/backlog.csv`, `product-backlog-${key}.csv`)} />
              <ExportButton busy={busy === 'sprints'} label="Resumen de Sprints"
                onClick={() => void csv('sprints', `/api/projects/${data.projectId}/sprints.csv`, `sprints-${key}.csv`)} />
              <ExportButton busy={busy === 'actions'} label="Acciones de mejora"
                onClick={() => void csv('actions', `/api/projects/${data.projectId}/retro-actions.csv`, `acciones-mejora-${key}.csv`)} />
              <ExportButton busy={busy === 'logbook'} label="Bitácora completa"
                onClick={() => void csv('logbook', `/api/projects/${data.projectId}/logbook.csv`, `bitacora-${key}.csv`)} />
            </div>
          </section>

          {data.sprints.length === 0 ? (
            <div className="empty card">
              <p>Todavía no hay Sprints en este proyecto.</p>
              <p className="muted small">Los informes de Sprint aparecen cuando planificas el primero.</p>
              <Link to={`/sprints?proyecto=${data.projectId}`} className="btn btn--ghost btn--sm" style={{ justifySelf: 'center' }}>
                Ir a Sprints
              </Link>
            </div>
          ) : (
            <div className="report-layout">
              <nav className="card report-sprints" aria-label="Sprints">
                <h2 className="report-sprints__title">Informes por Sprint</h2>
                {data.sprints.map((s) => (
                  <button key={s.id} type="button" onClick={() => setSelectedId(s.id)}
                    className={`report-sprint${s.id === selectedId ? ' report-sprint--on' : ''}`} aria-current={s.id === selectedId}>
                    <span className="report-sprint__head">
                      <strong>Sprint #{s.number}</strong>
                      <span className="muted small">{SPRINT_STATUS_LABEL[s.status]}</span>
                    </span>
                    <span className="report-sprint__goal">{s.goal}</span>
                    <span className="progress">
                      <span className="progress__track"><span className="progress__bar" style={{ width: `${s.completion}%` }} /></span>
                      <span>{s.completion}%</span>
                    </span>
                  </button>
                ))}
              </nav>

              {sprint && (
                <SprintPreview sprint={sprint} busy={busy}
                  onPdf={() => setPdf({ kind: 'sprint', sprint })}
                  onTasksCsv={() => void csv('tasks', `/api/sprints/${sprint.id}/tasks.csv`, `tareas-sprint-${sprint.number}-${key}.csv`)}
                  onItemsCsv={() => void csv('items', `/api/sprints/${sprint.id}/items.csv`, `sprint-backlog-${sprint.number}-${key}.csv`)} />
              )}
            </div>
          )}

          {Object.keys(data.totals.backlogByStatus).length > 0 && (
            <section className="card">
              <header className="card__head">
                <h2><Icon name="list" size={20} className="card__icon" /> Estado del Product Backlog</h2>
              </header>
              <BacklogBars counts={data.totals.backlogByStatus} />
            </section>
          )}
        </>
      )}

      {pdf && data && (
        <PdfDialog target={pdf} data={data} token={token} onClose={() => setPdf(null)} />
      )}
    </div>
  );
}

function Kpi({ label, value, hint, percent }: { label: string; value: string; hint?: string; percent?: number }) {
  return (
    <article className="card report-kpi" title={hint}>
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      {percent != null && (
        <span className="progress__track" aria-label={`${percent}%`}>
          <span className="progress__bar" style={{ width: `${percent}%` }} />
        </span>
      )}
    </article>
  );
}

function ExportButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn btn--ghost btn--sm" onClick={onClick} disabled={busy}>
      <Icon name="download" size={16} /> {busy ? 'Generando…' : label}
    </button>
  );
}

function SprintPreview({ sprint, busy, onPdf, onTasksCsv, onItemsCsv }: {
  sprint: SprintReport;
  busy: string | null;
  onPdf: () => void;
  onTasksCsv: () => void;
  onItemsCsv: () => void;
}) {
  const burndown = useMemo(() => sprint.taskCount && sprint.status !== 'planned' ? {
    sprintId: sprint.id,
    sprintLabel: `Sprint #${sprint.number}`,
    points: sprint.burndown.map((d) => ({ label: shortDay(d.day), ideal: d.ideal, real: d.remaining })),
  } : null, [sprint]);
  const finished = sprint.pbis.filter((p) => p.finished);
  const pending = sprint.pbis.filter((p) => !p.finished);
  const closed = sprint.status === 'closed' || sprint.status === 'cancelled';

  return (
    <div className="report-preview">
      <section className="card">
        <header className="card__head">
          <h2>
            <Icon name="rocket" size={20} className="card__icon" /> Sprint #{sprint.number}
            <span className={`pill ${GOAL_PILL[sprint.goalStatus]}`}><span className="dot" /> {GOAL_LABEL[sprint.goalStatus]}</span>
          </h2>
          <span className="muted small">{sprintRange(sprint.startDate, sprint.endDate)}</span>
        </header>
        <p className="sprint-box__goal"><strong>Sprint Goal:</strong> {sprint.goal}</p>
        {sprint.closeReason && <p className="muted small">Comentario de cierre: {sprint.closeReason}</p>}

        <div className="report-mini-kpis">
          <div><strong>{sprint.completion}%</strong><span>Avance</span></div>
          <div><strong>{sprint.pbisDone}/{sprint.pbisTotal}</strong><span>PBIs terminados</span></div>
          <div><strong>{sprint.pointsTotal ? `${num(sprint.pointsDone)}/${num(sprint.pointsTotal)}` : '—'}</strong><span>Puntos</span></div>
          <div><strong>{sprint.tasksDone}/{sprint.taskCount}</strong><span>Tareas</span></div>
          <div><strong>{sprint.status === 'planned' ? '—' : `${sprint.daysElapsed}/${sprint.daysTotal}`}</strong><span>Días</span></div>
        </div>
        {(sprint.tasksBlocked > 0 || sprint.tasksOverdue > 0) && !closed && (
          <p className="notice notice--compact" style={{ margin: 0 }}>
            {sprint.tasksBlocked > 0 && `${sprint.tasksBlocked} tarea${sprint.tasksBlocked > 1 ? 's' : ''} bloqueada${sprint.tasksBlocked > 1 ? 's' : ''}. `}
            {sprint.tasksOverdue > 0 && `${sprint.tasksOverdue} tarea${sprint.tasksOverdue > 1 ? 's' : ''} vencida${sprint.tasksOverdue > 1 ? 's' : ''}.`}
          </p>
        )}

        <div className="report-actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={onPdf}>
            <Icon name="download" size={16} /> Descargar PDF
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onTasksCsv} disabled={busy === 'tasks'}>
            {busy === 'tasks' ? 'Generando…' : 'Tareas (CSV)'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onItemsCsv} disabled={busy === 'items'}>
            {busy === 'items' ? 'Generando…' : 'Sprint Backlog (CSV)'}
          </button>
        </div>
      </section>

      {burndown && <BurndownChart data={burndown} picker={false} />}

      <section className="card">
        <header className="card__head">
          <h2><Icon name="check" size={20} className="card__icon" /> {closed ? 'Entregado' : 'Terminado hasta ahora'}</h2>
          <span className="muted small">{finished.length} de {sprint.pbis.length}</span>
        </header>
        <PbiList items={finished} empty="Todavía no hay elementos terminados." />
        {pending.length > 0 && (
          <>
            <h3 className="report-subtitle">{closed ? 'No terminado: vuelve al Product Backlog' : 'En desarrollo'}</h3>
            <PbiList items={pending} />
          </>
        )}
      </section>
    </div>
  );
}

function PbiList({ items, empty }: { items: ReportPbi[]; empty?: string }) {
  if (!items.length) return empty ? <p className="muted small">{empty}</p> : null;
  return (
    <ul className="sprint-box__items">
      {items.map((i) => (
        <li key={i.code}>
          <span className="pbi-row__code">{i.code}</span>
          <span className="sprint-box__title">{i.title}</span>
          <span className="muted small">{PBI_TYPE_LABEL[i.type]}</span>
          <span className="muted small">{i.taskCount ? `${i.tasksDone}/${i.taskCount} tareas` : ''}</span>
          <span className="pbi-row__estimate">{i.estimate ?? '—'}</span>
        </li>
      ))}
    </ul>
  );
}

function BacklogBars({ counts }: { counts: Partial<Record<PbiStatus, number>> }) {
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) || 1;
  return (
    <div className="report-backlog">
      <div className="report-backlog__bar" role="img" aria-label="Distribución del Product Backlog por estado">
        {BACKLOG_ORDER.filter((s) => counts[s]).map((s) => (
          <span key={s} className={`report-backlog__seg pbi-status--${s}`} style={{ flexGrow: counts[s] }}
            title={`${PBI_STATUS_LABEL[s]}: ${counts[s]}`} />
        ))}
      </div>
      <ul className="report-backlog__legend">
        {BACKLOG_ORDER.filter((s) => counts[s]).map((s) => (
          <li key={s}>
            <span className={`report-backlog__dot pbi-status--${s}`} />
            {PBI_STATUS_LABEL[s]} <strong>{counts[s]}</strong>
            <span className="muted small">{Math.round((100 * (counts[s] ?? 0)) / total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ descarga de PDF
const CLIENT_KEY = 'arkio:report-client';

function readClient(projectId: string): string {
  try {
    return localStorage.getItem(`${CLIENT_KEY}:${projectId}`) ?? '';
  } catch {
    return '';
  }
}

function PdfDialog({ target, data, token, onClose }: {
  target: PdfTarget;
  data: ReportsData;
  token: string | null;
  onClose: () => void;
}) {
  const [audience, setAudience] = useState<Audience>('client');
  const [clientName, setClientName] = useState(() => readClient(data.projectId));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const isSprint = target.kind === 'sprint';
  const title = isSprint ? `Informe del Sprint #${target.sprint.number}` : 'Informe del proyecto';
  const key = data.projectKey.toLowerCase();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(`${CLIENT_KEY}:${data.projectId}`, clientName.trim());
    } catch {
      /* sin almacenamiento local: no pasa nada */
    }
    const suffix = audience === 'team' ? '-interno' : '';
    const [path, filename] = isSprint
      ? [`/api/sprints/${target.sprint.id}/report.pdf`, `informe-sprint-${target.sprint.number}-${key}${suffix}.pdf`]
      : [`/api/projects/${data.projectId}/report.pdf`, `informe-proyecto-${key}${suffix}.pdf`];
    try {
      await apiDownload(path, token, filename, {
        method: 'POST',
        body: JSON.stringify({ audience, note: note.trim() || null, clientName: clientName.trim() || null }),
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'No se pudo generar el PDF.'));
      setBusy(false);
    }
  };

  const contents = audience === 'client'
    ? isSprint
      ? 'Sprint Goal y su cumplimiento, avance, burndown, lo entregado, lo pendiente, la Sprint Review, los próximos pasos y el equipo.'
      : 'Product Goal, avance del backlog, velocidad, gráfico por Sprint, historial de Sprints y el equipo.'
    : isSprint
      ? 'Todo lo de la versión cliente más el plan, las tareas con responsables, los impedimentos de las Daily, la Retrospectiva, las acciones de mejora y las contribuciones.'
      : 'Todo lo de la versión cliente más las acciones de mejora de las Retrospectivas.';

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog card" onSubmit={submit} role="dialog" aria-modal="true" aria-label={title}>
        <header className="card__head">
          <h2><Icon name="reports" size={20} className="card__icon" /> {title}</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="form" style={{ marginTop: 0 }}>
          <fieldset className="report-audience">
            <legend className="sr-only">Versión</legend>
            <label className={`event-type${audience === 'client' ? ' report-audience--on' : ''}`}>
              <input type="radio" name="audience" checked={audience === 'client'} onChange={() => setAudience('client')} />
              <strong>Para el cliente</strong>
              <span className="muted small">Lo que se entregó y cómo avanza. Sin detalles internos del equipo.</span>
            </label>
            <label className={`event-type${audience === 'team' ? ' report-audience--on' : ''}`}>
              <input type="radio" name="audience" checked={audience === 'team'} onChange={() => setAudience('team')} />
              <strong>Uso interno</strong>
              <span className="muted small">Informe completo para el equipo o el profesor.</span>
            </label>
          </fieldset>
          <p className="muted small" style={{ margin: 0 }}>Incluye: {contents}</p>

          <label className="field">
            <span>Preparado para (opcional)</span>
            <div className="input">
              <input value={clientName} maxLength={120} placeholder="Nombre del cliente o empresa"
                onChange={(e) => setClientName(e.target.value)} />
            </div>
          </label>
          <label className="field">
            <span>Mensaje para incluir al inicio (opcional)</span>
            <textarea className="textarea" rows={4} maxLength={2000} value={note}
              placeholder="Ej.: Les compartimos el avance de este Sprint. Quedamos atentos a sus comentarios."
              onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        {error && <p className="form__error" role="alert">{error}</p>}

        <footer className="dialog__actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy}>
            <Icon name="download" size={16} /> {busy ? 'Generando PDF…' : 'Descargar PDF'}
          </button>
        </footer>
      </form>
    </div>
  );
}
