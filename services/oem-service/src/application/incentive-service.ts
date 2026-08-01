import { injectable, inject } from 'tsyringe';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAudit } from '../infrastructure/audit';
import { OemNotFoundError, OemValidationError } from '../domain/errors';
import type { DealFinalizedSource } from '../domain/upstream-deal-events';

export interface IncentiveProgramDTO {
  make: string;
  programId: string;
  termsSummary?: string | null;
  amountType: 'FLAT' | 'TABLE';
  flatAmountPerUnit?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

/**
 * S103A — Incentive Registry & Flat RDR Accruals. Flat programs only in
 * Pass-1 (package: "experience/volume-tiered estimates excluded"). Program
 * content (terms, flat amounts) is factory-published configuration, entered
 * by Accounting — never computed or invented here.
 */
@injectable()
export class OemIncentiveService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('DealFinalizedSource') private readonly dealFinalized: DealFinalizedSource,
  ) {}

  private async getProfileId(tenantId: string, make: string): Promise<string> {
    const profile = await this.prisma.oemIntegrationProfile.findUnique({
      where: { tenantId_make: { tenantId, make: make.toUpperCase() } },
    });
    if (!profile) throw new OemValidationError('NO_PROFILE', `No OEM profile configured for make ${make.toUpperCase()}`);
    return profile.id;
  }

  async registerProgram(tenantId: string, dto: IncentiveProgramDTO, actor: string) {
    if (dto.amountType === 'FLAT' && !dto.flatAmountPerUnit) {
      throw new OemValidationError('FLAT_AMOUNT_REQUIRED', 'flatAmountPerUnit is required for FLAT programs');
    }
    const profileId = await this.getProfileId(tenantId, dto.make);
    const created = await this.prisma.oemIncentiveProgram.create({
      data: {
        tenantId, profileId, make: dto.make.toUpperCase(), programId: dto.programId,
        termsSummary: dto.termsSummary ?? null, amountType: dto.amountType,
        flatAmountPerUnit: dto.flatAmountPerUnit ?? null,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      },
    });
    await appendAudit(this.prisma, {
      tenantId, docType: 'OemIncentiveProgram', docId: created.id, action: 'INCENTIVE_PROGRAM_REGISTERED', actor, after: created,
    });
    return created;
  }

  async listPrograms(tenantId: string) {
    return this.prisma.oemIncentiveProgram.findMany({ where: { tenantId }, orderBy: { make: 'asc' } });
  }

  /**
   * Accrue against fixture/real RDR deliveries since the given date.
   * Unregistered-program deliveries are skipped and returned in
   * `unaccrued` with a visibility flag rather than silently dropped
   * (package AC). Idempotent per (tenantId, programId, dealNumber) via the
   * schema's unique constraint — a re-run over the same deliveries is a
   * no-op for already-accrued deals.
   */
  async accrueFromDeliveries(tenantId: string, storeId: string, since: string, actor: string) {
    const deliveries = await this.dealFinalized.findRdrDeliveries(tenantId, storeId, since);
    const accrued: any[] = [];
    const unaccrued: Array<{ dealNumber: string; reason: string }> = [];

    for (const delivery of deliveries) {
      if (!delivery.programId) {
        unaccrued.push({ dealNumber: delivery.dealNumber, reason: 'NO_PROGRAM_TAGGED' });
        continue;
      }
      const program = await this.prisma.oemIncentiveProgram.findUnique({
        where: { tenantId_make_programId: { tenantId, make: delivery.make.toUpperCase(), programId: delivery.programId } },
      });
      if (!program || !program.active) {
        unaccrued.push({ dealNumber: delivery.dealNumber, reason: 'UNREGISTERED_PROGRAM' });
        continue;
      }
      if (program.amountType !== 'FLAT' || !program.flatAmountPerUnit) {
        unaccrued.push({ dealNumber: delivery.dealNumber, reason: 'NON_FLAT_PROGRAM_NOT_ACCRUED_PASS1' });
        continue;
      }

      const existing = await this.prisma.oemIncentiveAccrual.findUnique({
        where: { tenantId_programId_dealNumber: { tenantId, programId: program.id, dealNumber: delivery.dealNumber } },
      });
      if (existing) {
        accrued.push(existing);
        continue;
      }

      const accruedAmount = (Number(program.flatAmountPerUnit) * delivery.qualifyingUnitCount).toFixed(2);
      const applyNumber = `${delivery.dealNumber}/${program.programId}`;
      const created = await this.prisma.oemIncentiveAccrual.create({
        data: {
          tenantId, storeId, programId: program.id, dealNumber: delivery.dealNumber,
          applyNumber, accruedAmount, sourceDealFinalizedRef: delivery.eventRef,
        },
      });
      await appendAudit(this.prisma, {
        tenantId, docType: 'OemIncentiveAccrual', docId: created.id, action: 'INCENTIVE_ACCRUED', actor, after: created,
      });
      accrued.push(created);
    }

    return { accrued, unaccrued };
  }

  async listAccruals(tenantId: string, storeId?: string) {
    return this.prisma.oemIncentiveAccrual.findMany({
      where: { tenantId, ...(storeId ? { storeId } : {}) },
      include: { trueUps: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** True-up: entered factory statement figure adjusts the accrual — conserves. */
  async trueUp(tenantId: string, accrualId: string, adjustmentAmount: string, reason: string, statementRowRef: string | null, actor: string) {
    const accrual = await this.prisma.oemIncentiveAccrual.findFirst({ where: { tenantId, id: accrualId } });
    if (!accrual) throw new OemNotFoundError('OemIncentiveAccrual', accrualId);

    return this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const trueUp = await tx.oemIncentiveTrueUp.create({
        data: { tenantId, accrualId, statementRowRef, adjustmentAmount, reason, createdBy: actor },
      });
      const newAmount = (Number(accrual.accruedAmount) + Number(adjustmentAmount)).toFixed(2);
      const updated = await tx.oemIncentiveAccrual.update({
        where: { id: accrualId }, data: { accruedAmount: newAmount, status: 'TRUED_UP' },
      });
      await appendAudit(tx, {
        tenantId, docType: 'OemIncentiveAccrual', docId: accrualId, action: 'INCENTIVE_TRUED_UP', actor,
        before: accrual, after: { accrual: updated, trueUp },
      });
      return { accrual: updated, trueUp };
    });
  }

  /**
   * Receivable tie: GL = Σ open incentive items. The GL-movement side is
   * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION (CE-07's posting engine is
   * not finalized in this worktree — same boundary as tax-service's
   * ReconciliationService.threeWayTie) — this returns the oem-service-side
   * Σ truthfully and flags the GL side as pending rather than fabricating a
   * posted-GL figure.
   */
  async receivableTie(tenantId: string, storeId: string) {
    const accruals = await this.prisma.oemIncentiveAccrual.findMany({ where: { tenantId, storeId } });
    const totalOpen = accruals.reduce((sum: number, a: any) => sum + Number(a.accruedAmount), 0);
    return {
      storeId,
      totalOpenIncentiveReceivable: totalOpen.toFixed(2),
      itemCount: accruals.length,
      glMovementSourceIsPending: true, // PENDING_UPSTREAM_TECHNICAL_RECONCILIATION
    };
  }
}
