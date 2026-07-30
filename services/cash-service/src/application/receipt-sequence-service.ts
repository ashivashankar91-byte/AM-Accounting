import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/cash-client';
import { formatReceiptNumber, isValidStoreCode } from '../domain/receipt-number';

export class SequenceValidationError extends Error {
  readonly status = 422;
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SequenceValidationError';
  }
}

export interface AllocateReceiptNumberDTO {
  tenantId: string;
  storeId: string;
  storeCode: string;
  businessDate: string; // YYYY-MM-DD
}

export interface AllocationResult {
  receiptNumber: string;
  seq: number;
}

/**
 * S052 — atomic receipt-number allocation, scoped per (tenant, store,
 * businessDate). Uses the same single INSERT..ON CONFLICT DO UPDATE..
 * RETURNING primitive as coa-service's SequenceService.allocate — a separate
 * find+create+update sequence aborts the whole Postgres transaction for
 * every losing concurrent caller (see that file's header comment for the
 * real defect this avoids).
 */
@injectable()
export class ReceiptSequenceService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async allocate(dto: AllocateReceiptNumberDTO): Promise<AllocationResult> {
    const storeCode = typeof dto.storeCode === 'string' ? dto.storeCode.trim().toUpperCase() : dto.storeCode;
    if (!isValidStoreCode(storeCode)) {
      throw new SequenceValidationError('INVALID_STORE_CODE', 'storeCode must be 1-20 uppercase alphanumerics/dashes');
    }

    return this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, dto.tenantId);
      const rows = await tx.$queryRawUnsafe<{ claimed: number }[]>(
        `INSERT INTO cash_receipt_sequence (id, tenant_id, store_id, business_date, next_seq, created_at, updated_at)
         VALUES ($1, $2, $3, $4::date, 2, now(), now())
         ON CONFLICT (tenant_id, store_id, business_date)
         DO UPDATE SET next_seq = cash_receipt_sequence.next_seq + 1, updated_at = now()
         RETURNING (next_seq - 1) AS claimed`,
        crypto.randomUUID(),
        dto.tenantId,
        dto.storeId,
        dto.businessDate,
      );
      if (!rows || rows.length === 0) {
        throw new SequenceValidationError('SEQUENCE_NOT_FOUND', 'sequence counter row missing after upsert');
      }
      const seq = Number(rows[0].claimed);
      return { receiptNumber: formatReceiptNumber(storeCode, dto.businessDate, seq), seq };
    });
  }
}
