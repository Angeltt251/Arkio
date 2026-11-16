import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { AppNotification } from '@/lib/profile';
import { connectRealtime } from '@/lib/realtime';

const KIND_ICON: Record<AppNotification['kind'], IconName> = {
  task_assigned: 'user',
  task_update: 'check',
  sprint: 'rocket',
  membership: 'users',
  retro_action: 'target',
  general: 'bell',
};

/** Campana de la barra superior: avisos personales con enlace a lo que pasó. */
export function NotificationsMenu() {
  const { token, isDemo } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    if (!token || isDemo) return;
    try {
      const data = await apiFetch<{ items: AppNotification[]; unread: number }>('/api/me/notifications?limit=30', token);
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      /* se reintenta en el próximo ciclo */
    }
  }, [token, isDemo]);

  // Carga inicial, cada minuto y cuando llega actividad en vivo (los avisos nacen de esa actividad)
  useEffect(() => {
    if (!token || isDemo) return;
    void load();
    const poll = window.setInterval(() => void load(), 60_000);
    const close = connectRealtime(token, (msg) => {
      if (msg.type !== 'activity') return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void load(), 1_500);
    });
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(timer.current);
      close();
    };
  }, [token, isDemo, load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markRead = async (ids?: number[]) => {
    const now = new Date().toISOString();
    setItems((list) => list.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)));
    setUnread((u) => (ids ? Math.max(0, u - ids.length) : 0));
    await apiFetch('/api/me/notifications/read', token, { method: 'POST', body: JSON.stringify({ ids: ids ?? null }) }).catch(() => load());
  };

  const clearRead = async () => {
    setItems((list) => list.filter((n) => !n.readAt));
    await apiFetch('/api/me/notifications', token, { method: 'DELETE' }).catch(() => load());
  };

  const openItem = (n: AppNotification) => {
    if (!n.readAt) void markRead([n.id]);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const visible = onlyUnread ? items.filter((n) => !n.readAt) : items;
  const hasRead = items.some((n) => n.readAt);

  return (
    <div className="notif" ref={rootRef}>
      <button className="icon-btn bell" aria-label={`Notificaciones (${unread} sin leer)`} aria-expanded={open}
        aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" size={21} />
        {unread > 0 && <span className="bell__badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif__panel card" role="dialog" aria-label="Notificaciones">
          <header className="notif__head">
            <strong>Notificaciones</strong>
            <div className="chips">
              <button type="button" className={`chip${!onlyUnread ? ' chip--on' : ''}`} onClick={() => setOnlyUnread(false)}>Todas</button>
              <button type="button" className={`chip${onlyUnread ? ' chip--on' : ''}`} onClick={() => setOnlyUnread(true)}>
                Sin leer{unread > 0 ? ` (${unread})` : ''}
              </button>
            </div>
          </header>

          {visible.length === 0 ? (
            <div className="notif__empty">
              <Icon name="bell" size={26} />
              <p>{onlyUnread ? 'Estás al día: no hay avisos sin leer.' : 'Aún no tienes notificaciones.'}</p>
              <p className="muted small">Te avisaremos cuando te asignen tareas, cambien tus Sprints o tu rol.</p>
            </div>
          ) : (
            <ul className="notif__list">
              {visible.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`notif__item${n.readAt ? '' : ' notif__item--unread'}`} onClick={() => openItem(n)}>
                    {n.actorName
                      ? <Avatar name={n.actorName} src={n.actorAvatar} size={34} />
                      : <span className="notif__icon"><Icon name={KIND_ICON[n.kind] ?? 'bell'} size={17} /></span>}
                    <span className="notif__text">
                      <span className="notif__title">{n.title}</span>
                      {n.body && <span className="notif__body">{n.body}</span>}
                      <span className="notif__meta">
                        {n.projectName && (
                          <><span className="notif__dot" style={{ background: n.projectColor ?? 'var(--muted)' }} />{n.projectName} · </>
                        )}
                        {timeAgo(n.createdAt)}
                      </span>
                    </span>
                    {!n.readAt && <span className="notif__unread" aria-label="Sin leer" />}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <footer className="notif__foot">
            <button type="button" className="btn btn--ghost btn--sm" disabled={unread === 0} onClick={() => void markRead()}>
              <Icon name="check" size={15} /> Marcar todas como leídas
            </button>
            {hasRead && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void clearRead()}>Limpiar leídas</button>
            )}
            <Link to="/configuracion?seccion=notificaciones" className="notif__settings" onClick={() => setOpen(false)}
              aria-label="Configurar notificaciones" title="Configurar notificaciones">
              <Icon name="settings" size={17} />
            </Link>
          </footer>
        </div>
      )}
    </div>
  );
}
