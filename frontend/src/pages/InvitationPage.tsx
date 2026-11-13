import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { AuthLayout } from './auth/AuthLayout';

interface Preview {
  workspaceName: string;
  projectName: string | null;
  invitedBy: string;
  email: string;
  status: string;
  expiresAt: string;
}

/** Destino del enlace que llega por correo: /invitacion/:token */
export function InvitationPage() {
  const { token: inviteToken = '' } = useParams();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Preview>(`/api/invitations/${inviteToken}`, null)
      .then(setPreview)
      .catch((e: Error) => setError(e.message));
  }, [inviteToken]);

  const respond = async (action: 'accept' | 'decline') => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/invitations/${inviteToken}/${action}`, token, { method: 'POST' });
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo responder la invitación.');
    } finally {
      setBusy(false);
    }
  };

  const target = preview?.projectName ? `${preview.projectName} · ${preview.workspaceName}` : preview?.workspaceName;

  return (
    <AuthLayout title="Invitación a Arkio" subtitle={preview ? `${preview.invitedBy} te invitó a ${target}` : 'Cargando invitación…'}>
      {error && <p className="form__error" role="alert">{error}</p>}
      {preview && preview.status !== 'pending' && <p className="notice">Esta invitación ya no está vigente ({preview.status}).</p>}
      {preview && preview.status === 'pending' && (
        user ? (
          <div className="form">
            <p className="muted">La invitación es para <strong>{preview.email}</strong>.</p>
            <button className="btn btn--primary btn--block" disabled={busy} onClick={() => respond('accept')}>Aceptar invitación</button>
            <button className="btn btn--ghost btn--block" disabled={busy} onClick={() => respond('decline')}>Rechazar</button>
          </div>
        ) : (
          <div className="form">
            <p className="muted">Inicia sesión o crea una cuenta con <strong>{preview.email}</strong> para aceptarla.</p>
            <Link className="btn btn--primary btn--block" to="/login" state={{ from: `/invitacion/${inviteToken}` }}>Iniciar sesión</Link>
            <Link className="btn btn--ghost btn--block" to="/registro">Crear cuenta</Link>
          </div>
        )
      )}
    </AuthLayout>
  );
}
