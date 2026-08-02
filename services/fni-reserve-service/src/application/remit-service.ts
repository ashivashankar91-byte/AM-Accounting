// S092 — F&I Product Income & Remit Accrual. Initial income/remit-liability
// booking happens in deal-accounting-service's S084 journal — NOT here.
// This service owns: the remittance RUN (batches matched remit-liability
// items to a provider payment), provider-statement reconciliation, and its
// own local RemitLiabilityTracking cache (populated either by explicit
// registration — POST /remit-liability/register, the documented companion
// to the S094 deferral-booking registration contract — or, as a best-effort
// fallback, by first-observation during a remit run).
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/fni-reserve-client';
import { toCents, centsToDollarString } from '../domain/money';
import { PostingOrchestrator } from './posting-orchestrator';
import { newEnvelope } from '../infrastructure/posting-client';
import { audit } from '../infrastructure/audit';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { ConfigService } from './config-service';
import type { IScheduleOpenItemClient } from '../infrastructure/schedule-open-item-client';

export const SCHEDULE_OPEN_ITEM_CLIENT_TOKEN = 'IScheduleOpenItemClient';

export class RemitValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'RemitValidationError';
  }
}
export class RemitRunNotFoundError extends Error {
  constructor(id: string) {
    super(`Product remit run not found: ${id}`);
    this.name = 'RemitRunNotFoundError';
  }
}

export function remitApplyControlNumber(dealNumber: string, productCode: string): string {
  return `${dealNumber}:${productCode}`;
}

export interface RemitRunItemInput {
  dealNumber: string;
  productCode: string;
  amount: string;
}

export interface ExecuteRemitRunInput {
  providerCode: string;
  runDate: string;
  items: RemitRunItemInput[];
  idempotencyKey: string;
  actor: string;
  correlationId?: string;
}

