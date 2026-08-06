/**
 * A schema-driven in-memory stand-in for the generated Prisma client.
 *
 * It is parsed from prisma/schema.prisma at load time rather than hand-listed,
 * so it cannot drift from the real model: every field, default, relation and
 * unique constraint the database enforces is enforced here too. That matters
 * because the properties CE-17 depends on are database facts, not application
 * etiquette — a duplicate idempotency key must fail with P2002 in a test for
 * the same reason it fails in Postgres, and a query that forgets tenantId must
 * be visibly able to read another tenant's row so the test can prove the
 * service never issues one.
 */

import fs from 'fs';
import path from 'path';

// ── Schema metadata ───────────────────────────────────────────────────────────

interface FieldMeta {
  name: string;
  type: string;
  optional: boolean;
  isId: boolean;
  isList: boolean;
  isRelation: boolean;
  relationTo?: string;
  relationFromField?: string;
  relationToField?: string;
  defaultRaw?: string;
  updatedAt: boolean;
  unique: boolean;
}

interface ModelMeta {
  name: string;
  delegate: string;
  fields: FieldMeta[];
  uniques: string[][];
}

const SCHEMA_PATH = path.resolve(__dirname, '../../prisma/schema.prisma');

function stripComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length - 1; i += 1) {
    if (line[i] === '"') inQuote = !inQuote;
    if (!inQuote && line[i] === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

function balancedArg(rest: string, marker: string): string | undefined {
  const at = rest.indexOf(marker);
  if (at === -1) return undefined;
  let i = at + marker.length;
  let depth = 1;
  let buf = '';
  while (i < rest.length && depth > 0) {
    const c = rest[i]!;
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) break; }
    buf += c;
    i += 1;
  }
  return buf.trim();
}

function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function parseSchema(): Map<string, ModelMeta> {
  const src = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const models = new Map<string, ModelMeta>();
  const blockRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;

  while ((m = blockRe.exec(src)) !== null) {
    const name = m[1]!;
    const meta: ModelMeta = { name, delegate: delegateName(name), fields: [], uniques: [] };

    for (const raw of m[2]!.split('\n')) {
      const line = stripComment(raw).trim();
      if (!line) continue;
      if (line.startsWith('@@unique(')) {
        const cols = /@@unique\(\[([^\]]+)\]/.exec(line)?.[1];
        if (cols) meta.uniques.push(cols.split(',').map((s) => s.trim()));
        continue;
      }
      if (line.startsWith('@@')) continue;

      const fm = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
      if (!fm) continue;
      const [, fname, ftype, isList, optional, rest = ''] = fm;
      const relArg = balancedArg(rest, '@relation(');
      const isRelation = Boolean(relArg) || Boolean(isList);
      const field: FieldMeta = {
        name: fname!,
        type: ftype!,
        optional: Boolean(optional),
        isId: /@id\b/.test(rest),
        isList: Boolean(isList),
        isRelation,
        defaultRaw: balancedArg(rest, '@default('),
        updatedAt: /@updatedAt\b/.test(rest),
        unique: /@unique\b/.test(rest),
      };
      if (relArg) {
        field.relationFromField = /fields:\s*\[([^\]]+)\]/.exec(relArg)?.[1]?.trim();
        field.relationToField = /references:\s*\[([^\]]+)\]/.exec(relArg)?.[1]?.trim();
        field.relationTo = ftype;
      } else if (isList) {
        field.relationTo = ftype;
      }
      meta.fields.push(field);
      if (field.unique && !field.isId) meta.uniques.push([field.name]);
    }
    models.set(name, meta);
  }
  return models;
}

const MODELS = parseSchema();

// ── Errors ────────────────────────────────────────────────────────────────────

export class FakePrismaKnownRequestError extends Error {
  code: string;
  meta: Record<string, unknown>;
  constructor(code: string, message: string, meta: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
    this.code = code;
    this.meta = meta;
  }
}

// ── Value helpers ─────────────────────────────────────────────────────────────

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `c${String(idSeq).padStart(12, '0')}`;
}

