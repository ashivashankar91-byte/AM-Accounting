import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { sha256 } from '../domain/idempotency';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { isAutomationIdentity } from '../domain/sod';
import { IAutomationEventPublisher, IMigrationBaselineClient } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';

const CAPABILITY = 'S107_COMPOSITE_EXPORT';

/**
 * CE-17 S107 — NCM / NADA composite export.
 *
 * This service prepares a file and retains it as evidence. It does not
 * transmit: "SUBMITTED_EXPORT" means the file left through a human's hands and
 * somebody recorded the response, not that this system talked to NCM. The
 * export hash is stamped at generation so the artefact that was approved is
 * provably the artefact that was retained.
 */
@injectable()
export class CompositeExportService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('IMigrationBaselineClient') private readonly baseline: IMigrationBaselineClient,
    private readonly capabilities: AutomationCapabilityService,
  ) {}

  async list(tenantId: string, legalEntityId: string, state?: string) {
    const items = await this.prisma.compositeExport.findMany({
      where: { tenantId, legalEntityId, ...(state ? { state } : {}) },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }], take: 200,
    });
    return { items, total: items.length };
  }

  async get(tenantId: string, id: string) {
    const exp = await this.prisma.compositeExport.findFirst({ where: { tenantId, id } });
    if (!exp) throw new NotConfiguredError(`Composite export ${id} does not exist for this tenant.`);
    return exp;
  }

  /**
   * Generates the export.
   *
   * A format profile version is mandatory. Producing a composite file against
   * an unknown layout would be worse than producing nothing: the receiving
   * organisation would treat malformed columns as real numbers.
   */
  async generate(input: {
    tenantId: string; legalEntityId: string; exportType: string;
    formatProfileVersion: string; periodYear: number; periodMonth: number;
    rows?: Record<string, unknown>[];
    actor: string;
  }) {
    await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);
    const VALID = ['NCM', 'NADA', 'TWENTY_GROUP'];
    if (!VALID.includes(input.exportType)) {
      throw new AutomationError(`exportType must be one of ${VALID.join(', ')}.`, { statusCode: 400, code: 'INVALID_EXPORT_TYPE' });
    }
    if (!input.formatProfileVersion) {
      throw new AutomationError(
        'A composite export cannot be generated without a format profile version. The layout is not guessed.',
        { statusCode: 422, code: 'FORMAT_PROFILE_NOT_CONFIGURED' },
      );
    }

    const existing = await this.prisma.compositeExport.findFirst({
      where: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId, exportType: input.exportType,
        periodYear: input.periodYear, periodMonth: input.periodMonth,
        state: { in: ['GENERATED', 'APPROVED', 'SUBMITTED_EXPORT'] },
      },
    });
    if (existing) return existing;

    const rows = input.rows ?? [];
    const payload = JSON.stringify({
      exportType: input.exportType, formatProfileVersion: input.formatProfileVersion,
      period: `${input.periodYear}-${String(input.periodMonth).padStart(2, '0')}`,
      rows,
    });
    const exportHash = sha256(payload);
    const exportFileRef = `automation/exports/${input.legalEntityId}/${input.exportType}/${input.periodYear}${String(input.periodMonth).padStart(2, '0')}-${exportHash.slice(0, 12)}.json`;

    const created = await this.prisma.compositeExport.create({
      data: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId,
        exportType: input.exportType, formatProfileVersion: input.formatProfileVersion,
        periodYear: input.periodYear, periodMonth: input.periodMonth,
        state: 'GENERATED', exportFileRef, exportHash, generatedBy: input.actor,
        retentionRef: exportFileRef,
      },
    });

    await this.events.publish(input.tenantId, created.id, 'automation.export.generated', {
      exportType: input.exportType, periodYear: input.periodYear, periodMonth: input.periodMonth,
      exportHash, rowCount: rows.length, transmitted: false,
    });
    return created;
  }

  async approve(input: { tenantId: string; id: string; approver: string }) {
    const exp = await this.get(input.tenantId, input.id);
    if (exp.state !== 'GENERATED') {
      throw new AutomationError(`Only a generated export can be approved; this one is ${exp.state}.`, {
        statusCode: 409, code: 'INVALID_EXPORT_STATE',
      });
    }
    if (isAutomationIdentity(input.approver)) {
      throw new AutomationError('A composite export must be approved by a person.', { statusCode: 403, code: 'SOD_VIOLATION' });
    }
    if (exp.generatedBy === input.approver) {
      throw new AutomationError(
        'The person who generated an export may not also approve it.',
        { statusCode: 403, code: 'SOD_VIOLATION' },
      );
    }
    const updated = await this.prisma.compositeExport.update({
      where: { id: exp.id },
      data: { state: 'APPROVED', approvedBy: input.approver, approvedAt: new Date() },
    });
    await this.events.publish(input.tenantId, exp.id, 'automation.export.approved', {
      approver: input.approver, exportHash: exp.exportHash, exportType: exp.exportType,
    });
    return updated;
  }

  /**
   * Records what happened after a human sent the file. This is a bookkeeping
   * entry about an external act, which is why it takes a response record and
   * performs no network call of its own.
   */
  async recordResponse(input: { tenantId: string; id: string; actor: string; response: Record<string, unknown> }) {
    const exp = await this.get(input.tenantId, input.id);
    if (exp.state !== 'APPROVED' && exp.state !== 'SUBMITTED_EXPORT') {
      throw new AutomationError(
        `A response can only be recorded against an approved export; this one is ${exp.state}.`,
        { statusCode: 409, code: 'INVALID_EXPORT_STATE' },
      );
    }
    const updated = await this.prisma.compositeExport.update({
      where: { id: exp.id },
      data: {
        state: 'SUBMITTED_EXPORT',
        responseRecord: { ...input.response, recordedBy: input.actor, recordedAt: new Date().toISOString() } as any,
      },
    });
    await this.events.publish(input.tenantId, exp.id, 'automation.export.response_recorded', {
      actor: input.actor, exportType: exp.exportType, exportHash: exp.exportHash,
    });
    return updated;
  }

  /**
   * Composite figures are only meaningful against a known migration baseline;
   * when CE-16 has no baseline for the entity we say so rather than exporting
   * numbers nobody can anchor.
   */
  async baselineStatus(tenantId: string, legalEntityId: string) {
    return this.baseline.describe(tenantId, legalEntityId);
  }
}
