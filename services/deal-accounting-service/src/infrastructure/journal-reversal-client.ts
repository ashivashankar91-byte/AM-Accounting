// S086/S087/S090 — S218 reversal via coa-service's real reversal endpoint.
// Verified against services/coa-service/src/http/journal-routes.ts (the
// colon-action dispatcher `POST /journals/:id:reverse`) and services/coa-
// service/src/application/reversal-service.ts's ReverseDTO/ReverseResult
// shapes directly.

export interface ReverseJournalResult {
  reversalId: string;
  reversalNumber: string;
  reversalPeriod: string;
  originalId: string;
  originalNumber: string;
  reason: string;
  reinstatement: boolean;
  idempotent: boolean;
}

export class JournalReversalError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'JournalReversalError';
  }
}

export interface IJournalReversalClient {
  reverse(tenantId: string, journalEntryId: string, reason: string, targetPeriod?: string | null): Promise<ReverseJournalResult>;
}

export class HttpJournalReversalClient implements IJournalReversalClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async reverse(tenantId: string, journalEntryId: string, reason: string, targetPeriod?: string | null): Promise<ReverseJournalResult> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const token = createServiceToken('deal-accounting-service', this.jwtSecret);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/coa/journals/${encodeURIComponent(journalEntryId)}:reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason, targetPeriod: targetPeriod ?? null }),
      });
    } catch (err: any) {
      throw new JournalReversalError(503, 'COA_SERVICE_UNREACHABLE', `coa-service unreachable: ${err?.message ?? String(err)}`);
    }
    let parsed: any;
    try { parsed = await res.json(); } catch { parsed = null; }
    if (!res.ok) {
      throw new JournalReversalError(res.status, parsed?.error ?? 'REVERSAL_FAILED', parsed?.message ?? `coa-service reversal call failed: HTTP ${res.status}`);
    }
    return parsed as ReverseJournalResult;
  }
}
