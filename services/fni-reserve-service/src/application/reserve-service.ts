// S091 — Finance Reserve & Flat-% Chargeback Reserve. The INITIAL reserve
// income booking (reserve receivable item, applyNumber=dealNumber) happens
// in deal-accounting-service's S084 journal — NOT here. This service owns:
// (a) lender remittance receipt (relieves that item) + flat-% chargeback-
// reserve accrual, (b) explicit short-pay disposition, (c) actual
// chargeback draws (via the shared ChargebackDrawExecutor).
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/fni-reserve-client';
import { computeChargebackAccrual } from '../domain/chargeback-reserve';
import { toCents, centsToDollarString } from '../domain/money';
import { PostingOrchestrator } from './posting-orchestrator';
import { ChargebackDrawExecutor, ChargebackDrawResult, ChargebackDrawPreview } from './chargeback-draw-executor';
import { ConfigService, ConfigNotFoundError } from './config-service';
import { newEnvelope } from '../infrastructure/posting-client';
import { audit } from '../infrastructure/audit';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import type { IScheduleOpenItemClient } from '../infrastructure/schedule-open-item-client';
import { SCHEDULE_OPEN_ITEM_CLIENT_TOKEN } from './remit-service';

export class ReserveValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ReserveValidationError';
  }
}
export class RemittanceNotFoundError extends Error {
  constructor(id: string) {
    super(`Reserve remittance not found: ${id}`);
    this.name = 'RemittanceNotFoundError';
  }
}
export class NoShortPayError extends Error {
  constructor(id: string) {
    super(`Remittance ${id} has no short-pay amount to disposition.`);
    this.name = 'NoShortPayError';
  }
}
export class DuplicateDispositionError extends Error {
  constructor(id: string) {
    super(`Remittance ${id} has already been dispositioned.`);
    this.name = 'DuplicateDispositionError';
  }
}

export function chargebackControlNumber(lenderProgramCode: string, dealNumber: string): string {
  return `CBR:${lenderProgramCode}:${dealNumber}`;
}

export interface ProcessRemittanceInput {
  dealNumber: string;
  lenderProgramCode: string;
  /** The reserve-income recap figure this remittance is measured against — ENTERED, never re-derived. */
  expectedAmount: string;
  remittedAmount: string;
  idempotencyKey: string;
  actor: string;
  correlationId?: string;
  businessDate?: string;
}

export interface DispositionShortPayInput {
  dispositionType: 'WRITE_OFF_TO_EXPENSE' | 'FLAG_FOR_FOLLOWUP';
  reason: string;
  idempotencyKey: string;
  actor: string;
}

export interface ChargebackNoticeInput {
  dealNumber: string;
  lenderProgramCode: string;
  chargebackAmount: string;
  idempotencyKey: string;
  actor: string;
  correlationId?: string;
  businessDate?: string;
}

