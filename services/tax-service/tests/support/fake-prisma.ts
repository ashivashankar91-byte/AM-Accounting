// A minimal, in-memory fake Prisma client for tax-service unit tests. Not a
// full Prisma reimplementation — supports exactly the subset of query
// shapes this service's application layer uses (see the codebase's own
// prisma.*.findMany/findFirst/create/update/count call sites), so unit
// tests can exercise real business logic without a live Postgres. Live-db
// tests (tests/live-db/) use the real Prisma client + a real ephemeral
// Postgres instead — this fake is deliberately NOT a substitute for RLS,
// concurrency, or migration-replay proofs.

import { randomUUID } from 'crypto';

type Row = Record<string, any>;

interface RelationDef {
  /** Field name on the child row that references the parent's id. */
  foreignKey: string;
  /** Model name this relation points to. */
  model: string;
}

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
      if ('not' in condition) {
        const notVal = condition.not;
        if (notVal === null ? row[key] === null : row[key] === notVal) return false;
        continue;
      }
      if ('in' in condition) {
        if (!condition.in.includes(row[key])) return false;
        continue;
      }
      if ('gte' in condition && row[key] < condition.gte) return false;
      if ('lte' in condition && row[key] > condition.lte) return false;
      if ('lt' in condition && !(row[key] < condition.lt)) return false;
      if ('gt' in condition && !(row[key] > condition.gt)) return false;
      if ('some' in condition) {
        const children: Row[] = row[`__rel_${key}`] ?? [];
        if (!children.some((c) => matchesWhere(c, condition.some))) return false;
        continue;
      }
      continue;
    }
    if (row[key] !== condition) return false;
  }
  return true;
}

class FakeModel {
  rows: Row[] = [];
  constructor(
    private readonly modelName: string,
    private readonly relations: Record<string, RelationDef> = {},
    private readonly store?: FakePrismaClient,
  ) {}

  private hydrate(row: Row, include?: Record<string, boolean>): Row {
    if (!include) return row;
    const result = { ...row };
    for (const relName of Object.keys(include)) {
      const def = this.relations[relName];
      if (!def || !this.store) continue;
      const childModel = this.store.model(def.model);
      result[relName] = childModel.rows.filter((c) => c[def.foreignKey] === row.id);
    }
    return result;
  }

  async findMany(args: { where?: Row; orderBy?: Record<string, 'asc' | 'desc'>; include?: Record<string, boolean>; take?: number } = {}): Promise<Row[]> {
    let matched = this.rows.filter((r) => matchesWhere(r, args.where));
    if (args.orderBy) {
      const [field, dir] = Object.entries(args.orderBy)[0]!;
      matched = [...matched].sort((a, b) => {
        const av = a[field]; const bv = b[field];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === 'desc' ? -cmp : cmp;
      });
    }
    if (args.take) matched = matched.slice(0, args.take);
    return matched.map((r) => this.hydrate(r, args.include));
  }

  async findFirst(args: { where?: Row; include?: Record<string, boolean> } = {}): Promise<Row | null> {
    const row = this.rows.find((r) => matchesWhere(r, args.where));
    return row ? this.hydrate(row, args.include) : null;
  }

  async count(args: { where?: Row } = {}): Promise<number> {
    return this.rows.filter((r) => matchesWhere(r, args.where)).length;
  }

