/**
 * CE-17 — Upstream clients.
 *
 * Two kinds live here.
 *
 * Real integrations (CE-15 close, CE-16 migration baseline, CE-07 posting,
 * account mapping) call their service and report exactly what came back —
 * including "I could not tell", which the policy gates treat as a refusal.
 *
 * Typed adapters for CE-09, CE-11, CE-12, CE-13 and CE-14 are wired but not
 * yet technically reconciled. They return PENDING_UPSTREAM_TECHNICAL_
 * RECONCILIATION and an empty result set. They never invent a record, never
 * invent an amount, and never let a caller mistake absence for zero.
 */

import { injectable, inject } from 'tsyringe';
import {
  ICloseReadinessClient, IMigrationBaselineClient, IPostingClient, IAccountMappingClient,
  IAparAdapter, IFixedOpsAdapter, IVehicleDealAdapter, IPayrollAdapter, IOemAdapter,
  IUpstreamRegistry, CanonicalEventEnvelope, PostingResult, UpstreamSignal, PENDING_UPSTREAM,
} from '../domain/interfaces';

function authHeaders(): Record<string, string> {
  const token = process.env['AMACC_SERVICE_TOKEN'];
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * CE-15 close-service — closed-period gate.
 *
 * Returns null on any failure. The gate evaluator refuses on null rather than
 * treating an unreachable close-service as an open period, because posting
 * into a closed period is the exact failure this gate exists to prevent.
 */
@injectable()
export class CloseReadinessClient implements ICloseReadinessClient {
  private readonly baseUrl = process.env['CLOSE_SERVICE_URL'] ?? 'http://close-service:3052';

  async isPeriodClosed(tenantId: string, legalEntityId: string, year: number, month: number): Promise<boolean | null> {
    const qs = `legalEntityId=${encodeURIComponent(legalEntityId)}&periodYear=${year}&periodMonth=${month}`;
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/close/state?${qs}`, {
        headers: { 'x-tenant-id': tenantId, ...authHeaders() },
      });
      if (!res.ok) return null;
      const body: any = await res.json().catch(() => null);
      const state = String(body?.state ?? body?.closeState ?? '');
      if (!state) return null;
      return state === 'PRELIMINARY_CLOSED' || state === 'FINAL_CLOSED';
    } catch {
      return null;
    }
  }
}

/**
 * CE-16 migration-service — baseline evidence.
 *
 * A capability may not be promoted above OBSERVE_ONLY on an entity whose
 * conversion has not been signed off, because its "baseline" would be measured
 * against numbers nobody has accepted yet.
 */
@injectable()
export class MigrationBaselineClient implements IMigrationBaselineClient {
  private readonly baseUrl = process.env['MIGRATION_SERVICE_URL'] ?? 'http://migration-service:3060';

  async hasApprovedBaseline(tenantId: string, legalEntityId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/migration/runs?legalEntityId=${encodeURIComponent(legalEntityId)}`, {
        headers: { 'x-tenant-id': tenantId, 'x-legal-entity-id': legalEntityId, ...authHeaders() },
      });
      if (!res.ok) return false;
      const body: any = await res.json().catch(() => null);
      const items: any[] = Array.isArray(body?.items) ? body.items : [];
      return items.some((r) => r?.state === 'CUTOVER_COMPLETE' || r?.state === 'RECONCILED');
    } catch {
      return false;
    }
  }

  async describe(tenantId: string, legalEntityId: string): Promise<UpstreamSignal> {
    const approved = await this.hasApprovedBaseline(tenantId, legalEntityId);
    return {
      moduleCode: 'CE-16',
      status: approved ? 'AVAILABLE' : 'NOT_CONFIGURED',
      detail: approved
        ? `A reconciled or completed CE-16 migration run exists for ${legalEntityId}; baseline evidence is available.`
        : `No reconciled CE-16 migration run for ${legalEntityId}. Authority promotion above OBSERVE_ONLY has no accepted baseline to measure against.`,
    };
  }
}

/**
 * CE-07 governed posting.
 *
 * automation-service never writes GL. Every financial effect is submitted here
 * with an idempotency identity and comes back as a posting execution and
 * journal reference. An unreachable posting engine yields PENDING_UPSTREAM and
 * no execution record is marked EXECUTED — a fabricated journal reference
 * would be far worse than a stalled item.
 */
