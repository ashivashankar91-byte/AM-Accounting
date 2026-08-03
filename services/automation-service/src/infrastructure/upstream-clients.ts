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

import { injectable } from 'tsyringe';
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

// ── Adapters pending technical reconciliation ────────────────────────────────

const PENDING_DETAIL: Record<string, string> = {
  'CE-09': 'AP / AR / cash open-item contracts are PENDING_UPSTREAM_TECHNICAL_RECONCILIATION. No AR items are returned and no match is asserted against them.',
  'CE-11': 'Fixed Ops parts-movement contracts are PENDING_UPSTREAM_TECHNICAL_RECONCILIATION. No movements are returned and no LIFO layer is derived from them.',
  'CE-12': 'Vehicle / deal / F&I delivery contracts are PENDING_UPSTREAM_TECHNICAL_RECONCILIATION. No deliveries are returned and no attainment is inferred.',
  'CE-13': 'Payroll contracts are PENDING_UPSTREAM_TECHNICAL_RECONCILIATION. No payroll data is returned and no accrual is derived from it.',
  'CE-14': 'OEM statement contracts are PENDING_UPSTREAM_TECHNICAL_RECONCILIATION. No statements are returned and no match is asserted against them.',
};

function pendingSignal(moduleCode: string): UpstreamSignal {
  return { moduleCode, status: PENDING_UPSTREAM, detail: PENDING_DETAIL[moduleCode] ?? `Unknown upstream module ${moduleCode}.` };
}

@injectable()
export class AparAdapter implements IAparAdapter {
  async getOpenArItems(_tenantId: string, _legalEntityId: string) {
    return { signal: pendingSignal('CE-09'), items: [] as any[] };
  }

  async getOpenApItems(_tenantId: string, _legalEntityId: string) {
    return { signal: pendingSignal('CE-09'), items: [] as any[] };
  }
}

@injectable()
export class FixedOpsAdapter implements IFixedOpsAdapter {
  async getPartsMovements(_tenantId: string, _legalEntityId: string, _year: number, _month: number) {
    return { signal: pendingSignal('CE-11'), items: [] as any[] };
  }
}

@injectable()
export class VehicleDealAdapter implements IVehicleDealAdapter {
  async getDeliveries(_tenantId: string, _legalEntityId: string, _programRef: string) {
    return { signal: pendingSignal('CE-12'), items: [] as any[] };
  }

  async getDealCohorts(_tenantId: string, _legalEntityId: string, _from: Date, _to: Date) {
    return { signal: pendingSignal('CE-12'), cohorts: [] as any[] };
  }
}

@injectable()
export class PayrollAdapter implements IPayrollAdapter {
  async getPayrollData(_tenantId: string, _legalEntityId: string, _year: number, _month: number) {
    return { signal: pendingSignal('CE-13'), items: [] as any[] };
  }

  async getEmployeeRecords(_tenantId: string, _subjectIdentifier: string) {
    return { signal: pendingSignal('CE-13'), items: [] as any[] };
  }
}

@injectable()
export class OemAdapter implements IOemAdapter {
  async getOemStatements(_tenantId: string, _legalEntityId: string) {
    return { signal: pendingSignal('CE-14'), items: [] as any[] };
  }

  async getStatementSession(_tenantId: string, _sessionId: string) {
    return { signal: pendingSignal('CE-14'), session: null as any };
  }

  async getIncentivePrograms(_tenantId: string, _legalEntityId: string) {
    return { signal: pendingSignal('CE-14'), items: [] as any[] };
  }
}

@injectable()
export class UpstreamRegistry implements IUpstreamRegistry {
  async allSignals(): Promise<UpstreamSignal[]> {
    return Object.keys(PENDING_DETAIL).map(pendingSignal);
  }
}