  async create(args: { data: Row; include?: Record<string, boolean> }): Promise<Row> {
    const { ...data } = args.data;
    if (data.id === undefined) delete data.id; // avoid an explicit `undefined` key clobbering the generated default below
    const nestedCreates: Record<string, Row[]> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'create' in value) {
        nestedCreates[key] = value.create;
        delete data[key];
      }
    }
    const row: Row = { id: data.id ?? randomUUID(), version: 1, createdAt: new Date(), updatedAt: new Date(), publishedAt: null, retryCount: 0, active: true, ...data };

    // Enforce unique constraints the schema declares, for the ones this
    // service's own idempotency/overlap logic depends on. taxResult's true
    // uniqueness is a PARTIAL unique index (tenantId, idempotencyKey) WHERE
    // status IN ('CALCULATED','EXEMPT_APPLIED') — see
    // 20260801010003_add_partial_unique_idempotency_tax_svc — so only two
    // terminal/proceedable rows for the same key conflict; non-proceed
    // evidence rows (NOT_CONFIGURED/ENGINE_REJECTED) may accumulate freely.
    const FINAL_STATUSES = new Set(['CALCULATED', 'EXEMPT_APPLIED']);
    if (this.modelName === 'taxResult' && FINAL_STATUSES.has(row.status)) {
      const dup = this.rows.find((r) => r.tenantId === row.tenantId && r.idempotencyKey === row.idempotencyKey && FINAL_STATUSES.has(r.status));
      if (dup) {
        const err: any = new Error('Unique constraint failed on the fields: (`tenant_id`,`idempotency_key`)');
        err.code = 'P2002';
        throw err;
      }
    }

    this.rows.push(row);

    for (const [relName, childRowsData] of Object.entries(nestedCreates)) {
      const def = this.relations[relName];
      if (!def || !this.store) continue;
      const childModel = this.store.model(def.model);
      for (const childData of childRowsData) {
        await childModel.create({ data: { ...childData, [def.foreignKey]: row.id } });
      }
    }

    return this.hydrate(row, args.include);
  }

  async update(args: { where: { id: string }; data: Row }): Promise<Row> {
    const row = this.rows.find((r) => r.id === args.where.id);
    if (!row) throw new Error(`Record not found for update: ${args.where.id}`);
    for (const [key, value] of Object.entries(args.data)) {
      if (value && typeof value === 'object' && 'increment' in value) {
        row[key] = (row[key] ?? 0) + value.increment;
      } else {
        row[key] = value;
      }
    }
    row.updatedAt = new Date();
    return { ...row };
  }
}

/** Relation map — mirrors prisma/schema.prisma's @relation fields used via `include`. */
const RELATIONS: Record<string, Record<string, RelationDef>> = {
  taxResult: { lines: { foreignKey: 'taxResultId', model: 'taxResultLine' } },
  taxException: { dispositions: { foreignKey: 'exceptionId', model: 'taxExceptionDisposition' } },
  feeTable: {
    applicabilityTags: { foreignKey: 'feeTableId', model: 'feeTableApplicabilityTag' },
    usageReferences: { foreignKey: 'feeTableId', model: 'feeTableUsageReference' },
  },
};

export class FakePrismaClient {
  private readonly models = new Map<string, FakeModel>();

  model(name: string): FakeModel {
    if (!this.models.has(name)) {
      this.models.set(name, new FakeModel(name, RELATIONS[name] ?? {}, this));
    }
    return this.models.get(name)!;
  }

  get taxEngineConfig() { return this.model('taxEngineConfig'); }
  get jurisdictionRegistration() { return this.model('jurisdictionRegistration'); }
  get exemptionCertificate() { return this.model('exemptionCertificate'); }
  get taxResult() { return this.model('taxResult'); }
  get taxResultLine() { return this.model('taxResultLine'); }
  get taxIntegrityAlert() { return this.model('taxIntegrityAlert'); }
  get taxEngineAttemptLog() { return this.model('taxEngineAttemptLog'); }
  get taxException() { return this.model('taxException'); }
  get taxExceptionDisposition() { return this.model('taxExceptionDisposition'); }
  get taxAccountMappingRef() { return this.model('taxAccountMappingRef'); }
  get feeTable() { return this.model('feeTable'); }
  get feeTableApplicabilityTag() { return this.model('feeTableApplicabilityTag'); }
  get feeTableUsageReference() { return this.model('feeTableUsageReference'); }
  get taxAuditReference() { return this.model('taxAuditReference'); }
}
