import { Icon, type IconName } from '@/components/ui/Icon';
import type { Stat } from '@/types';

type Tone = 'violet' | 'green' | 'orange' | 'blue';

interface StatCardProps {
  label: string;
  icon: IconName;
  tone: Tone;
  stat: Stat;
}

function Sparkline({ values }: { values: number[] }) {
  const w = 58;
  const h = 28;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * w;
    const y = h - 3 - ((v - min) / range) * (h - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatCard({ label, icon, tone, stat }: StatCardProps) {
  const sign = stat.delta > 0 ? '+' : stat.delta < 0 ? '−' : '+';
  const deltaText = `${sign}${Math.abs(stat.delta)}${stat.deltaKind === 'percent' ? '%' : ''}`;
  return (
    <article className={`stat-card stat-card--${tone}`}>
      <span className="stat-card__icon">
        <Icon name={icon} size={24} />
      </span>
      <div className="stat-card__body">
        <h3>{label}</h3>
        <div className="stat-card__value">
          <strong>{stat.value}</strong>
          <span className={`delta ${stat.delta < 0 ? 'delta--down' : ''}`} title="Variación en los últimos 7 días">
            <Icon name="arrowUp" size={12} strokeWidth={2.6} />
            {deltaText}
          </span>
        </div>
      </div>
      <Sparkline values={stat.trend} />
    </article>
  );
}
