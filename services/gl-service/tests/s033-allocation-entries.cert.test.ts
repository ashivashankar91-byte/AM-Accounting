/**
 * S033 — Allocation Entries — Certification Tests
 *
 * AC1: createTemplate() validates PERCENTAGE lines sum to 100%
 * AC2: createTemplate() stores tenantId on template and all lines (CLAUDE.md rule)
 * AC3: runAllocation() creates a balanced JE (debit source = Σ credits targets)
 * AC4: runAllocation() rejects zero sourceAmount (fail-closed)
 * AC5: listTemplates() returns only active templates for the requesting tenant
 * AC6: FIXED_AMOUNT basis allocates exact amounts to each target
 * AC7: JE created through standard glService.createJournalEntry — no direct GL write
 */
import { describe, it, expect, vi } from 'vitest';
import Decimal from 'decimal.js';
import { AllocationService } from '../src/application/allocation-service';

const TENANT = 'tenant-s033-cert';

function makeGlService() {
  const jeCalls: any[] = [];
  return {
    createJournalEntry: vi.fn(async (data: any, tenantId: string) => {
      jeCalls.push({ data, tenantId });
      return { id: `je-${Date.now()}`, ...data };
    }),
    _jeCalls: jeCalls,
  };
}

function makePrisma(template?: any) {
  const templates: any[] = template ? [template] : [];
  return {
    allocationTemplate: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: 'tpl-1', ...data, lines: data.lines?.create ?? [] };
        templates.push(row); return row;
      }),
      findMany: vi.fn(async ({ where }: any) =>
        templates.filter((t: any) => t.tenantId === where.tenantId && t.isActive !== false)
      ),
      findFirst: vi.fn(async ({ where }: any) =>
        templates.find((t: any) => t.id === where.id && t.tenantId === where.tenantId) ?? null
      ),
    },
  };
}

const PCT_TEMPLATE = {
  id: 'tpl-pct',
  tenantId: TENANT,
  name: 'Overhead 60/30/10',
  sourceAccountId: 'OVERHEAD-POOL',
  allocationBasis: 'PERCENTAGE' as const,
  journalSource: 'ALLOCATION',
  isActive: true,
  lines: [
    { id: 'l1', targetAccountId: 'FIXED-OPS', allocationPct: 60, lineOrder: 0 },
    { id: 'l2', targetAccountId: 'VAR-OPS', allocationPct: 30, lineOrder: 1 },
    { id: 'l3', targetAccountId: 'ADMIN', allocationPct: 10, lineOrder: 2 },
  ],
};

describe('S033 — Allocation Entries', () => {
  it('AC1: createTemplate() rejects PERCENTAGE lines not summing to 100%', async () => {
    const gl = makeGlService();
    const svc = new AllocationService(makePrisma(), gl);
    await expect(svc.createTemplate({
      name: 'Bad Pct',
      sourceAccountId: 'POOL',
      allocationBasis: 'PERCENTAGE',
      lines: [
        { targetAccountId: 'A', allocationPct: 60 },
        { targetAccountId: 'B', allocationPct: 30 },
        // Only 90% — missing 10%
      ],
    }, TENANT, 'user-1')).rejects.toThrow(/100%/);
  });

  it('AC2: createTemplate() stores tenantId on template (CLAUDE.md rule)', async () => {
    const prisma = makePrisma();
    const gl = makeGlService();
    const svc = new AllocationService(prisma, gl);
    const result = await svc.createTemplate({
      name: 'Valid Template',
      sourceAccountId: 'POOL',
      allocationBasis: 'PERCENTAGE',
      lines: [
        { targetAccountId: 'A', allocationPct: 70 },
        { targetAccountId: 'B', allocationPct: 30 },
      ],
    }, TENANT, 'user-1');
    expect(result.tenantId).toBe(TENANT);
    expect(prisma.allocationTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT }) })
    );
  });

  it('AC3: runAllocation() produces balanced JE — debit source equals sum of target credits', async () => {
    const gl = makeGlService();
    const svc = new AllocationService(makePrisma(PCT_TEMPLATE), gl);
    const amount = new Decimal('1000.00');
    const result = await svc.runAllocation('tpl-pct', TENANT, amount, new Date('2026-01-31'), 'user-1');

    expect(result.journalEntryId).toBeDefined();
    expect(result.allocatedAmount.toFixed(2)).toBe('1000.00');
    expect(gl.createJournalEntry).toHaveBeenCalledTimes(1);

    const { data } = gl._jeCalls[0];
    const totalDebit = data.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const totalCredit = data.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01); // balanced
  });

  it('AC4: runAllocation() rejects zero sourceAmount (fail-closed)', async () => {
    const gl = makeGlService();
    const svc = new AllocationService(makePrisma(PCT_TEMPLATE), gl);
    await expect(svc.runAllocation('tpl-pct', TENANT, new Decimal('0'), new Date(), 'user-1'))
      .rejects.toThrow(/zero/);
    expect(gl.createJournalEntry).not.toHaveBeenCalled();
  });

  it('AC5: listTemplates() returns only active records for requesting tenant', async () => {
    const prisma = makePrisma(PCT_TEMPLATE);
    const gl = makeGlService();
    const svc = new AllocationService(prisma, gl);
    const list = await svc.listTemplates(TENANT);
    expect(list.every((t: any) => t.tenantId === TENANT)).toBe(true);
    expect(prisma.allocationTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT, isActive: true }) })
    );
  });

  it('AC6: FIXED_AMOUNT basis distributes exact amounts', async () => {
    const FIXED_TEMPLATE = {
      ...PCT_TEMPLATE, id: 'tpl-fixed', allocationBasis: 'FIXED_AMOUNT',
      lines: [
        { id: 'l1', targetAccountId: 'FIXED-OPS', fixedAmount: 600, lineOrder: 0 },
        { id: 'l2', targetAccountId: 'VAR-OPS',   fixedAmount: 300, lineOrder: 1 },
        { id: 'l3', targetAccountId: 'ADMIN',      fixedAmount: 100, lineOrder: 2 },
      ],
    };
    const gl = makeGlService();
    const svc = new AllocationService(makePrisma(FIXED_TEMPLATE), gl);
    await svc.runAllocation('tpl-fixed', TENANT, new Decimal('1000.00'), new Date(), 'user-1');

    const { data } = gl._jeCalls[0];
    const targetLines = data.lines.filter((l: any) => l.accountId !== 'OVERHEAD-POOL');
    expect(targetLines.length).toBe(3);
    expect(targetLines[0].debit).toBe(600);
    expect(targetLines[1].debit).toBe(300);
    expect(targetLines[2].debit).toBe(100);
  });

  it('AC7: JE is created through glService.createJournalEntry — no direct GL write', async () => {
    const gl = makeGlService();
    const svc = new AllocationService(makePrisma(PCT_TEMPLATE), gl);
    await svc.runAllocation('tpl-pct', TENANT, new Decimal('500'), new Date(), 'user-1');
    expect(gl.createJournalEntry).toHaveBeenCalledTimes(1);
    // Verify tenantId is passed as second arg to createJournalEntry
    expect(gl._jeCalls[0].tenantId).toBe(TENANT);
  });
});
