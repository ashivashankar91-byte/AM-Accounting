import { injectable, inject } from 'tsyringe';
import { appendAuditEvent } from '../infrastructure/audit';
import { FixedOpsValidationError } from '../domain/errors';

export type WipMode = 'WIP_MODE' | 'DIRECT_MODE';

export interface ElectWipModeInput {
  tenantId: string;
  legalEntityId: string;
  storeId?: string | null;
  mode: WipMode;
  effectiveFrom: string; // YYYY-MM-DD
  impactPreview?: unknown;
  approvedBy: string;
}

/** S061 — [SAFE_CONFIGURATION] tenant/entity election, effective-dated,
 * prospective-only, ceremony with impact preview. */
@injectable()
export class WipModeService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async elect(input: ElectWipModeInput) {
    if (input.mode !== 'WIP_MODE' && input.mode !== 'DIRECT_MODE') {
      throw new FixedOpsValidationError('INVALID_WIP_MODE', `mode must be WIP_MODE or DIRECT_MODE, got ${input.mode}`);
    }
    const row = await this.prisma.wipModeElection.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        storeId: input.storeId ?? null,
        mode: input.mode,
        effectiveFrom: new Date(input.effectiveFrom),
        impactPreview: input.impactPreview as any,
        approvedBy: input.approvedBy,
      },
    });
    await appendAuditEvent(this.prisma, {
      tenantId: input.tenantId,
      docType: 'WIP_MODE_ELECTION',
      docId: row.id,
      action: 'ELECTED',
      actor: input.approvedBy,
      after: row,
      reason: 'WIP mode election ceremony',
    });
    return row;
  }

  /** Prospective-only: the row with the latest effectiveFrom <= asOf. */
  async activeMode(tenantId: string, legalEntityId: string, storeId: string | null, asOf: Date): Promise<WipMode> {
    const candidates = await this.prisma.wipModeElection.findMany({
      where: {
        tenantId,
        legalEntityId,
        effectiveFrom: { lte: asOf },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const scoped = candidates.filter((c: any) => c.storeId === storeId || c.storeId === null);
    return (scoped[0]?.mode as WipMode) ?? 'DIRECT_MODE';
  }

  async history(tenantId: string, legalEntityId: string) {
    return this.prisma.wipModeElection.findMany({
      where: { tenantId, legalEntityId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
}