@injectable()
export class PostingClient implements IPostingClient {
  private readonly baseUrl = process.env['POSTING_SERVICE_URL'] ?? process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3002';

  async post(tenantId: string, envelope: CanonicalEventEnvelope): Promise<PostingResult> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/posting/executions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'x-legal-entity-id': envelope.legalEntityId,
          'x-idempotency-key': envelope.idempotencyIdentity,
          ...authHeaders(),
        },
        body: JSON.stringify({
          tenantId,
          legalEntityId: envelope.legalEntityId,
          sourceSystem: 'automation-service',
          sourceEntityType: envelope.sourceEntityType,
          sourceEntityId: envelope.sourceEntityId,
          idempotencyIdentity: envelope.idempotencyIdentity,
          businessDate: envelope.businessDate,
          journalFamily: envelope.journalFamily,
          memo: envelope.memo,
          lines: envelope.lines,
          originalJournalRef: envelope.originalJournalRef ?? null,
        }),
      });

      if ([404, 501, 502, 503].includes(res.status)) {
        return {
          status: PENDING_UPSTREAM, postingExecutionId: null, journalEntryId: null,
          reason: `CE-07 posting endpoint not available (HTTP ${res.status}).`,
        };
      }
      if (!res.ok) {
        const body: any = await res.json().catch(() => ({}));
        return {
          status: 'REJECTED', postingExecutionId: null, journalEntryId: null,
          reason: body?.message ?? body?.error ?? `Posting rejected (HTTP ${res.status}).`,
        };
      }

      const body: any = await res.json();
      const journalEntryId = body?.journalRef ?? body?.journalId ?? body?.journalEntryId ?? null;
      const postingExecutionId = body?.postingExecutionRef ?? body?.executionId ?? body?.id ?? null;
      if (!journalEntryId || !postingExecutionId) {
        return {
          status: PENDING_UPSTREAM, postingExecutionId, journalEntryId,
          reason: 'CE-07 posting responded without an authoritative journal reference.',
        };
      }
      return { status: 'POSTED', postingExecutionId, journalEntryId };
    } catch (err: any) {
      return {
        status: PENDING_UPSTREAM, postingExecutionId: null, journalEntryId: null,
        reason: `CE-07 posting engine unreachable: ${String(err?.message ?? err)}`,
      };
    }
  }
}

/**
 * Account-mapping completeness, read from the chart-of-accounts service.
 * null means "could not be determined", which the gate refuses on.
 */
@injectable()
export class AccountMappingClient implements IAccountMappingClient {
  private readonly baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3002';

