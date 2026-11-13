import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { AuthLayout } from './AuthLayout';

export function RegisterPage() {
  const { user, signUp } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    setSubmitting(true);
    try {
      const { needsConfirmation } = await signUp(fullName.trim(), email.trim(), password);
      if (needsConfirmation) setConfirmSent(true);
      else navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta.');
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmSent) {
    return (
      <AuthLayout title="Revisa tu correo" subtitle={`Te enviamos un enlace de confirmación a ${email}.`}>
        <p className="muted">Cuando confirmes tu cuenta podrás iniciar sesión.</p>
        <Link to="/login" className="btn btn--primary btn--block">Ir a iniciar sesión</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Crea tu cuenta" subtitle="Organiza tu equipo con Scrumban y deja trazabilidad de cada avance.">
      <form className="form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span>Nombre completo</span>
          <div className="input">
            <Icon name="user" size={18} />
            <input autoComplete="name" placeholder="José Flores" required value={fullName}
              onChange={(e) => setFullName(e.target.value)} />
          </div>
        </label>

        <label className="field">
          <span>Correo electrónico</span>
          <div className="input">
            <Icon name="mail" size={18} />
            <input type="email" autoComplete="email" placeholder="tu@correo.cl" required value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </div>
        </label>

        <label className="field">
          <span>Contraseña</span>
          <div className="input">
            <Icon name="lock" size={18} />
            <input type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres" required minLength={8}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </label>

        {error && <p className="form__error" role="alert">{error}</p>}

        <button className="btn btn--primary btn--block" disabled={submitting || !fullName || !email || !password}>
          {submitting ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>

      <p className="auth__switch">
        ¿Ya tienes cuenta? <Link to="/login" className="link">Inicia sesión</Link>
      </p>
    </AuthLayout>
  );
}
