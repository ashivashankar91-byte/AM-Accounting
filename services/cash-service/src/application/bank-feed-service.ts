import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/cash-client';
import { BankFeedAdapter, UnconfiguredBankFeedAdapter } from '../infrastructure/bank-feed-adapter';

export class BankFeedInputError extends Error {
  readonly status = 400;
  readonly code = 'BANK_FEED_INPUT_ERROR';
}

export class BankFeedLineNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'BANK_FEED_LINE_NOT_FOUND';
}

export class BankFeedLineAlreadyMatchedError extends Error {
  readonly status = 409;
  readonly code = 'BANK_FEED_LINE_ALREADY_MATCHED';
}

export class BankFeedTargetNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'BANK_FEED_TARGET_NOT_FOUND';
}

export interface ManualImportLineDTO {
  tenantId: string;
  bankAccountCode: string;
  externalId?: string | null;
  amount: number | string;
  valueDate: string;
  description?: string | null;
  actor: string;
}

/**
 * S053 — bank feed status + manual import/match. Matching to a receipt or a
 * deposit is always a manual, explicit action here — there is no automatic
 * clearing performed by this service (that would misrepresent a
 * non-existent feed integration as automation).
 */
@injectable()
export class BankFeedService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('BankFeedAdapter') private readonly adapter: BankFeedAdapter = new UnconfiguredBankFeedAdapter(),
  ) {}

  getAdapterStatus() {
    return { state: this.adapter.getState() };
  }

  async importManualLine(dto: ManualImportLineDTO) {
    if (!dto.bankAccountCode) throw new BankFeedInputError('bankAccountCode is required');
    if (dto.amount === undefined || dto.amount === null) throw new BankFeedInputError('amount is required');
    if (!dto.valueDate) throw new BankFeedInputError('valueDate is required');

    const externalId = dto.externalId ?? `MANUAL-${crypto.randomUUID()}`;
    return this.prisma.bankFeedLine.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: dto.tenantId,
        bankAccountCode: dto.bankAccountCode,
        source: 'MANUAL',
        externalId,
        amount: dto.amount,
        valueDate: new Date(dto.valueDate),
        description: dto.description ?? null,
        status: 'UNMATCHED',
        importedBy: dto.actor,
      },
    });
  }

  /**
   * Truthfully attempts to pull real feed lines. When the adapter reports
   * BANK_FEED_NOT_CONFIGURED, returns that state and imports nothing — the
   * caller (route) surfaces this so a user never believes a feed ran when
   * none exists.
   */
  async syncFeed(tenantId: string, bankAccountCode: string, actor: string) {
    const state = this.adapter.getState();
    if (state !== 'CONFIGURED') {
      return { state, imported: 0 };
    }
    const lines = await this.adapter.fetchNewLines(bankAccountCode);
    let imported = 0;
    for (const l of lines) {
      try {
        await this.prisma.bankFeedLine.create({
          data: {
            id: crypto.randomUUID(), tenantId, bankAccountCode, source: 'FEED', externalId: l.externalId,
            amount: l.amount, valueDate: new Date(l.valueDate), description: l.description ?? null,
            status: 'UNMATCHED', importedBy: actor,
          },
        });
        imported += 1;
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err; // duplicate feed line — already imported, skip
      }
    }
    return { state, imported };
  }

  async search(tenantId: string, filters: { status?: string; bankAccountCode?: string; limit?: number; offset?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const where: any = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.bankAccountCode) where.bankAccountCode = filters.bankAccountCode;
    const [items, total] = await Promise.all([
      this.prisma.bankFeedLine.findMany({ where, orderBy: { valueDate: 'desc' }, take: limit, skip: offset }),
      this.prisma.bankFeedLine.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  /** Manual match to either a deposit XOR a receipt (never both). Idempotent: matching an already-matched line to the SAME target is a no-op; a different target is rejected. */
  async matchLine(dto: { tenantId: string; feedLineId: string; depositId?: string; receiptId?: string; actor: string }) {
    if (!dto.depositId && !dto.receiptId) throw new BankFeedInputError('depositId or receiptId is required');
    if (dto.depositId && dto.receiptId) throw new BankFeedInputError('match to depositId or receiptId, not both');

    const line = await this.prisma.bankFeedLine.findFirst({ where: { id: dto.feedLineId, tenantId: dto.tenantId } });
    if (!line) throw new BankFeedLineNotFoundError();

    if (line.status === 'MATCHED') {
      const sameTarget = (dto.depositId && line.matchedDepositId === dto.depositId) || (dto.receiptId && line.matchedReceiptId === dto.receiptId);
      if (sameTarget) return { ...line, idempotent: true };
      throw new BankFeedLineAlreadyMatchedError();
    }

    if (dto.depositId) {
      const deposit = await this.prisma.cashDeposit.findFirst({ where: { id: dto.depositId, tenantId: dto.tenantId } });
      if (!deposit) throw new BankFeedTargetNotFoundError();
    }
    if (dto.receiptId) {
      const receipt = await this.prisma.cashReceipt.findFirst({ where: { id: dto.receiptId, tenantId: dto.tenantId } });
      if (!receipt) throw new BankFeedTargetNotFoundError();
    }

    return this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, dto.tenantId);
      await tx.bankFeedLine.update({
        where: { id: line.id },
        data: {
          status: 'MATCHED', matchedDepositId: dto.depositId ?? null, matchedReceiptId: dto.receiptId ?? null,
          matchedBy: dto.actor, matchedAt: new Date(),
        },
      });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'BANK_FEED_LINE', docId: line.id,
          action: 'BANK_FEED_LINE_MATCHED', before: { status: 'UNMATCHED' } as any,
          after: { depositId: dto.depositId ?? null, receiptId: dto.receiptId ?? null } as any, actor: dto.actor,
        },
      });
      return { ...(await tx.bankFeedLine.findUniqueOrThrow({ where: { id: line.id } })), idempotent: false };
    });
  }
}
