/**
 * @module InquiryRoutes
 * @cobol-ancestry inquiryn.cbl, inqtran.cbl, tranpr.cbl, transumm.cbl
 * @cobol-programs-replaced
 *   INQUIRYN — GL/Schedule inquiry (5 type codes)
 *   INQTRAN  — Transaction history popup
 *   TRANPR   — Transaction journal preview/print
 *   TRANSUMM — Autopost transaction summary
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { asTenantId, authMiddleware, TenantId } from '@amacc/shared-kernel';
import { InquiryRepository } from '../infrastructure/inquiry-repository';
import { PrismaClient } from '.prisma/gl-client';

function getTenantId(request: any): TenantId {
  const tenantId = request.headers['x-tenant-id'] as string | undefined;
  if (!tenantId || tenantId.trim() === '') {
    const err: any = new Error('Missing required header: x-tenant-id');
    err.statusCode = 401;
    throw err;
  }
  return asTenantId(tenantId);
}

export async function inquiryRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('FATAL: AMACC_JWT_SECRET environment variable is not set.');
  }
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const repo = container.resolve(InquiryRepository);
  const prisma = container.resolve<PrismaClient>('PrismaClient');

  // ── Period Balances ────────────────────────────────────────────────────────
  // Returns all GLAccountPeriodBalance records for a given account code,
  // optionally filtered to a specific year/month.
  app.get('/accounts/:code/period-balances', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { code } = request.params as { code: string };
    const q = z.object({
      year: z.coerce.number().int().min(2000).max(2100).optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
    }).parse(request.query);

    const account = await prisma.gLAccount.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!account) return reply.status(404).send({ error: `GL account '${code}' not found` });

    const where: any = { tenantId, glAccountId: account.id };
    if (q.year !== undefined) where.periodYear = q.year;
    if (q.month !== undefined) where.periodMonth = q.month;

    const balances = await prisma.gLAccountPeriodBalance.findMany({
      where,
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { journalSource: 'asc' }],
    });

    return reply.send({ accountCode: code, accountId: account.id, balances });
  });

  // ── GL Account Inquiry ─────────────────────────────────────────────────────
  // @cobol-ancestry inquiryn.cbl — GL Account inquiry Types 1-5
  //
  // Type 1: Current period journal summaries (per source)
  // Type 2: History transactions AFTER lastCloseDate (posted, > cutoff)
  // Type 3: Prior period journal summaries (period before current)
  // Type 4: History transactions ON OR BEFORE lastCloseDate
  // Type 5: History filtered by source + controlNumber + date range

  app.get('/accounts/:code/inquiry', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { code } = request.params as { code: string };

    const QS = z.object({
      typeCode: z.coerce.number().int().min(1).max(5),
      periodYear: z.coerce.number().int().min(2000).max(2100).optional(),
      periodMonth: z.coerce.number().int().min(1).max(13).optional(),
      lastCloseDate: z.string().optional(), // YYYYMMDD
      source: z.string().max(2).optional(),
      controlNumber: z.string().optional(),
      fromDate: z.string().optional(), // YYYY-MM-DD
      toDate: z.string().optional(),   // YYYY-MM-DD
    });

    const q = QS.parse(request.query);
    const now = new Date();

    // Resolve lastCloseDate
    let lastCloseDate: Date;
    if (q.lastCloseDate) {
      const y = parseInt(q.lastCloseDate.slice(0, 4));
      const m = parseInt(q.lastCloseDate.slice(4, 6)) - 1;
      const d = parseInt(q.lastCloseDate.slice(6, 8));
      lastCloseDate = new Date(y, m, d);
    } else {
      // Default: end of last month
      lastCloseDate = new Date(now.getFullYear(), now.getMonth(), 0);
    }

    // Resolve period (for types 1, 3)
    const currentYear = q.periodYear ?? now.getFullYear();
    const currentMonth = q.periodMonth ?? (now.getMonth() + 1);

    if (q.typeCode === 1) {
      // Current period journal summaries
      const lines = await repo.getPeriodJournals(tenantId, code, currentYear, currentMonth);
      return reply.send({ typeCode: 1, accountCode: code, periodYear: currentYear, periodMonth: currentMonth, lines });
    }

    if (q.typeCode === 3) {
      // Prior period: one month back
      const priorMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const priorYear = currentMonth === 1 ? currentYear - 1 : currentYear;
      const lines = await repo.getPeriodJournals(tenantId, code, priorYear, priorMonth);
      return reply.send({ typeCode: 3, accountCode: code, periodYear: priorYear, periodMonth: priorMonth, lines });
    }

    if (q.typeCode === 2) {
      // Transactions posted AFTER last close date
      const lines = await repo.getHistoryByAccount(tenantId, code, { afterDate: lastCloseDate });
      return reply.send({ typeCode: 2, accountCode: code, lastCloseDate: lastCloseDate.toISOString().slice(0, 10), lines });
    }

    if (q.typeCode === 4) {
      // Transactions ON OR BEFORE last close date
      const lines = await repo.getHistoryByAccount(tenantId, code, { onOrBeforeDate: lastCloseDate });
      return reply.send({ typeCode: 4, accountCode: code, lastCloseDate: lastCloseDate.toISOString().slice(0, 10), lines });
    }

    // typeCode === 5: Filtered by source + controlNumber + date range
    const lines = await repo.getHistoryByAccount(tenantId, code, {
      source: q.source,
      controlNumber: q.controlNumber,
      fromDate: q.fromDate ? new Date(q.fromDate) : undefined,
      toDate: q.toDate ? new Date(q.toDate) : undefined,
    });
    return reply.send({
      typeCode: 5,
      accountCode: code,
      source: q.source,
      controlNumber: q.controlNumber,
      fromDate: q.fromDate,
      toDate: q.toDate,
      lines,
    });
  });

  // ── Transaction History (inqtran) ──────────────────────────────────────────
  // @cobol-ancestry inqtran.cbl — History lookup by source+refno
  // Searches HistoryTransaction by (journalSource, referenceNumber) with optional date range.
  // Falls back to "0"+refno if no results found (COBOL behavior preserved).

  app.get('/history', async (request, reply) => {
    const tenantId = getTenantId(request);
    const QS = z.object({
      source: z.string().min(1).max(2),
      refno: z.string().min(1).max(12),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    });
    const q = QS.parse(request.query);

    const lines = await repo.getHistoryBySourceRef(tenantId, q.source, q.refno, {
      fromDate: q.fromDate ? new Date(q.fromDate) : undefined,
      toDate: q.toDate ? new Date(q.toDate) : undefined,
    });

    return reply.send({ source: q.source, referenceNumber: q.refno, lines });
  });

  // ── Unposted Batch List (tranpr picklist) ─────────────────────────────────
  // @cobol-ancestry tranpr.cbl — Shows all DRAFT journal entries grouped by source+date

  app.get('/transaction-batches', async (request, reply) => {
    const tenantId = getTenantId(request);
    const batches = await repo.getUnpostedBatches(tenantId);
    return reply.send({ batches });
  });

  // ── Transaction Journal Detail (tranpr journal view) ─────────────────────
  // @cobol-ancestry tranpr.cbl — Detailed lines for one unposted batch

  app.get('/transaction-batches/:source/:date/journal', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { source, date } = request.params as { source: string; date: string };

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ error: 'date must be YYYY-MM-DD' });
    }

    const lines = await repo.getTransactionJournal(tenantId, source, date);
    return reply.send({ source, batchDate: date, lines });
  });

  // ── Transaction Batch Totals (tranpr summary) ─────────────────────────────
  // @cobol-ancestry tranpr.cbl — JOURNAL TOTALS section

  app.get('/transaction-batches/:source/:date/totals', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { source, date } = request.params as { source: string; date: string };

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ error: 'date must be YYYY-MM-DD' });
    }

    const totals = await repo.getBatchTotals(tenantId, source, date);
    return reply.send({ source, batchDate: date, ...totals });
  });

  // ── Autopost Summary Report (transumm) ───────────────────────────────────
  // @cobol-ancestry transumm.cbl — Summary of auto-posted (autoPostFlag='Y') transactions
  //
  // Choice 1: Prior dates (not yet summarized). Marks records after successful fetch.
  // Choice 2: Today's records (read-only, no marking).

  app.get('/reports/autopost-summary', async (request, reply) => {
    const tenantId = getTenantId(request);
    const QS = z.object({
      choice: z.coerce.number().int().min(1).max(2).default(2),
    });
    const { choice } = QS.parse(request.query);

    const groups = await repo.getAutopostSummary(tenantId, choice as 1 | 2);
    return reply.send({ choice, groups });
  });

  // ── Acknowledge autopost summary (transumm Choice 1 deletion equivalent) ──
  // @cobol-ancestry transumm.cbl — Choice 1 deletes records after printing
  // TypeScript: soft-delete via autopostSummarizedAt timestamp

  app.post('/reports/autopost-summary/acknowledge', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = z.object({
      beforeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'beforeDate must be YYYY-MM-DD'),
    }).parse(request.body);

    const beforeDate = new Date(body.beforeDate + 'T00:00:00.000Z');
    const count = await repo.markAutopostSummarized(tenantId, beforeDate);
    return reply.send({ acknowledged: count, beforeDate: body.beforeDate });
  });
}
