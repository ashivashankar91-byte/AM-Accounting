import { describe, it, expect, vi } from 'vitest';
import { createAuthzGuard } from '../src/authz/authz-guard';
import type { AuthzClient, AuthzCheckRequest } from '../src/authz/authz-client';
import { createServiceToken, verifyJWT } from '../src/middleware/auth';

// Focused tests for createAuthzGuard's SERVICE-role bypass (added alongside
// the R0 Stabilization Phase 7 / cashflow-service service-to-service auth
// fix). Signature/expiry forgery is already exhaustively covered by
// auth-middleware.test.ts ("fails closed: invalid JWT signature -> 401",
// "wrong secret -> 401") — by the time a request reaches this guard,
// authMiddleware has ALREADY verified a real HMAC signature, so "forging"
// role: 'SERVICE' without the shared secret is not reachable here; what
// this guard itself must get right is: (a) a genuinely trusted SERVICE
// token bypasses the per-user RBAC lookup, (b) an ordinary authenticated
// user's role is NEVER treated as SERVICE regardless of what they claim
// their own tenant/permission scope to be, and (c) the bypass never
// silently fires for an unauthenticated request.

function fakeRequest(user: any, tenantId = 'tenant-a') {
  return { user, headers: { 'x-tenant-id': tenantId }, routeOptions: { url: '/api/v1/gl/trial-balance' } };
}

function fakeReply() {
  const reply: any = { statusCode: 200 };
  reply.status = vi.fn((code: number) => { reply.statusCode = code; return reply; });
  reply.send = vi.fn((body: any) => { reply.body = body; return reply; });
  return reply;
}

describe('createAuthzGuard — SERVICE-role trusted bypass', () => {
  const JWT_SECRET = 'guard-test-secret';

  function makeGuard(checkImpl: AuthzClient['check']) {
    const client: AuthzClient = { check: checkImpl };
    return createAuthzGuard(client, { getTenantId: (r) => r.headers['x-tenant-id'] });
  }

  it('a genuine SERVICE token (createServiceToken) bypasses the per-user RBAC lookup entirely', async () => {
    const checkSpy = vi.fn<AuthzCheckRequest[], Promise<{ allow: boolean }>>();
    const guard = makeGuard(checkSpy as any);
    const token = createServiceToken('cashflow-service', JWT_SECRET);
    const payload = verifyJWT(token, JWT_SECRET);

    const request = fakeRequest(payload);
    const reply = fakeReply();
    await guard('gl.trial_balance.view')(request, reply);

    expect(checkSpy).not.toHaveBeenCalled();
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('an ordinary authenticated user (ADMIN) is NEVER bypassed — still goes through the real RBAC check', async () => {
    const checkSpy = vi.fn(async () => ({ allow: true }));
    const guard = makeGuard(checkSpy);
    const request = fakeRequest({ sub: 'user-1', tenantId: 'tenant-a', role: 'ADMIN' });
    const reply = fakeReply();

    await guard('gl.trial_balance.view')(request, reply);

    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(checkSpy).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', permissionKey: 'gl.trial_balance.view' }));
  });

  it('a user whose JWT role happens to be spelled "service" (lowercase) is NOT bypassed — exact-match only, no case coercion', async () => {
    const checkSpy = vi.fn(async () => ({ allow: false }));
    const guard = makeGuard(checkSpy);
    const request = fakeRequest({ sub: 'user-2', tenantId: 'tenant-a', role: 'service' });
    const reply = fakeReply();

    await guard('gl.trial_balance.view')(request, reply);

    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  it('denies a normal user the real RBAC engine rejects, even though a SERVICE bypass code path exists in the same guard', async () => {
    const checkSpy = vi.fn(async () => ({ allow: false, reason: 'NO_MATCHING_ROLE' }));
    const guard = makeGuard(checkSpy);
    const request = fakeRequest({ sub: 'user-3', tenantId: 'tenant-a', role: 'ACCOUNTANT' });
    const reply = fakeReply();

    await guard('gl.trial_balance.view')(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.body).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
  });

  it('an unauthenticated request (no request.user at all) is rejected with 401 before any bypass or RBAC check runs', async () => {
    const checkSpy = vi.fn(async () => ({ allow: true }));
    const guard = makeGuard(checkSpy);
    const request = fakeRequest(undefined);
    const reply = fakeReply();

    await guard('gl.trial_balance.view')(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it('a forged SERVICE-role claim without the real secret never reaches this guard at all — verifyJWT rejects the bad signature first', () => {
    // This is the actual security boundary: role is read from an ALREADY
    // signature-verified payload (authMiddleware runs before this guard).
    // Demonstrating the primitive itself here, end-to-end coverage already
    // lives in auth-middleware.test.ts.
    const forgedToken = createServiceToken('attacker', 'wrong-secret-the-attacker-guessed');
    expect(() => verifyJWT(forgedToken, JWT_SECRET)).toThrow('Invalid JWT signature');
  });
});
