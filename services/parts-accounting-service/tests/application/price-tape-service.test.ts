import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { PriceTapeService } from '../../src/application/price-tape-service';
import { PartsAccountMappingService } from '../../src/application/account-mapping-service';
import { FakePostingEventProducer } from '../../src/infrastructure/posting-client';

const TENANT = 'tenant-1'; const LE = 'le-1';

async function setUp() {
  const prisma = new FakePrismaClient();
  const mappings = new PartsAccountMappingService(prisma as any);
  await mappings.setAccountNumber(TENANT, LE, 'PRICE_TAPE_REVALUATION', 'INVENTORY', '1310', 'controller-1');
  await mappings.setAccountNumber(TENANT, LE, 'PRICE_TAPE_REVALUATION', 'PRICE_VARIANCE', '5310', 'controller-1');
  const posting = new FakePostingEventProducer((env) => ({ executionId: 'x', eventId: env.eventId, status: 'POSTED', idempotent: false, journalEntryId: 'je-1', journalNumber: 'JN-1' }));
  const svc = new PriceTapeService(prisma as any, posting, mappings);
  return { prisma, mappings, posting, svc };
}

describe('PriceTapeService (S067) — preview-approve pattern', () => {
  it('load never auto-posts — zero GL effect until explicit approval', async () => {
    const { svc, posting } = await setUp();
    await svc.load(TENANT, LE, 'batch-1', [{ partNumber: 'P-1', oldValue: 10, newValue: 12, qtyOnHand: 5, effectiveFrom: '2026-08-01' }]);
    expect(posting.submitted.length).toBe(0);
  });

  it('preview total equals what gets posted on approval exactly', async () => {
    const { svc, posting } = await setUp();
    await svc.load(TENANT, LE, 'batch-2', [{ partNumber: 'P-1', oldValue: 10, newValue: 12, qtyOnHand: 5, effectiveFrom: '2026-08-01' }]);
    const previewed = await svc.preview(TENANT, LE, 'batch-2');
    expect(Number(previewed.previewTotal)).toBe(10); // (12-10)*5
    expect(posting.submitted.length).toBe(0); // preview still does not post

    const { load } = await svc.approve(TENANT, LE, 'batch-2', 'controller-1', 'corr-1', '2026-08-01');
    expect(Number(load.approvedTotal)).toBe(Number(previewed.previewTotal));
    expect(posting.submitted.length).toBe(1); // only approval posts
  });

  it('reload of the same loadBatchId is idempotent — no duplicate lines or journal', async () => {
    const { svc } = await setUp();
    const lines = [{ partNumber: 'P-1', oldValue: 10, newValue: 12, qtyOnHand: 5, effectiveFrom: '2026-08-01' }];
    const first = await svc.load(TENANT, LE, 'batch-3', lines);
    const second = await svc.load(TENANT, LE, 'batch-3', lines);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
  });

  it('re-approving an already-approved tape is idempotent — no second journal', async () => {
    const { svc, posting } = await setUp();
    await svc.load(TENANT, LE, 'batch-4', [{ partNumber: 'P-1', oldValue: 10, newValue: 11, qtyOnHand: 1, effectiveFrom: '2026-08-01' }]);
    await svc.preview(TENANT, LE, 'batch-4');
    await svc.approve(TENANT, LE, 'batch-4', 'controller-1', 'corr-1', '2026-08-01');
    const second = await svc.approve(TENANT, LE, 'batch-4', 'controller-1', 'corr-1', '2026-08-01');
    expect(second.idempotent).toBe(true);
    expect(posting.submitted.length).toBe(1);
  });
});
