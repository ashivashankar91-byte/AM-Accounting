/**
 * Retry, recovery and the circuit breaker.
 *
 * A retry is a fresh attempt at the same act, not a resumption of a
 * half-finished one: every gate is re-evaluated, so a retry can never smuggle
 * a stale approval past a gate that has since started refusing. Repeated
 * failure suspends the capability rather than letting it grind.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeHarness, promoteTo, activatePolicy, Harness,
  TENANT, LE, APPROVER, OPERATOR, GRANTOR, ACTIVATOR,
} from '../helpers/service-harness';

let h: Harness;
const CODE = 'S095_PORTFOLIO_RESERVE';

const LINES = [
  { accountCode: '1400', debit: '500.00', credit: '0.00', memo: 'accrual' },
  { accountCode: '2400', debit: '0.00', credit: '500.00', memo: 'accrual' },
];

async function approvedItem(subjectRef = 'STMT-RETRY-1') {
  const { item } = await h.items.create({
    tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, subjectRef,
    ruleVersion: 'rule-1.0', confidence: '0.9900', proposedAmount: '500.00',
    postingLines: LINES, periodYear: 2026, periodMonth: 1,
  } as any);
  await h.items.approve(TENANT, item.id, APPROVER);
  return item;
}

beforeEach(async () => {
  h = makeHarness();
  await promoteTo(h, CODE, 'EXECUTE_WITH_APPROVAL');
  await activatePolicy(h, CODE);
});

describe('retry preconditions', () => {
  it('refuses to retry an item that has not failed', async () => {
    const item = await approvedItem();
    await expect(h.items.retry(TENANT, item.id, LE, OPERATOR))
      .rejects.toThrowError(/Only a FAILED_CLOSED item can be retried/);
  });

  it('refuses to retry an item that already executed', async () => {
    const item = await approvedItem();
    await h.items.execute(TENANT, item.id, LE, OPERATOR);
    await expect(h.items.retry(TENANT, item.id, LE, OPERATOR)).rejects.toThrow();
  });
});

describe('retry after a transient upstream failure', () => {
  it('succeeds once the upstream recovers', async () => {
    const item = await approvedItem();
    h.posting.mode = 'REJECTED';
    const failed = await h.items.execute(TENANT, item.id, LE, OPERATOR);
    expect(failed.item.state).toBe('FAILED_CLOSED');

    h.posting.mode = 'POSTED';
    const retried = await h.items.retry(TENANT, item.id, LE, OPERATOR);
    expect(retried.item.state).toBe('EXECUTED');
    expect(retried.execution.outcome).toBe('EXECUTED');
  });

  it('counts the attempts so a grinding item is visible', async () => {
    const item = await approvedItem();
    h.posting.mode = 'REJECTED';
    await h.items.execute(TENANT, item.id, LE, OPERATOR);
    await h.items.retry(TENANT, item.id, LE, OPERATOR);
    await h.items.retry(TENANT, item.id, LE, OPERATOR);
    const after = await h.items.get(TENANT, item.id);
    expect(after.retryCount).toBe(2);
  });

  it('clears the stale failure reason when the retry succeeds', async () => {
    const item = await approvedItem();
    h.posting.mode = 'REJECTED';
    await h.items.execute(TENANT, item.id, LE, OPERATOR);
    h.posting.mode = 'POSTED';
    const retried = await h.items.retry(TENANT, item.id, LE, OPERATOR);
    expect(retried.item.failureReason).toBeNull();
  });

  it('re-runs every gate — a retry never inherits permission it no longer has', async () => {
    const item = await approvedItem();
    h.posting.mode = 'REJECTED';
    await h.items.execute(TENANT, item.id, LE, OPERATOR);

    // The period closed between the failure and the retry.
    h.posting.mode = 'POSTED';
    h.close.answer = true;
    await expect(h.items.retry(TENANT, item.id, LE, OPERATOR))
      .rejects.toThrowError(/closed/i);
    expect(h.posting.posted.every((p) => p.envelope.journalFamily !== 'AUTOMATION')
      || h.posting.posted.length === 1).toBe(true);
  });

  it('does not post twice when the first attempt actually reached the ledger', async () => {
    const item = await approvedItem();
    await h.items.execute(TENANT, item.id, LE, OPERATOR);
    const posted = h.posting.posted.length;
    await expect(h.items.retry(TENANT, item.id, LE, OPERATOR)).rejects.toThrow();
    expect(h.posting.posted).toHaveLength(posted);
  });
});

describe('the circuit breaker', () => {
  it('counts consecutive failures on the capability', async () => {
    h.posting.mode = 'REJECTED';
    const a = await approvedItem('S-A');
    await h.items.execute(TENANT, a.id, LE, OPERATOR);
    const cap = await h.prisma.automationCapability.findFirst({ where: { tenantId: TENANT, capabilityCode: CODE } });
    expect(cap.circuitBreakerCount).toBe(1);
  });

  it('resets the count after a success — the breaker measures a run, not a total', async () => {
    h.posting.mode = 'REJECTED';
    const a = await approvedItem('S-A');
    await h.items.execute(TENANT, a.id, LE, OPERATOR);
    h.posting.mode = 'POSTED';
    const b = await approvedItem('S-B');
    await h.items.execute(TENANT, b.id, LE, OPERATOR);

    const cap = await h.prisma.automationCapability.findFirst({ where: { tenantId: TENANT, capabilityCode: CODE } });
    expect(cap.circuitBreakerCount).toBe(0);
  });

  it('suspends the capability outright once the configured threshold is reached', async () => {
    h.posting.mode = 'REJECTED';
    for (const ref of ['S-1', 'S-2', 'S-3']) {
      const item = await approvedItem(ref);
      await h.items.execute(TENANT, item.id, LE, OPERATOR);
    }
    const cap = await h.prisma.automationCapability.findFirst({ where: { tenantId: TENANT, capabilityCode: CODE } });
    expect(cap.currentAuthority).toBe('SUSPENDED');
    expect(cap.suspendedBy).toBe('system:circuit-breaker');
    expect(h.events.has('automation.circuit_breaker.tripped')).toBe(true);
  });

  it('refuses further execution once it has tripped, even if the upstream recovers', async () => {
    h.posting.mode = 'REJECTED';
    for (const ref of ['S-1', 'S-2', 'S-3']) {
      const item = await approvedItem(ref);
      await h.items.execute(TENANT, item.id, LE, OPERATOR);
    }
    h.posting.mode = 'POSTED';
    const cap = await h.prisma.automationCapability.findFirst({ where: { tenantId: TENANT, capabilityCode: CODE } });
    const { item: next } = await h.items.create({
      tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, subjectRef: 'S-4',
      ruleVersion: 'rule-1.0', confidence: '0.9900', proposedAmount: '500.00',
      postingLines: LINES, periodYear: 2026, periodMonth: 1,
    } as any);
    await expect(h.items.execute(TENANT, next.id, LE, OPERATOR))
      .rejects.toThrowError(/suspended/i);
    expect(h.posting.posted.filter((p) => p.envelope.sourceEntityId === next.id)).toHaveLength(0);
    void cap;
  });

  it('is visible on the capability grid so an operator can see why work stopped', async () => {
    h.posting.mode = 'REJECTED';
    for (const ref of ['S-1', 'S-2', 'S-3']) {
      const item = await approvedItem(ref);
      await h.items.execute(TENANT, item.id, LE, OPERATOR);
    }
    const grid = await h.capabilities.list(TENANT, LE);
    const row = grid.find((c: any) => c.capabilityCode === CODE);
    expect(row.circuitBreakerCount).toBe(3);
    expect(row.circuitBreakerTripped).toBe(true);
    expect(row.truthfulState).toBe('SUSPENDED');
  });

  it('is cleared only by the two-person re-grant, which is the review it demands', async () => {
    h.posting.mode = 'REJECTED';
    for (const ref of ['S-1', 'S-2', 'S-3']) {
      const item = await approvedItem(ref);
      await h.items.execute(TENANT, item.id, LE, OPERATOR);
    }
    const cap = await h.prisma.automationCapability.findFirst({ where: { tenantId: TENANT, capabilityCode: CODE } });

    const { grant } = await h.capabilities.grant({
      tenantId: TENANT, id: cap.id, toAuthority: 'EXECUTE_WITH_APPROVAL', grantedBy: GRANTOR,
    });
    await expect(h.capabilities.activateGrant({ tenantId: TENANT, id: cap.id, grantId: grant.id, activatedBy: GRANTOR }))
      .rejects.toThrow();
    const restored = await h.capabilities.activateGrant({ tenantId: TENANT, id: cap.id, grantId: grant.id, activatedBy: ACTIVATOR });

    expect(restored.currentAuthority).toBe('EXECUTE_WITH_APPROVAL');
    expect(restored.circuitBreakerCount).toBe(0);

    // And work flows again.
    h.posting.mode = 'POSTED';
    const item = await approvedItem('S-AFTER');
    const result = await h.items.execute(TENANT, item.id, LE, OPERATOR);
    expect(result.item.state).toBe('EXECUTED');
  });
});

describe('health is measured from what happened', () => {
  it('counts executions and failures for the day', async () => {
    const ok = await approvedItem('S-OK');
    await h.items.execute(TENANT, ok.id, LE, OPERATOR);
    h.posting.mode = 'REJECTED';
    const bad = await approvedItem('S-BAD');
    await h.items.execute(TENANT, bad.id, LE, OPERATOR);

    const metrics = h.prisma.rows('AutomationHealthMetric');
    expect(metrics).toHaveLength(1);
    expect(metrics[0].totalItems).toBe(2);
    expect(metrics[0].executed).toBe(1);
    expect(metrics[0].failedClosed).toBe(1);
  });

  it('reports an unconfigured capability as NOT_CONFIGURED in the overview, not as healthy', async () => {
    const overview = await h.health.overview(TENANT, LE);
    expect(overview.capabilityCount).toBe(14);
    expect(overview.configuredCount).toBe(1);
    const unconfigured = overview.capabilities.filter((c: any) => !c.configured);
    expect(unconfigured).toHaveLength(13);
    expect(unconfigured.every((c: any) => c.currentAuthority === 'NOT_CONFIGURED')).toBe(true);
  });
});
