// CE-13 / S025 — Payroll+Close GL mapping rule-pack governance.
//
// Versioned matrix rows under approved S023-style discipline: author !=
// activator, one ACTIVE version per packKey per tenant, blank rows are
// valid (ACCOUNT_MAPPING_VALUES_PENDING — ships with every row named but
// glAccountCode left null until Accounting configures it), simulate
// returns the blueprint for every row without requiring activation first.
//
// This does NOT duplicate coa-service's generic S019/S020 posting-engine
// DSL (services/coa-service/src/domain/posting-engine) — it is payroll's
// OWN mapping-table governance, versioning which PayrollGLMapping rows a
// given run/accrual/commission journal is entitled to cite
// (rulePackVersionId pinned on PayrollBatch/AccrualEntry/etc.).
import { PrismaClient } from '.prisma/payroll-client';
import { inject, injectable } from 'tsyringe';
import { TenantId } from '@amacc/shared-kernel';

export interface RulePackRow {
  family: string; // 'EARNINGS' | 'EMPLOYER_LIABILITY' | 'WITHHOLDING_LIABILITY' | 'CLEARING' | 'ACCRUAL' | 'COMMISSION_EXPENSE' | 'COMMISSION_PAYABLE' | 'CLAWBACK' | 'FLAG_ABSORPTION'
  department: string;
  payComponent: string;
  glAccountCode: string | null; // null = ACCOUNT_MAPPING_VALUES_PENDING (blank row, valid)
  isDebit: boolean;
}

export class RulePackActivationError extends Error {
  readonly status = 422;
  readonly code = 'RULE_PACK_ACTIVATION_NOT_ELIGIBLE';
  constructor(message: string) { super(message); this.name = 'RulePackActivationError'; }
}

export class RulePackAuthorEqualsActivatorError extends Error {
  readonly status = 403;
  readonly code = 'RULE_PACK_SOD_VIOLATION';
  constructor() {
    super('The rule-pack author cannot also activate the same version (author != activator).');
    this.name = 'RulePackAuthorEqualsActivatorError';
  }
}

@injectable()
export class PayrollRulePackService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async createDraft(tenantId: TenantId, packKey: string, rows: RulePackRow[], author: string) {
    const latest = await (this.prisma as any).payrollRulePackVersion.findFirst({
      where: { tenantId, packKey },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;
    return (this.prisma as any).payrollRulePackVersion.create({
      data: { tenantId, packKey, version, rows: rows as any, author, status: 'DRAFT' },
    });
  }

  async listVersions(tenantId: TenantId, packKey?: string) {
    return (this.prisma as any).payrollRulePackVersion.findMany({
      where: { tenantId, ...(packKey && { packKey }) },
      orderBy: [{ packKey: 'asc' }, { version: 'desc' }],
    });
  }

  /** Simulate: returns the blueprint (rows) for a version without requiring activation. */
  async simulate(tenantId: TenantId, versionId: string) {
    const version = await (this.prisma as any).payrollRulePackVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!version) throw new Error(`Rule pack version ${versionId} not found`);
    const rows = version.rows as RulePackRow[];
    const pending = rows.filter((r) => !r.glAccountCode);
    return {
      versionId: version.id,
      packKey: version.packKey,
      version: version.version,
      status: version.status,
      rows,
      pendingMappingCount: pending.length,
      pendingRows: pending,
    };
  }

  async validate(tenantId: TenantId, versionId: string) {
    const version = await (this.prisma as any).payrollRulePackVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!version) throw new Error(`Rule pack version ${versionId} not found`);
    const rows = version.rows as RulePackRow[];
    const errors: string[] = [];
    if (rows.length === 0) errors.push('Rule pack must have at least one row');
    for (const r of rows) {
      if (!r.family || !r.department || !r.payComponent) errors.push(`Row missing family/department/payComponent: ${JSON.stringify(r)}`);
    }
    const valid = errors.length === 0;
    await (this.prisma as any).payrollRulePackVersion.update({
      where: { id: versionId },
      data: { status: valid ? 'VALIDATED' : 'DRAFT', validatedAt: valid ? new Date() : null },
    });
    return { valid, errors };
  }

  /** author != activator enforced (S023 SoD discipline). Activating supersedes the prior ACTIVE version for the same packKey. */
  async activate(tenantId: TenantId, versionId: string, activatedBy: string) {
    const version = await (this.prisma as any).payrollRulePackVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!version) throw new Error(`Rule pack version ${versionId} not found`);
    if (version.status !== 'VALIDATED') {
      throw new RulePackActivationError(`Version must be VALIDATED before activation; current status: ${version.status}`);
    }
    if (version.author === activatedBy) {
      throw new RulePackAuthorEqualsActivatorError();
    }
    const now = new Date();
    return (this.prisma as any).$transaction(async (tx: any) => {
      await tx.payrollRulePackVersion.updateMany({
        where: { tenantId, packKey: version.packKey, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED', supersededAt: now },
      });
      return tx.payrollRulePackVersion.update({
        where: { id: versionId },
        data: { status: 'ACTIVE', activatedBy, activatedAt: now },
      });
    });
  }

  async getActiveVersion(tenantId: TenantId, packKey: string) {
    return (this.prisma as any).payrollRulePackVersion.findFirst({ where: { tenantId, packKey, status: 'ACTIVE' } });
  }
}
