import { AvatarGroup } from '@/components/ui/Avatar';
import { PROJECT_STATUS_LABEL } from '@/lib/format';
import type { ProjectSummary } from '@/types';

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const sprintText =
    project.sprintNumber != null ? `Sprint ${project.sprintNumber} • ${project.sprintDays} días` : 'Sin sprints';

  return (
    <article className="project-card">
      <header className="project-card__head">
        <span className="project-card__badge" style={{ background: project.color }}>
          {project.name.charAt(0).toUpperCase()}
        </span>
        <div>
          <h3>{project.name}</h3>
          <span className={`pill pill--${project.status}`}>{PROJECT_STATUS_LABEL[project.status]}</span>
        </div>
      </header>

      <p className="project-card__sprint">{sprintText}</p>

      <div className="progress" role="progressbar" aria-valuenow={project.progress} aria-valuemin={0} aria-valuemax={100}
        aria-label={`Avance de ${project.name}`}>
        <div className="progress__track">
          <div className="progress__bar" style={{ width: `${project.progress}%` }} />
        </div>
        <span>{project.progress}%</span>
      </div>

      <AvatarGroup members={project.members} extra={project.extraMembers} />
    </article>
  );
}
