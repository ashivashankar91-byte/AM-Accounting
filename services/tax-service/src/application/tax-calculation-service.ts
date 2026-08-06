import { injectable, inject } from 'tsyringe';
import { EngineRegistry } from '../domain/engines/engine-registry';
import { resolveEffectiveOne } from '../domain/effective-dating';
import { withRetryBackoff } from '../domain/retry';
import { EngineTransientError, STATUSES_ALLOWING_PROCEED, TaxCalculationRequest, TaxCalculationResult } from '../domain/tax-adapter-contract';
import { DivergentResultIntegrityAlertError, TaxServiceValidationError } from '../domain/errors';
import { appendAuditReference } from '../infrastructure/audit';

/**
 * S124 — orchestrates one calculate() call: resolves the effective engine
 * config for (tenantId, legalEntityId, businessDate), enforces idempotency
 * (same idempotencyKey -> stored result; divergent response -> integrity
 * alert, never overwrite), retries transient failures with backoff, logs
 * every attempt, and parks non-proceedable outcomes in the exception queue.
 * Nothing here ever posts to GL — see tests/zero-gl-writes.test.ts.
 */
@injectable()
export class TaxCalculationService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('EngineRegistry') private readonly engines: EngineRegistry,
  ) {}

  async calculate(request: TaxCalculationRequest, actor = 'system'): Promise<{ result: any; parkedExceptionId?: string }> {
    if (!request.tenantId?.trim()) throw new TaxServiceValidationError('TENANT_REQUIRED', 'tenantId is required');
    if (!request.legalEntityId?.trim()) throw new TaxServiceValidationError('LEGAL_ENTITY_REQUIRED', 'legalEntityId is required');
    if (!request.idempotencyKey?.trim()) throw new TaxServiceValidationError('IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey is required');
    if (request.lines.length === 0) throw new TaxServiceValidationError('LINES_REQUIRED', 'At least one line is required');

    // ── Idempotency: same key returns the stored result, verbatim —
    // BUT only when the stored result already reached a terminal,
    // proceedable status (CALCULATED/EXEMPT_APPLIED). A non-proceed
    // evidence row (NOT_CONFIGURED/ENGINE_REJECTED) does not short-circuit
    // recalculation — re-request must be able to retry the engine, and
    // any resulting row is a NEW insert chained via previousResultId,
    // never an update to the prior evidence row (immutability).
    const existing = await this.prisma.taxResult.findFirst({
      where: { tenantId: request.tenantId, idempotencyKey: request.idempotencyKey, status: { in: Array.from(STATUSES_ALLOWING_PROCEED) } },
      include: { lines: true },
    });
    if (existing) {
      return { result: existing };
    }
    const priorEvidence = await this.prisma.taxResult.findFirst({
      where: { tenantId: request.tenantId, idempotencyKey: request.idempotencyKey },
    });

    // ── Resolve effective engine config (as of businessDate, never "today") ──
    const configs = await this.prisma.taxEngineConfig.findMany({
      where: { tenantId: request.tenantId, legalEntityId: request.legalEntityId },
    });
    const effectiveConfig = resolveEffectiveOne<any>(configs, request.businessDate);
    const engine = this.engines.resolve(effectiveConfig?.engineType);

    let finalResponse: TaxCalculationResult | null = null;
    let finalError: unknown = null;

    const outcome = await withRetryBackoff(
      () => engine.calculate(request),
      (err) => err instanceof EngineTransientError,
      async (attempt) => {
        await this.prisma.taxEngineAttemptLog.create({
          data: {
            tenantId: request.tenantId,
            idempotencyKey: request.idempotencyKey,
            attemptNumber: attempt.attemptNumber,
            outcome: attempt.result ? attempt.result.status : 'ENGINE_UNAVAILABLE',
            errorMessage: attempt.error instanceof Error ? attempt.error.message : attempt.error ? String(attempt.error) : null,
            durationMs: attempt.durationMs,
            occurredAt: new Date(),
          },
        });
      },
    );

    if ('result' in outcome) {
      finalResponse = outcome.result;
    } else {
      finalError = outcome.error;
    }

    // ── Transient failure exhausted retries -> ENGINE_UNAVAILABLE, park ────
    if (finalError) {
      const parked = await this._parkException(request, 'ENGINE_UNAVAILABLE', finalError instanceof Error ? finalError.message : String(finalError), actor);
      return { result: { status: 'ENGINE_UNAVAILABLE', parkedExceptionId: parked.id }, parkedExceptionId: parked.id };
    }

    const response = finalResponse!;

    // ── Durable non-proceed outcomes park too — nothing posts, nothing estimates ──
    if (!STATUSES_ALLOWING_PROCEED.has(response.status)) {
      const parked = await this._parkException(request, response.status as any, response.engineRejectReason ?? response.status, actor);
      const stored = await this._storeResult(request, response, actor, priorEvidence?.id);
      return { result: stored, parkedExceptionId: parked.id };
    }

    const stored = await this._storeResult(request, response, actor, priorEvidence?.id);
    return { result: stored };
  }

  private async _storeResult(request: TaxCalculationRequest, response: TaxCalculationResult, actor: string, previousResultId?: string) {
    try {
      const created = await this.prisma.taxResult.create({
        data: {
          tenantId: request.tenantId,
          legalEntityId: request.legalEntityId,
          documentType: request.documentType,
          documentId: request.documentId,
          documentVersion: request.documentVersion,
          idempotencyKey: request.idempotencyKey,
          status: response.status,
          engineType: response.engineType,
          engineVersion: response.engineVersion ?? null,
          contentVersion: response.contentVersion ?? null,
          engineResultId: response.engineResultId ?? null,
          engineRejectReason: response.engineRejectReason ?? null,
          currency: response.currency,
          totalTaxableBase: response.totalTaxableBase,
          totalTax: response.totalTax,
          requestSnapshot: request as any,
          responseSnapshot: response as any,
          correlationId: request.correlationId,
          businessDate: new Date(request.businessDate),
          previousResultId: previousResultId ?? null,
          lines: {
            create: response.lines.map((l) => ({
              tenantId: request.tenantId,
              lineId: l.lineId,
              jurisdictionId: l.jurisdictionId,
              jurisdictionLevel: l.jurisdictionLevel ?? null,
              taxType: l.taxType,
              rate: l.rate ?? null,
              taxableBase: l.taxableBase,
              taxAmount: l.taxAmount,
              engineResultLineId: l.engineResultLineId ?? null,
            })),
          },
        },
        include: { lines: true },
      });
      await appendAuditReference(this.prisma, {
        tenantId: request.tenantId,
        entityType: 'TaxResult',
        entityId: created.id,
        eventType: 'tax.result.calculated',
        actor,
        after: { status: response.status, idempotencyKey: request.idempotencyKey },
      });
      return created;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Unique-constraint race on (tenantId, idempotencyKey) — a
        // concurrent request beat us to it. Compare: if the concurrent
        // winner's response diverges from ours, raise an integrity alert
        // (never overwrite); otherwise return the winner's stored result.
        const winner = await this.prisma.taxResult.findFirst({
          where: { tenantId: request.tenantId, idempotencyKey: request.idempotencyKey },
          include: { lines: true },
        });
        if (winner && winner.totalTax !== response.totalTax) {
          const alert = await this.prisma.taxIntegrityAlert.create({
            data: {
              tenantId: request.tenantId,
              idempotencyKey: request.idempotencyKey,
              originalResultId: winner.id,
              divergentRequestSnapshot: request as any,
              divergentResponseSnapshot: response as any,
            },
          });
          throw new DivergentResultIntegrityAlertError(request.idempotencyKey, alert.id);
        }
        return winner;
      }
      throw err;
    }
  }

  private async _parkException(request: TaxCalculationRequest, reasonCode: string, reasonDetail: string, actor: string) {
    const created = await this.prisma.taxException.create({
      data: {
        tenantId: request.tenantId,
        legalEntityId: request.legalEntityId,
        idempotencyKey: request.idempotencyKey,
        documentType: request.documentType,
        documentId: request.documentId,
        reasonCode,
        reasonDetail,
        status: 'PARKED',
        requestSnapshot: request as any,
      },
    });
    await this.prisma.taxExceptionDisposition.create({
      data: {
        tenantId: request.tenantId,
        exceptionId: created.id,
        fromStatus: null,
        toStatus: 'PARKED',
        action: 'PARKED',
        actor,
        note: reasonDetail,
      },
    });
    await appendAuditReference(this.prisma, {
      tenantId: request.tenantId,
      entityType: 'TaxException',
      entityId: created.id,
      eventType: 'tax.exception.parked',
      actor,
      after: { reasonCode, reasonDetail },
    });
    return created;
  }
}
