/**
 * CE-16 Accounting Migration — shared UI scaffold.
 *
 * Every migration screen answers the same set of questions the same way:
 * is the service reachable, is the caller allowed in, is there anything to
 * show, and is any part of the answer coming from an upstream module whose
 * migration contract has not been reconciled yet. Those answers are rendered
 * here so no screen has to invent its own version of the truth.
 */
import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { PageHeader, Badge, Btn } from '../../../components/ui';
import { Banner, EmptyState, UnauthorizedState } from '../../../components/report';

export const MIGRATION_SERVICE = 'migration-service';
export const MIGRATION_PORT = 3060;

/**
 * The truthful state used when a target module's migration API is not yet
 * reconciled. It is never rendered as success and never produces a target id.
 */
export const PENDING_UPSTREAM = 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION';

export const MIGRATION_STATES = [
  'DISCOVERED', 'MAPPED', 'STAGED', 'VALIDATED', 'RECONCILED',
  'READY_FOR_CUTOVER', 'CUTOVER_IN_PROGRESS', 'CUTOVER_COMPLETE',
  'ROLLED_BACK', 'MANUAL_REVIEW_REQUIRED',
] as const;

export const MIGRATION_TABS = [
  { to: '/accounting/migration', label: 'Command Center', end: true },
  { to: '/accounting/migration/sources', label: 'Sources' },
  { to: '/accounting/migration/mapping', label: 'Mapping' },
  { to: '/accounting/migration/preview', label: 'Preview' },
  { to: '/accounting/migration/exceptions', label: 'Exceptions' },
  { to: '/accounting/migration/reconcile', label: 'Reconcile' },
  { to: '/accounting/migration/parallel', label: 'Parallel Run' },
  { to: '/accounting/migration/cutover', label: 'Cutover' },
  { to: '/accounting/migration/archive', label: 'Archive' },
  { to: '/accounting/migration/runbooks', label: 'Runbooks' },
];

