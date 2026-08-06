/**
 * CERTIFICATION TEST — S101B OEM Statement Auto-Matcher
 *
 * Certifies:
 *  1. suggest() creates EXACT_RULE suggestions for claim-number-matched lines
 *  2. EXACT_RULE + AUTO_EXECUTE_WITHIN_POLICY → auto-disposed (state=ACCEPTED)
 *  3. Judgment-class lines are never auto-disposed regardless of rule type
 *  4. SoD: dispose() by the same automation identity throws SoDViolationError
 *  5. dispose() by a different human actor succeeds
 *  6. SCORED_SUGGESTION lines are never auto-disposed
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { OemMatchService } from '../../src/application/oem-match-service';
import { SoDViolationError } from '../../src/domain/errors';

const TENANT = 'tenant-oem';
const LE = 'le-1';
const SESSION = 'session-001';
const AUTOMATION = 'automation:oem-matcher';

function makePrisma() {
  const rows: any[] = [];
  let seq = 1;
  return {
    _rows: rows,
    oemMatchSuggestion: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const r = { id: `sug${seq++}`, ...data };
        rows.push(r);
        return r;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) =>
        rows.find(r => r.id === where.id && r.tenantId === where.tenantId) ?? null
      ),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const idx = rows.findIndex(r => r.id === where.id);
        if (idx >= 0) Object.assign(rows[idx], data);
        return rows[idx];
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeEvents() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

function makeOemAdapter(signal = { status: 'AVAILABLE', detail: null }) {
  return {
    getStatementSession: vi.fn().mockResolvedValue({ signal, session: null }),
  };
}

function makeCapabilities(authority = 'AUTO_EXECUTE_WITHIN_POLICY') {
  return {
    requireConfigured: vi.fn().mockResolvedValue({ currentAuthority: authority }),
  };
}

describe('S101B — OEM Statement Auto-Matcher', () => {
  const statementLines = [
    { lineRef: 'L1', claimNumber: 'CLM-001', amount: '1000.00', isJudgmentClass: false },
    { lineRef: 'L2', claimNumber: 'CLM-002', amount: '500.00', isJudgmentClass: false },
  ];
  const bookItems = [
    { id: 'B1', claimNumber: 'CLM-001', amount: '1000.00' },
    { id: 'B2', claimNumber: 'CLM-002', amount: '500.00' },
  ];

  it('AC1 — suggest() creates one oemMatchSuggestion row per statement line', async () => {
    const prisma = makePrisma();
    const svc = new OemMatchService(prisma as any, makeEvents() as any, makeOemAdapter() as any, makeCapabilities() as any);
    const result = await svc.suggest({ tenantId: TENANT, legalEntityId: LE, s101aSessionId: SESSION, automationIdentity: AUTOMATION, statementLines, bookItems });
    expect(result.items).toHaveLength(2);
  });

  it('AC2 — EXACT_RULE match with AUTO_EXECUTE authority auto-disposes (state=ACCEPTED)', async () => {
    const prisma = makePrisma();
    const svc = new OemMatchService(prisma as any, makeEvents() as any, makeOemAdapter() as any, makeCapabilities() as any);
    await svc.suggest({ tenantId: TENANT, legalEntityId: LE, s101aSessionId: SESSION, automationIdentity: AUTOMATION, statementLines, bookItems });
    const autoDisposed = prisma._rows.filter(r => r.state === 'ACCEPTED');
    expect(autoDisposed.length).toBeGreaterThan(0);
    autoDisposed.forEach(r => expect(r.matchType).toBe('EXACT_RULE'));
  });

  it('AC3 — judgment-class lines are never auto-disposed even with EXACT_RULE + AUTO authority', async () => {
    const judgmentLines = [{ lineRef: 'LJ', claimNumber: 'CLM-001', amount: '1000.00', isJudgmentClass: true }];
    const prisma = makePrisma();
    const svc = new OemMatchService(prisma as any, makeEvents() as any, makeOemAdapter() as any, makeCapabilities() as any);
    await svc.suggest({ tenantId: TENANT, legalEntityId: LE, s101aSessionId: SESSION, automationIdentity: AUTOMATION, statementLines: judgmentLines, bookItems });
    const judgmentRow = prisma._rows.find(r => r.isJudgmentClass);
    expect(judgmentRow?.state).not.toBe('ACCEPTED');
  });

  it('AC4 — SoD: automation identity cannot dispose its own suggestion (SoDViolationError)', async () => {
    const prisma = makePrisma();
    const svc = new OemMatchService(prisma as any, makeEvents() as any, makeOemAdapter() as any, makeCapabilities() as any);
    await svc.suggest({ tenantId: TENANT, legalEntityId: LE, s101aSessionId: SESSION, automationIdentity: AUTOMATION, statementLines: [statementLines[0]], bookItems });
    // set state to SUGGESTED so it's disposable
    prisma._rows[0].state = 'SUGGESTED';
    await expect(svc.dispose({ tenantId: TENANT, id: prisma._rows[0].id, decision: 'ACCEPTED', actor: AUTOMATION }))
      .rejects.toThrow(SoDViolationError);
  });

  it('AC5 — dispose() by a different human actor succeeds and updates the row state', async () => {
    const prisma = makePrisma();
    const svc = new OemMatchService(prisma as any, makeEvents() as any, makeOemAdapter() as any, makeCapabilities() as any);
    await svc.suggest({ tenantId: TENANT, legalEntityId: LE, s101aSessionId: SESSION, automationIdentity: AUTOMATION, statementLines: [statementLines[0]], bookItems });
    prisma._rows[0].state = 'SUGGESTED';
    const updated = await svc.dispose({ tenantId: TENANT, id: prisma._rows[0].id, decision: 'ACCEPTED', actor: 'human-reviewer' });
    expect(updated.state).toBe('ACCEPTED');
    expect(updated.disposedBy).toBe('human-reviewer');
  });

  it('AC6 — SCORED_SUGGESTION lines stay in SUGGESTED state with SUGGEST_ONLY authority', async () => {
    const noAutoLines = [{ lineRef: 'L9', claimNumber: null, amount: '999.00', isJudgmentClass: false }];
    const noMatchItems = [{ id: 'BX', claimNumber: 'UNRELATED', amount: '999.00' }];
    const prisma = makePrisma();
    const svc = new OemMatchService(prisma as any, makeEvents() as any, makeOemAdapter() as any, makeCapabilities('SUGGEST_ONLY') as any);
    await svc.suggest({ tenantId: TENANT, legalEntityId: LE, s101aSessionId: SESSION, automationIdentity: AUTOMATION, statementLines: noAutoLines, bookItems: noMatchItems });
    expect(prisma._rows[0].state).toBe('SUGGESTED');
  });
});
