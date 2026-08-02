import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/migration-service-client';
import {
  IPostingClient, GovernedPostingRequest, GovernedPostingResult,
  IScheduleClient, OpenItemEstablishRequest, OpenItemEstablishResult,
  ICloseReadinessProvider, Ce15ReadinessEvidence, IConsolidationHistoryProvider,
  IUpstreamTargetClient, UpstreamTargetSignal, UpstreamStatus, PENDING_UPSTREAM,
} from '../domain/interfaces';

/**
 * CE-07 governed posting client.
 *
 * migration-service NEVER writes GL. A promotion builds a conversion
 * transaction and submits it to the posting engine; the returned posting
 * execution and journal references become the run's lineage. If the posting
 * engine is unreachable, the promotion reports
 * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION and no staged row is marked
 * promoted — a fabricated journal reference would be worse than a stalled run.
 */
@injectable()
export class PostingClient implements IPostingClient {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = process.env['POSTING_SERVICE_URL'] ?? process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3002';
  }

  async post(request: GovernedPostingRequest): Promise<GovernedPostingResult> {
    const endpoint = `${this.baseUrl}/api/v1/posting/executions`;
    const serviceToken = process.env['AMACC_SERVICE_TOKEN'];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': request.tenantId,
          'x-legal-entity-id': request.legalEntityId,
          'x-idempotency-key': request.idempotencyIdentity,
          ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
        },
        body: JSON.stringify({
          tenantId: request.tenantId,
          legalEntityId: request.legalEntityId,
          sourceSystem: 'migration-service',
          sourceEntityType: 'MIGRATION_CONVERSION',
          sourceEntityId: request.runId,
          idempotencyIdentity: request.idempotencyIdentity,
          businessDate: request.businessDate,
          journalFamily: request.journalFamily,
          memo: request.memo,
          lines: request.lines,
          originalJournalRef: request.originalJournalRef ?? null,
        }),
      });

      if (res.status === 404 || res.status === 501 || res.status === 502 || res.status === 503) {
        return {
          status: PENDING_UPSTREAM,
          postingExecutionRef: null,
          journalRef: null,
          reason: `CE-07 posting endpoint not available (HTTP ${res.status}).`,
        };
      }
      if (!res.ok) {
        const body: any = await res.json().catch(() => ({}));
        return {
          status: 'REJECTED',
          postingExecutionRef: null,
          journalRef: null,
          reason: body?.message ?? body?.error ?? `Posting rejected (HTTP ${res.status}).`,
        };
      }

      const body: any = await res.json();
      const journalRef = body?.journalRef ?? body?.journalId ?? body?.journalEntryId ?? null;
      const postingExecutionRef = body?.postingExecutionRef ?? body?.executionId ?? body?.id ?? null;
      if (!journalRef || !postingExecutionRef) {
        return {
          status: PENDING_UPSTREAM,
          postingExecutionRef,
          journalRef,
          reason: 'CE-07 posting responded without an authoritative journal reference.',
        };
      }
      return { status: 'POSTED', postingExecutionRef, journalRef };
    } catch (err: any) {
      return {
        status: PENDING_UPSTREAM,
        postingExecutionRef: null,
        journalRef: null,
        reason: `CE-07 posting engine unreachable: ${String(err?.message ?? err)}`,
      };
    }
  }
}

/**
 * CE-08 schedule / open-item establishment client.
 *
 * Migrated open items are created through the schedule contract, never by
 * writing schedule tables. An unavailable schedule service yields
 * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION and zero established refs.
 */
