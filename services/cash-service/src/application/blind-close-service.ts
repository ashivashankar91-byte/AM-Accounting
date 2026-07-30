import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/cash-client';
import { canSubmitBlindClose, DrawerStatus } from '../domain/cash-drawer';
import { toCents, centsToDollars } from '../domain/money';
import {
  computeExpectedCashCents, computeExpectedChecks, classifyVariance, computeDepositEligibleCashCents,
} from '../domain/reconciliation';
import { ToleranceService } from './tolerance-service';

export class DrawerNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'DRAWER_NOT_FOUND';
}

export class DrawerNotOpenError extends Error {
  readonly status = 409;
  readonly code = 'DRAWER_NOT_OPEN';
  constructor(message = 'Blind close can only be submitted while the drawer is OPEN') {
    super(message);
    this.name = 'DrawerNotOpenError';
  }
}

export class BlindCloseValidationError extends Error {
  readonly status = 422;
  readonly code = 'BLIND_CLOSE_VALIDATION_ERROR';
}

export interface BlindCloseCheckLine {
  checkNumber?: string | null;
  amount: number | string;
}

export interface SubmitBlindCloseDTO {
  tenantId: string;
  drawerId: string;
  countedCash: number | string;
  checkCount: number;
  checkTotal: number | string;
  retainedFloat: number | string;
  cashierNote?: string | null;
  checks?: BlindCloseCheckLine[];
  actor: string;
}

/** Cashier-facing confirmation only — deliberately excludes expected cash,
 * expected checks, expected receipt count and variance (BR: the cashier
 * must not see expected totals before — or as a result of — submission). */
export interface BlindCloseConfirmation {
  drawerId: string;
  status: DrawerStatus;
  submittedAt: Date;
  idempotent: boolean;
}

@injectable()
export class BlindCloseService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
    @inject('ToleranceService') private readonly tolerance: ToleranceService,
  ) {}

  async submit(dto: SubmitBlindCloseDTO): Promise<BlindCloseConfirmation> {
    const drawer = await this.prisma.cashDrawer.findFirst({ where: { id: dto.drawerId, tenantId: dto.tenantId } });
    if (!drawer) throw new DrawerNotFoundError();

    const existing = await this.prisma.cashBlindCount.findUnique({ where: { drawerId: dto.drawerId } });
    if (existing) {
      return { drawerId: dto.drawerId, status: drawer.status as DrawerStatus, submittedAt: existing.submittedAt, idempotent: true };
    }
    if (!canSubmitBlindClose(drawer.status as DrawerStatus)) throw new DrawerNotOpenError();

    const countedCashCents = toCents(dto.countedCash);
    const checkTotalCents = toCents(dto.checkTotal);
    const retainedFloatCents = toCents(dto.retainedFloat);
    if (!Number.isFinite(countedCashCents) || countedCashCents < 0) {
      throw new BlindCloseValidationError('countedCash must be a non-negative amount');
    }
    if (!Number.isFinite(retainedFloatCents) || retainedFloatCents < 0) {
      throw new BlindCloseValidationError('retainedFloat must be a non-negative amount');
    }
    if (!Number.isInteger(dto.checkCount) || dto.checkCount < 0) {
      throw new BlindCloseValidationError('checkCount must be a non-negative integer');
    }

    const toleranceCents = await this.tolerance.resolveCents({ tenantId: dto.tenantId, entityId: drawer.entityId, storeId: drawer.storeId });

    const result = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, dto.tenantId);

      const movementRows = await tx.cashDrawerMovement.findMany({ where: { tenantId: dto.tenantId, drawerId: dto.drawerId } });
      // Prisma returns Decimal columns as Prisma.Decimal objects, not plain
      // numbers/strings — toCents()'s typeof check would silently produce
      // NaN on those without this explicit .toString() (caught by the
      // live-db suite; the mocked unit tests use plain numbers and never
      // exercised this path).
      const movements = movementRows.map((m) => ({ movementType: m.movementType, amount: m.amount.toString() }));
      const expectedCashCents = computeExpectedCashCents(movements);
      const expectedChecks = computeExpectedChecks(movements);
      const cashVarianceCents = countedCashCents - expectedCashCents;
      const checkDiscrepancy = expectedChecks.count !== dto.checkCount || expectedChecks.totalCents !== checkTotalCents;
      const { classification, requiresApproval } = classifyVariance({ cashVarianceCents, toleranceCents, checkDiscrepancy });
      const depositEligibleCents = computeDepositEligibleCashCents(countedCashCents, retainedFloatCents);

      const blindCountId = crypto.randomUUID();
      await tx.cashBlindCount.create({
        data: {
          id: blindCountId, tenantId: dto.tenantId, drawerId: dto.drawerId,
          countedCash: centsToDollars(countedCashCents), checkCount: dto.checkCount, checkTotal: centsToDollars(checkTotalCents),
          retainedFloat: centsToDollars(retainedFloatCents), cashierNote: dto.cashierNote ?? null, submittedBy: dto.actor,
        },
      });
      for (const c of dto.checks ?? []) {
        await tx.cashBlindCountLine.create({
          data: { id: crypto.randomUUID(), tenantId: dto.tenantId, blindCountId, checkNumber: c.checkNumber ?? null, amount: centsToDollars(toCents(c.amount)) },
        });
      }

      await tx.cashDrawerVariance.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, drawerId: dto.drawerId,
          expectedCash: centsToDollars(expectedCashCents), countedCash: centsToDollars(countedCashCents),
          cashVariance: centsToDollars(cashVarianceCents), toleranceApplied: centsToDollars(toleranceCents), classification,
          expectedCheckCount: expectedChecks.count, expectedCheckTotal: centsToDollars(expectedChecks.totalCents),
          countedCheckCount: dto.checkCount, countedCheckTotal: centsToDollars(checkTotalCents),
          checkDiscrepancy, requiresApproval, depositEligibleCash: centsToDollars(depositEligibleCents),
        },
      });

      const newStatus: DrawerStatus = requiresApproval ? 'VARIANCE_REVIEW_REQUIRED' : 'BLIND_COUNT_SUBMITTED';
      const submittedAt = new Date();
      await tx.cashDrawer.update({ where: { id: dto.drawerId }, data: { status: newStatus, version: { increment: 1 } } });

      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'CASH_DRAWER', docId: dto.drawerId,
          action: 'CASH_BLIND_COUNT_SUBMITTED', before: null as any, after: { drawerId: dto.drawerId } as any, actor: dto.actor,
        },
      });
      if (classification !== 'EXACT') {
        await tx.auditOutboxEvent.create({
          data: {
            id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'CASH_DRAWER', docId: dto.drawerId,
            action: 'CASH_DRAWER_VARIANCE_DETECTED', before: null as any, after: { classification, requiresApproval } as any, actor: dto.actor,
          },
        });
      }
      await tx.cashOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId: dto.tenantId, eventType: 'cash.drawer.blind_count_submitted', aggregateId: dto.drawerId, payload: { classification } as any },
      });

      return { status: newStatus, submittedAt };
    });

    try {
      await this.events.publish({
        type: 'cash.drawer.blind_count_submitted', tenantId: dto.tenantId, payload: { drawerId: dto.drawerId },
        occurredAt: new Date().toISOString(), correlationId: dto.drawerId,
      } as any);
    } catch {
      /* outbox row already durable */
    }

    return { drawerId: dto.drawerId, status: result.status, submittedAt: result.submittedAt, idempotent: false };
  }
}
