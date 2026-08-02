import { inject, injectable } from 'tsyringe';
import type { IEventPublisher } from '@amacc/shared-kernel';
import { ICurrencyRepository } from '../domain/interfaces';
import { buildTranslationIdempotencyKey } from '../domain/translation-engine';

@injectable()
export class CurrencyService {
  constructor(
    @inject('ICurrencyRepository') private readonly repo: ICurrencyRepository,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  async getConfig(tenantId: string, legalEntityId: string) { return this.repo.getConfig(tenantId, legalEntityId); }
  async setConfig(tenantId: string, legalEntityId: string, data: any) { return this.repo.upsertConfig(tenantId, legalEntityId, data); }
  async addRate(tenantId: string, data: any) { return this.repo.addRate(tenantId, data); }
  async listRates(tenantId: string, params: any) { return this.repo.listRates(tenantId, params); }

  async previewTranslation(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number, _initiatedBy: string) {
    const idempotencyKey = buildTranslationIdempotencyKey(tenantId, legalEntityId, periodYear, periodMonth);
    return this.repo.createTranslationRun(tenantId, { legalEntityId, periodYear, periodMonth, idempotencyKey, ctaAmount: 0, previewData: {} });
  }

  async approveTranslation(tenantId: string, id: string, approvedBy: string) { return this.repo.approveTranslationRun(tenantId, id, approvedBy); }

  /**
   * Post currency translation.
   *
   * Governed-posting flow:
   *   CurrencyService.postTranslation()
   *   → ce15.currency.translation_post_initiated (canonical versioned event)
   *   → close_outbox_events
   *   → CE-07 posting engine consumes and posts CTA journal
   *   → JOURNAL_ENTRY_POSTED
   *
   * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION: CTA account mapping and
   * exact CE-07 consumer subscription wiring.
   */
  async postTranslation(tenantId: string, id: string, postedBy: string) {
    const run = await this.repo.postTranslationRun(tenantId, id, postedBy, `pending-je-trans-${id}`);
    await this.events.publish({
      type: 'CE15_CURRENCY_TRANSLATION_INITIATED',
      tenantId,
      correlationId: id,
      occurredAt: new Date(),
      payload: {
        translationRunId: id,
        postedBy,
        idempotencyKey: run?.idempotencyKey ?? `tr-${id}`,
        schemaVersion: 1,
        rulePack: { version: 'ce15-currency-v1', label: 'CE-15 Currency Translation (certification fixture)' },
        mappingStatus: 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION',
      },
    });
    return run;
  }
}
