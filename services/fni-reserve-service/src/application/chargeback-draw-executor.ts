// S091(c) + S093 shared chargeback-draw EXECUTION (posting + persistence).
// This is the single application-layer entry point both the S091
// actual-chargeback endpoint and the S093 cancellation ceremony call — never
// duplicated/diverged, per the epic package's explicit requirement. The
// underlying math is domain/chargeback-reserve.ts#computeChargebackDraw,
// itself called from exactly one place: this file.
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/fni-reserve-client';
import { computeChargebackDraw } from '../domain/chargeback-reserve';
import { centsToDollarString, toCents } from '../domain/money';
import { PostingOrchestrator } from './posting-orchestrator';
import { newEnvelope } from '../infrastructure/posting-client';
import { audit } from '../infrastructure/audit';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';

export class ChargebackDrawValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ChargebackDrawValidationError';
  }
}

export interface ChargebackDrawInput {
  dealNumber: string;
  lenderProgramCode: string;
  /** This service's own chargeback-reserve control number, the SAME value
   *  the accrual leg originated it under (CBR:{lenderProgramCode}:{dealNumber}). */
  controlNumber: string;
  chargebackAmount: string;
  sourceType: 'EARLY_PAYOFF' | 'CANCELLATION';
  sourceCancellationId?: string | null;
  idempotencyKey: string;
  actor: string;
  correlationId?: string;
  businessDate?: string;
}

export interface ChargebackDrawResult {
  drawId: string;
  chargebackAmount: string;
  drawFromReserveAmount: string;
  excessToExpenseAmount: string;
  reserveBalanceBefore: string;
  reserveBalanceAfter: string;
  postingStatus: { drawLeg?: string; excessLeg?: string };
}

export interface ChargebackDrawPreview {
  preview: true;
  controlNumber: string;
  chargebackAmount: string;
  reserveBalanceBefore: string;
  drawFromReserveAmount: string;
  excessToExpenseAmount: string;
  reserveBalanceAfter: string;
}

