// @wave S026 — nightly GL-to-schedule tie-out. Calls gl-service's existing
// GET /trial-balance (no gl-service changes) rather than reading gl-service's
// database directly (microservice boundary, same reasoning schedule-service
// already applies to its own GL journal-source validation call).
// @trace-cobol wave-3-schedule-subsystem.md — no legacy automated tie-out
// existed; schedprn.cbl only printed a disclosed out-of-balance warning when
// the report cutoff preceded the latest detail record
// (schedprn.extraction.md:148-155). This is the automated successor.

export interface GlAccountBalance {
  accountCode: string;
  endingBalance: number;
}

export interface TrialBalanceResponse {
  period: { year: number; month: number };
  accounts: GlAccountBalance[];
  totalDebits: number;
  totalCredits: number;
}

export interface IGlBalanceClient {
  getEndingBalance(
    tenantId: string,
    glAccountNumber: string,
    year: number,
    month: number,
  ): Promise<number>;
}

export class HttpGlBalanceClient implements IGlBalanceClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    // gl-service registers its routes under /api/v1/gl (services/gl-service/
    // src/index.ts:91) — GL_SERVICE_URL is the bare host:port, same env var
    // schedule-service's existing journal-source validation call already
    // reads (application/schedule-service.ts validateJournalSource).
    this.baseUrl = (baseUrl ?? process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010').replace(/\/+$/, '');
  }

  async getEndingBalance(
    tenantId: string,
    glAccountNumber: string,
    year: number,
    month: number,
  ): Promise<number> {
    const res = await fetch(`${this.baseUrl}/api/v1/gl/trial-balance?year=${year}&month=${month}`, {
      headers: { 'x-tenant-id': tenantId },
    });
    if (!res.ok) {
      throw new Error(`gl-service /api/v1/gl/trial-balance returned ${res.status}`);
    }
    const body = (await res.json()) as TrialBalanceResponse;
    const match = body.accounts?.find((r) => r.accountCode === glAccountNumber);
    return match?.endingBalance ?? 0;
  }
}
