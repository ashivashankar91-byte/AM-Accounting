import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, CircuitBreaker } from '@amacc/shared-kernel';
import { DMSAdapterRegistry } from '../domain/adapter-registry';
import { mapDealToGLLines } from '../domain/gl-account-mapper';

const IngestSchema = z.object({
  dmsType: z.string().min(1),
  payload: z.record(z.unknown()),
  autoPost: z.boolean().optional(),       // auto-post to GL (default: create as DRAFT)
  transactionType: z.string().optional(),  // override: SERVICE_RO, INVOICE, WARRANTY, INCENTIVE, VEHICLE_SALE
});

const GL_SERVICE_URL = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';

// Gap 8: Circuit breaker for GL service calls
const glCircuit = new CircuitBreaker({ failureThreshold: 3, resetTimeMs: 30000, halfOpenMaxCalls: 1 });

async function callGLService(path: string, tenantId: string, body: unknown): Promise<any> {
  return glCircuit.execute(async () => {
    const resp = await fetch(`${GL_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`GL service error (${resp.status}): ${text}`);
    }
    return resp.json();
  });
}

async function resolveAccountIds(tenantId: string): Promise<Map<string, string>> {
  return glCircuit.execute(async () => {
    const resp = await fetch(`${GL_SERVICE_URL}/api/v1/gl/accounts`, {
      headers: { 'x-tenant-id': tenantId },
    });
    if (!resp.ok) throw new Error('Failed to fetch GL accounts');
    const accounts = await resp.json() as any[];
    const map = new Map<string, string>();
    for (const a of accounts) map.set(a.code, a.id);
    return map;
  });
}

export function connectorRoutes(registry: DMSAdapterRegistry) {
  return async function (app: FastifyInstance) {
    const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
    app.addHook('preHandler', authMiddleware(JWT_SECRET));

    // POST /api/v1/connector/ingest — Ingest DMS data and auto-create GL journal entry
    app.post('/ingest', async (request, reply) => {
      const { dmsType, payload, autoPost, transactionType } = IngestSchema.parse(request.body);
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';

      // 1. Normalize via DMS adapter
      const adapter = registry.get(dmsType);
      const canonical = adapter.normalise(payload);

      // 2. Map to GL journal lines
      const salePrice = canonical.salePrice.amount / 100;  // cents → dollars
      const cost = canonical.costOfSale.amount / 100;
      const dealData = {
        dealNumber: canonical.dealNumber,
        dealType: canonical.dealType as 'NEW' | 'USED' | 'WHOLESALE',
        salePrice,
        cost,
        customerName: canonical.customerName,
        addOns: (canonical.addOns ?? []).map((a: any) => ({
          description: a.description,
          price: typeof a.price === 'number' ? a.price : ((a.price?.amount ?? 0) / 100),
          cost: typeof a.cost === 'number' ? a.cost : ((a.cost?.amount ?? 0) / 100),
        })),
        financeSources: (canonical.financeSources ?? []).map((f: any) => ({
          name: f.name,
          amount: typeof f.amount === 'number' ? f.amount : ((f.amount?.amount ?? 0) / 100),
        })),
        tradeIn: canonical.tradeIn ? {
          vin: canonical.tradeIn.vin,
          allowance: canonical.tradeIn.allowance,
          payoff: canonical.tradeIn.payoff,
        } : undefined,
        transactionType,
      };

      const glLines = mapDealToGLLines(dealData);

      // 3. Resolve GL account codes → UUIDs
      const accountMap = await resolveAccountIds(tenantId);
      const resolvedLines = [];
      for (const line of glLines) {
        const accountId = accountMap.get(line.accountCode);
        if (!accountId) {
          return reply.status(400).send({
            error: `GL account code ${line.accountCode} not found for tenant ${tenantId}`,
          });
        }
        resolvedLines.push({
          glAccountId: accountId,
          debit: Math.round(line.debit * 100) / 100,
          credit: Math.round(line.credit * 100) / 100,
          memo: line.memo,
        });
      }

      // 4. Determine source label based on DMS
      const sourceMap: Record<string, string> = {
        automate: 'AUTOMATE_DMS',
        cdk: 'CONNECTOR_CDK',
        reynolds: 'CONNECTOR_REYNOLDS',
        dealertrack: 'CONNECTOR_DEALERTRACK',
      };

      // 5. Create journal entry in GL service
      const entryPayload = {
        entryDate: canonical.dealDate.toISOString(),
        description: `${canonical.customerName} - ${canonical.dealNumber}`,
        source: sourceMap[adapter.getAdapterName()] ?? 'EXTERNAL_DMS',
        sourceRef: canonical.dealNumber,
        lines: resolvedLines,
      };

      const journalEntry = await callGLService('/api/v1/gl/journal-entries', tenantId, entryPayload);

      // 6. Auto-post if requested
      if (autoPost && journalEntry.id) {
        const posted = await callGLService(
          `/api/v1/gl/journal-entries/${journalEntry.id}/post`,
          tenantId,
          {},
        );
        return reply.status(201).send({
          adapter: adapter.getAdapterName(),
          deal: canonical,
          journalEntry: posted,
          glLines: glLines,
          status: 'POSTED',
        });
      }

      return reply.status(201).send({
        adapter: adapter.getAdapterName(),
        deal: canonical,
        journalEntry,
        glLines: glLines,
        status: 'DRAFT',
      });
    });

    // GET /api/v1/connector/adapters — List available adapters
    app.get('/adapters', async (_request, reply) => {
      const adapters = registry.getAll().map((a) => ({
        name: a.getAdapterName(),
        version: a.getSupportedVersion(),
      }));
      return reply.send(adapters);
    });
  };
}
