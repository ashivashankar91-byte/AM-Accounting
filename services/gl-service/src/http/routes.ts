import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { GLService } from '../application/gl-service';
import { TenantId, asTenantId, GLAccountType, authMiddleware } from '@amacc/shared-kernel';

const NORMAL_BALANCE_MAP: Record<string, 'DEBIT' | 'CREDIT'> = {
  ASSET: 'DEBIT',
  EXPENSE: 'DEBIT',
  COST_OF_SALES: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  REVENUE: 'CREDIT',
};

const CreateAccountSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  type: z.nativeEnum(GLAccountType),
  subType: z.string().max(50).optional(),
  normalBalance: z.enum(['DEBIT', 'CREDIT']).optional(),
  allowPosting: z.boolean().default(true),
  scheduleCode: z.string().max(20).optional(),
  glGroup: z.string().max(50).optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
});

const UpdateAccountSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.nativeEnum(GLAccountType).optional(),
  subType: z.string().max(50).optional(),
  normalBalance: z.enum(['DEBIT', 'CREDIT']).optional(),
  allowPosting: z.boolean().optional(),
  scheduleCode: z.string().max(20).optional(),
  glGroup: z.string().max(50).optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

const CreateJournalEntrySchema = z.object({
  entryDate: z.string().transform((s) => new Date(s)),
  description: z.string().min(1),
  source: z.string().min(1),
  sourceRef: z.string().optional(),
  priorPeriodAdjustment: z.boolean().optional(),
  adjustmentReason: z.string().optional(),
  lines: z.array(
    z.object({
      glAccountId: z.string().uuid().optional(),
      accountCode: z.string().optional(),
      debit: z.number().min(0),
      credit: z.number().min(0),
      memo: z.string().optional(),
      departmentCode: z.string().optional(),
      technicianId: z.string().optional(),
      roNumber: z.string().optional(),
      roLineNumber: z.number().int().optional(),
      flatRateHours: z.number().optional(),
      clockHours: z.number().optional(),
      partNumber: z.string().optional(),
      partQuantity: z.number().optional(),
      earningCode: z.string().optional(),
      dealProductCode: z.string().optional(),
      dealNumber: z.string().optional(),
      vehicleVin: z.string().optional(),
      moduleSource: z.string().optional(),
      laborType: z.string().optional(),
      costType: z.string().optional(),
    }),
  ).min(1),
});

const EntryFiltersSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const PeriodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

/**
 * @trace-improvement COBOL was single-company — tenant was implicit.
 * @platform x-tenant-id header is REQUIRED. Defaulting to 'tenant-kunes' was a critical
 *   bug that could silently route any request to a specific tenant's data.
 */
function getTenantId(request: any): TenantId {
  const tenantId = request.headers['x-tenant-id'] as string | undefined;
  if (!tenantId || tenantId.trim() === '') {
    const err: any = new Error('Missing required header: x-tenant-id');
    err.statusCode = 401;
    throw err;
  }
  return asTenantId(tenantId);
}

