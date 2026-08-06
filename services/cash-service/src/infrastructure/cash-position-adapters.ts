// S057 — thin, read-only inter-service adapters for the daily cash
// position composition. Both adapters fail closed and truthfully: a
// network error, timeout, or non-2xx response never fabricates data — it
// reports a clearly-labeled degraded state so the dashboard can render
// "manual entry required" / "pending service integration" instead of a
// silently wrong number. Mirrors the fetch(`${serviceUrl}/...`) inter-
// service call convention already used in apar-service (see
// use-tax-service.ts / manual-payment-service.ts: GL_SERVICE_URL,
// SCHEDULE_SERVICE_URL env vars with a docker-compose-hostname default).

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

export interface BankBalanceResult {
  state: 'OK' | 'MANUAL_ENTRY_REQUIRED';
  bankAccountCode: string;
  balance: string | null;
  asOfDate: string | null;
  note?: string;
}

/**
 * Reads the latest reconciliation/statement balance for a bank account
 * from recon-service (RECON_SERVICE_URL, default matches this repo's
 * docker-compose hostname:port). recon-service's current `/recons`
 * listing does not yet key by bankAccountCode (S054A rebuild adds that) —
 * this adapter degrades to MANUAL_ENTRY_REQUIRED whenever no matching
 * record is found or the service is unreachable, never guessing a
 * balance.
 */
export class ReconServiceBankBalanceAdapter {
  private readonly baseUrl = process.env['RECON_SERVICE_URL'] ?? 'http://recon-service:3014';

  async getLatestBalance(tenantId: string, bankAccountCode: string): Promise<BankBalanceResult> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/v1/recon`, { 'x-tenant-id': tenantId });
      if (!res.ok) {
        return { state: 'MANUAL_ENTRY_REQUIRED', bankAccountCode, balance: null, asOfDate: null, note: `recon-service responded ${res.status}` };
      }
      const recons = (await res.json()) as Array<{ accountName?: string; bankBalance?: number; reconDate?: string }>;
      const match = recons
        .filter((r) => r.accountName === bankAccountCode)
        .sort((a, b) => new Date(b.reconDate ?? 0).getTime() - new Date(a.reconDate ?? 0).getTime())[0];
      if (!match) {
        return { state: 'MANUAL_ENTRY_REQUIRED', bankAccountCode, balance: null, asOfDate: null, note: 'No recon-service record for this bank account yet' };
      }
      return { state: 'OK', bankAccountCode, balance: String(match.bankBalance), asOfDate: match.reconDate ?? null };
    } catch (err: any) {
      return { state: 'MANUAL_ENTRY_REQUIRED', bankAccountCode, balance: null, asOfDate: null, note: `recon-service unreachable: ${err?.message ?? 'unknown error'}` };
    }
  }
}

export interface OutstandingCheckResult {
  state: 'OK' | 'PENDING_SERVICE_INTEGRATION';
  items: Array<{ id: string; amount: string; issuedDate: string | null; payee: string | null }>;
  note: string;
}

/**
 * Reads outstanding (issued-but-not-cleared) AP checks from apar-service.
 * apar-service is explicitly out of this package's editable scope, so
 * this adapter is read-only, best-effort, and fails closed to
 * PENDING_SERVICE_INTEGRATION on ANY error, shape mismatch, or timeout —
 * per the task's instruction to never fake apar-service integration.
 * PUTR note: once apar-service exposes a direct outstanding-checks
 * endpoint, replace the client-side status filter below with a proper
 * server-side query parameter.
 */
export class AparServiceOutstandingChecksAdapter {
  private readonly baseUrl = process.env['APAR_SERVICE_URL'] ?? 'http://apar-service:3013';

  async listOutstandingChecks(tenantId: string): Promise<OutstandingCheckResult> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/v1/apar/manual-payments`, { 'x-tenant-id': tenantId });
      if (!res.ok) {
        return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: `apar-service responded ${res.status}; PUTR — direct outstanding-checks integration pending` };
      }
      const payments = (await res.json()) as Array<{ id: string; status?: string; amount?: string | number; issuedDate?: string; payee?: string }>;
      if (!Array.isArray(payments)) {
        return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: 'apar-service response shape unrecognized; PUTR — direct outstanding-checks integration pending' };
      }
      const outstanding = payments.filter((p) => p.status === 'ISSUED' || p.status === 'OUTSTANDING');
      return {
        state: 'OK',
        items: outstanding.map((p) => ({ id: p.id, amount: String(p.amount ?? '0'), issuedDate: p.issuedDate ?? null, payee: p.payee ?? null })),
        note: 'Sourced from apar-service /manual-payments (client-side status filter; PUTR — replace with a dedicated server-side query once available)',
      };
    } catch (err: any) {
      return { state: 'PENDING_SERVICE_INTEGRATION', items: [], note: `apar-service unreachable: ${err?.message ?? 'unknown error'} — PUTR pending direct integration` };
    }
  }
}
