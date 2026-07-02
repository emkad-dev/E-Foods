import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import ErrorBanner from '../components/ErrorBanner';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { session, role, initializing, signIn, signOut } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!initializing && session && role === 'admin') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await signIn(email.trim(), password);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to sign in right now.');
    } finally {
      setSubmitting(false);
    }
  };

  const signedInWithoutAdminRole = !initializing && session && role !== 'admin';

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={handleSubmit}>
        <div className="login-logo">
          <span className="wordmark-green">FEAST</span>
          <span className="wordmark-orange">Y</span>
          <span className="login-logo-suffix"> Admin</span>
        </div>
        <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
          Sign in with your admin provissioned account given by the super user to access the platform.
        </p>
        {error ? <ErrorBanner message={error} /> : null}
        {signedInWithoutAdminRole ? (
          <ErrorBanner message="This account does not have admin access." />
        ) : null}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={submitting || initializing}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        {signedInWithoutAdminRole ? (
          <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
            Sign out of current account
          </button>
        ) : null}
      </form>
    </div>
  );
}
