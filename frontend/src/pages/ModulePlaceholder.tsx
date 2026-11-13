import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import type { NavItem } from '@/config/navigation';

/** Página temporal para los módulos que se construyen en las próximas iteraciones. */
export function ModulePlaceholder({ item }: { item: NavItem }) {
  return (
    <div className="placeholder">
      <span className="placeholder__icon">
        <Icon name={item.icon} size={34} />
      </span>
      <h1>{item.label}</h1>
      {item.iteration && <span className="pill pill--planning">{item.iteration}</span>}
      <p className="muted">{item.description}</p>
      <Link to="/" className="btn btn--ghost">
        Volver al inicio
      </Link>
    </div>
  );
}
