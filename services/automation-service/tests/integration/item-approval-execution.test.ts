/**
 * The item path from recommendation to executed journal, driven through the
 * real services and the real policy gates.
 *
 * The load-bearing claims: automation cannot approve its own work; nothing
 * reaches the ledger except through CE-07; a replay returns the first result
 * instead of posting twice; and a refusal is recorded as a refusal, never as
 * a silent success.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeHarness, promoteTo, activatePolicy, Harness,
  TENANT, OTHER_TENANT, LE, OTHER_LE, APPROVER, OPERATOR, AUTOMATION,
} from '../helpers/service-harness';
import { PENDING_UPSTREAM } from '../../src/domain/interfaces';

let h: Harness;
const CODE = 'S095_PORTFOLIO_RESERVE';

const LINES = [
  { accountCode: '1400', debit: '1000.00', credit: '0.00', memo: 'reserve' },
  { accountCode: '2400', debit: '0.00', credit: '1000.00', memo: 'reserve' },
];

async function readyItem(overrides: Record<string, unknown> = {}) {
  await promoteTo(h, CODE, 'EXECUTE_WITH_APPROVAL');
  await activatePolicy(h, CODE);
  const { item } = await h.items.create({
    tenantId: TENANT,
    legalEntityId: LE,
    capabilityCode: CODE,
    subjectRef: 'STMT-2026-01',
    ruleVersion: 'rule-1.0',
    confidence: '0.9900',
    proposedAmount: '1000.00',
    postingLines: LINES,
    periodYear: 2026,
    periodMonth: 1,
    ...overrides,
  } as any);
  return item;
}

beforeEach(() => { h = makeHarness(); });

describe('item creation', () => {
  it('produces an OBSERVATION_ONLY item while the capability only observes', async () => {
    await promoteTo(h, CODE, 'OBSERVE_ONLY');
    const { item } = await h.items.create({
      tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, subjectRef: 'STMT-1', ruleVersion: 'r1',
    });
    expect(item.state).toBe('OBSERVATION_ONLY');
  });

  it('refuses to create an item for a capability nobody configured', async () => {
    await expect(h.items.create({
      tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, subjectRef: 'STMT-1', ruleVersion: 'r1',
    })).rejects.toThrowError(/not configured/i);
  });

  it('stamps the automation identity on the item so the approver is checkable', async () => {
    const item = await readyItem();
    expect(item.automationIdentity).toBe(AUTOMATION);
  });

  it('marks an EXECUTE_WITH_APPROVAL capability\'s item as requiring approval', async () => {
    const item = await readyItem();
    expect(item.approvalRequired).toBe(true);
  });

  it('returns the first item on a duplicate request rather than proposing the money twice', async () => {
    const first = await readyItem();
    const again = await h.items.create({
      tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, subjectRef: 'STMT-2026-01',
      ruleVersion: 'rule-1.0', proposedAmount: '1000.00',
    } as any);
    expect(again.deduplicated).toBe(true);
    expect(again.item.id).toBe(first.id);
    expect(h.prisma.rows('AutomationItem')).toHaveLength(1);
  });
});

describe('separation of duties on approval', () => {
  it('refuses an approval signed by the automation identity that produced the item', async () => {
    const item = await readyItem();
    await expect(h.items.approve(TENANT, item.id, AUTOMATION))
      .rejects.toThrowError(/cannot approve/i);
    const after = await h.items.get(TENANT, item.id);
    expect(after.approvedBy).toBeNull();
  });

  it('refuses an approval by any automation-shaped identity, not just the exact one', async () => {
    const item = await readyItem();
    await expect(h.items.approve(TENANT, item.id, 'automation:another-bot')).rejects.toThrow();
    await expect(h.items.approve(TENANT, item.id, 'svc:automation-worker')).rejects.toThrow();
  });

  it('accepts an approval by a human and moves the item to EXECUTION_PENDING', async () => {
    const item = await readyItem();
    const approved = await h.items.approve(TENANT, item.id, APPROVER, 'reviewed statement');
    expect(approved.approvedBy).toBe(APPROVER);
    expect(approved.state).toBe('EXECUTION_PENDING');
  });

  it('treats a second approval as a no-op rather than a second signature', async () => {
    const item = await readyItem();
    await h.items.approve(TENANT, item.id, APPROVER);
    const again = await h.items.approve(TENANT, item.id, 'user-someone-else');
    expect(again.approvedBy).toBe(APPROVER);
  });

  it('refuses to reject an item on behalf of automation', async () => {
    const item = await readyItem();
    await expect(h.items.reject(TENANT, item.id, AUTOMATION, 'no')).rejects.toThrow();
  });

  it('records a rejection as FAILED_CLOSED with the reason preserved', async () => {
    const item = await readyItem();
    const rejected = await h.items.reject(TENANT, item.id, APPROVER, 'statement not final');
    expect(rejected.state).toBe('FAILED_CLOSED');
    expect(rejected.rejectionReason).toBe('statement not final');
    expect(rejected.rejectedBy).toBe(APPROVER);
  });
});

describe('execution through the governed posting path', () => {
  it('refuses to execute an approval-required item that nobody approved', async () => {
    const item = await readyItem();
    await expect(h.items.execute(TENANT, item.id, LE, OPERATOR)).rejects.toThrow();
    expect(h.posting.posted).toHaveLength(0);
  });

  it('posts through CE-07 and never writes a journal itself', async () => {
    const item = await readyItem();
    await h.items.approve(TENANT, item.id, APPROVER);
    const { execution } = await h.items.execute(TENANT, item.id, LE, OPERATOR);

    expect(h.posting.posted).toHaveLength(1);
    expect(execution.outcome).toBe('EXECUTED');
    expect(execution.journalEntryId).toBe('je-1');
    expect(execution.postingExecutionId).toBe('pex-1');
  });

  it('hands CE-07 an idempotency identity and the item lineage', async () => {
    const item = await readyItem();
    await h.items.approve(TENANT, item.id, APPROVER);
    await h.items.execute(TENANT, item.id, LE, OPERATOR);

    const envelope = h.posting.posted[0]!.envelope;
    expect(envelope.idempotencyIdentity).toBeTruthy();
    expect(envelope.sourceEntityType).toBe(`CE17_${CODE}`);
    expect(envelope.sourceEntityId).toBe(item.id);
    expect(envelope.lines).toHaveLength(2);
  });

  it('records who approved and which policy version authorised the execution', async () => {
    const item = await readyItem();
    await h.items.approve(TENANT, item.id, APPROVER);
    const { execution } = await h.items.execute(TENANT, item.id, LE, OPERATOR);
    expect(execution.approvedBy).toBe(APPROVER);
    expect(execution.executedBy).toBe(AUTOMATION);
    expect(execution.policyVersion).toBe('1.0');
    expect(execution.ruleVersion).toBe('rule-1.0');
  });

  it('replays instead of posting a second time', async () => {
    const item = await readyItem();
    await h.items.approve(TENANT, item.id, APPROVER);
    const first = await h.items.execute(TENANT, item.id, LE, OPERATOR);
    const second = await h.items.execute(TENANT, item.id, LE, OPERATOR);

    expect(second.replayed).toBe(true);
    expect(second.execution.id).toBe(first.execution.id);
    expect(h.posting.posted).toHaveLength(1);
    expect(h.prisma.rows('AutomationExecution')).toHaveLength(1);
  });

  it('fails closed when CE-07 refuses, and reports no journal', async () => {
    const item = await readyItem();
    await h.items.approve(TENANT, item.id, APPROVER);
    h.posting.mode = 'REJECTED';
    const { item: after, execution } = await h.items.execute(TENANT, item.id, LE, OPERATOR);

    expect(after.state).toBe('FAILED_CLOSED');
    expect(execution.outcome).toBe('FAILED_CLOSED');
    expect(execution.journalEntryId).toBeNull();
    expect(after.failureReason).toMatch(/refused/i);
  });

  it('fails closed — never optimistically — when CE-07 is unreachable', async () => {
    const item = await readyItem();
    await h.items.approve(TENANT, item.id, APPROVER);
    h.posting.mode = PENDING_UPSTREAM as any;
    const { item: after } = await h.items.execute(TENANT, item.id, LE, OPERATOR);

    expect(after.state).toBe('FAILED_CLOSED');
    expect(after.failureReason).toMatch(/unavailable/i);
  });

  it('executes a non-financial capability without any posting round-trip', async () => {
    await promoteTo(h, 'S107_COMPOSITE_EXPORT', 'EXECUTE_WITH_APPROVAL');
    await activatePolicy(h, 'S107_COMPOSITE_EXPORT');
    const { item } = await h.items.create({
      tenantId: TENANT, legalEntityId: LE, capabilityCode: 'S107_COMPOSITE_EXPORT',
      subjectRef: 'EXPORT-2026-01', ruleVersion: 'r1', confidence: '0.9900',
      periodYear: 2026, periodMonth: 1,
    } as any);
    await h.items.approve(TENANT, item.id, APPROVER);
    const { execution } = await h.items.execute(TENANT, item.id, LE, OPERATOR);
    expect(execution.outcome).toBe('EXECUTED');
    expect(execution.journalEntryId).toBeNull();
    expect(h.posting.posted).toHaveLength(0);
  });

  it('refuses to execute a capability whose ceiling stops at PREPARE_DRAFT', async () => {
    await promoteTo(h, 'S118_GAAP_MEMO', 'PREPARE_DRAFT');
    await activatePolicy(h, 'S118_GAAP_MEMO');
    const { item } = await h.items.create({
      tenantId: TENANT, legalEntityId: LE, capabilityCode: 'S118_GAAP_MEMO',
      subjectRef: 'MEMO-1', ruleVersion: 'r1', confidence: '0.9900', periodYear: 2026, periodMonth: 1,
    } as any);
    await h.items.approve(TENANT, item.id, APPROVER);
    await expect(h.items.execute(TENANT, item.id, LE, OPERATOR))
      .rejects.toThrowError(/below EXECUTE_WITH_APPROVAL/);
  });
});

describe('the execution record is evidence', () => {
  it('keeps the policy evaluation that authorised it', async () => {
    const item = await readyItem();
    await h.items.approve(TENANT, item.id, APPROVER);
    const { execution } = await h.items.execute(TENANT, item.id, LE, OPERATOR);
    const trace = execution.lineageTrace as any;
    expect(trace.policyEvaluation.allowed).toBe(true);
    expect(Array.isArray(trace.policyEvaluation.checks)).toBe(true);
    expect(trace.policyEvaluation.checks.length).toBeGreaterThanOrEqual(11);
    expect(trace.policyEvaluation.checks.every((c: any) => c.passed)).toBe(true);
  });

  it('exposes a lineage view linking source evidence to the journal', async () => {
    const item = await readyItem({ sourceEvidenceRefs: ['doc://statement.pdf'] });
    await h.items.approve(TENANT, item.id, APPROVER);
    await h.items.execute(TENANT, item.id, LE, OPERATOR);

    const lineage = await h.items.lineage(TENANT, item.id);
    expect(lineage.item.id).toBe(item.id);
    expect(lineage.sourceEvidenceRefs).toContain('doc://statement.pdf');
    expect(lineage.executions[0].journalEntryId).toBe('je-1');
  });

  it('never rewrites an execution row — a correction is a new row', async () => {
    const item = await readyItem();
    await h.items.approve(TENANT, item.id, APPROVER);
    const { execution } = await h.items.execute(TENANT, item.id, LE, OPERATOR);
    const snapshot = JSON.stringify(execution);

    await h.items.reverse(TENANT, item.id, LE, APPROVER, 'statement restated');
    const rows = h.prisma.rows('AutomationExecution');
    expect(rows).toHaveLength(2);
    const original = rows.find((r: any) => r.id === execution.id);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('tenant isolation', () => {
  it('refuses to read an item across tenants', async () => {
    const item = await readyItem();
    await expect(h.items.get(OTHER_TENANT, item.id)).rejects.toThrowError(/does not exist/i);
  });

  it('refuses to approve an item across tenants', async () => {
    const item = await readyItem();
    await expect(h.items.approve(OTHER_TENANT, item.id, APPROVER)).rejects.toThrow();
  });

  it('refuses to execute an item scoped to a different legal entity', async () => {
    const item = await readyItem();
    await h.items.approve(TENANT, item.id, APPROVER);
    await expect(h.items.execute(TENANT, item.id, OTHER_LE, OPERATOR))
      .rejects.toThrowError(/CROSS_ENTITY|legal entity/i);
    expect(h.posting.posted).toHaveLength(0);
  });
});

describe('claiming', () => {
  it('lets exactly one worker claim an item', async () => {
    const item = await readyItem();
    await h.items.claim(TENANT, item.id, 'worker-1');
    await expect(h.items.claim(TENANT, item.id, 'worker-2'))
      .rejects.toThrowError(/already claimed/i);
  });

  it('lets the same worker re-claim its own item', async () => {
    const item = await readyItem();
    await h.items.claim(TENANT, item.id, 'worker-1');
    const again = await h.items.claim(TENANT, item.id, 'worker-1');
    expect(again.claimedBy).toBe('worker-1');
  });
});
