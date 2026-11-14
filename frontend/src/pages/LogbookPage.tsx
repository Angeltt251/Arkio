import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { API_URL, apiFetch } from '@/lib/api';
import { connectRealtime } from '@/lib/realtime';

interface LogChange {
  field: string;
  old: string | null;
  new: string | null;
}

interface LogEntry {
  id: number;
  actorId: string | null;
  actorName: string;
  message: string;
  highlight: string | null;
  kind: string;
  entityType: string;
  entityLabel: string;
  action: string;
  actionLabel: string;
  source: string;
  createdAt: string;
  changes: LogChange[];
}

interface LogbookPage {
  items: LogEntry[];
  nextBeforeId: number | null;
  actors: { id: string; name: string }[];
}

interface ProjectOption {
  id: string;
  name: string;
  key: string;
}

interface Filters {
  actorId: string;
  category: string;
  since: string;
  until: string;
  q: string;
}

const CATEGORIES: [string, string][] = [
  ['', 'Todo'],
  ['tareas', 'Tareas'],
  ['columnas', 'Columnas'],
  ['equipo', 'Equipo'],
  ['proyecto', 'Proyecto'],
  ['comentarios', 'Comentarios'],
  ['sprints', 'Sprints'],
  ['backlog', 'Backlog'],
];

const EMPTY_FILTERS: Filters = { actorId: '', category: '', since: '', until: '', q: '' };
const PAGE_SIZE = 40;

const timeFmt = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fullFmt = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'medium' });

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
  const text = dayFmt.format(d);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function queryString(filters: Filters, extra: Record<string, string | number | null> = {}): string {
  const params = new URLSearchParams();
  if (filters.actorId) params.set('actor_id', filters.actorId);
  if (filters.category) params.set('category', filters.category);
  if (filters.since) params.set('since', filters.since);
  if (filters.until) params.set('until', filters.until);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  for (const [k, v] of Object.entries(extra)) if (v != null) params.set(k, String(v));
  return params.toString();
}

