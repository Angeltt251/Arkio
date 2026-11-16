import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';
import { GLOBAL_ITEMS, PROJECT_ITEMS, SETTINGS_ITEMS, type NavItem } from '@/config/navigation';
import { useAuth } from '@/context/AuthContext';
import type { ProjectOption } from '@/hooks/useProjectResource';
import { apiFetch } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/format';

interface SidebarProps {
  open: boolean;
  onNavigate: () => void;
}

const LAST_PROJECT = 'arkio:proyecto';

function rememberedProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT);
  } catch {
    return null;
  }
}

export function Sidebar({ open, onNavigate }: SidebarProps) {
  const { user, token, signOut } = useAuth();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [lastProject, setLastProject] = useState(rememberedProject);

  // Se recarga al navegar: así aparece un proyecto recién creado
  useEffect(() => {
    if (!token) return;
    apiFetch<ProjectOption[]>('/api/projects', token).then(setProjects).catch(() => setProjects([]));
  }, [token, pathname]);

  // El proyecto de la URL (lo eligen también los selectores de cada página) manda
  const fromUrl = params.get('proyecto');
  useEffect(() => {
    if (!fromUrl) return;
    setLastProject(fromUrl);
    try {
      localStorage.setItem(LAST_PROJECT, fromUrl);
    } catch {
      /* sin almacenamiento local */
    }
  }, [fromUrl]);

  const current = projects?.find((p) => p.id === (fromUrl ?? lastProject)) ?? projects?.[0] ?? null;
  const inProject = PROJECT_ITEMS.some((item) => item.to === pathname);

  // Página de proyecto sin `?proyecto=`: abre el último proyecto usado
  useEffect(() => {
    if (inProject && !fromUrl && current) navigate(`${pathname}?proyecto=${current.id}`, { replace: true });
  }, [inProject, fromUrl, current, pathname, navigate]);

  const chooseProject = (id: string) => {
    navigate(`${inProject ? pathname : '/ciclo'}?proyecto=${id}`);
    onNavigate();
  };

  const link = (item: NavItem, search = '') => (
    <NavLink
      key={item.to}
      to={`${item.to}${search}`}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
    >
      <Icon name={item.icon} size={19} />
      <span>{item.label}</span>
    </NavLink>
  );

  return (
    <aside className={`sidebar ${open ? 'sidebar--open' : ''}`} aria-label="Navegación principal">
      <div className="sidebar__brand">
        <Logo />
      </div>

      <nav className="sidebar__nav">
        {GLOBAL_ITEMS.map((item) => link(item))}

        <div className="sidebar__project">
          <span className="sidebar__heading">Proyecto</span>
          {projects && projects.length === 0 ? (
            <NavLink to="/espacios" onClick={onNavigate} className="sidebar__empty">
              <Icon name="plus" size={16} /> Crea tu primer proyecto
            </NavLink>
          ) : (
            <label className="sidebar__picker">
              <span className="sidebar__dot" style={{ background: current?.color ?? 'transparent' }} aria-hidden="true" />
              <select aria-label="Proyecto" value={current?.id ?? ''} disabled={!projects}
                onChange={(e) => chooseProject(e.target.value)}>
                {!projects && <option value="">Cargando…</option>}
                {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Icon name="chevronDown" size={15} />
            </label>
          )}
        </div>
        {current && PROJECT_ITEMS.map((item) => link(item, `?proyecto=${current.id}`))}

        <span className="sidebar__divider" aria-hidden="true" />
        {SETTINGS_ITEMS.map((item) => link(item))}
      </nav>

      <div className="sidebar__promo">
        <Icon name="rocket" size={26} />
        <p>
          Mejora tu flujo
          <br />
          de trabajo con Arkio
        </p>
        <a className="btn btn--promo" href="https://scrumguides.org/scrum-guide.html" target="_blank" rel="noreferrer">
          Ver tutorial <Icon name="arrowRight" size={15} />
        </a>
      </div>

      {user && (
        <div className="sidebar__user">
          <Avatar name={user.fullName} src={user.avatarUrl} size={38} />
          <div className="sidebar__user-info">
            <strong>{user.fullName}</strong>
            <span>{user.role ? ROLE_LABEL[user.role] : user.email}</span>
          </div>
          <button className="icon-btn icon-btn--ghost" onClick={signOut} title="Cerrar sesión" aria-label="Cerrar sesión">
            <Icon name="logout" size={18} />
          </button>
        </div>
      )}
    </aside>
  );
}
