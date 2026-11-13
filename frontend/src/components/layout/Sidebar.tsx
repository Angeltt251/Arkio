import { NavLink } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';
import { NAV_ITEMS } from '@/config/navigation';
import { useAuth } from '@/context/AuthContext';
import { ROLE_LABEL } from '@/lib/format';

interface SidebarProps {
  open: boolean;
  onNavigate: () => void;
}

export function Sidebar({ open, onNavigate }: SidebarProps) {
  const { user, signOut } = useAuth();

  return (
    <aside className={`sidebar ${open ? 'sidebar--open' : ''}`} aria-label="Navegación principal">
      <div className="sidebar__brand">
        <Logo />
      </div>

      <nav className="sidebar__nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
          >
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
          </NavLink>
        ))}
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