@injectable()
export class ScheduleClient implements IScheduleClient {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = process.env['SCHEDULE_SERVICE_URL'] ?? 'http://schedule-service:3018';
  }

  async establishOpenItems(request: OpenItemEstablishRequest): Promise<OpenItemEstablishResult> {
    const endpoint = `${this.baseUrl}/api/v1/schedules/open-items/migration-establish`;
    const serviceToken = process.env['AMACC_SERVICE_TOKEN'];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': request.tenantId,
          'x-legal-entity-id': request.legalEntityId,
          'x-idempotency-key': `migration-open-items:${request.runId}:${request.controlAccount}`,
          ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
        },
        body: JSON.stringify(request),
      });

      if (res.status === 404 || res.status === 501 || res.status === 502 || res.status === 503) {
        return {
          status: PENDING_UPSTREAM,
          establishedRefs: [],
          reason: `CE-08 schedule establishment endpoint not available (HTTP ${res.status}).`,
        };
      }
      if (!res.ok) {
        const body: any = await res.json().catch(() => ({}));
        return {
          status: 'REJECTED',
          establishedRefs: [],
          reason: body?.message ?? body?.error ?? `Open-item establishment rejected (HTTP ${res.status}).`,
        };
      }

      const body: any = await res.json();
      const refs = Array.isArray(body?.establishedRefs) ? body.establishedRefs : [];
      if (refs.length === 0) {
        return {
          status: PENDING_UPSTREAM,
          establishedRefs: [],
          reason: 'CE-08 schedule service responded without authoritative open-item references.',
        };
      }
      return { status: 'ESTABLISHED', establishedRefs: refs };
    } catch (err: any) {
      return {
        status: PENDING_UPSTREAM,
        establishedRefs: [],
        reason: `CE-08 schedule service unreachable: ${String(err?.message ?? err)}`,
      };
    }
  }
}

/**
 * CE-15 close readiness provider — REAL integration.
 *
 * Calls the real CE-15 close-service at two endpoints:
 *   GET /api/v1/close/state    → period state machine record
 *   GET /api/v1/close/readiness → operational readiness signals
 *
 * Evidence is persisted in ce15_readiness_evidence (append-only, immutable).
 *
 * Fail-closed discipline:
 *   - Any HTTP error or network error → approved: false
 *   - Stale evidence (> 1 h) → cutover service layer blocks on it
 *   - REOPEN_PENDING_APPROVAL invalidates approval
 *   - No fabricated READY state under any circumstances
 *   - NOT_READY / READY / READY_WITH_EXCEPTIONS states do NOT approve cutover
 *     (requires PRELIMINARY_CLOSED or FINAL_CLOSED)
 */
@injectable()
export class CloseReadinessClient implements ICloseReadinessProvider {
  private readonly baseUrl: string;

  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {
    this.baseUrl = process.env['CLOSE_SERVICE_URL'] ?? 'http://close-service:3052';
  }

