import { injectable, inject } from 'tsyringe';
import { AccountMappingPendingError } from '../domain/errors';
import { ACCOUNT_MAPPING_VALUES_PENDING, ROLES_BY_FAMILY, EventFamily, TEST_FIXTURE_TENANT_ID } from '../domain/account-mapping-roles';

/**
 * S023 governed account-mapping matrix boundary — mirrors
 * services/tax-service/src/application/tax-account-mapping-service.ts. This
 * service never knows a real GL account number; it only tracks whether the
 * matrix row for (tenantId, legalEntityId, eventFamily, role) is resolved.
 * New rows always start blank.
 */
@injectable()
export class AccountMappingService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async lookup(tenantId: string, legalEntityId: string, eventFamily: string, role: string) {
    let row = await this.prisma.fixedOpsAccountMapping.findFirst({
      where: { tenantId, legalEntityId, eventFamily, role },
    });
    if (!row) {
      row = await this.prisma.fixedOpsAccountMapping.create({
        data: { tenantId, legalEntityId, eventFamily, role, status: ACCOUNT_MAPPING_VALUES_PENDING },
      });
    }
    return row;
  }

  /** Deterministic, typed rejection when still pending — never silent. */
  async assertResolved(tenantId: string, legalEntityId: string, eventFamily: string, role: string): Promise<string> {
    const row = await this.lookup(tenantId, legalEntityId, eventFamily, role);
    if (row.status === ACCOUNT_MAPPING_VALUES_PENDING) {
      throw new AccountMappingPendingError(tenantId, legalEntityId, eventFamily, role);
    }
    return row.status;
  }

  /** Validates ALL roles for an event family resolve before ANY posting
   * attempt — S059 AC "never a partial post": if any line's mapping is
   * unresolved, reject the whole close before calling posting-engine. */
  async assertFamilyResolved(tenantId: string, legalEntityId: string, eventFamily: EventFamily): Promise<void> {
    const roles = ROLES_BY_FAMILY[eventFamily] ?? [];
    for (const role of roles) {
      await this.assertResolved(tenantId, legalEntityId, eventFamily, role);
    }
  }

  async listForEntity(tenantId: string, legalEntityId: string) {
    return this.prisma.fixedOpsAccountMapping.findMany({ where: { tenantId, legalEntityId } });
  }

  /** Tenant-configurable resolution ceremony — mirrors
   * parts-accounting-service's AccountMappingService.setAccountNumber
   * exactly. Never a real production account number for the labeled
   * certification-fixture tenant (S023 standing rule). */
  async setAccountNumber(tenantId: string, legalEntityId: string, eventFamily: string, role: string, accountNumber: string, updatedBy: string) {
    if (tenantId === TEST_FIXTURE_TENANT_ID) {
      throw new Error('The certification fixture tenant mapping is fixed and may not be edited.');
    }
    return this.prisma.fixedOpsAccountMapping.upsert({
      where: { tenantId_legalEntityId_eventFamily_role: { tenantId, legalEntityId, eventFamily, role } },
      create: { tenantId, legalEntityId, eventFamily, role, accountNumber, status: 'RESOLVED', updatedBy },
      update: { accountNumber, status: 'RESOLVED', updatedBy },
    });
  }
}
