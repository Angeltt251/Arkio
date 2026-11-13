import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await sendPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el correo.');
    }
  };

  return (
    <AuthLayout title="Recuperar contraseña" subtitle="Te enviaremos un enlace para crear una nueva contraseña.">
      {sent ? (
        <p className="notice">Si existe una cuenta con {email}, recibirás un correo en unos minutos.</p>
      ) : (
        <form className="form" onSubmit={onSubmit}>
          <label className="field">
            <span>Correo electrónico</span>
            <div className="input">
              <Icon name="mail" size={18} />
              <input type="email" required placeholder="tu@correo.cl" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </label>
          {error && <p className="form__error" role="alert">{error}</p>}
          <button className="btn btn--primary btn--block" disabled={!email}>Enviar enlace</button>
        </form>
      )}
      <p className="auth__switch">
        <Link to="/login" className="link">Volver a iniciar sesión</Link>
      </p>
    </AuthLayout>
  );
}
