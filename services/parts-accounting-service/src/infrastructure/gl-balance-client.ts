// Authoritative perpetual-to-GL reconciliation boundary — the real S220 GL
// Account Activity Inquiry endpoint (coa-service), called service-to-service
// with a freshly-signed short-lived HS256 service JWT (createServiceToken),
// mirroring posting-client.ts exactly. The browser NEVER computes this
// balance — the server resolves the tenant-configured inventory-control
// account, asks coa-service for its real ending balance as of the
// reconciliation date, and returns that value verbatim. No manual figure is
// ever presented as certified GL truth (see movement-service.ts's
// runReconciliation, which throws rather than falls back to a caller-
// supplied number).

export interface GlAccountBalance {
  accountId: string;
  accountNumber: string;
  balance: number; // dollars, ending balance as of asOfDate (BR220-1 provable)
  asOfDate: string;
}

export interface GlBalanceClient {
  getAccountBalance(tenantId: string, legalEntityId: string, accountNumber: string, asOfDate: string): Promise<GlAccountBalance>;
}

export class GlBalanceUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'GL_BALANCE_UNAVAILABLE';
  constructor(message: string) { super(message); this.name = 'GlBalanceUnavailableError'; }
}

export class HttpGlBalanceClient implements GlBalanceClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016',
    private readonly sourceSystem = 'parts-accounting-service',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getAccountBalance(tenantId: string, legalEntityId: string, accountNumber: string, asOfDate: string): Promise<GlAccountBalance> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const serviceToken = createServiceToken(this.sourceSystem, this.jwtSecret);
    const headers = {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      Authorization: `Bearer ${serviceToken}`,
    };

    // ── Step 1: resolve the account NUMBER to coa-service's internal id —
    // the inquiry endpoint (like every other coa-service account route) is
    // keyed by id, not accountNumber. ──
    let listRes: Response;
    try {
      listRes = await fetch(`${this.baseUrl}/api/v1/coa/accounts?entity=${encodeURIComponent(legalEntityId)}`, { headers });
    } catch (err: any) {
      throw new GlBalanceUnavailableError(`coa-service unreachable while resolving account ${accountNumber}: ${err?.message ?? String(err)}`);
    }
    if (!listRes.ok) {
      throw new GlBalanceUnavailableError(`coa-service account lookup failed for entity ${legalEntityId}: HTTP ${listRes.status}`);
    }
    const listBody: any = await listRes.json().catch(() => null);
    const account = (listBody?.accounts ?? []).find((a: any) => a.accountNumber === accountNumber);
    if (!account) {
      throw new GlBalanceUnavailableError(`GL account ${accountNumber} not found in entity ${legalEntityId} — inventory-control mapping points to a non-existent account.`);
    }

    // ── Step 2: real ending balance as of the reconciliation date. ──
    const params = new URLSearchParams({ startDate: '2000-01-01', endDate: asOfDate });
    let actRes: Response;
    try {
      actRes = await fetch(`${this.baseUrl}/api/v1/coa/inquiry/accounts/${account.id}/activity?${params.toString()}`, { headers });
    } catch (err: any) {
      throw new GlBalanceUnavailableError(`coa-service unreachable while fetching balance for account ${accountNumber}: ${err?.message ?? String(err)}`);
    }
    if (!actRes.ok) {
      const parsed: any = await actRes.json().catch(() => null);
      throw new GlBalanceUnavailableError(`coa-service balance inquiry failed for account ${accountNumber}: ${parsed?.message ?? `HTTP ${actRes.status}`}`);
    }
    const view: any = await actRes.json();
    if (typeof view?.endingBalance !== 'number') {
      throw new GlBalanceUnavailableError(`coa-service returned no ending balance for account ${accountNumber}.`);
    }
    return { accountId: account.id, accountNumber, balance: view.endingBalance, asOfDate };
  }
}

/** In-memory fake for unit tests. */
export class FakeGlBalanceClient implements GlBalanceClient {
  constructor(private readonly script: (accountNumber: string) => number | Error) {}
  async getAccountBalance(_tenantId: string, _legalEntityId: string, accountNumber: string, asOfDate: string): Promise<GlAccountBalance> {
    const result = this.script(accountNumber);
    if (result instanceof Error) throw result;
    return { accountId: `fake-${accountNumber}`, accountNumber, balance: result, asOfDate };
  }
}
