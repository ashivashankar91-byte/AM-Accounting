import type { ReactNode } from 'react';
import { PageHeader } from '../ui/PageHeader';
import { Badge } from '../ui/Badge';

// Golden R0 UI convergence — Phase 2: the shared report-screen foundation
// (design Section 02/05-09 "ReportScreen" pattern). Deliberately does NOT
// re-render breadcrumb or the tenant/legal-entity/user identity bar — the
// global App shell (Phase 1: components/shell/Breadcrumb + ContextBar)
// already renders those on every route, golden-path included, driven by
// components/shell/goldenPathRoutes.ts. This component owns everything
// below that: page title/description/status/actions, the report's own
// scope row (Entity/Store/Dept/As-of — whatever fields the specific screen
// filters by), and the content area (filter bar, banner, table/states,
// related links all render as children so each screen keeps control of its
// own filters/columns).

export type ReportStatusVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface ScopeField {
  label: string;
  value: string;
  muted?: boolean;
}

interface ReportShellProps {
  title: string;
  description?: string;
  status?: { label: string; variant: ReportStatusVariant };
  actions?: ReactNode;
  scopeFields?: ScopeField[];
  children: ReactNode;
}

export function ReportShell({ title, description, status, actions, scopeFields, children }: ReportShellProps) {
  return (
    <div className="max-w-[1200px] mx-auto px-6 py-6">
      <PageHeader
        title={title}
        subtitle={description}
        badge={status ? <Badge variant={status.variant}>{status.label}</Badge> : undefined}
        actions={actions}
      />

      {scopeFields && scopeFields.length > 0 && (
        <div className="flex items-stretch bg-slate-50 border border-slate-200 rounded-md mb-4 text-[12.5px] overflow-hidden overflow-x-auto">
          {scopeFields.map((f, i) => (
            <div
              key={f.label}
              className={`px-4 py-2 whitespace-nowrap ${i < scopeFields.length - 1 ? 'border-r border-slate-200' : ''}`}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{f.label}</div>
              <div className={`text-[13px] font-medium mt-0.5 ${f.muted ? 'text-slate-400 italic font-normal' : 'text-slate-900'}`}>
                {f.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}
