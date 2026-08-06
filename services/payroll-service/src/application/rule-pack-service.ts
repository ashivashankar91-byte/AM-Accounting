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
import { LegalEntityReconciliationRequiredError } from '../domain/errors';
import { ICe07RulePackRegistrar } from '../infrastructure/ce07-rule-pack-registrar';

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

/** Stable, per-(legalEntity, payroll packKey, event kind) CE-07 rule-pack packKey — see ce07-rule-pack-registrar.ts's doc-comment for why this must be STABLE (not per-version) so CE-07's own activation correctly supersedes the prior version instead of leaving two ACTIVE versions ambiguously matching the same event. */
function ce07PackKey(packKey: string, kind: 'PAYROLL_BATCH_POSTED' | 'PAYROLL_BATCH_REVERSED'): string {
  return `payroll-${packKey}-${kind === 'PAYROLL_BATCH_POSTED' ? 'posted' : 'reversed'}`;
}

@injectable()
export class PayrollRulePackService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('ICe07RulePackRegistrar') private readonly ce07Registrar: ICe07RulePackRegistrar,
  ) {}

  async createDraft(tenantId: TenantId, legalEntityId: string, packKey: string, rows: RulePackRow[], author: string, bearerToken: string | null) {
    if (!legalEntityId?.trim()) throw new LegalEntityReconciliationRequiredError('legalEntityId is required to draft a payroll rule pack.');
    const latest = await (this.prisma as any).payrollRulePackVersion.findFirst({
      where: { tenantId, legalEntityId, packKey },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;
    const semver = `${version}.0.0`;
    const effectiveFrom = new Date().toISOString();

    // fix(integration): draft the CE-07 shadow versions BEFORE persisting the
    // payroll draft row — if CE-07 refuses (e.g. malformed blueprint, real
    // permission denial), the payroll rule pack is never left in a state
    // that LOOKS draftable/activatable but can never actually govern a real
    // post. Both event kinds are drafted as the SAME real author identity
    // CE-07 will independently record as this version's creator.
    const [posted, reversed] = await Promise.all([
      this.ce07Registrar.draft({ bearerToken, tenantId, legalEntityId, kind: 'PAYROLL_BATCH_POSTED', packKey: ce07PackKey(packKey, 'PAYROLL_BATCH_POSTED'), semver, effectiveFrom }),
      this.ce07Registrar.draft({ bearerToken, tenantId, legalEntityId, kind: 'PAYROLL_BATCH_REVERSED', packKey: ce07PackKey(packKey, 'PAYROLL_BATCH_REVERSED'), semver, effectiveFrom }),
    ]);

    return (this.prisma as any).payrollRulePackVersion.create({
      data: {
        tenantId, legalEntityId, packKey, version, rows: rows as any, author, status: 'DRAFT',
        ce07PostedVersionId: posted.id, ce07ReversedVersionId: reversed.id,
      },
    });
  }

  async listVersions(tenantId: TenantId, packKey?: string, legalEntityId?: string | null) {
    return (this.prisma as any).payrollRulePackVersion.findMany({
      where: { tenantId, ...(packKey && { packKey }), ...(legalEntityId !== undefined && { legalEntityId }) },
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

  async validate(tenantId: TenantId, versionId: string, bearerToken: string | null) {
    const version = await (this.prisma as any).payrollRulePackVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!version) throw new Error(`Rule pack version ${versionId} not found`);
    const rows = version.rows as RulePackRow[];
    const errors: string[] = [];
    if (rows.length === 0) errors.push('Rule pack must have at least one row');
    for (const r of rows) {
      if (!r.family || !r.department || !r.payComponent) errors.push(`Row missing family/department/payComponent: ${JSON.stringify(r)}`);
    }

    // fix(integration): CE-07's OWN structural/semantic validation of the
    // shadow versions is also real evidence this payroll version is
    // actually postable, not just internally well-shaped — surfaced as
    // additional errors rather than silently ignored.
    if (errors.length === 0 && version.ce07PostedVersionId && version.ce07ReversedVersionId) {
      const [posted, reversed] = await Promise.all([
        this.ce07Registrar.validate({ bearerToken, tenantId, ce07VersionId: version.ce07PostedVersionId }),
        this.ce07Registrar.validate({ bearerToken, tenantId, ce07VersionId: version.ce07ReversedVersionId }),
      ]);
      if (!posted.valid) errors.push(`CE-07 posting-engine rejected the posted-event blueprint: ${JSON.stringify(posted.findings)}`);
      if (!reversed.valid) errors.push(`CE-07 posting-engine rejected the reversed-event blueprint: ${JSON.stringify(reversed.findings)}`);
    }

    const valid = errors.length === 0;
    await (this.prisma as any).payrollRulePackVersion.update({
      where: { id: versionId },
      data: { status: valid ? 'VALIDATED' : 'DRAFT', validatedAt: valid ? new Date() : null },
    });
    return { valid, errors };
  }

  /**
   * author != activator enforced (S023 SoD discipline). Activating
   * supersedes the prior ACTIVE version for the same packKey WITHIN THE
   * SAME LEGAL ENTITY only — fix(integration): activating entity A's rule
   * pack must never supersede entity B's active version of the same
   * packKey (the same class of legal-entity isolation defect CE-07 fixed
   * for its own posting-engine rule packs).
   */
  async activate(tenantId: TenantId, versionId: string, activatedBy: string, bearerToken: string | null) {
    const version = await (this.prisma as any).payrollRulePackVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!version) throw new Error(`Rule pack version ${versionId} not found`);
    if (!version.legalEntityId) {
      throw new LegalEntityReconciliationRequiredError(
        `Rule pack version ${versionId} has no legal entity on record and must be reconciled before it can be activated.`,
      );
    }
    if (version.status !== 'VALIDATED') {
      throw new RulePackActivationError(`Version must be VALIDATED before activation; current status: ${version.status}`);
    }
    if (version.author === activatedBy) {
      throw new RulePackAuthorEqualsActivatorError();
    }

    // fix(integration): activate the REAL CE-07 shadow versions FIRST, as
    // the activator's own real, forwarded identity — CE-07 independently
    // enforces its own author != activator SoD (the draft above ran as
    // `version.author`) and its own ADMIN-only activation permission tier.
    // A real refusal here (wrong role, CE-07 unreachable, etc.) means this
    // payroll version is NEVER flipped to ACTIVE — never a payroll-side
    // "ACTIVE" that cannot actually govern a real post.
    if (version.ce07PostedVersionId && version.ce07ReversedVersionId) {
      await this.ce07Registrar.validate({ bearerToken, tenantId, ce07VersionId: version.ce07PostedVersionId });
      await this.ce07Registrar.validate({ bearerToken, tenantId, ce07VersionId: version.ce07ReversedVersionId });
      await this.ce07Registrar.activate({ bearerToken, tenantId, ce07VersionId: version.ce07PostedVersionId });
      await this.ce07Registrar.activate({ bearerToken, tenantId, ce07VersionId: version.ce07ReversedVersionId });
    }

    const now = new Date();
    const activated = await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.payrollRulePackVersion.updateMany({
        where: { tenantId, legalEntityId: version.legalEntityId, packKey: version.packKey, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED', supersededAt: now },
      });
      return tx.payrollRulePackVersion.update({
        where: { id: versionId },
        data: { status: 'ACTIVE', activatedBy, activatedAt: now },
      });
    });
    // fix(integration) — audit this configuration change: rule-pack
    // activation is the highest-consequence payroll config action (it
    // governs which accounts a real GL posting actually writes to). Same
    // outbox convention PayrollAuditService already surfaces PAYROLL_BATCH_*
    // events from.
    await (this.prisma as any).outboxEvent.create({
      data: {
        eventType: 'PAYROLL_RULE_PACK_ACTIVATED', tenantId,
        payload: { versionId, legalEntityId: version.legalEntityId, packKey: version.packKey, version: version.version, author: version.author, activatedBy } as any,
      },
    });
    return activated;
  }

  async getActiveVersion(tenantId: TenantId, legalEntityId: string, packKey: string) {
    return (this.prisma as any).payrollRulePackVersion.findFirst({ where: { tenantId, legalEntityId, packKey, status: 'ACTIVE' } });
  }
}
