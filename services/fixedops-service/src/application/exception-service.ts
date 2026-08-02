import { injectable, inject } from 'tsyringe';

export interface RaiseExceptionInput {
  tenantId: string;
  legalEntityId: string;
  storeId?: string | null;
  sourceEventId: string;
  correlationId: string;
  eventFamily: string;
  roNumber?: string | null;
  reasonCode: string;
  detail?: string | null;
}

/** S021-aligned exception/recovery queue for CE-11. Mirrors
 * posting-recovery-service's closed failure taxonomy for consistency in the
 * unified exception queue UI (Fixed Ops Posting Inquiry -> Exception & Recovery Queue). */
@injectable()
export class ExceptionService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async raise(input: RaiseExceptionInput, tx: any = this.prisma) {
    return tx.fixedOpsPostingException.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        storeId: input.storeId ?? null,
        sourceEventId: input.sourceEventId,
        correlationId: input.correlationId,
        eventFamily: input.eventFamily,
        roNumber: input.roNumber ?? null,
        reasonCode: input.reasonCode,
        detail: input.detail ?? null,
        status: 'OPEN',
      },
    });
  }

  async list(tenantId: string, filters: { status?: string; reasonCode?: string } = {}) {
    return this.prisma.fixedOpsPostingException.findMany({
      where: { tenantId, ...(filters.status ? { status: filters.status } : {}), ...(filters.reasonCode ? { reasonCode: filters.reasonCode } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolve(tenantId: string, id: string, resolvedBy: string) {
    return this.prisma.fixedOpsPostingException.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy },
    });
  }
}