@injectable()
export class ChargebackDrawExecutor {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(PostingOrchestrator) private readonly posting: PostingOrchestrator,
  ) {}

  /** Sum of accruals minus sum of draws for this control number — the
   *  current chargeback-reserve liability balance, computed purely from
   *  this service's OWN records (the basis for the S091 tie-out AC). */
  async currentReserveBalance(tenantId: string, controlNumber: string): Promise<string> {
    const [accruals, draws] = await Promise.all([
      this.prisma.chargebackReserveAccrual.findMany({ where: { tenantId, controlNumber } }),
      this.prisma.chargebackDraw.findMany({ where: { tenantId, controlNumber } }),
    ]);
    const accrued = accruals.reduce((sum: number, a: any) => sum + toCents(a.accrualAmount.toString()), 0);
    const drawn = draws.reduce((sum: number, d: any) => sum + toCents(d.drawFromReserveAmount.toString()), 0);
    return centsToDollarString(accrued - drawn);
  }

  /**
   * Dry-run preview — computes the EXACT SAME split execute() below would
   * produce (same currentReserveBalance() lookup + the same shared
   * computeChargebackDraw()), but never submits a posting event and never
   * persists a ChargebackDraw row. This is the single computation both
   * ReserveService#previewChargebackNotice (S091c) and
   * CancellationService's cancellation preview (S093, when a chargeback is
   * triggered) delegate to — guaranteeing preview/execute parity by
   * construction, not by convention.
   */
  async preview(tenantId: string, controlNumber: string, chargebackAmount: string): Promise<ChargebackDrawPreview> {
    const reserveBalanceBefore = await this.currentReserveBalance(tenantId, controlNumber);
    const computation = computeChargebackDraw(chargebackAmount, reserveBalanceBefore);
    return {
      preview: true,
      controlNumber,
      chargebackAmount: centsToDollarString(computation.chargebackAmountCents),
      reserveBalanceBefore: centsToDollarString(computation.reserveBalanceBeforeCents),
      drawFromReserveAmount: centsToDollarString(computation.drawFromReserveCents),
      excessToExpenseAmount: centsToDollarString(computation.excessToExpenseCents),
      reserveBalanceAfter: centsToDollarString(computation.reserveBalanceBeforeCents - computation.drawFromReserveCents),
    };
  }

  async execute(tenantId: string, input: ChargebackDrawInput): Promise<ChargebackDrawResult> {
    const existing = await this.prisma.chargebackDraw.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      return this._toResult(existing, { drawLeg: 'IDEMPOTENT_REPLAY', excessLeg: 'IDEMPOTENT_REPLAY' });
    }

    const reserveBalanceBefore = await this.currentReserveBalance(tenantId, input.controlNumber);
    const computation = computeChargebackDraw(input.chargebackAmount, reserveBalanceBefore);

    const correlationId = input.correlationId ?? input.idempotencyKey;
    const businessDate = input.businessDate ?? new Date().toISOString().slice(0, 10);
    const postingStatus: { drawLeg?: string; excessLeg?: string } = {};

    if (computation.drawFromReserveCents > 0) {
      const envelope = newEnvelope({
        tenantId,
        eventType: 'fni.chargeback-draw-from-reserve.v1',
        sourceEntityType: 'CHARGEBACK_DRAW',
        sourceEntityId: input.controlNumber,
        sourceTransactionId: input.dealNumber,
        correlationId,
        businessDate,
        payload: {
          dealNumber: input.dealNumber,
          lenderProgramCode: input.lenderProgramCode,
          controlNumber: input.controlNumber,
          drawFromReserveAmount: centsToDollarString(computation.drawFromReserveCents),
        },
      });
      const outcome = await this.posting.submit(envelope);
      postingStatus.drawLeg = outcome.submitResult.status;
    }

    if (computation.excessToExpenseCents > 0) {
      const envelope = newEnvelope({
        tenantId,
        eventType: 'fni.chargeback-draw-excess-expense.v1',
        sourceEntityType: 'CHARGEBACK_DRAW',
        sourceEntityId: input.controlNumber,
        sourceTransactionId: input.dealNumber,
        correlationId,
        businessDate,
        payload: {
          dealNumber: input.dealNumber,
          lenderProgramCode: input.lenderProgramCode,
          excessToExpenseAmount: centsToDollarString(computation.excessToExpenseCents),
        },
      });
      const outcome = await this.posting.submit(envelope);
      postingStatus.excessLeg = outcome.submitResult.status;
    }

    const created = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const row = await tx.chargebackDraw.create({
        data: {
          tenantId,
          dealNumber: input.dealNumber,
          lenderProgramCode: input.lenderProgramCode,
          controlNumber: input.controlNumber,
          chargebackAmount: centsToDollarString(computation.chargebackAmountCents),
          drawFromReserveAmount: centsToDollarString(computation.drawFromReserveCents),
          excessToExpenseAmount: centsToDollarString(computation.excessToExpenseCents),
          reserveBalanceBefore,
          sourceType: input.sourceType,
          sourceCancellationId: input.sourceCancellationId ?? null,
          idempotencyKey: input.idempotencyKey,
          createdBy: input.actor,
        },
      });
      await audit(tx, tenantId, 'CHARGEBACK_DRAW', row.id, 'DRAWN', input.actor, null, {
        chargebackAmount: row.chargebackAmount.toString(),
        drawFromReserveAmount: row.drawFromReserveAmount.toString(),
        excessToExpenseAmount: row.excessToExpenseAmount.toString(),
        postingStatus,
      }, input.correlationId);
      return row;
    });

    return this._toResult(created, postingStatus);
  }

  // Prisma's Decimal#toString() (decimal.js) strips trailing zeros (e.g.
  // "200" rather than "200.00") — always re-normalize through
  // toCents/centsToDollarString for API-facing output fields, never return
  // a raw Decimal#toString() for a money field.
  private _toResult(row: any, postingStatus: { drawLeg?: string; excessLeg?: string }): ChargebackDrawResult {
    const before = toCents(row.reserveBalanceBefore.toString());
    const drawn = toCents(row.drawFromReserveAmount.toString());
    return {
      drawId: row.id,
      chargebackAmount: centsToDollarString(toCents(row.chargebackAmount.toString())),
      drawFromReserveAmount: centsToDollarString(drawn),
      excessToExpenseAmount: centsToDollarString(toCents(row.excessToExpenseAmount.toString())),
      reserveBalanceBefore: centsToDollarString(before),
      reserveBalanceAfter: centsToDollarString(before - drawn),
      postingStatus,
    };
  }
}