export async function glRoutes(app: FastifyInstance) {
  // @platform AMACC_JWT_SECRET must be set in all environments.
  // A fallback secret would silently allow forged tokens in production.
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('FATAL: AMACC_JWT_SECRET environment variable is not set. Set it before starting gl-service.');
  }
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<GLService>('GLService');

  // POST /accounts — Create GL account
  app.post('/accounts', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = CreateAccountSchema.parse(request.body);
    const normalBalance = body.normalBalance ?? NORMAL_BALANCE_MAP[body.type] ?? 'DEBIT';
    // Validate: normalBalance must match account type convention
    const expectedBalance = NORMAL_BALANCE_MAP[body.type];
    if (body.normalBalance && expectedBalance && body.normalBalance !== expectedBalance) {
      return reply.status(400).send({
        error: `normalBalance '${body.normalBalance}' does not match expected '${expectedBalance}' for account type '${body.type}'`,
      });
    }
    const account = await svc.createAccount(
      { ...body, tenantId, parentId: body.parentId ?? null, normalBalance, allowPosting: body.allowPosting ?? true },
      tenantId,
    );
    return reply.status(201).send(account);
  });

  // GET /accounts — List chart of accounts
  app.get('/accounts', async (request, reply) => {
    const tenantId = getTenantId(request);
    const accounts = await svc.getAccounts(tenantId);
    return reply.send(accounts);
  });

  // GET /accounts/:id — Get single account
  app.get('/accounts/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const account = await svc.getAccountById(id, tenantId);
    if (!account) return reply.status(404).send({ error: 'Account not found' });
    return reply.send(account);
  });

  // PUT /accounts/:id — Update GL account
  app.put('/accounts/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const body = UpdateAccountSchema.parse(request.body);
    if (body.type && body.normalBalance) {
      const expected = NORMAL_BALANCE_MAP[body.type];
      if (expected && body.normalBalance !== expected) {
        return reply.status(400).send({
          error: `normalBalance '${body.normalBalance}' does not match expected '${expected}' for type '${body.type}'`,
        });
      }
    }
    const account = await svc.updateAccount(id, body, tenantId);
    return reply.send(account);
  });

  // DELETE /accounts/:id — Soft-delete GL account (sets isActive = false)
  app.delete('/accounts/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const account = await svc.updateAccount(id, { isActive: false }, tenantId);
    return reply.send({ message: 'Account deactivated', account });
  });

  // POST /journal-entries — Create journal entry (DRAFT)
  app.post('/journal-entries', async (request, reply) => {
    const tenantId = getTenantId(request);

    // Log incoming payload for debugging DMS integration
    app.log.info({ body: request.body, source: 'POST /journal-entries', tenantId }, 'Incoming JE payload');

    const body = CreateJournalEntrySchema.parse(request.body);
    const userId = (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? null;

    // Resolve accountCode → glAccountId if needed
    const needsCodeResolution = body.lines.some((l: any) => !l.glAccountId && l.accountCode);
    if (needsCodeResolution) {
      const accounts = await svc.getAccounts(tenantId);
      const codeMap = new Map(accounts.map((a: any) => [a.code, a.id]));
      for (const line of body.lines as any[]) {
        if (!line.glAccountId && line.accountCode) {
          const resolved = codeMap.get(line.accountCode);
          if (!resolved) {
            return reply.status(400).send({ error: `Unknown account code: ${line.accountCode}` });
          }
          line.glAccountId = resolved;
        }
      }
    }

    // Validate every line has a glAccountId
    for (let i = 0; i < body.lines.length; i++) {
      const line = body.lines[i] as any;
      if (!line.glAccountId) {
        return reply.status(400).send({ error: `Line ${i}: requires either glAccountId or accountCode` });
      }
    }

    const entry = await svc.createJournalEntry({ ...body, createdByUserId: userId } as any, tenantId);
    return reply.status(201).send(entry);
  });

  // POST /journal-entries/:id/post — Post entry to ledger
  app.post('/journal-entries/:id/post', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const postedBy = (request.headers['x-user-id'] as string) ?? 'system';
    const entry = await svc.postJournalEntry(id, tenantId, postedBy);
    return reply.send(entry);
  });

  // POST /journal-entries/:id/approve — Agent approves entry after review
  app.post('/journal-entries/:id/approve', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const approverId = (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? 'system';
    const entry = await svc.approveJournalEntry(id, tenantId, approverId);
    return reply.send(entry);
  });

  // ── DMS-native RO ingest endpoint ─────────────────────────────────────────
  // Accepts the full RO breakdown from Agentic DMS and creates a proper
  // multi-line journal entry with all amounts mapped to correct GL accounts.
  const DmsRoIngestSchema = z.object({
    roNumber: z.string().min(1),
    invoiceRef: z.string().optional(),
    description: z.string().optional(),
    laborTotal: z.number().default(0),
    partsTotal: z.number().default(0),
    shopSupplies: z.number().default(0),
    hazmatFee: z.number().default(0),
    discount: z.number().default(0),
    tax: z.number().default(0),
    grandTotal: z.number(),
    paymentMethod: z.string().default('Cash'),
    laborType: z.string().default('CUSTOMER_PAY'),
    technicianId: z.string().optional(),
    vin: z.string().optional(),
  });

  app.post('/ingest/dms-ro', async (request, reply) => {
    const tenantId = getTenantId(request);
    const data = DmsRoIngestSchema.parse(request.body);

    app.log.info({ body: data, source: 'POST /ingest/dms-ro', tenantId }, 'DMS RO ingest');

    // Idempotency: check if this RO was already ingested
    const existing = await svc.getJournalEntries(tenantId, { source: 'AUTOMATE_DMS', limit: 500, offset: 0 } as any);
    const dupe = (existing as any[]).find((e: any) => e.sourceRef === data.roNumber);
    if (dupe) {
      return reply.status(200).send({ status: 'DUPLICATE', journalEntryId: dupe.id, roNumber: data.roNumber });
    }

    // Resolve account codes → UUIDs
    const accounts = await svc.getAccounts(tenantId);
    const codeMap = new Map(accounts.map((a: any) => [a.code, a.id]));

    const resolve = (code: string, ...fallbacks: string[]): string | null => {
      const id = codeMap.get(code);
      if (id) return id;
      for (const fb of fallbacks) { const alt = codeMap.get(fb); if (alt) return alt; }
      return null;
    };

    const lines: any[] = [];

    // DR: Cash / AR for grand total
    const cashId = resolve('1010', '1100', '1000');
    if (cashId) {
      lines.push({ glAccountId: cashId, debit: data.grandTotal, credit: 0, memo: `${data.paymentMethod} — ${data.roNumber}`, roNumber: data.roNumber, moduleSource: 'AUTOMATE_DMS' });
    }

    // CR: Service Labor Revenue
    if (data.laborTotal > 0) {
      const laborId = resolve('4100', '4110');
      if (laborId) {
        lines.push({ glAccountId: laborId, debit: 0, credit: data.laborTotal, memo: `Labor — ${data.roNumber}`, roNumber: data.roNumber, laborType: data.laborType, technicianId: data.technicianId, moduleSource: 'AUTOMATE_DMS' });
      }
    }

    // CR: Parts Revenue
    if (data.partsTotal > 0) {
      const partsId = resolve('4200', '4210', '4300');
      if (partsId) {
        lines.push({ glAccountId: partsId, debit: 0, credit: data.partsTotal, memo: `Parts — ${data.roNumber}`, roNumber: data.roNumber, moduleSource: 'AUTOMATE_DMS' });
      }
    }

    // CR: Shop Supplies (misc revenue or expense offset)
    if (data.shopSupplies > 0) {
      const suppId = resolve('4100', '6900');
      if (suppId) {
        lines.push({ glAccountId: suppId, debit: 0, credit: data.shopSupplies, memo: `Shop supplies 8% — ${data.roNumber}`, roNumber: data.roNumber, moduleSource: 'AUTOMATE_DMS' });
      }
    }

    // CR: Hazmat fee
    if (data.hazmatFee > 0) {
      const hazId = resolve('4100', '6900');
      if (hazId) {
        lines.push({ glAccountId: hazId, debit: 0, credit: data.hazmatFee, memo: `Hazmat fee — ${data.roNumber}`, roNumber: data.roNumber, moduleSource: 'AUTOMATE_DMS' });
      }
    }

    // DR: Discount (reduces revenue)
    if (data.discount > 0) {
      const discId = resolve('4100', '6900');
      if (discId) {
        lines.push({ glAccountId: discId, debit: data.discount, credit: 0, memo: `Discount — ${data.roNumber}`, roNumber: data.roNumber, moduleSource: 'AUTOMATE_DMS' });
      }
    }

    // CR: Sales Tax Payable
    if (data.tax > 0) {
      const taxId = resolve('2030', '2300');
      if (taxId) {
        lines.push({ glAccountId: taxId, debit: 0, credit: data.tax, memo: `Tax — ${data.roNumber}`, roNumber: data.roNumber, moduleSource: 'AUTOMATE_DMS' });
      }
    }

    // ── Auto-balance check ──────────────────────────────────────────────
    // If DMS sent grandTotal but individual line items were 0/missing,
    // the entry would be imbalanced. We MUST ensure DR = CR.
    const totalDr = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const totalCr = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    const diff = Math.round((totalDr - totalCr) * 100) / 100;

    if (Math.abs(diff) > 0.01) {
      // There's an imbalance — allocate the difference to Service Revenue (catch-all)
      const catchAllId = resolve('4100', '4110', '4000', '4200');
      if (catchAllId && diff > 0) {
        // Need more credits
        lines.push({ glAccountId: catchAllId, debit: 0, credit: diff, memo: `Service Revenue (auto-balanced) — ${data.roNumber}`, roNumber: data.roNumber, moduleSource: 'AUTOMATE_DMS' });
        app.log.info({ roNumber: data.roNumber, autoBalancedAmount: diff }, 'Auto-balanced CR shortfall to Service Revenue');
      } else if (catchAllId && diff < 0) {
        // Need more debits (unusual)
        lines.push({ glAccountId: catchAllId, debit: Math.abs(diff), credit: 0, memo: `Adjustment (auto-balanced) — ${data.roNumber}`, roNumber: data.roNumber, moduleSource: 'AUTOMATE_DMS' });
        app.log.info({ roNumber: data.roNumber, autoBalancedAmount: diff }, 'Auto-balanced DR shortfall');
      }
    }

    // Final validation — refuse to create if still imbalanced
    const finalDr = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const finalCr = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    const finalDiff = Math.abs(Math.round((finalDr - finalCr) * 100) / 100);
    if (finalDiff > 0.01) {
      return reply.status(422).send({
        error: 'ENTRY_IMBALANCED',
        message: `Cannot create journal entry: DR $${finalDr.toFixed(2)} ≠ CR $${finalCr.toFixed(2)} (diff $${finalDiff.toFixed(2)})`,
        roNumber: data.roNumber,
      });
    }

    const desc = data.description ?? `Service RO ${data.roNumber} — ${data.laborType}`;
    const entry = await svc.createJournalEntry({
      entryDate: new Date(),
      description: desc,
      source: 'AUTOMATE_DMS',
      sourceRef: data.roNumber,
      lines,
      createdByUserId: 'dms-connector',
    }, tenantId);

    return reply.status(201).send({
      status: 'CREATED',
      journalEntryId: entry.id,
      lineCount: lines.length,
      totalDebits: Math.round(finalDr * 100) / 100,
      totalCredits: Math.round(finalCr * 100) / 100,
      roNumber: data.roNumber,
    });
  });

  // GET /journal-entries/:id — Get a single journal entry by ID
  app.get('/journal-entries/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const entry = await svc.getJournalEntryById(id, tenantId);
    if (!entry) return reply.status(404).send({ error: 'Journal entry not found' });
    return reply.send(entry);
  });

  // GET /journal-entries — List with filters
  app.get('/journal-entries', async (request, reply) => {
    const tenantId = getTenantId(request);
    const filters = EntryFiltersSchema.parse(request.query);
    const entries = await svc.getJournalEntries(tenantId, {
      ...filters,
      status: filters.status as any,
      dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
    });
    return reply.send(entries);
  });

  // GET /trial-balance — Trial balance for period
  app.get('/trial-balance', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { year, month } = PeriodSchema.parse(request.query);
    const tb = await svc.getTrialBalance(tenantId, { year, month } as any);
    return reply.send(tb);
  });

  // GET /periods — List all period statuses (EOM close status)
  app.get('/periods', async (request, reply) => {
    const tenantId = getTenantId(request);
    const periods = await svc.getPeriods(tenantId);
    return reply.send(periods);
  });

  // GET /periods/:year/:month — Get single period status
  app.get('/periods/:year/:month', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { year, month } = request.params as { year: string; month: string };
    const status = await svc.getPeriodStatus(tenantId, parseInt(year), parseInt(month));
    return reply.send({ year: parseInt(year), month: parseInt(month), status });
  });

  // GET /balance-sheet — GAAP Balance Sheet (Assets = Liabilities + Equity)
  app.get('/balance-sheet', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { asOfDate } = z.object({ asOfDate: z.string().default(new Date().toISOString()) }).parse(request.query);
    const bs = await svc.getBalanceSheet(tenantId, new Date(asOfDate));
    return reply.send(bs);
  });

  // GET /income-statement — P&L for a period
  app.get('/income-statement', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { year, month } = PeriodSchema.parse(request.query);
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0);
    const pl = await svc.getIncomeStatement(tenantId, periodStart, periodEnd);
    return reply.send(pl);
  });

  // GET /cash-flow-statement — Cash flow for a period (indirect method)
  app.get('/cash-flow-statement', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { year, month } = PeriodSchema.parse(request.query);
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0);
    const cf = await svc.getCashFlowStatement(tenantId, periodStart, periodEnd);
    return reply.send(cf);
  });

  // ── Intercompany Transactions ─────────────────────

  const prisma = container.resolve<import('.prisma/gl-client').PrismaClient>('PrismaClient');

  // POST /intercompany — Record an intercompany transaction (creates matching entries in both tenants)
  app.post('/intercompany', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = z.object({
      counterpartyTenantId: z.string().min(1),
      entryType: z.enum(['VEHICLE_TRANSFER', 'PARTS_TRANSFER', 'SERVICE_CHARGE', 'MANAGEMENT_FEE', 'OTHER']).default('VEHICLE_TRANSFER'),
      amount: z.number().positive(),
      description: z.string().min(1),
    }).parse(request.body);

    const entry = await prisma.intercompanyEntry.create({
      data: {
        tenantId,
        counterpartyTenantId: body.counterpartyTenantId,
        entryType: body.entryType,
        amount: body.amount,
        description: body.description,
        status: 'PENDING',
      },
    });
    return reply.status(201).send(entry);
  });

  // GET /intercompany — List IC entries for tenant
  app.get('/intercompany', async (request, reply) => {
    const tenantId = getTenantId(request);
    const entries = await prisma.intercompanyEntry.findMany({
      where: {
        OR: [{ tenantId }, { counterpartyTenantId: tenantId }],
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(entries);
  });

  // POST /intercompany/:id/match — Match IC entry with counterparty's journal entry
  app.post('/intercompany/:id/match', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      journalEntryId: z.string().uuid().optional(),
      counterpartyJournalEntryId: z.string().uuid().optional(),
    }).parse(request.body);

    const entry = await prisma.intercompanyEntry.update({
      where: { id },
      data: {
        journalEntryId: body.journalEntryId,
        counterpartyJournalEntryId: body.counterpartyJournalEntryId,
        status: 'MATCHED',
      },
    });
    return reply.send(entry);
  });

  // POST /intercompany/eliminate — Generate elimination journal entries for consolidation
  app.post('/intercompany/eliminate', async (request, reply) => {
    const body = z.object({
      groupTenantIds: z.array(z.string()).min(2),
      consolidationTenantId: z.string().min(1),
      period: z.object({
        year: z.number().int(),
        month: z.number().int().min(1).max(12),
      }),
    }).parse(request.body);

    // Find all uneliminated IC entries between group tenants
    const pendingIC = await prisma.intercompanyEntry.findMany({
      where: {
        tenantId: { in: body.groupTenantIds },
        counterpartyTenantId: { in: body.groupTenantIds },
        status: { in: ['PENDING', 'MATCHED'] },
      },
    });

    if (pendingIC.length === 0) {
      return reply.send({ message: 'No intercompany entries to eliminate', eliminatedCount: 0 });
    }

    const totalElimination = pendingIC.reduce((sum, e) => sum + e.amount, 0);

    // Create elimination journal entry in consolidation tenant
    // IC receivable elimination (debit IC payable, credit IC receivable)
    const icReceivableAccount = await prisma.gLAccount.findFirst({
      where: { tenantId: body.consolidationTenantId, code: '1120' }, // Finance Receivables as proxy
    });
    const icPayableAccount = await prisma.gLAccount.findFirst({
      where: { tenantId: body.consolidationTenantId, code: '2010' }, // AP as proxy
    });

    if (!icReceivableAccount || !icPayableAccount) {
      return reply.status(400).send({ error: 'Consolidation tenant missing IC GL accounts (1120, 2010). Seed CoA first.' });
    }

    const eliminationEntry = await prisma.journalEntry.create({
      data: {
        tenantId: body.consolidationTenantId,
        entryDate: new Date(body.period.year, body.period.month - 1, 28),
        description: `IC Elimination: ${pendingIC.length} entries totalling ${totalElimination}`,
        source: 'INTERCOMPANY_ELIMINATION',
        sourceRef: `IC-ELIM-${body.period.year}-${body.period.month}`,
        status: 'POSTED',
        postedBy: 'CONSOLIDATION',
        postedAt: new Date(),
        lines: {
          create: [
            {
              glAccountId: icPayableAccount.id,
              debit: totalElimination,
              credit: 0,
              memo: 'IC elimination — debit payables',
            },
            {
              glAccountId: icReceivableAccount.id,
              debit: 0,
              credit: totalElimination,
              memo: 'IC elimination — credit receivables',
            },
          ],
        },
      },
    });

    // Mark IC entries as eliminated
    for (const ic of pendingIC) {
      await prisma.intercompanyEntry.update({
        where: { id: ic.id },
        data: { status: 'ELIMINATED', eliminationEntryId: eliminationEntry.id },
      });
    }

    return reply.send({
      eliminationJournalEntryId: eliminationEntry.id,
      eliminatedCount: pendingIC.length,
      totalElimination,
      consolidationTenantId: body.consolidationTenantId,
    });
  });

  // GET /intercompany/consolidated-trial-balance — Consolidated TB across group tenants
  app.get('/intercompany/consolidated-trial-balance', async (request, reply) => {
    const { year, month, groupTenantIds } = z.object({
      year: z.coerce.number().int(),
      month: z.coerce.number().int().min(1).max(12),
      groupTenantIds: z.string().transform(s => s.split(',')),
    }).parse(request.query);

    const consolidated: Map<string, { code: string; name: string; type: string; debit: number; credit: number }> = new Map();

    for (const tid of groupTenantIds) {
      const tb = await svc.getTrialBalance(asTenantId(tid), { year, month } as any);
      for (const row of (tb as any).accounts ?? []) {
        const key = row.accountCode;
        const existing = consolidated.get(key) ?? { code: row.accountCode, name: row.accountName, type: row.accountType, debit: 0, credit: 0 };
        existing.debit += row.debit ?? 0;
        existing.credit += row.credit ?? 0;
        consolidated.set(key, existing);
      }
    }

    const accounts = Array.from(consolidated.values()).sort((a, b) => a.code.localeCompare(b.code));
    const totalDebits = accounts.reduce((s, a) => s + a.debit, 0);
    const totalCredits = accounts.reduce((s, a) => s + a.credit, 0);

    return reply.send({
      period: { year, month },
      groupTenantIds,
      accounts,
      totalDebits,
      totalCredits,
      balanced: Math.abs(totalDebits - totalCredits) < 0.01,
    });
  });

  // ── Admin / System routes ─────────────────────────────────────────────────

  /**
   * POST /admin/ownership-reset
   * Zeros all GL opening balances, optionally clears schedule assignments and period balances.
   * @cobol-origin glzero.cbl, glzerosch.cbl, jrnzero.cbl
   * @authorization SYSTEM_ADMIN role required (enforced by authMiddleware + role check)
   */
  app.post('/admin/ownership-reset', async (request, reply) => {
    const tenantId = getTenantId(request);

    // Require SYSTEM_ADMIN role — this operation is irreversible
    const userRole = (request as any).user?.role;
    if (userRole !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Ownership reset requires SYSTEM_ADMIN role.' });
    }

    const body = z.object({
      clearScheduleAssignments: z.boolean().default(true),
      clearPeriodBalances: z.boolean().default(true),
      initiatedBy: z.string().min(1),
      confirmPhrase: z.literal('I CONFIRM OWNERSHIP RESET'),
    }).parse(request.body);

    const result = await svc.resetForOwnershipChange(
      tenantId,
      body.initiatedBy,
      {
        clearScheduleAssignments: body.clearScheduleAssignments,
        clearPeriodBalances: body.clearPeriodBalances,
      },
    );

    return reply.status(200).send({
      status: 'COMPLETE',
      tenantId,
      ...result,
    });
  });

  /**
   * POST /admin/period-carry-forward
   * EOM ACCT_200 step: aggregate period balances into opening balances for the next period,
   * then purge paid/closed history transaction records.
   * @cobol-origin glzero.cbl CARRY-FWD + histtran.cbl PURGE-HISTORY paragraphs
   * @caller eom-service AcctGLPurgeHandler (ACCT_200 step)
   */
  app.post('/admin/period-carry-forward', async (request, reply) => {
    const tenantId = getTenantId(request);

    const body = z.object({
      periodYear: z.number().int().min(2000).max(2100),
      periodMonth: z.number().int().min(1).max(12),
      purgeHistoryBeforeDate: z.string().transform(s => new Date(s)).optional(),
    }).parse(request.body);

    const result = await svc.performPeriodCarryForward(
      tenantId,
      body.periodYear,
      body.periodMonth,
      body.purgeHistoryBeforeDate,
    );

    return reply.status(200).send({ status: 'COMPLETE', tenantId, ...result });
  });
}
