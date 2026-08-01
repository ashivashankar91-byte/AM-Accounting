import { injectable, inject } from 'tsyringe';
import { NotFoundError, TaxServiceValidationError } from '../domain/errors';
import { assertValidTransition, ExceptionStatus } from '../domain/exception-lifecycle';
import { TaxCalculationRequest } from '../domain/tax-adapter-contract';
import { TaxCalculationService } from './tax-calculation-service';
import { appendAuditReference } from '../infrastructure/audit';

/**
 * S124 — the Tax Exception & Outage Queue. Recovery re-request re-issues
 * the ORIGINAL request snapshot through TaxCalculationService (a fresh
 * idempotencyKey-scoped calculate() call — never a fabricated result),
 * resolving the exception if the outcome now proceeds.
 */
@injectable()
export class TaxExceptionService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject(TaxCalculationService) private readonly calculationService: TaxCalculationService,
  ) {}

  async list(tenantId: string, legalEntityId?: string, status?: string) {
    return this.prisma.taxException.findMany({
      where: { tenantId, ...(legalEntityId ? { legalEntityId } : {}), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { dispositions: true },
    });
  }

  async getById(tenantId: string, id: string) {
    const row = await this.prisma.taxException.findFirst({ where: { id, tenantId }, include: { dispositions: true } });
    if (!row) throw new NotFoundError('TaxException', id);
    return row;
  }

  async reRequest(tenantId: string, id: string, actor: string) {
    const exception = await this.getById(tenantId, id);
    if (exception.status === 'RESOLVED') {
      throw new TaxServiceValidationError('ALREADY_RESOLVED', `Tax exception ${id} is already resolved`);
    }
    assertValidTransition(exception.status as ExceptionStatus, 'RE_REQUEST_IN_PROGRESS');
    await this._transition(tenantId, exception, 'RE_REQUEST_IN_PROGRESS', actor, 'Re-request issued');

    // Same idempotencyKey — this calls through the normal idempotent path,
    // so if a stored result already exists (someone else recovered it
    // meanwhile) it is returned rather than recalculated.
    const request = exception.requestSnapshot as TaxCalculationRequest;
    const outcome = await this.calculationService.calculate(request, actor);

    if (!outcome.parkedExceptionId) {
      await this._transition(tenantId, exception, 'RESOLVED', actor, 'Re-request succeeded — tax now calculated');
      return { resolved: true, result: outcome.result };
    }

    // Still cannot proceed — remains parked (transition back).
    await this._transition(tenantId, exception, 'PARKED', actor, 'Re-request still could not proceed');
    return { resolved: false, result: outcome.result };
  }

  async bulkReRequest(tenantId: string, ids: string[], actor: string) {
    const results = [];
    for (const id of ids) {
      try {
        const outcome = await this.reRequest(tenantId, id, actor);
        results.push({ id, ...outcome });
      } catch (err: any) {
        results.push({ id, resolved: false, error: err?.message ?? String(err) });
      }
    }
    return results;
  }

  private async _transition(tenantId: string, exception: any, toStatus: string, actor: string, note: string) {
    await this.prisma.taxException.update({ where: { id: exception.id }, data: { status: toStatus, version: { increment: 1 } } });
    await this.prisma.taxExceptionDisposition.create({
      data: { tenantId, exceptionId: exception.id, fromStatus: exception.status, toStatus, action: toStatus, actor, note },
    });
    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'TaxException',
      entityId: exception.id,
      eventType: 'tax.exception.disposition',
      actor,
      before: { status: exception.status },
      after: { status: toStatus, note },
    });
    exception.status = toStatus;
  }
}
