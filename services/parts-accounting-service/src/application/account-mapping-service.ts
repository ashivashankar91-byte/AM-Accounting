import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/parts-accounting-client';
import { AccountMappingPendingError } from '../domain/errors';
import { CERTIFICATION_TEST_TENANT_ID, TEST_FIXTURE_MAPPING_VALUE } from '../domain/event-families';

/**
 * S023 standing rule, mirrored from tax-service's TaxAccountMappingService:
 * new matrix rows for a (tenantId, legalEntityId, eventFamily, role) are
 * ALWAYS created blank (ACCOUNT_MAPPING_VALUES_PENDING) on first reference.
 * Only the labeled certification tenant may carry a resolved value, and
 * even then it is an opaque non-numeric fixture token — never a real GL
 * account number anywhere in this service.
 */
@injectable()
export class PartsAccountMappingService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  /** Ensures a mapping row exists (creating it blank if absent) and returns it. */
  async lookup(tenantId: string, legalEntityId: string, eventFamily: string, role: string) {
    let row = await this.prisma.partsAccountMapping.findUnique({
      where: { tenantId_legalEntityId_eventFamily_role: { tenantId, legalEntityId, eventFamily, role } },
    });
    if (!row) {
      const initialStatus = tenantId === CERTIFICATION_TEST_TENANT_ID ? 'TEST_FIXTURE_RESOLVED' : 'ACCOUNT_MAPPING_VALUES_PENDING';
      row = await this.prisma.partsAccountMapping.create({
        data: {
          tenantId, legalEntityId, eventFamily, role,
          accountNumber: initialStatus === 'TEST_FIXTURE_RESOLVED' ? TEST_FIXTURE_MAPPING_VALUE : null,
          status: initialStatus,
        },
      });
    }
    return row;
  }

  /** Resolves every role for an event family; throws AccountMappingPendingError on the first unresolved one. */
  async resolveAll(tenantId: string, legalEntityId: string, eventFamily: string, roles: string[]) {
    const resolved: Record<string, string> = {};
    for (const role of roles) {
      const row = await this.lookup(tenantId, legalEntityId, eventFamily, role);
      if (row.status === 'ACCOUNT_MAPPING_VALUES_PENDING' || !row.accountNumber) {
        throw new AccountMappingPendingError(eventFamily, role);
      }
      resolved[role] = row.accountNumber;
    }
    return resolved;
  }

  async listForEntity(tenantId: string, legalEntityId: string) {
    return this.prisma.partsAccountMapping.findMany({ where: { tenantId, legalEntityId }, orderBy: [{ eventFamily: 'asc' }, { role: 'asc' }] });
  }

  async setAccountNumber(tenantId: string, legalEntityId: string, eventFamily: string, role: string, accountNumber: string, updatedBy: string) {
    if (tenantId === CERTIFICATION_TEST_TENANT_ID) {
      throw new Error('The certification fixture tenant mapping is fixed and may not be edited.');
    }
    return this.prisma.partsAccountMapping.upsert({
      where: { tenantId_legalEntityId_eventFamily_role: { tenantId, legalEntityId, eventFamily, role } },
      create: { tenantId, legalEntityId, eventFamily, role, accountNumber, status: 'RESOLVED', updatedBy },
      update: { accountNumber, status: 'RESOLVED', updatedBy },
    });
  }
}
