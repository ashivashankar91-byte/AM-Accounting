import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateGoodsReceiptLineDTO {
  poLineId: string;
  description: string;
  qtyReceived: number;
}

export interface CreateGoodsReceiptDTO {
  tenantId: string;
  poId: string;
  receiptDate?: Date;
  receivedBy?: string;
  notes?: string;
  lines: CreateGoodsReceiptLineDTO[];
}

export interface VoidGoodsReceiptDTO {
  reason: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class GoodsReceiptNotFoundError extends Error {
  constructor(id: string) {
    super(`Goods receipt not found: ${id}`);
    this.name = 'GoodsReceiptNotFoundError';
  }
}

export class PurchaseOrderNotFoundForReceiptError extends Error {
  constructor(poId: string) {
    super(`Purchase order not found: ${poId}`);
    this.name = 'PurchaseOrderNotFoundForReceiptError';
  }
}

export class GoodsReceiptValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'GoodsReceiptValidationError';
  }
}

export class GoodsReceiptConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'GoodsReceiptConflictError';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * S039 — Goods Receipt (the "R" in 3-way match). Records quantities actually
 * received against a PurchaseOrder's lines. Kept deliberately simple: a
 * receipt is immutable once created (BR-AP-001-style — void + re-enter on a
 * mis-key, never edited in place).
 */
@injectable()
export class GoodsReceiptService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async listForPO(tenantId: string, poId: string) {
    return this.prisma.goodsReceipt.findMany({
      where: { tenantId, poId },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(tenantId: string, id: string) {
    const receipt = await this.prisma.goodsReceipt.findFirst({ where: { id, tenantId }, include: { lines: true } });
    if (!receipt) throw new GoodsReceiptNotFoundError(id);
    return receipt;
  }

  async create(dto: CreateGoodsReceiptDTO, actor = 'system', correlationId?: string) {
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id: dto.poId, tenantId: dto.tenantId }, include: { lines: true } });
    if (!po) throw new PurchaseOrderNotFoundForReceiptError(dto.poId);
    if (!['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(po.status)) {
      throw new GoodsReceiptValidationError('PO_NOT_RECEIVABLE', `Purchase order status '${po.status}' does not permit receiving`);
    }
    if (!dto.lines?.length) {
      throw new GoodsReceiptValidationError('LINES_REQUIRED', 'At least one receipt line is required');
    }
    const poLineIds = new Set(po.lines.map((l: any) => l.id));
    for (const line of dto.lines) {
      if (!poLineIds.has(line.poLineId)) {
        throw new GoodsReceiptValidationError('PO_LINE_NOT_FOUND', `PO line '${line.poLineId}' does not belong to purchase order '${dto.poId}'`);
      }
      if (line.qtyReceived <= 0) {
        throw new GoodsReceiptValidationError('QTY_MUST_BE_POSITIVE', 'qtyReceived must be greater than zero');
      }
    }

    const receipt = await this.prisma.$transaction(async (tx: any) => {
      const receiptNumber = `GR-${Date.now().toString().slice(-8)}`;
      const created = await tx.goodsReceipt.create({
        data: {
          tenantId: dto.tenantId,
          poId: dto.poId,
          receiptNumber,
          receiptDate: dto.receiptDate ?? new Date(),
          receivedBy: dto.receivedBy ?? actor,
          notes: dto.notes ?? null,
          createdBy: actor,
          status: 'OPEN',
          lines: {
            create: dto.lines.map((l, i) => ({
              lineNumber: i + 1,
              poLineId: l.poLineId,
              description: l.description,
              qtyReceived: String(l.qtyReceived),
            })),
          },
        },
        include: { lines: true },
      });

      // S6-01 PO status: mark PARTIALLY_RECEIVED (or RECEIVED if every line
      // is now fully received) — best-effort progression, not a hard
      // reservation system (no invented over/under-receipt policy beyond
      // what's already in the PO state machine).
      const allReceiptLines: any[] = await tx.goodsReceiptLine.findMany({ where: { poLineId: { in: po.lines.map((l: any) => l.id) } } });
      const receivedByLine = new Map<string, number>();
      for (const rl of allReceiptLines) {
        receivedByLine.set(rl.poLineId, (receivedByLine.get(rl.poLineId) ?? 0) + Number(rl.qtyReceived));
      }
      const fullyReceived = po.lines.every((l: any) => (receivedByLine.get(l.id) ?? 0) >= Number(l.qty));
      await tx.purchaseOrder.update({
        where: { id: dto.poId },
        data: { status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
      });

      await tx.auditOutboxEvent.create({
        data: {
          tenantId: dto.tenantId, docType: 'GoodsReceipt', docId: created.id, action: 'CREATED',
          before: null, after: created, actor, correlationId: correlationId ?? null,
        },
      });

      return created;
    });

    await this._writeOutbox(dto.tenantId, 'GOODS_RECEIPT_CREATED', receipt.id, { poId: dto.poId, receiptNumber: receipt.receiptNumber });
    return receipt;
  }

  async void(tenantId: string, id: string, dto: VoidGoodsReceiptDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.goodsReceipt.findFirst({ where: { id, tenantId } });
    if (!current) throw new GoodsReceiptNotFoundError(id);
    if (current.status === 'VOID') throw new GoodsReceiptConflictError('ALREADY_VOID', 'Goods receipt is already void');
    if (!dto.reason?.trim()) throw new GoodsReceiptValidationError('REASON_REQUIRED', 'A reason is required to void a goods receipt');

    const receipt = await this.prisma.$transaction(async (tx: any) => {
      const updated = await tx.goodsReceipt.update({
        where: { id },
        data: { status: 'VOID', voidedAt: new Date(), voidedBy: actor, voidReason: dto.reason },
      });
      await tx.auditOutboxEvent.create({
        data: {
          tenantId, docType: 'GoodsReceipt', docId: id, action: 'VOIDED',
          before: current, after: updated, actor, correlationId: correlationId ?? null,
        },
      });
      return updated;
    });

    await this._writeOutbox(tenantId, 'GOODS_RECEIPT_VOIDED', id, { reason: dto.reason, actor });
    return receipt;
  }

  private async _writeOutbox(tenantId: string, eventType: string, aggregateId: string, payload: Record<string, unknown>) {
    try {
      await this.prisma.outboxEvent.create({ data: { tenantId, eventType, payload: { aggregateId, ...payload } } });
    } catch {
      // Non-fatal
    }
  }
}
