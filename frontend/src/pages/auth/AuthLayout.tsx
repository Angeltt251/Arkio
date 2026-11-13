import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';
import { isSupabaseConfigured } from '@/lib/supabase';

const FEATURES = [
  { icon: 'boards' as const, text: 'Tablero Kanban con límites WIP y flujo visual' },
  { icon: 'target' as const, text: 'Product Backlog, Sprint Planning y Sprint Goal' },
  { icon: 'logbook' as const, text: 'Bitácora que demuestra qué hizo cada integrante y cuándo' },
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth__brand">
        <Logo size={40} />
        <div className="auth__pitch">
          <h2>Planifica, ejecuta y demuestra la evolución de tu proyecto.</h2>
          <p>Scrum + Kanban en una sola plataforma, con trazabilidad completa del trabajo del equipo.</p>
          <ul>
            {FEATURES.map((f) => (
              <li key={f.text}>
                <span>
                  <Icon name={f.icon} size={18} />
                </span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>
        <small>© {new Date().getFullYear()} Arkio</small>
      </aside>

      <main className="auth__panel">
        <div className="auth__card">
          <div className="auth__mobile-logo">
            <Logo />
          </div>
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {!isSupabaseConfigured && (
            <div className="notice notice--compact">Modo demo: entra con cualquier correo y contraseña.</div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
