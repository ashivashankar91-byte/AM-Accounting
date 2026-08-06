// CE-10 integration — CE-10 IS integrated into this branch's baseline
// (unlike CE-09/CE-07/CE-11), so this service calls tax-service's REAL API
// to fetch the tax result by reference before building the tax posting
// segment's envelope — never a computed/estimated tax amount.
//
// Verified against services/tax-service/src/http/routes.ts directly:
//   GET /api/v1/tax/results/:id  (TAX_PERMISSIONS.RESULT_VIEW-gated; SERVICE-
//   role callers bypass the human RBAC lookup per
//   packages/shared-kernel/src/authz/authz-guard.ts's createAuthzGuard) ->
//   TaxResultQueryService.getById(tenantId, id), 404 via NotFoundError if
//   absent/cross-tenant.
// TaxResult (services/tax-service/prisma/schema.prisma) carries `status`
// (CALCULATED | EXEMPT_APPLIED | ENGINE_UNAVAILABLE | ENGINE_REJECTED |
// NOT_CONFIGURED) and `totalTax` (Decimal 15,2) — only CALCULATED/
// EXEMPT_APPLIED are usable terminal outcomes; any other status (or a fetch
// failure) blocks the deal's TAX posting segment (never estimated).

export type TaxResultStatus = 'CALCULATED' | 'EXEMPT_APPLIED' | 'ENGINE_UNAVAILABLE' | 'ENGINE_REJECTED' | 'NOT_CONFIGURED';

export interface TaxResult {
  id: string;
  tenantId: string;
  status: TaxResultStatus;
  totalTax: string;
  totalTaxableBase: string;
  currency: string;
}

export const USABLE_TAX_RESULT_STATUSES: TaxResultStatus[] = ['CALCULATED', 'EXEMPT_APPLIED'];

export class TaxResultNotFoundError extends Error {
  constructor(readonly taxResultId: string) {
    super(`Tax result "${taxResultId}" was not found (or is not visible to this tenant).`);
    this.name = 'TaxResultNotFoundError';
  }
}

export class TaxResultUnusableError extends Error {
  constructor(readonly taxResultId: string, readonly status: string) {
    super(`Tax result "${taxResultId}" has status "${status}" — not a usable (CALCULATED/EXEMPT_APPLIED) terminal result. Blocked, never estimated.`);
    this.name = 'TaxResultUnusableError';
  }
}

export class TaxServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaxServiceUnavailableError';
  }
}

export interface ITaxResultClient {
  /** Fetches and validates the result is usable, or throws. Never estimates. */
  fetchUsableResult(tenantId: string, taxResultId: string): Promise<TaxResult>;
}

export class HttpTaxResultClient implements ITaxResultClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['TAX_SERVICE_URL'] ?? 'http://tax-service:3051',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async fetchUsableResult(tenantId: string, taxResultId: string): Promise<TaxResult> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const token = createServiceToken('deal-accounting-service', this.jwtSecret);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/tax/results/${encodeURIComponent(taxResultId)}`, {
        method: 'GET',
        headers: { 'x-tenant-id': tenantId, Authorization: `Bearer ${token}` },
      });
    } catch (err: any) {
      throw new TaxServiceUnavailableError(`tax-service unreachable: ${err?.message ?? String(err)}`);
    }
    if (res.status === 404) throw new TaxResultNotFoundError(taxResultId);
    if (!res.ok) {
      let msg = '';
      try { msg = ((await res.json()) as any)?.message ?? ''; } catch { /* ignore */ }
      throw new TaxServiceUnavailableError(`tax-service /results/:id call failed: HTTP ${res.status} ${msg}`);
    }
    const parsed = (await res.json()) as TaxResult;
    if (parsed.tenantId && parsed.tenantId !== tenantId) {
      // Defensive — tax-service's own cross-entity/tenant scoping should
      // already 404 this, but never trust a cross-tenant payload silently.
      throw new TaxResultNotFoundError(taxResultId);
    }
    if (!USABLE_TAX_RESULT_STATUSES.includes(parsed.status)) {
      throw new TaxResultUnusableError(taxResultId, parsed.status);
    }
    return parsed;
  }
}
