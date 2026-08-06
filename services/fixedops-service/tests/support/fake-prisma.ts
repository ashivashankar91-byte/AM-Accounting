// Adapted from services/tax-service/tests/support/fake-prisma.ts — a
// minimal in-memory Prisma stand-in for fixedops-service unit tests.
import { randomUUID } from 'crypto';

type Row = Record<string, any>;
interface RelationDef { foreignKey: string; model: string; }

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR' && Array.isArray(condition)) {
      if (!condition.some((c) => matchesWhere(row, c))) return false;
      continue;
    }
    if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
      if ('not' in condition) {
        const notVal = (condition as any).not;
        if (notVal === null ? row[key] === null : row[key] === notVal) return false;
        continue;
      }
      if ('in' in condition) { if (!(condition as any).in.includes(row[key])) return false; continue; }
      if ('notIn' in condition) { if ((condition as any).notIn.includes(row[key])) return false; continue; }
      if ('gte' in condition && row[key] < (condition as any).gte) return false;
      if ('lte' in condition && row[key] > (condition as any).lte) return false;
      if ('lt' in condition && !(row[key] < (condition as any).lt)) return false;
      if ('gt' in condition && !(row[key] > (condition as any).gt)) return false;
      if ('some' in condition) {
        continue; // relation filters not needed by this service's queries
      }
      continue;
    }
    if (row[key] !== condition) return false;
  }
  return true;
}

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

  async findFirst(args: { where?: Row; orderBy?: Record<string, 'asc' | 'desc'>; include?: Record<string, boolean> } = {}): Promise<Row | null> {
    // Delegates to findMany so `orderBy` (e.g. "latest effectiveFrom <= asOf
    // wins") is honored instead of silently falling back to insertion order.
    const [row] = await this.findMany({ ...args, take: 1 });
    return row ?? null;
  }

  async findUnique(args: { where: Row; include?: Record<string, boolean> }): Promise<Row | null> {
    return this.findFirst(args);
  }

  async count(args: { where?: Row } = {}): Promise<number> {
    return this.rows.filter((r) => matchesWhere(r, args.where)).length;
  }

  async create(args: { data: Row; include?: Record<string, boolean> }): Promise<Row> {
    const data = { ...args.data };
    if (data.id === undefined) delete data.id;
    // Real Prisma translates a relation-connect (`{ subletPo: { connect: { id } } }`)
    // into the underlying `<relation>Id` FK column. This fake stores data
    // as given, so without this translation a query filtering on the FK
    // column (e.g. `where: { subletPoId: po.id }`) would never match.
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'connect' in value && (value as any).connect?.id !== undefined) {
        data[`${key}Id`] = (value as any).connect.id;
        delete data[key];
      }
    }
    const row: Row = { id: data.id ?? randomUUID(), createdAt: new Date(), updatedAt: new Date(), publishedAt: null, ...data };
    this.rows.push(row);
    return this.hydrate(row, args.include);
  }

  async update(args: { where: { id: string }; data: Row }): Promise<Row> {
    const row = this.rows.find((r) => r.id === args.where.id);
    if (!row) throw new Error(`Record not found for update: ${args.where.id}`);
    for (const [key, value] of Object.entries(args.data)) {
      if (value && typeof value === 'object' && 'increment' in value) row[key] = (row[key] ?? 0) + value.increment;
      else row[key] = value;
    }
    row.updatedAt = new Date();
    return { ...row };
  }

  async upsert(args: { where: Row; create: Row; update: Row }): Promise<Row> {
    // Only supports the compound-unique shape used by this service, e.g. { tenantId_claimNumber: {...} }
    const whereKey = Object.keys(args.where)[0]!;
    const compound = args.where[whereKey];
    // Date-valued keys (e.g. effectiveFrom) need value equality — two
    // `new Date(sameDay)` instances are never `===` even when equal.
    const existing = this.rows.find((r) => Object.entries(compound).every(([k, v]) =>
      v instanceof Date ? r[k] instanceof Date && r[k].getTime() === v.getTime() : r[k] === v,
    ));
    if (existing) return this.update({ where: { id: existing.id }, data: args.update });
    return this.create({ data: { ...compound, ...args.create } });
  }
}

export class FakePrismaClient {
  private readonly models = new Map<string, FakeModel>();
  model(name: string): FakeModel {
    if (!this.models.has(name)) this.models.set(name, new FakeModel(name, {}, this));
    return this.models.get(name)!;
  }

  get repairOrder() { return this.model('repairOrder'); }
  get roCloseSubmission() { return this.model('roCloseSubmission'); }
  get roDistributionLine() { return this.model('roDistributionLine'); }
  get roReversal() { return this.model('roReversal'); }
  get wipModeElection() { return this.model('wipModeElection'); }
  get techGuaranteeConfig() { return this.model('techGuaranteeConfig'); }
  get techTimeAbsorption() { return this.model('techTimeAbsorption'); }
  get techTimeAbsorptionReversal() { return this.model('techTimeAbsorptionReversal'); }
  get laborRateConfig() { return this.model('laborRateConfig'); }
  get deferredMaintenanceContract() { return this.model('deferredMaintenanceContract'); }
  get deferredMaintenanceRedemption() { return this.model('deferredMaintenanceRedemption'); }
  get subletPurchaseOrder() { return this.model('subletPurchaseOrder'); }
  get subletInvoiceMatch() { return this.model('subletInvoiceMatch'); }
  get warrantyClaimItem() { return this.model('warrantyClaimItem'); }
  get warrantyClaimRemittance() { return this.model('warrantyClaimRemittance'); }
  get warrantyClaimDisposition() { return this.model('warrantyClaimDisposition'); }
  get fixedOpsAccountMapping() { return this.model('fixedOpsAccountMapping'); }
  get fixedOpsPostingException() { return this.model('fixedOpsPostingException'); }
  get auditOutboxEvent() { return this.model('auditOutboxEvent'); }

  async $transaction(fn: (tx: any) => Promise<any>): Promise<any> {
    return fn(this);
  }
}
