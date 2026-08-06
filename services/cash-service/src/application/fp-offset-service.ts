import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/cash-client';
import { assertAllocationEqualsStatement, canPostFpOffsetAllocation } from '../domain/sweep';
import { buildMatrixRowEnvelope } from '../domain/posting-envelope';

export class FpOffsetInputError extends Error {
  readonly status = 400;
  readonly code = 'FP_OFFSET_INPUT_ERROR';
}

export class FpOffsetAllocationNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'FP_OFFSET_ALLOCATION_NOT_FOUND';
}

export class FpOffsetAllocationNotPostableError extends Error {
  readonly status = 409;
  readonly code = 'FP_OFFSET_ALLOCATION_NOT_POSTABLE';
  constructor(message = 'Allocation is not in a postable state (must be DRAFT)') {
    super(message);
    this.name = 'FpOffsetAllocationNotPostableError';
  }
}

export interface CreateFpOffsetAllocationDTO {
  tenantId: string;
  entityId: string;
  lenderName: string;
  statementDate: string; // YYYY-MM-DD
  statementAmount: number | string;
  lines: Array<{ floorplanUnitRef: string; amount: number | string }>;
  idempotencyKey: string;
  actor: string;
}

const includeLines = { lines: true } as const;

/**
 * S056 — floorplan-offset allocation: allocates an already-entered
 * lender-statement figure against floorplan units. This service performs
 * NO interest/actuarial calculation — the statementAmount is a manually
 * entered fact, and the only computation here is verifying the entered
 * allocation lines sum to that figure exactly (assertAllocationEqualsStatement).
 */
@injectable()
export class FpOffsetService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  async createAllocation(dto: CreateFpOffsetAllocationDTO) {
    if (!dto.idempotencyKey) throw new FpOffsetInputError('idempotencyKey is required');
    if (!dto.lenderName) throw new FpOffsetInputError('lenderName is required');
    if (!dto.lines || dto.lines.length === 0) throw new FpOffsetInputError('lines must be non-empty');

    const prior = await this.prisma.fpOffsetAllocation.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
      include: includeLines,
    });
    if (prior) return { ...prior, idempotent: true };

    const statementAmountCents = Math.round(Number(dto.statementAmount) * 100);
    assertAllocationEqualsStatement(dto.lines, statementAmountCents);

    const allocationId = crypto.randomUUID();
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await setTenantContextOnConnection(tx, dto.tenantId);
        await tx.fpOffsetAllocation.create({
          data: {
            id: allocationId, tenantId: dto.tenantId, entityId: dto.entityId, lenderName: dto.lenderName,
            statementDate: new Date(dto.statementDate), statementAmount: dto.statementAmount as any,
            status: 'DRAFT',
            idempotencyKey: dto.idempotencyKey, enteredBy: dto.actor,
          },
        });
        for (const line of dto.lines) {
          await tx.fpOffsetAllocationLine.create({
            data: {
              id: crypto.randomUUID(), tenantId: dto.tenantId, allocationId,
              floorplanUnitRef: line.floorplanUnitRef, amount: line.amount as any,
            },
          });
        }
        return tx.fpOffsetAllocation.findUniqueOrThrow({ where: { id: allocationId }, include: includeLines });
      });
      return { ...created, idempotent: false };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const winner = await this.prisma.fpOffsetAllocation.findUnique({
          where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
          include: includeLines,
        });
        if (winner) return { ...winner, idempotent: true };
      }
      throw err;
    }
  }

  async getById(tenantId: string, allocationId: string) {
    const allocation = await this.prisma.fpOffsetAllocation.findFirst({ where: { id: allocationId, tenantId }, include: includeLines });
    if (!allocation) throw new FpOffsetAllocationNotFoundError();
    return allocation;
  }

  async search(tenantId: string, filters: { status?: string; lenderName?: string; limit?: number; offset?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const where: any = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.lenderName) where.lenderName = filters.lenderName;
    const [items, total] = await Promise.all([
      this.prisma.fpOffsetAllocation.findMany({ where, include: includeLines, orderBy: { enteredAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.fpOffsetAllocation.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  /** BR: idempotent; re-verifies conservation immediately before posting. */
  async postAllocation(tenantId: string, allocationId: string, actor: string) {
    const allocation = await this.getById(tenantId, allocationId);
    if (allocation.status === 'POSTED') return { ...allocation, idempotent: true };
    if (!canPostFpOffsetAllocation(allocation.status as any)) throw new FpOffsetAllocationNotPostableError();

    const statementAmountCents = Math.round(Number(allocation.statementAmount) * 100);
    assertAllocationEqualsStatement(allocation.lines.map((l) => ({ amount: l.amount.toString() })), statementAmountCents);

    const eventId = crypto.randomUUID();
    const updated = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, tenantId);
      await tx.fpOffsetAllocation.update({
        where: { id: allocationId },
        data: { status: 'POSTED', postedAt: new Date(), version: { increment: 1 } },
      });

      const envelope = buildMatrixRowEnvelope({
        eventId, tenantId, legalEntityId: allocation.entityId,
        eventType: 'cash.fpoffset.allocation.posted',
        sourceEntityType: 'FP_OFFSET_ALLOCATION', sourceEntityId: allocationId,
        businessDate: allocation.statementDate.toISOString().slice(0, 10),
        correlationId: allocationId,
        idempotencyIdentity: `cash.fpoffset.allocation.posted:${tenantId}:${allocationId}`,
        accountingAmounts: [{ amount: allocation.statementAmount.toString(), currency: 'USD', kind: 'GROSS' }],
        accountingReferences: [{ referenceNumber: allocationId }],
        metadata: { lenderName: allocation.lenderName, lineCount: allocation.lines.length },
      });

      await tx.cashOutboxEvent.create({
        data: { id: eventId, tenantId, eventType: 'cash.fpoffset.allocation.posted', aggregateId: allocationId, payload: envelope as any },
      });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId, docType: 'FP_OFFSET_ALLOCATION', docId: allocationId,
          action: 'FP_OFFSET_ALLOCATION_POSTED', before: { status: 'DRAFT' } as any,
          after: { status: 'POSTED', statementAmount: allocation.statementAmount } as any, actor,
        },
      });
      return tx.fpOffsetAllocation.findUniqueOrThrow({ where: { id: allocationId }, include: includeLines });
    });

    try {
      await this.events.publish({ type: 'cash.fpoffset.allocation.posted', tenantId, payload: { allocationId }, occurredAt: new Date().toISOString(), correlationId: allocationId } as any);
    } catch {
      /* outbox row already durable */
    }

    return { ...updated, idempotent: false };
  }
}
