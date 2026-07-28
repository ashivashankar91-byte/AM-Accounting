import type { ReactNode } from 'react';
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

const BANNER_STYLES: Record<BannerKind, { bg: string; border: string; color: string }> = {
  error: { bg: '#fef2f2', border: '#b91c1c', color: '#991b1b' },
  success: { bg: '#dcfce7', border: '#166534', color: '#166534' },
  warning: { bg: '#fffbeb', border: '#f59e0b', color: '#92400e' },
  info: { bg: '#eff6ff', border: '#1d4ed8', color: '#1d4ed8' },
};

export function Banner({
  kind, title, testId, children,
}: { kind: BannerKind; title: string; testId?: string; children?: ReactNode }) {
  const s = BANNER_STYLES[kind];
  return (
    <div
      data-testid={testId}
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color, padding: 12, marginTop: 12, borderRadius: 4 }}
    >
      <strong>{title}</strong>
      {children && <div style={{ marginTop: 4 }}>{children}</div>}
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

/** Error state with an optional Retry action (design Section 02: ErrorState offers Retry/Back). Retry is opt-in via prop — wiring it at each call site is Phase 4 scope. */
export function ErrorState({ message, testId, onRetry }: { message: string; testId?: string; onRetry?: () => void }) {
  return (
    <div data-testid={testId} className="mt-3 flex items-center gap-3 text-[13px] text-red-700">
      <span>{message}</span>
      {onRetry && <Btn size="sm" variant="secondary" onClick={onRetry}>Retry</Btn>}
    </div>
  );
}

export function UnauthorizedState({ message, testId }: { message: string; testId?: string }) {
  return (
    <div data-testid={testId} className="mt-6 p-5 border border-slate-200 rounded-md text-center">
      <p className="font-semibold text-slate-900 m-0">You don&rsquo;t have access to this screen</p>
      <p className="text-[13px] text-slate-500 mt-1">{message}</p>
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
