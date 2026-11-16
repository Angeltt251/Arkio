import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { NotificationsMenu } from './NotificationsMenu';

interface TopbarProps {
  onMenu: () => void;
}

export function Topbar({ onMenu }: TopbarProps) {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);

  // Atajo Ctrl + K / ⌘ + K para buscar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="topbar">
      <button className="icon-btn topbar__menu" onClick={onMenu} aria-label="Abrir menú">
        <Icon name="menu" />
      </button>

      <label className="search">
        <Icon name="search" size={18} />
        <input ref={searchRef} type="search" placeholder="Buscar en Arkio..." aria-label="Buscar" />
        <kbd>Ctrl + K</kbd>
      </label>

      <div className="topbar__actions">
        <button
          className={`theme-toggle ${theme === 'dark' ? 'theme-toggle--dark' : ''}`}
          onClick={toggleTheme}
          role="switch"
          aria-checked={theme === 'dark'}
          aria-label="Cambiar tema claro u oscuro"
        >
          <span className="theme-toggle__knob">
            <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={15} />
          </span>
        </button>

        <NotificationsMenu />

        {user && (
          <Link to="/configuracion" aria-label="Mi perfil y configuración" title="Mi perfil y configuración">
            <Avatar name={user.fullName} src={user.avatarUrl} size={44} className="topbar__avatar" />
          </Link>
        )}
      </div>
    </header>
  );
}
