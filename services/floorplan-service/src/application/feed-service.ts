// S079 — Floorplan Lender Feed Adapters: staged evidence rows. Feed rows
// land as STAGED evidence — never auto-post (S080's match-service is the
// only thing that turns a staged row into a posting, and only for
// MATCHED/DISPOSITIONED rows). Rows are immutable once created: this file
// has no update method for an existing row's own fields — correcting a row
// means superseding it via supersedeRow(), which creates a NEW row in a NEW
// import batch and marks the old row SUPERSEDED (an audited status
// transition, not a field edit).
import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'crypto';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAuditReference } from '../infrastructure/audit';
import { FloorplanValidationError, FloorplanNotFoundError, FeedNotConfiguredError, StagedRowImmutableError } from '../domain/errors';
import { LenderService } from './lender-service';

export const ROW_TYPES = ['ADVANCE', 'PAYOFF'] as const;
export type RowType = (typeof ROW_TYPES)[number];

export interface StagedRowInput {
  rowType: RowType;
  vin?: string | null;
  stockNumber?: string | null;
  amount: string;
  statementDate: string;
  referenceNumber?: string | null;
}

function validateRow(row: StagedRowInput) {
  if (!ROW_TYPES.includes(row.rowType)) throw new FloorplanValidationError(`Invalid rowType: ${row.rowType}`);
  if (!row.vin?.trim() && !row.stockNumber?.trim()) {
    throw new FloorplanValidationError('Each staged row requires a vin or stockNumber (or both) to key the unit.');
  }
  if (!row.amount || Number.isNaN(Number(row.amount)) || Number(row.amount) <= 0) {
    throw new FloorplanValidationError(`amount must be a positive decimal string, got: ${row.amount}`);
  }
  if (!row.statementDate) throw new FloorplanValidationError('statementDate is required.');
}