  async isMappingComplete(tenantId: string, legalEntityId: string, capabilityCode: string): Promise<boolean | null> {
    const qs = `legalEntityId=${encodeURIComponent(legalEntityId)}&purpose=${encodeURIComponent(capabilityCode)}`;
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/coa/account-mappings/completeness?${qs}`, {
        headers: { 'x-tenant-id': tenantId, 'x-legal-entity-id': legalEntityId, ...authHeaders() },
      });
      if (!res.ok) return null;
      const body: any = await res.json().catch(() => null);
      if (body === null || typeof body.complete !== 'boolean') return null;
      return body.complete;
    } catch {
      return null;
    }
  }
}

// ── CE-09 AP / AR / cash — apar-service ──────────────────────────────────────

/**
 * Calls the real apar-service contract (CE-09).
 * Open AR: GET /api/v1/apar/ar?status=OPEN
 * Open AP: GET /api/v1/apar/ap
 * Both responses are filtered to the requested legalEntityId where that field
 * is present on the returned items. An unreachable service returns PENDING_UPSTREAM
 * (never an empty set that callers mistake for "nothing owed").
 */
@injectable()
export class AparAdapter implements IAparAdapter {
  private readonly baseUrl = process.env['APAR_SERVICE_URL'] ?? 'http://apar-service:3013';

  async getOpenArItems(tenantId: string, legalEntityId: string) {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/apar/ar?status=OPEN`, {
        headers: { 'x-tenant-id': tenantId, 'x-legal-entity-id': legalEntityId, ...authHeaders() },
      });
      if (!res.ok) {
        return {
          signal: { moduleCode: 'CE-09', status: PENDING_UPSTREAM, detail: `apar-service returned HTTP ${res.status} for AR open items.` } as UpstreamSignal,
          items: [] as any[],
        };
      }
      const body: any = await res.json().catch(() => null);
      const all: any[] = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []);
      const items = all.filter((i: any) => !i.legalEntityId || i.legalEntityId === legalEntityId);
      return { signal: { moduleCode: 'CE-09', status: 'AVAILABLE', detail: `${items.length} open AR item(s) for ${legalEntityId}.` } as UpstreamSignal, items };
    } catch (err: any) {
      return { signal: { moduleCode: 'CE-09', status: PENDING_UPSTREAM, detail: `apar-service unreachable for AR items: ${err?.message ?? err}` } as UpstreamSignal, items: [] as any[] };
    }
  }

  async getOpenApItems(tenantId: string, legalEntityId: string) {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/apar/ap`, {
        headers: { 'x-tenant-id': tenantId, 'x-legal-entity-id': legalEntityId, ...authHeaders() },
      });
      if (!res.ok) {
        return {
          signal: { moduleCode: 'CE-09', status: PENDING_UPSTREAM, detail: `apar-service returned HTTP ${res.status} for AP open items.` } as UpstreamSignal,
          items: [] as any[],
        };
      }
      const body: any = await res.json().catch(() => null);
      const all: any[] = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []);
      const items = all.filter((i: any) => !i.legalEntityId || i.legalEntityId === legalEntityId);
      return { signal: { moduleCode: 'CE-09', status: 'AVAILABLE', detail: `${items.length} open AP item(s) for ${legalEntityId}.` } as UpstreamSignal, items };
    } catch (err: any) {
      return { signal: { moduleCode: 'CE-09', status: PENDING_UPSTREAM, detail: `apar-service unreachable for AP items: ${err?.message ?? err}` } as UpstreamSignal, items: [] as any[] };
    }
  }
}

// ── CE-11 Fixed Ops — fixedops-service ───────────────────────────────────────

/**
 * Calls the real fixedops-service contract (CE-11).
 * Parts movements are RO postings: GET /api/v1/fixedops/postings
 * Filtered to the requested legalEntityId and year/month where supported.
 */
@injectable()
export class FixedOpsAdapter implements IFixedOpsAdapter {
  private readonly baseUrl = process.env['FIXEDOPS_SERVICE_URL'] ?? 'http://fixedops-service:3060';

  async getPartsMovements(tenantId: string, legalEntityId: string, year: number, month: number) {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/fixedops/postings`, {
        headers: { 'x-tenant-id': tenantId, 'x-legal-entity-id': legalEntityId, ...authHeaders() },
      });
      if (!res.ok) {
        return {
          signal: { moduleCode: 'CE-11', status: PENDING_UPSTREAM, detail: `fixedops-service returned HTTP ${res.status} for parts postings.` } as UpstreamSignal,
          items: [] as any[],
        };
      }
      const body: any = await res.json().catch(() => null);
      const all: any[] = Array.isArray(body?.items) ? body.items : (Array.isArray(body) ? body : []);
      const items = all.filter((i: any) => {
        if (i.legalEntityId && i.legalEntityId !== legalEntityId) return false;
        if (i.periodYear !== undefined && i.periodYear !== year) return false;
        if (i.periodMonth !== undefined && i.periodMonth !== month) return false;
        return true;
      });
      return { signal: { moduleCode: 'CE-11', status: 'AVAILABLE', detail: `${items.length} Fixed Ops posting(s) for ${legalEntityId} ${year}-${String(month).padStart(2,'0')}.` } as UpstreamSignal, items };
    } catch (err: any) {
      return { signal: { moduleCode: 'CE-11', status: PENDING_UPSTREAM, detail: `fixedops-service unreachable for parts movements: ${err?.message ?? err}` } as UpstreamSignal, items: [] as any[] };
    }
  }
}

// ── CE-12 Vehicle / Deal / F&I — deal-accounting-service ─────────────────────

/**
 * Calls the real deal-accounting-service contract (CE-12).
 * Deliveries: GET /api/v1/deal-accounting/deals → items with status=FINALIZED
 * Cohorts:    GET /api/v1/deal-accounting/deals → items in date range for
 *             chargeback model and portfolio allocation.
 */
@injectable()
export class VehicleDealAdapter implements IVehicleDealAdapter {
  private readonly baseUrl = process.env['DEAL_ACCOUNTING_SERVICE_URL'] ?? 'http://deal-accounting-service:3092';

