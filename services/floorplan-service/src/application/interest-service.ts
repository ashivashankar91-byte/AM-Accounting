// S082 — Floorplan Interest & Curtailments (interest half). Interest
// figures come from lender statements — ENTERED/fed evidence via
// enterStatement(), NEVER computed/invented by this service. Allocation of
// the entered figure to units/departments is this service's OWN
// deterministic bp split (domain/allocation.ts), per a configured basis
// (SAFE_CONFIGURATION — FloorplanTenantConfig.defaultAllocationBasis, or a
// per-statement override). Accrual posts via the rule pack; the payment
// settlement leg is a CE-09 concept — PENDING_UPSTREAM_TECHNICAL_
// RECONCILIATION (see postAccrual's doc comment) — only the accrual side is
// built here, per the epic package's explicit instruction.
import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'crypto';
import { appendAuditReference } from '../infrastructure/audit';
import { buildEnvelope } from '../domain/envelope';
import { EVENT_TYPES, EVENT_SCHEMA_VERSION } from '../domain/event-types';
import { splitEqual, splitBalanceWeighted } from '../domain/allocation';
import { PostingOrchestrator } from './posting-orchestrator';
import { PostingEngineClient } from '../infrastructure/posting-engine-client';
import { POSTING_ENGINE_CLIENT_TOKEN } from './posting-orchestrator';
import { FloorplanValidationError, FloorplanNotFoundError, ReversalReasonRequiredError } from '../domain/errors';
import type { AllocationBasis } from './tenant-config-service';

const FIXED_INTEREST_DEPT_CODE = 'FLRPLN';

