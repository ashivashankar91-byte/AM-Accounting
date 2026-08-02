/**
 * CE-09 S050 (direct write-off) — WriteOffService domain tests. Mocked-Prisma
 * unit tests, same style as wholesale-vehicle-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  WriteOffService,
  ArEntryNotFoundForWriteOffError,
  WriteOffValidationError,
  WriteOffRefusedOverThresholdError,
  WriteOffNotFoundError,
} from '../src/application/write-off-service';

const TENANT_ID = 'tenant-writeoff';
const AR_ENTRY_ID = 'ar-entry-1';
const WRITE_OFF_ID = 'write-off-1';

const BASE_AR_ENTRY_ROW = { id: AR_ENTRY_ID, tenant_id: TENANT_ID, amount: '500.00', status: 'OPEN' };
const BASE_WRITE_OFF_ROW = { id: WRITE_OFF_ID, tenant_id: TENANT_ID, ar_entry_id: AR_ENTRY_ID, amount: '500.00', status: 'POSTED' };
const BASE_WRITE_OFF = { id: WRITE_OFF_ID, tenantId: TENANT_ID, arEntryId: AR_ENTRY_ID, amount: '500.00', status: 'POSTED', thresholdOverride: false };

function makePrisma(overrides: any = {}) {
  // CE-09 cert fix: directWriteOff() now always refetches arDirectWriteOff
  // after posting (see write-off-service.ts) instead of only doing so on a
  // successful GL post, so the mocked findFirst must reflect whatever
  // create()/update() actually produced (e.g. thresholdOverride) rather
  // than always returning the static BASE_WRITE_OFF fixture.
  let lastWriteOff: any = BASE_WRITE_OFF;
  const client: any = {
    arDirectWriteOff: {
      findFirst: overrides.writeOffFindFirst ?? vi.fn().mockImplementation(() => Promise.resolve(lastWriteOff)),
      findMany: overrides.writeOffFindMany ?? vi.fn().mockResolvedValue([BASE_WRITE_OFF]),
      create: overrides.writeOffCreate ?? vi.fn().mockImplementation(({ data }: any) => {
        lastWriteOff = { id: WRITE_OFF_ID, ...data };
        return Promise.resolve(lastWriteOff);
      }),
      update: overrides.writeOffUpdate ?? vi.fn().mockImplementation(({ data }: any) => {
        lastWriteOff = { ...lastWriteOff, ...data };
        return Promise.resolve(lastWriteOff);
      }),
    },
    aREntry: {
      update: overrides.arEntryUpdate ?? vi.fn().mockResolvedValue({}),
    },
    arWriteOffThresholdConfig: {
      findFirst: overrides.thresholdFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    arWriteOffGlAccountConfig: {
      findFirst: overrides.glConfigFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    // Row-lock re-read: AR entry lookup (directWriteOff) or write-off lookup
    // (reverseWriteOff) — distinguished by which table the SQL targets.
    $queryRawUnsafe: overrides.queryRawUnsafe ?? vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('ar_entries')) return [BASE_AR_ENTRY_ROW];
      if (sql.includes('ar_direct_write_offs')) return [BASE_WRITE_OFF_ROW];
      return [];
    }),
    // CE-09 cert fix: setTenantContextOnConnection() now runs first inside
    // every interactive $transaction callback in write-off-service.ts (RLS
    // hardening), so the mock tx must stub this call.
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

describe('WriteOffService.directWriteOff', () => {
  it('posts a write-off equal to the AR entry balance and closes the item', async () => {
    const prisma = makePrisma();
    const svc = new WriteOffService(prisma, {} as any);
    const writeOff = await svc.directWriteOff(TENANT_ID, { arEntryId: AR_ENTRY_ID, amount: 500, reason: 'Uncollectible' }, 'accountant-1');
    expect(writeOff.status).toBe('POSTED');
    expect(prisma.aREntry.update).toHaveBeenCalledWith({ where: { id: AR_ENTRY_ID }, data: { status: 'VOIDED' } });
  });

  it('rejects a missing reason', async () => {
    const prisma = makePrisma();
    const svc = new WriteOffService(prisma, {} as any);
    await expect(svc.directWriteOff(TENANT_ID, { arEntryId: AR_ENTRY_ID, amount: 500, reason: '' }, 'accountant-1')).rejects.toBeInstanceOf(WriteOffValidationError);
  });

  it('rejects a non-positive amount', async () => {
    const prisma = makePrisma();
    const svc = new WriteOffService(prisma, {} as any);
    await expect(svc.directWriteOff(TENANT_ID, { arEntryId: AR_ENTRY_ID, amount: 0, reason: 'x' }, 'accountant-1')).rejects.toBeInstanceOf(WriteOffValidationError);
  });

  it('throws ArEntryNotFoundForWriteOffError when the AR entry does not exist', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([]) });
    const svc = new WriteOffService(prisma, {} as any);
    await expect(svc.directWriteOff(TENANT_ID, { arEntryId: 'missing', amount: 500, reason: 'x' }, 'accountant-1')).rejects.toBeInstanceOf(ArEntryNotFoundForWriteOffError);
  });

  it('rejects a write-off against an AR entry that is not OPEN', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([{ ...BASE_AR_ENTRY_ROW, status: 'VOIDED' }]) });
    const svc = new WriteOffService(prisma, {} as any);
    await expect(svc.directWriteOff(TENANT_ID, { arEntryId: AR_ENTRY_ID, amount: 500, reason: 'x' }, 'accountant-1')).rejects.toBeInstanceOf(WriteOffValidationError);
  });

  it('requires the write-off amount to tie out exactly to the AR entry balance', async () => {
    const prisma = makePrisma();
    const svc = new WriteOffService(prisma, {} as any);
    await expect(svc.directWriteOff(TENANT_ID, { arEntryId: AR_ENTRY_ID, amount: 400, reason: 'x' }, 'accountant-1')).rejects.toBeInstanceOf(WriteOffValidationError);
  });

  it('refuses a write-off over the configured threshold without the override flag (AC: WRITE_OFF_REFUSED_OVER_THRESHOLD)', async () => {
    const prisma = makePrisma({
      thresholdFindFirst: vi.fn().mockResolvedValue({ tenantId: TENANT_ID, thresholdAmount: '100.00' }),
    });
    const svc = new WriteOffService(prisma, {} as any);
    await expect(svc.directWriteOff(TENANT_ID, { arEntryId: AR_ENTRY_ID, amount: 500, reason: 'x' }, 'accountant-1')).rejects.toBeInstanceOf(WriteOffRefusedOverThresholdError);
  });

  it('allows a write-off over the threshold when useOverride is set (higher-authority override, audited via thresholdOverride)', async () => {
    const prisma = makePrisma({
      thresholdFindFirst: vi.fn().mockResolvedValue({ tenantId: TENANT_ID, thresholdAmount: '100.00' }),
    });
    const svc = new WriteOffService(prisma, {} as any);
    const writeOff = await svc.directWriteOff(TENANT_ID, { arEntryId: AR_ENTRY_ID, amount: 500, reason: 'x', useOverride: true }, 'controller-1');
    expect(writeOff.thresholdOverride).toBe(true);
  });
});

describe('WriteOffService.reverseWriteOff', () => {
  it('restores the AR entry to OPEN and marks the write-off REVERSED (S218-style symmetry)', async () => {
    const prisma = makePrisma();
    const svc = new WriteOffService(prisma, {} as any);
    const reversed = await svc.reverseWriteOff(TENANT_ID, WRITE_OFF_ID, { reason: 'Recovered from customer' }, 'accountant-1');
    expect(reversed.status).toBe('REVERSED');
    expect(prisma.aREntry.update).toHaveBeenCalledWith({ where: { id: AR_ENTRY_ID }, data: { status: 'OPEN' } });
  });

  it('rejects a missing reversal reason', async () => {
    const prisma = makePrisma();
    const svc = new WriteOffService(prisma, {} as any);
    await expect(svc.reverseWriteOff(TENANT_ID, WRITE_OFF_ID, { reason: '' }, 'accountant-1')).rejects.toBeInstanceOf(WriteOffValidationError);
  });

  it('throws WriteOffNotFoundError for an unknown id', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([]) });
    const svc = new WriteOffService(prisma, {} as any);
    await expect(svc.reverseWriteOff(TENANT_ID, 'missing', { reason: 'x' }, 'accountant-1')).rejects.toBeInstanceOf(WriteOffNotFoundError);
  });

  it('refuses to reverse an already-reversed write-off (never double-reverse)', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([{ ...BASE_WRITE_OFF_ROW, status: 'REVERSED' }]) });
    const svc = new WriteOffService(prisma, {} as any);
    await expect(svc.reverseWriteOff(TENANT_ID, WRITE_OFF_ID, { reason: 'x' }, 'accountant-1')).rejects.toBeInstanceOf(WriteOffValidationError);
  });
});

describe('WriteOffService.register', () => {
  it('sums posted write-offs into a totalWrittenOff figure', async () => {
    const prisma = makePrisma({
      writeOffFindMany: vi.fn().mockResolvedValue([{ ...BASE_WRITE_OFF, amount: '500.00' }, { ...BASE_WRITE_OFF, amount: '250.50' }]),
    });
    const svc = new WriteOffService(prisma, {} as any);
    const register = await svc.register(TENANT_ID, {});
    expect(register.writeOffCount).toBe(2);
    expect(register.totalWrittenOff).toBe(750.5);
  });
});

describe('WriteOffService.getById / list', () => {
  it('throws WriteOffNotFoundError when the write-off is missing', async () => {
    const prisma = makePrisma({ writeOffFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new WriteOffService(prisma, {} as any);
    await expect(svc.getById(TENANT_ID, 'missing')).rejects.toBeInstanceOf(WriteOffNotFoundError);
  });

  it('lists write-offs for a tenant', async () => {
    const prisma = makePrisma();
    const svc = new WriteOffService(prisma, {} as any);
    const rows = await svc.list(TENANT_ID);
    expect(rows).toHaveLength(1);
  });
});
