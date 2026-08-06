// S052 — in-memory fake Prisma client for application-service unit tests.
// Mirrors the real cash-service schema shape closely enough to exercise
// every service's business logic without a database. Concurrency-sensitive
// primitives (receipt-sequence allocation, active-drawer conflict) are
// modeled faithfully enough to prove the same races the real DB constraints
// guard against — see receipt-sequence-service.test.ts / drawer-service.test.ts.

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
  return {
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
        // composite unique e.g. tenantId_idempotencyKey / tenantId_sourceCode...
        return rows.find((r) => Object.entries(val).every(([k, v]) => (r as any)[k] === v)) ?? null;
      }
      return rows.find((r: any) => r[key] === val) ?? null;
    },
    findUniqueOrThrow: async (args: any) => {
      const found = await (this as any).findUnique?.(args);
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
}

export function makeFakePrisma() {
  const tables = {
    cashDrawer: makeTable('cash_drawer', (rows: any[], data: any) =>
      rows.some(
        (r) =>
          r.tenantId === data.tenantId &&
          r.status !== 'RECONCILED' &&
          ((r.cashierId === data.cashierId && r.storeId === data.storeId) || r.terminalCode === data.terminalCode),
      )
        ? ['cash_drawer_active_cashier_location_uq_or_terminal_uq']
        : null),
    cashReceipt: makeTable('cash_receipt', (rows: any[], data: any) =>
      rows.some((r) => r.tenantId === data.tenantId && r.idempotencyKey === data.idempotencyKey)
        ? ['tenant_id', 'idempotency_key']
        : null),
    cashReceiptTender: makeTable('cash_receipt_tender'),
    cashDrawerMovement: makeTable('cash_drawer_movement'),
    cashBlindCount: makeTable('cash_blind_count'),
    cashBlindCountLine: makeTable('cash_blind_count_line'),
    cashDrawerVariance: makeTable('cash_drawer_variance'),
    cashVarianceApproval: makeTable('cash_variance_approval'),
    cashVarianceToleranceConfig: makeTable('cash_variance_tolerance_config'),
    auditOutboxEvent: makeTable('audit_outbox'),
    cashOutboxEvent: makeTable('cash_outbox_events'),
    cashDeposit: makeTable('cash_deposit', (rows: any[], data: any) =>
      rows.some((r) => r.tenantId === data.tenantId && r.idempotencyKey === data.idempotencyKey)
        ? ['tenant_id', 'idempotency_key']
        : null),
    cashDepositLine: makeTable('cash_deposit_line', (rows: any[], data: any) =>
      rows.some((r) => r.tenantId === data.tenantId && r.receiptId === data.receiptId)
        ? ['tenant_id', 'receipt_id']
        : null),
    bankFeedLine: makeTable('bank_feed_line', (rows: any[], data: any) =>
      rows.some((r) => r.tenantId === data.tenantId && r.bankAccountCode === data.bankAccountCode && data.externalId != null && r.externalId === data.externalId)
        ? ['tenant_id', 'bank_account_code', 'external_id']
        : null),
    settlementBatch: makeTable('settlement_batch', (rows: any[], data: any) =>
      rows.some((r) => r.tenantId === data.tenantId && r.idempotencyKey === data.idempotencyKey)
        ? ['tenant_id', 'idempotency_key']
        : null),
    settlementBatchLine: makeTable('settlement_batch_line'),
    settlementWorklistItem: makeTable('settlement_worklist_item'),
    settlementChargeback: makeTable('settlement_chargeback'),
    settlementAdjustment: makeTable('settlement_adjustment', (rows: any[], data: any) =>
      rows.some((r) => r.chargebackId === data.chargebackId) ? ['chargeback_id'] : null),
    sweepAccountPairConfig: makeTable('sweep_account_pair_config', (rows: any[], data: any) =>
      rows.some((r) => r.tenantId === data.tenantId && r.storeAccountCode === data.storeAccountCode && r.operatingAccountCode === data.operatingAccountCode)
        ? ['tenant_id', 'store_account_code', 'operating_account_code']
        : null),
    zbaSweep: makeTable('zba_sweep', (rows: any[], data: any) =>
      rows.some((r) => r.tenantId === data.tenantId && r.idempotencyKey === data.idempotencyKey)
        ? ['tenant_id', 'idempotency_key']
        : null),
    fpOffsetAllocation: makeTable('fp_offset_allocation', (rows: any[], data: any) =>
      rows.some((r) => r.tenantId === data.tenantId && r.idempotencyKey === data.idempotencyKey)
        ? ['tenant_id', 'idempotency_key']
        : null),
    fpOffsetAllocationLine: makeTable('fp_offset_allocation_line'),
    largeCashThresholdConfig: makeTable('large_cash_threshold_config', (rows: any[], data: any) =>
      rows.some((r) => r.tenantId === data.tenantId && r.jurisdiction === data.jurisdiction)
        ? ['tenant_id', 'jurisdiction']
        : null),
    cashPositionExport: makeTable('cash_position_export'),
  };

  // Give findUniqueOrThrow a real `this` for cashReceipt/cashVarianceApproval etc.
  for (const t of Object.values(tables)) {
    (t as any).findUniqueOrThrow = async (args: any) => {
      const found = await (t as any).findUnique(args);
      if (!found) throw new Error('Row not found (findUniqueOrThrow)');
      return found;
    };
  }

  // cash_receipt.findUnique/findUniqueOrThrow with `include: { tenders: true }`
  // needs to hydrate the relation — wrap.
  const baseReceiptFindUnique = tables.cashReceipt.findUnique;
  const baseReceiptFindFirst = tables.cashReceipt.findFirst;
  const hydrateReceipt = (r: any) => (r ? { ...r, tenders: tables.cashReceiptTender._rows.filter((t: any) => t.receiptId === r.id) } : r);
  (tables.cashReceipt as any).findUnique = async (args: any) => hydrateReceipt(await baseReceiptFindUnique(args));
  (tables.cashReceipt as any).findFirst = async (args: any) => hydrateReceipt(await baseReceiptFindFirst(args));
  (tables.cashReceipt as any).findUniqueOrThrow = async (args: any) => {
    const found = hydrateReceipt(await baseReceiptFindUnique(args));
    if (!found) throw new Error('Row not found (findUniqueOrThrow)');
    return found;
  };
  const baseReceiptFindMany = tables.cashReceipt.findMany;
  (tables.cashReceipt as any).findMany = async (args: any) => (await baseReceiptFindMany(args)).map(hydrateReceipt);

  // cash_deposit.findUnique/findFirst/findMany with `include: { lines: true }`.
  const hydrateDeposit = (r: any) => (r ? { ...r, lines: tables.cashDepositLine._rows.filter((l: any) => l.depositId === r.id) } : r);
  const baseDepositFindUnique = tables.cashDeposit.findUnique;
  const baseDepositFindFirst = tables.cashDeposit.findFirst;
  const baseDepositFindMany = tables.cashDeposit.findMany;
  (tables.cashDeposit as any).findUnique = async (args: any) => hydrateDeposit(await baseDepositFindUnique(args));
  (tables.cashDeposit as any).findFirst = async (args: any) => hydrateDeposit(await baseDepositFindFirst(args));
  (tables.cashDeposit as any).findMany = async (args: any) => (await baseDepositFindMany(args)).map(hydrateDeposit);
  (tables.cashDeposit as any).findUniqueOrThrow = async (args: any) => {
    const found = hydrateDeposit(await baseDepositFindUnique(args));
    if (!found) throw new Error('Row not found (findUniqueOrThrow)');
    return found;
  };

  // settlement_batch.findUnique/findFirst/findMany with `include: { lines: true, chargebacks: true }`.
  const hydrateBatch = (r: any) => (r
    ? {
        ...r,
        lines: tables.settlementBatchLine._rows.filter((l: any) => l.batchId === r.id),
        chargebacks: tables.settlementChargeback._rows.filter((c: any) => c.batchId === r.id),
      }
    : r);
  const baseBatchFindUnique = tables.settlementBatch.findUnique;
  const baseBatchFindFirst = tables.settlementBatch.findFirst;
  const baseBatchFindMany = tables.settlementBatch.findMany;
  (tables.settlementBatch as any).findUnique = async (args: any) => hydrateBatch(await baseBatchFindUnique(args));
  (tables.settlementBatch as any).findFirst = async (args: any) => hydrateBatch(await baseBatchFindFirst(args));
  (tables.settlementBatch as any).findMany = async (args: any) => (await baseBatchFindMany(args)).map(hydrateBatch);
  (tables.settlementBatch as any).findUniqueOrThrow = async (args: any) => {
    const found = hydrateBatch(await baseBatchFindUnique(args));
    if (!found) throw new Error('Row not found (findUniqueOrThrow)');
    return found;
  };

  // fp_offset_allocation.findUnique/findFirst/findMany with `include: { lines: true }`.
  const hydrateFpOffset = (r: any) => (r
    ? { ...r, lines: tables.fpOffsetAllocationLine._rows.filter((l: any) => l.allocationId === r.id) }
    : r);
  const baseFpOffsetFindUnique = tables.fpOffsetAllocation.findUnique;
  const baseFpOffsetFindFirst = tables.fpOffsetAllocation.findFirst;
  const baseFpOffsetFindMany = tables.fpOffsetAllocation.findMany;
  (tables.fpOffsetAllocation as any).findUnique = async (args: any) => hydrateFpOffset(await baseFpOffsetFindUnique(args));
  (tables.fpOffsetAllocation as any).findFirst = async (args: any) => hydrateFpOffset(await baseFpOffsetFindFirst(args));
  (tables.fpOffsetAllocation as any).findMany = async (args: any) => (await baseFpOffsetFindMany(args)).map(hydrateFpOffset);
  (tables.fpOffsetAllocation as any).findUniqueOrThrow = async (args: any) => {
    const found = hydrateFpOffset(await baseFpOffsetFindUnique(args));
    if (!found) throw new Error('Row not found (findUniqueOrThrow)');
    return found;
  };

  const baseBlindCountFindUnique = tables.cashBlindCount.findUnique;  (tables.cashBlindCount as any).findUnique = async (args: any) => {
    const r: any = await baseBlindCountFindUnique(args);
    if (!r) return null;
    return { ...r, lines: tables.cashBlindCountLine._rows.filter((l: any) => l.blindCountId === r.id) };
  };

  const receiptSequences: { tenantId: string; storeId: string; businessDate: string; nextSeq: number }[] = [];

  const client: any = {
    ...tables,
    _tables: tables,
    _receiptSequences: receiptSequences,
    $executeRawUnsafe: async () => undefined,
    $queryRawUnsafe: async (_sql: string, _id: string, tenantId: string, storeId: string, businessDate: string) => {
      const row = receiptSequences.find((r) => r.tenantId === tenantId && r.storeId === storeId && r.businessDate === businessDate);
      if (!row) {
        receiptSequences.push({ tenantId, storeId, businessDate, nextSeq: 2 });
        return [{ claimed: 1 }];
      }
      const claimed = row.nextSeq;
      row.nextSeq += 1;
      return [{ claimed }];
    },
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
