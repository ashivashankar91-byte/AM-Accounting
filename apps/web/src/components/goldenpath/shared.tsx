import type { ReactNode } from 'react';

// Golden R0 UI convergence — minimal shared components for the Golden Path
// reporting screens (GL Inquiry, GL Search, Trial Balance, Balance Sheet,
// Income Statement). Extracted from the pattern already duplicated across
// TrialBalance.tsx / BalanceSheet.tsx / IncomeStatement.tsx: same fonts
// (Inter for UI, JetBrains Mono for money), same banner/state colors. Per
// PRODUCT DECISION (Golden R0 UI convergence, 2026-07-28): use the existing
// application font stack, not the IBM Plex Sans/Mono the Claude Design
// package proposes — only the structural patterns (financial-table layout,
// monetary alignment, section headers, banners, state coverage) are adopted.

export function formatMoney(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

export function MoneyCell({ value, bold = false }: { value: number | null | undefined; bold?: boolean }) {
  if (value === null || value === undefined) {
    return <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#AEB6C2' }}>&mdash;</td>;
  }
  return (
    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: bold ? 700 : 400 }}>
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
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color, padding: 12, marginTop: 12, borderRadius: 3 }}
    >
      <strong>{title}</strong>
      {children && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

export function LoadingState({ label, testId }: { label: string; testId?: string }) {
  return (
    <p data-testid={testId} style={{ marginTop: 16, color: '#5A6675' }}>
      {label}
    </p>
  );
}

export function EmptyState({ title, message, testId }: { title: string; message?: string; testId?: string }) {
  return (
    <div data-testid={testId} style={{ marginTop: 24, padding: 20, border: '1px dashed #C3CBD6', borderRadius: 4, textAlign: 'center' }}>
      <p style={{ fontWeight: 600, margin: 0 }}>{title}</p>
      {message && <p style={{ color: '#5A6675', margin: '4px 0 0', fontSize: 13 }}>{message}</p>}
    </div>
  );
}

export function ErrorState({ message, testId }: { message: string; testId?: string }) {
  return (
    <p data-testid={testId} style={{ color: '#b91c1c' }}>
      {message}
    </p>
  );
}

export function UnauthorizedState({ message, testId }: { message: string; testId?: string }) {
  return (
    <div data-testid={testId} style={{ marginTop: 24, padding: 20, border: '1px solid #DCE1E8', borderRadius: 4, textAlign: 'center' }}>
      <p style={{ fontWeight: 600, margin: 0 }}>You don&rsquo;t have access to this screen</p>
      <p style={{ color: '#5A6675', margin: '4px 0 0', fontSize: 13 }}>{message}</p>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#5A6675', marginBottom: 4 }}>
      {children}
    </div>
  );
}
