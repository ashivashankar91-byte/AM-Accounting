import {
  ILegacyGLMapper,
  CanonicalGLAccount,
  UnmappedGLWarning,
  LegacyGLAccount,
  LegacyMappingResult,
  DMSType,
  TenantId,
} from '@amacc/shared-kernel';
import { STANDARD_COA } from './standard-coa';

// Mapping tables for common legacy DMS account codes to AMACC canonical
const AUTOMATE_MAP: Record<string, string> = {
  '1000': 'AMACC_GL_100', '1010': 'AMACC_GL_101', '1100': 'AMACC_GL_110',
  '1110': 'AMACC_GL_111', '1200': 'AMACC_GL_120', '1210': 'AMACC_GL_121',
  '1300': 'AMACC_GL_130', '1500': 'AMACC_GL_150', '1510': 'AMACC_GL_151',
  '2000': 'AMACC_GL_200', '2100': 'AMACC_GL_210', '2110': 'AMACC_GL_211',
  '2200': 'AMACC_GL_220', '2500': 'AMACC_GL_250', '3000': 'AMACC_GL_300',
  '3100': 'AMACC_GL_310', '4000': 'AMACC_GL_400', '4010': 'AMACC_GL_401',
  '4100': 'AMACC_GL_410', '4200': 'AMACC_GL_420', '4400': 'AMACC_GL_430',
  '5000': 'AMACC_GL_500', '5010': 'AMACC_GL_501', '5100': 'AMACC_GL_510',
  '5200': 'AMACC_GL_520', '6000': 'AMACC_GL_600', '6010': 'AMACC_GL_610',
  '6200': 'AMACC_GL_620', '6300': 'AMACC_GL_630', '6320': 'AMACC_GL_640',
  '6400': 'AMACC_GL_650', '6500': 'AMACC_GL_660',
};

const CDK_MAP: Record<string, string> = {
  'CASH': 'AMACC_GL_100', 'PAYRL': 'AMACC_GL_101', 'ARTRDE': 'AMACC_GL_110',
  'ARFACT': 'AMACC_GL_111', 'NVINV': 'AMACC_GL_120', 'UVINV': 'AMACC_GL_121',
  'PTINV': 'AMACC_GL_130', 'APTRD': 'AMACC_GL_200', 'NVFP': 'AMACC_GL_210',
  'UVFP': 'AMACC_GL_211', 'ACCPY': 'AMACC_GL_220', 'OWNEQ': 'AMACC_GL_300',
  'RETEARN': 'AMACC_GL_310', 'NVSALE': 'AMACC_GL_400', 'UVSALE': 'AMACC_GL_401',
  'SVCLBR': 'AMACC_GL_410', 'PTSSALE': 'AMACC_GL_420',
};

const MAPPING_TABLES: Partial<Record<DMSType, Record<string, string>>> = {
  AUTOMATE: AUTOMATE_MAP,
  CDK: CDK_MAP,
};

export class StandardLegacyGLMapper implements ILegacyGLMapper {
  private readonly accountsByCode: Map<string, CanonicalGLAccount>;

  constructor() {
    this.accountsByCode = new Map();
    for (const acct of STANDARD_COA.accounts) {
      this.accountsByCode.set(acct.amaccCode, acct);
    }
  }

  mapLegacyGL(legacyCode: string, dmsType: DMSType, _tenantId: TenantId): CanonicalGLAccount | UnmappedGLWarning {
    const table = MAPPING_TABLES[dmsType] ?? {};
    const amaccCode = table[legacyCode];
    if (amaccCode) {
      const acct = this.accountsByCode.get(amaccCode);
      if (acct) return acct;
    }
    return { legacyCode, legacyName: '', reason: `No mapping found for ${dmsType} account ${legacyCode}` };
  }

  bulkMap(legacyAccounts: LegacyGLAccount[], dmsType: DMSType, tenantId: TenantId): LegacyMappingResult {
    const mapped: LegacyMappingResult['mapped'] = [];
    const unmapped: UnmappedGLWarning[] = [];
    for (const legacy of legacyAccounts) {
      const result = this.mapLegacyGL(legacy.legacyCode, dmsType, tenantId);
      if ('amaccCode' in result) {
        mapped.push({ legacy, canonical: result });
      } else {
        unmapped.push({ ...result, legacyName: legacy.legacyName });
      }
    }
    return { mapped, unmapped };
  }
}
