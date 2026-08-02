// S054A — in-memory fake Prisma client for recon-service application-
// service unit tests. Mirrors the recon-service schema shape closely
// enough to exercise ReconSessionService's business logic without a
// database. Modeled on cash-service's tests/support/fake-prisma.ts.

import crypto from 'crypto';

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (cond instanceof Date) {
      const rowVal = row[key];
      return rowVal instanceof Date ? rowVal.getTime() === cond.getTime() : rowVal === cond;
    }
    if (cond && typeof cond === 'object') {
      if ('not' in cond) return row[key] !== (cond as any).not;
      if ('in' in cond) return (cond as any).in.includes(row[key]);
      if ('contains' in cond) return String(row[key] ?? '').toLowerCase().includes(String((cond as any).contains).toLowerCase());
      return true;
    }
    return row[key] === cond;
  });
}

function makeTable<T extends { id: string }>(name: string, uniqueConflict?: (rows: T[], data: any) => string[] | null) {
  const rows: T[] = [];
  const table: any = {
    _rows: rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let out = rows.filter((r) => matches(r, where));
      if (orderBy) {
        const [[key, dir]] = Object.entries(orderBy) as any;
        out = [...out].sort((a: any, b: any) => (a[key] > b[key] ? 1 : -1) * (dir === 'desc' ? -1 : 1));
      }
      if (skip) out = out.slice(skip);
      if (take) out = out.slice(0, take);
      return out;
    },
    findUnique: async ({ where }: any) => {
      const [key, val] = Object.entries(where)[0] as [string, any];
      if (key.includes('_')) {
        return rows.find((r) => Object.entries(val).every(([k, v]) => (r as any)[k] === v)) ?? null;
      }
      return rows.find((r: any) => r[key] === val) ?? null;
    },
    findUniqueOrThrow: async (args: any) => {
      const found = await table.findUnique(args);
      if (!found) throw new Error(`Row not found (findUniqueOrThrow) in ${name}`);
      return found;
    },
    create: async ({ data }: any) => {
      const conflictTarget = uniqueConflict?.(rows, data);
      if (conflictTarget) {
        const e: any = new Error(`unique violation on ${name}`);
        e.code = 'P2002';
        e.meta = { target: conflictTarget };
        throw e;
      }
      const row = { ...data } as T;
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const idx = rows.findIndex((r: any) => r.id === where.id || matches(r, where));
      if (idx === -1) {
        const e: any = new Error(`${name} not found`);
        e.code = 'P2025';
        throw e;
      }
      const current: any = rows[idx];
      const patch: any = {};
      for (const [k, v] of Object.entries(data)) {
        patch[k] = v && typeof v === 'object' && 'increment' in (v as any) ? (current[k] ?? 0) + (v as any).increment : v;
      }
      rows[idx] = { ...current, ...patch };
      return rows[idx];
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length,
    deleteMany: async ({ where }: any = {}) => {
      const before = rows.length;
      const keep = rows.filter((r) => !matches(r, where));
      rows.length = 0;
      rows.push(...keep);
      return { count: before - rows.length };
    },
  };
  return table;
}

export function makeFakePrisma() {
  const tables = {
    reconSession: makeTable('recon_session', (rows: any[], data: any) =>
      rows.some((r) => r.tenantId === data.tenantId && r.idempotencyKey === data.idempotencyKey)
        ? ['tenant_id', 'idempotency_key']
        : null),
    reconStatementLine: makeTable('recon_statement_line'),
    reconBookItem: makeTable('recon_book_item', (rows: any[], data: any) =>
      data.sourceId != null && rows.some((r) => r.sessionId === data.sessionId && r.sourceService === data.sourceService && r.sourceId === data.sourceId)
        ? ['session_id', 'source_service', 'source_id']
        : null),
    auditOutboxEvent: makeTable('audit_outbox'),
    reconMatchRule: makeTable('recon_match_rule'),
    reconMatchSuggestion: makeTable('recon_match_suggestion', (rows: any[], data: any) =>
      rows.some((r) => r.sessionId === data.sessionId && r.statementLineId === data.statementLineId && r.bookItemId === data.bookItemId && r.ruleId === data.ruleId)
        ? ['session_id', 'statement_line_id', 'book_item_id', 'rule_id']
        : null),
  };

  const client: any = {
    ...tables,
    _tables: tables,
    $executeRawUnsafe: async () => undefined,
    $transaction: async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg)),
  };
  return client;
}

export function makeFakeEvents() {
  const published: any[] = [];
  return { published, publish: async (e: any) => void published.push(e), subscribe: () => {} };
}

export function uuid() {
  return crypto.randomUUID();
}