  private get authHeaders(): Record<string, string> {
    const token = process.env['AMACC_SERVICE_TOKEN'];
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async getReadiness(
    tenantId: string,
    legalEntityId: string,
    periodYear: number,
    periodMonth: number,
    _actor = 'system',
  ): Promise<Ce15ReadinessEvidence> {
    const qs = `legalEntityId=${encodeURIComponent(legalEntityId)}&periodYear=${periodYear}&periodMonth=${periodMonth}`;
    const headers = { 'x-tenant-id': tenantId, ...this.authHeaders };
    const capturedAt = new Date();

    let rawState: Record<string, unknown> = {};
    let rawReadiness: Record<string, unknown> = {};

    try {
      const [stateRes, readinessRes] = await Promise.all([
        fetch(`${this.baseUrl}/api/v1/close/state?${qs}`, { headers }),
        fetch(`${this.baseUrl}/api/v1/close/readiness?${qs}`, { headers }),
      ]);

      if (!stateRes.ok) {
        return {
          status: PENDING_UPSTREAM as UpstreamStatus,
          approved: false,
          detail: `CE-15 close-service /state returned HTTP ${stateRes.status} — cutover blocked until readiness confirmed.`,
          capturedAt,
        };
      }

      rawState = (await stateRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (readinessRes.ok) {
        rawReadiness = (await readinessRes.json().catch(() => ({}))) as Record<string, unknown>;
      }

      const closeState: string = String(rawState['state'] ?? rawState['closeState'] ?? '');
      if (!closeState) {
        return {
          status: PENDING_UPSTREAM as UpstreamStatus,
          approved: false,
          detail: 'CE-15 close-service returned no state field — cutover blocked.',
          rawStatePayload: rawState,
          capturedAt,
        };
      }

      const reopenPending = closeState === 'REOPEN_PENDING_APPROVAL';
      const preliminaryClosed = closeState === 'PRELIMINARY_CLOSED';
      const finallyClosed = closeState === 'FINAL_CLOSED';

      // Only PRELIMINARY_CLOSED or FINAL_CLOSED (no reopen) authorises cutover
      const approved = (preliminaryClosed || finallyClosed) && !reopenPending;

      const upstreamSignals: unknown[] = Array.isArray(rawReadiness['signals'])
        ? rawReadiness['signals']
        : Array.isArray(rawReadiness['upstreamSignals'])
          ? rawReadiness['upstreamSignals']
          : [];

      const allTasksVerified = Boolean(rawReadiness['allMandatoryTasksVerified'] ?? rawReadiness['allTasksVerified'] ?? false);
      const hasUnreconciled = Boolean(rawReadiness['hasUnreconciled'] ?? true);
      const hasOpenExceptions = Boolean(rawReadiness['hasOpenExceptions'] ?? true);

      const period = `${periodYear}-${String(periodMonth).padStart(2, '0')}`;
      const detail = approved
        ? `CE-15 close approved: ${closeState} for ${legalEntityId} ${period}. Tasks: ${allTasksVerified}. Unreconciled: ${hasUnreconciled}. Open exceptions: ${hasOpenExceptions}.`
        : `CE-15 close NOT approved: state=${closeState} for ${legalEntityId} ${period}. Requires PRELIMINARY_CLOSED or FINAL_CLOSED.`;

      const transitionAtRaw = rawState['transitionAt'] ?? rawState['transition_at'];

      return {
        status: 'AVAILABLE' as UpstreamStatus,
        approved,
        detail,
        closeState,
        previousState: (rawState['previousState'] ?? rawState['previous_state'] ?? null) as string | null,
        closeVersion: typeof rawState['version'] === 'number' ? rawState['version'] : null,
        transitionBy: (rawState['transitionBy'] ?? rawState['transition_by'] ?? null) as string | null,
        transitionAt: transitionAtRaw ? new Date(String(transitionAtRaw)) : null,
        allTasksVerified,
        hasUnreconciled,
        hasOpenExceptions,
        preliminaryClosed,
        finallyClosed,
        reopenPending,
        upstreamSignals,
        rawStatePayload: rawState,
        rawReadinessPayload: rawReadiness,
        certificationIdentity: (rawState['transitionBy'] ?? rawState['transition_by'] ?? null) as string | null,
        evidenceRef: (rawState['id'] ?? null) as string | null,
        capturedAt,
      };
    } catch (err: any) {
      return {
        status: PENDING_UPSTREAM as UpstreamStatus,
        approved: false,
        detail: `CE-15 close-service unreachable: ${String(err?.message ?? err)}. Cutover blocked.`,
        capturedAt,
      };
    }
  }

  async persistEvidence(tenantId: string, runId: string, evidence: Ce15ReadinessEvidence): Promise<void> {
    if (evidence.status !== 'AVAILABLE' || !evidence.closeState) return;
    const raw = evidence.rawStatePayload ?? {};
    await (this.prisma as any).ce15ReadinessEvidence.create({
      data: {
        tenantId,
        runId,
        legalEntityId: String(raw['legalEntityId'] ?? raw['legal_entity_id'] ?? 'UNKNOWN'),
        periodYear: Number(raw['periodYear'] ?? raw['period_year'] ?? 0),
        periodMonth: Number(raw['periodMonth'] ?? raw['period_month'] ?? 0),
        closeState: evidence.closeState,
        previousState: evidence.previousState ?? null,
        closeVersion: evidence.closeVersion ?? null,
        transitionBy: evidence.transitionBy ?? null,
        transitionAt: evidence.transitionAt ?? null,
        allTasksVerified: evidence.allTasksVerified ?? false,
        hasUnreconciled: evidence.hasUnreconciled ?? true,
        hasOpenExceptions: evidence.hasOpenExceptions ?? true,
        preliminaryClosed: evidence.preliminaryClosed ?? false,
        finallyClosed: evidence.finallyClosed ?? false,
        reopenPending: evidence.reopenPending ?? false,
        approved: evidence.approved,
        upstreamSignals: (evidence.upstreamSignals ?? []) as any,
        rawStatePayload: (evidence.rawStatePayload ?? {}) as any,
        rawReadinessPayload: (evidence.rawReadinessPayload ?? {}) as any,
        certificationIdentity: evidence.certificationIdentity ?? null,
        evidenceRef: evidence.evidenceRef ?? null,
        capturedAt: evidence.capturedAt ?? new Date(),
        capturedBy: 'migration-service',
      },
    });
  }

  async getLatestEvidence(tenantId: string, runId: string): Promise<Ce15ReadinessEvidence | null> {
    const row = await (this.prisma as any).ce15ReadinessEvidence.findFirst({
      where: { tenantId, runId },
      orderBy: { capturedAt: 'desc' },
    });
    if (!row) return null;
    return {
      status: 'AVAILABLE' as UpstreamStatus,
      approved: row.approved,
      detail: `Persisted CE-15 evidence: state=${row.closeState}, capturedAt=${(row.capturedAt as Date).toISOString()}`,
      closeState: row.closeState,
      previousState: row.previousState,
      closeVersion: row.closeVersion,
      transitionBy: row.transitionBy,
      transitionAt: row.transitionAt,
      allTasksVerified: row.allTasksVerified,
      hasUnreconciled: row.hasUnreconciled,
      hasOpenExceptions: row.hasOpenExceptions,
      preliminaryClosed: row.preliminaryClosed,
      finallyClosed: row.finallyClosed,
      reopenPending: row.reopenPending,
      upstreamSignals: (row.upstreamSignals as any) ?? [],
      rawStatePayload: (row.rawStatePayload as any) ?? {},
      rawReadinessPayload: (row.rawReadinessPayload as any) ?? {},
      certificationIdentity: row.certificationIdentity,
      evidenceRef: row.evidenceRef,
      capturedAt: row.capturedAt,
    };
  }
}

/**
 * CE-06 consolidation history provider. Typed port preserved; the comparative
 * history contract is not yet technically reconciled for migration consumers.
 */
@injectable()
export class ConsolidationHistoryClient implements IConsolidationHistoryProvider {
  async getHistory(_tenantId: string, legalEntityId: string, periodYear: number) {
    return {
      status: PENDING_UPSTREAM as UpstreamStatus,
      periods: [] as { periodYear: number; periodMonth: number; available: boolean }[],
      detail:
        `CE-06 consolidation history for ${legalEntityId} ${periodYear} is PENDING_UPSTREAM_TECHNICAL_RECONCILIATION. ` +
        'Comparative history will be sourced from CE-06 once its contract is reconciled; no comparative figures are inferred.',
    };
  }
}

const UPSTREAM_TARGET_DETAIL: Record<string, string> = {
  'CE-09': 'AP / AR / cash / bank migration targets are PENDING_UPSTREAM_TECHNICAL_RECONCILIATION. Staged data is retained; no records are marked migrated.',
  'CE-11': 'Fixed Ops migration targets are PENDING_UPSTREAM_TECHNICAL_RECONCILIATION. Staged data is retained; no records are marked migrated.',
  'CE-12': 'Vehicle / deal / F&I migration targets are PENDING_UPSTREAM_TECHNICAL_RECONCILIATION. Staged data is retained; no records are marked migrated.',
  'CE-13': 'Payroll migration targets are PENDING_UPSTREAM_TECHNICAL_RECONCILIATION. Staged data is retained; no records are marked migrated.',
  'CE-14': 'OEM migration targets are PENDING_UPSTREAM_TECHNICAL_RECONCILIATION. Staged data is retained; no records are marked migrated.',
};

/**
 * Domain migration targets that are not yet technically reconciled.
 *
 * The typed adapter is preserved so the promotion path is already wired; what
 * it returns today is the truth — PENDING_UPSTREAM_TECHNICAL_RECONCILIATION,
 * zero target ids. It never invents a target record id and never marks a
 * staged record migrated.
 */
@injectable()
export class UpstreamTargetClient implements IUpstreamTargetClient {
  async getSignal(moduleCode: string): Promise<UpstreamTargetSignal> {
    const detail = UPSTREAM_TARGET_DETAIL[moduleCode];
    if (!detail) {
      return { moduleCode: moduleCode as any, status: 'NOT_CONFIGURED', detail: `Unknown upstream module ${moduleCode}.` };
    }
    return { moduleCode: moduleCode as any, status: PENDING_UPSTREAM, detail };
  }

  async getAllSignals(): Promise<UpstreamTargetSignal[]> {
    return Promise.all(Object.keys(UPSTREAM_TARGET_DETAIL).map((code) => this.getSignal(code)));
  }

  async migrateInto(moduleCode: string, _payload: Record<string, unknown>) {
    const signal = await this.getSignal(moduleCode);
    return { status: signal.status, targetRecordIds: [] as string[], detail: signal.detail };
  }
}
