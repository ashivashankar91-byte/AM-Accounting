import { injectable, inject } from 'tsyringe';
import { NotFoundError } from '../domain/errors';

/**
 * GET /api/v1/tax/results (search) + /:id (detail with lines). Immutable,
 * no edit actions — matches the S124 "Calculation / Result Inquiry" UI
 * surface's read-only contract.
 */
@injectable()
export class TaxResultQueryService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async search(tenantId: string, filters: { legalEntityId?: string; documentId?: string; status?: string; jurisdictionId?: string }) {
    return this.prisma.taxResult.findMany({
      where: {
        tenantId,
        ...(filters.legalEntityId ? { legalEntityId: filters.legalEntityId } : {}),
        ...(filters.documentId ? { documentId: filters.documentId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.jurisdictionId ? { lines: { some: { jurisdictionId: filters.jurisdictionId } } } : {}),
      },
      include: { lines: true },
      orderBy: { calculatedAt: 'desc' },
    });
  }

  async getById(tenantId: string, id: string) {
    const row = await this.prisma.taxResult.findFirst({ where: { id, tenantId }, include: { lines: true } });
    if (!row) throw new NotFoundError('TaxResult', id);
    return row;
  }
}

/**
 * GET /api/v1/tax/audit/:entityType/:entityId — before/after audit trail
 * for any config object, backed by tax_audit_reference.
 */
@injectable()
export class TaxAuditQueryService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async trail(tenantId: string, entityType: string, entityId: string) {
    return this.prisma.taxAuditReference.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
