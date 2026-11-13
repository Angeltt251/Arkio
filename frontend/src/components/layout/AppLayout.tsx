import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export interface LayoutContext {
  setNotifications: (n: number) => void;
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState(0);

  return (
    <div className="app">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <div className="app__main">
        <Topbar onMenu={() => setMenuOpen(true)} notifications={notifications} />
        <main className="content">
          <Outlet context={{ setNotifications } satisfies LayoutContext} />
        </main>
      </div>
    </div>
  );
}
