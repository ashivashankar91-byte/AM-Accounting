/**
 * Thin HTTP client for the ONE central S207 permission engine
 * (auth-service: GET /api/v1/authz/check). This is not a second authorization
 * framework — it exists so services other than auth-service (which can call
 * AuthzService.check() in-process) can reach the same engine over HTTP.
 *
 * Fail-closed: any network/parse error is treated as a deny, never an allow.
 * Callers should log the failure (onError) — a broken auth-service must
 * degrade to "nothing is permitted", not "everything is permitted".
 */

export interface AuthzScope {
  tenantId: string;
  entityId?: string | null;
  storeId?: string | null;
}

export interface AuthzCheckRequest {
  userId: string;
  permissionKey: string;
  scope: AuthzScope;
  route?: string;
}

export interface AuthzCheckResult {
  allow: boolean;
  reason?: string;
  matchedRole?: string;
}

export interface AuthzClient {
  check(req: AuthzCheckRequest): Promise<AuthzCheckResult>;
}

export interface AuthzClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  onError?: (err: unknown, req: AuthzCheckRequest) => void;
}

const DENY_ON_ERROR: AuthzCheckResult = { allow: false, reason: 'AUTHZ_SERVICE_UNAVAILABLE' };

export class HttpAuthzClient implements AuthzClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly onError?: (err: unknown, req: AuthzCheckRequest) => void;

  constructor(options: AuthzClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env['AUTHZ_SERVICE_URL'] ?? 'http://auth-service:3001').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.onError = options.onError;
  }

  async check(req: AuthzCheckRequest): Promise<AuthzCheckResult> {
    const params = new URLSearchParams({
      user: req.userId,
      permission: req.permissionKey,
      tenant: req.scope.tenantId,
    });
    if (req.scope.entityId) params.set('entity', req.scope.entityId);
    if (req.scope.storeId) params.set('store', req.scope.storeId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/authz/check?${params.toString()}`, {
        method: 'GET',
        headers: {
          // Required for auth-service's own RLS middleware to set
          // app.current_tenant_id before its authz_role_assignment lookup —
          // without this, the query silently sees zero rows under RLS and
          // every check denies, regardless of a real assignment existing.
          'x-tenant-id': req.scope.tenantId,
          ...(req.route ? { 'x-guarded-route': req.route } : {}),
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        // 400 UNKNOWN_PERMISSION is a call-site bug (typo'd permission key at
        // the guarded route), not a scope decision — surface it as a deny
        // rather than crash the guarded request, but it always indicates a
        // programming error worth logging loudly via onError.
        const body = await res.json().catch(() => ({})) as { message?: string };
        this.onError?.(new Error(`authz/check ${res.status}: ${body.message ?? res.statusText}`), req);
        return DENY_ON_ERROR;
      }
      const body = (await res.json()) as AuthzCheckResult;
      return { allow: Boolean(body.allow), reason: body.reason, matchedRole: body.matchedRole };
    } catch (err) {
      this.onError?.(err, req);
      return DENY_ON_ERROR;
    } finally {
      clearTimeout(timeout);
    }
  }
}
