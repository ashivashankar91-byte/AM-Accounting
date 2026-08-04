import 'reflect-metadata';
import { inject, injectable } from 'tsyringe';
import type { IEventPublisher } from '@amacc/shared-kernel';
import { IYearEndRepository } from '../domain/interfaces';
import { buildYearEndIdempotencyKey } from '../domain/year-end-engine';

@injectable()
export class YearEndService {
  constructor(
    @inject('IYearEndRepository') private readonly repo: IYearEndRepository,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  async preview(tenantId: string, legalEntityId: string, fiscalYear: number, initiatedBy: string) {
    const idempotencyKey = buildYearEndIdempotencyKey(tenantId, legalEntityId, fiscalYear);
    return this.repo.createPreview(tenantId, { legalEntityId, fiscalYear, initiatedBy, idempotencyKey, previewData: {} });
  }

  async approve(tenantId: string, id: string, approvedBy: string) { return this.repo.approve(tenantId, id, approvedBy); }

  /**
   * Post the year-end retained-earnings roll.
   *
   * Governed-posting flow:
   *   YearEndService.post()
   *   → YEAR_END_RETAINED_EARNINGS_CLOSE_INITIATED event (canonical, versioned)
   *   → close_outbox_events table (written inside the same DB transaction by repo)
   *   → outbox poller publishes to amacc.events exchange
   *   → CE-07 posting engine (posting-recovery-service / coa-service) consumes
   *     and posts the authoritative GL journal
   *   → JOURNAL_ENTRY_POSTED
   *
   * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION: exact routing-key subscription
   * in posting-recovery-service will be wired when CE-07 reconciliation runs.
   */
  async post(tenantId: string, id: string, postedBy: string) {
    const run = await this.repo.post(tenantId, id, postedBy, `pending-je-${id}`);
    // Publish canonical versioned event to outbox (idempotent: eventId = run id)
    await this.events.publish({
      type: 'CE15_YEAR_END_RETAINED_EARNINGS_INITIATED',
      tenantId,
      correlationId: id,
      occurredAt: new Date(),
      payload: {
        yearEndRunId: id,
        postedBy,
        idempotencyKey: run?.idempotencyKey ?? `ye-${id}`,
        schemaVersion: 1,
        // Governed-mapping rule: account codes resolved by rule-pack at posting time;
        // not hardcoded here.
        rulePack: { version: 'ce15-year-end-v1', label: 'CE-15 Year-End Retained Earnings (certification fixture)' },
        // PENDING_UPSTREAM_TECHNICAL_RECONCILIATION: exact debit/credit mapping
        // requires CEA rule-pack version reconciliation with coa-service.
        mappingStatus: 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION',
      },
    });
    return run;
  }
}
