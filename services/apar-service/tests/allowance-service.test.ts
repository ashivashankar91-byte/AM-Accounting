/**
 * CE-09 S050 (allowance model) — AllowanceService domain tests. Mocked-Prisma
 * unit tests, same style as write-off-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  AllowanceService,
  AllowancePreviewNotFoundError,
  AllowanceValidationError,
  AllowancePostAmountMismatchError,
} from '../src/application/allowance-service';

const TENANT_ID = 'tenant-allowance';
const PREVIEW_ID = 'preview-1';

const BASE_PREVIEW = {
  id: PREVIEW_ID, tenantId: TENANT_ID, asOfDate: new Date('2026-01-01'),
  totalReceivablesAnalyzed: '1000.00', computedAmount: '100.00', bandBreakdown: [],
  status: 'PREVIEWED', approvedAmount: null,
};

function makePrisma(overrides: any = {}) {
  const client: any = {
    arAllowanceBandConfig: {
      findMany: overrides.bandFindMany ?? vi.fn().mockResolvedValue([{ tenantId: TENANT_ID, bandDaysMin: 90, bandDaysMax: null, percent: '100.00' }]),
    },
    aREntry: {
      findMany: overrides.arEntryFindMany ?? vi.fn().mockResolvedValue([
        { id: 'ar-1', amount: '100.00', dueDate: new Date('2025-01-01'), status: 'OPEN' },
      ]),
    },
    arAllowancePreview: {
      findFirst: overrides.previewFindFirst ?? vi.fn().mockResolvedValue(BASE_PREVIEW),
      findMany: overrides.previewFindMany ?? vi.fn().mockResolvedValue([BASE_PREVIEW]),
      create: overrides.previewCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: PREVIEW_ID, ...data })),
      update: overrides.previewUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_PREVIEW, ...data })),
    },
    arAllowanceGlAccountConfig: {
      findFirst: overrides.glConfigFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    $queryRawUnsafe: overrides.queryRawUnsafe ?? vi.fn().mockImplementation(async () => [{
      id: PREVIEW_ID, tenant_id: TENANT_ID, computed_amount: BASE_PREVIEW.computedAmount,
      approved_amount: BASE_PREVIEW.approvedAmount, status: BASE_PREVIEW.status,
    }]),
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

describe('AllowanceService.computePreview', () => {
  it('computes a band breakdown and total from OPEN AR entries — never posts anything', async () => {
    const prisma = makePrisma();
    const svc = new AllowanceService(prisma, {} as any);
    const preview = await svc.computePreview(TENANT_ID, { asOfDate: '2026-01-01' }, 'accountant-1');
    expect(preview.status).toBe('PREVIEWED');
    expect(preview.computedAmount).toBe(100);
  });

  it('produces $0 computedAmount when no band config exists (SAFE_CONFIGURATION — never an invented percentage)', async () => {
    const prisma = makePrisma({ bandFindMany: vi.fn().mockResolvedValue([]) });
    const svc = new AllowanceService(prisma, {} as any);
    const preview = await svc.computePreview(TENANT_ID, { asOfDate: '2026-01-01' }, 'accountant-1');
    expect(preview.computedAmount).toBe(0);
  });

  it('rejects a missing asOfDate', async () => {
    const prisma = makePrisma();
    const svc = new AllowanceService(prisma, {} as any);
    await expect(svc.computePreview(TENANT_ID, { asOfDate: '' }, 'accountant-1')).rejects.toBeInstanceOf(AllowanceValidationError);
  });

  it('rejects an invalid asOfDate', async () => {
    const prisma = makePrisma();
    const svc = new AllowanceService(prisma, {} as any);
    await expect(svc.computePreview(TENANT_ID, { asOfDate: 'not-a-date' }, 'accountant-1')).rejects.toBeInstanceOf(AllowanceValidationError);
  });
});

describe('AllowanceService.approvePreview', () => {
  it('stores the approved amount equal to the computed amount', async () => {
    const prisma = makePrisma();
    const svc = new AllowanceService(prisma, {} as any);
    const approved = await svc.approvePreview(TENANT_ID, PREVIEW_ID, {}, 'accountant-lead-1');
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedAmount).toBe(100);
  });

  it('throws AllowancePreviewNotFoundError for a missing preview', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([]) });
    const svc = new AllowanceService(prisma, {} as any);
    await expect(svc.approvePreview(TENANT_ID, 'missing', {}, 'accountant-lead-1')).rejects.toBeInstanceOf(AllowancePreviewNotFoundError);
  });

  it('refuses to approve a preview that is not in PREVIEWED status', async () => {
    const prisma = makePrisma({
      queryRawUnsafe: vi.fn().mockResolvedValue([{ id: PREVIEW_ID, tenant_id: TENANT_ID, computed_amount: '100.00', status: 'APPROVED' }]),
    });
    const svc = new AllowanceService(prisma, {} as any);
    await expect(svc.approvePreview(TENANT_ID, PREVIEW_ID, {}, 'accountant-lead-1')).rejects.toBeInstanceOf(AllowanceValidationError);
  });
});

describe('AllowanceService.postPreview', () => {
  function approvedPrisma(overrides: any = {}) {
    return makePrisma({
      queryRawUnsafe: vi.fn().mockResolvedValue([{ id: PREVIEW_ID, tenant_id: TENANT_ID, approved_amount: '100.00', status: 'APPROVED' }]),
      previewFindFirst: vi.fn().mockResolvedValue({ ...BASE_PREVIEW, status: 'POSTED', approvedAmount: '100.00' }),
      ...overrides,
    });
  }

  it('posts when the postedAmount exactly matches the approved amount', async () => {
    const prisma = approvedPrisma();
    const svc = new AllowanceService(prisma, {} as any);
    const posted = await svc.postPreview(TENANT_ID, PREVIEW_ID, { postedAmount: 100 }, 'accountant-1');
    expect(posted.status).toBe('POSTED');
  });

  it('rejects a postedAmount that does not equal the approved amount (D-CE09-02: no silent re-computation)', async () => {
    const prisma = approvedPrisma();
    const svc = new AllowanceService(prisma, {} as any);
    await expect(svc.postPreview(TENANT_ID, PREVIEW_ID, { postedAmount: 999 }, 'accountant-1')).rejects.toBeInstanceOf(AllowancePostAmountMismatchError);
  });

  it('refuses to post a preview that is not APPROVED', async () => {
    const prisma = makePrisma({
      queryRawUnsafe: vi.fn().mockResolvedValue([{ id: PREVIEW_ID, tenant_id: TENANT_ID, approved_amount: null, status: 'PREVIEWED' }]),
    });
    const svc = new AllowanceService(prisma, {} as any);
    await expect(svc.postPreview(TENANT_ID, PREVIEW_ID, { postedAmount: 100 }, 'accountant-1')).rejects.toBeInstanceOf(AllowanceValidationError);
  });

  it('refuses to double-post an already-POSTED preview (idempotent)', async () => {
    const prisma = makePrisma({
      queryRawUnsafe: vi.fn().mockResolvedValue([{ id: PREVIEW_ID, tenant_id: TENANT_ID, approved_amount: '100.00', status: 'POSTED' }]),
    });
    const svc = new AllowanceService(prisma, {} as any);
    await expect(svc.postPreview(TENANT_ID, PREVIEW_ID, { postedAmount: 100 }, 'accountant-1')).rejects.toBeInstanceOf(AllowanceValidationError);
  });

  it('throws AllowancePreviewNotFoundError for an unknown id', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([]) });
    const svc = new AllowanceService(prisma, {} as any);
    await expect(svc.postPreview(TENANT_ID, 'missing', { postedAmount: 100 }, 'accountant-1')).rejects.toBeInstanceOf(AllowancePreviewNotFoundError);
  });
});

describe('AllowanceService.getById / list', () => {
  it('throws AllowancePreviewNotFoundError when missing', async () => {
    const prisma = makePrisma({ previewFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new AllowanceService(prisma, {} as any);
    await expect(svc.getById(TENANT_ID, 'missing')).rejects.toBeInstanceOf(AllowancePreviewNotFoundError);
  });

  it('lists previews for a tenant', async () => {
    const prisma = makePrisma();
    const svc = new AllowanceService(prisma, {} as any);
    const rows = await svc.list(TENANT_ID);
    expect(rows).toHaveLength(1);
  });
});