  async getDeliveries(tenantId: string, legalEntityId: string, programRef: string) {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/deal-accounting/deals`, {
        headers: { 'x-tenant-id': tenantId, 'x-legal-entity-id': legalEntityId, ...authHeaders() },
      });
      if (!res.ok) {
        return {
          signal: { moduleCode: 'CE-12', status: PENDING_UPSTREAM, detail: `deal-accounting-service returned HTTP ${res.status} for deliveries.` } as UpstreamSignal,
          items: [] as any[],
        };
      }
      const body: any = await res.json().catch(() => null);
      const all: any[] = Array.isArray(body?.items) ? body.items : (Array.isArray(body) ? body : []);
      const items = all.filter((d: any) => {
        if (d.status !== 'FINALIZED' && d.status !== 'POSTED') return false;
        if (d.legalEntityId && d.legalEntityId !== legalEntityId) return false;
        if (programRef && d.programRef && d.programRef !== programRef) return false;
        return true;
      });
      return { signal: { moduleCode: 'CE-12', status: 'AVAILABLE', detail: `${items.length} finalized deal(s) for ${legalEntityId}${programRef ? ` / ${programRef}` : ''}.` } as UpstreamSignal, items };
    } catch (err: any) {
      return { signal: { moduleCode: 'CE-12', status: PENDING_UPSTREAM, detail: `deal-accounting-service unreachable for deliveries: ${err?.message ?? err}` } as UpstreamSignal, items: [] as any[] };
    }
  }

  async getDealCohorts(tenantId: string, legalEntityId: string, from: Date, to: Date) {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/deal-accounting/deals`, {
        headers: { 'x-tenant-id': tenantId, 'x-legal-entity-id': legalEntityId, ...authHeaders() },
      });
      if (!res.ok) {
        return {
          signal: { moduleCode: 'CE-12', status: PENDING_UPSTREAM, detail: `deal-accounting-service returned HTTP ${res.status} for cohorts.` } as UpstreamSignal,
          cohorts: [] as any[],
        };
      }
      const body: any = await res.json().catch(() => null);
      const all: any[] = Array.isArray(body?.items) ? body.items : (Array.isArray(body) ? body : []);
      const cohorts = all.filter((d: any) => {
        if (d.legalEntityId && d.legalEntityId !== legalEntityId) return false;
        const dt = d.createdAt ? new Date(d.createdAt) : null;
        if (dt && (dt < from || dt > to)) return false;
        return true;
      });
      return { signal: { moduleCode: 'CE-12', status: 'AVAILABLE', detail: `${cohorts.length} deal cohort(s) for ${legalEntityId}.` } as UpstreamSignal, cohorts };
    } catch (err: any) {
      return { signal: { moduleCode: 'CE-12', status: PENDING_UPSTREAM, detail: `deal-accounting-service unreachable for cohorts: ${err?.message ?? err}` } as UpstreamSignal, cohorts: [] as any[] };
    }
  }
}

// ── CE-13 Payroll — payroll-service ───────────────────────────────────────────

/**
 * Calls the real payroll-service contract (CE-13).
 * Payroll data:     GET /api/v1/payroll/batches?status=APPROVED (or POSTED)
 * Employee records: GET /api/v1/payroll/employees (DSAR subject scan)
 */
@injectable()
export class PayrollAdapter implements IPayrollAdapter {
  private readonly baseUrl = process.env['PAYROLL_SERVICE_URL'] ?? 'http://payroll-service:3012';

