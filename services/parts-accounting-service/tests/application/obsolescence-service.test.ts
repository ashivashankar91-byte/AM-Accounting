import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { ObsolescenceService } from '../../src/application/obsolescence-service';
import { PartsAccountMappingService } from '../../src/application/account-mapping-service';
import { FakePostingEventProducer } from '../../src/infrastructure/posting-client';

const TENANT = 'tenant-1'; const LE = 'le-1'; const STORE = 'store-1';

async function setUp(mapFamilies: string[] = ['OBSOLESCENCE_PROVISION', 'SCRAP_DISPOSAL']) {
  const prisma = new FakePrismaClient();
  const mappings = new PartsAccountMappingService(prisma as any);
  const roleMap: Record<string, string[]> = {
    OBSOLESCENCE_PROVISION: ['OBSOLESCENCE_EXPENSE', 'OBSOLESCENCE_ALLOWANCE'],
    SCRAP_DISPOSAL: ['INVENTORY', 'OBSOLESCENCE_ALLOWANCE', 'SCRAP_EXPENSE'],
  };
  for (const family of mapFamilies) {
    for (const role of roleMap[family]!) await mappings.setAccountNumber(TENANT, LE, family, role, '2200', 'controller-1');
  }
  const posting = new FakePostingEventProducer((env) => ({ executionId: 'x', eventId: env.eventId, status: 'POSTED', idempotent: false, journalEntryId: 'je-1', journalNumber: 'JN-1' }));
  const svc = new ObsolescenceService(prisma as any, posting, mappings);
  return { prisma, svc, posting };
}

describe('ObsolescenceService — preview (S068 aging-band provision)', () => {
  it('applies each line\'s band % to its own base value — never a flat/global %', async () => {
    const { svc } = await setUp();
    const run = await svc.preview(TENANT, LE, '2026-08-01', { '0-90': 0, '91-180': 10, '181+': 25 }, [
      { partNumber: 'P-1', ageBand: '91-180', qty: 5, baseValue: 1000 },
      { partNumber: 'P-2', ageBand: '181+', qty: 2, baseValue: 400 },
      { partNumber: 'P-3', ageBand: '0-90', qty: 10, baseValue: 500 },
    ]);
    expect(run.status).toBe('PREVIEWED');
    // P-1: 1000 * 10% = 100.00, P-2: 400 * 25% = 100.00, P-3: 500 * 0% = 0.00
    expect(run.lines.find((l: any) => l.partNumber === 'P-1').provisionAmount).toBe(100);
    expect(run.lines.find((l: any) => l.partNumber === 'P-2').provisionAmount).toBe(100);
    expect(run.lines.find((l: any) => l.partNumber === 'P-3').provisionAmount).toBe(0);
    expect(run.previewTotal).toBe(200);
  });

  it('a band absent from bandConfig defaults to 0% — never an invented/estimated percentage', async () => {
    const { svc } = await setUp();
    const run = await svc.preview(TENANT, LE, '2026-08-01', { '91-180': 10 }, [
      { partNumber: 'P-9', ageBand: 'UNKNOWN_BAND', qty: 1, baseValue: 900 },
    ]);
    expect(run.lines[0].provisionAmount).toBe(0);
  });
});

describe('ObsolescenceService — approve', () => {
  it('posts exactly the previewed total, is idempotent on replay, and links the real journal', async () => {
    const { svc, posting } = await setUp();
    const run = await svc.preview(TENANT, LE, '2026-08-01', { '181+': 20 }, [{ partNumber: 'P-1', ageBand: '181+', qty: 1, baseValue: 500 }]);
    const first = await svc.approve(TENANT, LE, run.id, 'controller-1', 'c1', '2026-08-01');
    expect(first.idempotent).toBe(false);
    expect(first.run.status).toBe('APPROVED');
    expect(first.run.journalEntryId).toBe('je-1');

    const second = await svc.approve(TENANT, LE, run.id, 'controller-1', 'c2', '2026-08-01');
    expect(second.idempotent).toBe(true);
    expect(posting.submitted.filter((e) => e.eventType === 'parts.obsolescence.provision-approved.v1').length).toBe(1);
  });

  it('rejects approval of a run that has not been previewed (or does not exist)', async () => {
    const { svc } = await setUp();
    await expect(svc.approve(TENANT, LE, 'no-such-run', 'controller-1', 'c1', '2026-08-01')).rejects.toThrow(/not found/);
  });

  it('rejects approval when the OBSOLESCENCE_PROVISION mapping is still ACCOUNT_MAPPING_VALUES_PENDING — no journal, no mutation', async () => {
    const { svc, posting } = await setUp([]); // no mapping resolved for either family
    const run = await svc.preview(TENANT, LE, '2026-08-01', { '181+': 20 }, [{ partNumber: 'P-1', ageBand: '181+', qty: 1, baseValue: 500 }]);
    await expect(svc.approve(TENANT, LE, run.id, 'controller-1', 'c1', '2026-08-01')).rejects.toMatchObject({ code: 'ACCOUNT_MAPPING_VALUES_PENDING' });
    expect(posting.submitted.length).toBe(0);
  });
});

