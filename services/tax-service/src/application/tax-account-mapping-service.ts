import { injectable, inject } from 'tsyringe';
import { ACCOUNT_MAPPING_VALUES_PENDING } from '../domain/tax-attachment';
import { AccountMappingPendingError } from '../domain/errors';

/**
 * S023 governed account-mapping matrix boundary. tax-service does not know
 * GL account numbers — it only tracks whether the matrix row for
 * (tenantId, legalEntityId, eventType/feeCode) is resolved (opaque
 * reference) or still ACCOUNT_MAPPING_VALUES_PENDING. New rows always
 * start blank; only the labeled TEST-TENANT fixture may have a resolved
 * (still-opaque) status.
 */
@injectable()
export class TaxAccountMappingService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async lookup(tenantId: string, legalEntityId: string, eventType: string, feeCode?: string | null) {
    let row = await this.prisma.taxAccountMappingRef.findFirst({
      where: { tenantId, legalEntityId, eventType, feeCode: feeCode ?? null },
    });
    if (!row) {
      // New rows always start blank — create it on first lookup so it is
      // visible to Accounting for resolution, per the S023 standing rule.
      row = await this.prisma.taxAccountMappingRef.create({
        data: { tenantId, legalEntityId, eventType, feeCode: feeCode ?? null, mappingStatus: ACCOUNT_MAPPING_VALUES_PENDING },
      });
    }
    return row;
  }

  /** Called by a consuming transaction attempting to attach tax/fee to its
   * envelope. Throws a deterministic, typed rejection when the mapping is
   * still pending — never a silent proceed. */
  async assertResolved(tenantId: string, legalEntityId: string, eventType: string, feeCode?: string | null): Promise<string> {
    const row = await this.lookup(tenantId, legalEntityId, eventType, feeCode);
    if (row.mappingStatus === ACCOUNT_MAPPING_VALUES_PENDING) {
      throw new AccountMappingPendingError(tenantId, legalEntityId, eventType);
    }
    return row.mappingStatus;
  }
}
