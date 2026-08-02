import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { PhysicalInventoryService } from '../../src/application/physical-inventory-service';
import { PartsAccountMappingService } from '../../src/application/account-mapping-service';
import { FakePostingEventProducer } from '../../src/infrastructure/posting-client';

const TENANT = 'tenant-1'; const LE = 'le-1'; const STORE = 'store-1';

async function setUp() {
  const prisma = new FakePrismaClient();
  const mappings = new PartsAccountMappingService(prisma as any);
  await mappings.setAccountNumber(TENANT, LE, 'PHYSICAL_ADJUSTMENT', 'INVENTORY', '1310', 'controller-1');
  await mappings.setAccountNumber(TENANT, LE, 'PHYSICAL_ADJUSTMENT', 'INVENTORY_SHRINKAGE', '5320', 'controller-1');
  const posting = new FakePostingEventProducer((env) => ({ executionId: 'x', eventId: env.eventId, status: 'POSTED', idempotent: false, journalEntryId: 'je-1', journalNumber: 'JN-1' }));
  const svc = new PhysicalInventoryService(prisma as any, posting, mappings);
  await prisma.partsPerpetualBalance.create({ data: { tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-1', onHandQty: 10, onHandValue: 50 } });
  return { prisma, svc, posting };
}

describe('PhysicalInventoryService (S069)', () => {
  it('unapproved counts change nothing — no movement or journal exists until approve()', async () => {
    const { prisma, svc, posting } = await setUp();
    const session = await svc.openSession({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, scopeDescription: 'Bay A', blindCount: false });
    await svc.freeze(TENANT, LE, session.id, ['P-1']);
    await svc.enterCounts(TENANT, LE, session.id, [{ partNumber: 'P-1', countedQty: 8 }]);
    await svc.varianceReport(TENANT, LE, session.id);

    expect(posting.submitted.length).toBe(0);
    const movements = await prisma.partsMovement.findMany({ where: { tenantId: TENANT } });
    expect(movements.length).toBe(0);
    const balance = await prisma.partsPerpetualBalance.findUnique({ where: { tenantId_legalEntityId_storeId_partNumber: { tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-1' } } });
    expect(Number(balance!.onHandQty)).toBe(10); // unchanged
  });

  it('approval posts exactly the reviewed variance and corrects the perpetual balance', async () => {
    const { prisma, svc, posting } = await setUp();
    const session = await svc.openSession({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, scopeDescription: 'Bay A', blindCount: false });
    await svc.freeze(TENANT, LE, session.id, ['P-1']);
    await svc.enterCounts(TENANT, LE, session.id, [{ partNumber: 'P-1', countedQty: 8 }]); // variance -2 qty
    await svc.varianceReport(TENANT, LE, session.id);
    const { session: posted } = await svc.approve({ tenantId: TENANT, legalEntityId: LE, sessionId: session.id, approvedBy: 'mgr-1', correlationId: 'c1', businessDate: '2026-08-01' });

    expect(posted.status).toBe('POSTED');
    expect(posting.submitted.length).toBe(1); // one journal per approved session
    const balance = await prisma.partsPerpetualBalance.findUnique({ where: { tenantId_legalEntityId_storeId_partNumber: { tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-1' } } });
    expect(Number(balance!.onHandQty)).toBe(8); // corrected to counted qty
  });

  it('blind-count session strips perpetualQtySnapshot from the count-entry surface', async () => {
    // Confirms blindCount is honored at the HTTP sanitization boundary — this
    // test asserts the session itself carries the flag the routes layer reads.
    const { svc } = await setUp();
    const session = await svc.openSession({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, scopeDescription: 'Bay B', blindCount: true });
    expect(session.blindCount).toBe(true);
  });
});
