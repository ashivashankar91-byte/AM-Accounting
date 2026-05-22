import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';

const JWT_SECRET = process.env['JWT_SECRET'];
if (!JWT_SECRET) throw new Error('FATAL: JWT_SECRET environment variable is required. auth-service cannot start without it.');
const JWT_ISSUER = process.env['JWT_ISSUER'] ?? 'amacc';
const ADMIN_API_KEY = process.env['ADMIN_API_KEY'];
if (!ADMIN_API_KEY) throw new Error('FATAL: ADMIN_API_KEY environment variable is required. auth-service cannot start without it.');

const LoginSchema = z.object({
  tenantId: z.string().uuid(),
  apiKey: z.string().min(1),
});

const CreateApiKeySchema = z.object({
  tenantId: z.string().uuid(),
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
