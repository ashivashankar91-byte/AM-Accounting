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

  // Service-to-service calls to gl-service authenticate with a freshly-signed,
  // short-lived (1h) HS256 service JWT via createServiceToken — the same
  // pattern eom-service/apar-service/posting-recovery-service/the CE-08
  // HttpGlPostingClient already use to call gl-service (packages/shared-kernel
  // /src/middleware/auth.ts), never a static shared secret string.
  // gl-service's authMiddleware requires a valid Authorization bearer on
  // every route, including GET /trial-balance.
  constructor(
    baseUrl?: string,
    private readonly jwtSecret: string = (() => {
      const secret = process.env['AMACC_JWT_SECRET'];
      if (!secret) throw new Error('AMACC_JWT_SECRET environment variable is required but not set');
      return secret;
    })(),
  ) {
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
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const serviceToken = createServiceToken('schedule-service', this.jwtSecret);

    const res = await fetch(`${this.baseUrl}/api/v1/gl/trial-balance?year=${year}&month=${month}`, {
      headers: {
        'x-tenant-id': tenantId,
        Authorization: `Bearer ${serviceToken}`,
      },
    });
    if (!res.ok) {
      throw new Error(`gl-service /api/v1/gl/trial-balance returned ${res.status}`);
    }
    const body = (await res.json()) as TrialBalanceResponse;
    const match = body.accounts?.find((r) => r.accountCode === glAccountNumber);
    return match?.endingBalance ?? 0;
  }
}
