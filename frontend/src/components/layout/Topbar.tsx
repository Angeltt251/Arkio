import { useEffect, useRef } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';

interface TopbarProps {
  onMenu: () => void;
  notifications: number;
}

export function Topbar({ onMenu, notifications }: TopbarProps) {
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

        <button className="icon-btn bell" aria-label={`Notificaciones (${notifications} sin leer)`}>
          <Icon name="bell" size={21} />
          {notifications > 0 && <span className="bell__badge">{notifications > 9 ? '9+' : notifications}</span>}
        </button>

        {user && <Avatar name={user.fullName} src={user.avatarUrl} size={44} className="topbar__avatar" />}
      </div>
    </header>
  );
}