function defaultValue(field: FieldMeta): unknown {
  const d = field.defaultRaw;
  if (d === undefined) return undefined;
  if (d === 'now()') return new Date();
  if (d === 'cuid()' || d === 'uuid()') return nextId();
  if (d === 'true') return true;
  if (d === 'false') return false;
  if (/^-?\d+$/.test(d)) return Number(d);
  if (/^"[\s\S]*"$/.test(d)) {
    const inner = d.slice(1, -1);
    if (field.type === 'Json') { try { return JSON.parse(inner); } catch { return inner; } }
    return inner;
  }
  return undefined;
}

function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  return value;
}

function compare(a: unknown, b: unknown): number {
  const x = normalise(a) as any;
  const y = normalise(b) as any;
  if (x === y) return 0;
  if (x === null || x === undefined) return -1;
  if (y === null || y === undefined) return 1;
  return x < y ? -1 : 1;
}

function matchCondition(actual: unknown, condition: any): boolean {
  if (condition === null) return actual === null || actual === undefined;
  if (condition instanceof Date) return normalise(actual) === normalise(condition);
  if (typeof condition !== 'object' || Array.isArray(condition)) {
    return normalise(actual) === normalise(condition);
  }
  for (const [op, expected] of Object.entries(condition)) {
    switch (op) {
      case 'equals': if (normalise(actual) !== normalise(expected)) return false; break;
      case 'not': if (matchCondition(actual, expected)) return false; break;
      case 'in': if (!(expected as unknown[]).some((v) => normalise(v) === normalise(actual))) return false; break;
      case 'notIn': if ((expected as unknown[]).some((v) => normalise(v) === normalise(actual))) return false; break;
      case 'gt': if (compare(actual, expected) <= 0) return false; break;
      case 'gte': if (compare(actual, expected) < 0) return false; break;
      case 'lt': if (compare(actual, expected) >= 0) return false; break;
      case 'lte': if (compare(actual, expected) > 0) return false; break;
      case 'contains': if (!String(actual ?? '').includes(String(expected))) return false; break;
      case 'startsWith': if (!String(actual ?? '').startsWith(String(expected))) return false; break;
      default: return false;
    }
  }
  return true;
}

function matchWhere(row: any, where: any, meta: ModelMeta): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'AND') { if (!(condition as any[]).every((c) => matchWhere(row, c, meta))) return false; continue; }
    if (key === 'OR') { if (!(condition as any[]).some((c) => matchWhere(row, c, meta))) return false; continue; }
    if (key === 'NOT') { if (matchWhere(row, condition, meta)) return false; continue; }

    // Compound unique selector, e.g. { tenantId_legalEntityId_capabilityCode: {...} }
    if (!(key in row) && key.includes('_') && typeof condition === 'object') {
      if (!matchWhere(row, condition, meta)) return false;
      continue;
    }
    if (!matchCondition(row[key], condition)) return false;
  }
  return true;
}

// ── The store ─────────────────────────────────────────────────────────────────

export class FakePrisma {
  readonly tables = new Map<string, any[]>();
  /** Every raw SQL string the services issued, so a test can assert on it. */
  readonly rawQueries: string[] = [];
  rawHandler: ((sql: string, params: unknown[]) => unknown) | null = null;

  constructor() {
    for (const meta of MODELS.values()) {
      this.tables.set(meta.name, []);
      (this as any)[meta.delegate] = this.makeDelegate(meta);
    }
  }

  rows(model: string): any[] {
    return this.tables.get(model) ?? [];
  }

  private enforceUnique(meta: ModelMeta, candidate: any, ignoreRow?: any): void {
    const idField = meta.fields.find((f) => f.isId)?.name ?? 'id';
    for (const combo of meta.uniques) {
      const clash = this.rows(meta.name).find((row) => {
        if (row === ignoreRow) return false;
        if (row[idField] === candidate[idField]) return false;
        return combo.every((c) => row[c] !== undefined && row[c] !== null && normalise(row[c]) === normalise(candidate[c]));
      });
      if (clash) {
        throw new FakePrismaKnownRequestError(
          'P2002',
          `Unique constraint failed on the fields: (${combo.join(', ')})`,
          { target: combo },
        );
      }
    }
  }

