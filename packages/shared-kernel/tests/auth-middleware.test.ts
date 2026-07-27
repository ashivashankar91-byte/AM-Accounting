import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authMiddleware, createServiceToken, verifyJWT } from '../src/middleware/auth';

const SECRET = 'test-secret-final-r0-auth-bypass-closure';

function makeRequest(headers: Record<string, string> = {}) {
  return { headers } as any;
}

function makeReply() {
  const reply: any = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(payload: unknown) {
      reply.body = payload;
      return reply;
    },
  };
  return reply;
}

// FINAL-R0 Priority 0 (AUTHENTICATION_BYPASS_CLOSURE): the synthetic-admin
// bypass in authMiddleware must be controlled ONLY by the explicit
// AUTH_BYPASS_ENABLED flag, never by NODE_ENV. These tests prove:
//   1. NODE_ENV=development alone does NOT bypass authentication.
//   2. The explicit AUTH_BYPASS_ENABLED=true flag DOES enable the bypass,
//      regardless of NODE_ENV.
//   3. No combination of NODE_ENV values can accidentally enable synthetic
//      admin access when AUTH_BYPASS_ENABLED is unset, empty, or anything
//      other than the literal string 'true'.
//   4. Fail-closed behavior for missing / malformed / invalid-signature /
//      expired JWTs, and for inconsistent tenant context, when the bypass
//      is (correctly) disabled.
describe('authMiddleware — authentication bypass closure', () => {
  const originalNodeEnv = process.env['NODE_ENV'];
  const originalBypass = process.env['AUTH_BYPASS_ENABLED'];

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
    if (originalBypass === undefined) delete process.env['AUTH_BYPASS_ENABLED'];
    else process.env['AUTH_BYPASS_ENABLED'] = originalBypass;
  });

  it('NODE_ENV=development alone does NOT bypass authentication (no token -> 401)', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['AUTH_BYPASS_ENABLED'];

    const request = makeRequest();
    const reply = makeReply();
    await authMiddleware(SECRET)(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(request.user).toBeUndefined();
  });

  it('NODE_ENV=development with a real Bearer token performs REAL verification, not a synthetic admin', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['AUTH_BYPASS_ENABLED'];

    const token = createServiceToken('svc-under-test', SECRET);
    const request = makeRequest({ authorization: `Bearer ${token}` });
    const reply = makeReply();
    await authMiddleware(SECRET)(request, reply);

    expect(reply.statusCode).toBeUndefined();
    expect(request.user.sub).toBe('svc-under-test');
    expect(request.user.role).toBe('SERVICE'); // not the synthetic 'ADMIN'
  });

  it('AUTH_BYPASS_ENABLED=true enables the explicit test bypass regardless of NODE_ENV', async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AUTH_BYPASS_ENABLED'] = 'true';

    const request = makeRequest({ 'x-tenant-id': 'tenant-abc' });
    const reply = makeReply();
    await authMiddleware(SECRET)(request, reply);

    expect(reply.statusCode).toBeUndefined();
    expect(request.user).toMatchObject({ sub: 'dev-user', role: 'ADMIN', tenantId: 'tenant-abc' });
  });

  it.each(['false', '', 'TRUE', '1', 'yes', undefined])(
    'AUTH_BYPASS_ENABLED=%j never enables the bypass (only the exact string "true" does)',
    async (value) => {
      process.env['NODE_ENV'] = 'production';
      if (value === undefined) delete process.env['AUTH_BYPASS_ENABLED'];
      else process.env['AUTH_BYPASS_ENABLED'] = value;

      const request = makeRequest();
      const reply = makeReply();
      await authMiddleware(SECRET)(request, reply);

      expect(reply.statusCode).toBe(401);
      expect(request.user).toBeUndefined();
    },
  );

  it('production mode can never enable synthetic admin access accidentally: no NODE_ENV value bypasses auth on its own', async () => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    for (const nodeEnv of ['production', 'development', 'test', 'staging', undefined]) {
      if (nodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = nodeEnv;

      const request = makeRequest();
      const reply = makeReply();
      await authMiddleware(SECRET)(request, reply);

      expect(reply.statusCode).toBe(401);
      expect(request.user).toBeUndefined();
    }
  });

  it('fails closed: absent Authorization header -> 401', async () => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    process.env['NODE_ENV'] = 'production';
    const reply = makeReply();
    await authMiddleware(SECRET)(makeRequest(), reply);
    expect(reply.statusCode).toBe(401);
  });

  it('fails closed: malformed Authorization header (no Bearer prefix) -> 401', async () => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    process.env['NODE_ENV'] = 'production';
    const reply = makeReply();
    await authMiddleware(SECRET)(makeRequest({ authorization: 'Basic abc123' }), reply);
    expect(reply.statusCode).toBe(401);
  });

  it('fails closed: invalid JWT signature -> 401', async () => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    process.env['NODE_ENV'] = 'production';
    const token = createServiceToken('svc', SECRET);
    const tampered = token.slice(0, -4) + 'XXXX';
    const reply = makeReply();
    await authMiddleware(SECRET)(makeRequest({ authorization: `Bearer ${tampered}` }), reply);
    expect(reply.statusCode).toBe(401);
  });

  it('fails closed: token signed with the wrong secret -> 401', async () => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    process.env['NODE_ENV'] = 'production';
    const token = createServiceToken('svc', 'a-completely-different-secret');
    const reply = makeReply();
    await authMiddleware(SECRET)(makeRequest({ authorization: `Bearer ${token}` }), reply);
    expect(reply.statusCode).toBe(401);
  });

  it('fails closed: expired JWT -> 401', async () => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    process.env['NODE_ENV'] = 'production';

    // Hand-craft an already-expired token using the same signing scheme as createServiceToken.
    const crypto = await import('crypto');
    const b64url = (data: string) => Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({
      sub: 'svc', tenantId: '*', role: 'SERVICE',
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600, // expired one hour ago
    }));
    const signature = crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
    const expiredToken = `${header}.${payload}.${signature}`;

    const reply = makeReply();
    await authMiddleware(SECRET)(makeRequest({ authorization: `Bearer ${expiredToken}` }), reply);
    expect(reply.statusCode).toBe(401);
  });

  it('fails closed: valid token but x-tenant-id header mismatches JWT tenantId -> 403', async () => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    process.env['NODE_ENV'] = 'production';

    const jwtLib = await import('jsonwebtoken').catch(() => null);
    // Build a tenant-scoped token manually (createServiceToken always uses tenantId '*').
    const crypto = await import('crypto');
    const b64url = (data: string) => Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({
      sub: 'user-1', tenantId: 'tenant-A', role: 'ADMIN',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }));
    const signature = crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
    const token = `${header}.${payload}.${signature}`;
    void jwtLib;

    const request = makeRequest({ authorization: `Bearer ${token}`, 'x-tenant-id': 'tenant-B' });
    const reply = makeReply();
    await authMiddleware(SECRET)(request, reply);
    expect(reply.statusCode).toBe(403);
  });

  it('verifyJWT still throws on malformed tokens (sanity check for the underlying primitive)', () => {
    expect(() => verifyJWT('not-a-jwt', SECRET)).toThrow();
  });
});
