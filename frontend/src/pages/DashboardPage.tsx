import { useEffect } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import type { LayoutContext } from '@/components/layout/AppLayout';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { BurndownChart } from '@/components/dashboard/BurndownChart';
import { CurrentSprintCard } from '@/components/dashboard/CurrentSprintCard';
import { ProjectCard } from '@/components/dashboard/ProjectCard';
import { StatCard } from '@/components/dashboard/StatCard';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';

export function DashboardPage() {
  const { user } = useAuth();
  const { data, loading, source } = useDashboard();
  const { setNotifications } = useOutletContext<LayoutContext>();
  const firstName = user?.fullName.split(' ')[0] ?? '';

  useEffect(() => {
    if (data) setNotifications(data.unreadNotifications);
  }, [data, setNotifications]);

  return (
    <div className="dashboard">
      <div className="page-head">
        <div>
          <h1>
            ¡Hola, {firstName}! <span className="wave" aria-hidden="true">👋</span>
          </h1>
          <p className="muted">Aquí tienes un resumen de tu proyecto</p>
        </div>
        <Link to="/espacios" className="btn btn--primary">
          <Icon name="plus" size={18} /> Nuevo Proyecto
        </Link>
      </div>

      {source !== 'api' && (
        <div className="notice" role="status">
          {source === 'demo'
            ? 'Modo demo: estás viendo datos de ejemplo. Configura Supabase en frontend/.env.local para usar datos reales.'
            : 'No se pudo conectar con la API. Se muestran datos de ejemplo.'}
        </div>
      )}

      {loading || !data ? (
        <div className="skeleton-grid" aria-busy="true" aria-label="Cargando dashboard">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      ) : (
        <>
          <section className="stats" aria-label="Resumen">
            <StatCard label="Proyectos Activos" icon="folder" tone="violet" stat={data.stats.activeProjects} />
            <StatCard label="Sprints en Curso" icon="zap" tone="green" stat={data.stats.sprintsInProgress} />
            <StatCard label="Tareas Completadas" icon="check" tone="orange" stat={data.stats.completedTasks} />
            <StatCard label="Miembros del Equipo" icon="users" tone="blue" stat={data.stats.teamMembers} />
          </section>

          <div className="grid grid--main">
            <section className="card">
              <header className="card__head">
                <h2>
                  <Icon name="layers" size={22} className="card__icon" /> Mis Proyectos
                </h2>
                <Link to="/espacios" className="link">
                  Ver todos <Icon name="arrowRight" size={16} />
                </Link>
              </header>
              {data.projects.length === 0 ? (
                <div className="empty">
                  <p>Todavía no participas en proyectos.</p>
                  <p className="muted small">Crea un espacio de trabajo y tu primer proyecto para comenzar.</p>
                </div>
              ) : (
                <div className="projects">
                  {data.projects.slice(0, 3).map((p) => (
                    <ProjectCard key={p.id} project={p} />
                  ))}
                </div>
              )}
            </section>

            <CurrentSprintCard sprint={data.currentSprint} />
          </div>

          <div className="grid grid--bottom">
            <ActivityFeed items={data.activity} />
            <BurndownChart data={data.burndown} />
          </div>
        </>
      )}
    </div>
  );
}
