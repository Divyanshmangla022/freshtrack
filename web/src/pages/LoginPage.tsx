import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ApiError } from '../api/client';

// Mirrors the server-side EMAIL_REGEX for instant client-side feedback.
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

type RoleChoice = 'ADMIN' | 'HUB';

export function LoginPage() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [choice, setChoice] = useState<RoleChoice | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    return <Navigate to={user.role === 'CENTRAL_ADMIN' ? '/admin' : '/hub'} replace />;
  }

  const emailValid = EMAIL_REGEX.test(email);

  const pick = (role: RoleChoice) => {
    setChoice(role);
    setEmail('');
    setPassword('');
  };

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
      // Route by the account's ACTUAL role from the server (source of truth).
      navigate(u.role === 'CENTRAL_ADMIN' ? '/admin' : '/hub', { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
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

        {choice === null ? (
          // Step 1: choose how you're signing in.
          <div className="card">
            <h2 style={{ marginTop: 0 }}>How are you signing in?</h2>
            <p className="muted">Choose your role to continue.</p>
            <div className="grid cols-2 mt">
              <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => pick('ADMIN')}>
                <div style={{ fontSize: '1.6rem' }}>🛠️</div>
                <h3 style={{ margin: '6px 0 2px' }}>I'm an Admin</h3>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  Configure warehouses &amp; users, upload invoices, run cross-warehouse reports.
                </div>
              </button>
              <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => pick('HUB')}>
                <div style={{ fontSize: '1.6rem' }}>📦</div>
                <h3 style={{ margin: '6px 0 2px' }}>I'm a Hub User</h3>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  Enter your warehouse and scan-to-receive incoming deliveries.
                </div>
              </button>
            </div>
          </div>
        ) : (
          // Step 2: role-tailored credential login.
          <div className="card">
            <button className="btn btn-ghost" style={{ paddingLeft: 0 }} onClick={() => setChoice(null)}>
              ← Change role
            </button>
            <h2 style={{ margin: '6px 0 2px' }}>
              {choice === 'ADMIN' ? 'Admin sign in' : 'Hub user sign in'}
            </h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              {choice === 'ADMIN'
                ? 'Full system access: configuration, invoice uploads, and reporting.'
                : "Use the credentials your administrator created for you — you'll pick your warehouse next."}
            </p>

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

            {choice === 'HUB' && (
              <div className="hint" style={{ marginTop: 12 }}>
                No account yet? Hub accounts are created by your Central Admin (there is no self-registration).
              </div>
            )}

            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
                Demo {choice === 'ADMIN' ? 'admin' : 'hub'} account (click to fill)
              </div>
              <div className="btn-row">
                {choice === 'ADMIN' ? (
                  <button
                    className="btn"
                    onClick={() => {
                      setEmail('admin@freshtrack.io');
                      setPassword('Admin@12345');
                    }}
                  >
                    Central Admin
                  </button>
                ) : (
                  <>
                    <button
                      className="btn"
                      onClick={() => {
                        setEmail('nyc.hub@freshtrack.io');
                        setPassword('Hub@12345');
                      }}
                    >
                      NYC Hub
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setEmail('regional.hub@freshtrack.io');
                        setPassword('Hub@12345');
                      }}
                    >
                      Multi-hub
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