@injectable()
export class ReserveService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(PostingOrchestrator) private readonly posting: PostingOrchestrator,
    @inject(ChargebackDrawExecutor) private readonly drawExecutor: ChargebackDrawExecutor,
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(SCHEDULE_OPEN_ITEM_CLIENT_TOKEN) private readonly scheduleClient: IScheduleOpenItemClient,
  ) {}

  async processRemittance(tenantId: string, input: ProcessRemittanceInput) {
    const existing = await this.prisma.reserveRemittance.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing;

    const expectedCents = toCents(input.expectedAmount);
    const remittedCents = toCents(input.remittedAmount);
    if (!Number.isFinite(expectedCents) || expectedCents < 0) throw new ReserveValidationError('INVALID_AMOUNT', 'expectedAmount must be a non-negative decimal amount.');
    if (!Number.isFinite(remittedCents) || remittedCents < 0) throw new ReserveValidationError('INVALID_AMOUNT', 'remittedAmount must be a non-negative decimal amount.');
    const shortPayCents = Math.max(0, expectedCents - remittedCents);

    const correlationId = input.correlationId ?? input.idempotencyKey;
    const businessDate = input.businessDate ?? new Date().toISOString().slice(0, 10);

    let reliefStatus: string | null = null;
    if (remittedCents > 0) {
      const envelope = newEnvelope({
        tenantId,
        eventType: 'fni.reserve-remittance-relief.v1',
        sourceEntityType: 'RESERVE_REMITTANCE',
        sourceEntityId: input.dealNumber,
        sourceTransactionId: input.dealNumber,
        correlationId,
        businessDate,
        payload: { dealNumber: input.dealNumber, lenderProgramCode: input.lenderProgramCode, reliefAmount: centsToDollarString(remittedCents) },
      });
      const outcome = await this.posting.submit(envelope);
      reliefStatus = outcome.submitResult.status;
    }

    // S091(b) — flat-% chargeback reserve accrual, based on the reserve-
    // INCOME figure (expectedAmount, the recap figure), independent of the
    // remittance's own timing/shortfall.
    let accrualId: string | null = null;
    let accrualStatus: string | null = null;
    let accrualAmount = '0.00';
    const lenderConfig = await this.config.resolveLenderProgramConfig(tenantId, input.lenderProgramCode, new Date(businessDate)).catch((err) => {
      if (err instanceof ConfigNotFoundError) return null;
      throw err;
    });
    if (lenderConfig) {
      const computation = computeChargebackAccrual(input.expectedAmount, lenderConfig.chargebackReservePercent.toString());
      accrualAmount = centsToDollarString(computation.accrualCents);
      if (computation.accrualCents > 0) {
        const controlNumber = chargebackControlNumber(input.lenderProgramCode, input.dealNumber);
        const envelope = newEnvelope({
          tenantId,
          eventType: 'fni.chargeback-reserve-accrual.v1',
          sourceEntityType: 'CHARGEBACK_RESERVE_ACCRUAL',
          sourceEntityId: controlNumber,
          sourceTransactionId: input.dealNumber,
          correlationId,
          businessDate,
          payload: { dealNumber: input.dealNumber, lenderProgramCode: input.lenderProgramCode, accrualAmount, controlNumber },
        });
        const outcome = await this.posting.submit(envelope);
        accrualStatus = outcome.submitResult.status;

        const accrualRow = await this.prisma.chargebackReserveAccrual.create({
          data: {
            tenantId,
            dealNumber: input.dealNumber,
            lenderProgramCode: input.lenderProgramCode,
            reserveIncomeAmount: input.expectedAmount,
            accrualPercent: lenderConfig.chargebackReservePercent,
            accrualAmount,
            controlNumber,
            postingExecutionId: outcome.submitResult.executionId ?? null,
            idempotencyKey: `${input.idempotencyKey}-accrual`,
            createdBy: input.actor,
          },
        });
        accrualId = accrualRow.id;
      }
    }

    const created = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const row = await tx.reserveRemittance.create({
        data: {
          tenantId,
          dealNumber: input.dealNumber,
          lenderProgramCode: input.lenderProgramCode,
          expectedAmount: input.expectedAmount,
          remittedAmount: input.remittedAmount,
          shortPayAmount: centsToDollarString(shortPayCents),
          cashOriginationLinkageStatus: 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION',
          idempotencyKey: input.idempotencyKey,
          accrualId,
          status: reliefStatus === 'REJECTED' || reliefStatus === 'FAILED' ? 'POSTING_FAILED' : 'PROCESSED',
          createdBy: input.actor,
        },
      });
      await audit(tx, tenantId, 'RESERVE_REMITTANCE', row.id, 'PROCESSED', input.actor, null, {
        expectedAmount: input.expectedAmount,
        remittedAmount: input.remittedAmount,
        shortPayAmount: row.shortPayAmount.toString(),
        reliefStatus,
        accrualStatus,
        accrualAmount,
      }, input.correlationId);
      return row;
    });
    return created;
  }

  async dispositionShortPay(tenantId: string, remittanceId: string, dto: DispositionShortPayInput) {
    const remittance = await this.prisma.reserveRemittance.findFirst({ where: { id: remittanceId, tenantId } });
    if (!remittance) throw new RemittanceNotFoundError(remittanceId);
    if (toCents(remittance.shortPayAmount.toString()) <= 0) throw new NoShortPayError(remittanceId);

    const existing = await this.prisma.remittanceShortPayDisposition.findFirst({ where: { tenantId, remittanceId } });
    if (existing) {
      if (existing.idempotencyKey === dto.idempotencyKey) return existing;
      throw new DuplicateDispositionError(remittanceId);
    }

    let postingExecutionId: string | null = null;
    if (dto.dispositionType === 'WRITE_OFF_TO_EXPENSE') {
      const envelope = newEnvelope({
        tenantId,
        eventType: 'fni.reserve-shortpay-writeoff.v1',
        sourceEntityType: 'RESERVE_REMITTANCE',
        sourceEntityId: remittance.dealNumber,
        sourceTransactionId: remittance.dealNumber,
        correlationId: dto.idempotencyKey,
        businessDate: new Date().toISOString().slice(0, 10),
        payload: { dealNumber: remittance.dealNumber, lenderProgramCode: remittance.lenderProgramCode, shortPayAmount: remittance.shortPayAmount.toString() },
      });
      const outcome = await this.posting.submit(envelope);
      postingExecutionId = outcome.submitResult.executionId ?? null;
    } else if (dto.dispositionType !== 'FLAG_FOR_FOLLOWUP') {
      throw new ReserveValidationError('INVALID_DISPOSITION_TYPE', `Unknown dispositionType: ${dto.dispositionType}`);
    }

    const created = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const row = await tx.remittanceShortPayDisposition.create({
        data: {
          tenantId,
          remittanceId,
          dispositionType: dto.dispositionType,
          amount: remittance.shortPayAmount,
          reason: dto.reason,
          postingExecutionId,
          idempotencyKey: dto.idempotencyKey,
          createdBy: dto.actor,
        },
      });
      await audit(tx, tenantId, 'REMITTANCE_SHORTPAY_DISPOSITION', row.id, 'DISPOSITIONED', dto.actor, null, row);
      return row;
    });
    return created;
  }

  /** S091(c) — an actual chargeback, triggered by an early-payoff notice. */
  async processChargebackNotice(tenantId: string, input: ChargebackNoticeInput): Promise<ChargebackDrawResult> {
    const controlNumber = chargebackControlNumber(input.lenderProgramCode, input.dealNumber);
    return this.drawExecutor.execute(tenantId, {
      dealNumber: input.dealNumber,
      lenderProgramCode: input.lenderProgramCode,
      controlNumber,
      chargebackAmount: input.chargebackAmount,
      sourceType: 'EARLY_PAYOFF',
      idempotencyKey: input.idempotencyKey,
      actor: input.actor,
      correlationId: input.correlationId,
      businessDate: input.businessDate,
    });
  }

  /**
   * Dry-run preview for POST /chargebacks — same request shape, computes
   * and returns the drawn-from-reserve / excess-to-expense split WITHOUT
   * posting or persisting anything. Delegates to ChargebackDrawExecutor's
   * own preview() — the SAME balance lookup + computeChargebackDraw() call
   * processChargebackNotice() above uses at posting time via
   * ChargebackDrawExecutor#execute(), so preview and reality can never drift
   * (proved by tests/unit/preview-parity.test.ts).
   */
  async previewChargebackNotice(tenantId: string, input: ChargebackNoticeInput): Promise<ChargebackDrawPreview> {
    const controlNumber = chargebackControlNumber(input.lenderProgramCode, input.dealNumber);
    return this.drawExecutor.preview(tenantId, controlNumber, input.chargebackAmount);
  }

  async listAccruals(tenantId: string, filters: { dealNumber?: string; lenderProgramCode?: string }, page: number, pageSize: number) {
    const where = { tenantId, ...(filters.dealNumber ? { dealNumber: filters.dealNumber } : {}), ...(filters.lenderProgramCode ? { lenderProgramCode: filters.lenderProgramCode } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.chargebackReserveAccrual.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.chargebackReserveAccrual.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async listDraws(tenantId: string, filters: { dealNumber?: string; lenderProgramCode?: string }, page: number, pageSize: number) {
    const where = { tenantId, ...(filters.dealNumber ? { dealNumber: filters.dealNumber } : {}), ...(filters.lenderProgramCode ? { lenderProgramCode: filters.lenderProgramCode } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.chargebackDraw.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.chargebackDraw.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async getRemittance(tenantId: string, id: string) {
    const row = await this.prisma.reserveRemittance.findFirst({ where: { id, tenantId }, include: { dispositions: true } });
    if (!row) throw new RemittanceNotFoundError(id);
    return row;
  }

  async listRemittances(tenantId: string, dealNumber?: string) {
    return this.prisma.reserveRemittance.findMany({ where: { tenantId, ...(dealNumber ? { dealNumber } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * S091 AC: "your chargeback-reserve liability GL balance ties to
   * Σ(your own accrual records) − Σ(your own draw records) exactly ($0
   * variance)" — the tie-out inquiry endpoint. Grouped by controlNumber
   * (one per lender-program+deal accrual lineage) and totaled.
   */
  async tieOutChargebackReserve(tenantId: string, lenderProgramCode?: string) {
    const [accruals, draws] = await Promise.all([
      this.prisma.chargebackReserveAccrual.findMany({ where: { tenantId, ...(lenderProgramCode ? { lenderProgramCode } : {}) } }),
      this.prisma.chargebackDraw.findMany({ where: { tenantId, ...(lenderProgramCode ? { lenderProgramCode } : {}) } }),
    ]);
    const byControl = new Map<string, { accrued: number; drawn: number }>();
    for (const a of accruals as any[]) {
      const e = byControl.get(a.controlNumber) ?? { accrued: 0, drawn: 0 };
      e.accrued += toCents(a.accrualAmount.toString());
      byControl.set(a.controlNumber, e);
    }
    for (const d of draws as any[]) {
      const e = byControl.get(d.controlNumber) ?? { accrued: 0, drawn: 0 };
      e.drawn += toCents(d.drawFromReserveAmount.toString());
      byControl.set(d.controlNumber, e);
    }
    const lines = Array.from(byControl.entries()).map(([controlNumber, e]) => ({
      controlNumber,
      accruedTotal: centsToDollarString(e.accrued),
      drawnTotal: centsToDollarString(e.drawn),
      remainingBalance: centsToDollarString(e.accrued - e.drawn),
    }));
    const totalAccrued = lines.reduce((s, l) => s + toCents(l.accruedTotal), 0);
    const totalDrawn = lines.reduce((s, l) => s + toCents(l.drawnTotal), 0);

    // CE-12 gap-closure — schedule-service schedule 95's real open items are
    // the AUTHORITATIVE GL-facing balance now (local lines/totals above
    // remain as lineage/audit detail). Null only when no
    // CHARGEBACK_RESERVE_LIABILITY mapping has been configured for this
    // tenant yet — never fabricated.
    const mapping = await this.config.getScheduleMapping(tenantId, 'CHARGEBACK_RESERVE_LIABILITY');
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
      lines,
      totalAccrued: centsToDollarString(totalAccrued),
      totalDrawn: centsToDollarString(totalDrawn),
      totalRemainingBalance: centsToDollarString(totalAccrued - totalDrawn),
      scheduleTieOut,
    };
  }
}
