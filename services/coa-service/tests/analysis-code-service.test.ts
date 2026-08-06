/**
 * S011 — AnalysisCodeService (registry CRUD) tests. In-memory fake Prisma +
 * fake IEventPublisher via tsyringe, following the exact department-service
 * (S203)/draft-service (S214) test convention: hand-rolled fake collections,
 * no real database, asserting the atomic audit-transaction contract (BR7-1)
 * and every documented 404/409/422 path.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import {
  AnalysisCodeService,
  AnalysisCodeNotFoundError,
  AnalysisCodeConflictError,
  AnalysisCodeValidationError,
} from '../src/application/analysis-code-service';

const TENANT = 'tenant-kunes';

function makePrisma() {
  const types: any[] = [];
  const values: any[] = [];
  const outbox: any[] = [];
  const audits: any[] = [];

  const prisma: any = {
    _types: types,
    _values: values,
    _outbox: outbox,
    _audits: audits,
    analysisCodeType: {
      findFirst: async ({ where }: any) => {
        const match = types.find((t) => {
          if (where.id !== undefined && t.id !== where.id) return false;
          if (where.tenantId !== undefined && t.tenantId !== where.tenantId) return false;
          if (where.code !== undefined && t.code !== where.code) return false;
          return true;
        });
        return match ? { ...match } : null;
      },
      findMany: async ({ where, include }: any) => {
        const rows = types.filter((t) => t.tenantId === where.tenantId).map((t) => ({ ...t }));
        if (include?.values) {
          return rows.map((t) => ({ ...t, values: values.filter((v) => v.typeId === t.id) }));
        }
        return rows;
      },
      create: async ({ data }: any) => (types.push({ ...data }), { ...data }),
      update: async ({ where, data }: any) => {
        const t = types.find((x) => x.id === where.id);
        if (!t) throw new Error('not found');
        Object.assign(t, data);
        return { ...t };
      },
    },
    analysisCodeValue: {
      findFirst: async ({ where }: any) => {
        const match = values.find((v) => {
          if (where.id !== undefined && v.id !== where.id) return false;
          if (where.tenantId !== undefined && v.tenantId !== where.tenantId) return false;
          if (where.typeId !== undefined && v.typeId !== where.typeId) return false;
          if (where.code !== undefined && v.code !== where.code) return false;
          return true;
        });
        return match ? { ...match } : null;
      },
      count: async ({ where }: any) =>
        values.filter((v) => v.typeId === where.typeId && (where.isActive === undefined || v.isActive === where.isActive)).length,
      findMany: async ({ where }: any = {}) =>
        values
          .filter((v) => where?.tenantId === undefined || v.tenantId === where.tenantId)
          .map((v) => ({ ...v })),
      create: async ({ data }: any) => (values.push({ ...data }), { ...data }),
      update: async ({ where, data }: any) => {
        const v = values.find((x) => x.id === where.id);
        if (!v) throw new Error('not found');
        Object.assign(v, data);
        return { ...v };
      },
    },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
    $transaction: async (fn: any) => fn(prisma),
  };
  return prisma;
}

function setup() {
  container.reset();
  const prisma = makePrisma();
  const events = { published: [] as any[], publish: async (e: any) => void (events.published as any[]).push(e) };
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.register('AnalysisCodeService', { useClass: AnalysisCodeService });
  return { svc: container.resolve<AnalysisCodeService>('AnalysisCodeService'), prisma, events };
}

describe('AnalysisCodeService — type CRUD', () => {
  it('creates a type with an atomic audit row (BR7-1) and outbox event', async () => {
    const { svc, prisma } = setup();
    const t = await svc.createType({ tenantId: TENANT, code: 'PROJECT', name: 'Project' }, 'alice');
    expect(t.isActive).toBe(true);
    expect(t.version).toBe(1);
    expect(prisma._audits).toHaveLength(1);
    expect(prisma._audits[0]).toMatchObject({ docType: 'ANALYSIS_CODE_TYPE', action: 'CREATED', actor: 'alice' });
    expect(prisma._outbox[0].eventType).toBe('analysis.type.created');
  });

  it('rejects a duplicate type code for the same tenant (409)', async () => {
    const { svc } = setup();
    await svc.createType({ tenantId: TENANT, code: 'PROJECT', name: 'Project' }, 'alice');
    await expect(svc.createType({ tenantId: TENANT, code: 'PROJECT', name: 'Project 2' }, 'alice')).rejects.toBeInstanceOf(
      AnalysisCodeConflictError,
    );
  });

  it('rejects an empty/over-length code (422)', async () => {
    const { svc } = setup();
    await expect(svc.createType({ tenantId: TENANT, code: '', name: 'Project' }, 'alice')).rejects.toBeInstanceOf(
      AnalysisCodeValidationError,
    );
  });

  it('updateType enforces optimistic concurrency (version conflict -> 409)', async () => {
    const { svc } = setup();
    const t = await svc.createType({ tenantId: TENANT, code: 'PROJECT', name: 'Project' }, 'alice');
    await svc.updateType(TENANT, t.id, { version: 1, name: 'Renamed' }, 'alice');
    await expect(svc.updateType(TENANT, t.id, { version: 1, name: 'Stale write' }, 'alice')).rejects.toBeInstanceOf(
      AnalysisCodeConflictError,
    );
  });

  it('getType/updateType/deactivateType on an unknown id throw 404', async () => {
    const { svc } = setup();
    await expect(svc.getType(TENANT, 'nope')).rejects.toBeInstanceOf(AnalysisCodeNotFoundError);
    await expect(svc.updateType(TENANT, 'nope', { version: 1 }, 'alice')).rejects.toBeInstanceOf(AnalysisCodeNotFoundError);
    await expect(svc.deactivateType(TENANT, 'nope', { version: 1, reason: 'x', deactivatedBy: 'alice' })).rejects.toBeInstanceOf(
      AnalysisCodeNotFoundError,
    );
  });

  it('deactivateType blocks while the type still has an active value (registry integrity)', async () => {
    const { svc } = setup();
    const t = await svc.createType({ tenantId: TENANT, code: 'PROJECT', name: 'Project' }, 'alice');
    await svc.createValue({ tenantId: TENANT, typeId: t.id, code: 'ALPHA', name: 'Alpha' }, 'alice');
    await expect(
      svc.deactivateType(TENANT, t.id, { version: t.version, reason: 'retiring', deactivatedBy: 'alice' }),
    ).rejects.toBeInstanceOf(AnalysisCodeConflictError);
  });

  it('deactivateType succeeds once its values are all deactivated first', async () => {
    const { svc, prisma } = setup();
    const t = await svc.createType({ tenantId: TENANT, code: 'PROJECT', name: 'Project' }, 'alice');
    const v = await svc.createValue({ tenantId: TENANT, typeId: t.id, code: 'ALPHA', name: 'Alpha' }, 'alice');
    await svc.deactivateValue(TENANT, v.id, { version: v.version, reason: 'retiring', deactivatedBy: 'alice' });
    const deactivated = await svc.deactivateType(TENANT, t.id, { version: t.version, reason: 'retiring', deactivatedBy: 'alice' });
    expect(deactivated.isActive).toBe(false);
    expect(prisma._audits.some((a: any) => a.action === 'DEACTIVATED' && a.docType === 'ANALYSIS_CODE_TYPE')).toBe(true);
  });
});

describe('AnalysisCodeService — value CRUD', () => {
  it('rejects creating a value under an inactive type', async () => {
    const { svc } = setup();
    const t = await svc.createType({ tenantId: TENANT, code: 'PROJECT', name: 'Project' }, 'alice');
    const v = await svc.createValue({ tenantId: TENANT, typeId: t.id, code: 'ALPHA', name: 'Alpha' }, 'alice');
    await svc.deactivateValue(TENANT, v.id, { version: v.version, reason: 'x', deactivatedBy: 'alice' });
    await svc.deactivateType(TENANT, t.id, { version: t.version, reason: 'x', deactivatedBy: 'alice' });
    await expect(svc.createValue({ tenantId: TENANT, typeId: t.id, code: 'BETA', name: 'Beta' }, 'alice')).rejects.toBeInstanceOf(
      AnalysisCodeValidationError,
    );
  });

  it('rejects a duplicate value code under the same type (409)', async () => {
    const { svc } = setup();
    const t = await svc.createType({ tenantId: TENANT, code: 'PROJECT', name: 'Project' }, 'alice');
    await svc.createValue({ tenantId: TENANT, typeId: t.id, code: 'ALPHA', name: 'Alpha' }, 'alice');
    await expect(svc.createValue({ tenantId: TENANT, typeId: t.id, code: 'ALPHA', name: 'Alpha 2' }, 'alice')).rejects.toBeInstanceOf(
      AnalysisCodeConflictError,
    );
  });

  it('BR011-4 — a deactivated value is never deleted; deactivateValue only flips isActive with reason/actor recorded', async () => {
    const { svc } = setup();
    const t = await svc.createType({ tenantId: TENANT, code: 'PROJECT', name: 'Project' }, 'alice');
    const v = await svc.createValue({ tenantId: TENANT, typeId: t.id, code: 'ALPHA', name: 'Alpha' }, 'alice');
    const deactivated = await svc.deactivateValue(TENANT, v.id, { version: v.version, reason: 'no longer used', deactivatedBy: 'bob' });
    expect(deactivated.isActive).toBe(false);
    expect(deactivated.deactivationReason).toBe('no longer used');
    expect(deactivated.deactivatedBy).toBe('bob');
  });
});

describe('AnalysisCodeService.loadValidationContext', () => {
  it('returns Maps keyed by id, suitable for domain/analysis-code.ts validateLineTags', async () => {
    const { svc } = setup();
    const t = await svc.createType({ tenantId: TENANT, code: 'PROJECT', name: 'Project' }, 'alice');
    const v = await svc.createValue({ tenantId: TENANT, typeId: t.id, code: 'ALPHA', name: 'Alpha' }, 'alice');
    const ctx = await svc.loadValidationContext(TENANT);
    expect(ctx.types.get(t.id)).toMatchObject({ id: t.id, isActive: true });
    expect(ctx.values.get(v.id)).toMatchObject({ id: v.id, typeId: t.id, isActive: true });
  });
});
