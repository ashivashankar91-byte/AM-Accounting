/**
 * CE-17 Accounting Automation — shared UI scaffold.
 *
 * Every automation screen has to answer the same uncomfortable questions
 * honestly: what authority does this capability actually hold, what did the
 * policy gates say, and did anything reach the ledger. Those answers are
 * rendered here once, so no screen can invent a friendlier version of them.
 *
 * The rule the whole epic rests on: a capability that has not been configured
 * is NOT_CONFIGURED, and a configured one observes and nothing more until two
 * different people have said otherwise. Neither state is ever dressed up as
 * success.
 */
import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { PageHeader, Badge, Btn } from '../../../components/ui';
import { Banner, EmptyState, UnauthorizedState } from '../../../components/report';

export const AUTOMATION_SERVICE = 'automation-service';
export const AUTOMATION_PORT = 3056;

/** The authority ladder, in the only order it may be climbed. */
export const AUTHORITY_LADDER = [
  'OBSERVE_ONLY',
  'RECOMMEND',
  'PREPARE_DRAFT',
  'EXECUTE_WITH_APPROVAL',
  'AUTO_EXECUTE_WITHIN_POLICY',
] as const;

export type Authority = (typeof AUTHORITY_LADDER)[number] | 'SUSPENDED';

/** The truthful states. Nothing outside this list may be displayed as a state. */
export const TRUTHFUL_STATES = [
  'NOT_CONFIGURED',
  'OBSERVATION_ONLY',
  'RECOMMENDATION_READY',
  'APPROVAL_REQUIRED',
  'EXECUTION_PENDING',
  'EXECUTED',
  'FAILED_CLOSED',
  'SUSPENDED',
  'MODEL_OR_RULE_UNAVAILABLE',
] as const;

export const AUTHORITY_LABEL: Record<string, string> = {
  OBSERVE_ONLY: 'Observe only',
  RECOMMEND: 'Recommend',
  PREPARE_DRAFT: 'Prepare draft',
  EXECUTE_WITH_APPROVAL: 'Execute with approval',
  AUTO_EXECUTE_WITHIN_POLICY: 'Auto-execute within policy',
  SUSPENDED: 'Suspended',
  NOT_CONFIGURED: 'Not configured',
};

export const STATE_LABEL: Record<string, string> = {
  NOT_CONFIGURED: 'Not configured',
  OBSERVATION_ONLY: 'Observation only',
  RECOMMENDATION_READY: 'Recommendation ready',
  APPROVAL_REQUIRED: 'Approval required',
  EXECUTION_PENDING: 'Execution pending',
  EXECUTED: 'Executed',
  FAILED_CLOSED: 'Failed closed',
  SUSPENDED: 'Suspended',
  MODEL_OR_RULE_UNAVAILABLE: 'Model or rule unavailable',
};

export const AUTOMATION_TABS = [
  { to: '/accounting/automation', label: 'Command Center', end: true },
  { to: '/accounting/automation/capabilities', label: 'Capabilities' },
  { to: '/accounting/automation/policies', label: 'Policy Gates' },
  { to: '/accounting/automation/queue', label: 'Queue' },
  { to: '/accounting/automation/health', label: 'Health' },
  { to: '/accounting/automation/sandbox', label: 'Sandbox' },
  { to: '/accounting/automation/ingestion', label: 'Ingestion' },
  { to: '/accounting/automation/lockbox', label: 'Lockbox' },
  { to: '/accounting/automation/lifo', label: 'LIFO' },
  { to: '/accounting/automation/chargeback', label: 'Chargeback Model' },
  { to: '/accounting/automation/portfolio', label: 'Portfolio Reserve' },
  { to: '/accounting/automation/cession', label: 'Cession' },
  { to: '/accounting/automation/oem-matcher', label: 'OEM Matcher' },
  { to: '/accounting/automation/incentives', label: 'Incentives' },
  { to: '/accounting/automation/exports', label: 'Composite Export' },
  { to: '/accounting/automation/memos', label: 'GAAP Memos' },
  { to: '/accounting/automation/dsar', label: 'DSAR' },
  { to: '/accounting/automation/unclaimed-property', label: 'Unclaimed Property' },
  { to: '/accounting/automation/sox', label: 'SOX Evidence' },
];

