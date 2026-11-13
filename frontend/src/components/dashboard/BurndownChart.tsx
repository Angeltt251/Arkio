import { useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { Burndown } from '@/types';

const W = 420;
const H = 190;
const PAD = { top: 12, right: 22, bottom: 28, left: 30 };

function niceMax(value: number): number {
  if (value <= 5) return 5;
  const step = value <= 20 ? 5 : value <= 50 ? 10 : 25;
  return Math.ceil(value / step) * step;
}

export function BurndownChart({ data }: { data: Burndown | null }) {
  const chart = useMemo(() => {
    if (!data || data.points.length === 0) return null;
    const pts = data.points;
    const max = niceMax(Math.max(...pts.map((p) => Math.max(p.ideal, p.real ?? 0))));
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / Math.max(pts.length - 1, 1)) * innerW;
    const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

    const ideal = pts.map((p, i) => `${x(i)},${y(p.ideal)}`).join(' ');
    // Línea real "en escalera": así se ve cuándo se completó cada tarea
    const realPts = pts.filter((p) => p.real != null);
    const real = realPts
      .map((p, i) => (i === 0 ? `${x(0)},${y(p.real!)}` : `${x(i)},${y(realPts[i - 1].real!)} ${x(i)},${y(p.real!)}`))
      .join(' ');

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
    const labelEvery = pts.length > 6 ? 2 : 1;
    const xLabels = pts
      .map((p, i) => ({ label: p.label, x: x(i), i }))
      .filter(({ i }) => i === pts.length - 1 || (i % labelEvery === 0 && i !== pts.length - 2));

    return { ideal, real, ticks, xLabels, y, x };
  }, [data]);

  return (
    <section className="card">
      <header className="card__head">
        <h2>
          <Icon name="chart" size={22} className="card__icon" /> Burndown Chart
        </h2>
        {data && (
          <select className="select" aria-label="Sprint del gráfico" defaultValue={data.sprintId}>
            <option value={data.sprintId}>{data.sprintLabel}</option>
          </select>
        )}
      </header>

      {chart ? (
        <>
          <div className="legend">
            <span className="legend__item legend__item--ideal">Ideal</span>
            <span className="legend__item legend__item--real">Real</span>
          </div>
          <svg className="burndown" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trabajo restante por día del Sprint">
            {chart.ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={chart.y(t)} y2={chart.y(t)} className="burndown__grid" />
                <text x={PAD.left - 8} y={chart.y(t) + 4} textAnchor="end" className="burndown__label">
                  {t}
                </text>
              </g>
            ))}
            {chart.xLabels.map(({ label, x, i }) => (
              <g key={i}>
                <line x1={x} x2={x} y1={PAD.top} y2={H - PAD.bottom} className="burndown__grid burndown__grid--v" />
                <text x={x} y={H - 8} textAnchor="middle" className="burndown__label">
                  {label}
                </text>
              </g>
            ))}
            <polyline points={chart.ideal} className="burndown__ideal" />
            {chart.real && <polyline points={chart.real} className="burndown__real" />}
          </svg>
        </>
      ) : (
        <div className="empty">
          <p>Sin datos suficientes.</p>
          <p className="muted small">El burndown aparece cuando hay un Sprint en curso con tareas.</p>
        </div>
      )}
    </section>
  );
}
