import { inject, injectable } from 'tsyringe';

// ── Constants ────────────────────────────────────────────────────────────────

/** Existing authz-catalog roles only — no new role is invented here. */
export const APPROVAL_ROLE_VALUES = ['ADMIN', 'CONTROLLER', 'ACCOUNTANT'] as const;

/** Sentinel required-role used when a tenant has configured no rules at
 * all — the conservative default (see resolveTiers doc comment). */
export const ANY_APPROVER_ROLE = 'ANY_APPROVER';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface ApprovalTier {
  sequence: number;
  requiredRole: string;
  thresholdAmount: number;
}

export interface CreateApprovalRuleDTO {
  tenantId: string;
  thresholdAmount: number;
  requiredRole: string;
  sequence: number;
}

export interface UpdateApprovalRuleDTO {
  thresholdAmount?: number;
  requiredRole?: string;
  isActive?: boolean;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class ApprovalRuleNotFoundError extends Error {
  constructor(id: string) {
    super(`Approval rule not found: ${id}`);
    this.name = 'ApprovalRuleNotFoundError';
  }
}

export class ApprovalRuleValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ApprovalRuleValidationError';
  }
}

export class ApprovalRuleConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ApprovalRuleConflictError';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * S041 — tenant-configurable invoice approval matrix. No dollar threshold or
 * approval policy is ever hard-coded: a tenant with no configured rules gets
 * the conservative fallback of exactly one ANY_APPROVER tier (see
 * resolveTiers) — never zero required approvals.
 */
@injectable()
export class ApprovalRuleService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async list(tenantId: string) {
    return this.prisma.apInvoiceApprovalRule.findMany({ where: { tenantId }, orderBy: { sequence: 'asc' } });
  }

  async create(dto: CreateApprovalRuleDTO, actor = 'system') {
    if (!(APPROVAL_ROLE_VALUES as readonly string[]).includes(dto.requiredRole)) {
      throw new ApprovalRuleValidationError('INVALID_ROLE', `requiredRole must be one of ${APPROVAL_ROLE_VALUES.join(', ')}`);
    }
    if (dto.thresholdAmount < 0) {
      throw new ApprovalRuleValidationError('INVALID_THRESHOLD', 'thresholdAmount must be >= 0');
    }
    const existing = await this.prisma.apInvoiceApprovalRule.findFirst({ where: { tenantId: dto.tenantId, sequence: dto.sequence } });
    if (existing) {
      throw new ApprovalRuleConflictError('SEQUENCE_ALREADY_EXISTS', `A rule at sequence ${dto.sequence} already exists for this tenant`);
    }
    return this.prisma.apInvoiceApprovalRule.create({
      data: { tenantId: dto.tenantId, thresholdAmount: String(dto.thresholdAmount), requiredRole: dto.requiredRole, sequence: dto.sequence, isActive: true },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateApprovalRuleDTO) {
    const current = await this.prisma.apInvoiceApprovalRule.findFirst({ where: { id, tenantId } });
    if (!current) throw new ApprovalRuleNotFoundError(id);
    if (dto.requiredRole && !(APPROVAL_ROLE_VALUES as readonly string[]).includes(dto.requiredRole)) {
      throw new ApprovalRuleValidationError('INVALID_ROLE', `requiredRole must be one of ${APPROVAL_ROLE_VALUES.join(', ')}`);
    }
    const data: any = {};
    if (dto.thresholdAmount !== undefined) data.thresholdAmount = String(dto.thresholdAmount);
    if (dto.requiredRole !== undefined) data.requiredRole = dto.requiredRole;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.apInvoiceApprovalRule.update({ where: { id }, data });
  }

  /**
   * Resolves the ordered list of approval tiers applicable to an invoice of
   * the given total amount. If the tenant has configured no ACTIVE rules,
   * OR the amount is below every configured threshold, the conservative
   * default (a single ANY_APPROVER tier at sequence 1) applies — an invoice
   * is never auto-approved with zero required approvals.
   */
  async resolveTiers(tenantId: string, totalAmount: number): Promise<ApprovalTier[]> {
    const rules = await this.prisma.apInvoiceApprovalRule.findMany({
      where: { tenantId, isActive: true },
      orderBy: { sequence: 'asc' },
    });

    const applicable = rules
      .filter((r: any) => totalAmount >= Number(r.thresholdAmount))
      .map((r: any) => ({ sequence: r.sequence, requiredRole: r.requiredRole, thresholdAmount: Number(r.thresholdAmount) }));

    if (applicable.length === 0) {
      return [{ sequence: 1, requiredRole: ANY_APPROVER_ROLE, thresholdAmount: 0 }];
    }
    return applicable;
  }
}
