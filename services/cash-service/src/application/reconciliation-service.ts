import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/cash-client';
import { canApproveVariance, canReconcile, DrawerStatus } from '../domain/cash-drawer';

export class DrawerNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'DRAWER_NOT_FOUND';
}

export class VarianceNotFoundError extends Error {
  readonly status = 409;
  readonly code = 'BLIND_COUNT_NOT_SUBMITTED';
  constructor(message = 'This drawer has no blind count submitted yet') {
    super(message);
    this.name = 'VarianceNotFoundError';
  }
}

export class ApprovalReasonRequiredError extends Error {
  readonly status = 422;
  readonly code = 'APPROVAL_REASON_REQUIRED';
  constructor(message = 'An approval reason is required') {
    super(message);
    this.name = 'ApprovalReasonRequiredError';
  }
}

export class ApprovalNotEligibleError extends Error {
  readonly status = 409;
  readonly code = 'APPROVAL_NOT_ELIGIBLE';
  constructor(message = 'This drawer does not require variance approval') {
    super(message);
    this.name = 'ApprovalNotEligibleError';
  }
}

export class ReconcileNotEligibleError extends Error {
  readonly status = 409;
  readonly code = 'RECONCILE_NOT_ELIGIBLE';
  constructor(message = 'This drawer cannot be reconciled yet — submit the blind close first, and approve any pending variance') {
    super(message);
    this.name = 'ReconcileNotEligibleError';
  }
}

@injectable()
export class ReconciliationService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  /** Supervisor-only view: expected vs counted totals, classification, and
   * approval status if any. Gated at the route layer by cash.drawer.reconcile. */
  async getReconciliation(tenantId: string, drawerId: string) {
    const drawer = await this.prisma.cashDrawer.findFirst({ where: { id: drawerId, tenantId } });
    if (!drawer) throw new DrawerNotFoundError();
    const variance = await this.prisma.cashDrawerVariance.findUnique({ where: { drawerId } });
    if (!variance) throw new VarianceNotFoundError();
    const blindCount = await this.prisma.cashBlindCount.findUnique({ where: { drawerId }, include: { lines: true } });
    const approval = await this.prisma.cashVarianceApproval.findUnique({ where: { drawerId } });
    return { drawer, variance, blindCount, approval };
  }

  async approveVariance(dto: { tenantId: string; drawerId: string; reason: string; actor: string }) {
    if (!dto.reason || !dto.reason.trim()) throw new ApprovalReasonRequiredError();

    const drawer = await this.prisma.cashDrawer.findFirst({ where: { id: dto.drawerId, tenantId: dto.tenantId } });
    if (!drawer) throw new DrawerNotFoundError();

    const existing = await this.prisma.cashVarianceApproval.findUnique({ where: { drawerId: dto.drawerId } });
    if (existing) return { ...existing, idempotent: true };

    if (!canApproveVariance(drawer.status as DrawerStatus)) throw new ApprovalNotEligibleError();

    const variance = await this.prisma.cashDrawerVariance.findUnique({ where: { drawerId: dto.drawerId } });
    if (!variance) throw new VarianceNotFoundError();

    const created = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, dto.tenantId);

      const approvalId = crypto.randomUUID();
      await tx.cashVarianceApproval.create({
        data: { id: approvalId, tenantId: dto.tenantId, drawerId: dto.drawerId, varianceId: variance.id, approvedBy: dto.actor, approvalReason: dto.reason },
      });
      await tx.cashDrawer.update({ where: { id: dto.drawerId }, data: { status: 'BLIND_COUNT_SUBMITTED', version: { increment: 1 } } });

      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'CASH_DRAWER', docId: dto.drawerId,
          action: 'CASH_DRAWER_VARIANCE_APPROVED', before: null as any, after: { reason: dto.reason, classification: variance.classification } as any, actor: dto.actor,
        },
      });
      await tx.cashOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId: dto.tenantId, eventType: 'cash.drawer.variance_approved', aggregateId: dto.drawerId, payload: { reason: dto.reason } as any },
      });

      return tx.cashVarianceApproval.findUniqueOrThrow({ where: { drawerId: dto.drawerId } });
    });

    try {
      await this.events.publish({
        type: 'cash.drawer.variance_approved', tenantId: dto.tenantId, payload: { drawerId: dto.drawerId },
        occurredAt: new Date().toISOString(), correlationId: dto.drawerId,
      } as any);
    } catch {
      /* outbox row already durable */
    }

    return { ...created, idempotent: false };
  }

  /** Terminal transition — RECONCILED is permanently read-only afterward
   * (every other write path in this service and ReceiptService rejects a
   * RECONCILED drawer). Idempotent: reconciling an already-RECONCILED
   * drawer returns success without re-doing work. */
  async reconcile(dto: { tenantId: string; drawerId: string; actor: string }) {
    const drawer = await this.prisma.cashDrawer.findFirst({ where: { id: dto.drawerId, tenantId: dto.tenantId } });
    if (!drawer) throw new DrawerNotFoundError();

    if (drawer.status === 'RECONCILED') {
      return { drawerId: dto.drawerId, status: 'RECONCILED' as const, reconciledAt: drawer.reconciledAt, idempotent: true };
    }
    if (!canReconcile(drawer.status as DrawerStatus)) throw new ReconcileNotEligibleError();

    const reconciledAt = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, dto.tenantId);

      const now = new Date();
      await tx.cashDrawer.update({
        where: { id: dto.drawerId },
        data: { status: 'RECONCILED', reconciledAt: now, reconciledBy: dto.actor, version: { increment: 1 } },
      });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'CASH_DRAWER', docId: dto.drawerId,
          action: 'CASH_DRAWER_RECONCILED', before: null as any, after: { drawerId: dto.drawerId } as any, actor: dto.actor,
        },
      });
      await tx.cashOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId: dto.tenantId, eventType: 'cash.drawer.reconciled', aggregateId: dto.drawerId, payload: {} as any },
      });
      return now;
    });

    try {
      await this.events.publish({
        type: 'cash.drawer.reconciled', tenantId: dto.tenantId, payload: { drawerId: dto.drawerId },
        occurredAt: new Date().toISOString(), correlationId: dto.drawerId,
      } as any);
    } catch {
      /* outbox row already durable */
    }

    return { drawerId: dto.drawerId, status: 'RECONCILED' as const, reconciledAt, idempotent: false };
  }
}
