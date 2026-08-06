import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { isAutomationIdentity } from '../domain/sod';
import { IAutomationEventPublisher, IVehicleDealAdapter } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';
import { AutomationItemService } from './automation-item-service';

const CAPABILITY = 'S095_PORTFOLIO_RESERVE';

/**
 * CE-17 S095 — retro / portfolio reserve accrual.
 *
 * A statement is entered with its evidence reference, allocated across deals
 * by a configured basis, previewed, approved, and only then posted through the
 * governed path. The allocation basis is never invented here: if the tenant
 * has not defined one, the statement stays in ENTERED and says so.
 */
@injectable()
export class PortfolioReserveService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('IVehicleDealAdapter') private readonly deals: IVehicleDealAdapter,
    private readonly capabilities: AutomationCapabilityService,
    private readonly items: AutomationItemService,
  ) {}

  async list(tenantId: string, legalEntityId: string, state?: string) {
    const items = await this.prisma.portfolioStatement.findMany({
      where: { tenantId, legalEntityId, ...(state ? { state } : {}) },
      orderBy: { statementDate: 'desc' }, take: 200,
    });
    const { signal } = await this.deals.getDealCohorts(tenantId, legalEntityId, new Date(0), new Date());
    return { items, total: items.length, upstreamSignal: signal };
  }

  async get(tenantId: string, id: string) {
    const statement = await this.prisma.portfolioStatement.findFirst({ where: { tenantId, id } });
    if (!statement) throw new NotConfiguredError(`Portfolio statement ${id} does not exist for this tenant.`);
    return statement;
  }

  async enter(input: {
    tenantId: string; legalEntityId: string; statementDate: string; lenderRef: string;
    totalAmount: string | number; evidenceRef: string; allocationBasis: string; actor: string;
  }) {
    await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);
    if (!input.evidenceRef) {
      throw new AutomationError(
        'A portfolio statement requires an evidence reference to the source document.',
        { statusCode: 422, code: 'STATEMENT_EVIDENCE_REQUIRED' },
      );
    }
    if (!input.allocationBasis) {
      throw new AutomationError(
        'An allocation basis must be configured before a statement can be entered; this service does not choose one for you.',
        { statusCode: 422, code: 'ALLOCATION_BASIS_NOT_CONFIGURED' },
      );
    }
    const statement = await this.prisma.portfolioStatement.create({
      data: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId,
        statementDate: new Date(input.statementDate), lenderRef: input.lenderRef,
        totalAmount: String(input.totalAmount), evidenceRef: input.evidenceRef,
        allocationBasis: input.allocationBasis, state: 'ENTERED',
      },
    });
    await this.events.publish(input.tenantId, statement.id, 'automation.portfolio.statement_entered', {
      lenderRef: input.lenderRef, totalAmount: String(input.totalAmount), allocationBasis: input.allocationBasis,
    });
    return statement;
  }

  /**
   * Allocates the statement total across deals and stores the result as a
   * preview. Rounding remainder is assigned to the largest weight so the
   * allocation sums exactly to the statement total — an allocation that does
   * not foot is not an allocation.
   */
  async allocate(input: {
    tenantId: string; id: string; actor: string;
    weights?: { dealRef: string; weight: string | number }[];
  }) {
    const statement = await this.get(input.tenantId, input.id);
    if (statement.state === 'POSTED') {
      throw new AutomationError('This statement has been posted and cannot be reallocated.', { statusCode: 409, code: 'STATEMENT_POSTED' });
    }

    let weights = input.weights ?? [];
    let upstreamStatus = 'CALLER_SUPPLIED';
    if (weights.length === 0) {
      const { signal, cohorts } = await this.deals.getDealCohorts(input.tenantId, statement.legalEntityId, new Date(0), statement.statementDate);
      upstreamStatus = signal.status;
      weights = (cohorts as any[]).map((c) => ({ dealRef: String(c.cohortKey), weight: Number(c.originatedAmount ?? 0) }));
      if (weights.length === 0) {
        throw new AutomationError(
          signal.status === 'AVAILABLE'
            ? 'There are no deals to allocate this statement across.'
            : `Deal data is unavailable, so this statement cannot be allocated: ${signal.detail}`,
          { statusCode: 422, code: 'MODEL_OR_RULE_UNAVAILABLE', details: { upstreamSignal: signal } },
        );
      }
    }

    const totalWeight = weights.reduce((s, w) => s + Number(w.weight), 0);
    if (!(totalWeight > 0)) {
      throw new AutomationError('Allocation weights sum to zero; the statement cannot be apportioned.', {
        statusCode: 422, code: 'INVALID_ALLOCATION_WEIGHTS',
      });
    }

    const totalCents = Math.round(Number(statement.totalAmount.toString()) * 100);
    const sorted = [...weights].sort((a, b) => Number(b.weight) - Number(a.weight));
    let assigned = 0;
    const allocations = sorted.map((w, idx) => {
      const cents = idx === sorted.length - 1
        ? totalCents - assigned
        : Math.round((Number(w.weight) / totalWeight) * totalCents);
      assigned += idx === sorted.length - 1 ? 0 : cents;
      return { dealRef: w.dealRef, weight: String(w.weight), amount: (cents / 100).toFixed(2) };
    });

    const updated = await this.prisma.portfolioStatement.update({
      where: { id: statement.id },
      data: { state: 'ALLOCATED', allocations: { basis: statement.allocationBasis, upstreamStatus, lines: allocations } as any },
    });
    await this.events.publish(input.tenantId, statement.id, 'automation.portfolio.allocated', {
      lineCount: allocations.length, totalAmount: statement.totalAmount.toString(), posted: false,
    });
    return updated;
  }

  async approve(input: { tenantId: string; id: string; approver: string; reserveAccountCode: string; offsetAccountCode: string }) {
    const statement = await this.get(input.tenantId, input.id);
    if (statement.state !== 'ALLOCATED') {
      throw new AutomationError(
        `A statement must be allocated before approval; this one is ${statement.state}.`,
        { statusCode: 409, code: 'ALLOCATION_REQUIRED' },
      );
    }
    if (isAutomationIdentity(input.approver)) {
      throw new AutomationError('A portfolio reserve accrual must be approved by a person.', { statusCode: 403, code: 'SOD_VIOLATION' });
    }

    const amount = statement.totalAmount.toString();
    const { item } = await this.items.create({
      tenantId: input.tenantId,
      legalEntityId: statement.legalEntityId,
      capabilityCode: CAPABILITY,
      subjectRef: statement.id,
      action: 'POST_RESERVE',
      sourceEvidenceRefs: [statement.evidenceRef],
      recommendationEvidence: {
        lenderRef: statement.lenderRef, allocationBasis: statement.allocationBasis,
        allocations: statement.allocations, statutorySupported: true,
        postingLines: [
          { accountCode: input.offsetAccountCode, debit: amount, credit: '0.00', memo: `Portfolio reserve ${statement.lenderRef}` },
          { accountCode: input.reserveAccountCode, debit: '0.00', credit: amount, memo: `Portfolio reserve ${statement.lenderRef}` },
        ],
      },
      proposedAmount: amount,
    });
    const approved = await this.items.approve(input.tenantId, item.id, input.approver, 'Portfolio reserve approved');

    const updated = await this.prisma.portfolioStatement.update({
      where: { id: statement.id },
      data: { state: 'APPROVED', approvedBy: input.approver, approvedAt: new Date(), postingItemId: approved.id },
    });
    await this.events.publish(input.tenantId, statement.id, 'automation.portfolio.approved', {
      approver: input.approver, itemId: approved.id, amount,
    });
    return updated;
  }
}
