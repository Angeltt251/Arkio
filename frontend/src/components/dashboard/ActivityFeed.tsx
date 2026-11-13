import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { timeAgo } from '@/lib/format';
import type { ActivityItem } from '@/types';

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <section className="card">
      <header className="card__head">
        <h2>
          <Icon name="history" size={22} className="card__icon" /> Actividad Reciente
        </h2>
        <Link to="/bitacora" className="link">
          Ver todo <Icon name="arrowRight" size={16} />
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="empty">
          <p>Aún no hay actividad.</p>
          <p className="muted small">Cada cambio en tus proyectos quedará registrado en la bitácora.</p>
        </div>
      ) : (
        <ol className="timeline">
          {items.map((item) => (
            <li key={item.id} className={`timeline__item timeline__item--${item.kind}`}>
              <span className="timeline__dot" aria-hidden="true" />
              <p>
                <strong>{item.actorName}</strong> {item.message}{' '}
                {item.highlight && (
                  <span className={item.kind === 'label' ? 'tag' : 'highlight'}>
                    {item.kind === 'label' && <Icon name="tag" size={13} />}
                    {item.highlight}
                  </span>
                )}
              </p>
              <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
