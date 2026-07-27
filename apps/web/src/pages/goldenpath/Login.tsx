import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

// FINAL-R0 Golden Path step 1: real login against auth-service (S205)
// through the real gateway. No mock/demo bypass.
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tenantId, setTenantId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(tenantId.trim(), email.trim(), password);
      const dest = (location.state as any)?.from ?? '/golden-path/select-entity';
      navigate(dest, { replace: true });
    } catch (err: any) {
      setError(err.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '80px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Sign in</h1>
      <form onSubmit={handleSubmit} data-testid="login-form">
        <label style={{ display: 'block', marginBottom: 12 }}>
          Tenant ID
          <input
            data-testid="login-tenant-id"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 12 }}>
          Email
          <input
            data-testid="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 16 }}>
          Password
          <input
            data-testid="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </label>
        {error && (
          <div data-testid="login-error" style={{ color: '#b91c1c', marginBottom: 12 }}>
            {error}
          </div>
        )}
        <button data-testid="login-submit" type="submit" disabled={busy} style={{ padding: '8px 16px' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
