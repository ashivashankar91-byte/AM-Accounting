// Minimal in-memory fake Prisma client for parts-accounting-service unit
// tests — mirrors services/tax-service/tests/support/fake-prisma.ts's
// approach (supports exactly the query shapes this service's application
// layer uses), extended with upsert/createMany/$transaction so the
// withSerializableRetry-wrapped flows (movement posting, physical-inventory
// approval, deposit apply/refund) can run without a live Postgres. Live-db
// tests use the real client + real ephemeral Postgres instead.

import { randomUUID } from 'crypto';

type Row = Record<string, any>;

function flattenCompositeWhere(where: Row): Row {
  const flat: Row = {};
  for (const [key, value] of Object.entries(where)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !('not' in value) && !('in' in value) && !('gte' in value) && !('lte' in value) && !('lt' in value) && !('gt' in value) && !('increment' in value)) {
      Object.assign(flat, value); // composite unique input, e.g. { tenantId_movementId: { tenantId, movementId } }
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  const flat = flattenCompositeWhere(where);
  for (const [key, condition] of Object.entries(flat)) {
    if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
      if ('not' in condition) { if (row[key] === condition.not) return false; continue; }
      if ('in' in condition) { if (!condition.in.includes(row[key])) return false; continue; }
      if ('gte' in condition && !(row[key] >= condition.gte)) return false;
      if ('lte' in condition && !(row[key] <= condition.lte)) return false;
      if ('lt' in condition && !(row[key] < condition.lt)) return false;
      if ('gt' in condition && !(row[key] > condition.gt)) return false;
      continue;
    }
    // Real Postgres/Prisma compares DATE/timestamp columns by value; two
    // separately-constructed `new Date(sameIsoString)` instances are never
    // `===`-equal by reference, which would otherwise make every
    // Date-keyed compound-unique upsert (e.g. LaborRateConfig,
    // OemReturnProgramConfig) silently create a duplicate row here instead
    // of matching the existing one.
    if (condition instanceof Date || row[key] instanceof Date) {
      const a = condition instanceof Date ? condition.getTime() : new Date(condition).getTime();
      const b = row[key] instanceof Date ? row[key].getTime() : new Date(row[key]).getTime();
      if (a !== b) return false;
      continue;
    }
    if (row[key] !== condition) return false;
  }
  return true;
}

interface RelationDef { foreignKey: string; model: string; }

class FakeModel {
  rows: Row[] = [];
  constructor(private readonly modelName: string, private readonly relations: Record<string, RelationDef> = {}, private readonly store?: FakePrismaClient) {}

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