function groupByDay(items: LogEntry[]): [string, LogEntry[]][] {
  const groups: [string, LogEntry[]][] = [];
  for (const item of items) {
    const label = dayLabel(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(item);
    else groups.push([label, [item]]);
  }
  return groups;
}

export function LogbookPage() {
  const { token } = useAuth();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<LogEntry[] | null>(null);
  const [actors, setActors] = useState<LogbookPage['actors']>([]);
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [printItems, setPrintItems] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadTimer = useRef<number | undefined>(undefined);

  const projectId = params.get('proyecto') ?? projects?.[0]?.id ?? null;
  const project = projects?.find((p) => p.id === projectId) ?? null;
  const filtered = Object.values(filters).some((v) => v);

  useEffect(() => {
    if (!token) return;
    apiFetch<ProjectOption[]>('/api/projects', token)
      .then(setProjects)
      .catch((err) => setError(errorMessage(err, 'No se pudieron cargar los proyectos.')));
  }, [token]);

  // La búsqueda se aplica al dejar de escribir
  useEffect(() => {
    const id = window.setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 400);
    return () => window.clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    if (!token || !projectId) return;
    try {
      const page = await apiFetch<LogbookPage>(
        `/api/projects/${projectId}/logbook?${queryString(filters, { limit: PAGE_SIZE })}`, token,
      );
      setItems(page.items);
      setActors(page.actors);
      setNextBeforeId(page.nextBeforeId);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo cargar la bitácora.'));
    }
  }, [token, projectId, filters]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  // Tiempo real: los registros nuevos aparecen solos
  useEffect(() => {
    if (!token || !projectId) return;
    const close = connectRealtime(token, (msg) => {
      if (msg.type !== 'activity' || msg.data?.project_id !== projectId) return;
      window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => void load(), 600);
    });
    return () => {
      window.clearTimeout(reloadTimer.current);
      close();
    };
  }, [token, projectId, load]);

  const loadMore = async () => {
    if (!nextBeforeId || !projectId) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<LogbookPage>(
        `/api/projects/${projectId}/logbook?${queryString(filters, { limit: PAGE_SIZE, before_id: nextBeforeId })}`, token,
      );
      setItems((list) => [...(list ?? []), ...page.items]);
      setNextBeforeId(page.nextBeforeId);
    } catch (err) {
      setError(errorMessage(err, 'No se pudieron cargar más registros.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const exportCsv = async () => {
    if (!projectId) return;
    setExporting('csv');
    try {
      const response = await fetch(`${API_URL}/api/projects/${projectId}/logbook.csv?${queryString(filters)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('No se pudo generar el CSV.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `bitacora-${project?.key ?? 'proyecto'}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo exportar.'));
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    if (!projectId) return;
    setExporting('pdf');
    try {
      const page = await apiFetch<LogbookPage>(
        `/api/projects/${projectId}/logbook?${queryString(filters, { limit: 1000 })}`, token,
      );
      setPrintItems(page.items);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo preparar el PDF.'));
      setExporting(null);
    }
  };

  // Imprimir cuando la vista de impresión ya está en pantalla
  useEffect(() => {
    if (!printItems) return;
    const id = window.setTimeout(() => {
      window.print();
      setPrintItems(null);
      setExporting(null);
    }, 100);
    return () => window.clearTimeout(id);
  }, [printItems]);

  const toggle = (id: number) =>
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const groups = useMemo(() => groupByDay(items ?? []), [items]);

  if (projects && projects.length === 0) {
    return (
      <div className="dashboard">
        <div className="page-head"><div><h1>Bitácora</h1></div></div>
        <div className="empty">
          <p>Aún no tienes proyectos.</p>
          <Link to="/espacios" className="btn btn--primary btn--sm" style={{ justifySelf: 'center' }}>
            <Icon name="plus" size={16} /> Crear un proyecto
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard logbook">
      <div className="page-head no-print">
        <div>
          <h1>Bitácora</h1>
          <p className="muted">Historial inmutable: quién hizo qué y cuándo. Nadie puede editar ni borrar estos registros.</p>
        </div>
        <div className="logbook__actions">
          {projects && projects.length > 1 && (
            <select className="select" aria-label="Proyecto" value={projectId ?? ''}
              onChange={(e) => { setParams({ proyecto: e.target.value }); setExpanded(new Set()); }}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={exportCsv} disabled={!items || exporting !== null}>
            {exporting === 'csv' ? 'Generando…' : 'Exportar CSV'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={exportPdf} disabled={!items || exporting !== null}>
            {exporting === 'pdf' ? 'Preparando…' : 'Exportar PDF'}
          </button>
        </div>
      </div>

      <section className="card logbook__filters no-print" aria-label="Filtros">
        <label className="field">
          <span>Buscar</span>
          <div className="input">
            <Icon name="search" size={16} />
            <input type="search" placeholder="Título, nombre, valor…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </label>
        <label className="field">
          <span>Integrante</span>
          <select className="select" value={filters.actorId} onChange={(e) => setFilters({ ...filters, actorId: e.target.value })}>
            <option value="">Todos</option>
            {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Tipo</span>
          <select className="select" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
            {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Desde</span>
          <input className="select" type="date" value={filters.since} max={filters.until || undefined}
            onChange={(e) => setFilters({ ...filters, since: e.target.value })} />
        </label>
        <label className="field">
          <span>Hasta</span>
          <input className="select" type="date" value={filters.until} min={filters.since || undefined}
            onChange={(e) => setFilters({ ...filters, until: e.target.value })} />
        </label>
        {filtered && (
          <button type="button" className="btn btn--ghost btn--sm logbook__clear"
            onClick={() => { setFilters(EMPTY_FILTERS); setSearch(''); }}>
            Limpiar filtros
          </button>
        )}
      </section>

      {error && <p className="form__error no-print" role="alert">{error}</p>}

      {!items ? (
        <div className="skeleton-grid no-print" aria-busy="true" aria-label="Cargando bitácora">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="empty no-print">
          <p>{filtered ? 'Ningún registro coincide con los filtros.' : 'Aún no hay actividad en este proyecto.'}</p>
          <p className="muted small">Cada cambio en tareas, columnas y equipo queda registrado aquí automáticamente.</p>
        </div>
      ) : (
        <div className="no-print">
          {groups.map(([day, entries]) => (
            <section key={day} className="log-day" aria-label={day}>
              <h2 className="log-day__title">{day}</h2>
              <ol className="log-list">
                {entries.map((e) => {
                  const open = expanded.has(e.id);
                  return (
                    <li key={e.id} className={`log-item log-item--${e.kind}`}>
                      <Avatar name={e.actorName} size={34} />
                      <div className="log-item__body">
                        <p>
                          <strong>{e.actorName}</strong> {e.message}
                          {e.highlight && <> <span className="log-item__hl">{e.highlight}</span></>}
                        </p>
                        <div className="log-item__meta">
                          <time dateTime={e.createdAt} title={fullFmt.format(new Date(e.createdAt))}>
                            {timeFmt.format(new Date(e.createdAt))}
                          </time>
                          <span className="log-tag">{e.actionLabel}</span>
                          <span className="log-tag log-tag--soft">{e.entityLabel}</span>
                          {e.source !== 'Aplicación' && <span className="log-tag log-tag--warn">{e.source}</span>}
                          {e.changes.length > 0 && (
                            <button type="button" className="link small log-item__toggle" aria-expanded={open}
                              onClick={() => toggle(e.id)}>
                              {open ? 'Ocultar cambios' : `Ver cambios (${e.changes.length})`}
                            </button>
                          )}
                        </div>
                        {open && <ChangesTable changes={e.changes} />}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          {nextBeforeId && (
            <div style={{ display: 'grid', justifyItems: 'center', marginTop: '1rem' }}>
              <button type="button" className="btn btn--ghost" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Cargando…' : 'Cargar registros anteriores'}
              </button>
            </div>
          )}
        </div>
      )}

      {printItems && project && <PrintView project={project} items={printItems} filtered={filtered} />}
    </div>
  );
}

function ChangesTable({ changes }: { changes: LogChange[] }) {
  return (
    <table className="log-changes">
      <thead>
        <tr><th>Campo</th><th>Antes</th><th>Después</th></tr>
      </thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.field}>
            <td>{c.field}</td>
            <td className="log-changes__old">{c.old ?? '—'}</td>
            <td className="log-changes__new">{c.new ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Versión para imprimir / guardar como PDF (solo visible al imprimir). */
function PrintView({ project, items, filtered }: { project: ProjectOption; items: LogEntry[]; filtered: boolean }) {
  return (
    <div className="print-only">
      <h1>Bitácora · {project.name}</h1>
      <p>
        Generado el {fullFmt.format(new Date())} · {items.length} registros{filtered ? ' (con filtros aplicados)' : ''}
      </p>
      <table className="log-print">
        <thead>
          <tr><th>Fecha</th><th>Integrante</th><th>Acción</th><th>Detalle</th></tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>{fullFmt.format(new Date(e.createdAt))}</td>
              <td>{e.actorName}</td>
              <td>{e.actionLabel} · {e.entityLabel}</td>
              <td>
                {e.message}{e.highlight ? ` ${e.highlight}` : ''}
                {e.changes.length > 0 && (
                  <ul>
                    {e.changes.map((c) => <li key={c.field}>{c.field}: {c.old ?? '—'} → {c.new ?? '—'}</li>)}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
