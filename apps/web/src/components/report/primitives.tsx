import type { ReactNode } from 'react';
import { AlertTriangle, AlertCircle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { EmptyState as UiEmptyState } from '../ui/EmptyState';
import { LoadingTable } from '../ui/LoadingTable';
import { Btn } from '../ui/Btn';

// Golden R0 UI convergence — Phase 2: shared report-screen primitives.
// Reconciles the previously duplicated apps/web/src/components/goldenpath/
// shared.tsx (deleted this phase) with the app's existing components/ui/*
// system: EmptyState and the loading skeleton now come from ui/*; the
// financial-formatting and Banner/Error/Unauthorized primitives below have
// no ui/ equivalent (ui/MoneyCell uses a different, currency-symbol-prefixed
// convention used elsewhere in the app) and are kept here since the Section
// 01 financial-presentation rule — negatives parenthesized in red, never a
// minus sign; empty cells show an em dash, never zero — is specific to these
// report screens and already correct; changing ui/MoneyCell itself would
// ripple into unrelated, non-golden-path screens.

export function formatMoney(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

export function MoneyTd({ value, bold = false, className = '' }: { value: number | null | undefined; bold?: boolean; className?: string }) {
  if (value === null || value === undefined) {
    return <td className={`px-3 h-[34px] text-right font-mono tabular-nums text-slate-300 ${className}`}>&mdash;</td>;
  }
  return (
    <td className={`px-3 h-[34px] text-right font-mono tabular-nums ${value < 0 ? 'text-red-600' : 'text-slate-900'} ${bold ? 'font-semibold' : ''} ${className}`}>
      {formatMoney(value)}
    </td>
  );
}

type BannerKind = 'error' | 'success' | 'warning' | 'info';

const BANNER_STYLES: Record<BannerKind, { bg: string; border: string; color: string; Icon: typeof AlertTriangle }> = {
  error: { bg: '#fef2f2', border: '#b91c1c', color: '#991b1b', Icon: AlertTriangle },
  success: { bg: '#dcfce7', border: '#166534', color: '#166534', Icon: CheckCircle2 },
  warning: { bg: '#fffbeb', border: '#f59e0b', color: '#92400e', Icon: AlertTriangle },
  info: { bg: '#eff6ff', border: '#1d4ed8', color: '#1d4ed8', Icon: Info },
};

/** Structural-imbalance / unclassified-account / save-conflict banner. The icon makes the severity legible at a glance (Section 01: "State is explicit"). */
export function Banner({
  kind, title, testId, children,
}: { kind: BannerKind; title: string; testId?: string; children?: ReactNode }) {
  const s = BANNER_STYLES[kind];
  return (
    <div
      data-testid={testId}
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color, padding: 12, marginTop: 12, borderRadius: 4 }}
      className="flex items-start gap-2.5"
    >
      <s.Icon size={16} className="flex-shrink-0 mt-0.5" />
      <div>
        <strong>{title}</strong>
        {children && <div style={{ marginTop: 4 }}>{children}</div>}
      </div>
    </div>
  );
}

/** Skeleton loading rows via the existing ui/LoadingTable — same call-site shape the golden-path screens already use. */
export function LoadingState({ label, testId, rows = 6, cols = 5 }: { label: string; testId?: string; rows?: number; cols?: number }) {
  return (
    <div data-testid={testId} className="mt-4">
      <p className="text-[12.5px] text-slate-500 mb-2">{label}</p>
      <LoadingTable rows={rows} cols={cols} className="border border-slate-200 rounded-md" />
    </div>
  );
}

/** Thin wrapper over ui/EmptyState preserving the golden-path screens' existing title/message/testId call shape. */
export function EmptyState({ title, message, testId, action }: { title: string; message?: string; testId?: string; action?: ReactNode }) {
  return (
    <div data-testid={testId}>
      <UiEmptyState title={title} description={message} action={action} className="border border-dashed border-slate-300 rounded-md" />
    </div>
  );
}

/** Error state with optional Retry/Back actions (design Section 02: ErrorState offers Retry/Back). Both are opt-in via props so existing call sites are unaffected until wired. */
export function ErrorState({
  message, testId, onRetry, onBack,
}: { message: string; testId?: string; onRetry?: () => void; onBack?: () => void }) {
  return (
    <div data-testid={testId} className="mt-3 flex items-center gap-3 text-[13px] text-red-700">
      <AlertCircle size={15} className="flex-shrink-0" />
      <span>{message}</span>
      <div className="flex items-center gap-2 flex-shrink-0">
        {onRetry && <Btn size="sm" variant="secondary" onClick={onRetry}>Retry</Btn>}
        {onBack && <Btn size="sm" variant="ghost" onClick={onBack}>Back</Btn>}
      </div>
    </div>
  );
}

/** Unauthorized state. `message` is the real 401/403 body from the backend (already carries the specific permission/scope context — e.g. "Your role does not include ledger search for entity 01" — never fabricated here), surfaced with a permission-denied tag for scannability. */
export function UnauthorizedState({ message, testId }: { message: string; testId?: string }) {
  return (
    <div data-testid={testId} className="mt-6 p-5 border border-slate-200 rounded-md text-center">
      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2.5 text-slate-400">
        <ShieldAlert size={18} />
      </div>
      <p className="font-semibold text-slate-900 m-0">You don&rsquo;t have access to this screen</p>
      <span className="inline-block mt-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
        Permission required
      </span>
      <p className="text-[13px] text-slate-500 mt-1.5">{message}</p>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
      {children}
    </div>
  );
}