  async findMany(args: { where?: Row; orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>; include?: Record<string, boolean>; take?: number } = {}): Promise<Row[]> {
    let matched = this.rows.filter((r) => matchesWhere(r, args.where));
    if (args.orderBy) {
      const orderings = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
      matched = [...matched].sort((a, b) => {
        for (const ordering of orderings) {
          const [field, dir] = Object.entries(ordering)[0]!;
          const av = a[field]; const bv = b[field];
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
    }
    if (args.take) matched = matched.slice(0, args.take);
    return matched.map((r) => this.hydrate(r, args.include));
  }

  async findFirst(args: { where?: Row; include?: Record<string, boolean> } = {}): Promise<Row | null> {
    const row = this.rows.find((r) => matchesWhere(r, args.where));
    return row ? this.hydrate(row, args.include) : null;
  }

  async findUnique(args: { where: Row; include?: Record<string, boolean> }): Promise<Row | null> {
    return this.findFirst(args);
  }

  async count(args: { where?: Row } = {}): Promise<number> {
    return this.rows.filter((r) => matchesWhere(r, args.where)).length;
  }

  private applyNestedCreates(data: Row, rowId: string) {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'create' in value) {
        const def = this.relations[key];
        if (!def || !this.store) continue;
        const childModel = this.store.model(def.model);
        const items = Array.isArray(value.create) ? value.create : [value.create];
        for (const childData of items) childModel.rows.push({ id: randomUUID(), createdAt: new Date(), [def.foreignKey]: rowId, ...childData });
      }
    }
  }

  async create(args: { data: Row; include?: Record<string, boolean> }): Promise<Row> {
    const data: Row = { ...args.data };
    const nestedKeys = Object.keys(data).filter((k) => data[k] && typeof data[k] === 'object' && 'create' in data[k]);
    for (const k of nestedKeys) delete data[k];
    const row: Row = { id: data.id ?? randomUUID(), createdAt: new Date(), updatedAt: new Date(), publishedAt: null, retryCount: 0, status: data.status, ...data };
    this.rows.push(row);
    this.applyNestedCreates(args.data, row.id);
    return this.hydrate(row, args.include);
  }

  async createMany(args: { data: Row[] }): Promise<{ count: number }> {
    for (const d of args.data) this.rows.push({ id: d.id ?? randomUUID(), createdAt: new Date(), ...d });
    return { count: args.data.length };
  }

  async update(args: { where: Row; data: Row; include?: Record<string, boolean> }): Promise<Row> {
    const flat = flattenCompositeWhere(args.where);
    const row = this.rows.find((r) => matchesWhere(r, flat));
    if (!row) throw new Error(`Record not found for update in ${this.modelName}: ${JSON.stringify(args.where)}`);
    for (const [key, value] of Object.entries(args.data)) {
      if (value && typeof value === 'object' && 'increment' in value) row[key] = Number(row[key] ?? 0) + Number(value.increment);
      else row[key] = value;
    }
    row.updatedAt = new Date();
    return this.hydrate(row, args.include);
  }

  async upsert(args: { where: Row; create: Row; update: Row; include?: Record<string, boolean> }): Promise<Row> {
    const flat = flattenCompositeWhere(args.where);
    const row = this.rows.find((r) => matchesWhere(r, flat));
    if (row) return this.update({ where: args.where, data: args.update, include: args.include });
    return this.create({ data: { ...flat, ...args.create }, include: args.include });
  }
}

const RELATIONS: Record<string, Record<string, RelationDef>> = {
  priceTapeLoad: { lines: { foreignKey: 'tapeLoadId', model: 'priceTapeLine' } },
  obsolescenceProvisionRun: { lines: { foreignKey: 'runId', model: 'obsolescenceProvisionLine' } },
  physicalInventorySession: { lines: { foreignKey: 'sessionId', model: 'physicalInventoryCountLine' } },
  partsReconciliationRun: { varianceLines: { foreignKey: 'runId', model: 'partsReconciliationVarianceLine' } },
  oemReturnAuthorization: { lines: { foreignKey: 'returnAuthId', model: 'oemReturnLine' } },
};

export class FakePrismaClient {
  private readonly models = new Map<string, FakeModel>();
  model(name: string): FakeModel {
    if (!this.models.has(name)) this.models.set(name, new FakeModel(name, RELATIONS[name] ?? {}, this));
    return this.models.get(name)!;
  }

  async $transaction<T>(fn: (tx: FakePrismaClient) => Promise<T>, _opts?: unknown): Promise<T> {
    return fn(this); // no real isolation in the fake — live-db tests cover serialization behavior
  }

  /** No-op — satisfies withSerializableRetry's setTenantContextOnConnection() call inside the fake transaction. */
  async $executeRawUnsafe(_query: string, ..._values: any[]): Promise<any> { return 0; }

  get partsValuationConfig() { return this.model('partsValuationConfig'); }
  get partsMovement() { return this.model('partsMovement'); }
  get partsPerpetualBalance() { return this.model('partsPerpetualBalance'); }
  get partsReconciliationRun() { return this.model('partsReconciliationRun'); }
  get partsReconciliationVarianceLine() { return this.model('partsReconciliationVarianceLine'); }
  get priceTapeLoad() { return this.model('priceTapeLoad'); }
  get priceTapeLine() { return this.model('priceTapeLine'); }
  get obsolescenceProvisionRun() { return this.model('obsolescenceProvisionRun'); }
  get obsolescenceProvisionLine() { return this.model('obsolescenceProvisionLine'); }
  get scrapDisposal() { return this.model('scrapDisposal'); }
  get physicalInventorySession() { return this.model('physicalInventorySession'); }
  get physicalInventoryCountLine() { return this.model('physicalInventoryCountLine'); }
  get escheatJurisdictionConfig() { return this.model('escheatJurisdictionConfig'); }
  get specialOrderDeposit() { return this.model('specialOrderDeposit'); }
  get oemReturnProgramConfig() { return this.model('oemReturnProgramConfig'); }
  get oemReturnAuthorization() { return this.model('oemReturnAuthorization'); }
  get oemReturnLine() { return this.model('oemReturnLine'); }
  get partsAccountMapping() { return this.model('partsAccountMapping'); }
  get partsPostingException() { return this.model('partsPostingException'); }
  get auditOutboxEvent() { return this.model('auditOutboxEvent'); }
  get outboxEvent() { return this.model('outboxEvent'); }
}
