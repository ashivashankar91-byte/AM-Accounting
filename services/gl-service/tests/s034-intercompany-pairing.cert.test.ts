// S034 — Intercompany Pairing & Net-Zero
// Canonical ACs: pair management, IC entry recording, net-zero check, enforcement modes, tenant scope
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { IntercompanyService } from '../src/application/intercompany-service';

function makePrisma() {
  const pairs: any[] = [];
  const entries: any[] = [];
  let pairSeq = 1;
  let entrySeq = 1;
  return {
    intercompanyPair: {
      create: async ({ data }: any) => { const r = { id: `p${pairSeq++}`, ...data, createdAt: new Date() }; pairs.push(r); return r; },
      findMany: async ({ where }: any) => pairs.filter(p => p.tenantId === where.tenantId),
      findUnique: async ({ where }: any) => pairs.find(p => p.id === where.id) ?? null,
    },
    intercompanyEntry: {
      create: async ({ data }: any) => { const r = { id: `e${entrySeq++}`, ...data, createdAt: new Date() }; entries.push(r); return r; },
      findMany: async ({ where }: any) => entries.filter(e =>
        e.tenantId === where.tenantId && e.pairId === where.pairId &&
        e.periodYear === where.periodYear && e.periodMonth === where.periodMonth),
    },
  };
}

describe('S034 — Intercompany Pairing & Net-Zero', () => {
  const TENANT = 'tenant-A';

  it('AC1 — createPair normalises A↔B order to avoid duplicates; listPairs is tenant-scoped', async () => {
    const svc = new IntercompanyService(makePrisma());
    await svc.createPair({ entityAId: 'Z', entityBId: 'A', enforcement: 'BLOCK' }, TENANT, 'admin');
    const pairs = await svc.listPairs(TENANT);
    expect(pairs).toHaveLength(1);
    // sorted: A < Z → entityAId must be 'A'
    expect(pairs[0].entityAId).toBe('A');
    expect(pairs[0].entityBId).toBe('Z');
    // cross-tenant isolation
    const other = await svc.listPairs('other-tenant');
    expect(other).toHaveLength(0);
  });

  it('AC2 — recordIcEntry stores a journal-entry reference with period, entity and amount', async () => {
    const svc = new IntercompanyService(makePrisma());
    const pair = await svc.createPair({ entityAId: 'E1', entityBId: 'E2', enforcement: 'WARN' }, TENANT, 'admin');
    const entry = await svc.recordIcEntry(TENANT, pair.id, 'JE-001', 'E1', new Decimal('1000.00'), 2026, 1);
    expect(entry.journalEntryId).toBe('JE-001');
    expect(entry.originatingEntityId).toBe('E1');
    expect(entry.icAmount.toString()).toBe('1000');
  });

  it('AC3 — checkNetZero: balanced entries (A posts +, B posts -) returns isNetZero=true', async () => {
    const prisma = makePrisma();
    const svc = new IntercompanyService(prisma);
    const pair = await svc.createPair({ entityAId: 'E1', entityBId: 'E2', enforcement: 'BLOCK' }, TENANT, 'admin');
    await svc.recordIcEntry(TENANT, pair.id, 'JE-A', 'E1', new Decimal('500.00'), 2026, 3);
    await svc.recordIcEntry(TENANT, pair.id, 'JE-B', 'E2', new Decimal('-500.00'), 2026, 3);
    const results = await svc.checkNetZero(TENANT, 2026, 3);
    const result = results.find(r => r.pairId === pair.id)!;
    expect(result.isNetZero).toBe(true);
    expect(result.netBalance.toString()).toBe('0');
  });

  it('AC4 — checkNetZero: unbalanced entries set isNetZero=false', async () => {
    const prisma = makePrisma();
    const svc = new IntercompanyService(prisma);
    const pair = await svc.createPair({ entityAId: 'E1', entityBId: 'E2', enforcement: 'BLOCK' }, TENANT, 'admin');
    await svc.recordIcEntry(TENANT, pair.id, 'JE-ONLY', 'E1', new Decimal('300.00'), 2026, 4);
    const results = await svc.checkNetZero(TENANT, 2026, 4);
    const result = results.find(r => r.pairId === pair.id)!;
    expect(result.isNetZero).toBe(false);
    expect(result.entityABalance.toString()).toBe('300');
  });

  it('AC5 — enforcement=NONE returns informational result without throwing', async () => {
    const svc = new IntercompanyService(makePrisma());
    const pair = await svc.createPair({ entityAId: 'X', entityBId: 'Y', enforcement: 'NONE' }, TENANT, 'admin');
    await svc.recordIcEntry(TENANT, pair.id, 'JE-X', 'X', new Decimal('999.00'), 2026, 5);
    const results = await svc.checkNetZero(TENANT, 2026, 5);
    const result = results.find(r => r.pairId === pair.id)!;
    expect(result.isNetZero).toBe(false); // informational — no exception thrown
  });

  it('AC6 — tenant isolation: entries for another tenant are invisible to checkNetZero', async () => {
    const svc = new IntercompanyService(makePrisma());
    const pair = await svc.createPair({ entityAId: 'E1', entityBId: 'E2', enforcement: 'BLOCK' }, TENANT, 'admin');
    await svc.recordIcEntry('other-tenant', pair.id, 'JE-OTHER', 'E1', new Decimal('1000.00'), 2026, 6);
    const results = await svc.checkNetZero(TENANT, 2026, 6);
    const result = results.find(r => r.pairId === pair.id)!;
    // TENANT has no entries in period 6 → net balance is zero
    expect(result.netBalance.toString()).toBe('0');
  });
});
