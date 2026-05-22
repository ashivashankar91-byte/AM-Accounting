import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { GLService } from '../application/gl-service';
import { TenantId, asTenantId, GLAccountType, authMiddleware } from '@amacc/shared-kernel';
import { taxRoutes } from './tax-routes';
import { report1099Routes } from './1099-routes';
import { floorPlanRoutes } from './floor-plan-routes';
import { withSerializableRetry } from '../lib/serializable-retry';

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
  sortKey: z.string().max(20).optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
  cosAccountId: z.string().uuid().optional().nullable(),
  invAccountId: z.string().uuid().optional().nullable(),
  isCashClearing: z.boolean().optional().default(false),
  isDepositClearing: z.boolean().optional().default(false),
  subtotalGroup1: z.string().max(1).optional(),
  subtotalGroup2: z.string().max(1).optional(),
  subtotalGroup3: z.string().max(1).optional(),
  reqControlNumber: z.string().max(1).regex(/^[ ADLS6]$/).optional(),
  printCode: z.string().max(1).regex(/^[DS]$/).optional(),
  isIntercompany: z.boolean().optional().default(false),
}).refine(data => {
  if ((data.cosAccountId && !data.invAccountId) || (!data.cosAccountId && data.invAccountId)) {
    return false;
  }
  return true;
}, { message: "cosAccountId and invAccountId must both be provided or both be null" });

const UpdateAccountSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.nativeEnum(GLAccountType).optional(),
  subType: z.string().max(50).optional(),
  normalBalance: z.enum(['DEBIT', 'CREDIT']).optional(),
  allowPosting: z.boolean().optional(),
  scheduleCode: z.string().max(20).optional(),
  glGroup: z.string().max(50).optional(),
  sortKey: z.string().max(20).optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  cosAccountId: z.string().uuid().optional().nullable(),
  invAccountId: z.string().uuid().optional().nullable(),
  isCashClearing: z.boolean().optional(),
  isDepositClearing: z.boolean().optional(),
  subtotalGroup1: z.string().max(1).optional(),
  subtotalGroup2: z.string().max(1).optional(),
  subtotalGroup3: z.string().max(1).optional(),
  reqControlNumber: z.string().max(1).regex(/^[ ADLS6]$/).optional(),
  printCode: z.string().max(1).regex(/^[DS]$/).optional(),
  isIntercompany: z.boolean().optional(),
}).refine(data => {
  if ((data.cosAccountId && !data.invAccountId) || (!data.cosAccountId && data.invAccountId)) {
    return false;
  }
  return true;
}, { message: "cosAccountId and invAccountId must both be provided or both be null" });

