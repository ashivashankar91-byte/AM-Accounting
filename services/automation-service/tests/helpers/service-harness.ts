/**
 * Wires the fake Prisma store and stub upstreams into the real application
 * services, so an integration test drives exactly the code paths the HTTP
 * layer drives — including the policy gates, the SoD checks and the governed
 * posting hand-off.
 */

import { FakePrisma, RecordingEventPublisher } from './fake-prisma';
import {
  ICloseReadinessClient, IMigrationBaselineClient, IPostingClient, IAccountMappingClient,
  CanonicalEventEnvelope, PostingResult, UpstreamSignal, PENDING_UPSTREAM,
} from '../../src/domain/interfaces';
import { AutomationCapabilityService } from '../../src/application/capability-service';
import { PolicyGateService } from '../../src/application/policy-gate-service';
import { AutomationItemService } from '../../src/application/automation-item-service';
import { SandboxService } from '../../src/application/sandbox-service';
import { AutomationHealthService } from '../../src/application/health-service';

export const TENANT = 'tenant-ce17-a';
export const OTHER_TENANT = 'tenant-ce17-b';
export const LE = 'LE-CE17-001';
export const OTHER_LE = 'LE-CE17-002';

export const GRANTOR = 'user-grantor';
export const ACTIVATOR = 'user-activator';
export const AUTHOR = 'user-policy-author';
export const APPROVER = 'user-approver';
export const OPERATOR = 'user-operator';
export const AUTOMATION = 'automation:ce17';

export class StubCloseReadiness implements ICloseReadinessClient {
  /** true = closed, false = open, null = unknown (must be refused). */
  answer: boolean | null = false;
  calls: Array<{ year: number; month: number }> = [];

  async isPeriodClosed(_t: string, _le: string, year: number, month: number): Promise<boolean | null> {
    this.calls.push({ year, month });
    return this.answer;
  }
}

export class StubMigrationBaseline implements IMigrationBaselineClient {
  approved = true;
  async hasApprovedBaseline(): Promise<boolean> { return this.approved; }
  async describe(): Promise<UpstreamSignal> {
    return { moduleCode: 'CE-16', status: this.approved ? 'AVAILABLE' : 'NOT_CONFIGURED', detail: 'stub' };
  }
}

export class StubAccountMapping implements IAccountMappingClient {
  answer: boolean | null = true;
  async isMappingComplete(): Promise<boolean | null> { return this.answer; }
}

export class StubPostingClient implements IPostingClient {
  readonly posted: Array<{ tenantId: string; envelope: CanonicalEventEnvelope }> = [];
  /** Keyed by idempotencyIdentity so a replay returns the first result. */
  private readonly seen = new Map<string, PostingResult>();
  mode: 'POSTED' | 'REJECTED' | typeof PENDING_UPSTREAM = 'POSTED';
  rejectReason = 'stub rejection';
  failures = 0;

  async post(tenantId: string, envelope: CanonicalEventEnvelope): Promise<PostingResult> {
    this.posted.push({ tenantId, envelope });
    const key = `${tenantId}:${envelope.idempotencyIdentity}`;
    // Only a *posted* entry is idempotency-protected. A rejection recorded
    // nothing, so a later attempt under the same identity is judged afresh —
    // which is what makes a retry after a transient refusal meaningful.
    const prior = this.seen.get(key);
    if (prior) return prior;

    let result: PostingResult;
    if (this.failures > 0) {
      this.failures -= 1;
      return { status: 'REJECTED', postingExecutionId: null, journalEntryId: null, reason: this.rejectReason };
    }
    if (this.mode === 'POSTED') {
      result = {
        status: 'POSTED',
        postingExecutionId: `pex-${this.posted.length}`,
        journalEntryId: `je-${this.posted.length}`,
      };
      this.seen.set(key, result);
    } else if (this.mode === 'REJECTED') {
      result = { status: 'REJECTED', postingExecutionId: null, journalEntryId: null, reason: this.rejectReason };
    } else {
      result = { status: PENDING_UPSTREAM, postingExecutionId: null, journalEntryId: null, reason: 'upstream not reconciled' };
    }
    return result;
  }
}

