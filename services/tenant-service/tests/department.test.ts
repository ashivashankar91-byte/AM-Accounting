/**
 * S203 — Department Service Unit Tests
 *
 * Tests the DepartmentService in isolation using a Prisma mock (no database).
 * Covers: list, getById, seedCanonical, create, update, deactivate.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import {
  DepartmentService,
  DepartmentNotFoundError,
  DepartmentConflictError,
  DepartmentValidationError,
  CANONICAL_DEPARTMENTS,
  classifyCode,
} from '../src/application/department-service';

// ── Test data ─────────────────────────────────────────────────────────────────

const TENANT   = 'tenant-test';
const ENTITY   = 'entity-001';
const DEPT_ID  = 'dept-001';

const ACTIVE_DEPT = {
  id:                 DEPT_ID,
  tenantId:           TENANT,
  entityId:           ENTITY,
  code:               '21',
  name:               'EV Service',
  canonical:          false,
  status:             'ACTIVE',
  version:            1,
  deactivatedAt:      null,
  deactivatedBy:      null,
  deactivationReason: null,
  createdAt:          new Date(),
  updatedAt:          new Date(),
};

const INACTIVE_DEPT = { ...ACTIVE_DEPT, status: 'INACTIVE', version: 2, deactivatedBy: 'admin', deactivationReason: 'Closed' };

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    department: {
      findMany:  async () => [ACTIVE_DEPT],
      count:     async () => 1,
      findFirst: async ({ where }: any) => {
        if (where.id && where.id !== DEPT_ID) return null;
        if (where.code && where.code !== '21') return null;
        if (where.name && where.name !== 'EV Service') return null;
        return ACTIVE_DEPT;
      },
      create:    async ({ data }: any) => ({ ...ACTIVE_DEPT, ...data }),
      update:    async ({ data }: any) => ({ ...ACTIVE_DEPT, ...data }),
      ...overrides.department,
    },
    legalEntity: {
      findFirst: async () => ({ id: ENTITY, tenantId: TENANT }),
      ...overrides.legalEntity,
    },
    tenantOutboxEvent: {
      create: async () => ({}),
      ...overrides.tenantOutboxEvent,
    },
  };
}

function noopPublisher() { return { publish: async () => {} }; }

function makeSvc(overrides: Record<string, any> = {}) {
  container.clearInstances();
  container.registerInstance('PrismaClient', makePrisma(overrides));
  container.registerInstance('IEventPublisher', noopPublisher());
  return container.resolve(DepartmentService);
}

// ── classifyCode ──────────────────────────────────────────────────────────────

describe('classifyCode', () => {
  it('returns CANONICAL_CODE_RESERVED for 01-12', () => {
    for (let i = 1; i <= 12; i++) {
      const code = String(i).padStart(2, '0');
      expect(classifyCode(code)).toBe('CANONICAL_CODE_RESERVED');
    }
  });

  it('returns CUSTOM for 20-89', () => {
    expect(classifyCode('20')).toBe('CUSTOM');
    expect(classifyCode('55')).toBe('CUSTOM');
    expect(classifyCode('89')).toBe('CUSTOM');
  });

  it('returns INVALID_CODE_RANGE for 00', () => {
    expect(classifyCode('00')).toBe('INVALID_CODE_RANGE');
  });

  it('returns INVALID_CODE_RANGE for gap 13-19', () => {
    expect(classifyCode('13')).toBe('INVALID_CODE_RANGE');
    expect(classifyCode('19')).toBe('INVALID_CODE_RANGE');
  });

  it('returns INVALID_CODE_RANGE for 90-99', () => {
    expect(classifyCode('90')).toBe('INVALID_CODE_RANGE');
    expect(classifyCode('99')).toBe('INVALID_CODE_RANGE');
  });

  it('returns INVALID_CODE_RANGE for non-numeric', () => {
    expect(classifyCode('AA')).toBe('INVALID_CODE_RANGE');
    expect(classifyCode('1A')).toBe('INVALID_CODE_RANGE');
  });

  it('returns INVALID_CODE_RANGE for wrong length', () => {
    expect(classifyCode('1')).toBe('INVALID_CODE_RANGE');
    expect(classifyCode('100')).toBe('INVALID_CODE_RANGE');
    expect(classifyCode('')).toBe('INVALID_CODE_RANGE');
  });
});

// ── CANONICAL_DEPARTMENTS ────────────────────────────────────────────────────

describe('CANONICAL_DEPARTMENTS', () => {
  it('has exactly 12 entries', () => {
    expect(CANONICAL_DEPARTMENTS).toHaveLength(12);
  });

  it('covers codes 01-12 with no gaps', () => {
    const codes = CANONICAL_DEPARTMENTS.map(d => d.code);
    for (let i = 1; i <= 12; i++) {
      expect(codes).toContain(String(i).padStart(2, '0'));
    }
  });

  it('each entry has a non-empty name', () => {
    for (const d of CANONICAL_DEPARTMENTS) {
      expect(d.name.trim().length).toBeGreaterThan(0);
    }
  });
});

// ── DepartmentService.list ───────────────────────────────────────────────────

describe('DepartmentService.list', () => {
  it('returns paginated departments for a tenant', async () => {
    const svc    = makeSvc();
    const result = await svc.list({ tenantId: TENANT, entityId: ENTITY });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('passes status filter through to Prisma', async () => {
    let capturedWhere: any;
    const svc = makeSvc({
      department: {
        findMany:  async ({ where }: any) => { capturedWhere = where; return []; },
        count:     async () => 0,
      },
    });
    await svc.list({ tenantId: TENANT, entityId: ENTITY, status: 'INACTIVE' });
    expect(capturedWhere.status).toBe('INACTIVE');
  });

  it('passes search filter as OR condition', async () => {
    let capturedWhere: any;
    const svc = makeSvc({
      department: {
        findMany:  async ({ where }: any) => { capturedWhere = where; return []; },
        count:     async () => 0,
      },
    });
    await svc.list({ tenantId: TENANT, entityId: ENTITY, search: 'EV' });
    expect(capturedWhere.OR).toBeDefined();
  });
});

// ── DepartmentService.getById ────────────────────────────────────────────────

describe('DepartmentService.getById', () => {
  it('returns department when found', async () => {
    const svc  = makeSvc();
    const dept = await svc.getById(TENANT, ENTITY, DEPT_ID);
    expect(dept.id).toBe(DEPT_ID);
  });

  it('throws DepartmentNotFoundError when not found', async () => {
    const svc = makeSvc({ department: { findFirst: async () => null } });
    await expect(svc.getById(TENANT, ENTITY, 'nonexistent')).rejects.toThrow(DepartmentNotFoundError);
  });
});

// ── DepartmentService.seedCanonical ──────────────────────────────────────────

describe('DepartmentService.seedCanonical', () => {
  it('creates 12 canonical departments when none exist', async () => {
    const created: any[] = [];
    const svc = makeSvc({
      department: {
        findFirst: async () => null,  // nothing exists yet
        create:    async ({ data }: any) => { created.push(data); return data; },
      },
    });
    await svc.seedCanonical(TENANT, ENTITY);
    expect(created).toHaveLength(12);
    expect(created.every(d => d.canonical === true)).toBe(true);
  });

  it('is idempotent — skips existing codes', async () => {
    const created: any[] = [];
    // Simulate all 12 already exist
    const svc = makeSvc({
      department: {
        findFirst: async () => ACTIVE_DEPT, // always found
        create:    async ({ data }: any) => { created.push(data); return data; },
      },
    });
    await svc.seedCanonical(TENANT, ENTITY);
    expect(created).toHaveLength(0); // nothing created
  });
});

// ── DepartmentService.create ─────────────────────────────────────────────────

describe('DepartmentService.create', () => {
  it('creates a custom department successfully', async () => {
    const svc  = makeSvc({ department: { findFirst: async () => null, create: async ({ data }: any) => ({ ...ACTIVE_DEPT, ...data }) } });
    const dept = await svc.create({ tenantId: TENANT, entityId: ENTITY, code: '21', name: 'EV Service' });
    expect(dept.code).toBe('21');
    expect(dept.canonical).toBe(false);
  });

  it('throws CANONICAL_CODE_RESERVED when code is 01-12', async () => {
    const svc = makeSvc();
    await expect(
      svc.create({ tenantId: TENANT, entityId: ENTITY, code: '07', name: 'X' }),
    ).rejects.toMatchObject({ code: 'CANONICAL_CODE_RESERVED' });
  });

  it('throws INVALID_CODE_RANGE when code is 13-19', async () => {
    const svc = makeSvc();
    await expect(
      svc.create({ tenantId: TENANT, entityId: ENTITY, code: '15', name: 'X' }),
    ).rejects.toMatchObject({ code: 'INVALID_CODE_RANGE' });
  });

  it('throws INVALID_CODE_RANGE when code is 90-99', async () => {
    const svc = makeSvc();
    await expect(
      svc.create({ tenantId: TENANT, entityId: ENTITY, code: '92', name: 'X' }),
    ).rejects.toMatchObject({ code: 'INVALID_CODE_RANGE' });
  });

  it('throws INVALID_CODE_RANGE for non-numeric code', async () => {
    const svc = makeSvc();
    await expect(
      svc.create({ tenantId: TENANT, entityId: ENTITY, code: 'AA', name: 'X' }),
    ).rejects.toMatchObject({ code: 'INVALID_CODE_RANGE' });
  });

  it('throws DUPLICATE_DEPT_CODE on code collision', async () => {
    // findFirst returns existing for the code check
    const svc = makeSvc({ department: { findFirst: async () => ACTIVE_DEPT } });
    await expect(
      svc.create({ tenantId: TENANT, entityId: ENTITY, code: '21', name: 'Different Name' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_DEPT_CODE' });
  });

  it('throws DUPLICATE_DEPARTMENT_NAME on name collision', async () => {
    // First call (code check) returns null, second (name check) returns existing
    let call = 0;
    const svc = makeSvc({
      department: {
        findFirst: async () => { call++; return call === 1 ? null : ACTIVE_DEPT; },
        create:    async ({ data }: any) => data,
      },
    });
    await expect(
      svc.create({ tenantId: TENANT, entityId: ENTITY, code: '22', name: 'EV Service' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_DEPARTMENT_NAME' });
  });

  it('throws ORPHAN_DEPARTMENT when entity does not belong to tenant', async () => {
    const svc = makeSvc({ legalEntity: { findFirst: async () => null } });
    await expect(
      svc.create({ tenantId: TENANT, entityId: ENTITY, code: '21', name: 'X' }),
    ).rejects.toMatchObject({ code: 'ORPHAN_DEPARTMENT' });
  });
});

// ── DepartmentService.update ─────────────────────────────────────────────────

describe('DepartmentService.update', () => {
  it('updates name successfully', async () => {
    let saved: any;
    const svc = makeSvc({ department: {
      // id: { not: DEPT_ID } means it's the name-uniqueness check — return null (no conflict)
      // id: DEPT_ID means it's the load-by-id call — return the dept
      findFirst: async ({ where }: any) => (typeof where.id === 'object') ? null : ACTIVE_DEPT,
      update:    async ({ data }: any) => { saved = data; return { ...ACTIVE_DEPT, ...data }; },
    }});
    const dept = await svc.update(TENANT, ENTITY, DEPT_ID, { version: 1, name: 'New Name' });
    expect(saved.name).toBe('New Name');
    expect(saved.version).toBe(2);
    expect(dept.version).toBe(2);
  });

  it('throws VERSION_CONFLICT on version mismatch', async () => {
    const svc = makeSvc();
    await expect(
      svc.update(TENANT, ENTITY, DEPT_ID, { version: 99, name: 'X' }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('throws DEPT_INACTIVE when updating inactive department', async () => {
    const svc = makeSvc({ department: { findFirst: async () => INACTIVE_DEPT } });
    await expect(
      svc.update(TENANT, ENTITY, DEPT_ID, { version: 2, name: 'X' }),
    ).rejects.toMatchObject({ code: 'DEPT_INACTIVE' });
  });

  it('throws DepartmentNotFoundError when department missing', async () => {
    const svc = makeSvc({ department: { findFirst: async () => null } });
    await expect(
      svc.update(TENANT, ENTITY, 'nonexistent', { version: 1 }),
    ).rejects.toThrow(DepartmentNotFoundError);
  });

  it('throws DUPLICATE_DEPARTMENT_NAME when new name conflicts', async () => {
    const svc = makeSvc({ department: {
      // Load by id → return dept; name-uniqueness check (id: { not: ... }) → return conflict
      findFirst: async ({ where }: any) => (typeof where.id === 'object') ? { ...ACTIVE_DEPT, id: 'other-dept' } : ACTIVE_DEPT,
      update:    async () => ACTIVE_DEPT,
    }});
    await expect(
      svc.update(TENANT, ENTITY, DEPT_ID, { version: 1, name: 'Conflicting Name' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_DEPARTMENT_NAME' });
  });
});

// ── DepartmentService.deactivate ─────────────────────────────────────────────

describe('DepartmentService.deactivate', () => {
  it('deactivates an active department', async () => {
    let saved: any;
    const svc = makeSvc({ department: {
      findFirst: async () => ACTIVE_DEPT,
      update:    async ({ data }: any) => { saved = data; return { ...ACTIVE_DEPT, ...data }; },
    }});
    const dept = await svc.deactivate(TENANT, ENTITY, DEPT_ID, {
      version: 1, reason: 'Consolidation', deactivatedBy: 'admin',
    });
    expect(saved.status).toBe('INACTIVE');
    expect(saved.deactivationReason).toBe('Consolidation');
    expect(dept.status).toBe('INACTIVE');
  });

  it('throws ALREADY_INACTIVE when already inactive', async () => {
    const svc = makeSvc({ department: { findFirst: async () => INACTIVE_DEPT } });
    await expect(
      svc.deactivate(TENANT, ENTITY, DEPT_ID, { version: 2, reason: 'X', deactivatedBy: 'admin' }),
    ).rejects.toMatchObject({ code: 'ALREADY_INACTIVE' });
  });

  it('throws VERSION_CONFLICT on version mismatch', async () => {
    const svc = makeSvc();
    await expect(
      svc.deactivate(TENANT, ENTITY, DEPT_ID, { version: 99, reason: 'X', deactivatedBy: 'admin' }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('throws DepartmentNotFoundError when department missing', async () => {
    const svc = makeSvc({ department: { findFirst: async () => null } });
    await expect(
      svc.deactivate(TENANT, ENTITY, 'nonexistent', { version: 1, reason: 'X', deactivatedBy: 'admin' }),
    ).rejects.toThrow(DepartmentNotFoundError);
  });
});