export function authorityVariant(authority?: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (authority) {
    case 'AUTO_EXECUTE_WITHIN_POLICY':
      return 'success';
    case 'EXECUTE_WITH_APPROVAL':
    case 'PREPARE_DRAFT':
    case 'RECOMMEND':
      return 'info';
    case 'SUSPENDED':
      return 'danger';
    case 'OBSERVE_ONLY':
    case 'NOT_CONFIGURED':
    default:
      return 'neutral';
  }
}

export function stateVariant(state?: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (state) {
    case 'EXECUTED':
    case 'ACCEPTED':
    case 'APPROVED':
    case 'POSTED':
    case 'ADOPTED':
    case 'COMPLETED':
    case 'FINAL':
    case 'ATTESTED':
    case 'REMITTANCE_PREPARED':
      return 'success';
    case 'RECOMMENDATION_READY':
    case 'EXECUTION_PENDING':
    case 'SUGGESTED':
    case 'ALLOCATED':
    case 'GENERATED':
    case 'DRAFT':
    case 'RUNNING':
      return 'info';
    case 'APPROVAL_REQUIRED':
    case 'OBSERVATION_ONLY':
    case 'MODEL_OR_RULE_UNAVAILABLE':
    case 'CLERK_REVIEW':
    case 'PENDING':
    case 'ESCALATED':
    case 'DUE_DILIGENCE_SENT':
    case 'EXCEPTION':
      return 'warning';
    case 'FAILED_CLOSED':
    case 'SUSPENDED':
    case 'REJECTED':
    case 'FAILED':
    case 'DUPLICATE':
      return 'danger';
    case 'NOT_CONFIGURED':
    default:
      return 'neutral';
  }
}

/** True when the API refused the caller rather than failed. */
export function isUnauthorized(error: unknown): boolean {
  const message = (error as Error)?.message ?? '';
  return /\b401\b|\b403\b|unauthor|forbidden|permission_denied/i.test(message);
}

/** True when the capability exists in the catalogue but nobody configured it. */
export function isNotConfigured(error: unknown): boolean {
  return /NOT_CONFIGURED|CAPABILITY_NOT_CONFIGURED|not configured/i.test((error as Error)?.message ?? '');
}

/** True when a policy gate refused the action — a refusal, not a failure. */
export function isPolicyRefusal(error: unknown): boolean {
  return /POLICY_GATE_|AUTHORITY_|APPROVAL_REQUIRED|CIRCUIT_BREAKER|CROSS_ENTITY|SEPARATION_OF_DUTIES/i
    .test((error as Error)?.message ?? '');
}

export function isSuspended(error: unknown): boolean {
  return /SUSPENDED|CAPABILITY_SUSPENDED/i.test((error as Error)?.message ?? '');
}

export function permissionMessage(permission: string): string {
  return `This screen requires the ${permission} permission. Ask an automation lead to grant it.`;
}

