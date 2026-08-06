import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/serializable-retry', () => ({
  withSerializableRetry: async (prisma: any, fn: (tx: any) => Promise<any>) => fn(prisma),
}));

import { SubletService } from '../../src/application/sublet-service';
import { AccountMappingService } from '../../src/application/account-mapping-service';
import { FakePrismaClient } from '../support/fake-prisma';
import { FakePostingEventProducer } from '../support/fake-posting-client';
import { ROLES_BY_FAMILY, EVENT_FAMILY } from '../../src/domain/account-mapping-roles';
import { AccountMappingPendingError, NotFoundError } from '../../src/domain/errors';

function makeService() {
  const prisma = new FakePrismaClient();
  const postingClient = new FakePostingEventProducer();
  const mapping = new AccountMappingService(prisma as any);
  const service = new SubletService(prisma as any, postingClient, mapping);
  return { prisma, postingClient, mapping, service };
}

async function resolveAllMappings(prisma: FakePrismaClient, tenantId: string, legalEntityId: string, families: string[]) {
  for (const family of families) {
    for (const role of (ROLES_BY_FAMILY as any)[family] ?? []) {
      await (prisma as any).fixedOpsAccountMapping.create({
        data: { tenantId, legalEntityId, eventFamily: family, role, status: 'RESOLVED', accountNumber: null },
      });
    }
  }
}

describe('SubletService — S062', () => {
  it('accrues an OPEN sublet PO at RO close, posting exactly one journal and moving status to ACCRUED', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.SUBLET_ACCRUAL]);
    await service.createPo({ tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-1', poNumber: 'PO-1', vendorId: 'V-1', estimatedCost: '500.00', actor: 'tester' });

    const rows = await service.accrueAtClose('t1', 'le1', 'RO-1', 'evt-accrue-1', 'corr-1', 'tester');

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('ACCRUED');
    expect(rows[0].accrualJournalEntryId).toBeTruthy();
    expect(rows[0].accrualAmount).toBe('500.00');
    expect(postingClient.submitted).toHaveLength(1);
  });

  it('accrueAtClose only touches OPEN POs for the RO — a PO already ACCRUED is not re-accrued', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.SUBLET_ACCRUAL]);
    await service.createPo({ tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-1', poNumber: 'PO-1', vendorId: 'V-1', estimatedCost: '500.00', actor: 'tester' });

    await service.accrueAtClose('t1', 'le1', 'RO-1', 'evt-accrue-1', 'corr-1', 'tester');
    const second = await service.accrueAtClose('t1', 'le1', 'RO-1', 'evt-accrue-2', 'corr-2', 'tester');

    expect(second).toHaveLength(0); // no longer OPEN, so no second accrual/journal
    expect(postingClient.submitted).toHaveLength(1);
  });

  it('accrueAtClose rejects when SUBLET_ACCRUAL mapping is unresolved — the PO stays OPEN, no journal', async () => {
    const { prisma, postingClient, service } = makeService();
    await service.createPo({ tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-1', poNumber: 'PO-1', vendorId: 'V-1', estimatedCost: '500.00', actor: 'tester' });

    await expect(service.accrueAtClose('t1', 'le1', 'RO-1', 'evt-1', 'corr-1', 'tester')).rejects.toThrow(AccountMappingPendingError);
    expect(postingClient.submitted).toHaveLength(0);

    const po = await (prisma as any).subletPurchaseOrder.findFirst({ where: { tenantId: 't1', poNumber: 'PO-1' } });
    expect(po.status).toBe('OPEN');
  });

  it('matchInvoice against an un-accrued (still OPEN) PO treats it as pre-close: zero variance regardless of invoice amount', async () => {
    const { prisma, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.SUBLET_RELIEF]);
    await service.createPo({ tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-1', poNumber: 'PO-1', vendorId: 'V-1', estimatedCost: '500.00', actor: 'tester' });

    const match = await service.matchInvoice({ tenantId: 't1', poNumber: 'PO-1', invoiceId: 'INV-1', invoiceAmount: '550.00', sourceEventId: 'evt-1', correlationId: 'corr-1', actor: 'tester' });

    expect(match.varianceAmount).toBe(0);
    const po = await (prisma as any).subletPurchaseOrder.findFirst({ where: { tenantId: 't1', poNumber: 'PO-1' } });
    expect(po.status).toBe('INVOICE_MATCHED_PRE_CLOSE');
  });

  it('matchInvoice against an ACCRUED PO computes the real variance (invoice minus accrual) and closes the PO', async () => {
    const { prisma, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.SUBLET_ACCRUAL, EVENT_FAMILY.SUBLET_RELIEF]);
    await service.createPo({ tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-1', poNumber: 'PO-1', vendorId: 'V-1', estimatedCost: '500.00', actor: 'tester' });
    await service.accrueAtClose('t1', 'le1', 'RO-1', 'evt-accrue-1', 'corr-1', 'tester');

    const match = await service.matchInvoice({ tenantId: 't1', poNumber: 'PO-1', invoiceId: 'INV-1', invoiceAmount: '550.00', sourceEventId: 'evt-relief-1', correlationId: 'corr-2', actor: 'tester' });

    expect(match.varianceAmount).toBe(50); // 550 invoice - 500 accrued
    const po = await (prisma as any).subletPurchaseOrder.findFirst({ where: { tenantId: 't1', poNumber: 'PO-1' } });
    expect(po.status).toBe('CLOSED');
  });

  it('matchInvoice is idempotent on (subletPoId, invoiceId) — replay returns the original match, no duplicate journal', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.SUBLET_RELIEF]);
    await service.createPo({ tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-1', poNumber: 'PO-1', vendorId: 'V-1', estimatedCost: '500.00', actor: 'tester' });

    const req = { tenantId: 't1', poNumber: 'PO-1', invoiceId: 'INV-1', invoiceAmount: '500.00', sourceEventId: 'evt-1', correlationId: 'corr-1', actor: 'tester' };
    const first = await service.matchInvoice(req);
    const second = await service.matchInvoice(req);

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
    expect(postingClient.submitted).toHaveLength(1);
  });

  it('matchInvoice against a nonexistent PO number throws NotFoundError', async () => {
    const { service } = makeService();
    await expect(service.matchInvoice({ tenantId: 't1', poNumber: 'PO-MISSING', invoiceId: 'INV-1', invoiceAmount: '100.00', sourceEventId: 'evt-1', correlationId: 'corr-1', actor: 'tester' }))
      .rejects.toThrow(NotFoundError);
  });
});
