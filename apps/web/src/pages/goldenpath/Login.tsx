import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Btn } from '../../components/ui';

// FINAL-R0 Golden Path step 1: real login against auth-service (S205)
// through the real gateway. No mock/demo bypass.
//
// Golden R0 UI convergence — Phase 1: this screen has no dedicated source
// design (confirmed absent from the approved Claude Design package — see
// DESIGN_SOURCE_OF_TRUTH.md and the visual-convergence audit). Restyled here
// using only the approved design tokens (navy #1E3A5C / rail gradient
// #4E2578→#331452 / primary blue #0B5CAB) and the existing app's own
// typography and form-control conventions — not an invented layout. Critically,
// App.tsx no longer wraps this route in the authenticated shell (no rail, no
// sub-nav, no tenant badge or user avatar before sign-in).
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
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'radial-gradient(120% 100% at 50% 0%, #EEF3FA 0%, #F3F5F8 55%, #F3F5F8 100%)' }}
    >
      <div className="w-full max-w-[400px]">
        <div className="flex items-center justify-center gap-2.5 mb-7">
          <span
            className="w-6 h-6 rounded-[4px] rotate-45 flex-shrink-0"
            style={{ background: 'linear-gradient(170deg,#4E2578,#331452)' }}
          />
          <span className="text-[15px] font-semibold tracking-tight" style={{ color: '#1E3A5C' }}>
            AutoMate Accounting
          </span>
        </div>

        <div
          className="bg-white rounded-lg border border-slate-200 px-8 py-8"
          style={{ boxShadow: '0 1px 3px rgba(20,32,48,.07), 0 8px 24px rgba(20,32,48,.06)' }}
        >
          <h1 className="text-[19px] font-semibold text-slate-900 tracking-tight mb-0.5">Sign in</h1>
          <p className="text-[13px] text-slate-500 mb-6">Enter your tenant and credentials to continue.</p>

          <form onSubmit={handleSubmit} data-testid="login-form" className="flex flex-col gap-4">
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Tenant ID
              </span>
              <input
                data-testid="login-tenant-id"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                required
                autoComplete="off"
                disabled={busy}
                className="w-full h-9 px-3 text-[13px] rounded-md border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-400"
                style={{ ['--tw-ring-color' as any]: '#0B5CAB' }}
              />
            </label>

            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Email
              </span>
              <input
                data-testid="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                disabled={busy}
                className="w-full h-9 px-3 text-[13px] rounded-md border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-400"
                style={{ ['--tw-ring-color' as any]: '#0B5CAB' }}
              />
            </label>

            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Password
              </span>
              <input
                data-testid="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={busy}
                className="w-full h-9 px-3 text-[13px] rounded-md border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-400"
                style={{ ['--tw-ring-color' as any]: '#0B5CAB' }}
              />
            </label>

            {error && (
              <div
                data-testid="login-error"
                role="alert"
                className="text-[13px] leading-snug rounded-md border px-3 py-2.5"
                style={{ background: '#FDECEA', borderColor: '#F0C0BB', color: '#B3261E' }}
              >
                {error}
              </div>
            )}

            <Btn
              data-testid="login-submit"
              type="submit"
              variant="primary"
              size="lg"
              loading={busy}
              disabled={busy}
              className="w-full mt-1"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </Btn>
          </form>
        </div>

        <p className="text-center text-[12px] text-slate-400 mt-5">AutoMate Dealer Platform &middot; Accounting module</p>
      </div>
    </div>
  );
}
