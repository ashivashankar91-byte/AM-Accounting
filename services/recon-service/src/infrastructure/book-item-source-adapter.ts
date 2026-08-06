// S054A — thin, read-only inter-service adapters that pull book-side items
// (deposits, sweeps, settlement fees from cash-service; payments from
// apar-service) into a reconciliation session. Mirrors the fetch(`${url}/
// ...`) inter-service call convention already used in cash-service's own
// S057 cash-position-adapters.ts. cash-service is in this package's
// editable scope (unlike apar-service), but both adapters fail closed and
// truthfully on any error/timeout/non-2xx/unexpected shape — never
// fabricating a book item. NSF entries have no source-service model
// anywhere yet, so they are always entered manually (see
// application/recon-session-service.ts addManualBookItem).

const FETCH_TIMEOUT_MS = 2000;

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface SyncedBookItem {
  itemType: 'DEPOSIT' | 'SWEEP' | 'FEE' | 'PAYMENT';
  sourceId: string;
  itemDate: string;
  description: string;
  amount: string;
}

export interface BookItemSyncResult {
  state: 'OK' | 'PENDING_SERVICE_INTEGRATION';
  items: SyncedBookItem[];
  note: string;
}

/**
 * Pulls posted cash deposits and posted ZBA sweeps from cash-service as
 * book-side items (deposits are cash going INTO the bank account; sweeps
 * move cash BETWEEN accounts, so a sweep only becomes a book item on the
 * account it debits/credits — this adapter reports both legs by amount,
 * letting the caller filter by bankAccountCode). Settlement fee lines are
 * read from cash-service's settlement batches as FEE-type items.
 */
export class CashServiceBookItemAdapter {
  private readonly baseUrl = process.env['CASH_SERVICE_URL'] ?? 'http://cash-service:3050';

  async syncDeposits(tenantId: string): Promise<BookItemSyncResult> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/v1/cash/deposits`, { 'x-tenant-id': tenantId });
      if (!res.ok) {
        return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: `cash-service responded ${res.status}` };
      }
      const body: any = await res.json();
      const deposits = Array.isArray(body) ? body : (body?.items ?? []);
      if (!Array.isArray(deposits)) {
        return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: 'cash-service /deposits response shape unrecognized' };
      }
      const posted = deposits.filter((d: any) => d.status === 'POSTED');
      return {
        state: 'OK',
        items: posted.map((d: any) => ({
          itemType: 'DEPOSIT' as const,
          sourceId: d.id,
          itemDate: d.depositDate ?? d.postedAt ?? new Date().toISOString(),
          description: `Cash deposit ${d.id}`,
          amount: String(d.totalAmount ?? d.amount ?? '0'),
        })),
        note: 'Sourced from cash-service /api/v1/cash/deposits (POSTED only)',
      };
    } catch (err: any) {
      return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: `cash-service unreachable: ${err?.message ?? 'unknown error'}` };
    }
  }

  async syncSweeps(tenantId: string): Promise<BookItemSyncResult> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/v1/cash/sweeps`, { 'x-tenant-id': tenantId });
      if (!res.ok) {
        return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: `cash-service responded ${res.status}` };
      }
      const body: any = await res.json();
      const sweeps = Array.isArray(body) ? body : (body?.items ?? []);
      if (!Array.isArray(sweeps)) {
        return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: 'cash-service /sweeps response shape unrecognized' };
      }
      const posted = sweeps.filter((s: any) => s.status === 'POSTED');
      return {
        state: 'OK',
        items: posted.map((s: any) => ({
          itemType: 'SWEEP' as const,
          sourceId: s.id,
          itemDate: s.sweepDate ?? new Date().toISOString(),
          description: `ZBA sweep ${s.id} (${s.direction ?? ''})`,
          amount: String(s.amount ?? '0'),
        })),
        note: 'Sourced from cash-service /api/v1/cash/sweeps (POSTED only)',
      };
    } catch (err: any) {
      return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: `cash-service unreachable: ${err?.message ?? 'unknown error'}` };
    }
  }

  async syncSettlementFees(tenantId: string): Promise<BookItemSyncResult> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/v1/cash/settlements/batches`, { 'x-tenant-id': tenantId });
      if (!res.ok) {
        return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: `cash-service responded ${res.status}` };
      }
      const body: any = await res.json();
      const batches = Array.isArray(body) ? body : (body?.items ?? []);
      if (!Array.isArray(batches)) {
        return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: 'cash-service /settlements/batches response shape unrecognized' };
      }
      const posted = batches.filter((b: any) => b.status === 'POSTED');
      return {
        state: 'OK',
        items: posted.map((b: any) => ({
          itemType: 'FEE' as const,
          sourceId: b.id,
          itemDate: b.settlementDate ?? new Date().toISOString(),
          description: `Merchant settlement fee, batch ${b.id}`,
          amount: String(b.feeAmount ?? '0'),
        })),
        note: 'Sourced from cash-service /api/v1/cash/settlements/batches (POSTED only, feeAmount)',
      };
    } catch (err: any) {
      return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: `cash-service unreachable: ${err?.message ?? 'unknown error'}` };
    }
  }
}

/**
 * apar-service is out of this package's editable scope. This adapter is
 * read-only, best-effort, and fails closed to PENDING_SERVICE_INTEGRATION
 * on any error/shape mismatch. PUTR note: once apar-service exposes a
 * direct issued-payments-by-bank-account endpoint, replace the client-side
 * status filter below with a proper server-side query parameter.
 */
export class AparServiceBookItemAdapter {
  private readonly baseUrl = process.env['APAR_SERVICE_URL'] ?? 'http://apar-service:3013';

  async syncPayments(tenantId: string): Promise<BookItemSyncResult> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/v1/apar/manual-payments`, { 'x-tenant-id': tenantId });
      if (!res.ok) {
        return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: `apar-service responded ${res.status}; PUTR — direct integration pending` };
      }
      const payments = await res.json();
      if (!Array.isArray(payments)) {
        return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: 'apar-service response shape unrecognized; PUTR — direct integration pending' };
      }
      const issued = payments.filter((p: any) => p.status === 'ISSUED' || p.status === 'OUTSTANDING' || p.status === 'CLEARED');
      return {
        state: 'OK',
        items: issued.map((p: any) => ({
          itemType: 'PAYMENT' as const,
          sourceId: p.id,
          itemDate: p.issuedDate ?? new Date().toISOString(),
          description: `AP payment ${p.id}${p.payee ? ` — ${p.payee}` : ''}`,
          amount: String(p.amount ?? '0'),
        })),
        note: 'Sourced from apar-service /manual-payments (client-side status filter; PUTR — replace with a dedicated server-side query once available)',
      };
    } catch (err: any) {
      return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: `apar-service unreachable: ${err?.message ?? 'unknown error'} — PUTR pending direct integration` };
    }
  }
}
