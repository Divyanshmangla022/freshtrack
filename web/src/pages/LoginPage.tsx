import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ApiError } from '../api/client';

// Mirrors the server-side EMAIL_REGEX for instant client-side feedback.
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function LoginPage() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    return <Navigate to={user.role === 'CENTRAL_ADMIN' ? '/' : '/hub'} replace />;
  }

  const emailValid = EMAIL_REGEX.test(email);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailValid) {
      toast.error('Enter a valid email address');
      return;
    }
    setBusy(true);
    try {
      const u = await login(email, password);
      toast.success(`Welcome, ${u.username}`);
      navigate(u.role === 'CENTRAL_ADMIN' ? '/' : '/hub', { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const fill = (e: string, p: string) => {
    setEmail(e);
    setPassword(p);
  };

  return (
    <div className="auth">
      <div className="panel">
        <div className="logo">
          <h1>
            <span className="dot" />
            FreshTrack
          </h1>
          <p className="muted">Inbound Fruit &amp; Vegetable Receiving</p>
        </div>

        <div className="card">
          <form onSubmit={submit}>
            <div className="field">
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@freshtrack.io"
                autoFocus
                required
                aria-invalid={email.length > 0 && !emailValid}
              />
              {email.length > 0 && !emailValid && (
                <div className="hint" style={{ color: 'var(--bad)' }}>
                  Enter a valid email address
                </div>
              )}
            </div>
            <div className="field">
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <button className="btn btn-primary btn-block btn-lg" disabled={busy || !emailValid || password.length === 0}>
              {busy ? <span className="spin" /> : 'Sign in'}
            </button>
          </form>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="muted" style={{ fontSize: '0.8rem', marginBottom: 8 }}>
            Demo accounts (click to fill)
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => fill('admin@freshtrack.io', 'Admin@12345')}>
              Central Admin
            </button>
            <button className="btn" onClick={() => fill('nyc.hub@freshtrack.io', 'Hub@12345')}>
              NYC Hub User
            </button>
            <button className="btn" onClick={() => fill('regional.hub@freshtrack.io', 'Hub@12345')}>
              Multi-hub User
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