const CreateJournalEntrySchema = z.object({
  entryDate: z.string().transform((s) => new Date(s)),
  description: z.string().min(1),
  source: z.string().min(1),
  sourceRef: z.string().max(8).optional(),
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
      applyCd: z.string().max(1).optional(),
      controlNumber: z.string().max(20).optional(),
      // S2-05: new JournalLine fields
      companyCode: z.string().max(2).optional(),
      applyToCost: z.number().optional(),
      unitCount: z.number().int().optional(),
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
    // STEP 4: Validate cosAccountId/invAccountId references if provided
    if (body.cosAccountId || body.invAccountId) {
      const refIds = [body.cosAccountId, body.invAccountId].filter(Boolean) as string[];
      const refAccounts = await svc.getAccounts(tenantId);
      const refAccountsMap = new Map(refAccounts.map(a => [a.id, a]));
      for (const refId of refIds) {
        const refAccount = refAccountsMap.get(refId);
        if (!refAccount) {
          return reply.status(400).send({
            error: `Referenced account ${refId} not found`,
          });
        }
        if (!refAccount.isActive) {
          return reply.status(400).send({
            error: `Referenced account ${refId} (${refAccount.code}) is inactive`,
          });
        }
      }
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
    // STEP 4: Validate cosAccountId/invAccountId references if provided
    if (body.cosAccountId !== undefined || body.invAccountId !== undefined) {
      const refIds = [body.cosAccountId, body.invAccountId].filter(id => id !== undefined && id !== null) as string[];
      if (refIds.length > 0) {
        const refAccounts = await svc.getAccounts(tenantId);
        const refAccountsMap = new Map(refAccounts.map(a => [a.id, a]));
        for (const refId of refIds) {
          const refAccount = refAccountsMap.get(refId);
          if (!refAccount) {
            return reply.status(400).send({
              error: `Referenced account ${refId} not found`,
            });
          }
          if (!refAccount.isActive) {
            return reply.status(400).send({
              error: `Referenced account ${refId} (${refAccount.code}) is inactive`,
            });
          }
        }
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

    // BUILD-015: Validate required control numbers on posting lines
    const accounts = await svc.getAccounts(tenantId);
    const accountMap = new Map(accounts.map((a: any) => [a.id, a]));
    for (let i = 0; i < body.lines.length; i++) {
      const line = body.lines[i] as any;
      const account = accountMap.get(line.glAccountId);
      if (account && account.reqControlNumber && account.reqControlNumber !== ' ') {
        if (!line.controlNumber) {
          const controlType = account.reqControlNumber === 'A' ? 'apply-to code'
            : account.reqControlNumber === 'D' ? 'driver license number'
            : account.reqControlNumber === 'L' ? 'lookup name'
            : account.reqControlNumber === 'S' ? 'stock number'
            : account.reqControlNumber === '6' ? 'last 6 VIN digits'
            : 'control number';
          return reply.status(422).send({
            error: `Line ${i} (account ${account.code}): requires ${controlType}`,
            accountId: account.id,
            controlType: account.reqControlNumber,
          });
        }
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

  // POST /journal-entries/:id/reverse — CREATE reversal entry (BUILD-006 + S6-05)
  app.post('/journal-entries/:id/reverse', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const body = z.object({
      reversalDate: z.string().transform((s) => new Date(s)),
      reason: z.string().min(1),
    }).parse(request.body);
    // S6-05: Check force_reversal_notes_required system config
    const sysConfig = await (prisma as any).glSystemConfig.findUnique({ where: { tenantId } });
    if (sysConfig?.forceReversalNotesRequired && !body.reason?.trim()) {
      return reply.status(400).send({ error: 'Reversal notes are required by system configuration' });
    }
    const reverserId = (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? 'system';
    const reversalEntry = await svc.reverseJournalEntry(id, tenantId, body.reversalDate, body.reason, reverserId);
    return reply.status(201).send(reversalEntry);
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

  // ── Bank Reconciliation Support (BUILD-008) ────────────────────────────────

  // PATCH /history/:id/clear — Mark history transaction as cleared in bank recon
  app.patch('/history/:id/clear', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const body = z.object({
      clearCode: z.string().length(1).default('C'),
    }).parse(request.body);

    const txn = await (prisma as any).historyTransaction.findFirst({
      where: { id, tenantId },
    });
    if (!txn) return reply.status(404).send({ error: 'HISTORY_TRANSACTION_NOT_FOUND' });

    const updated = await (prisma as any).historyTransaction.update({
      where: { id },
      data: { clearCode: body.clearCode },
    });
    return reply.send(updated);
  });

  // GET /accounts/:accountId/uncleared — Get uncleared transactions for cash clearing account
  app.get('/accounts/:accountId/uncleared', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { accountId } = request.params as { accountId: string };

    const account = await prisma.gLAccount.findFirst({
      where: { id: accountId, tenantId },
    });
    if (!account) return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' });

    const unclearedTxns = await (prisma as any).historyTransaction.findMany({
      where: {
        tenantId,
        glAccountId: accountId,
        clearCode: ' ', // Space = uncleared
      },
      orderBy: { transactionDate: 'asc' },
    });

    return reply.send({
      accountId,
      accountCode: (account as any).code,
      accountName: (account as any).name,
      unclearedCount: unclearedTxns.length,
      transactions: unclearedTxns,
    });
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

  // GET /financial-statements/balance-sheet — alias for /balance-sheet with period param
  app.get('/financial-statements/balance-sheet', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { period, asOfDate } = z.object({ period: z.string().optional(), asOfDate: z.string().optional() }).parse(request.query);
    const date = period ? new Date(`${period}-28`) : asOfDate ? new Date(asOfDate) : new Date();
    const bs = await svc.getBalanceSheet(tenantId, date);
    return reply.send(bs);
  });

  // GET /financial-statements/income-statement — alias with period param
  app.get('/financial-statements/income-statement', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { period, year, month } = z.object({ period: z.string().optional(), year: z.string().optional(), month: z.string().optional() }).parse(request.query);
    let y: number, m: number;
    if (period) {
      const [py, pm] = period.split('-');
      y = parseInt(py ?? '2026'); m = parseInt(pm ?? '1');
    } else {
      y = parseInt(year ?? String(new Date().getFullYear())); m = parseInt(month ?? String(new Date().getMonth() + 1));
    }
    const periodStart = new Date(y, m - 1, 1);
    const periodEnd = new Date(y, m, 0);
    const stmt = await svc.getIncomeStatement(tenantId, periodStart, periodEnd);
    return reply.send(stmt);
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

    const totalElimination = pendingIC.reduce((sum, e) => sum + Number(e.amount), 0);

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

    // Create elimination entry in DRAFT first, then route through full posting pipeline
    // so period balances, history transactions, and COS/INV chain are all written atomically.
    const eliminationEntry = await prisma.journalEntry.create({
      data: {
        tenantId: body.consolidationTenantId,
        entryDate: new Date(body.period.year, body.period.month - 1, 28),
        description: `IC Elimination: ${pendingIC.length} entries totalling ${totalElimination}`,
        source: 'INTERCOMPANY_ELIMINATION',
        sourceRef: `IC-ELIM-${body.period.year}-${body.period.month}`,
        status: 'DRAFT',
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

    // Post through full pipeline: DRAFT → PENDING_REVIEW → POSTED
    // This writes period balances, history transactions, outbox events, and COS/INV chain.
    const consolidationTenantId = body.consolidationTenantId as import('@amacc/shared-kernel').TenantId;
    await svc.postJournalEntry(eliminationEntry.id, consolidationTenantId, 'CONSOLIDATION');
    await svc.approveJournalEntry(eliminationEntry.id, consolidationTenantId, 'CONSOLIDATION');

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

  // ── Cash Receipts ────────────────────────────────────────────────────────
  // GET /cash-receipts — List cash receipt journal entries for the current tenant
  app.get('/cash-receipts', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };
    const cashReceiptSources = ['56', '59', '30', '32'];
    const entries = await prisma.journalEntry.findMany({
      where: { tenantId, source: { in: cashReceiptSources } },
      include: { lines: true },
      orderBy: { entryDate: 'desc' },
      take: Math.min(parseInt(limit, 10) || 50, 200),
      skip: parseInt(offset, 10) || 0,
    });
    return reply.send({ data: entries, total: entries.length });
  });

  // POST /cash-receipts — Record a cash receipt as a balanced journal entry
  // @cobol-origin TRAN-FILE entries with source codes validated against ACSYS-CREC-GLNO
  // @trace-cobol Up to 5 configured cash receipt GL accounts from system config (ACSYS-CREC-GLNO)
  // @trace-improvement COBOL validated source codes via hard-coded ACSYS config file read;
  //   TypeScript reads glSystemConfig.cashReceiptsGlAccounts from the DB (graceful fallback if not configured)
  const CashReceiptSchema = z.object({
    receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'receiptDate must be YYYY-MM-DD'),
    source: z.string().min(1).max(2).default('CR'),
    referenceNumber: z.string().optional(),
    description: z.string().optional().default('Cash receipts'),
    depositAccountId: z.string().min(1),
    lines: z.array(z.object({
      glAccountId: z.string().min(1),
      amount: z.number().gt(0),
      controlNumber: z.string().optional(),
      controlName: z.string().optional(),
    })).min(1, 'At least one receipt line is required'),
  });

  app.post('/cash-receipts', async (request, reply) => {
    const tenantId = getTenantId(request);

    const parsed = CashReceiptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.errors });
    }

    const body = parsed.data;

    // Step 1: Read system config to validate deposit account (graceful: glSystemConfig may not exist yet)
    let sysConfig: { cashReceiptsGlAccounts?: string[]; cutoffDate?: Date } | null = null;
    try {
      sysConfig = await (prisma as any).glSystemConfig.findUnique({ where: { tenantId } });
    } catch {
      // glSystemConfig table doesn't exist yet (BUILD-001 runs in parallel) — fail open
    }

    // Step 2: Validate depositAccountId against configured cash receipt GL accounts
    if (sysConfig?.cashReceiptsGlAccounts && sysConfig.cashReceiptsGlAccounts.length > 0) {
      if (!sysConfig.cashReceiptsGlAccounts.includes(body.depositAccountId)) {
        return reply.status(400).send({
          error: 'INVALID_DEPOSIT_ACCOUNT',
          message: `Deposit account ${body.depositAccountId} is not in the configured cash receipt GL accounts`,
        });
      }
    }
    // If no cashReceiptsGlAccounts configured: accept any active account

    // Step 3: Validate deposit account exists and is active
    const depositAccount = await prisma.gLAccount.findFirst({
      where: { id: body.depositAccountId, tenantId },
      select: { id: true, code: true, name: true, type: true },
    });
    if (!depositAccount) {
      return reply.status(400).send({
        error: 'DEPOSIT_ACCOUNT_NOT_FOUND',
        message: `GL account not found: ${body.depositAccountId}`,
      });
    }

    // Step 4: Validate all line GL accounts exist
    const lineAccountIds = body.lines.map(l => l.glAccountId);
    const uniqueLineAccountIds = [...new Set(lineAccountIds)];
    const lineAccounts = await prisma.gLAccount.findMany({
      where: { id: { in: uniqueLineAccountIds }, tenantId },
      select: { id: true, code: true, name: true },
    });
    if (lineAccounts.length !== uniqueLineAccountIds.length) {
      const found = new Set(lineAccounts.map((a: any) => a.id));
      const missing = uniqueLineAccountIds.filter(id => !found.has(id));
      return reply.status(400).send({
        error: 'LINE_ACCOUNTS_NOT_FOUND',
        message: `GL accounts not found: ${missing.join(', ')}`,
      });
    }

    // Step 5: Validate receipt date vs cutoff date
    if (sysConfig?.cutoffDate) {
      const receiptDateObj = new Date(body.receiptDate);
      if (receiptDateObj < sysConfig.cutoffDate) {
        return reply.status(422).send({
          error: 'BEFORE_CUTOFF_DATE',
          message: `Receipt date ${body.receiptDate} is before the accounting cutoff date ${sysConfig.cutoffDate.toISOString().substring(0, 10)}`,
        });
      }
    }

    // Step 6: Build journal entry lines
    // Debit: deposit clearing account for the total of all receipt lines
    // Credits: individual line amounts to their respective GL accounts
    const totalAmount = body.lines.reduce((sum, l) => sum + l.amount, 0);
    // Round to 2 decimal places to avoid floating-point drift
    const roundedTotal = Math.round(totalAmount * 100) / 100;

    const journalLines: any[] = [
      // Debit: deposit account for total
      {
        glAccountId: body.depositAccountId,
        debit: roundedTotal,
        credit: 0,
        memo: body.description,
      },
      // Credits: one per receipt line
      ...body.lines.map(line => ({
        glAccountId: line.glAccountId,
        debit: 0,
        credit: Math.round(line.amount * 100) / 100,
        memo: [
          body.description,
          line.controlNumber ? `Ctrl: ${line.controlNumber}` : null,
          line.controlName ? line.controlName : null,
        ].filter(Boolean).join(' — '),
        controlNumber: line.controlNumber ?? null,
      })),
    ];

    // Step 7: Create journal entry through the GL service pipeline
    let journalEntry: any;
    try {
      journalEntry = await svc.createJournalEntry(
        {
          entryDate: new Date(body.receiptDate),
          description: body.description ?? 'Cash receipts',
          source: body.source,
          sourceRef: body.referenceNumber,
          lines: journalLines,
          createdByUserId: (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? 'cash-receipt-api',
        } as any,
        tenantId,
      );
    } catch (err: any) {
      return reply.status(422).send({ error: 'CREATE_FAILED', message: err.message });
    }

    // Step 8: Auto-post if the source has autoPost=true (graceful: glSource table may not exist yet)
    let finalStatus: string = journalEntry.status ?? 'DRAFT';
    try {
      const glSource = await (prisma as any).glSource.findFirst({
        where: { tenantId, sourceCode: body.source, isActive: true },
        select: { autoPost: true },
      });
      if (glSource?.autoPost) {
        await svc.postJournalEntry(journalEntry.id, tenantId, 'cash-receipt-api');
        await svc.approveJournalEntry(journalEntry.id, tenantId, 'cash-receipt-api');
        finalStatus = 'POSTED';
      }
    } catch {
      // Auto-post failure is non-fatal — entry stays in DRAFT for manual posting
      // glSource table may not exist yet (BUILD-002 runs in parallel); the receipt was recorded
    }

    return reply.status(201).send({
      receiptId: journalEntry.id,
      journalEntryId: journalEntry.id,
      status: finalStatus,
      totalAmount: roundedTotal,
      lineCount: body.lines.length,
    });
  });

  // ── GL Distribution CRUD ─────────────────────────────────────────────────
  // @cobol-origin getgldistr.cbl — GL-TYPE='%' distribution account management
  // Minimum 2 target accounts required; percentages must sum to exactly 100.00.

  // GET /admin/distributions/:accountId — list all distribution targets for a source account
  app.get('/admin/distributions/:accountId', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    const { accountId } = request.params as { accountId: string };

    const account = await prisma.gLAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!account) return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' });

    const distributions = await (prisma as any).glDistribution.findMany({
      where: { tenantId, sourceAccountId: accountId },
      include: { targetAccount: { select: { id: true, code: true, name: true, type: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    return reply.send({ accountId, distributions });
  });

  // PUT /admin/distributions/:accountId — replace entire distribution table for a source account
  app.put('/admin/distributions/:accountId', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    const { accountId } = request.params as { accountId: string };

    const DistSchema = z.object({
      distributions: z.array(z.object({
        targetAccountId: z.string().min(1),
        percentage: z.number().gt(0).lte(100),
      })).min(2, 'Minimum 2 target accounts required'),
    });

    const parsed = DistSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.errors });

    const { distributions } = parsed.data;

    // Validation a) Source account must exist and be type DISTRIBUTION
    const sourceAccount = await prisma.gLAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!sourceAccount) return reply.status(404).send({ error: 'SOURCE_ACCOUNT_NOT_FOUND' });
    if ((sourceAccount as any).type !== 'DISTRIBUTION') {
      return reply.status(400).send({
        error: 'NOT_DISTRIBUTION_ACCOUNT',
        message: `Account ${(sourceAccount as any).code} is type ${(sourceAccount as any).type}, not DISTRIBUTION`,
      });
    }

    // Validation f) No duplicate target accounts
    const targetIds = distributions.map(d => d.targetAccountId);
    if (new Set(targetIds).size !== targetIds.length) {
      return reply.status(400).send({ error: 'DUPLICATE_TARGETS', message: 'Duplicate target accounts are not allowed' });
    }

    // Validation b+c) All targets must exist, be active, and not be DISTRIBUTION type
    const targetAccounts = await prisma.gLAccount.findMany({
      where: { id: { in: targetIds }, tenantId },
      select: { id: true, code: true, type: true, isActive: true },
    });
    if (targetAccounts.length !== targetIds.length) {
      const found = new Set(targetAccounts.map((a: any) => a.id));
      const missing = targetIds.filter(id => !found.has(id));
      return reply.status(400).send({ error: 'TARGET_ACCOUNTS_NOT_FOUND', message: `Accounts not found: ${missing.join(', ')}` });
    }
    const inactive = targetAccounts.filter((a: any) => !a.isActive);
    if (inactive.length > 0) {
      return reply.status(400).send({ error: 'INACTIVE_TARGET_ACCOUNTS', message: `Inactive accounts: ${(inactive as any[]).map((a: any) => a.code).join(', ')}` });
    }
    const recursive = targetAccounts.filter((a: any) => a.type === 'DISTRIBUTION');
    if (recursive.length > 0) {
      return reply.status(400).send({
        error: 'RECURSIVE_DISTRIBUTION',
        message: `Target accounts cannot be DISTRIBUTION type: ${(recursive as any[]).map((a: any) => a.code).join(', ')}`,
      });
    }

    // Validation d) Percentages must sum to exactly 100.00
    const { Decimal } = await import('@prisma/client/runtime/library');
    const exactTotal = distributions.reduce((sum, d) => sum.plus(new Decimal(d.percentage.toString())), new Decimal(0));
    if (!exactTotal.equals(new Decimal('100'))) {
      return reply.status(400).send({
        error: 'PERCENTAGES_MUST_SUM_TO_100',
        message: `Percentages sum to ${exactTotal.toFixed(2)}, must equal 100.00`,
      });
    }

    // Replace entire distribution table in a transaction
    await (prisma as any).$transaction(async (tx: any) => {
      await tx.glDistribution.deleteMany({ where: { tenantId, sourceAccountId: accountId } });
      await tx.glDistribution.createMany({
        data: distributions.map((d, idx) => ({
          tenantId,
          sourceAccountId: accountId,
          targetAccountId: d.targetAccountId,
          percentage: new Decimal(d.percentage.toString()),
          sortOrder: idx,
        })),
      });
    });

    const updated = await (prisma as any).glDistribution.findMany({
      where: { tenantId, sourceAccountId: accountId },
      include: { targetAccount: { select: { id: true, code: true, name: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    return reply.send({ accountId, distributions: updated });
  });

  // DELETE /admin/distributions/:accountId — remove all distribution targets for a source account
  app.delete('/admin/distributions/:accountId', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    const { accountId } = request.params as { accountId: string };

    const account = await prisma.gLAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!account) return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' });

    await (prisma as any).glDistribution.deleteMany({ where: { tenantId, sourceAccountId: accountId } });
    return reply.status(204).send();
  });

  // ── GL Account ID Mapping (BUILD-007) ──────────────────────────────────────
  // Maps external account IDs (e.g., dealer group codes) to internal GL account UUIDs

  // GET /admin/account-id-map — List all external ID mappings for tenant
  app.get('/admin/account-id-map', async (request, reply) => {
    const tenantId = getTenantId(request);
    const mappings = await (prisma as any).gLAccountIdMap.findMany({
      where: { tenantId },
      include: { glAccount: { select: { id: true, code: true, name: true } } },
      orderBy: { externalAccountId: 'asc' },
    });
    return reply.send(mappings);
  });

  // GET /admin/account-id-map/:extId — Lookup GL account by external ID
  app.get('/admin/account-id-map/:extId', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { extId } = request.params as { extId: string };
    const mapping = await (prisma as any).gLAccountIdMap.findFirst({
      where: { tenantId, externalAccountId: extId },
      include: { glAccount: { select: { id: true, code: true, name: true, type: true } } },
    });
    if (!mapping) return reply.status(404).send({ error: 'MAPPING_NOT_FOUND' });
    return reply.send(mapping);
  });

  // POST /admin/account-id-map — Create external ID mapping
  app.post('/admin/account-id-map', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = z.object({
      externalAccountId: z.string().max(5).min(1),
      glAccountId: z.string().uuid(),
    }).parse(request.body);

    // Validate GL account exists
    const glAccount = await prisma.gLAccount.findFirst({
      where: { id: body.glAccountId, tenantId },
    });
    if (!glAccount) return reply.status(400).send({ error: 'GL_ACCOUNT_NOT_FOUND' });

    try {
      const mapping = await (prisma as any).gLAccountIdMap.create({
        data: {
          tenantId,
          externalAccountId: body.externalAccountId,
          glAccountId: body.glAccountId,
        },
        include: { glAccount: { select: { id: true, code: true, name: true } } },
      });
      return reply.status(201).send(mapping);
    } catch (e: any) {
      if (e.code === 'P2002') {
        return reply.status(409).send({
          error: 'DUPLICATE_EXTERNAL_ID',
          message: `External ID ${body.externalAccountId} already exists`,
        });
      }
      throw e;
    }
  });

  // DELETE /admin/account-id-map/:id — Remove external ID mapping
  app.delete('/admin/account-id-map/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const mapping = await (prisma as any).gLAccountIdMap.findFirst({
      where: { id, tenantId },
    });
    if (!mapping) return reply.status(404).send({ error: 'MAPPING_NOT_FOUND' });
    await (prisma as any).gLAccountIdMap.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ── Auto-Post Job (BUILD-009) ────────────────────────────────────────────────

  // POST /admin/auto-post — Trigger auto-post job for DRAFT entries
  app.post('/admin/auto-post', async (request, reply) => {
    const tenantId = getTenantId(request);

    // Import here to avoid circular dependency
    const { AutoPostJob } = await import('../lib/auto-post-job');
    const job = new AutoPostJob({ prisma, glService: svc });

    try {
      const result = await job.execute(tenantId);
      return reply.send({
        status: 'COMPLETED',
        tenantId,
        ...result,
      });
    } catch (err: any) {
      return reply.status(500).send({
        error: 'AUTO_POST_FAILED',
        message: err.message,
        tenantId,
      });
    }
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

  // ── System Config (ACSYS replacement) ────────────────────────────────────

  /**
   * GET /admin/system-config
   * Returns fiscal year setup for tenant. Returns sensible defaults when not yet configured.
   * @cobol-origin acsys.fd — ACSYS-FISCAL-YEAR-BEGIN, ACSYS-CUTOFF-DATE, ACSYS-LAST-CLOSE-DATE
   */
  app.get('/admin/system-config', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    }
    const config = await prisma.glSystemConfig.findUnique({ where: { tenantId } });
    if (!config) {
      // Return sensible defaults — don't error on missing config
      return reply.send({
        tenantId,
        companyName: null,
        accountingType: ' ',
        fiscalYearStartMonth: 1,
        lastCloseDate: null,
        cutoffDate: null,
        transactionHoldMonths: 2,
        enforceTransactionEdits: false,
        decimalEntryMode: ' ',
        defaultPrintCode: 'D',
        maxFuturePostingMonths: 2,
        lifoMethod: '0',
        cashReceiptsGlAccounts: [],
        ncm20Enabled: false,
        defaultAreaCode: '',
        suppressZeroYtdTrial: false,
      });
    }
    return reply.send(config);
  });

  /**
   * PUT /admin/system-config  (upsert)
   * Create or update fiscal year / accounting system configuration for tenant.
   * @cobol-origin acsys.fd — ACSYS-RECORD write
   */
  app.put('/admin/system-config', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    }

    const SystemConfigUpdateSchema = z.object({
      companyName: z.string().optional(),
      accountingType: z.string().length(1).optional(),
      fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
      lastCloseDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional().nullable(),
      cutoffDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional().nullable(),
      transactionHoldMonths: z.number().int().min(0).max(24).optional(),
      enforceTransactionEdits: z.boolean().optional(),
      decimalEntryMode: z.string().length(1).optional(),
      defaultPrintCode: z.string().length(1).optional(),
      maxFuturePostingMonths: z.number().int().min(0).max(12).optional(),
      lifoMethod: z.enum(['0', '1', '2']).optional(),
      cashReceiptsGlAccounts: z.array(z.string()).optional(),
      ncm20Enabled: z.boolean().optional(),
      defaultAreaCode: z.string().max(3).optional(),
      suppressZeroYtdTrial: z.boolean().optional(),
    });

    const parsed = SystemConfigUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.errors });
    }

    const body = parsed.data;

    // Validate cash receipt GL accounts exist for this tenant
    if (body.cashReceiptsGlAccounts && body.cashReceiptsGlAccounts.length > 0) {
      const found = await prisma.gLAccount.findMany({
        where: { tenantId, id: { in: body.cashReceiptsGlAccounts } },
        select: { id: true },
      });
      if (found.length !== body.cashReceiptsGlAccounts.length) {
        const missing = body.cashReceiptsGlAccounts.filter(id => !found.some(f => f.id === id));
        return reply.status(400).send({ error: 'INVALID_ACCOUNTS', message: `GL accounts not found: ${missing.join(', ')}` });
      }
    }

    const data: Record<string, unknown> = {
      companyName: body.companyName,
      accountingType: body.accountingType,
      fiscalYearStartMonth: body.fiscalYearStartMonth,
      lastCloseDate: body.lastCloseDate ? new Date(body.lastCloseDate) : undefined,
      cutoffDate: body.cutoffDate ? new Date(body.cutoffDate) : undefined,
      transactionHoldMonths: body.transactionHoldMonths,
      enforceTransactionEdits: body.enforceTransactionEdits,
      decimalEntryMode: body.decimalEntryMode,
      defaultPrintCode: body.defaultPrintCode,
      maxFuturePostingMonths: body.maxFuturePostingMonths,
      lifoMethod: body.lifoMethod,
      cashReceiptsGlAccounts: body.cashReceiptsGlAccounts,
      ncm20Enabled: body.ncm20Enabled,
      defaultAreaCode: body.defaultAreaCode,
      suppressZeroYtdTrial: body.suppressZeroYtdTrial,
    };
    // Remove undefined fields so Prisma upsert update doesn't overwrite existing values with null
    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

    const config = await prisma.glSystemConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    return reply.send(config);
  });

  // ===== Journal Sources (BUILD-002) =====
  // @cobol-origin komsrc.cbl SOURCE-FILE — journal source master CRUD
  // @cobol-security joursec.cbl — source-level access control

  // GET /admin/journal-sources
  app.get('/admin/journal-sources', async (request, reply) => {
    const tenantId = getTenantId(request);
    const sources = await prisma.glSource.findMany({
      where: { tenantId },
      orderBy: { sourceCode: 'asc' },
    });
    return reply.send(sources);
  });

  // GET /admin/journal-sources/:id
  // Supports lookup by either UUID id or sourceCode (for eom-service isJournalSourceReservedForYearEnd)
  app.get('/admin/journal-sources/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    // Try by UUID id first; fall back to sourceCode lookup (used by eom-service gl-client)
    const source = await prisma.glSource.findFirst({
      where: { tenantId, OR: [{ id }, { sourceCode: id }] },
    });
    if (!source) return reply.status(404).send({ error: 'NOT_FOUND' });
    // Expose reservedForYearEnd alias for eom-service gl-client compatibility
    return reply.send({ ...source, reservedForYearEnd: source.isYearEndReserved });
  });

  // POST /admin/journal-sources
  app.post('/admin/journal-sources', async (request, reply) => {
    const tenantId = getTenantId(request);

    const CreateSourceSchema = z.object({
      sourceCode: z.string().min(1).max(2),
      name: z.string().min(1),
      isClearingAccount: z.boolean().optional().default(false),
      isYearEndReserved: z.boolean().optional().default(false),
      is13thMonthReserved: z.boolean().optional().default(false),
      balanceMethod: z.string().length(1).optional(),
      autoPost: z.boolean().optional().default(false),
      addUnits: z.boolean().optional().default(false),
    });

    const parsed = CreateSourceSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.errors });

    try {
      const source = await prisma.glSource.create({
        data: { tenantId, ...parsed.data },
      });
      return reply.status(201).send(source);
    } catch (e: any) {
      if (e.code === 'P2002') return reply.status(409).send({ error: 'DUPLICATE_SOURCE_CODE', message: `Source code ${parsed.data.sourceCode} already exists` });
      throw e;
    }
  });

  // PUT /admin/journal-sources/:id
  app.put('/admin/journal-sources/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };

    const UpdateSourceSchema = z.object({
      name: z.string().min(1).optional(),
      isClearingAccount: z.boolean().optional(),
      isYearEndReserved: z.boolean().optional(),
      is13thMonthReserved: z.boolean().optional(),
      balanceMethod: z.string().length(1).optional(),
      autoPost: z.boolean().optional(),
      addUnits: z.boolean().optional(),
      isActive: z.boolean().optional(),
    });

    const parsed = UpdateSourceSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.errors });

    const existing = await prisma.glSource.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.status(404).send({ error: 'NOT_FOUND' });

    const source = await prisma.glSource.update({ where: { id }, data: parsed.data });
    return reply.send(source);
  });

  // DELETE /admin/journal-sources/:id  (soft delete — sets isActive = false)
  app.delete('/admin/journal-sources/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };

    const existing = await prisma.glSource.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.status(404).send({ error: 'NOT_FOUND' });

    await prisma.glSource.update({ where: { id }, data: { isActive: false } });
    return reply.status(204).send();
  });

  // ===== Source Security (FIX-008) =====
  // @cobol-security joursec.cbl — per-user source access control

  // GET /admin/source-security
  app.get('/admin/source-security', async (request, reply) => {
    const tenantId = getTenantId(request);
    const perms = await prisma.journalSourcePermission.findMany({
      where: { tenantId },
      include: { source: { select: { sourceCode: true, name: true } } },
      orderBy: [{ userId: 'asc' }, { source: { sourceCode: 'asc' } }],
    });
    return reply.send(perms);
  });

  // PUT /admin/source-security  (bulk upsert)
  app.put('/admin/source-security', async (request, reply) => {
    const tenantId = getTenantId(request);

    const SecuritySchema = z.object({
      userId: z.string().min(1),
      permissions: z.array(z.object({
        sourceCode: z.string().min(1).max(2),
        hasAccess: z.boolean(),
      })),
    });

    const parsed = SecuritySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.errors });

    const { userId, permissions } = parsed.data;

    // Resolve source codes → source IDs
    const sourceCodes = permissions.map(p => p.sourceCode);
    const sources = await prisma.glSource.findMany({
      where: { tenantId, sourceCode: { in: sourceCodes }, isActive: true },
      select: { id: true, sourceCode: true },
    });
    const sourceMap = new Map(sources.map(s => [s.sourceCode, s.id]));

    const unknown = sourceCodes.filter(c => !sourceMap.has(c));
    if (unknown.length > 0) {
      return reply.status(400).send({ error: 'UNKNOWN_SOURCE_CODES', message: `Unknown source codes: ${unknown.join(', ')}` });
    }

    // Upsert all permissions atomically
    await prisma.$transaction(
      permissions.map(p =>
        prisma.journalSourcePermission.upsert({
          where: { tenantId_userId_sourceId: { tenantId, userId, sourceId: sourceMap.get(p.sourceCode)! } },
          create: { tenantId, userId, sourceId: sourceMap.get(p.sourceCode)!, hasAccess: p.hasAccess },
          update: { hasAccess: p.hasAccess },
        })
      )
    );

    return reply.status(204).send();
  });

  // ===== BUILD-013: LIFO Inventory Valuation Engine =====

  /**
   * POST /admin/lifo-valuation
   * Computes LIFO inventory valuations for specified accounts.
   * Reads lifo_method from gl_system_config:
   * '0' = None (skip); '1' = Link-Chain; '2' = Double-Extension
   * Returns valuation report with reserves and COGS impact.
   */
  const LifoValuationSchema = z.object({
    fiscalYear: z.number().int().min(2000).max(2100),
    inventoryAccountIds: z.array(z.string().uuid()).min(1),
  });

  app.post('/admin/lifo-valuation', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { fiscalYear, inventoryAccountIds } = LifoValuationSchema.parse(request.body);

    try {
      // TODO: Implement LIFO valuation logic
      // 1. Read gl_system_config.lifo_method for tenant
      // 2. For each inventory account, fetch opening/ending quantities and costs
      // 3. Fetch current lifo_layers from database
      // 4. Apply Link-Chain or Double-Extension method
      // 5. Return valuation results with layers, reserves, COGS impact
      return reply.status(201).send({
        message: 'LIFO valuation: implementation in progress',
        fiscalYear,
        accountCount: inventoryAccountIds.length,
        results: [],
      });
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // ===== Phase 1: Sales Tax Accrual (NEW FEATURE) =====
  await taxRoutes(app, prisma);

  // ===== Phase 1: 1099 Contractor Reports (NEW FEATURE) =====
  await report1099Routes(app, prisma);

  // ===== Phase 1: Floor Plan Financing (NEW FEATURE) =====
  await floorPlanRoutes(app, prisma);

  // ===== S3-02/S3-03: Journal Template CRUD =====
  const JournalTemplateLineSchema = z.object({
    lineOrder:      z.number().int().default(0),
    accountCode:    z.string().max(20).optional(),
    memo:           z.string().optional(),
    isCredit:       z.boolean().default(false),
    amount:         z.number().nullable().optional(),
    departmentCode: z.string().optional(),
  });
  const JournalTemplateCreateSchema = z.object({
    templateNumber: z.string().regex(/^[A-Z0-9]{1,8}$/).toUpperCase(),
    name:           z.string().min(1).max(100),
    sourceCode:     z.string().max(2).default('88'),
    companyNumber:  z.string().max(2).default('01'),
    description:    z.string().optional(),
    lines: z.array(JournalTemplateLineSchema).min(1),
  });

  // GET /admin/journal-templates
  app.get('/admin/journal-templates', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { q } = request.query as { q?: string };
    const templates = await prisma.journalTemplate.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(q ? { OR: [
          { templateNumber: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ]} : {}),
      },
      include: { lines: { orderBy: { lineOrder: 'asc' } } },
      orderBy: { templateNumber: 'asc' },
    });
    return reply.send(templates);
  });

  // GET /admin/journal-templates/:id
  app.get('/admin/journal-templates/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const template = await prisma.journalTemplate.findFirst({
      where: { id, tenantId, isActive: true },
      include: { lines: { orderBy: { lineOrder: 'asc' } } },
    });
    if (!template) return reply.status(404).send({ error: 'NOT_FOUND' });
    return reply.send(template);
  });

  // POST /admin/journal-templates
  app.post('/admin/journal-templates', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = JournalTemplateCreateSchema.parse(request.body);
    const existing = await prisma.journalTemplate.findFirst({
      where: { tenantId, templateNumber: body.templateNumber },
    });
    if (existing) return reply.status(409).send({ error: 'DUPLICATE_TEMPLATE_NUMBER' });
    const template = await prisma.journalTemplate.create({
      data: {
        tenantId,
        templateNumber: body.templateNumber,
        name: body.name,
        sourceCode: body.sourceCode,
        companyNumber: body.companyNumber,
        description: body.description ?? null,
        lines: {
          create: body.lines.map((l, idx) => ({
            lineOrder: l.lineOrder ?? idx,
            accountCode: l.accountCode ?? null,
            memo: l.memo ?? null,
            isCredit: l.isCredit ?? false,
            amount: l.amount != null ? String(l.amount) : null,
            departmentCode: l.departmentCode ?? null,
          })),
        },
      },
      include: { lines: { orderBy: { lineOrder: 'asc' } } },
    });
    return reply.status(201).send(template);
  });

  // PUT /admin/journal-templates/:id
  app.put('/admin/journal-templates/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const body = JournalTemplateCreateSchema.partial().parse(request.body);
    const existing = await prisma.journalTemplate.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.status(404).send({ error: 'NOT_FOUND' });
    const template = await prisma.$transaction(async (tx) => {
      if (body.lines) {
        await tx.journalTemplateLine.deleteMany({ where: { templateId: id } });
      }
      return tx.journalTemplate.update({
        where: { id },
        data: {
          ...(body.name        !== undefined ? { name: body.name! }              : {}),
          ...(body.sourceCode  !== undefined ? { sourceCode: body.sourceCode! }  : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          updatedAt: new Date(),
          ...(body.lines ? {
            lines: {
              create: body.lines.map((l, idx) => ({
                lineOrder: l.lineOrder ?? idx,
                accountCode: l.accountCode ?? null,
                memo: l.memo ?? null,
                isCredit: l.isCredit ?? false,
                amount: l.amount != null ? String(l.amount) : null,
                departmentCode: l.departmentCode ?? null,
              })),
            },
          } : {}),
        },
        include: { lines: { orderBy: { lineOrder: 'asc' } } },
      });
    });
    return reply.send(template);
  });

  // DELETE /admin/journal-templates/:id
  app.delete('/admin/journal-templates/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.journalTemplate.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.status(404).send({ error: 'NOT_FOUND' });
    await prisma.$transaction([
      prisma.journalTemplateLine.deleteMany({ where: { templateId: id } }),
      prisma.journalTemplate.delete({ where: { id } }),
    ]);
    return reply.status(204).send();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // S6-04: GL Account Sets — named groups for inquiry/filtering
  // ══════════════════════════════════════════════════════════════════════════

  const AccountSetSchema = z.object({
    setName:     z.string().max(50),
    description: z.string().optional(),
    memberAccountIds: z.array(z.string()).default([]),
  });

  // GET /admin/account-sets
  app.get('/admin/account-sets', async (request, reply) => {
    const tenantId = getTenantId(request);
    const sets = await (prisma as any).gLAccountSet.findMany({
      where: { tenantId },
      include: { members: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { setName: 'asc' },
    });
    return reply.send(sets);
  });

  // POST /admin/account-sets
  app.post('/admin/account-sets', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = AccountSetSchema.parse(request.body);
    const userId = (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? 'system';

    const set = await (prisma as any).gLAccountSet.create({
      data: {
        tenantId,
        setName:     body.setName,
        description: body.description,
        createdBy:   userId,
        members: {
          create: body.memberAccountIds.map((glAccountId, i) => ({
            glAccountId,
            sortOrder: i,
          })),
        },
      },
      include: { members: true },
    });
    return reply.status(201).send(set);
  });

  // PUT /admin/account-sets/:id
  app.put('/admin/account-sets/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const body = AccountSetSchema.parse(request.body);

    const existing = await (prisma as any).gLAccountSet.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.status(404).send({ error: 'Account set not found' });

    // Replace members
    const set = await prisma.$transaction(async (tx) => {
      await (tx as any).gLAccountSetMember.deleteMany({ where: { setId: id } });
      return (tx as any).gLAccountSet.update({
        where: { id },
        data: {
          setName:     body.setName,
          description: body.description,
          members: {
            create: body.memberAccountIds.map((glAccountId, i) => ({
              glAccountId,
              sortOrder: i,
            })),
          },
        },
        include: { members: true },
      });
    });
    return reply.send(set);
  });

  // DELETE /admin/account-sets/:id
  app.delete('/admin/account-sets/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const existing2 = await (prisma as any).gLAccountSet.findFirst({ where: { id, tenantId } });
    if (!existing2) return reply.status(404).send({ error: 'Account set not found' });
    await (prisma as any).gLAccountSet.delete({ where: { id } });
    return reply.status(204).send();
  });

  // GET /admin/account-sets/:id/balances — combined balances for all accounts in the set
  app.get('/admin/account-sets/:id/balances', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const { year, month } = request.query as { year?: string; month?: string };

    const set = await (prisma as any).gLAccountSet.findFirst({
      where: { id, tenantId },
      include: { members: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!set) return reply.status(404).send({ error: 'Account set not found' });

    const accountIds = set.members.map((m: any) => m.glAccountId);
    const accounts   = await prisma.gLAccount.findMany({ where: { id: { in: accountIds }, tenantId } });

    let balanceQuery: any = { glAccountId: { in: accountIds } };
    if (year)  balanceQuery.periodYear  = Number(year);
    if (month) balanceQuery.periodMonth = Number(month);

    const balances = await (prisma as any).gLAccountPeriodBalance.findMany({ where: balanceQuery });

    const accountMap = new Map(accounts.map((a: any) => [a.id, a]));
    const result = accountIds.map((acctId: string) => {
      const acct = accountMap.get(acctId) as any;
      const acctBalances = balances.filter((b: any) => b.glAccountId === acctId);
      const totalNet    = acctBalances.reduce((s: number, b: any) => s + Number(b.runningBalance ?? 0), 0);
      return {
        glAccountId:  acctId,
        code:         acct?.code,
        name:         acct?.name,
        type:         acct?.type,
        totalDebits:  totalNet,
        totalCredits: 0,
        netBalance:   totalNet,
      };
    });

    const setTotal = result.reduce((s: number, r: any) => s + r.netBalance, 0);
    return reply.send({ setId: id, setName: set.setName, accounts: result, setTotal });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // S6-11: Expense Trend Report — server-side XLSX generation
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/reports/expense-trend', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { months = '12', accountType = 'EXPENSE' } = request.query as { months?: string; accountType?: string };
    const numMonths = Math.min(Math.max(parseInt(months, 10) || 12, 1), 36);

    // Build list of (year, month) going back numMonths from current
    const now = new Date();
    const periods: { year: number; month: number; label: string }[] = [];
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      periods.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` });
    }

    // Fetch accounts of the given type
    const accounts = await prisma.gLAccount.findMany({
      where: { tenantId, type: accountType, isActive: true },
      orderBy: [{ code: 'asc' }],
    });

    // Fetch period balances for all those accounts
    const accountIds = accounts.map((a: any) => a.id);
    const allBalances = await (prisma as any).gLAccountPeriodBalance.findMany({
      where: {
        glAccountId: { in: accountIds },
        periodYear:  { in: [...new Set(periods.map(p => p.year))] },
        periodMonth: { in: [...new Set(periods.map(p => p.month))] },
      },
    });

    // Try to use ExcelJS if available, else return JSON
    let ExcelJS: any;
    try {
      ExcelJS = await import('exceljs' as any);
    } catch {
      // ExcelJS not installed — return JSON representation
      const rows = accounts.map((acct: any) => {
        const monthData: Record<string, number> = {};
        for (const p of periods) {
          const b = allBalances.find((b: any) => b.glAccountId === acct.id && b.periodYear === p.year && b.periodMonth === p.month);
          monthData[p.label] = b ? Number(b.runningBalance ?? 0) : 0;
        }
        const ytd     = Object.values(monthData).reduce((s, v) => s + v, 0);
        const average = ytd / numMonths;
        return { code: acct.code, name: acct.name, ...monthData, ytd, average };
      });
      return reply.send({ accountType, periods: periods.map(p => p.label), rows });
    }

    const workbook  = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Expense Trend');

    // Header row
    const headerRow = ['Account#', 'Account Name', ...periods.map(p => p.label), 'YTD Total', 'Average'];
    const hRow = worksheet.addRow(headerRow);
    hRow.font = { bold: true };
    hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    hRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Data rows
    for (const acct of accounts) {
      const rowData: (string | number)[] = [acct.code, acct.name];
      let ytd = 0;
      for (const p of periods) {
        const b = allBalances.find((b: any) => b.glAccountId === acct.id && b.periodYear === p.year && b.periodMonth === p.month);
        const val = b ? Number(b.runningBalance ?? 0) : 0;
        ytd += val;
        rowData.push(val);
      }
      rowData.push(ytd, ytd / numMonths);
      const row = worksheet.addRow(rowData);

      // Format currency columns (skip Account# and Account Name)
      for (let c = 3; c <= headerRow.length; c++) {
        const cell = row.getCell(c);
        cell.numFmt = '$#,##0.00';
      }
    }

    // Auto-size columns
    worksheet.columns.forEach((col: any) => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: true }, (cell: any) => {
        maxLen = Math.max(maxLen, String(cell.value ?? '').length + 2);
      });
      col.width = Math.min(maxLen, 25);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="expense-trend-${accountType}-${numMonths}mo.xlsx"`);
    return reply.send(buffer);
  });

  // ── S7-01: Vehicle Transfer IC GL ──────────────────────────────────────────
  // @net-new: Multi-rooftop vehicle transfers with atomic IC GL entries

  app.get('/vehicle-transfers', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { vin, status, fromCompany, toCompany } = request.query as any;
    const where: any = { tenantId };
    if (vin) where.vin = vin;
    if (status) where.status = status;
    if (fromCompany) where.fromCompanyCode = fromCompany;
    if (toCompany) where.toCompanyCode = toCompany;
    const transfers = await (prisma as any).vehicleTransfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(transfers);
  });

  app.get('/vehicle-transfers/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const transfer = await (prisma as any).vehicleTransfer.findFirst({ where: { id, tenantId } });
    if (!transfer) return reply.status(404).send({ error: 'Vehicle transfer not found' });
    return reply.send(transfer);
  });

  app.post('/vehicle-transfers', async (request, reply) => {
    const tenantId = getTenantId(request);
    const {
      fromCompanyCode, toCompanyCode, vin, stockNumber,
      vehicleYear, vehicleMake, vehicleModel, totalCost,
      transferDate,
      fromInventoryGlAccountId, toInventoryGlAccountId,
      fromIcOffsetGlAccountId, toIcOffsetGlAccountId,
      initiatedBy,
    } = request.body as any;

    // Validations
    if (!fromCompanyCode || !toCompanyCode || !vin || !totalCost) {
      return reply.status(400).send({ error: 'fromCompanyCode, toCompanyCode, vin, totalCost required' });
    }
    if (fromCompanyCode === toCompanyCode) {
      return reply.status(400).send({ error: 'fromCompanyCode and toCompanyCode must be different' });
    }
    if (!fromInventoryGlAccountId || !fromIcOffsetGlAccountId || !toInventoryGlAccountId || !toIcOffsetGlAccountId) {
      return reply.status(400).send({ error: 'All four GL account IDs required' });
    }
    if (fromInventoryGlAccountId === fromIcOffsetGlAccountId || toInventoryGlAccountId === toIcOffsetGlAccountId) {
      return reply.status(400).send({ error: 'Inventory and IC offset accounts must be different' });
    }

    const costDecimal = Number(totalCost);
    if (!costDecimal || costDecimal <= 0) {
      return reply.status(400).send({ error: 'totalCost must be > 0' });
    }

    const txDate = transferDate ? new Date(transferDate) : new Date();
    const userId = (request as any).user?.sub ?? initiatedBy ?? 'SYSTEM';
    const glService = (app as any).glService;

    // Create transfer record and both GL entries atomically
    const result = await withSerializableRetry(prisma, async (tx: any) => {
      // Sending side: Debit IC Offset, Credit Inventory (removes from sending rooftop)
      const fromEntry = await tx.journalEntry.create({
        data: {
          tenantId,
          entryDate: txDate,
          description: `Vehicle Transfer OUT — VIN ${vin} to company ${toCompanyCode}`,
          source: 'VT',
          sourceRef: vin,
          status: 'PENDING_REVIEW',
          createdByUserId: userId,
          lines: {
            create: [
              {
                glAccountId: fromIcOffsetGlAccountId,
                debit: costDecimal,
                credit: 0,
                memo: `IC Offset — VIN ${vin}`,
                companyCode: fromCompanyCode,
                controlNumber: vin.slice(-8),
              },
              {
                glAccountId: fromInventoryGlAccountId,
                debit: 0,
                credit: costDecimal,
                memo: `Inventory OUT — VIN ${vin}`,
                companyCode: fromCompanyCode,
                controlNumber: vin.slice(-8),
              },
            ],
          },
        },
      });

      // Receiving side: Debit Inventory, Credit IC Offset (adds to receiving rooftop)
      const toEntry = await tx.journalEntry.create({
        data: {
          tenantId,
          entryDate: txDate,
          description: `Vehicle Transfer IN — VIN ${vin} from company ${fromCompanyCode}`,
          source: 'VT',
          sourceRef: vin,
          status: 'PENDING_REVIEW',
          createdByUserId: userId,
          icCounterpartEntryId: fromEntry.id,
          lines: {
            create: [
              {
                glAccountId: toInventoryGlAccountId,
                debit: costDecimal,
                credit: 0,
                memo: `Inventory IN — VIN ${vin}`,
                companyCode: toCompanyCode,
                controlNumber: vin.slice(-8),
              },
              {
                glAccountId: toIcOffsetGlAccountId,
                debit: 0,
                credit: costDecimal,
                memo: `IC Offset — VIN ${vin}`,
                companyCode: toCompanyCode,
                controlNumber: vin.slice(-8),
              },
            ],
          },
        },
      });

      // Link fromEntry back to toEntry
      await tx.journalEntry.update({
        where: { id: fromEntry.id },
        data: { icCounterpartEntryId: toEntry.id },
      });

      const transfer = await (tx as any).vehicleTransfer.create({
        data: {
          tenantId,
          fromCompanyCode,
          toCompanyCode,
          vin,
          stockNumber: stockNumber ?? null,
          vehicleYear: vehicleYear ?? null,
          vehicleMake: vehicleMake ?? null,
          vehicleModel: vehicleModel ?? null,
          totalCost: costDecimal,
          transferDate: txDate,
          fromInventoryGlAccountId,
          toInventoryGlAccountId,
          fromIcOffsetGlAccountId,
          toIcOffsetGlAccountId,
          status: 'PENDING',
          fromJournalEntryId: fromEntry.id,
          toJournalEntryId: toEntry.id,
          initiatedBy: userId,
        },
      });

      return { transfer, fromEntryId: fromEntry.id, toEntryId: toEntry.id };
    });

    // Auto-approve both entries (VT source is trusted like DMS sources)
    try {
      await glService.approveJournalEntry(result.fromEntryId, tenantId, userId);
      await glService.approveJournalEntry(result.toEntryId, tenantId, userId);
      await (prisma as any).vehicleTransfer.update({
        where: { id: result.transfer.id },
        data: { status: 'COMPLETED' },
      });
      result.transfer.status = 'COMPLETED';
    } catch (err: any) {
      // Entry remains PENDING_REVIEW — don't fail the transfer creation
      result.transfer.pendingApproval = true;
    }

    return reply.status(201).send(result.transfer);
  });

  app.post('/vehicle-transfers/:id/reverse', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const userId = (request as any).user?.sub ?? 'SYSTEM';

    const transfer = await (prisma as any).vehicleTransfer.findFirst({ where: { id, tenantId } });
    if (!transfer) return reply.status(404).send({ error: 'Vehicle transfer not found' });
    if (transfer.status === 'REVERSED') return reply.status(409).send({ error: 'Already reversed' });
    if (transfer.status !== 'COMPLETED') return reply.status(409).send({ error: 'Only COMPLETED transfers can be reversed' });

    const glService = (app as any).glService;
    const revFromEntry = await glService.reverseJournalEntry(transfer.fromJournalEntryId, tenantId, userId);
    const revToEntry = await glService.reverseJournalEntry(transfer.toJournalEntryId, tenantId, userId);

    await (prisma as any).vehicleTransfer.update({
      where: { id },
      data: { status: 'REVERSED' },
    });

    return reply.send({ status: 'REVERSED', reversalEntries: [revFromEntry?.id, revToEntry?.id] });
  });

  // ── S7-02: OEM Financial Statement Mappings ────────────────────────────────

  app.get('/fs/oem-mappings', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { oemCode, year } = request.query as any;
    const where: any = { tenantId };
    if (oemCode) where.oemCode = oemCode;
    if (year) where.statementYear = Number(year);
    const mappings = await (prisma as any).oemStatementMapping.findMany({
      where,
      orderBy: [{ statementYear: 'desc' }, { sortOrder: 'asc' }, { lineNumber: 'asc' }],
    });
    return reply.send(mappings);
  });

  app.put('/fs/oem-mappings/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const existing = await (prisma as any).oemStatementMapping.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.status(404).send({ error: 'Mapping not found' });
    const updated = await (prisma as any).oemStatementMapping.update({
      where: { id },
      data: request.body,
    });
    return reply.send(updated);
  });

  app.post('/fs/oem-mappings/bulk', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { oemCode, statementYear, mappings } = request.body as any;
    if (!oemCode || !statementYear || !Array.isArray(mappings)) {
      return reply.status(400).send({ error: 'oemCode, statementYear, and mappings[] required' });
    }
    const results = await prisma.$transaction(
      mappings.map((m: any) =>
        (prisma as any).oemStatementMapping.upsert({
          where: {
            tenantId_oemCode_statementYear_lineNumber: {
              tenantId,
              oemCode,
              statementYear: Number(statementYear),
              lineNumber: m.lineNumber,
            },
          },
          update: { ...m, tenantId, oemCode, statementYear: Number(statementYear) },
          create: { ...m, tenantId, oemCode, statementYear: Number(statementYear) },
        }),
      ),
    );
    return reply.status(200).send({ upserted: results.length });
  });

  app.post('/fs/oem-statement/generate', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { oemCode, statementYear, statementMonth } = request.body as any;
    if (!oemCode || !statementYear || !statementMonth) {
      return reply.status(400).send({ error: 'oemCode, statementYear, statementMonth required' });
    }

    const mappings = await (prisma as any).oemStatementMapping.findMany({
      where: { tenantId, oemCode, statementYear: Number(statementYear) },
      orderBy: [{ sortOrder: 'asc' }, { lineNumber: 'asc' }],
    });

    if (!mappings.length) {
      return reply.status(404).send({ error: `No OEM mappings found for ${oemCode} / ${statementYear}` });
    }

    // Collect GL account balances for the period
    const allAccountIds = mappings
      .filter((m: any) => m.glAccountId)
      .map((m: any) => m.glAccountId);

    const periodBalances = await (prisma as any).gLAccountPeriodBalance.findMany({
      where: {
        tenantId,
        glAccountId: { in: allAccountIds },
        periodYear: Number(statementYear),
        periodMonth: Number(statementMonth),
      },
    });
    const balanceMap = new Map<string, number>(
      periodBalances.map((pb: any) => [pb.glAccountId, Number(pb.runningBalance)]),
    );

    // For range-based mappings, look up accounts in the range
    const allAccounts = await (prisma as any).gLAccount.findMany({
      where: { tenantId },
      select: { id: true, accountCode: true },
    });

    const lines = mappings.map((m: any) => {
      let amount = 0;
      if (m.glAccountId) {
        amount = balanceMap.get(m.glAccountId) ?? 0;
      } else if (m.glAccountRangeStart && m.glAccountRangeEnd) {
        for (const acct of allAccounts) {
          if (acct.accountCode >= m.glAccountRangeStart && acct.accountCode <= m.glAccountRangeEnd) {
            amount += balanceMap.get(acct.id) ?? 0;
          }
        }
      }
      if (m.signConvention === 'REVERSED') amount = -amount;
      return {
        lineNumber: m.lineNumber,
        lineDescription: m.lineDescription,
        lineType: m.lineType ?? 'DETAIL',
        amount,
        glAccountId: m.glAccountId ?? null,
      };
    });

    // Calculate subtotals and totals
    let runningSubtotal = 0;
    const resultLines = lines.map((l: any, idx: number) => {
      if (l.lineType === 'DETAIL') {
        runningSubtotal += l.amount;
        return l;
      } else if (l.lineType === 'SUBTOTAL') {
        const val = runningSubtotal;
        runningSubtotal = 0;
        return { ...l, amount: val };
      } else if (l.lineType === 'TOTAL') {
        const val = lines
          .slice(0, idx)
          .filter((x: any) => x.lineType === 'DETAIL' || x.lineType === 'SUBTOTAL')
          .reduce((s: number, x: any) => s + x.amount, 0);
        return { ...l, amount: val };
      }
      return l;
    });

    return reply.send({
      oemCode,
      statementYear: Number(statementYear),
      statementMonth: Number(statementMonth),
      generatedAt: new Date().toISOString(),
      lines: resultLines,
    });
  });

  // ── S7-05: IC Elimination Consolidated Statement ────────────────────────────

  app.get('/financial-statements/consolidated', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { statementType = 'income-statement', year, month } = request.query as any;
    if (!year || !month) return reply.status(400).send({ error: 'year and month required' });

    const periodYear = Number(year);
    const periodMonth = Number(month);

    // All period balances for this tenant
    const periodBalances = await (prisma as any).gLAccountPeriodBalance.findMany({
      where: { tenantId, periodYear, periodMonth },
      include: { glAccount: { select: { id: true, accountCode: true, accountType: true, accountName: true, isIntercompany: true } } },
    });

    let totalBalance = 0;
    let icBalance = 0;
    const icAccounts: any[] = [];
    const nonIcLines: any[] = [];

    for (const pb of periodBalances as any[]) {
      const bal = Number(pb.runningBalance);
      if (pb.glAccount?.isIntercompany) {
        icBalance += bal;
        icAccounts.push({ accountCode: pb.glAccount.accountCode, accountName: pb.glAccount.accountName, balance: bal });
      } else {
        totalBalance += bal;
        nonIcLines.push({ accountCode: pb.glAccount?.accountCode, accountName: pb.glAccount?.accountName, balance: bal, accountType: pb.glAccount?.accountType });
      }
    }

    const icOutOfBalance = Math.abs(icBalance) > 0.005; // IC accounts should net to 0

    return reply.send({
      statementType,
      period: { year: periodYear, month: periodMonth },
      consolidatedTotal: totalBalance,
      icNetBalance: icBalance,
      icOutOfBalance,
      icWarning: icOutOfBalance
        ? `IC accounts are out of balance by ${icBalance.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}. Review intercompany entries before finalizing consolidated statements.`
        : null,
      icAccounts,
      lines: nonIcLines,
    });
  });
}
