/**
 * Reversal and correction.
 *
 * An executed automation action is a posted fact. It is never edited away —
 * it is reversed by a new, equally governed action that points back at it. A
 * reversal that cannot be posted must not leave the books believing the
 * original was undone.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeHarness, promoteTo, activatePolicy, Harness,
  TENANT, OTHER_TENANT, LE, OTHER_LE, APPROVER, OPERATOR, AUTOMATION,
} from '../helpers/service-harness';

let h: Harness;
const CODE = 'S095_PORTFOLIO_RESERVE';

const LINES = [
  { accountCode: '1400', debit: '2500.00', credit: '0.00', memo: 'accrual' },
  { accountCode: '2400', debit: '0.00', credit: '2500.00', memo: 'accrual' },
];

async function executedItem() {
  await promoteTo(h, CODE, 'EXECUTE_WITH_APPROVAL');
  await activatePolicy(h, CODE);
  const { item } = await h.items.create({
    tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, subjectRef: 'STMT-REV-1',
    ruleVersion: 'rule-1.0', confidence: '0.9900', proposedAmount: '2500.00',
    postingLines: LINES, periodYear: 2026, periodMonth: 1,
  } as any);
  await h.items.approve(TENANT, item.id, APPROVER);
  const result = await h.items.execute(TENANT, item.id, LE, OPERATOR);
  return { item: result.item, execution: result.execution };
}

beforeEach(() => { h = makeHarness(); });

describe('reversal preconditions', () => {
  it('refuses to reverse an item that never executed', async () => {
    await promoteTo(h, CODE, 'EXECUTE_WITH_APPROVAL');
    await activatePolicy(h, CODE);
    const { item } = await h.items.create({
      tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, subjectRef: 'S-1', ruleVersion: 'r1',
    } as any);
    await expect(h.items.reverse(TENANT, item.id, LE, APPROVER, 'oops'))
      .rejects.toThrowError(/Only an executed item can be reversed/);
  });

  it('refuses a reversal scoped to a different legal entity', async () => {
    const { item } = await executedItem();
    await expect(h.items.reverse(TENANT, item.id, OTHER_LE, APPROVER, 'oops'))
      .rejects.toThrowError(/CROSS_ENTITY|legal entity/i);
  });

  it('refuses a reversal across tenants', async () => {
    const { item } = await executedItem();
    await expect(h.items.reverse(OTHER_TENANT, item.id, LE, APPROVER, 'oops')).rejects.toThrow();
  });
});

describe('a reversal is a new governed posting', () => {
  it('posts an equal and opposite entry through CE-07', async () => {
    const { item } = await executedItem();
    const before = h.posting.posted.length;
    await h.items.reverse(TENANT, item.id, LE, APPROVER, 'statement restated');

    expect(h.posting.posted).toHaveLength(before + 1);
    const envelope = h.posting.posted[before]!.envelope;
    expect(envelope.journalFamily).toBe('AUTOMATION_REVERSAL');
    expect(envelope.lines[0]!.debit).toBe('0.00');
    expect(envelope.lines[0]!.credit).toBe('2500.00');
    expect(envelope.lines[1]!.debit).toBe('2500.00');
    expect(envelope.lines[1]!.credit).toBe('0.00');
  });

  it('references the original journal so the pair is traceable', async () => {
    const { item, execution } = await executedItem();
    await h.items.reverse(TENANT, item.id, LE, APPROVER, 'statement restated');
    const envelope = h.posting.posted[1]!.envelope as any;
    expect(envelope.originalJournalRef).toBe(execution.journalEntryId);
  });

  it('writes a reversal execution row pointing back at the original', async () => {
    const { item, execution } = await executedItem();
    const { execution: reversal } = await h.items.reverse(TENANT, item.id, LE, APPROVER, 'restated');
    expect(reversal.reversalOf).toBe(execution.id);
    expect(reversal.outcome).toBe('REVERSED');
  });

  it('uses a distinct idempotency key from the original', async () => {
    const { item, execution } = await executedItem();
    const { execution: reversal } = await h.items.reverse(TENANT, item.id, LE, APPROVER, 'restated');
    expect(reversal.idempotencyKey).not.toBe(execution.idempotencyKey);
  });

  it('leaves the original execution row byte-identical', async () => {
    const { item, execution } = await executedItem();
    const snapshot = JSON.stringify(execution);
    await h.items.reverse(TENANT, item.id, LE, APPROVER, 'restated');
    const stored = h.prisma.rows('AutomationExecution').find((r: any) => r.id === execution.id);
    expect(JSON.stringify(stored)).toBe(snapshot);
  });

  it('replays instead of double-reversing', async () => {
    const { item } = await executedItem();
    const first = await h.items.reverse(TENANT, item.id, LE, APPROVER, 'restated');
    const second = await h.items.reverse(TENANT, item.id, LE, APPROVER, 'restated again');

    expect(second.replayed).toBe(true);
    expect(second.execution.id).toBe(first.execution.id);
    expect(h.prisma.rows('AutomationExecution')).toHaveLength(2);
  });

  it('does not claim the reversal succeeded when CE-07 refuses it', async () => {
    const { item } = await executedItem();
    h.posting.mode = 'REJECTED';
    const { execution } = await h.items.reverse(TENANT, item.id, LE, APPROVER, 'restated');
    expect(execution.outcome).toBe('FAILED_CLOSED');
    expect(execution.journalEntryId).toBeNull();
    expect(execution.failureReason).toMatch(/could not be posted/i);
  });
});

describe('the reversal is attributable', () => {
  it('records the human who asked for it, not just the automation identity', async () => {
    const { item } = await executedItem();
    const { execution } = await h.items.reverse(TENANT, item.id, LE, APPROVER, 'restated');
    const trace = execution.lineageTrace as any;
    expect(trace.actor).toBe(APPROVER);
    expect(execution.approvedBy).toBe(APPROVER);
    expect(execution.executedBy).toBe(AUTOMATION);
  });

  it('records the reason on the reversal', async () => {
    const { item } = await executedItem();
    await h.items.reverse(TENANT, item.id, LE, APPROVER, 'lender restated the statement');
    const envelope = h.posting.posted[1]!.envelope;
    expect(envelope.memo).toMatch(/lender restated the statement/);
  });

  it('publishes a reversal event so downstream consumers learn of it', async () => {
    const { item } = await executedItem();
    await h.items.reverse(TENANT, item.id, LE, APPROVER, 'restated');
    expect(h.events.has('automation.item.reversed')).toBe(true);
  });
});
