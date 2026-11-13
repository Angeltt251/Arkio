import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { sprintRange } from '@/lib/format';
import type { CurrentSprint } from '@/types';

const STATUS_LABEL = { planned: 'Planificado', active: 'En curso', closed: 'Cerrado', cancelled: 'Cancelado' };

function ProgressRing({ value }: { value: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" role="img" aria-label={`Avance del Sprint ${value}%`}>
      <svg viewBox="0 0 128 128" width="128" height="128">
        <circle cx="64" cy="64" r={r} className="ring__track" />
        <circle
          cx="64"
          cy="64"
          r={r}
          className="ring__value"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          transform="rotate(-90 64 64)"
        />
      </svg>
      <strong>{value}%</strong>
    </div>
  );
}

export function CurrentSprintCard({ sprint }: { sprint: CurrentSprint | null }) {
  return (
    <section className="card sprint-card">
      <header className="card__head">
        <h2>
          <Icon name="target" size={22} className="card__icon" /> Tu Sprint Actual
        </h2>
        {sprint && (
          <span className={`pill pill--sprint-${sprint.status}`}>
            <span className="dot" /> {STATUS_LABEL[sprint.status]}
          </span>
        )}
      </header>

      {sprint ? (
        <>
          <div className="sprint-card__main">
            <div>
              <h3 className="sprint-card__title">Sprint #{sprint.number}</h3>
              <p className="muted">
                {sprintRange(sprint.startDate, sprint.endDate)} • {sprint.workingDays} días hábiles
              </p>
              <p className="muted small">{sprint.projectName}</p>
            </div>
            <ProgressRing value={sprint.progress} />
          </div>

          <h4 className="sprint-card__goal-title">
            <Icon name="trophy" size={18} /> Sprint Goal
          </h4>
          <div className="sprint-card__footer">
            <p className="sprint-card__goal">{sprint.goal}</p>
            <Link to="/tableros" className="btn btn--primary btn--sm">
              Ver detalles <Icon name="arrowRight" size={15} />
            </Link>
          </div>
        </>
      ) : (
        <div className="empty">
          <p>No tienes un Sprint en curso.</p>
          <p className="muted small">Planifica uno desde el Product Backlog para ver aquí su avance y Sprint Goal.</p>
        </div>
      )}
    </section>
  );
}