@injectable()
export class InterestService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject(PostingOrchestrator) private readonly postingOrchestrator: PostingOrchestrator,
    @inject(POSTING_ENGINE_CLIENT_TOKEN) private readonly postingEngine: PostingEngineClient,
  ) {}

  async enterStatement(
    tenantId: string,
    input: { lenderCode: string; statementDate: string; totalInterestAmount: string; allocationBasis?: AllocationBasis; idempotencyKey: string },
    actor: string,
  ) {
    if (!input.lenderCode?.trim()) throw new FloorplanValidationError('lenderCode is required.');
    if (!input.statementDate) throw new FloorplanValidationError('statementDate is required.');
    if (!input.totalInterestAmount || Number(input.totalInterestAmount) <= 0) throw new FloorplanValidationError('totalInterestAmount must be a positive decimal string.');
    if (!input.idempotencyKey?.trim()) throw new FloorplanValidationError('idempotencyKey is required.');

    const existing = await this.prisma.floorplanInterestStatement.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing;

    const tenantConfig = await this.prisma.floorplanTenantConfig.findUnique({ where: { tenantId } });
    const basis = input.allocationBasis ?? tenantConfig?.defaultAllocationBasis ?? 'PER_UNIT_EQUAL';

    const created = await this.prisma.floorplanInterestStatement.create({
      data: {
        id: randomUUID(),
        tenantId,
        lenderCode: input.lenderCode,
        statementDate: new Date(input.statementDate),
        totalInterestAmount: input.totalInterestAmount,
        allocationBasis: basis,
        status: 'ENTERED',
        enteredBy: actor,
        idempotencyKey: input.idempotencyKey,
      },
    });

    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_INTEREST_STATEMENT',
      entityId: created.id,
      eventType: 'floorplan.interest_statement.entered',
      actor,
      after: created,
    });

    return created;
  }

  /** S082 AC: "interest allocation's sum across units/departments equals
   * the entered statement figure exactly" — enforced by construction
   * (splitEqual/splitBalanceWeighted always return an exact-sum partition,
   * see domain/allocation.ts's largest-remainder method). */
  async allocate(tenantId: string, statementId: string, actor: string) {
    const statement = await this.getStatement(tenantId, statementId);
    if (statement.status !== 'ENTERED') {
      throw new FloorplanValidationError(`Statement ${statementId} is not in ENTERED status (currently ${statement.status}) — cannot re-allocate.`);
    }

    const openItems = await this.prisma.floorplanLiabilityItem.findMany({
      where: { tenantId, lenderCode: statement.lenderCode, status: { in: ['OPEN', 'PARTIALLY_RELIEVED'] } },
    });
    if (openItems.length === 0) {
      throw new FloorplanValidationError(`No open floorplan liability items for lender ${statement.lenderCode} — nothing to allocate interest across.`);
    }

    const total = statement.totalInterestAmount.toString();
    const results =
      statement.allocationBasis === 'PER_UNIT_BALANCE_WEIGHTED'
        ? splitBalanceWeighted(total, openItems.map((i: any) => ({ key: i.id, balance: i.remainingBalance.toString() })))
        : splitEqual(total, openItems.map((i: any) => i.id));

    const allocations = await this.prisma.$transaction(
      results.map((r) => {
        const item = openItems.find((i: any) => i.id === r.key);
        return this.prisma.floorplanInterestAllocation.create({
          data: {
            id: randomUUID(),
            tenantId,
            statementId,
            itemId: item.id,
            vin: item.vin,
            stockNumber: item.stockNumber,
            deptCode: FIXED_INTEREST_DEPT_CODE,
            bp: r.bp,
            allocatedAmount: r.amount,
          },
        });
      }),
    );

    await this.prisma.floorplanInterestStatement.update({ where: { id: statementId }, data: { status: 'ALLOCATED' } });

    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_INTEREST_STATEMENT',
      entityId: statementId,
      eventType: 'floorplan.interest_statement.allocated',
      actor,
      after: { allocationCount: allocations.length, basis: statement.allocationBasis },
    });

    return allocations;
  }

  /**
   * Posts the accrual journal (DR Floorplan Interest Expense / CR Floorplan
   * Interest Accrued Payable) for the statement's total figure — ONE
   * journal per statement, not one per allocation line (allocation to
   * units/departments is this service's own reporting breakdown, not N
   * separate GL lines; see domain/allocation.ts's doc comment on why this
   * is DSL-compatible).
   *
   * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION: the payment/cash-settlement
   * leg for this accrual is a CE-09 concept (Accounts Payable / disbursement)
   * not yet integrated into this branch. Only the accrual side is posted
   * here; a future CE-09-integrated payment flow would relieve the accrued-
   * payable account this accrual credits, via CE-09's own payment posting —
   * out of scope for floorplan-service per the epic package's explicit
   * instruction ("mark that specific cash-settlement linkage
   * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION").
   */
  async postAccrual(tenantId: string, statementId: string, actor: string) {
    const statement = await this.getStatement(tenantId, statementId);
    if (statement.status !== 'ALLOCATED') {
      throw new FloorplanValidationError(`Statement ${statementId} must be ALLOCATED before its accrual can post (currently ${statement.status}).`);
    }

    const envelope = buildEnvelope(tenantId, {
      eventType: EVENT_TYPES.INTEREST_ACCRUAL,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      sourceEntityType: 'FLOORPLAN_INTEREST_STATEMENT',
      sourceEntityId: statementId,
      correlationId: statementId,
      businessDate: statement.statementDate.toISOString().slice(0, 10),
      deterministicEventId: `${statementId}:accrual`,
      payload: { lenderCode: statement.lenderCode, statementId, totalAmount: statement.totalInterestAmount.toString() },
    });

    const { submitResult, deadLetterId } = await this.postingOrchestrator.postAndRecover(envelope, {
      postingIdempotencyKey: `${tenantId}:${envelope.eventId}`,
      sourceTransactionId: statementId,
    });

    const status = submitResult.status === 'POSTED' ? 'POSTED' : submitResult.status === 'NO_RULE_MATCH' ? 'REJECTED' : submitResult.status;
    const updated = await this.prisma.floorplanInterestStatement.update({
      where: { id: statementId },
      data: {
        status,
        postingExecutionId: submitResult.executionId,
        journalEntryId: submitResult.journalEntryId,
        journalNumber: submitResult.journalNumber,
        failureReason: submitResult.failureReason,
      },
    });

    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_INTEREST_STATEMENT',
      entityId: statementId,
      eventType: 'floorplan.interest_statement.accrual_posted',
      actor,
      after: { status, journalNumber: submitResult.journalNumber, failureReason: submitResult.failureReason, deadLetterId },
    });

    return updated;
  }

  /** S218 — symmetric reversal. Reason required (enforced here even though
   * coa-service's own schema treats reason as optional — CE-12's accrual
   * reversal AC requires it). */
  async reverseAccrual(tenantId: string, statementId: string, reason: string, actor: string) {
    if (!reason?.trim()) throw new ReversalReasonRequiredError();
    const statement = await this.getStatement(tenantId, statementId);
    if (statement.status !== 'POSTED') {
      throw new FloorplanValidationError(`Statement ${statementId} is not POSTED (currently ${statement.status}) — nothing to reverse.`);
    }
    if (!statement.journalEntryId) {
      throw new FloorplanValidationError(`Statement ${statementId} has no journalEntryId recorded — cannot reverse.`);
    }

    const reversal = await this.postingEngine.reverseJournal(tenantId, { journalEntryId: statement.journalEntryId, reason });

    const updated = await this.prisma.floorplanInterestStatement.update({
      where: { id: statementId },
      data: { status: 'REVERSED', reversalJournalEntryId: reversal.id, reversalJournalNumber: reversal.journalNumber, reversalReason: reason, reversedAt: new Date() },
    });

    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_INTEREST_STATEMENT',
      entityId: statementId,
      eventType: 'floorplan.interest_statement.accrual_reversed',
      actor,
      before: { status: 'POSTED', journalNumber: statement.journalNumber },
      after: { status: 'REVERSED', reversalJournalNumber: reversal.journalNumber, reason },
    });

    return updated;
  }

  async getStatement(tenantId: string, statementId: string) {
    const row = await this.prisma.floorplanInterestStatement.findFirst({ where: { tenantId, id: statementId }, include: { allocations: true } });
    if (!row) throw new FloorplanNotFoundError(`No interest statement ${statementId}.`);
    return row;
  }

  async listStatements(tenantId: string, filters: { lenderCode?: string; status?: string } = {}) {
    return this.prisma.floorplanInterestStatement.findMany({
      where: { tenantId, ...(filters.lenderCode ? { lenderCode: filters.lenderCode } : {}), ...(filters.status ? { status: filters.status } : {}) },
      orderBy: { statementDate: 'desc' },
    });
  }
}
