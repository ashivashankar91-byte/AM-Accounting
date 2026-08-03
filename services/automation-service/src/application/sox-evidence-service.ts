import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { sha256 } from '../domain/idempotency';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { assertAttestationSoD, AUTOMATION_IDENTITY } from '../domain/sod';
import { IAutomationEventPublisher, ICloseReadinessClient } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';

const CAPABILITY = 'S128_SOX_EVIDENCE';

/**
 * CE-17 S128 — SOX evidence automation.
 *
 * Evidence is harvested, never manufactured. A control with no evidence
 * produces a binder in EXCEPTION carrying an explicit missing-evidence flag,
 * because a binder that quietly omits what it could not find is worse than no
 * binder at all: it reads as a clean control.
 *
 * Assembled binders are hashed and thereafter immutable. Attestation is a
 * separate human act by somebody who did not assemble the binder.
 */
@injectable()
export class SoxEvidenceService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('ICloseReadinessClient') private readonly close: ICloseReadinessClient,
    private readonly capabilities: AutomationCapabilityService,
  ) {}

  async listControls(tenantId: string) {
    const items = await this.prisma.controlRegistry.findMany({ where: { tenantId }, orderBy: { controlCode: 'asc' } });
    return { items, total: items.length };
  }

  async upsertControl(input: {
    tenantId: string; controlCode: string; controlName: string; controlType: string;
    systemMapping?: Record<string, unknown>; evidenceQuery?: string | null; active?: boolean;
  }) {
    const VALID = ['SOD', 'APPROVAL_CEREMONY', 'TIE_OUT', 'CLOSE_SIGN_OFF', 'RLS_ATTESTATION'];
    if (!VALID.includes(input.controlType)) {
      throw new AutomationError(`controlType must be one of ${VALID.join(', ')}.`, { statusCode: 400, code: 'INVALID_CONTROL_TYPE' });
    }
    return this.prisma.controlRegistry.upsert({
      where: { tenantId_controlCode: { tenantId: input.tenantId, controlCode: input.controlCode } },
      create: {
        tenantId: input.tenantId, controlCode: input.controlCode, controlName: input.controlName,
        controlType: input.controlType, systemMapping: (input.systemMapping ?? {}) as any,
        evidenceQuery: input.evidenceQuery ?? null, active: input.active ?? true,
      },
      update: {
        controlName: input.controlName, controlType: input.controlType,
        systemMapping: (input.systemMapping ?? {}) as any,
        evidenceQuery: input.evidenceQuery ?? null, active: input.active ?? true,
      },
    });
  }

  async listBinders(tenantId: string, legalEntityId: string, periodYear?: number, periodMonth?: number) {
    const items = await this.prisma.evidenceBinder.findMany({
      where: { tenantId, legalEntityId, ...(periodYear ? { periodYear } : {}), ...(periodMonth ? { periodMonth } : {}) },
      include: { control: true },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }], take: 300,
    });
    return { items, total: items.length };
  }

  async getBinder(tenantId: string, id: string) {
    const binder = await this.prisma.evidenceBinder.findFirst({ where: { tenantId, id }, include: { control: true } });
    if (!binder) throw new NotConfiguredError(`Evidence binder ${id} does not exist for this tenant.`);
    return binder;
  }

  /**
   * Harvests evidence for every active control in the period.
   *
   * The evidence is drawn from what this system actually recorded: grant and
   * activation pairs for approval-ceremony controls, approver-vs-automation
   * identity pairs for SoD controls, close status from CE-15 for sign-off
   * controls. Anything the harvest cannot substantiate becomes a flag.
   */
  async assembleBinders(input: {
    tenantId: string; legalEntityId: string; periodYear: number; periodMonth: number; actor: string;
  }) {
    await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);

    const controls = await this.prisma.controlRegistry.findMany({ where: { tenantId: input.tenantId, active: true } });
    if (controls.length === 0) {
      throw new AutomationError(
        'No active controls are registered. Register the control set before assembling binders.',
        { statusCode: 422, code: 'CONTROL_REGISTRY_NOT_CONFIGURED' },
      );
    }

    const periodStart = new Date(Date.UTC(input.periodYear, input.periodMonth - 1, 1));
    const periodEnd = new Date(Date.UTC(input.periodYear, input.periodMonth, 1));

    const assembled = [];
    for (const control of controls) {
      const existing = await this.prisma.evidenceBinder.findFirst({
        where: {
          tenantId: input.tenantId, legalEntityId: input.legalEntityId, controlId: control.id,
          periodYear: input.periodYear, periodMonth: input.periodMonth,
        },
      });
      // A hashed binder is immutable evidence; reassembly would break the seal.
      if (existing && existing.binderHash) { assembled.push(existing); continue; }

      const records: any[] = [];
      const missing: string[] = [];

      if (control.controlType === 'APPROVAL_CEREMONY') {
        const grants = await this.prisma.automationGrant.findMany({
          where: { tenantId: input.tenantId, grantedAt: { gte: periodStart, lt: periodEnd } },
        });
        for (const g of grants) {
          records.push({
            recordType: 'AUTHORITY_GRANT', recordId: g.id,
            fromAuthority: g.fromAuthority, toAuthority: g.toAuthority,
            grantedBy: g.grantedBy, activatedBy: g.activatedBy,
            separationHeld: Boolean(g.activatedBy) && g.activatedBy !== g.grantedBy,
            at: g.grantedAt.toISOString(),
          });
        }
        if (grants.length === 0) missing.push('No authority grants occurred in the period; the control had no operations to evidence.');
      } else if (control.controlType === 'SOD') {
        const approvals = await this.prisma.automationItem.findMany({
          where: {
            tenantId: input.tenantId, legalEntityId: input.legalEntityId,
            approvedAt: { gte: periodStart, lt: periodEnd },
          },
          take: 1000,
        });
        for (const a of approvals) {
          records.push({
            recordType: 'ITEM_APPROVAL', recordId: a.id, capabilityCode: a.capabilityCode,
            automationIdentity: a.automationIdentity, approvedBy: a.approvedBy,
            separationHeld: a.approvedBy !== a.automationIdentity,
            at: a.approvedAt?.toISOString(),
          });
        }
        const breaches = records.filter((r) => !r.separationHeld);
        if (breaches.length > 0) missing.push(`${breaches.length} approval(s) show the automation identity approving its own recommendation.`);
        if (approvals.length === 0) missing.push('No approvals occurred in the period; the control had no operations to evidence.');
      } else if (control.controlType === 'CLOSE_SIGN_OFF') {
        const closed = await this.close.isPeriodClosed(input.tenantId, input.legalEntityId, input.periodYear, input.periodMonth);
        if (closed === null) {
          missing.push('Close status is unavailable from CE-15; sign-off could not be evidenced.');
        } else {
          records.push({ recordType: 'CLOSE_STATUS', periodClosed: closed, source: 'CE-15 close-service' });
          if (!closed) missing.push('The period is not closed; there is no sign-off to evidence.');
        }
      } else if (control.controlType === 'TIE_OUT') {
        const executions = await this.prisma.automationExecution.findMany({
          where: { tenantId: input.tenantId, createdAt: { gte: periodStart, lt: periodEnd } },
          take: 1000,
        });
        for (const e of executions) {
          records.push({
            recordType: 'EXECUTION', recordId: e.id, outcome: e.outcome,
            journalEntryId: e.journalEntryId, idempotencyKey: e.idempotencyKey,
            governedPath: Boolean(e.postingExecutionId || e.journalEntryId) || e.outcome !== 'EXECUTED',
            at: e.createdAt.toISOString(),
          });
        }
        const ungoverned = records.filter((r) => r.governedPath === false);
        if (ungoverned.length > 0) missing.push(`${ungoverned.length} execution(s) lack a governed posting reference.`);
        if (executions.length === 0) missing.push('No executions occurred in the period; the control had no operations to evidence.');
      } else if (control.controlType === 'RLS_ATTESTATION') {
        const rows = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
              AND c.relname IN ('automation_capabilities','automation_items','automation_executions','policy_gates','dsar_cases','evidence_binders')`,
        );
        for (const r of rows) {
          records.push({ recordType: 'RLS_STATUS', table: r.table_name, rlsEnabled: r.rls_enabled === true });
        }
        const disabled = records.filter((r) => r.rlsEnabled === false).map((r) => r.table);
        if (disabled.length > 0) missing.push(`Row-level security is not enabled on: ${disabled.join(', ')}.`);
        if (rows.length === 0) missing.push('RLS status could not be read from the catalog.');
      }

      const state = missing.length > 0 ? 'EXCEPTION' : 'COMPLETE';
      const binderHash = sha256(JSON.stringify({
        controlCode: control.controlCode, periodYear: input.periodYear, periodMonth: input.periodMonth, records, missing,
      }));

      const binder = existing
        ? await this.prisma.evidenceBinder.update({
          where: { id: existing.id },
          data: { state, evidenceRecords: records as any, missingEvidenceFlags: missing as any, binderHash, assembledBy: AUTOMATION_IDENTITY },
        })
        : await this.prisma.evidenceBinder.create({
          data: {
            tenantId: input.tenantId, legalEntityId: input.legalEntityId, controlId: control.id,
            periodYear: input.periodYear, periodMonth: input.periodMonth,
            state, evidenceRecords: records as any, missingEvidenceFlags: missing as any,
            binderHash, assembledBy: AUTOMATION_IDENTITY, s017ClassRef: 'SOX_EVIDENCE_7Y',
          },
        });
      assembled.push(binder);
    }

    await this.events.publish(input.tenantId, input.legalEntityId, 'automation.sox.binders_assembled', {
      periodYear: input.periodYear, periodMonth: input.periodMonth,
      binderCount: assembled.length,
      exceptionCount: assembled.filter((b) => b.state === 'EXCEPTION').length,
    });
    return { items: assembled, total: assembled.length };
  }

  /**
   * Attests a binder. The attester may not be the assembler and may not be an
   * automation identity, and an EXCEPTION binder cannot be attested at all —
   * signing off a control whose evidence is missing is precisely the act SOX
   * exists to prevent.
   */
  async attest(input: { tenantId: string; id: string; attestedBy: string }) {
    const binder = await this.getBinder(input.tenantId, input.id);
    if (binder.state === 'ATTESTED') return binder;
    if (binder.state === 'EXCEPTION') {
      throw new AutomationError(
        `This binder carries ${(binder.missingEvidenceFlags as any[])?.length ?? 0} missing-evidence flag(s) and cannot be attested until they are resolved.`,
        { statusCode: 422, code: 'MISSING_EVIDENCE', details: { missingEvidenceFlags: binder.missingEvidenceFlags } },
      );
    }
    if (binder.state !== 'COMPLETE') {
      throw new AutomationError(`Only a complete binder can be attested; this one is ${binder.state}.`, {
        statusCode: 409, code: 'BINDER_NOT_COMPLETE',
      });
    }
    assertAttestationSoD(binder.assembledBy ?? null, input.attestedBy, binder.id);

    const updated = await this.prisma.evidenceBinder.update({
      where: { id: binder.id },
      data: { state: 'ATTESTED', attestedBy: input.attestedBy, attestedAt: new Date() },
    });
    await this.events.publish(input.tenantId, binder.id, 'automation.sox.binder_attested', {
      controlCode: binder.control.controlCode, attestedBy: input.attestedBy, binderHash: binder.binderHash,
    });
    return updated;
  }
}
