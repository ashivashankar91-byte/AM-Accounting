import { injectable, inject } from 'tsyringe';
import crypto from 'crypto';
import { withSerializableRetry } from '../lib/serializable-retry';
import { EVENT_FAMILY } from '../domain/account-mapping-roles';
import { NotFoundError } from '../domain/errors';
import { AccountMappingService } from './account-mapping-service';
import { LaborRateService } from './labor-rate-service';
import { PostingEventProducer, SourceEventEnvelope } from '../infrastructure/posting-client';
import { appendAuditEvent } from '../infrastructure/audit';

export interface AbsorbTimeInput {
  tenantId: string; legalEntityId: string; techId: string; deptCode: string; payrollPeriodId: string;
  clockedHours: number | string; flaggedAppliedHours: number | string;
  businessDate: string;
  sourceEventId: string; correlationId: string; actor: string;
}

export interface ReverseAbsorptionInput {
  tenantId: string; legalEntityId: string; techId: string; payrollPeriodId: string;
  reason?: string | null; actor: string; correlationId: string; sourceEventId: string;
}

/** S063 — books labor-cost absorption effects from operational time data
 * only. Zero payroll/wage calculation (CE-13/WD-01 scope). Period-idempotent.
 *
 * Approved unapplied-time absorption policy (gap-closure): hours are
 * converted to dollars via an effective-dated, tenant-configured BURDENED
 * labor-cost rate (LaborRateService) — technician-specific, else
 * department-default, no dealership-wide fallback. A rate gap rejects
 * (RATE_GAP) before any posting-engine call or DB write — zero WIP/
 * operational mutation. The resolved rate/source/effective-date/amount are
 * captured on the row so a later reversal can reuse them verbatim rather
 * than re-resolving a possibly-changed rate. Never the customer labor
 * selling rate. */