  private hydrate(meta: ModelMeta, data: any): any {
    const row: any = {};
    for (const field of meta.fields) {
      if (field.isRelation) continue;
      if (data[field.name] !== undefined) { row[field.name] = data[field.name]; continue; }
      const def = defaultValue(field);
      if (def !== undefined) { row[field.name] = def; continue; }
      if (field.updatedAt) { row[field.name] = new Date(); continue; }
      row[field.name] = null;
    }
    if (!row.id) row.id = nextId();
    return row;
  }

  private applyInclude(meta: ModelMeta, row: any, include: any, select: any): any {
    const shaped: any = { ...row };
    const spec = include ?? select;
    if (!spec) return shaped;
    for (const [key, value] of Object.entries(spec)) {
      if (!value) continue;
      const field = meta.fields.find((f) => f.name === key && f.isRelation);
      if (!field?.relationTo) continue;
      const target = MODELS.get(field.relationTo)!;
      if (field.isList) {
        // Back-reference: find the owning scalar on the child model.
        const child = target.fields.find((f) => f.relationTo === meta.name && f.relationFromField);
        const fk = child?.relationFromField ?? 'id';
        const nested = typeof value === 'object' ? (value as any) : {};
        let list = this.rows(target.name).filter((r) => r[fk] === row.id);
        if (nested.where) list = list.filter((r) => matchWhere(r, nested.where, target));
        if (nested.orderBy) list = this.sort(list, nested.orderBy);
        shaped[key] = list.map((r) => this.applyInclude(target, r, nested.include, nested.select));
      } else {
        const fk = field.relationFromField ?? 'id';
        const ref = field.relationToField ?? 'id';
        const nested = typeof value === 'object' ? (value as any) : {};
        const found = this.rows(target.name).find((r) => r[ref] === row[fk]) ?? null;
        shaped[key] = found ? this.applyInclude(target, found, nested.include, nested.select) : null;
      }
    }
    return shaped;
  }

