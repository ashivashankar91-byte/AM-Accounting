/**
 * S205 — /iam/users Route Tests
 *
 * Exercises the HTTP contract via Fastify inject with a fake UserService + AuthzService.
 * Covers §9 status codes: 201 create, 409 duplicate-email, 200 deactivate/unlock,
 * 202 reset, 422 last-admin-self-deactivation, 403 deny-by-default, 404 not-found.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { userRoutes } from '../src/http/user-routes';
import {
  DuplicateEmailError,
  LastAdminError,
  UserNotFoundError,
  UserValidationError,
} from '../src/application/user-service';

// ── Fakes ─────────────────────────────────────────────────────────────────────

let allow: boolean;
let userSvc: any;

const fakeAuthz = { check: async () => ({ allow, reason: allow ? 'GRANTED' : 'NO_MATCHING_ROLE' }) };

async function makeApp(): Promise<FastifyInstance> {
  container.clearInstances();
  container.registerInstance('AuthzService', fakeAuthz);
  container.registerInstance('UserService', userSvc);
  const app = Fastify();
  await app.register(userRoutes, { prefix: '/api/v1/iam' });
  await app.ready();
  return app;
}

const H = { 'x-tenant-id': 'tenant-a', 'x-user-id': 'admin-1' };
const uv = (over: any = {}) => ({ id: 'u1', email: 'a@x.io', displayName: 'A', status: 'INVITED',
  failedLogins: 0, entityScope: [], storeScope: [], version: 0, ...over });

beforeEach(() => {
  allow = true;
  userSvc = {
    listUsers: async () => [uv({ status: 'ACTIVE' })],
    getUser: async () => uv({ status: 'ACTIVE' }),
    createUser: async (dto: any) => uv({ email: dto.email, displayName: dto.displayName }),
    deactivateUser: async () => ({ user: uv({ status: 'INACTIVE' }), revokedSessions: 3 }),
    unlockUser: async () => uv({ status: 'ACTIVE', failedLogins: 0 }),
    resetUser: async () => ({ user: uv({ status: 'ACTIVE' }), resetToken: 'rst_abc' }),
  };
});

// ── Create ────────────────────────────────────────────────────────────────────

describe('S205 · /iam/users', () => {
  it('PRM205-1: 201 INVITED on create', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/users', headers: H,
      payload: { email: 'new@x.io', displayName: 'New Hire' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: 'new@x.io', status: 'INVITED' });
  });

  it('PRM205-2: 409 on duplicate email (BR205-1)', async () => {
    userSvc.createUser = async () => { throw new DuplicateEmailError('dup@x.io'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/users', headers: H,
      payload: { email: 'dup@x.io', displayName: 'Dup' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('DUPLICATE_EMAIL');
  });

  it('PRM205-3: 400 on invalid create payload', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/users', headers: H,
      payload: { email: '', displayName: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('PRM205-4: 422 on service validation error (bad email)', async () => {
    userSvc.createUser = async () => { throw new UserValidationError('INVALID_EMAIL', 'bad'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/users', headers: H,
      payload: { email: 'x@x.io', displayName: 'X' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('INVALID_EMAIL');
  });

  it('PRM205-5: 403 deny-by-default when the guard denies', async () => {
    allow = false;
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/users', headers: H,
      payload: { email: 'x@x.io', displayName: 'X' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });

  it('PRM205-6: 403 when caller identity headers are missing', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/iam/users' });   // no headers
    expect(res.statusCode).toBe(403);
  });

  it('PRM205-7: 200 list users', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/iam/users', headers: H });
    expect(res.statusCode).toBe(200);
    expect(res.json().users).toHaveLength(1);
  });

  it('PRM205-8: 404 when user not found', async () => {
    userSvc.getUser = async () => { throw new UserNotFoundError('missing'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/iam/users/missing', headers: H });
    expect(res.statusCode).toBe(404);
  });
});

// ── Lifecycle actions ────────────────────────────────────────────────────────────

describe('S205 · lifecycle actions', () => {
  it('PRM205-9: 200 + revoked session count on deactivate', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/users/u1/deactivate', headers: H });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ revokedSessions: 3 });
    expect(res.json().user.status).toBe('INACTIVE');
  });

  it('PRM205-10: 422 on last-admin self-deactivation', async () => {
    userSvc.deactivateUser = async () => { throw new LastAdminError(); };
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/users/admin-1/deactivate', headers: H });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('LAST_ADMIN');
  });

  it('PRM205-11: 200 + failedLogins 0 on unlock', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/users/u1/unlock', headers: H });
    expect(res.statusCode).toBe(200);
    expect(res.json().failedLogins).toBe(0);
  });

  it('PRM205-12: 202 + reset token on reset', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/users/u1/reset', headers: H });
    expect(res.statusCode).toBe(202);
    expect(res.json().resetToken).toMatch(/^rst_/);
  });
});
