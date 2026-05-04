import {
  TenantId,
  CanonicalGLAccount,
  OEMType,
  OEMMapping,
  StandardChartOfAccounts,
  LegacyGLAccount,
  LegacyMappingResult,
  DMSType,
} from '@amacc/shared-kernel';
import { STANDARD_COA } from '../domain/standard-coa';
import { StandardLegacyGLMapper } from '../domain/legacy-gl-mapper';

export class CoAService {
  private readonly legacyMapper = new StandardLegacyGLMapper();
  // In-memory tenant customizations (would be Prisma in production)
  private tenantOverrides = new Map<string, CanonicalGLAccount[]>();

  getStandardCoA(version?: string): StandardChartOfAccounts {
    if (version && version !== STANDARD_COA.version) {
      throw new Error(`CoA version ${version} not found. Current: ${STANDARD_COA.version}`);
    }
    return STANDARD_COA;
  }

  getTenantCoA(tenantId: TenantId): CanonicalGLAccount[] {
    const overrides = this.tenantOverrides.get(tenantId) ?? [];
    const overrideMap = new Map(overrides.map((a) => [a.amaccCode, a]));
    // Merge standard + tenant overrides
    return STANDARD_COA.accounts.map((a) => overrideMap.get(a.amaccCode) ?? a)
      .concat(overrides.filter((o) => !STANDARD_COA.accounts.some((s) => s.amaccCode === o.amaccCode)));
  }

  getOEMMapping(tenantId: TenantId, oem: OEMType): OEMMapping[] {
    const accounts = this.getTenantCoA(tenantId);
    const mappings: OEMMapping[] = [];
    for (const acct of accounts) {
      const mapping = acct.oemMappings[oem];
      if (mapping) {
        mappings.push(mapping);
      }
    }
    return mappings;
  }

  getUnmappedAccounts(tenantId: TenantId, oem: OEMType): CanonicalGLAccount[] {
    const accounts = this.getTenantCoA(tenantId);
    return accounts.filter((a) => !a.oemMappings[oem]);
  }

  mapLegacyGL(legacyAccounts: LegacyGLAccount[], dmsType: DMSType, tenantId: TenantId): LegacyMappingResult {
    return this.legacyMapper.bulkMap(legacyAccounts, dmsType, tenantId);
  }

  addTenantAccount(tenantId: TenantId, account: CanonicalGLAccount): void {
    const existing = this.tenantOverrides.get(tenantId) ?? [];
    existing.push(account);
    this.tenantOverrides.set(tenantId, existing);
  }
}
