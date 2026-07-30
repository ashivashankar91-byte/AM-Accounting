import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/cash-client';
import { toCents } from '../domain/money';

export interface ResolveToleranceInput {
  tenantId: string;
  entityId?: string | null;
  storeId?: string | null;
}

/**
 * S052 — variance-tolerance resolution: STORE -> ENTITY -> TENANT -> 0.00
 * (see research report Q9 / schema.prisma CashVarianceToleranceConfig doc
 * comment). No configured tolerance means only an exact count avoids
 * OUTSIDE_TOLERANCE — the conservative default, not a silently invented
 * accounting assumption.
 */
@injectable()
export class ToleranceService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async resolveCents(input: ResolveToleranceInput): Promise<number> {
    if (input.storeId) {
      const row = await this.prisma.cashVarianceToleranceConfig.findFirst({
        where: { tenantId: input.tenantId, scope: 'STORE', scopeId: input.storeId },
      });
      // .toString() first — Prisma returns Decimal columns as Prisma.Decimal
      // objects, not plain numbers; toCents()'s typeof check silently
      // produces NaN on an object without this (caught by the live-db suite).
      if (row) return toCents(row.toleranceAmount.toString());
    }
    if (input.entityId) {
      const row = await this.prisma.cashVarianceToleranceConfig.findFirst({
        where: { tenantId: input.tenantId, scope: 'ENTITY', scopeId: input.entityId },
      });
      if (row) return toCents(row.toleranceAmount.toString());
    }
    const tenantRow = await this.prisma.cashVarianceToleranceConfig.findFirst({
      where: { tenantId: input.tenantId, scope: 'TENANT', scopeId: null },
    });
    if (tenantRow) return toCents(tenantRow.toleranceAmount.toString());
    return 0;
  }
}
