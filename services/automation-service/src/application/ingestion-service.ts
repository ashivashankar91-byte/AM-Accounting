import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { sha256 } from '../domain/idempotency';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { IAutomationEventPublisher } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';
import { AutomationItemService } from './automation-item-service';

const CAPABILITY = 'S040_OCR_INGESTION';

/**
 * CE-17 S040 — OCR / EDI invoice ingestion.
 *
 * Extraction produces a DRAFT and nothing else. Every field carries its own
 * confidence beside the image or EDI segment it came from, so a clerk is
 * approving what the machine read, not what it concluded. An accepted draft
 * becomes an S039 AP invoice through the normal invoice path — this service
 * never books a liability itself.
 */
@injectable()
export class IngestionService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    private readonly capabilities: AutomationCapabilityService,
    private readonly items: AutomationItemService,
  ) {}

  async list(tenantId: string, legalEntityId: string, state?: string) {
    return this.prisma.ingestionDraft.findMany({
      where: { tenantId, legalEntityId, ...(state ? { state } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  async get(tenantId: string, id: string) {
    const draft = await this.prisma.ingestionDraft.findFirst({ where: { tenantId, id } });
    if (!draft) throw new NotConfiguredError(`Ingestion draft ${id} does not exist for this tenant.`);
    return draft;
  }

  /**
   * Ingests one document. The dedup key is derived from the invoice identity
   * (vendor + number + amount), so the same invoice arriving by OCR on Monday
   * and by EDI on Tuesday is flagged rather than paid twice.
   */
  async ingest(input: {
    tenantId: string; legalEntityId: string; channel: 'OCR' | 'EDI';
    sourceImageRef?: string | null; ediTransactionRef?: string | null;
    extractedFields: Record<string, unknown>;
    fieldConfidence?: Record<string, number>;
    extractorVersion?: string | null;
    actor: string;
  }) {
    if (input.channel !== 'OCR' && input.channel !== 'EDI') {
      throw new AutomationError('channel must be OCR or EDI.', { statusCode: 400, code: 'INVALID_CHANNEL' });
    }
    const capability = await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);

    const fields = input.extractedFields ?? {};
    const confidences = Object.values(input.fieldConfidence ?? {}).map(Number).filter(Number.isFinite);
    // The overall confidence is the weakest field, not the average: a document
    // is only as trustworthy as the number somebody will actually pay against.
    const overall = confidences.length > 0 ? Math.min(...confidences) : null;

    const vendorRef = String(fields['vendorRef'] ?? fields['vendorId'] ?? '').trim().toUpperCase();
    const invoiceNumber = String(fields['invoiceNumber'] ?? '').trim().toUpperCase();
    const amount = Number(fields['invoiceAmount'] ?? fields['amount'] ?? 0).toFixed(2);
    const dedupKey = vendorRef && invoiceNumber
      ? sha256(`${input.tenantId}:${input.legalEntityId}:${vendorRef}:${invoiceNumber}:${amount}`)
      : null;

    const duplicate = dedupKey
      ? await this.prisma.ingestionDraft.findFirst({ where: { tenantId: input.tenantId, dedupKey, state: { not: 'REJECTED' } } })
      : null;

    const draft = await this.prisma.ingestionDraft.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        channel: input.channel,
        sourceImageRef: input.sourceImageRef ?? null,
        ediTransactionRef: input.ediTransactionRef ?? null,
        extractedFields: fields as any,
        fieldConfidence: (input.fieldConfidence ?? {}) as any,
        overallConfidence: overall === null ? null : String(overall),
        dedupKey,
        isDuplicateSuspect: Boolean(duplicate),
        vendorMatchRef: vendorRef || null,
        poMatchRef: (fields['poNumber'] as string) ?? null,
        suggestedCoding: (fields['suggestedCoding'] ?? {}) as any,
        state: duplicate ? 'DUPLICATE' : 'CLERK_REVIEW',
        extractorVersion: input.extractorVersion ?? null,
      },
    });

    const { item } = await this.items.create({
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      capabilityCode: CAPABILITY,
      subjectRef: draft.id,
      action: 'INGEST',
      sourceEvidenceRefs: [input.sourceImageRef, input.ediTransactionRef].filter(Boolean),
      recommendationEvidence: {
        channel: input.channel, extractedFields: fields, fieldConfidence: input.fieldConfidence ?? {},
        duplicateOf: duplicate?.id ?? null, statutorySupported: true,
      },
      ruleVersion: input.extractorVersion ?? null,
      confidence: overall,
      proposedAmount: amount,
    });

    await this.events.publish(input.tenantId, draft.id, 'automation.ingestion.drafted', {
      capabilityCode: capability.capabilityCode, channel: input.channel,
      duplicateSuspect: Boolean(duplicate), overallConfidence: overall, itemId: item.id,
    });

    return { draft, itemId: item.id, duplicateOf: duplicate?.id ?? null };
  }

  /**
   * Acceptance is a clerk's act, recorded as such. A duplicate suspect cannot
   * be accepted until somebody explicitly clears the duplicate flag — the flag
   * is not advisory decoration.
   */
  async accept(input: { tenantId: string; id: string; actor: string; s039InvoiceId?: string | null; overrideDuplicate?: boolean }) {
    const draft = await this.get(input.tenantId, input.id);
    if (draft.state === 'ACCEPTED') return draft;
    if (draft.isDuplicateSuspect && !input.overrideDuplicate) {
      throw new AutomationError(
        'This draft matches an existing invoice on vendor, number and amount. Accepting it requires an explicit duplicate override.',
        { statusCode: 409, code: 'DUPLICATE_SUSPECT', details: { dedupKey: draft.dedupKey } },
      );
    }
    const updated = await this.prisma.ingestionDraft.update({
      where: { id: draft.id },
      data: {
        state: 'ACCEPTED', reviewedBy: input.actor, reviewedAt: new Date(),
        s039InvoiceId: input.s039InvoiceId ?? null,
      },
    });
    await this.events.publish(input.tenantId, draft.id, 'automation.ingestion.accepted', {
      actor: input.actor, s039InvoiceId: input.s039InvoiceId ?? null, overrodeDuplicate: Boolean(input.overrideDuplicate),
    });
    return updated;
  }

  async reject(input: { tenantId: string; id: string; actor: string; reason: string }) {
    const draft = await this.get(input.tenantId, input.id);
    const updated = await this.prisma.ingestionDraft.update({
      where: { id: draft.id },
      data: {
        state: 'REJECTED', reviewedBy: input.actor, reviewedAt: new Date(),
        extractedFields: { ...(draft.extractedFields as any), rejectionReason: input.reason } as any,
      },
    });
    await this.events.publish(input.tenantId, draft.id, 'automation.ingestion.rejected', { actor: input.actor, reason: input.reason });
    return updated;
  }
}