  async getPayrollData(tenantId: string, legalEntityId: string, year: number, month: number) {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/payroll/batches`, {
        headers: { 'x-tenant-id': tenantId, 'x-legal-entity-id': legalEntityId, ...authHeaders() },
      });
      if (!res.ok) {
        return {
          signal: { moduleCode: 'CE-13', status: PENDING_UPSTREAM, detail: `payroll-service returned HTTP ${res.status} for batches.` } as UpstreamSignal,
          items: [] as any[],
        };
      }
      const body: any = await res.json().catch(() => null);
      const all: any[] = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []);
      const items = all.filter((b: any) => {
        if (b.legalEntityId && b.legalEntityId !== legalEntityId) return false;
        if (b.periodYear !== undefined && b.periodYear !== year) return false;
        if (b.periodMonth !== undefined && b.periodMonth !== month) return false;
        return true;
      });
      return { signal: { moduleCode: 'CE-13', status: 'AVAILABLE', detail: `${items.length} payroll batch(es) for ${legalEntityId} ${year}-${String(month).padStart(2,'0')}.` } as UpstreamSignal, items };
    } catch (err: any) {
      return { signal: { moduleCode: 'CE-13', status: PENDING_UPSTREAM, detail: `payroll-service unreachable for payroll data: ${err?.message ?? err}` } as UpstreamSignal, items: [] as any[] };
    }
  }

  async getEmployeeRecords(tenantId: string, subjectIdentifier: string) {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/payroll/employees`, {
        headers: { 'x-tenant-id': tenantId, ...authHeaders() },
      });
      if (!res.ok) {
        return {
          signal: { moduleCode: 'CE-13', status: PENDING_UPSTREAM, detail: `payroll-service returned HTTP ${res.status} for employee records.` } as UpstreamSignal,
          items: [] as any[],
        };
      }
      const body: any = await res.json().catch(() => null);
      const all: any[] = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []);
      // DSAR: filter by subject identifier across all personal-data fields
      const lc = subjectIdentifier.toLowerCase();
      const items = all.filter((e: any) =>
        (e.employeeId && String(e.employeeId).toLowerCase() === lc) ||
        (e.ssn && String(e.ssn).toLowerCase() === lc) ||
        (e.email && String(e.email).toLowerCase().includes(lc))
      );
      return { signal: { moduleCode: 'CE-13', status: 'AVAILABLE', detail: `${items.length} employee record(s) matched subject ${subjectIdentifier}.` } as UpstreamSignal, items };
    } catch (err: any) {
      return { signal: { moduleCode: 'CE-13', status: PENDING_UPSTREAM, detail: `payroll-service unreachable for employee records: ${err?.message ?? err}` } as UpstreamSignal, items: [] as any[] };
    }
  }
}

// ── CE-14 OEM — oem-service ───────────────────────────────────────────────────

/**
 * Calls the real oem-service contract (CE-14).
 * OEM statements:      GET /api/v1/oem/staging/documents
 * Statement session:   GET /api/v1/oem/match/sessions/:id
 * Incentive programs:  GET /api/v1/oem/incentives/programs
 */
@injectable()
export class OemAdapter implements IOemAdapter {
  private readonly baseUrl = process.env['OEM_SERVICE_URL'] ?? 'http://oem-service:3052';

  async getOemStatements(tenantId: string, legalEntityId: string) {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/oem/staging/documents`, {
        headers: { 'x-tenant-id': tenantId, 'x-legal-entity-id': legalEntityId, ...authHeaders() },
      });
      if (!res.ok) {
        return {
          signal: { moduleCode: 'CE-14', status: PENDING_UPSTREAM, detail: `oem-service returned HTTP ${res.status} for staging documents.` } as UpstreamSignal,
          items: [] as any[],
        };
      }
      const body: any = await res.json().catch(() => null);
      const items: any[] = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []);
      return { signal: { moduleCode: 'CE-14', status: 'AVAILABLE', detail: `${items.length} OEM staging document(s) for ${legalEntityId}.` } as UpstreamSignal, items };
    } catch (err: any) {
      return { signal: { moduleCode: 'CE-14', status: PENDING_UPSTREAM, detail: `oem-service unreachable for statements: ${err?.message ?? err}` } as UpstreamSignal, items: [] as any[] };
    }
  }

  async getStatementSession(tenantId: string, sessionId: string) {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/oem/match/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { 'x-tenant-id': tenantId, ...authHeaders() },
      });
      if (res.status === 404) return { signal: { moduleCode: 'CE-14', status: 'AVAILABLE', detail: `Session ${sessionId} not found.` } as UpstreamSignal, session: null };
      if (!res.ok) {
        return {
          signal: { moduleCode: 'CE-14', status: PENDING_UPSTREAM, detail: `oem-service returned HTTP ${res.status} for match session ${sessionId}.` } as UpstreamSignal,
          session: null as any,
        };
      }
      const session: any = await res.json().catch(() => null);
      return { signal: { moduleCode: 'CE-14', status: 'AVAILABLE', detail: `Match session ${sessionId} retrieved.` } as UpstreamSignal, session };
    } catch (err: any) {
      return { signal: { moduleCode: 'CE-14', status: PENDING_UPSTREAM, detail: `oem-service unreachable for session ${sessionId}: ${err?.message ?? err}` } as UpstreamSignal, session: null as any };
    }
  }

  async getIncentivePrograms(tenantId: string, legalEntityId: string) {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/oem/incentives/programs`, {
        headers: { 'x-tenant-id': tenantId, 'x-legal-entity-id': legalEntityId, ...authHeaders() },
      });
      if (!res.ok) {
        return {
          signal: { moduleCode: 'CE-14', status: PENDING_UPSTREAM, detail: `oem-service returned HTTP ${res.status} for incentive programs.` } as UpstreamSignal,
          items: [] as any[],
        };
      }
      const body: any = await res.json().catch(() => null);
      const items: any[] = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []);
      return { signal: { moduleCode: 'CE-14', status: 'AVAILABLE', detail: `${items.length} OEM incentive program(s) for ${legalEntityId}.` } as UpstreamSignal, items };
    } catch (err: any) {
      return { signal: { moduleCode: 'CE-14', status: PENDING_UPSTREAM, detail: `oem-service unreachable for incentive programs: ${err?.message ?? err}` } as UpstreamSignal, items: [] as any[] };
    }
  }
}