  private sort(rows: any[], orderBy: any): any[] {
    const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
      for (const spec of specs) {
        for (const [key, dir] of Object.entries(spec)) {
          const c = compare(a[key], b[key]);
          if (c !== 0) return dir === 'desc' ? -c : c;
        }
      }
      return 0;
    });
  }

  private makeDelegate(meta: ModelMeta) {
    const store = () => this.rows(meta.name);

    const find = (args: any = {}) => {
      let rows = store().filter((r) => matchWhere(r, args.where, meta));
      if (args.orderBy) rows = this.sort(rows, args.orderBy);
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take !== undefined) rows = args.take >= 0 ? rows.slice(0, args.take) : rows.slice(args.take);
      return rows.map((r) => this.applyInclude(meta, r, args.include, args.select));
    };

    const mutate = (row: any, data: any) => {
      for (const [key, value] of Object.entries(data ?? {})) {
        if (value && typeof value === 'object' && 'increment' in (value as any)) {
          row[key] = (row[key] ?? 0) + (value as any).increment;
        } else if (value && typeof value === 'object' && 'decrement' in (value as any)) {
          row[key] = (row[key] ?? 0) - (value as any).decrement;
        } else if (value && typeof value === 'object' && 'set' in (value as any)) {
          row[key] = (value as any).set;
        } else {
          row[key] = value;
        }
      }
      const updatedAtField = meta.fields.find((f) => f.updatedAt);
      if (updatedAtField && data?.[updatedAtField.name] === undefined) row[updatedAtField.name] = new Date();
      return row;
    };

    return {
      findMany: async (args: any = {}) => find(args),
      findFirst: async (args: any = {}) => find({ ...args, take: 1 })[0] ?? null,
      findUnique: async (args: any = {}) => find({ ...args, take: 1 })[0] ?? null,
      count: async (args: any = {}) => store().filter((r) => matchWhere(r, args.where, meta)).length,
      create: async (args: any) => {
        const row = this.hydrate(meta, args.data ?? {});
        this.enforceUnique(meta, row);
        store().push(row);
        return this.applyInclude(meta, row, args.include, args.select);
      },
      createMany: async (args: any) => {
        const list: any[] = Array.isArray(args.data) ? args.data : [args.data];
        let count = 0;
        for (const entry of list) {
          const row = this.hydrate(meta, entry);
          try {
            this.enforceUnique(meta, row);
          } catch (err) {
            if (args.skipDuplicates) continue;
            throw err;
          }
          store().push(row);
          count += 1;
        }
        return { count };
      },
      update: async (args: any) => {
        const row = store().find((r) => matchWhere(r, args.where, meta));
        if (!row) throw new FakePrismaKnownRequestError('P2025', 'Record to update not found.');
        const next = { ...row };
        mutate(next, args.data);
        this.enforceUnique(meta, next, row);
        mutate(row, args.data);
        return this.applyInclude(meta, row, args.include, args.select);
      },
      updateMany: async (args: any) => {
        const rows = store().filter((r) => matchWhere(r, args.where, meta));
        for (const row of rows) mutate(row, args.data);
        return { count: rows.length };
      },
      upsert: async (args: any) => {
        const row = store().find((r) => matchWhere(r, args.where, meta));
        if (row) { mutate(row, args.update); return this.applyInclude(meta, row, args.include, args.select); }
        const flattenedWhere: any = {};
        for (const [key, value] of Object.entries(args.where ?? {})) {
          if (value && typeof value === 'object' && !(value instanceof Date)) Object.assign(flattenedWhere, value);
          else flattenedWhere[key] = value;
        }
        const created = this.hydrate(meta, { ...flattenedWhere, ...args.create });
        this.enforceUnique(meta, created);
        store().push(created);
        return this.applyInclude(meta, created, args.include, args.select);
      },
      delete: async (args: any) => {
        const idx = store().findIndex((r) => matchWhere(r, args.where, meta));
        if (idx === -1) throw new FakePrismaKnownRequestError('P2025', 'Record to delete does not exist.');
        return store().splice(idx, 1)[0];
      },
      deleteMany: async (args: any = {}) => {
        const keep = store().filter((r) => !matchWhere(r, args.where, meta));
        const removed = store().length - keep.length;
        this.tables.set(meta.name, keep);
        (this as any)[meta.delegate] = (this as any)[meta.delegate];
        return { count: removed };
      },
      aggregate: async (args: any = {}) => {
        const rows = store().filter((r) => matchWhere(r, args.where, meta));
        const out: any = { _count: rows.length };
        if (args._sum) {
          out._sum = {};
          for (const key of Object.keys(args._sum)) {
            out._sum[key] = rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
          }
        }
        return out;
      },
      groupBy: async (args: any = {}) => {
        const rows = store().filter((r) => matchWhere(r, args.where, meta));
        const by: string[] = args.by ?? [];
        const buckets = new Map<string, any[]>();
        for (const row of rows) {
          const key = by.map((b) => String(row[b])).join('\u0000');
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key)!.push(row);
        }
        return [...buckets.values()].map((group) => {
          const out: any = { _count: group.length };
          for (const b of by) out[b] = group[0][b];
          return out;
        });
      },
    };
  }

  async $transaction<T>(fn: any): Promise<T> {
    if (Array.isArray(fn)) return Promise.all(fn) as any;
    return fn(this);
  }

  async $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T> {
    this.rawQueries.push(sql);
    return (this.rawHandler ? this.rawHandler(sql, params) : []) as T;
  }

  async $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number> {
    this.rawQueries.push(sql);
    if (this.rawHandler) this.rawHandler(sql, params);
    return 0;
  }

  async $connect(): Promise<void> { /* no-op */ }
  async $disconnect(): Promise<void> { /* no-op */ }
}

export function makePrisma(): any {
  return new FakePrisma();
}

/** Records every event a service publishes so a test can assert on the trail. */
export class RecordingEventPublisher {
  readonly events: Array<{ tenantId: string; aggregateId: string; type: string; payload: any }> = [];

  async publish(tenantId: string, aggregateId: string, type: string, payload: any): Promise<void> {
    this.events.push({ tenantId, aggregateId, type, payload });
  }

  typesFor(aggregateId: string): string[] {
    return this.events.filter((e) => e.aggregateId === aggregateId).map((e) => e.type);
  }

  has(type: string): boolean {
    return this.events.some((e) => e.type === type);
  }
}
