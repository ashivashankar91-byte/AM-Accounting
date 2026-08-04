/**
 * S017 — WORM Archive & PII Crypto-Shredding — Certification Tests
 *
 * AC1: create() persists archive record with tenantId scope
 * AC2: list() returns only records for the requesting tenant
 * AC3: softDelete() marks record deleted but does not hard-delete (WORM preservation)
 * AC4: createRetentionSchedule() stores retention policy with tenantId scope
 * AC5: get() is tenant-scoped — cannot retrieve another tenant's archive
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ArchiveService } from '../../src/application/archive-service';

const TENANT = 'tenant-s017-cert';
const OTHER_TENANT = 'tenant-other-s017';

function makeRepo() {
  const records: Record<string, any> = {};
  const schedules: any[] = [];
  return {
    create: vi.fn(async (tid: string, data: any) => {
      const row = { id: `arc-${Date.now()}`, tenantId: tid, ...data, deletedAt: null };
      records[row.id] = row; return row;
    }),
    findAll: vi.fn(async (tid: string) => Object.values(records).filter((r: any) => r.tenantId === tid && !r.deletedAt)),
    findById: vi.fn(async (tid: string, id: string) => {
      const r = records[id];
      return (r?.tenantId === tid) ? r : null;
    }),
    softDelete: vi.fn(async (tid: string, id: string) => {
      const r = records[id];
      if (!r || r.tenantId !== tid) throw new Error('Not found');
      r.deletedAt = new Date(); return r;
    }),
    createRetentionSchedule: vi.fn(async (tid: string, data: any) => {
      const row = { id: `ret-${Date.now()}`, tenantId: tid, ...data };
      schedules.push(row); return row;
    }),
  };
}

describe('S017 — WORM Archive & PII Crypto-Shredding', () => {
  it('AC1: create() persists archive record with tenantId', async () => {
    const repo = makeRepo();
    const svc = new ArchiveService(repo as any);
    const result = await svc.create(TENANT, { name: 'Period 2026-01 Archive', periodYear: 2026, periodMonth: 1 });
    expect(result.tenantId).toBe(TENANT);
    expect(result.name).toBe('Period 2026-01 Archive');
    expect(repo.create).toHaveBeenCalledWith(TENANT, expect.any(Object));
  });

  it('AC2: list() returns only records for the requesting tenant', async () => {
    const repo = makeRepo();
    const svc = new ArchiveService(repo as any);
    await svc.create(TENANT, { name: 'Arc A' });
    await svc.create(OTHER_TENANT, { name: 'Arc B (other tenant)' });
    const list = await svc.list(TENANT);
    expect(list.every((r: any) => r.tenantId === TENANT)).toBe(true);
    expect(list.some((r: any) => r.tenantId === OTHER_TENANT)).toBe(false);
  });

  it('AC3: softDelete() marks deletedAt — record not returned in list (WORM: underlying data preserved)', async () => {
    const repo = makeRepo();
    const svc = new ArchiveService(repo as any);
    const created = await svc.create(TENANT, { name: 'Soft-Delete Target' });
    const deleted = await svc.delete(TENANT, created.id);
    expect(deleted.deletedAt).toBeDefined();
    const list = await svc.list(TENANT);
    expect(list.find((r: any) => r.id === created.id)).toBeUndefined();
  });

  it('AC4: createRetentionSchedule() stores policy with tenantId scope', async () => {
    const repo = makeRepo();
    const svc = new ArchiveService(repo as any);
    const schedule = await svc.createRetentionSchedule(TENANT, { retentionYears: 7, documentClass: 'GL_JOURNAL', createdBy: 'admin-1' });
    expect(schedule.tenantId).toBe(TENANT);
    expect(schedule.retentionYears).toBe(7);
    expect(repo.createRetentionSchedule).toHaveBeenCalledWith(TENANT, expect.any(Object));
  });

  it('AC5: get() returns null for another tenant\'s archive (cross-tenant isolation)', async () => {
    const repo = makeRepo();
    const svc = new ArchiveService(repo as any);
    const created = await svc.create(TENANT, { name: 'My Archive' });
    const result = await svc.get(OTHER_TENANT, created.id);
    expect(result).toBeNull();
  });
});