@injectable()
export class TechTimeService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('PostingEventProducer') private readonly postingClient: PostingEventProducer,
    @inject(AccountMappingService) private readonly mappingService: AccountMappingService,
    @inject(LaborRateService) private readonly rateService: LaborRateService,
  ) {}

  /** Governed ceremony — mirrors LaborRateService.setRate's upsert-by-
   * natural-key shape. Closes a pre-existing gap: TechGuaranteeConfig had
   * no write path anywhere, so shortfallHours was always 0. */
  async setGuaranteeConfig(input: {
    tenantId: string; legalEntityId: string; techId: string;
    guaranteedHoursPerPeriod: number | string; effectiveFrom: string; actor: string;
  }) {
    const row = await this.prisma.techGuaranteeConfig.upsert({
      where: {
        tenantId_legalEntityId_techId_effectiveFrom: {
          tenantId: input.tenantId, legalEntityId: input.legalEntityId,
          techId: input.techId, effectiveFrom: new Date(input.effectiveFrom),
        },
      },
      create: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId, techId: input.techId,
        guaranteedHoursPerPeriod: input.guaranteedHoursPerPeriod,
        effectiveFrom: new Date(input.effectiveFrom), createdBy: input.actor,
      },
      update: { guaranteedHoursPerPeriod: input.guaranteedHoursPerPeriod },
    });
    await appendAuditEvent(this.prisma, {
      tenantId: input.tenantId, docType: 'TECH_GUARANTEE_CONFIG', docId: row.id, action: 'SET',
      actor: input.actor, after: row,
    });
    return row;
  }

  async listGuaranteeConfig(tenantId: string, legalEntityId: string) {
    return this.prisma.techGuaranteeConfig.findMany({
      where: { tenantId, legalEntityId },
      orderBy: [{ techId: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  /** Inquiry — S063 gap-closure also closes the "no way to view absorption
   * history" gap (the UI needs a real list to render, not just create). */
  async listAbsorptions(tenantId: string, legalEntityId: string, techId?: string) {
    return this.prisma.techTimeAbsorption.findMany({
      where: { tenantId, legalEntityId, ...(techId ? { techId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listReversals(tenantId: string, techId?: string) {
    return this.prisma.techTimeAbsorptionReversal.findMany({
      where: { tenantId, ...(techId ? { techId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async absorb(input: AbsorbTimeInput) {
    const existing = await this.prisma.techTimeAbsorption.findFirst({
      where: { tenantId: input.tenantId, techId: input.techId, payrollPeriodId: input.payrollPeriodId },
    });
    if (existing) return { idempotent: true, ...existing };

    const clocked = Number(input.clockedHours);
    const flaggedApplied = Number(input.flaggedAppliedHours);
    const unapplied = Math.max(0, clocked - flaggedApplied);

    // Scoped by legal entity AND effective-dated (latest row on/before the
    // business date) — matches LaborRateService.resolveRate's discipline.
    // The pre-gap-closure version of this query ignored both legalEntityId
    // and effective-dating; unreachable in practice since no write path
    // existed, but fixed now that setGuaranteeConfig() makes it reachable.
    const guaranteeConfig = await this.prisma.techGuaranteeConfig.findFirst({
      where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, techId: input.techId, effectiveFrom: { lte: new Date(input.businessDate) } },
      orderBy: { effectiveFrom: 'desc' },
    });
    const guaranteedHours = Number(guaranteeConfig?.guaranteedHoursPerPeriod ?? 0);
    const shortfall = Math.max(0, guaranteedHours - flaggedApplied);

    // Rate resolution runs BEFORE the account-mapping check and BEFORE any
    // posting-engine call or DB write — a RATE_GAP is a domain-level guard,
    // exactly as unconditional as ACCOUNT_MAPPING_PENDING.
    const rate = await this.rateService.resolveRate(input.tenantId, input.legalEntityId, input.techId, input.deptCode, input.businessDate);
    const unappliedAmount = Math.round(unapplied * rate.rateAmount * 100) / 100;
    const shortfallAmount = Math.round(shortfall * rate.rateAmount * 100) / 100;

    await this.mappingService.assertFamilyResolved(input.tenantId, input.legalEntityId, EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION as any);

    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId: input.tenantId, eventType: 'fixedops.techtime.absorbed.v1', eventSchemaVersion: '1',
      occurredAt: now, publishedAt: now, sourceSystem: 'fixedops-service',
      sourceEntityType: 'PAYROLL_PERIOD', sourceEntityId: `${input.techId}:${input.payrollPeriodId}`,
      correlationId: input.correlationId, businessDate: input.businessDate,
      payload: {
        techId: input.techId, deptCode: input.deptCode, payrollPeriodId: input.payrollPeriodId,
        clockedHours: String(clocked), flaggedAppliedHours: String(flaggedApplied),
        unappliedHours: String(unapplied), guaranteedHours: String(guaranteedHours), shortfallHours: String(shortfall),
        unappliedAmount: unappliedAmount.toFixed(2), shortfallAmount: shortfallAmount.toFixed(2),
        rateSource: rate.rateSource, rateId: rate.rateId, rateAmount: String(rate.rateAmount),
      },
      metadata: { eventFamily: EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION },
    };
    const result = await this.postingClient.submit(envelope);

    return withSerializableRetry(this.prisma, async (tx) => {
      const row = await tx.techTimeAbsorption.create({
        data: {
          tenantId: input.tenantId, legalEntityId: input.legalEntityId, techId: input.techId, deptCode: input.deptCode,
          payrollPeriodId: input.payrollPeriodId,
          clockedHours: clocked, flaggedAppliedHours: flaggedApplied, unappliedHours: unapplied,
          guaranteedHours, shortfallHours: shortfall,
          rateId: rate.rateId, rateSource: rate.rateSource, rateAmount: rate.rateAmount, rateEffectiveFrom: new Date(rate.rateEffectiveFrom),
          unappliedAmount, shortfallAmount,
          sourceEventId: input.sourceEventId, correlationId: input.correlationId,
          status: result.status === 'POSTED' ? 'POSTED' : 'EXCEPTION',
          journalEntryId: result.journalEntryId ?? null,
        },
      });
      await appendAuditEvent(tx, {
        tenantId: input.tenantId, docType: 'TECH_TIME_ABSORPTION', docId: row.id, action: 'POSTED',
        actor: input.actor, after: row, correlationId: input.correlationId,
      });
      return { idempotent: false, ...row };
    });
  }

  /** Correction/reversal — byte-symmetric, reuses the ORIGINAL absorption's
   * captured rate/source/effective-date/amount verbatim. Never re-resolves
   * the current rate (which may have changed since), mirroring
   * RoReversalService's discipline. Period-idempotent on
   * (tenantId, techId, payrollPeriodId). */
  async reverse(input: ReverseAbsorptionInput) {
    const original = await this.prisma.techTimeAbsorption.findFirst({
      where: { tenantId: input.tenantId, techId: input.techId, payrollPeriodId: input.payrollPeriodId },
    });
    if (!original) throw new NotFoundError('TechTimeAbsorption', `${input.techId}:${input.payrollPeriodId}`);
    if (original.status !== 'POSTED' || !original.journalEntryId) {
      throw new NotFoundError('Posted TechTimeAbsorption', `${input.techId}:${input.payrollPeriodId}`);
    }

    const existing = await this.prisma.techTimeAbsorptionReversal.findFirst({
      where: { tenantId: input.tenantId, techId: input.techId, payrollPeriodId: input.payrollPeriodId },
    });
    if (existing) return { idempotent: true, ...existing };

    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId: input.tenantId, eventType: 'fixedops.techtime.absorption-reversed.v1', eventSchemaVersion: '1',
      occurredAt: now, publishedAt: now, sourceSystem: 'fixedops-service',
      sourceEntityType: 'PAYROLL_PERIOD', sourceEntityId: `${input.techId}:${input.payrollPeriodId}`,
      correlationId: input.correlationId, causationId: original.sourceEventId,
      businessDate: now.slice(0, 10),
      payload: {
        techId: input.techId, deptCode: original.deptCode, payrollPeriodId: input.payrollPeriodId,
        // The ORIGINAL captured amounts/rate — never re-derived.
        unappliedAmount: String(original.unappliedAmount), shortfallAmount: String(original.shortfallAmount),
        rateSource: original.rateSource, rateId: original.rateId, rateAmount: String(original.rateAmount),
        originalJournalEntryId: original.journalEntryId,
      },
      metadata: { eventFamily: EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION, reversalOf: original.sourceEventId },
    };
    const result = await this.postingClient.submit(envelope);

    return withSerializableRetry(this.prisma, async (tx) => {
      const status = result.status === 'POSTED' ? 'COMPLETED' : 'REFUSED';
      const row = await tx.techTimeAbsorptionReversal.create({
        data: {
          tenantId: input.tenantId, techTimeAbsorptionId: original.id, techId: input.techId, payrollPeriodId: input.payrollPeriodId,
          originalJournalEntryId: original.journalEntryId,
          reversalJournalEntryId: result.journalEntryId ?? null,
          sourceEventId: input.sourceEventId, correlationId: input.correlationId,
          status, reason: input.reason ?? (status === 'REFUSED' ? result.failureReason : null),
          actor: input.actor,
        },
      });
      await appendAuditEvent(tx, {
        tenantId: input.tenantId, docType: 'TECH_TIME_ABSORPTION_REVERSAL', docId: row.id, action: status,
        actor: input.actor, after: row, correlationId: input.correlationId,
        reason: `Reversal of tech-time absorption ${input.techId}:${input.payrollPeriodId}`,
      });
      return { idempotent: false, ...row };
    });
  }
}
