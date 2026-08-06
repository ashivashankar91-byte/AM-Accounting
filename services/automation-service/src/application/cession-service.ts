import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { isAutomationIdentity } from '../domain/sod';
import { IAutomationEventPublisher } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';
import { AutomationItemService } from './automation-item-service';

const CAPABILITY = 'S096_CESSION';

/**
 * CE-17 S096 — reinsurance / DOWC cession.
 *
 * This service records what the program administrator's statement says and
 * nothing more. It does not model treaties, it does not estimate cessions, and
 * it will not accept a statement without its evidence reference. Position
 * tracking is a record of the statement's figures, not an actuarial opinion.
 */
@injectable()
export class CessionService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    private readonly capabilities: AutomationCapabilityService,
    private readonly items: AutomationItemService,
  ) {}

  async list(tenantId: string, legalEntityId: string, state?: string) {
    const items = await this.prisma.cessionStatement.findMany({
      where: { tenantId, legalEntityId, ...(state ? { state } : {}) },
      orderBy: { statementDate: 'desc' }, take: 200,
    });
    return { items, total: items.length };
  }

  async get(tenantId: string, id: string) {
    const statement = await this.prisma.cessionStatement.findFirst({ where: { tenantId, id } });
    if (!statement) throw new NotConfiguredError(`Cession statement ${id} does not exist for this tenant.`);
    return statement;
  }

  async enter(input: {
    tenantId: string; legalEntityId: string; statementDate: string;
    programAdminRef: string; treatyCode: string;
    premiumCession: string | number; reserveCession: string | number; claimCession: string | number;
    statementEvidenceRef: string; actor: string;
  }) {
    await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);
    if (!input.statementEvidenceRef) {
      throw new AutomationError(
        'A cession statement requires an evidence reference to the administrator statement it came from.',
        { statusCode: 422, code: 'STATEMENT_EVIDENCE_REQUIRED' },
      );
    }
    const statement = await this.prisma.cessionStatement.create({
      data: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId,
        statementDate: new Date(input.statementDate),
        programAdminRef: input.programAdminRef, treatyCode: input.treatyCode,
        premiumCession: String(input.premiumCession),
        reserveCession: String(input.reserveCession),
        claimCession: String(input.claimCession),
        statementEvidenceRef: input.statementEvidenceRef,
        state: 'ENTERED',
      },
    });
    await this.events.publish(input.tenantId, statement.id, 'automation.cession.statement_entered', {
      treatyCode: input.treatyCode, programAdminRef: input.programAdminRef,
      premiumCession: String(input.premiumCession),
    });
    return statement;
  }

  async approve(input: {
    tenantId: string; id: string; approver: string;
    cededPremiumAccountCode: string; cededReserveAccountCode: string; offsetAccountCode: string;
  }) {
    const statement = await this.get(input.tenantId, input.id);
    if (statement.state === 'POSTED') return statement;
    if (isAutomationIdentity(input.approver)) {
      throw new AutomationError('A cession posting must be approved by a person.', { statusCode: 403, code: 'SOD_VIOLATION' });
    }

    const premium = statement.premiumCession.toString();
    const reserve = statement.reserveCession.toString();
    const total = (Number(premium) + Number(reserve)).toFixed(2);

    const { item } = await this.items.create({
      tenantId: input.tenantId,
      legalEntityId: statement.legalEntityId,
      capabilityCode: CAPABILITY,
      subjectRef: statement.id,
      action: 'POST_CESSION',
      sourceEvidenceRefs: [statement.statementEvidenceRef],
      recommendationEvidence: {
        treatyCode: statement.treatyCode, programAdminRef: statement.programAdminRef,
        premiumCession: premium, reserveCession: reserve, claimCession: statement.claimCession.toString(),
        statementDate: statement.statementDate.toISOString(), statutorySupported: true,
        note: 'Figures are taken verbatim from the administrator statement; no cession is estimated by this service.',
        postingLines: [
          { accountCode: input.cededPremiumAccountCode, debit: premium, credit: '0.00', memo: `Ceded premium ${statement.treatyCode}` },
          { accountCode: input.cededReserveAccountCode, debit: reserve, credit: '0.00', memo: `Ceded reserve ${statement.treatyCode}` },
          { accountCode: input.offsetAccountCode, debit: '0.00', credit: total, memo: `Cession settlement ${statement.treatyCode}` },
        ],
      },
      proposedAmount: total,
    });
    const approved = await this.items.approve(input.tenantId, item.id, input.approver, 'Cession statement approved');

    const updated = await this.prisma.cessionStatement.update({
      where: { id: statement.id },
      data: {
        state: 'APPROVED', approvedBy: input.approver, approvedAt: new Date(),
        postingItemId: approved.id,
        positionTrackingRef: `${statement.treatyCode}:${statement.statementDate.toISOString().slice(0, 10)}`,
      },
    });
    await this.events.publish(input.tenantId, statement.id, 'automation.cession.approved', {
      approver: input.approver, itemId: approved.id, amount: total, treatyCode: statement.treatyCode,
    });
    return updated;
  }

  /**
   * The ceded position is a roll-up of entered statements, presented with the
   * evidence references that produced it. Nothing is inferred for periods that
   * have no statement — a gap is shown as a gap.
   */
  async position(tenantId: string, legalEntityId: string, treatyCode?: string) {
    const statements = await this.prisma.cessionStatement.findMany({
      where: { tenantId, legalEntityId, ...(treatyCode ? { treatyCode } : {}) },
      orderBy: { statementDate: 'asc' },
    });
    if (statements.length === 0) {
      return { configured: false, detail: 'No cession statements have been entered for this scope.', treaties: [] };
    }
    const byTreaty = new Map<string, any>();
    for (const s of statements) {
      const key = s.treatyCode;
      const bucket = byTreaty.get(key) ?? {
        treatyCode: key, statementCount: 0,
        premiumCession: 0, reserveCession: 0, claimCession: 0,
        evidenceRefs: [] as string[], firstStatement: s.statementDate, lastStatement: s.statementDate,
      };
      bucket.statementCount += 1;
      bucket.premiumCession += Number(s.premiumCession.toString());
      bucket.reserveCession += Number(s.reserveCession.toString());
      bucket.claimCession += Number(s.claimCession.toString());
      bucket.evidenceRefs.push(s.statementEvidenceRef);
      bucket.lastStatement = s.statementDate;
      byTreaty.set(key, bucket);
    }
    return {
      configured: true,
      treaties: [...byTreaty.values()].map((b) => ({
        ...b,
        premiumCession: b.premiumCession.toFixed(2),
        reserveCession: b.reserveCession.toFixed(2),
        claimCession: b.claimCession.toFixed(2),
        netPosition: (b.premiumCession + b.reserveCession - b.claimCession).toFixed(2),
      })),
    };
  }
}
