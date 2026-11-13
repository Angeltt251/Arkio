import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/format';
import type { ProjectRole } from '@/types';

type WorkspaceRole = 'owner' | 'admin' | 'member';

interface Workspace {
  id: string;
  name: string;
  role: WorkspaceRole;
}

interface Member {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  status: string;
}

interface Invitation {
  id: string;
  email: string;
  workspaceRole: string;
  projectId: string | null;
  projectRole: string | null;
  status: string;
  expiresAt: string;
  link?: string | null;
  emailSent?: boolean | null;
  emailError?: string | null;
}

interface Project {
  id: string;
  name: string;
}

interface Received {
  id: string;
  workspaceName: string;
  projectName: string | null;
  invitedBy: string;
  workspaceRole: string;
  projectRole: string | null;
  expiresAt: string;
}

interface ProjectMember {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  role: ProjectRole;
}

const WS_ROLE_LABEL: Record<WorkspaceRole, string> = { owner: 'Propietario', admin: 'Administrador', member: 'Miembro' };
const STATUS_LABEL: Record<string, string> = { active: 'Activo', invited: 'Invitado', revoked: 'Revocado' };
const PROJECT_ROLES = Object.keys(ROLE_LABEL) as ProjectRole[];

const dateFmt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function MembersPage() {
  const { token, user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null;
  const isAdmin = workspace?.role === 'owner' || workspace?.role === 'admin';

  const loadWorkspaces = useCallback(async () => {
    if (!token) return;
    try {
      const list = await apiFetch<Workspace[]>('/api/workspaces', token);
      setWorkspaces(list);
      setWorkspaceId((id) => (id && list.some((w) => w.id === id) ? id : list[0]?.id ?? null));
    } catch (err) {
      setError(errorMessage(err, 'No se pudieron cargar los espacios.'));
    }
  }, [token]);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  const load = useCallback(async () => {
    if (!token || !workspaceId) return;
    try {
      const [m, p] = await Promise.all([
        apiFetch<Member[]>(`/api/workspaces/${workspaceId}/members`, token),
        apiFetch<Project[]>(`/api/workspaces/${workspaceId}/projects`, token),
      ]);
      setMembers(m);
      setProjects(p);
      setInvitations(isAdmin ? await apiFetch<Invitation[]>(`/api/workspaces/${workspaceId}/invitations`, token) : []);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'No se pudieron cargar los miembros.'));
    }
  }, [token, workspaceId, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = async (member: Member, role: WorkspaceRole) => {
    try {
      const updated = await apiFetch<Member>(`/api/workspaces/${workspaceId}/members/${member.userId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setMembers((list) => list.map((m) => (m.userId === updated.userId ? updated : m)));
    } catch (err) {
      setError(errorMessage(err, 'No se pudo cambiar el rol.'));
    }
  };

  const revokeMember = async (member: Member) => {
    if (!window.confirm(`¿Revocar el acceso de ${member.fullName || member.email}? Perderá el acceso a todos los proyectos del espacio.`)) return;
    try {
      await apiFetch(`/api/workspaces/${workspaceId}/members/${member.userId}/revoke`, token, { method: 'POST' });
      setMembers((list) => list.map((m) => (m.userId === member.userId ? { ...m, status: 'revoked' } : m)));
    } catch (err) {
      setError(errorMessage(err, 'No se pudo revocar el acceso.'));
    }
  };

  const revokeInvitation = async (inv: Invitation) => {
    try {
      await apiFetch(`/api/workspaces/${workspaceId}/invitations/${inv.id}/revoke`, token, { method: 'POST' });
      setInvitations((list) => list.map((i) => (i.id === inv.id ? { ...i, status: 'revoked' } : i)));
    } catch (err) {
      setError(errorMessage(err, 'No se pudo revocar la invitación.'));
    }
  };

  const received = <ReceivedInvitations token={token} onAccepted={(workspaceName) => {
    setWorkspaceId(null);
    void loadWorkspaces().then(() => setError(null));
    window.alert(`Ahora eres parte de ${workspaceName}.`);
  }} />;

  if (workspaces && workspaces.length === 0) {
    return (
      <div className="dashboard">
        <div className="page-head">
          <div>
            <h1>Miembros</h1>
            <p className="muted">Invita a tu equipo y asigna roles.</p>
          </div>
        </div>
        {received}
        <div className="empty">
          <p>Primero crea un espacio de trabajo.</p>
          <Link to="/espacios" className="btn btn--primary btn--sm" style={{ justifySelf: 'center' }}>
            <Icon name="plus" size={16} /> Crear espacio
          </Link>
        </div>
      </div>
    );
  }

  const pending = invitations.filter((i) => i.status === 'pending' || i.status === 'expired');

  return (
    <div className="dashboard">
      <div className="page-head">
        <div>
          <h1>Miembros</h1>
          <p className="muted">
            {isAdmin ? 'Invita a tu equipo, asigna roles y gestiona accesos.' : 'Integrantes de este espacio de trabajo.'}
          </p>
        </div>
        {workspaces && workspaces.length > 1 && (
          <select className="select" aria-label="Espacio de trabajo" value={workspaceId ?? ''}
            onChange={(e) => setWorkspaceId(e.target.value)}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="form__error" role="alert">{error}</p>}

      {received}

      <div className="grid grid--main">
        <section className="card">
          <header className="card__head">
            <h2>
              <Icon name="users" size={22} className="card__icon" /> Integrantes de {workspace?.name ?? '…'}
            </h2>
            <span className="muted small">{members.filter((m) => m.status === 'active').length} activos</span>
          </header>
          <ul className="member-list">
            {members.map((m) => {
              const editable = isAdmin && m.role !== 'owner' && m.userId !== user?.id && m.status === 'active';
              return (
                <li key={m.userId} className={`member-row${m.status !== 'active' ? ' member-row--off' : ''}`}>
                  <Avatar name={m.fullName || m.email} src={m.avatarUrl} size={36} />
                  <div className="member-row__info">
                    <strong>{m.fullName || m.email}{m.userId === user?.id ? ' (tú)' : ''}</strong>
                    <span className="muted small">{m.email}</span>
                  </div>
                  {m.status !== 'active' ? (
                    <span className="pill pill--closed">{STATUS_LABEL[m.status] ?? m.status}</span>
                  ) : editable ? (
                    <>
                      <select className="select" aria-label={`Rol de ${m.fullName}`} value={m.role}
                        onChange={(e) => changeRole(m, e.target.value as WorkspaceRole)}>
                        <option value="admin">Administrador</option>
                        <option value="member">Miembro</option>
                      </select>
                      <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => revokeMember(m)}>
                        Revocar
                      </button>
                    </>
                  ) : (
                    <span className={`pill ${m.role === 'owner' ? 'pill--active' : 'pill--planning'}`}>{WS_ROLE_LABEL[m.role]}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {isAdmin && workspaceId ? (
          <InviteCard workspaceId={workspaceId} token={token} projects={projects} pending={pending}
            onCreated={(inv) => setInvitations((list) => [inv, ...list.filter((i) => i.id !== inv.id)])}
            onRevoke={revokeInvitation} />
        ) : (
          <section className="card">
            <header className="card__head">
              <h2><Icon name="mail" size={22} className="card__icon" /> Invitaciones</h2>
            </header>
            <p className="muted small">Solo el propietario o un administrador del espacio puede invitar personas.</p>
          </section>
        )}
      </div>

      {workspaceId && (
        <ProjectTeams token={token} projects={projects} members={members.filter((m) => m.status === 'active')} />
      )}
    </div>
  );
}

// ------------------------------------------------------------ invitar
interface InviteCardProps {
  workspaceId: string;
  token: string | null;
  projects: Project[];
  pending: Invitation[];
  onCreated: (inv: Invitation) => void;
  onRevoke: (inv: Invitation) => void;
}

function InviteCard({ workspaceId, token, projects, pending, onCreated, onRevoke }: InviteCardProps) {
  const [email, setEmail] = useState('');
  const [workspaceRole, setWorkspaceRole] = useState<'member' | 'admin'>('member');
  const [projectId, setProjectId] = useState('');
  const [projectRole, setProjectRole] = useState<ProjectRole>('developer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const inv = await apiFetch<Invitation>(`/api/workspaces/${workspaceId}/invitations`, token, {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          workspaceRole,
          projectId: projectId || null,
          projectRole: projectId ? projectRole : null,
        }),
      });
      onCreated(inv);
      setCreated(inv);
      setCopied(false);
      setEmail('');
    } catch (err) {
      setError(errorMessage(err, 'No se pudo crear la invitación.'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async (inv: Invitation) => {
    setError(null);
    try {
      const updated = await apiFetch<Invitation>(`/api/workspaces/${workspaceId}/invitations/${inv.id}/resend`, token, {
        method: 'POST',
      });
      onCreated(updated);
      setCreated(updated);
      setCopied(false);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo reenviar la invitación.'));
    }
  };

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      window.prompt('Copia el enlace:', link);
    }
  };

  return (
    <section className="card">
      <header className="card__head">
        <h2><Icon name="mail" size={22} className="card__icon" /> Invitar</h2>
      </header>
      <form className="form" style={{ marginTop: 0 }} onSubmit={submit} noValidate>
        <label className="field">
          <span>Correo</span>
          <div className="input">
            <Icon name="mail" size={18} />
            <input type="email" required placeholder="compañero@correo.cl" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </label>
        <div className="dialog__row">
          <label className="field">
            <span>Rol en el espacio</span>
            <select className="select" value={workspaceRole} onChange={(e) => setWorkspaceRole(e.target.value as 'member' | 'admin')}>
              <option value="member">Miembro</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <label className="field">
            <span>Proyecto (opcional)</span>
            <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Ninguno</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        </div>
        {projectId && (
          <label className="field">
            <span>Rol en el proyecto</span>
            <select className="select" value={projectRole} onChange={(e) => setProjectRole(e.target.value as ProjectRole)}>
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="form__error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())}>
          {busy ? 'Creando…' : 'Crear invitación'}
        </button>
      </form>

      {created?.link && (
        <div className={`invite-link${created.emailSent ? '' : ' invite-link--warn'}`} role="status">
          <p className="small">
            {created.emailSent
              ? <>✓ Enviamos la invitación a <strong>{created.email}</strong>. Si no la ve, que revise Spam o compártele este enlace:</>
              : <>⚠ No se pudo enviar el correo a <strong>{created.email}</strong>. Compártele este enlace por otro medio
                (también verá la invitación al entrar a Arkio con ese correo):</>}
          </p>
          {!created.emailSent && created.emailError && <p className="small"><strong>Motivo:</strong> {created.emailError}</p>}
          <div className="invite-link__row">
            <code>{created.link}</code>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => copy(created.link!)}>
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="muted small">Por seguridad, este enlace solo se muestra ahora.</p>
        </div>
      )}

      {pending.length > 0 && (
        <>
          <h3 className="section-title">Pendientes</h3>
          <ul className="member-list">
            {pending.map((inv) => {
              const expired = inv.status === 'expired' || new Date(inv.expiresAt) <= new Date();
              return (
                <li key={inv.id} className="member-row">
                  <Avatar name={inv.email} size={30} />
                  <div className="member-row__info">
                    <strong>{inv.email}</strong>
                    <span className="muted small">
                      {expired ? 'Vencida' : `Vence ${dateFmt.format(new Date(inv.expiresAt))}`}
                    </span>
                  </div>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => resend(inv)}
                    title="Envía un enlace nuevo y renueva el vencimiento">
                    Reenviar
                  </button>
                  {!expired && (
                    <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => onRevoke(inv)}>
                      Revocar
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------ equipos por proyecto
interface ProjectTeamsProps {
  token: string | null;
  projects: Project[];
  members: Member[];
}

function ProjectTeams({ token, projects, members }: ProjectTeamsProps) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [team, setTeam] = useState<ProjectMember[]>([]);
  const [addUser, setAddUser] = useState('');
  const [addRole, setAddRole] = useState<ProjectRole>('developer');
  const [error, setError] = useState<string | null>(null);

  const selected = projectId ?? projects[0]?.id ?? null;

  useEffect(() => {
    if (!token || !selected) return setTeam([]);
    apiFetch<ProjectMember[]>(`/api/projects/${selected}/members`, token)
      .then((t) => {
        setTeam(t);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err, 'No se pudo cargar el equipo.')));
  }, [token, selected]);

  const setRole = async (userId: string, role: ProjectRole) => {
    try {
      const m = await apiFetch<ProjectMember>(`/api/projects/${selected}/members/${userId}`, token, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      setTeam((list) => (list.some((x) => x.userId === m.userId) ? list.map((x) => (x.userId === m.userId ? m : x)) : [...list, m]));
      setError(null);
      return true;
    } catch (err) {
      setError(errorMessage(err, 'No se pudo actualizar el equipo.'));
      return false;
    }
  };

  const remove = async (m: ProjectMember) => {
    try {
      await apiFetch(`/api/projects/${selected}/members/${m.userId}`, token, { method: 'DELETE' });
      setTeam((list) => list.filter((x) => x.userId !== m.userId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo quitar del proyecto.'));
    }
  };

  const candidates = members.filter((m) => !team.some((t) => t.userId === m.userId));

  return (
    <section className="card" style={{ marginTop: '1.25rem' }}>
      <header className="card__head">
        <h2><Icon name="layers" size={22} className="card__icon" /> Equipos de proyecto</h2>
        {projects.length > 1 && (
          <select className="select" aria-label="Proyecto" value={selected ?? ''} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </header>

      {projects.length === 0 ? (
        <p className="muted small">Este espacio aún no tiene proyectos.</p>
      ) : (
        <>
          <p className="muted small" style={{ marginBottom: '0.8rem' }}>
            Solo los integrantes del proyecto pueden ser responsables de tareas en su tablero.
          </p>
          {error && <p className="form__error" role="alert">{error}</p>}
          <ul className="member-list">
            {team.map((m) => (
              <li key={m.userId} className="member-row">
                <Avatar name={m.fullName || m.email} src={m.avatarUrl} size={32} />
                <div className="member-row__info">
                  <strong>{m.fullName || m.email}</strong>
                  <span className="muted small">{m.email}</span>
                </div>
                <select className="select" aria-label={`Rol de ${m.fullName}`} value={m.role}
                  onChange={(e) => setRole(m.userId, e.target.value as ProjectRole)}>
                  {PROJECT_ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
                <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => remove(m)}>Quitar</button>
              </li>
            ))}
          </ul>

          {candidates.length > 0 && (
            <form className="team-add" onSubmit={async (e) => {
              e.preventDefault();
              if (addUser && (await setRole(addUser, addRole))) setAddUser('');
            }}>
              <select className="select" aria-label="Integrante" value={addUser} onChange={(e) => setAddUser(e.target.value)}>
                <option value="">Agregar integrante del espacio…</option>
                {candidates.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.fullName || m.email}</option>
                ))}
              </select>
              <select className="select" aria-label="Rol" value={addRole} onChange={(e) => setAddRole(e.target.value as ProjectRole)}>
                {PROJECT_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
              <button className="btn btn--primary btn--sm" disabled={!addUser}>
                <Icon name="plus" size={16} /> Agregar
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------ invitaciones recibidas
function ReceivedInvitations({ token, onAccepted }: { token: string | null; onAccepted: (workspaceName: string) => void }) {
  const [items, setItems] = useState<Received[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch<Received[]>('/api/invitations/received', token)
      .then(setItems)
      .catch(() => setItems([]));
  }, [token]);

  if (items.length === 0) return null;

  const respond = async (inv: Received, action: 'accept' | 'decline') => {
    setBusy(inv.id);
    setError(null);
    try {
      await apiFetch(`/api/invitations/received/${inv.id}/${action}`, token, { method: 'POST' });
      setItems((list) => list.filter((i) => i.id !== inv.id));
      if (action === 'accept') onAccepted(inv.workspaceName);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo responder la invitación.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card received" style={{ marginBottom: '1.25rem' }}>
      <header className="card__head">
        <h2><Icon name="mail" size={22} className="card__icon" /> Invitaciones para ti</h2>
      </header>
      {error && <p className="form__error" role="alert">{error}</p>}
      <ul className="member-list">
        {items.map((inv) => (
          <li key={inv.id} className="member-row">
            <div className="member-row__info">
              <strong>{inv.projectName ? `${inv.projectName} · ${inv.workspaceName}` : inv.workspaceName}</strong>
              <span className="muted small">
                {inv.invitedBy} te invitó como {WS_ROLE_LABEL[inv.workspaceRole as WorkspaceRole] ?? inv.workspaceRole}
                {inv.projectRole ? ` · ${ROLE_LABEL[inv.projectRole] ?? inv.projectRole}` : ''}
                {' · '}vence {dateFmt.format(new Date(inv.expiresAt))}
              </span>
            </div>
            <button type="button" className="btn btn--primary btn--sm" disabled={busy === inv.id} onClick={() => respond(inv, 'accept')}>
              Aceptar
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy === inv.id} onClick={() => respond(inv, 'decline')}>
              Rechazar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