export function stateVariant(state?: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (state) {
    case 'CUTOVER_COMPLETE':
    case 'PASS':
    case 'COMPLETE':
    case 'APPROVED':
    case 'POSTED':
    case 'ESTABLISHED':
    case 'FROZEN':
      return 'success';
    case 'READY_FOR_CUTOVER':
    case 'RECONCILED':
    case 'VALIDATED':
    case 'SIGNED_OFF':
      return 'info';
    case 'MANUAL_REVIEW_REQUIRED':
    case 'CUTOVER_IN_PROGRESS':
    case 'PENDING':
    case 'BLOCKED':
    case PENDING_UPSTREAM:
      return 'warning';
    case 'ROLLED_BACK':
    case 'FAIL':
    case 'REJECTED':
    case 'ERROR':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** True when the API refused the caller rather than failed. */
export function isUnauthorized(error: unknown): boolean {
  const message = (error as Error)?.message ?? '';
  return /\b401\b|\b403\b|unauthor|forbidden|permission_denied/i.test(message);
}

export function isNotConfigured(error: unknown): boolean {
  return /SOURCE_NOT_CONFIGURED/i.test((error as Error)?.message ?? '');
}

export function permissionMessage(permission: string): string {
  return `This screen requires the ${permission} permission. Ask a migration lead to grant it.`;
}

export function MigrationTabs() {
  const { pathname } = useLocation();
  return (
    <nav data-testid="migration-tabs" className="flex flex-wrap gap-1 border-b border-slate-200 mb-4">
      {MIGRATION_TABS.map((tab) => {
        const active = tab.end ? pathname === tab.to : pathname.startsWith(tab.to);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            data-testid={`migration-tab-${tab.label.toLowerCase().replace(/\s+/g, '-')}`}
            className={[
              'px-3 py-2 text-[13px] font-medium rounded-t-md border-b-2 -mb-px',
              active ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-800',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export interface MigrationPageProps {
  title: string;
  story: string;
  subtitle?: string;
  testId: string;
  permission: string;
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Renders exactly one of: loading, unauthorized, upstream-not-configured,
 * error, or the page body. A screen never shows stale content beside an error.
 */
export function MigrationPage({
  title, story, subtitle, testId, permission, loading, error, retry, actions, children,
}: MigrationPageProps) {
  const body = () => {
    if (loading) return <PageLoader page={title} service={MIGRATION_SERVICE} port={MIGRATION_PORT} />;
    if (error && isUnauthorized(error)) {
      return <UnauthorizedState testId={`${testId}-unauthorized`} message={permissionMessage(permission)} />;
    }
    if (error && isNotConfigured(error)) {
      return (
        <EmptyState
          testId={`${testId}-not-configured`}
          title="No legacy source system is configured"
          message="Register the legacy system and import an extract before this screen has anything to show."
          action={<Link to="/accounting/migration/sources"><Btn variant="primary" size="md">Go to sources</Btn></Link>}
        />
      );
    }
    if (error) {
      return (
        <div data-testid={`${testId}-error`}>
          <PageError error={error as Error} serviceName={MIGRATION_SERVICE} port={MIGRATION_PORT} retry={retry} />
        </div>
      );
    }
    return <div data-testid={`${testId}-content`}>{children}</div>;
  };

  return (
    <div className="p-6" data-testid={testId}>
      <PageHeader
        title={title}
        subtitle={subtitle ?? story}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="neutral">{story}</Badge>
            {retry && <Btn variant="secondary" size="md" onClick={retry}>Refresh</Btn>}
            {actions}
          </div>
        }
      />
      <MigrationTabs />
      {body()}
    </div>
  );
}

export function Card({ title, testId, actions, children }: { title: string; testId?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section data-testid={testId} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-bold text-slate-900">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function KeyValue({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-[12px] uppercase tracking-wide text-slate-500">{label}</span>
      <span data-testid={testId} className="text-[13px] font-medium text-slate-900 text-right break-all">{value}</span>
    </div>
  );
}

export function Table({ headers, testId, children }: { headers: string[]; testId?: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table data-testid={testId} className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
            {headers.map((h) => <th key={h} className="py-2 pr-4 font-semibold whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * All money is formatted, never calculated, in the browser. Totals shown on
 * these screens are the ones the service computed.
 */
export function money(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function UpstreamPendingBanner({ modules, testId }: { modules: string[]; testId?: string }) {
  if (modules.length === 0) return null;
  return (
    <Banner kind="warning" title="Upstream migration contract not yet reconciled" testId={testId ?? 'upstream-pending'}>
      <span className="text-[12.5px]">
        {modules.join(', ')} returned <code>{PENDING_UPSTREAM}</code>. The staged data is retained and nothing has
        been marked migrated — no target record identifiers have been generated.
      </span>
    </Banner>
  );
}

export function MutationError({ error, testId }: { error: unknown; testId: string }) {
  if (!error) return null;
  if (isUnauthorized(error)) {
    return (
      <Banner kind="warning" title="Not permitted" testId={`${testId}-denied`}>
        <span className="text-[12.5px]">{(error as Error).message}</span>
      </Banner>
    );
  }
  return (
    <Banner kind="error" title="Action refused" testId={testId}>
      <span className="text-[12.5px]">{(error as Error)?.message ?? 'The service refused the request.'}</span>
    </Banner>
  );
}

export function NoRuns({ testId }: { testId: string }) {
  return (
    <EmptyState
      testId={testId}
      title="No migration run selected"
      message="Create or select a migration run in the command center first."
      action={<Link to="/accounting/migration"><Btn variant="primary" size="md">Go to command center</Btn></Link>}
    />
  );
}

/** Reads the run id from the query string so every screen can deep-link. */
export function useRunIdFromQuery(): string | null {
  const { search } = useLocation();
  return new URLSearchParams(search).get('runId');
}