export function AutomationTabs() {
  const { pathname } = useLocation();
  return (
    <nav data-testid="automation-tabs" className="flex flex-wrap gap-1 border-b border-slate-200 mb-4">
      {AUTOMATION_TABS.map((tab) => {
        const active = tab.end ? pathname === tab.to : pathname.startsWith(tab.to);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            data-testid={`automation-tab-${tab.label.toLowerCase().replace(/\s+/g, '-')}`}
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

export interface AutomationPageProps {
  title: string;
  story: string;
  subtitle?: string;
  testId: string;
  permission: string;
  /** The capability whose authority governs this screen, when there is one. */
  capabilityCode?: string;
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Renders exactly one of: loading, unauthorized, suspended, not-configured,
 * error, or the page body. A screen never shows stale content beside an error,
 * because a stale automation figure is indistinguishable from a current one.
 */
export function AutomationPage({
  title, story, subtitle, testId, permission, capabilityCode, loading, error, retry, actions, children,
}: AutomationPageProps) {
  const body = () => {
    if (loading) return <PageLoader page={title} service={AUTOMATION_SERVICE} port={AUTOMATION_PORT} />;
    if (error && isUnauthorized(error)) {
      return <UnauthorizedState testId={`${testId}-unauthorized`} message={permissionMessage(permission)} />;
    }
    if (error && isSuspended(error)) {
      return (
        <EmptyState
          testId={`${testId}-suspended`}
          title="This capability is suspended"
          message="Automation has been stopped for this capability. Nothing is being proposed or executed until two different people restore its authority."
          action={<Link to="/accounting/automation/capabilities"><Btn variant="primary" size="md">Review capabilities</Btn></Link>}
        />
      );
    }
    if (error && isNotConfigured(error)) {
      return (
        <EmptyState
          testId={`${testId}-not-configured`}
          title="This capability is not configured"
          message={
            capabilityCode
              ? `${capabilityCode} has not been configured for this legal entity. Configuring it creates it at OBSERVE_ONLY — it will observe and propose nothing until it is promoted.`
              : 'Configure the capability before this screen has anything to show. Configuration alone grants no authority.'
          }
          action={<Link to="/accounting/automation/capabilities"><Btn variant="primary" size="md">Configure capability</Btn></Link>}
        />
      );
    }
    if (error) {
      return (
        <div data-testid={`${testId}-error`}>
          <PageError error={error as Error} serviceName={AUTOMATION_SERVICE} port={AUTOMATION_PORT} retry={retry} />
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
      <AutomationTabs />
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
 * All money is formatted, never calculated, in the browser. Every figure on
 * these screens is the one the service computed under a policy version.
 */
export function money(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Confidence is a measurement, so an absent one is shown as absent. */
export function confidence(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not scored';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Not scored';
  return `${(n * 100).toFixed(2)}%`;
}

export function dateTime(value: unknown): string {
  if (!value) return '—';
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function AuthorityBadge({ authority, testId }: { authority?: string; testId?: string }) {
  const value = authority ?? 'NOT_CONFIGURED';
  return (
    <Badge variant={authorityVariant(value)} data-testid={testId}>
      {AUTHORITY_LABEL[value] ?? value}
    </Badge>
  );
}

export function StateBadge({ state, testId }: { state?: string; testId?: string }) {
  const value = state ?? 'NOT_CONFIGURED';
  return (
    <Badge variant={stateVariant(value)} data-testid={testId}>
      {STATE_LABEL[value] ?? value}
    </Badge>
  );
}

/**
 * Says plainly that this screen only observes. Shown wherever a capability
 * sits at OBSERVE_ONLY, so nobody mistakes an observation for a proposal.
 */
export function ObserveOnlyBanner({ capabilityCode, testId }: { capabilityCode?: string; testId?: string }) {
  return (
    <Banner kind="info" title="Observation only" testId={testId ?? 'observe-only-banner'}>
      <span className="text-[12.5px]">
        {capabilityCode ? `${capabilityCode} is` : 'This capability is'} at <strong>OBSERVE_ONLY</strong>. It records what
        it sees and proposes nothing. Nothing on this screen has been, or will be, posted until two different people
        promote it.
      </span>
    </Banner>
  );
}

export function SuspendedBanner({ reason, testId }: { reason?: string | null; testId?: string }) {
  return (
    <Banner kind="error" title="Automation suspended" testId={testId ?? 'suspended-banner'}>
      <span className="text-[12.5px]">
        {reason ?? 'This capability has been suspended.'} No recommendations are being produced and nothing will be
        executed. Restoring it requires a fresh grant and a different person to activate it.
      </span>
    </Banner>
  );
}

export function CircuitBreakerBanner({ count, threshold, testId }: { count: number; threshold?: number; testId?: string }) {
  if (!count) return null;
  return (
    <Banner kind="warning" title="Consecutive failures recorded" testId={testId ?? 'circuit-breaker-banner'}>
      <span className="text-[12.5px]">
        {count} consecutive failure{count === 1 ? '' : 's'}
        {threshold ? ` against a threshold of ${threshold}` : ''}. Reaching the threshold suspends this capability
        outright rather than letting it keep failing against the ledger.
      </span>
    </Banner>
  );
}

/**
 * Renders the full, non-short-circuiting policy trace. Every gate is shown,
 * including the ones that passed, because "which gate refused" is only
 * meaningful next to "which gates it got past".
 */
export function PolicyTrace({ evaluation, testId }: { evaluation: any; testId?: string }) {
  const id = testId ?? 'policy-trace';
  const checks: any[] = evaluation?.checks ?? [];
  if (checks.length === 0) {
    return (
      <p data-testid={`${id}-empty`} className="text-[13px] text-slate-500">
        No policy evaluation has been recorded for this item yet.
      </p>
    );
  }
  return (
    <div data-testid={id}>
      <div className="mb-2 flex items-center gap-2">
        <Badge variant={evaluation.allowed ? 'success' : 'danger'} data-testid={`${id}-verdict`}>
          {evaluation.allowed ? 'All gates passed' : `Refused at ${evaluation.refusalGate ?? 'a policy gate'}`}
        </Badge>
        {evaluation.policyVersion && <Badge variant="neutral">Policy {evaluation.policyVersion}</Badge>}
      </div>
      <Table headers={['Gate', 'Result', 'Detail']} testId={`${id}-table`}>
        {checks.map((check) => (
          <tr key={check.gate} data-testid={`gate-${check.gate}`} className="border-b border-slate-100 last:border-0">
            <td className="py-2 pr-4 font-mono text-[12px] whitespace-nowrap">{check.gate}</td>
            <td className="py-2 pr-4">
              <Badge variant={check.passed ? 'success' : 'danger'}>{check.passed ? 'Passed' : 'Refused'}</Badge>
            </td>
            <td className="py-2 pr-4 text-slate-600">{check.detail}</td>
          </tr>
        ))}
      </Table>
    </div>
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
  if (isPolicyRefusal(error)) {
    return (
      <Banner kind="warning" title="Refused by policy" testId={`${testId}-policy-refused`}>
        <span className="text-[12.5px]">
          {(error as Error).message} Nothing was posted and no execution record claims otherwise.
        </span>
      </Banner>
    );
  }
  return (
    <Banner kind="error" title="Action refused" testId={testId}>
      <span className="text-[12.5px]">{(error as Error)?.message ?? 'The service refused the request.'}</span>
    </Banner>
  );
}

export function NoCapability({ testId, capabilityCode }: { testId: string; capabilityCode?: string }) {
  return (
    <EmptyState
      testId={testId}
      title="Capability not configured"
      message={`${capabilityCode ?? 'This capability'} has not been configured for this legal entity. It will start at OBSERVE_ONLY once configured.`}
      action={<Link to="/accounting/automation/capabilities"><Btn variant="primary" size="md">Go to capabilities</Btn></Link>}
    />
  );
}

export function Empty({ testId, title, message }: { testId: string; title: string; message: string }) {
  return <EmptyState testId={testId} title={title} message={message} />;
}

/** Reads the legal entity from the query string so screens can deep-link. */
export function useLegalEntityFromQuery(): string | null {
  const { search } = useLocation();
  return new URLSearchParams(search).get('legalEntityId');
}

export function useCapabilityFromQuery(): string | null {
  const { search } = useLocation();
  return new URLSearchParams(search).get('capabilityCode');
}
