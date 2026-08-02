/**
 * CE-12 gap-close — fni-reserve-service real schedule-service linkage
 * proof, over genuine HTTP against the REAL, already-running fni-reserve-
 * service (FNI_RESERVE_SERVICE_URL), coa-service (COA_SERVICE_URL), and
 * schedule-service (SCHEDULE_SERVICE_URL) — no scripted/stubbed boundary.
 * Skipped entirely (not failed) unless all required env vars are present.
 *
 * Proves the S094 deferred-income-liability chain end to end: register a
 * deferral booking (real HTTP) -> real coa-service posting -> real
 * JOURNAL_ENTRY_POSTED bridge event -> real schedule-service ScheduleOpenItem
 * on schedule 96, sourced purely from the async bridge (never a direct
 * write from this service's own code).
 *
 * This chain was blocked end-to-end (for all four CE-12 services, not just
 * this one) by two upstream defects, both fixed outside this service's own
 * file tree during CE-12 gap-closure:
 *   1. schedule-service's ScheduleEventHandlers had an undecorated
 *      OpenItemService constructor param that tsx/esbuild's decorator-
 *      metadata emission silently resolved to undefined, crashing every
 *      JOURNAL_ENTRY_POSTED handler invocation (swallowed by the RabbitMQ
 *      consumer's Promise.allSettled+ack) — fixed with an explicit
 *      @inject(OpenItemService).
 *   2. coa-service's schedule-bridge event builder didn't truncate the
 *      posting memo before handing it to schedule-service, whose
 *      ScheduleDetail.description column is VarChar(35) (legacy PIC
 *      X(35)) — this service's own memo templates are longer than that,
 *      so origination postings threw a genuine Postgres "value too long"
 *      error inside schedule-service's own transaction. Fixed by
 *      truncating description to 35 chars, same policy already applied to
 *      controlNumber/applyNumber.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { createServiceToken } from '@amacc/shared-kernel';
import { buildCe12FniReserveRulePacks } from '../../scripts/ce12-rule-pack-definitions';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
const FNI_BASE = (process.env['FNI_RESERVE_SERVICE_URL'] ?? '').replace(/\/$/, '');
const SCHEDULE_BASE = (process.env['SCHEDULE_SERVICE_URL'] ?? '').replace(/\/$/, '');
const COA_BASE = (process.env['COA_SERVICE_URL'] ?? '').replace(/\/$/, '');

const RUN = Boolean(LIVE_DB_URL && JWT_SECRET && FNI_BASE && SCHEDULE_BASE);
const RUN_WITH_COA = Boolean(RUN && COA_BASE);

const TENANT = 'tenant-kunes';
const DEFERRAL_SCHEDULE_NUMBER = '96';

async function coaFetch(path: string, init?: { method?: string; body?: unknown; tenantId?: string; actor?: string }) {
  const hasBody = init?.body !== undefined;
  const res = await fetch(`${COA_BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': init?.tenantId ?? TENANT, Authorization: `Bearer ${token(init?.actor ?? 'ce12-live-test')}` },
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
}

function token(actor: string): string {
  return createServiceToken(actor, JWT_SECRET!);
}

async function fniFetch(path: string, init?: { method?: string; body?: unknown }) {
  const hasBody = init?.body !== undefined;
  const res = await fetch(`${FNI_BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': TENANT, Authorization: `Bearer ${token('ce12-live-test')}` },
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
}

async function scheduleFetch(path: string) {
  const res = await fetch(`${SCHEDULE_BASE}${path}`, {
    headers: { 'x-tenant-id': TENANT, Authorization: `Bearer ${token('ce12-live-test')}` },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
}

function newDealNumber(): string {
  return `D${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

describe.skipIf(!RUN)('fni-reserve-service — real schedule-service linkage (CE-12 gap-close)', () => {
  beforeAll(async () => {
    // Idempotent: OBLIGOR mode for GAP_INSURANCE may already be configured
    // by a prior run of this suite against the same shared cert tenant.
    await fniFetch('/api/v1/fni-reserve/config/deferral-mode', {
      method: 'POST',
      body: { productType: 'GAP_INSURANCE', mode: 'OBLIGOR', earningPatternType: 'STRAIGHT_LINE_MONTHS', earningPatternMonths: 36, effectiveFrom: '2026-01-01' },
    }).catch(() => undefined);
  });

  it('registering a deferral booking really posts through coa-service and really creates a schedule-96 open item via the async JOURNAL_ENTRY_POSTED bridge', async () => {
    const dealNumber = newDealNumber();
    const booked = await fniFetch('/api/v1/fni-reserve/deferral-bookings', {
      method: 'POST',
      body: {
        dealNumber, productCode: 'GAP', productType: 'GAP_INSURANCE', originalAmount: '1200.00',
        bookingDate: '2026-08-02', idempotencyKey: `live-cert-${dealNumber}`,
      },
    });
    expect(booked.ok).toBe(true);
    expect(booked.body.originationStatus).toBe('POSTED');
    expect(booked.body.originationPostingExecutionId).toBeTruthy();

    const expectedControlNumber = `${dealNumber}-GAP`.slice(0, 10);
    let items: any[] | null = null;
    for (let attempt = 0; attempt < 10 && (!items || items.length === 0); attempt++) {
      const res = await scheduleFetch(`/api/v1/schedules/${DEFERRAL_SCHEDULE_NUMBER}/open-items?controlNumber=${encodeURIComponent(expectedControlNumber)}`);
      expect(res.ok).toBe(true);
      items = res.body;
      if (!items || items.length === 0) await new Promise((r) => setTimeout(r, 300));
    }
    expect(items).not.toBeNull();
    expect(items!.length).toBeGreaterThanOrEqual(1);
    const item = items![0];
    expect(item.controlNumber).toBe(expectedControlNumber);
    expect(item.scheduleNumber).toBe(DEFERRAL_SCHEDULE_NUMBER);
    expect(Number(item.remainingBalance)).toBeCloseTo(-1200.0, 2); // liability leg — credit-side sign convention
  }, 30_000);

  it('duplicate registration (same idempotencyKey) does not create a second schedule open item', async () => {
    const dealNumber = newDealNumber();
    const key = `live-cert-dup-${dealNumber}`;
    const body = { dealNumber, productCode: 'GAP', productType: 'GAP_INSURANCE', originalAmount: '500.00', bookingDate: '2026-08-02', idempotencyKey: key };
    const first = await fniFetch('/api/v1/fni-reserve/deferral-bookings', { method: 'POST', body });
    expect(first.ok).toBe(true);
    const second = await fniFetch('/api/v1/fni-reserve/deferral-bookings', { method: 'POST', body });
    expect(second.ok).toBe(true);
    expect(second.body.id).toBe(first.body.id); // same row returned, not a new one

    const expectedControlNumber = `${dealNumber}-GAP`.slice(0, 10);
    await new Promise((r) => setTimeout(r, 500));
    const res = await scheduleFetch(`/api/v1/schedules/${DEFERRAL_SCHEDULE_NUMBER}/open-items?controlNumber=${encodeURIComponent(expectedControlNumber)}`);
    expect(res.ok).toBe(true);
    expect(res.body.length).toBe(1);
  }, 30_000);

  describe.skipIf(!RUN_WITH_COA)('tenant-configurable mapping + reversal (real coa-service)', () => {
    // A brand-new tenant that only ever gets buildCe12FniReserveRulePacks'
    // OWN default output — every accountNumber is the literal
    // ACCOUNT_MAPPING_VALUES_PENDING sentinel (see ce12-rule-pack-
    // definitions.ts's own header comment) — no fixture substitution.
    const BLANK_TENANT = `fni-gapclose-blank-${randomUUID().slice(0, 8)}`;
    const BLANK_ENTITY = `${BLANK_TENANT}-entity`;
    let blankActivated = false;

    beforeAll(async () => {
      const [def] = buildCe12FniReserveRulePacks({ tenantScope: BLANK_TENANT, entityId: BLANK_ENTITY, effectiveFrom: '2026-01-01' })
        .filter((p) => p.packKey === 'ce12.fni-reserve.deferral-booking-origination');
      try {
        const created = await coaFetch('/api/v1/coa/posting-engine/rule-packs', {
          method: 'POST', tenantId: BLANK_TENANT, actor: 'ce12-fni-blank-author',
          body: { packKey: def.packKey, sourceText: JSON.stringify(def) },
        });
        if (!created.ok) throw new Error(`create failed: HTTP ${created.status} ${JSON.stringify(created.body)}`);
        const validated = await coaFetch(`/api/v1/coa/posting-engine/rule-pack-versions/${created.body.id}/validate`, { method: 'POST', tenantId: BLANK_TENANT, actor: 'ce12-fni-blank-author', body: {} });
        if (!validated.ok) throw new Error(`validate failed: HTTP ${validated.status}`);
        const activated = await coaFetch(`/api/v1/coa/posting-engine/rule-pack-versions/${created.body.id}/activate`, { method: 'POST', tenantId: BLANK_TENANT, actor: 'ce12-fni-blank-activator', body: {} });
        if (!activated.ok) throw new Error(`activate failed: HTTP ${activated.status}`);
        blankActivated = true;
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn(`[real-schedule-bridge-live] blank/pending pack activation for ${BLANK_TENANT} did not complete: ${err?.message ?? err}`);
      }
    });

    it('2. [conditional] a tenant with only the BLANK/pending-sentinel pack never gets a POSTED journal from the real coa-service', async (ctx) => {
      if (!blankActivated) { ctx.skip(); return; }
      await fniFetch('/api/v1/fni-reserve/config/deferral-mode', {
        method: 'POST',
        body: { productType: 'GAP_INSURANCE', mode: 'OBLIGOR', earningPatternType: 'STRAIGHT_LINE_MONTHS', earningPatternMonths: 36, effectiveFrom: '2026-01-01' },
      }).catch(() => undefined);
      const dealNumber = newDealNumber();
      const res = await fetch(`${FNI_BASE}/api/v1/fni-reserve/deferral-bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': BLANK_TENANT, Authorization: `Bearer ${token('ce12-live-test')}` },
        body: JSON.stringify({ dealNumber, productCode: 'GAP', productType: 'GAP_INSURANCE', originalAmount: '1200.00', bookingDate: '2026-08-02', idempotencyKey: `blank-${dealNumber}` }),
      });
      const body = await res.json().catch(() => null);
      // Real coa-service response — this tenant only ever got the BLANK
      // (ACCOUNT_MAPPING_VALUES_PENDING) pack and has no real SYSTEM 'FNI'
      // journal source either, so a real POST is structurally impossible;
      // the exact rejection code is coa-service's genuine call, not
      // asserted here (same pattern as deal-accounting-service's own
      // blank-tenant proof).
      expect(body?.originationStatus).not.toBe('POSTED');
    }, 30_000);
  });

  describe.skipIf(!RUN_WITH_COA)('reversal (real coa-service)', () => {
    let pgClient: pg.Client;
    beforeAll(async () => {
      pgClient = new pg.Client({ connectionString: LIVE_DB_URL });
      await pgClient.connect();
    });
    afterAll(async () => {
      await pgClient.end();
    });

    it('3. reversing a real SYSTEM-sourced (FNI) origination journal succeeds via the real coa-service reversal endpoint', async () => {
      const dealNumber = newDealNumber();
      const booked = await fniFetch('/api/v1/fni-reserve/deferral-bookings', {
        method: 'POST',
        body: { dealNumber, productCode: 'GAP', productType: 'GAP_INSURANCE', originalAmount: '900.00', bookingDate: '2026-08-02', idempotencyKey: `rev-${dealNumber}` },
      });
      expect(booked.ok).toBe(true);
      expect(booked.body.originationStatus).toBe('POSTED');

      // coa-service's own journal_line.control_number is unlimited text and
      // stores the FULL, untruncated value — only the outbound bridge event
      // to schedule-service (whose own column is VarChar(10)) truncates it.
      const fullControlNumber = `${dealNumber}-GAP`;
      const row = await pgClient.query(
        `SELECT je.id, je.journal_number FROM journal_line jl JOIN journal_entry je ON je.id = jl.journal_entry_id WHERE je.tenant_id = $1 AND jl.control_number = $2 ORDER BY je.created_at DESC LIMIT 1`,
        [TENANT, fullControlNumber],
      );
      expect(row.rows.length).toBe(1);
      const journalEntryId = row.rows[0].id;

      // FIXED (out of this service's own file scope): coa-service's
      // ReversalService.reverse() used to hardcode callerClass: 'MANUAL'
      // when re-posting a mirrored reversal, so BR013-3 deterministically
      // rejected every reversal of a SYSTEM-sourced (i.e. every CE-12)
      // journal with HTTP 422. Fixed by looking up the original journal's
      // own source and using its sourceClass as the reversal's callerClass.
      const reversed = await coaFetch(`/api/v1/coa/journals/${journalEntryId}:reverse`, {
        method: 'POST', body: { reason: 'CE-12 gap-close fni-reserve-service reversal proof' },
      });
      expect(reversed.ok).toBe(true);
      expect(reversed.body.reversalNumber).toBeTruthy();
      expect(reversed.body.reversalNumber).not.toBe(row.rows[0].journal_number);
    }, 30_000);
  });
});
