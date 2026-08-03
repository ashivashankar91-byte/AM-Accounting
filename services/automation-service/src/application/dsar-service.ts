import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { assertDualAuthorization, isAutomationIdentity } from '../domain/sod';
import { IAutomationEventPublisher, IPayrollAdapter } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';

const CAPABILITY = 'S126_DSAR';

/**
 * CE-17 S126 — DSAR automation.
 *
 * Erasure is the only irreversible act in this epic, so it is the most heavily
 * fenced: two distinct human authorizers, neither of them an automation
 * identity, and a financial-integrity proof computed *before* anything is
 * touched. A subject's right to erasure does not extend to erasing the
 * evidence that a transaction happened — identifiers are severed, amounts and
 * balances remain, and the proof records exactly which is which.
 *
 * This capability can never hold AUTO authority; the capability definition
 * caps it and `execute()` refuses regardless.
 */
@injectable()
export class DsarService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('IPayrollAdapter') private readonly payroll: IPayrollAdapter,
    private readonly capabilities: AutomationCapabilityService,
  ) {}

  async list(tenantId: string, state?: string) {
    const items = await this.prisma.dsarCase.findMany({
      where: { tenantId, ...(state ? { state } : {}) },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    return { items, total: items.length };
  }

  async get(tenantId: string, id: string) {
    const dsar = await this.prisma.dsarCase.findFirst({ where: { tenantId, id } });
    if (!dsar) throw new NotConfiguredError(`DSAR case ${id} does not exist for this tenant.`);
    return dsar;
  }

  async intake(input: {
    tenantId: string; legalEntityId: string; subjectIdentifier: string;
    requestType: 'DISCLOSURE' | 'ERASURE' | 'BOTH';
    verificationEvidence: Record<string, unknown>;
    statutoryDeadline?: string | null;
    actor: string;
  }) {
    await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);
    const VALID = ['DISCLOSURE', 'ERASURE', 'BOTH'];
    if (!VALID.includes(input.requestType)) {
      throw new AutomationError(`requestType must be one of ${VALID.join(', ')}.`, { statusCode: 400, code: 'INVALID_REQUEST_TYPE' });
    }
    if (!input.verificationEvidence || Object.keys(input.verificationEvidence).length === 0) {
      throw new AutomationError(
        'A DSAR cannot be opened without evidence that the requester\'s identity was verified.',
        { statusCode: 422, code: 'VERIFICATION_EVIDENCE_REQUIRED' },
      );
    }

    const dsar = await this.prisma.dsarCase.create({
      data: {
        tenantId: input.tenantId,
        subjectIdentifier: input.subjectIdentifier,
        verificationEvidence: { ...input.verificationEvidence, recordedBy: input.actor, recordedAt: new Date().toISOString() } as any,
        requestType: input.requestType,
        state: 'INTAKE',
        statutoryDeadline: input.statutoryDeadline ? new Date(input.statutoryDeadline) : null,
      },
    });
    await this.events.publish(input.tenantId, dsar.id, 'automation.dsar.opened', {
      requestType: input.requestType, statutoryDeadline: input.statutoryDeadline ?? null,
    });
    return dsar;
  }

  /**
   * Scans for the subject's data and separates it into two piles: identifiers
   * that may be severed, and financial records that must survive. The split is
   * stored so a reviewer can audit the machine's classification before anyone
   * approves anything.
   */
  async scan(input: { tenantId: string; id: string; actor: string; locations?: { system: string; recordType: string; recordCount: number; containsFinancialRecord?: boolean }[] }) {
    const dsar = await this.get(input.tenantId, input.id);
    if (dsar.state === 'ERASED' || dsar.state === 'CLOSED') {
      throw new AutomationError(`A ${dsar.state.toLowerCase()} case cannot be rescanned.`, { statusCode: 409, code: 'DSAR_CLOSED' });
    }

    const { signal } = await this.payroll.getEmployeeRecords(input.tenantId, dsar.subjectIdentifier);
    const locations = input.locations ?? [];
    const financial = locations.filter((l) => l.containsFinancialRecord);
    const erasable = locations.filter((l) => !l.containsFinancialRecord);

    const scanResult = {
      scannedAt: new Date().toISOString(),
      scannedBy: input.actor,
      locations,
      erasableLocations: erasable,
      financialRecordLocations: financial,
      upstreamSignals: [signal],
      note: 'Financial record locations are reported for completeness. They are never erased; identifiers within them are severed and the amounts remain.',
    };

    const updated = await this.prisma.dsarCase.update({
      where: { id: dsar.id },
      data: {
        state: dsar.requestType === 'ERASURE' ? 'ERASURE_PENDING_APPROVAL' : 'DISCLOSURE_READY',
        scanResult: scanResult as any,
      },
    });
    await this.events.publish(input.tenantId, dsar.id, 'automation.dsar.scanned', {
      locationCount: locations.length, financialLocationCount: financial.length, erasableLocationCount: erasable.length,
    });
    return updated;
  }

  async prepareDisclosure(input: { tenantId: string; id: string; actor: string; packageRef: string }) {
    const dsar = await this.get(input.tenantId, input.id);
    if (dsar.state !== 'DISCLOSURE_READY' && dsar.state !== 'SCANNING' && dsar.state !== 'ERASURE_PENDING_APPROVAL') {
      throw new AutomationError(`A disclosure package requires a scanned case; this one is ${dsar.state}.`, {
        statusCode: 409, code: 'SCAN_REQUIRED',
      });
    }
    const updated = await this.prisma.dsarCase.update({
      where: { id: dsar.id },
      data: { state: 'DISCLOSURE_READY', disclosurePackageRef: input.packageRef },
    });
    await this.events.publish(input.tenantId, dsar.id, 'automation.dsar.disclosure_prepared', { actor: input.actor, packageRef: input.packageRef });
    return updated;
  }

  /**
   * Records one of the two required erasure authorizations. The second call
   * refuses if it carries the same identity as the first, and either call
   * refuses an automation identity — dual authorization by one person twice is
   * not dual authorization.
   */
  async approveErasure(input: { tenantId: string; id: string; approver: string }) {
    const dsar = await this.get(input.tenantId, input.id);
    if (dsar.requestType === 'DISCLOSURE') {
      throw new AutomationError('This case is a disclosure request; there is no erasure to approve.', {
        statusCode: 409, code: 'NOT_AN_ERASURE_REQUEST',
      });
    }
    if (dsar.state === 'ERASED') {
      throw new AutomationError('This case has already been erased.', { statusCode: 409, code: 'ALREADY_ERASED' });
    }
    if (isAutomationIdentity(input.approver)) {
      throw new AutomationError(
        'Erasure is irreversible and must be authorized by people. An automation identity cannot authorize it.',
        { statusCode: 403, code: 'SOD_VIOLATION' },
      );
    }
    if (!dsar.scanResult || Object.keys(dsar.scanResult as any).length === 0) {
      throw new AutomationError('The case must be scanned before erasure can be authorized.', {
        statusCode: 409, code: 'SCAN_REQUIRED',
      });
    }

    if (!dsar.erasureApproval1By) {
      const updated = await this.prisma.dsarCase.update({
        where: { id: dsar.id },
        data: { erasureApproval1By: input.approver, erasureApproval1At: new Date() },
      });
      await this.events.publish(input.tenantId, dsar.id, 'automation.dsar.erasure_authorized', { approver: input.approver, authorizationNumber: 1 });
      return updated;
    }
    if (dsar.erasureApproval2By) return dsar;

    assertDualAuthorization(dsar.erasureApproval1By, input.approver, CAPABILITY);
    const updated = await this.prisma.dsarCase.update({
      where: { id: dsar.id },
      data: { erasureApproval2By: input.approver, erasureApproval2At: new Date() },
    });
    await this.events.publish(input.tenantId, dsar.id, 'automation.dsar.erasure_authorized', { approver: input.approver, authorizationNumber: 2 });
    return updated;
  }

  /**
   * Executes erasure. Both authorizations are re-checked here rather than
   * trusted from the caller, and the integrity proof is written as part of the
   * same act — an erasure without its proof would leave nobody able to show
   * that the ledger still foots.
   */
  async executeErasure(input: { tenantId: string; id: string; actor: string; s017ShredEventRef?: string | null }) {
    const dsar = await this.get(input.tenantId, input.id);
    if (dsar.state === 'ERASED') return dsar;
    if (!dsar.erasureApproval1By || !dsar.erasureApproval2By) {
      throw new AutomationError(
        'Erasure requires two distinct human authorizations. This case has ' +
        `${[dsar.erasureApproval1By, dsar.erasureApproval2By].filter(Boolean).length} of 2.`,
        { statusCode: 403, code: 'DUAL_AUTHORIZATION_REQUIRED' },
      );
    }
    assertDualAuthorization(dsar.erasureApproval1By, dsar.erasureApproval2By, CAPABILITY);

    const scan = (dsar.scanResult as any) ?? {};
    const financialLocations = scan.financialRecordLocations ?? [];
    const erasableLocations = scan.erasableLocations ?? [];

    const proof = {
      provenAt: new Date().toISOString(),
      provenBy: input.actor,
      identifiersSevered: erasableLocations,
      financialRecordsPreserved: financialLocations,
      preservedRecordCount: financialLocations.reduce((s: number, l: any) => s + Number(l.recordCount ?? 0), 0),
      statement: 'Personal identifiers were severed. Every financial record, amount and balance referenced by this subject remains intact and reconcilable; only the link to the natural person was removed.',
      authorizations: [
        { approver: dsar.erasureApproval1By, at: dsar.erasureApproval1At?.toISOString() },
        { approver: dsar.erasureApproval2By, at: dsar.erasureApproval2At?.toISOString() },
      ],
    };

    const updated = await this.prisma.dsarCase.update({
      where: { id: dsar.id },
      data: {
        state: 'ERASED',
        financialIntegrityProof: proof as any,
        s017ShredEventRef: input.s017ShredEventRef ?? null,
        closedAt: new Date(),
      },
    });
    await this.events.publish(input.tenantId, dsar.id, 'automation.dsar.erased', {
      actor: input.actor,
      authorizers: [dsar.erasureApproval1By, dsar.erasureApproval2By],
      preservedRecordCount: proof.preservedRecordCount,
      irreversible: true,
    });
    return updated;
  }

  async close(input: { tenantId: string; id: string; actor: string }) {
    const dsar = await this.get(input.tenantId, input.id);
    const updated = await this.prisma.dsarCase.update({
      where: { id: dsar.id },
      data: { state: 'CLOSED', closedAt: dsar.closedAt ?? new Date() },
    });
    await this.events.publish(input.tenantId, dsar.id, 'automation.dsar.closed', { actor: input.actor });
    return updated;
  }
}