export interface Harness {
  prisma: FakePrisma;
  events: RecordingEventPublisher;
  close: StubCloseReadiness;
  baseline: StubMigrationBaseline;
  mapping: StubAccountMapping;
  posting: StubPostingClient;
  capabilities: AutomationCapabilityService;
  policies: PolicyGateService;
  items: AutomationItemService;
  sandbox: SandboxService;
  health: AutomationHealthService;
}

export function makeHarness(): Harness {
  const prisma = new FakePrisma();
  const events = new RecordingEventPublisher();
  const close = new StubCloseReadiness();
  const baseline = new StubMigrationBaseline();
  const mapping = new StubAccountMapping();
  const posting = new StubPostingClient();

  const capabilities = new AutomationCapabilityService(prisma as any, events as any, baseline);
  const policies = new PolicyGateService(prisma as any, events as any);
  const items = new AutomationItemService(
    prisma as any, events as any, close, mapping, posting, capabilities, policies,
  );
  const sandbox = new SandboxService(prisma as any, events as any);
  const health = new AutomationHealthService(prisma as any);

  return { prisma, events, close, baseline, mapping, posting, capabilities, policies, items, sandbox, health };
}

/**
 * Creates a capability and walks it up the ladder through the real two-person
 * ceremony, so tests never fabricate an authority the service would refuse.
 */
export async function promoteTo(
  h: Harness,
  capabilityCode: string,
  target: string,
  opts: { tenantId?: string; legalEntityId?: string } = {},
): Promise<any> {
  const tenantId = opts.tenantId ?? TENANT;
  const legalEntityId = opts.legalEntityId ?? LE;

  const capability = await h.capabilities.create({
    tenantId, legalEntityId, capabilityCode, actor: OPERATOR,
    baselineEvidenceRef: 'evidence://baseline-measured',
  });

  const LADDER = ['OBSERVE_ONLY', 'RECOMMEND', 'PREPARE_DRAFT', 'EXECUTE_WITH_APPROVAL', 'AUTO_EXECUTE_WITHIN_POLICY'];
  const targetIdx = LADDER.indexOf(target);
  if (targetIdx <= 0) return h.capabilities.get(tenantId, capability.id);

  for (let i = 1; i <= targetIdx; i += 1) {
    const { grant } = await h.capabilities.grant({
      tenantId,
      id: capability.id,
      toAuthority: LADDER[i]!,
      grantedBy: GRANTOR,
      evidenceRefs: ['evidence://baseline-measured', 'evidence://policy-authored'],
    });
    await h.capabilities.activateGrant({
      tenantId, id: capability.id, grantId: grant.id, activatedBy: ACTIVATOR,
    });
  }
  return h.capabilities.get(tenantId, capability.id);
}

/** Authors and activates a policy gate through the real two-person ceremony. */
export async function activatePolicy(
  h: Harness,
  capabilityCode: string,
  overrides: Record<string, unknown> = {},
  opts: { tenantId?: string; legalEntityId?: string } = {},
): Promise<any> {
  const tenantId = opts.tenantId ?? TENANT;
  const legalEntityId = opts.legalEntityId ?? LE;
  const gate = await h.policies.save({
    tenantId,
    legalEntityId,
    capabilityCode,
    monetaryLimit: '10000.00',
    confidenceMin: '0.9000',
    allowedExceptionCategories: [],
    highRiskCategories: [],
    circuitBreakerThreshold: 3,
    policyVersion: '1.0',
    authoredBy: AUTHOR,
    effectiveDate: '2026-01-01',
    ...overrides,
  } as any);
  await h.policies.activate({ tenantId, id: gate.id, activatedBy: ACTIVATOR });
  return h.prisma.policyGate.findFirst({ where: { tenantId, id: gate.id } });
}