@injectable()
export class RemitService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(PostingOrchestrator) private readonly posting: PostingOrchestrator,
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(SCHEDULE_OPEN_ITEM_CLIENT_TOKEN) private readonly scheduleClient: IScheduleOpenItemClient,
  ) {}

  /** Companion to S094's deferral-booking registration contract — lets
   *  deal-accounting-service (or any caller) tell this service a new remit-
   *  liability item now exists, so the "unremitted liability" tie-out has
   *  an accurate ORIGINAL figure to reconcile against (not just whatever
   *  this service has itself observed during a remit run). */
  async registerRemitLiability(
    tenantId: string,
    dto: { dealNumber: string; productCode: string; providerCode: string; glAccountNumber: string; scheduleNumber: string; originalAmount: string; actor: string },
  ) {
    return this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const row = await tx.remitLiabilityTracking.upsert({
        where: { tenantId_dealNumber_productCode: { tenantId, dealNumber: dto.dealNumber, productCode: dto.productCode } },
        create: {
          tenantId,
          dealNumber: dto.dealNumber,
          productCode: dto.productCode,
          providerCode: dto.providerCode,
          glAccountNumber: dto.glAccountNumber,
          scheduleNumber: dto.scheduleNumber,
          originalAmount: dto.originalAmount,
          remainingAmount: dto.originalAmount,
          status: 'OPEN',
        },
        update: {},
      });
      await audit(tx, tenantId, 'REMIT_LIABILITY_TRACKING', row.id, 'REGISTERED', dto.actor, null, row);
      return row;
    });
  }

  async executeRemitRun(tenantId: string, input: ExecuteRemitRunInput) {
    const existing = await this.prisma.productRemitRun.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return this.getRemitRun(tenantId, existing.id);

    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new RemitValidationError('EMPTY_RUN', 'A remit run must contain at least one item.');
    }
    let totalCents = 0;
    for (const item of input.items) {
      const cents = toCents(item.amount);
      if (!Number.isFinite(cents) || cents <= 0) {
        throw new RemitValidationError('INVALID_AMOUNT', `Item amount for deal ${item.dealNumber} product ${item.productCode} must be a positive decimal amount.`);
      }
      totalCents += cents;
    }

    const correlationId = input.correlationId ?? input.idempotencyKey;
    const businessDate = input.runDate.slice(0, 10);

    const run = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const r = await tx.productRemitRun.create({
        data: {
          tenantId,
          providerCode: input.providerCode,
          runDate: new Date(input.runDate),
          totalAmount: centsToDollarString(totalCents),
          paymentRailLinkageStatus: 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION',
          idempotencyKey: input.idempotencyKey,
          createdBy: input.actor,
        },
      });
      await audit(tx, tenantId, 'PRODUCT_REMIT_RUN', r.id, 'CREATED', input.actor, null, { providerCode: input.providerCode, totalAmount: r.totalAmount.toString(), itemCount: input.items.length }, input.correlationId);
      return r;
    });

    for (const item of input.items) {
      const applyControlNumber = remitApplyControlNumber(item.dealNumber, item.productCode);
      const envelope = newEnvelope({
        tenantId,
        eventType: 'fni.product-remit-relief.v1',
        sourceEntityType: 'PRODUCT_REMIT_RUN_ITEM',
        sourceEntityId: applyControlNumber,
        sourceTransactionId: item.dealNumber,
        correlationId,
        causationId: run.id,
        businessDate,
        payload: { dealNumber: item.dealNumber, productCode: item.productCode, providerCode: input.providerCode, amount: item.amount, applyControlNumber },
      });
      const outcome = await this.posting.submit(envelope);

      await this.prisma.productRemitRunItem.create({
        data: {
          tenantId,
          runId: run.id,
          dealNumber: item.dealNumber,
          productCode: item.productCode,
          amount: item.amount,
          applyControlNumber,
          postingExecutionId: outcome.submitResult.executionId ?? null,
          status: outcome.failed ? 'POSTING_FAILED' : 'RELIEVED',
        },
      });

      // Best-effort local tracking cache update — see class-level doc.
      await this._closeOrCreateTracking(tenantId, item, input.providerCode);
    }

    return this.getRemitRun(tenantId, run.id);
  }

  private async _closeOrCreateTracking(tenantId: string, item: RemitRunItemInput, providerCode: string) {
    const mapping = await this.config.getScheduleMapping(tenantId, 'PRODUCT_REMIT_LIABILITY');
    const existing = await this.prisma.remitLiabilityTracking.findUnique({
      where: { tenantId_dealNumber_productCode: { tenantId, dealNumber: item.dealNumber, productCode: item.productCode } },
    });
    const amountCents = toCents(item.amount);
    if (existing) {
      const newRemaining = Math.max(0, toCents(existing.remainingAmount.toString()) - amountCents);
      await this.prisma.remitLiabilityTracking.update({
        where: { id: existing.id },
        data: { remainingAmount: centsToDollarString(newRemaining), status: newRemaining === 0 ? 'CLOSED' : 'OPEN', lastSyncedAt: new Date() },
      });
    } else {
      // First observation of this item — best-effort: this run's amount is
      // treated as the full original+relief in one step (documented
      // limitation: without an explicit registerRemitLiability() call, this
      // service cannot know a TRUE original amount larger than what it has
      // itself observed being relieved).
      await this.prisma.remitLiabilityTracking.create({
        data: {
          tenantId,
          dealNumber: item.dealNumber,
          productCode: item.productCode,
          providerCode,
          glAccountNumber: mapping?.glAccountNumber ?? 'UNKNOWN',
          scheduleNumber: mapping?.scheduleNumber ?? 'UNKNOWN',
          originalAmount: item.amount,
          remainingAmount: '0.00',
          status: 'CLOSED',
        },
      });
    }
  }

  async getRemitRun(tenantId: string, id: string) {
    const row = await this.prisma.productRemitRun.findFirst({ where: { id, tenantId }, include: { items: true } });
    if (!row) throw new RemitRunNotFoundError(id);
    return row;
  }

  async listRemitRuns(tenantId: string, providerCode?: string) {
    return this.prisma.productRemitRun.findMany({ where: { tenantId, ...(providerCode ? { providerCode } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  // ── Provider statement reconciliation (ENTERED evidence only) ────────────
  async uploadProviderStatement(
    tenantId: string,
    dto: { providerCode: string; statementDate: string; lines: Array<{ dealNumber: string; productCode: string; statementAmount: string }>; actor: string },
  ) {
    const reconciliation = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const recon = await tx.providerStatementReconciliation.create({
        data: { tenantId, providerCode: dto.providerCode, statementDate: new Date(dto.statementDate), uploadedBy: dto.actor },
      });

      for (const line of dto.lines) {
        const ourItems = await tx.productRemitRunItem.findMany({
          where: { tenantId, dealNumber: line.dealNumber, productCode: line.productCode, status: 'RELIEVED' },
        });
        const ourRemittedCents = ourItems.reduce((sum: number, i: any) => sum + toCents(i.amount.toString()), 0);
        const statementCents = toCents(line.statementAmount);
        const varianceCents = statementCents - ourRemittedCents;
        await tx.providerStatementLine.create({
          data: {
            tenantId,
            reconciliationId: recon.id,
            dealNumber: line.dealNumber,
            productCode: line.productCode,
            statementAmount: line.statementAmount,
            ourRemittedAmount: centsToDollarString(ourRemittedCents),
            variance: centsToDollarString(varianceCents),
            status: varianceCents === 0 ? 'MATCHED' : 'VARIANCE_FLAGGED',
          },
        });
      }
      await audit(tx, tenantId, 'PROVIDER_STATEMENT_RECONCILIATION', recon.id, 'UPLOADED', dto.actor, null, { providerCode: dto.providerCode, lineCount: dto.lines.length });
      return recon;
    });
    return this.getReconciliation(tenantId, reconciliation.id);
  }

  async getReconciliation(tenantId: string, id: string) {
    return this.prisma.providerStatementReconciliation.findFirst({ where: { id, tenantId }, include: { lines: true } });
  }

  async listReconciliations(tenantId: string, providerCode?: string) {
    return this.prisma.providerStatementReconciliation.findMany({ where: { tenantId, ...(providerCode ? { providerCode } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  /** Review/disposition a flagged variance — NEVER auto-adjusts, just records the human review. */
  async reviewVarianceLine(tenantId: string, lineId: string, dto: { reviewNote: string; actor: string }) {
    const line = await this.prisma.providerStatementLine.findFirst({ where: { id: lineId, tenantId } });
    if (!line) throw new RemitValidationError('LINE_NOT_FOUND', `Provider statement line not found: ${lineId}`);
    const updated = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const row = await tx.providerStatementLine.update({
        where: { id: lineId },
        data: { status: 'REVIEWED', reviewedBy: dto.actor, reviewNote: dto.reviewNote, reviewedAt: new Date() },
      });
      await audit(tx, tenantId, 'PROVIDER_STATEMENT_LINE', lineId, 'REVIEWED', dto.actor, { status: line.status }, { status: 'REVIEWED', reviewNote: dto.reviewNote });
      return row;
    });
    return updated;
  }

  /**
   * S092 AC: "unremitted liability = Σ open items". Local tracking rows
   * (this service's own cache, populated by registerRemitLiability/remit
   * runs) remain as lineage/audit detail below; CE-12 gap-closure adds
   * `scheduleTieOut` — schedule-service schedule 94's real open items
   * (PRODUCT_REMIT_LIABILITY mapping), the AUTHORITATIVE GL-facing balance.
   * null only when no mapping has been configured for this tenant yet.
   */
  async tieOutRemitLiability(tenantId: string, providerCode?: string) {
    const rows = await this.prisma.remitLiabilityTracking.findMany({
      where: { tenantId, status: 'OPEN', ...(providerCode ? { providerCode } : {}) },
    });
    const totalCents = rows.reduce((sum: number, r: any) => sum + toCents(r.remainingAmount.toString()), 0);

    const mapping = await this.config.getScheduleMapping(tenantId, 'PRODUCT_REMIT_LIABILITY');
    let scheduleTieOut: { scheduleNumber: string; openItemCount: number; totalRemainingBalance: string; source: 'SCHEDULE_SERVICE' } | null = null;
    if (mapping) {
      const items = await this.scheduleClient.listOpenItems(tenantId, mapping.scheduleNumber);
      const remainingCents = items.reduce((s, i) => s + toCents(i.remainingBalance), 0);
      scheduleTieOut = {
        scheduleNumber: mapping.scheduleNumber,
        openItemCount: items.length,
        totalRemainingBalance: centsToDollarString(remainingCents),
        source: 'SCHEDULE_SERVICE',
      };
    }

    return {
      openItems: rows.map((r: any) => ({ dealNumber: r.dealNumber, productCode: r.productCode, providerCode: r.providerCode, remainingAmount: r.remainingAmount.toString() })),
      totalOpenAmount: centsToDollarString(totalCents),
      scheduleTieOut,
    };
  }
}