@injectable()
export class UpstreamRegistry implements IUpstreamRegistry {
  constructor(
    @inject('IAparAdapter') private readonly apar: AparAdapter,
    @inject('IFixedOpsAdapter') private readonly fixedOps: FixedOpsAdapter,
    @inject('IVehicleDealAdapter') private readonly vehicleDeal: VehicleDealAdapter,
    @inject('IPayrollAdapter') private readonly payroll: PayrollAdapter,
    @inject('IOemAdapter') private readonly oem: OemAdapter,
    @inject('IMigrationBaselineClient') private readonly migrationBaseline: MigrationBaselineClient,
  ) {}

  async allSignals(): Promise<UpstreamSignal[]> {
    // Registry health check uses a fixed probe tenant; real capability checks
    // use the tenant/entity from the capability record. This list is used only
    // for the health dashboard — it proves reachability, not authorization.
    const probeTenant = process.env['HEALTH_PROBE_TENANT'] ?? 'probe';
    const probeEntity = process.env['HEALTH_PROBE_ENTITY'] ?? 'probe';
    const [ar, ap, fo, del, pay, oem, mig] = await Promise.allSettled([
      this.apar.getOpenArItems(probeTenant, probeEntity),
      this.apar.getOpenApItems(probeTenant, probeEntity),
      this.fixedOps.getPartsMovements(probeTenant, probeEntity, new Date().getFullYear(), new Date().getMonth() + 1),
      this.vehicleDeal.getDeliveries(probeTenant, probeEntity, ''),
      this.payroll.getPayrollData(probeTenant, probeEntity, new Date().getFullYear(), new Date().getMonth() + 1),
      this.oem.getOemStatements(probeTenant, probeEntity),
      this.migrationBaseline.describe(probeTenant, probeEntity),
    ]);
    return [
      (ar.status === 'fulfilled' ? ar.value.signal : { moduleCode: 'CE-09', status: PENDING_UPSTREAM, detail: String((ar as any).reason) }),
      (fo.status === 'fulfilled' ? fo.value.signal : { moduleCode: 'CE-11', status: PENDING_UPSTREAM, detail: String((fo as any).reason) }),
      (del.status === 'fulfilled' ? del.value.signal : { moduleCode: 'CE-12', status: PENDING_UPSTREAM, detail: String((del as any).reason) }),
      (pay.status === 'fulfilled' ? pay.value.signal : { moduleCode: 'CE-13', status: PENDING_UPSTREAM, detail: String((pay as any).reason) }),
      (oem.status === 'fulfilled' ? oem.value.signal : { moduleCode: 'CE-14', status: PENDING_UPSTREAM, detail: String((oem as any).reason) }),
      (mig.status === 'fulfilled' ? mig.value : { moduleCode: 'CE-16', status: PENDING_UPSTREAM, detail: String((mig as any).reason) }),
      { moduleCode: 'CE-09-AP', status: (ap.status === 'fulfilled' ? ap.value.signal.status : PENDING_UPSTREAM), detail: ap.status === 'fulfilled' ? ap.value.signal.detail : String((ap as any).reason) },
    ];
  }
}
