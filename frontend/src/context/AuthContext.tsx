import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { AppUser } from '@/types';

interface AuthContextValue {
  user: AppUser | null;
  token: string | null;
  loading: boolean;
  isDemo: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const DEMO_KEY = 'arkio.demoUser';
const DEMO_ACCOUNTS_KEY = 'arkio.demoAccounts';

/** Cuentas registradas en modo demo (solo en este navegador). */
type DemoAccount = AppUser & { passwordHash: string };

function readDemoAccounts(): Record<string, DemoAccount> {
  try {
    const raw = localStorage.getItem(DEMO_ACCOUNTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, DemoAccount>) : {};
  } catch {
    return {};
  }
}

function saveDemoAccounts(accounts: Record<string, DemoAccount>): void {
  try {
    localStorage.setItem(DEMO_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    /* almacenamiento no disponible */
  }
}

async function hashPassword(email: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(`${email}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function persistDemoUser(user: AppUser): void {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(user));
  } catch {
    /* almacenamiento no disponible */
  }
}

function userFromSession(session: Session | null): AppUser | null {
  if (!session) return null;
  const { user } = session;
  const email = user.email ?? '';
  return {
    id: user.id,
    email,
    fullName: (user.user_metadata?.full_name as string | undefined) ?? email.split('@')[0],
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };
}

function readDemoUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    return raw ? (JSON.parse(raw) as AppUser) : null;
  } catch {
    return null;
  }
}

/** Traduce los mensajes de error más comunes de Supabase Auth. */
function translateAuthError(message: string): string {
  const map: Record<string, string> = {
    'Invalid login credentials': 'Correo o contraseña incorrectos.',
    'Email not confirmed': 'Debes confirmar tu correo antes de iniciar sesión.',
    'User already registered': 'Ya existe una cuenta con ese correo.',
  };
  return map[message] ?? message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [demoUser, setDemoUser] = useState<AppUser | null>(() => (isSupabaseConfigured ? null : readDemoUser()));
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => data.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      const key = email.toLowerCase();
      const account = readDemoAccounts()[key];
      if (!account || account.passwordHash !== (await hashPassword(key, password))) {
        throw new Error('Correo o contraseña incorrectos. Si no tienes cuenta, créala primero.');
      }
      const { passwordHash: _, ...user } = account;
      persistDemoUser(user);
      setDemoUser(user);
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(translateAuthError(error.message));
  }, []);

  const signUp = useCallback(async (fullName: string, email: string, password: string) => {
    if (!supabase) {
      const key = email.toLowerCase();
      const accounts = readDemoAccounts();
      if (accounts[key]) throw new Error('Ya existe una cuenta con ese correo.');
      const user: AppUser = { id: `demo-${crypto.randomUUID()}`, email: key, fullName, role: 'product_owner' };
      accounts[key] = { ...user, passwordHash: await hashPassword(key, password) };
      saveDemoAccounts(accounts);
      persistDemoUser(user);
      setDemoUser(user);
      return { needsConfirmation: false };
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: `${window.location.origin}/login` },
    });
    if (error) throw new Error(translateAuthError(error.message));
    return { needsConfirmation: !data.session };
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    if (!supabase) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/configuracion`,
    });
    if (error) throw new Error(translateAuthError(error.message));
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    try {
      localStorage.removeItem(DEMO_KEY);
    } catch {
      /* almacenamiento no disponible */
    }
    setDemoUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: isSupabaseConfigured ? userFromSession(session) : demoUser,
      token: session?.access_token ?? null,
      loading,
      isDemo: !isSupabaseConfigured,
      signIn,
      signUp,
      sendPasswordReset,
      signOut,
    }),
    [session, demoUser, loading, signIn, signUp, sendPasswordReset, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
