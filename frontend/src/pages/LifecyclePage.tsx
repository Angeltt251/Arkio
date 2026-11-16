import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ProjectSelect } from '@/components/ui/ProjectSelect';
import { useProjectResource } from '@/hooks/useProjectResource';
import { SPRINT_STATUS_LABEL, type ProjectHeader, type SprintStatus } from '@/lib/scrum';

type StepKey =
  | 'workspace' | 'project' | 'team' | 'product_goal' | 'backlog' | 'definition_of_done'
  | 'planning' | 'start' | 'tracking' | 'review' | 'retrospective' | 'close';
type Phase = 'setup' | 'product' | 'sprint';

interface Step {
  key: StepKey;
  phase: Phase;
  title: string;
  done: boolean;
  detail: string;
  hint: string;
  blocked: string | null;
}

interface Lifecycle extends ProjectHeader {
  workspaceName: string;
  steps: Step[];
  currentStep: StepKey | null;
  sprintId: string | null;
  sprintNumber: number | null;
  sprintStatus: SprintStatus | null;
  nextSprint: boolean;
}

const PHASES: { id: Phase; title: string; text: string }[] = [
  { id: 'setup', title: 'Preparación', text: 'El equipo y el proyecto. Se hace una vez.' },
  { id: 'product', title: 'Producto', text: 'Hacia dónde va el producto y qué significa «terminado».' },
  { id: 'sprint', title: 'Sprint', text: 'Se repite en cada Sprint. Al cerrar, el ciclo vuelve a la Sprint Planning.' },
];

/** Dónde se hace cada paso. */
const ACTION: Record<StepKey, { to: string; label: string; icon: IconName }> = {
  workspace: { to: '/espacios', label: 'Espacios', icon: 'workspaces' },
  project: { to: '/espacios', label: 'Editar proyecto', icon: 'folder' },
  team: { to: '/miembros', label: 'Configurar equipo', icon: 'users' },
  product_goal: { to: '/backlog', label: 'Definir Product Goal', icon: 'target' },
  backlog: { to: '/backlog', label: 'Ir al Product Backlog', icon: 'list' },
  definition_of_done: { to: '/backlog', label: 'Definir la DoD', icon: 'check' },
  planning: { to: '/sprints', label: 'Planificar Sprint', icon: 'rocket' },
  start: { to: '/sprints', label: 'Iniciar Sprint', icon: 'rocket' },
  tracking: { to: '/tableros', label: 'Abrir tablero', icon: 'boards' },
  review: { to: '/eventos', label: 'Registrar Review', icon: 'calendar' },
  retrospective: { to: '/eventos', label: 'Registrar Retrospective', icon: 'calendar' },
  close: { to: '/sprints', label: 'Cerrar Sprint', icon: 'check' },
};

export function LifecyclePage() {
  const { projects, projectId, selectProject, data, error } =
    useProjectResource<Lifecycle>((id) => `/api/projects/${id}/lifecycle`);

  if (projects && projects.length === 0) {
    return (
      <div className="dashboard">
        <div className="page-head"><div><h1>Ciclo del proyecto</h1></div></div>
        <div className="empty">
          <p>Empieza por el paso 1: crea un espacio de trabajo y tu primer proyecto.</p>
          <Link to="/espacios" className="btn btn--primary btn--sm" style={{ justifySelf: 'center' }}>
            <Icon name="plus" size={16} /> Crear espacio y proyecto
          </Link>
        </div>
      </div>
    );
  }

  const doneCount = data?.steps.filter((s) => s.done).length ?? 0;
  const link = (to: string) => `${to}?proyecto=${data?.projectId}`;

  return (
    <div className="dashboard">
      <div className="page-head">
        <div>
          <h1>Ciclo del proyecto</h1>
          <p className="muted">Los 12 pasos de Scrum, en orden. Cada uno indica qué falta y dónde hacerlo.</p>
        </div>
        <ProjectSelect projects={projects} value={projectId} onChange={selectProject} />
      </div>

      {error && <p className="form__error" role="alert">{error}</p>}

      {!data ? (
        <div className="skeleton-grid" aria-busy="true" aria-label="Cargando ciclo">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" />)}
        </div>
      ) : (
        <>
          <section className="card cycle-summary">
            <div className="progress" aria-label="Avance del ciclo">
              <div className="progress__track"><div className="progress__bar" style={{ width: `${(doneCount * 100) / 12}%` }} /></div>
              <span>{doneCount}/12 pasos</span>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              {data.workspaceName} · {data.projectName}
              {data.sprintNumber != null && data.sprintStatus &&
                ` · Sprint #${data.sprintNumber} ${SPRINT_STATUS_LABEL[data.sprintStatus].toLowerCase()}`}
            </p>
            {data.nextSprint && (
              <p className="notice notice--compact cycle-summary__next">
                El Sprint #{data.sprintNumber} está cerrado. El ciclo continúa con la Sprint Planning del siguiente Sprint.{' '}
                <Link to={link('/sprints')}>Planificar el Sprint #{(data.sprintNumber ?? 0) + 1}</Link>
                {' · '}
                <Link to={link('/reportes')}>Ver el informe</Link>
              </p>
            )}
          </section>

          {PHASES.map((phase) => (
            <section key={phase.id} className="card cycle-phase">
              <header className="card__head">
                <h2>{phase.title}</h2>
                <span className="muted small">{phase.text}</span>
              </header>
              <ol className="cycle">
                {data.steps.map((step, index) => step.phase !== phase.id ? null : (
                  <StepRow key={step.key} step={step} number={index + 1}
                    current={data.currentStep === step.key} href={link(ACTION[step.key].to)} />
                ))}
              </ol>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function StepRow({ step, number, current, href }: { step: Step; number: number; current: boolean; href: string }) {
  const action = ACTION[step.key];
  const state = step.done ? 'done' : current ? 'current' : 'pending';
  return (
    <li className={`cycle__step cycle__step--${state}`} aria-current={current ? 'step' : undefined}>
      <span className="cycle__num" aria-hidden="true">{step.done ? <Icon name="check" size={16} /> : number}</span>
      <div className="cycle__body">
        <strong>
          <span className="sr-only">Paso {number}{step.done ? ' (hecho)' : current ? ' (siguiente)' : ''}: </span>
          {step.title}
        </strong>
        <p className="cycle__detail">{step.detail}</p>
        <p className="muted small cycle__hint">{step.hint}</p>
        {step.blocked && !step.done && <p className="cycle__blocked small">{step.blocked}</p>}
      </div>
      {(current || !step.done) && !step.blocked && (
        <Link to={href} className={`btn btn--sm ${current ? 'btn--primary' : 'btn--ghost'} cycle__action`}>
          <Icon name={action.icon} size={15} /> {action.label}
        </Link>
      )}
    </li>
  );
}
