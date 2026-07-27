import * as crypto from 'crypto';

export interface JWTPayload {
  sub: string;
  tenantId: string;
  role: string;
  serviceId?: string;
  iat: number;
  exp: number;
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(base64 + padding, 'base64').toString('utf-8');
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function verifyJWT(token: string, secret: string): JWTPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const [headerB64, payloadB64, signatureB64] = parts;
  const signatureInput = `${headerB64}.${payloadB64}`;
  const expectedSignature = base64UrlEncode(
    crypto.createHmac('sha256', secret).update(signatureInput).digest('binary'),
  );

  if (signatureB64 !== expectedSignature) {
    throw new Error('Invalid JWT signature');
  }

  const payload = JSON.parse(base64UrlDecode(payloadB64)) as JWTPayload;

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('JWT expired');
  }

  return payload;
}

export function createServiceToken(serviceId: string, secret: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    sub: serviceId,
    tenantId: '*',
    role: 'SERVICE',
    serviceId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('binary'),
  );
  return `${header}.${payload}.${signature}`;
}

/**
 * FINAL-R0 Priority 0 fix (AUTHENTICATION_BYPASS_CLOSURE): whether the
 * synthetic-admin authentication bypass below may activate at all. This is
 * intentionally NOT derived from NODE_ENV — `docker-compose.yml` (and most
 * local/dev/CI runs) set NODE_ENV=development, and inferring bypass from that
 * silently disabled real JWT verification for every "live-stack" test run,
 * including ones that were certified as proving real unauthorized/tenant
 * enforcement. The bypass now requires an explicit, separate opt-in flag that
 * defaults to false/disabled whenever unset, misspelled, or set to anything
 * other than the literal string 'true'. There is no NODE_ENV value — including
 * 'development' — that enables it on its own.
 */
function isAuthBypassEnabled(): boolean {
  return process.env['AUTH_BYPASS_ENABLED'] === 'true';
}

/**
 * Generic auth middleware — works with any framework that provides request/reply objects.
 * For Fastify: app.addHook('preHandler', authMiddleware(secret))
 */
export function authMiddleware(secret: string) {
  return async function authenticate(request: any, reply: any) {
    // Explicit, opt-in test/dev bypass ONLY — never inferred from NODE_ENV.
    // Default (AUTH_BYPASS_ENABLED unset or != 'true') is always fail-closed,
    // in every environment, including local development.
    if (isAuthBypassEnabled()) {
      request.user = {
        sub: 'dev-user',
        tenantId: request.headers?.['x-tenant-id'] || '*',
        role: 'ADMIN',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
      };
      return;
    }

    const authHeader = request.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);
    try {
      const payload = verifyJWT(token, secret);
      request.user = payload;

      // Tenant isolation: verify x-tenant-id matches JWT tenantId
      const headerTenantId = request.headers['x-tenant-id'] as string | undefined;
      if (headerTenantId && payload.tenantId !== '*' && payload.tenantId !== headerTenantId) {
        return reply.status(403).send({ error: 'Tenant ID mismatch' });
      }
    } catch (err: any) {
      return reply.status(401).send({ error: err.message ?? 'Authentication failed' });
    }
  };
}
