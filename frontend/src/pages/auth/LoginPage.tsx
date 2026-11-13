import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={from} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Bienvenido de vuelta" subtitle="Inicia sesión para continuar con tus proyectos.">
      <form className="form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span>Correo electrónico</span>
          <div className="input">
            <Icon name="mail" size={18} />
            <input type="email" autoComplete="email" placeholder="tu@correo.cl" required value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </div>
        </label>

        <label className="field">
          <span className="field__row">
            Contraseña
            <Link to="/recuperar" className="link small">¿Olvidaste tu contraseña?</Link>
          </span>
          <div className="input">
            <Icon name="lock" size={18} />
            <input type="password" autoComplete="current-password" placeholder="••••••••" required minLength={6}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </label>

        {error && <p className="form__error" role="alert">{error}</p>}

        <button className="btn btn--primary btn--block" disabled={submitting || !email || !password}>
          {submitting ? 'Ingresando…' : 'Iniciar sesión'}
        </button>
      </form>

      <p className="auth__switch">
        ¿No tienes cuenta? <Link to="/registro" className="link">Crear cuenta</Link>
      </p>
    </AuthLayout>
  );
}
