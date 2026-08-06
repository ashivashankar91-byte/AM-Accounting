import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { container } from 'tsyringe';
import { RlsTenantContext } from '@amacc/shared-kernel';
import {
  UserService,
  InvalidCredentialsError,
  AccountNotUsableError,
  InvalidSessionError,
} from '../application/user-service';

// Golden R0 UI convergence — Phase 5 defect fix: this file used to sign/verify
// with JWT_SECRET while every consumer of the shared-kernel authMiddleware
// (tenant-service, gl-service, coa-service, audit-service, and this same
// service's own role/user/role-template routes) verifies with
// AMACC_JWT_SECRET — two different values in .env, so every token this route
// issued failed signature verification everywhere except here. Unified to
// AMACC_JWT_SECRET, matching every other consumer. The same split recurred
// in the internal audit outbox drainer's service-token signing
// (packages/shared-kernel/src/audit/audit-client.ts) and was fixed there
// too. JWT_SECRET remains a required env var (kept as a documented fallback
// only) but no longer drives any signature verification path.
const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required. auth-service cannot start without it.');
const JWT_ISSUER = process.env['JWT_ISSUER'] ?? 'amacc';
const ADMIN_API_KEY = process.env['ADMIN_API_KEY'];
if (!ADMIN_API_KEY) throw new Error('FATAL: ADMIN_API_KEY environment variable is required. auth-service cannot start without it.');

// Runtime stabilization: tenantId is a plain non-empty identifier, not a
// UUID. Every real tenant_id value seeded/used across every service
// (tenant-kunes, tenant-kunes-ford in dealer_group_tenants, gl_accounts,
// role, user, authz_role_assignment, etc.) is a human-readable slug, and
// none of the auth flows below actually join against tenant-service's
// Tenant.id (UUID) column. The previous `.uuid()` constraint made login,
// logout, token-exchange and API-key creation unusable for every seeded
// tenant (VALIDATION_ERROR before the request ever reached user lookup).
const LoginSchema = z.object({
  tenantId: z.string().min(1),
  apiKey: z.string().min(1),
});

// FINAL-R0 S205: real user login/session issuance (email + password).
const UserLoginSchema = z.object({
  tenantId: z.string().min(1),
  email:    z.string().min(1).max(254),
  password: z.string().min(1).max(200),
});

const LogoutSchema = z.object({
  tenantId:     z.string().min(1),
  sessionToken: z.string().min(1),
});

const CreateApiKeySchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(1),
  scopes: z.array(z.string()).default(['read', 'write']),
});

export async function authRoutes(app: FastifyInstance) {
  // POST /api/v1/auth/token — Exchange API key for JWT
  app.post('/token', async (request, reply) => {
    const body = LoginSchema.parse(request.body);

    // For MVP: validate API key directly
    // In production: hash comparison from DB
    const token = jwt.sign(
      {
        sub: body.tenantId,
        tenantId: body.tenantId,
        scopes: ['read', 'write'],
      },
      JWT_SECRET!,
      {
        issuer: JWT_ISSUER,
        expiresIn: '8h',
        algorithm: 'HS256',
      },
    );

    return reply.send({
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: 28800,
    });
  });

  // POST /api/v1/auth/login — FINAL-R0 S205: real user login/session issuance.
  // Positive: 200 + { user, accessToken, sessionToken }. Validation: 400 on a
  // malformed body. Unauthorized: 401 with a deliberately generic message for
  // unknown email, wrong password, or account not usable — never distinguishes
  // "no such user" from "wrong password" (standard anti-enumeration practice).
  app.post('/login', async (request, reply) => {
    let body: z.infer<typeof UserLoginSchema>;
    try {
      body = UserLoginSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: err.issues });
      throw err;
    }

    // FINAL-R0 defect fix: /login is pre-authentication -- there is no
    // x-tenant-id header yet for tenantContextHook to have picked up, so the
    // RLS-scoped user lookup below would otherwise run with no tenant context
    // set and silently see zero rows (deny-by-default RLS), turning every
    // login into a false "invalid credentials". The body's tenantId is the
    // only trusted tenant signal available at this point in the auth flow.
    RlsTenantContext.set(body.tenantId);

    const userService = container.resolve<UserService>('UserService');
    const correlationId = (request.headers['x-correlation-id'] as string | undefined) ?? randomUUID();
    const ctx = {
      correlationId,
      ipAddress: request.ip as string | undefined,
      headerTenantId: (request.headers['x-tenant-id'] as string | undefined)?.trim() || undefined,
    };
    try {
      const result = await userService.login(body.tenantId, body.email, body.password, ctx);
      const accessToken = jwt.sign(
        { sub: result.user.id, tenantId: body.tenantId, sessionId: result.sessionId, scopes: ['read', 'write'] },
        JWT_SECRET!,
        { issuer: JWT_ISSUER, expiresIn: '8h', algorithm: 'HS256' },
      );
      return reply.status(200).send({
        user: result.user,
        accessToken,
        tokenType: 'Bearer',
        sessionToken: result.sessionToken,
        expiresAt: result.expiresAt,
      });
    } catch (err) {
      if (err instanceof InvalidCredentialsError || err instanceof AccountNotUsableError) {
        return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid email or password' });
      }
      throw err;
    }
  });

  // POST /api/v1/auth/logout — revoke a session (idempotent).
  app.post('/logout', async (request, reply) => {
    let body: z.infer<typeof LogoutSchema>;
    try {
      body = LogoutSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: err.issues });
      throw err;
    }
    RlsTenantContext.set(body.tenantId); // pre-auth route; see /login comment above
    const userService = container.resolve<UserService>('UserService');
    await userService.logout(body.tenantId, body.sessionToken);
    return reply.status(200).send({ loggedOut: true });
  });

  // GET /api/v1/auth/session — whoami: validates a raw session token.
  app.get('/session', async (request, reply) => {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim();
    const sessionToken = (request.headers['x-session-token'] as string | undefined)?.trim();
    if (!tenantId || !sessionToken) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'x-tenant-id and x-session-token are required' });
    }
    const userService = container.resolve<UserService>('UserService');
    try {
      const user = await userService.validateSession(tenantId, sessionToken);
      return reply.status(200).send({ user });
    } catch (err) {
      if (err instanceof InvalidSessionError) {
        return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Session is invalid, revoked, or expired' });
      }
      throw err;
    }
  });

  // POST /api/v1/auth/verify — Verify JWT token
  app.post('/verify', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing bearer token' });
    }

    try {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, JWT_SECRET!, { issuer: JWT_ISSUER });
      return reply.send({ valid: true, claims: decoded });
    } catch {
      return reply.status(401).send({ error: 'Invalid token' });
    }
  });

  // POST /api/v1/auth/api-keys — Create API key (admin only)
  app.post('/api-keys', async (request, reply) => {
    const adminKey = request.headers['x-admin-api-key'];
    if (adminKey !== ADMIN_API_KEY) {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const body = CreateApiKeySchema.parse(request.body);
    const rawKey = `amacc_${crypto.randomUUID().replace(/-/g, '')}`;
    const keyHash = await bcrypt.hash(rawKey, 10);

    // In production: store in DB
    return reply.status(201).send({
      id: crypto.randomUUID(),
      tenantId: body.tenantId,
      name: body.name,
      key: rawKey, // Only shown once
      scopes: body.scopes,
      createdAt: new Date().toISOString(),
    });
  });
}