describe('ObsolescenceService — scrap (S068 disposal, distinct permission + threshold + allowance guard)', () => {
  const baseInput = { tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-5', qty: 3, value: 150, reason: 'obsolete stock', actor: 'tech-1', correlationId: 'c1', businessDate: '2026-08-01' };

  it('posts a balanced-intent scrap event when permitted, under threshold, and within allowance', async () => {
    const { svc, posting } = await setUp();
    const result = await svc.scrap({ ...baseInput, hasScrapPermission: true, thresholdAmount: 1000, allowanceBalance: 500 });
    expect(result.disposal.status).toBe('POSTED');
    expect(result.disposal.journalEntryId).toBe('je-1');
    expect(posting.submitted.length).toBe(1);
  });

  it('refuses (REFUSED_PERMISSION) when the actor lacks the distinct scrap-execution permission — recorded, not silently dropped', async () => {
    const { svc, prisma, posting } = await setUp();
    await expect(svc.scrap({ ...baseInput, hasScrapPermission: false, thresholdAmount: 1000, allowanceBalance: 500 }))
      .rejects.toMatchObject({ code: 'REFUSED_PERMISSION' });
    expect(posting.submitted.length).toBe(0);
    const rows = await prisma.scrapDisposal.findMany({ where: { tenantId: TENANT } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('REFUSED_PERMISSION');
  });

  it('refuses (REFUSED_THRESHOLD) when scrap value exceeds the elevated-approval threshold', async () => {
    const { svc, posting } = await setUp();
    await expect(svc.scrap({ ...baseInput, value: 2000, hasScrapPermission: true, thresholdAmount: 1000, allowanceBalance: 5000 }))
      .rejects.toMatchObject({ code: 'REFUSED_THRESHOLD' });
    expect(posting.submitted.length).toBe(0);
  });

  it('refuses (REFUSED_ALLOWANCE_GUARD) when the scrap would drive the obsolescence allowance net-debit', async () => {
    const { svc, posting } = await setUp();
    await expect(svc.scrap({ ...baseInput, value: 150, hasScrapPermission: true, thresholdAmount: 1000, allowanceBalance: 100 }))
      .rejects.toMatchObject({ code: 'REFUSED_ALLOWANCE_GUARD' });
    expect(posting.submitted.length).toBe(0);
  });

  it('permission and threshold guards run BEFORE the allowance guard — permission refusal wins even if allowance would also fail', async () => {
    const { svc } = await setUp();
    await expect(svc.scrap({ ...baseInput, value: 150, hasScrapPermission: false, thresholdAmount: 1000, allowanceBalance: 0 }))
      .rejects.toMatchObject({ code: 'REFUSED_PERMISSION' });
  });

  it('rejects scrap when the SCRAP_DISPOSAL mapping is still pending — zero mutation to inventory/allowance intent', async () => {
    const { svc, posting } = await setUp(['OBSOLESCENCE_PROVISION']); // SCRAP_DISPOSAL deliberately unmapped
    await expect(svc.scrap({ ...baseInput, hasScrapPermission: true, thresholdAmount: 1000, allowanceBalance: 500 }))
      .rejects.toMatchObject({ code: 'ACCOUNT_MAPPING_VALUES_PENDING' });
    expect(posting.submitted.length).toBe(0);
  });
});
