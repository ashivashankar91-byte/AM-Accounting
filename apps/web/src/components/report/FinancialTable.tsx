import type { ReactNode } from 'react';

// Golden R0 UI convergence — Phase 2. 34px financial-table row height,
// right-aligned tabular money columns (design Section 01, lines 188-199).

export function FinancialTable({ children, testId, className = '' }: { children: ReactNode; testId?: string; className?: string }) {
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-md">
      <table data-testid={testId} className={`w-full border-collapse text-[12.5px] ${className}`}>
        {children}
      </table>
    </div>
  );
}

export function ReportThead({ children }: { children: ReactNode }) {
  return <thead className="bg-slate-50">{children}</thead>;
}

export function ReportTh({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      className={`h-8 px-3 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 whitespace-nowrap ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

// Golden R0 UI convergence — Phase 4: rows with onClick (drill-through) are
// full keyboard operable — Tab reaches them, Enter/Space activates them,
// and focus gets a visible outline (Section 01 accessibility rule: "full
// keyboard operability"). Previously a bare onClick <tr> was mouse-only.
export function ReportTr({
  children, onClick, testId, className = '',
}: { children: ReactNode; onClick?: () => void; testId?: string; className?: string }) {
  return (
    <tr
      data-testid={testId}
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? 'button' : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      className={`h-[34px] border-b border-slate-100 ${onClick ? 'cursor-pointer hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#0B5CAB]' : ''} ${className}`}
    >
      {children}
    </tr>
  );
}

export function ReportTd({
  children, align = 'left', className = '', colSpan,
}: { children: ReactNode; align?: 'left' | 'right' | 'center'; className?: string; colSpan?: number }) {
  return (
    <td
      colSpan={colSpan}
      className={`px-3 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''} ${className}`}
    >
      {children}
    </td>
  );
}

/** Pinned/emphasized totals or section-subtotal row. */
export function TotalsRow({ children, className = '', testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <tr data-testid={testId} className={`h-[34px] border-t-2 border-slate-300 font-semibold bg-slate-50 ${className}`}>
      {children}
    </tr>
  );
}