@injectable()
export class FeedService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    private readonly lenderService: LenderService,
  ) {}

  /** The feed (adapter) import path — requires the lender's adapter to be
   * CONFIGURED. Rows are supplied by the caller (a certification harness or
   * an operator-triggered fixture pull) — this service never invents VINs
   * or dollar amounts; fixtureLabel makes clear the batch is a deterministic
   * fixture, never live vendor data (no real vendor is integrated). */
  async importFeedBatch(tenantId: string, lenderCode: string, input: { rows: StagedRowInput[]; fixtureLabel: string }, actor: string) {
    const lender = await this.lenderService.feedStatus(tenantId, lenderCode);
    if (lender.adapterStatus !== 'CONFIGURED') {
      throw new FeedNotConfiguredError(lenderCode);
    }
    if (!input.fixtureLabel?.trim()) {
      throw new FloorplanValidationError('fixtureLabel is required for a FEED import (must clearly label the deterministic fixture source).');
    }
    return this._importBatch(tenantId, lenderCode, 'FEED', input.rows, actor, input.fixtureLabel, null);
  }

  /** The manual entry path — ALWAYS usable, regardless of adapterStatus.
   * This is the S079 AC's central guarantee: never gated by adapter wiring. */
  async importManualBatch(tenantId: string, lenderCode: string, input: { rows: StagedRowInput[]; note?: string }, actor: string) {
    return this._importBatch(tenantId, lenderCode, 'MANUAL', input.rows, actor, null, input.note ?? null);
  }

  private async _importBatch(
    tenantId: string,
    lenderCode: string,
    sourceType: 'FEED' | 'MANUAL',
    rows: StagedRowInput[],
    actor: string,
    fixtureLabel: string | null,
    note: string | null,
  ) {
    if (!rows || rows.length === 0) throw new FloorplanValidationError('At least one row is required to import a batch.');
    rows.forEach(validateRow);

    const batchId = randomUUID();
    const created = await this.prisma.$transaction(async (tx: any) => {
      // CE-12 gap-close fix: an interactive $transaction is pinned to its
      // OWN dedicated connection, separate from whichever pooled
      // connection the RLS middleware's app.current_tenant_id SET most
      // recently landed on — must be the first statement, exactly like
      // schedule-service's OpenItemService does.
      await setTenantContextOnConnection(tx, tenantId);
      const batch = await tx.floorplanImportBatch.create({
        data: { id: batchId, tenantId, lenderCode, sourceType, fixtureLabel, note, rowCount: rows.length, importedBy: actor },
      });
      const stagedRows = [];
      for (const row of rows) {
        stagedRows.push(
          await tx.floorplanStagedRow.create({
            data: {
              id: randomUUID(),
              tenantId,
              lenderCode,
              importBatchId: batch.id,
              rowType: row.rowType,
              vin: row.vin ?? null,
              stockNumber: row.stockNumber ?? null,
              amount: row.amount,
              statementDate: new Date(row.statementDate),
              referenceNumber: row.referenceNumber ?? null,
              sourceType,
              status: 'STAGED',
              createdBy: actor,
            },
          }),
        );
      }
      return { batch, stagedRows };
    });

    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_IMPORT_BATCH',
      entityId: created.batch.id,
      eventType: 'floorplan.import_batch.created',
      actor,
      after: { batchId: created.batch.id, lenderCode, sourceType, rowCount: rows.length, fixtureLabel, note },
    });

    return created;
  }

  async listStagedRows(tenantId: string, filters: { lenderCode?: string; status?: string; vin?: string; stockNumber?: string }) {
    return this.prisma.floorplanStagedRow.findMany({
      where: {
        tenantId,
        ...(filters.lenderCode ? { lenderCode: filters.lenderCode } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.vin ? { vin: filters.vin } : {}),
        ...(filters.stockNumber ? { stockNumber: filters.stockNumber } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStagedRow(tenantId: string, rowId: string) {
    const row = await this.prisma.floorplanStagedRow.findFirst({ where: { tenantId, id: rowId } });
    if (!row) throw new FloorplanNotFoundError(`No staged row ${rowId}.`);
    return row;
  }

  async listImportBatches(tenantId: string, lenderCode?: string) {
    return this.prisma.floorplanImportBatch.findMany({
      where: { tenantId, ...(lenderCode ? { lenderCode } : {}) },
      orderBy: { importedAt: 'desc' },
    });
  }

  /** Corrects a staged row by superseding it: the original row is marked
   * SUPERSEDED (never edited in place) and a brand-new row is created in a
   * brand-new (MANUAL, by definition a correction) import batch, chained via
   * supersedesRowId. Both the old and new row remain in the immutable
   * evidence trail. */
  async supersedeRow(tenantId: string, rowId: string, replacement: StagedRowInput, actor: string, note?: string) {
    const original = await this.getStagedRow(tenantId, rowId);
    if (original.status === 'SUPERSEDED') throw new StagedRowImmutableError(rowId);
    if (original.status === 'MATCHED' || original.status === 'DISPOSITIONED') {
      throw new FloorplanValidationError(`Staged row ${rowId} has already been ${original.status.toLowerCase()} and cannot be superseded — dispute via a break disposition instead.`);
    }
    validateRow(replacement);

    const result = await this.prisma.$transaction(async (tx: any) => {
      // CE-12 gap-close fix — see _importBatch's identical call above.
      await setTenantContextOnConnection(tx, tenantId);
      const batch = await tx.floorplanImportBatch.create({
        data: {
          id: randomUUID(),
          tenantId,
          lenderCode: original.lenderCode,
          sourceType: 'MANUAL',
          fixtureLabel: null,
          note: note ?? `Supersedes staged row ${rowId}`,
          rowCount: 1,
          importedBy: actor,
        },
      });
      const newRow = await tx.floorplanStagedRow.create({
        data: {
          id: randomUUID(),
          tenantId,
          lenderCode: original.lenderCode,
          importBatchId: batch.id,
          rowType: replacement.rowType,
          vin: replacement.vin ?? null,
          stockNumber: replacement.stockNumber ?? null,
          amount: replacement.amount,
          statementDate: new Date(replacement.statementDate),
          referenceNumber: replacement.referenceNumber ?? null,
          sourceType: 'MANUAL',
          status: 'STAGED',
          supersedesRowId: rowId,
          createdBy: actor,
        },
      });
      const supersededOriginal = await tx.floorplanStagedRow.update({
        where: { id: rowId },
        data: { status: 'SUPERSEDED' },
      });
      return { newRow, supersededOriginal };
    });

    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_STAGED_ROW',
      entityId: rowId,
      eventType: 'floorplan.staged_row.superseded',
      actor,
      before: original,
      after: { supersededBy: result.newRow.id },
    });

    return result;
  }
}
