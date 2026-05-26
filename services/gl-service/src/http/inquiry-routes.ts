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

    // Helper: look up account and build account info object
    const lookupAccount = async () => {
      const acct = await prisma.gLAccount.findFirst({ where: { tenantId, code } });
      if (!acct) return null;
      return {
        acct,
        info: {
          accountCode: code,
          accountName: acct.name,
          accountType: acct.type,
          balance: Number(acct.currentBalance ?? 0),
        },
      };
    };

    // Helper: query journal_lines for account and return as journal/transaction rows
    const fetchJournalLineRows = async (
      acctId: string,
      fromDt?: Date,
      toDt?: Date,
    ) => {
      const lineWhere: any = {
        glAccountId: acctId,
        journalEntry: { tenantId },
      };
      if (fromDt || toDt) {
        lineWhere.journalEntry = {
          tenantId,
          entryDate: {
            ...(fromDt ? { gte: fromDt } : {}),
            ...(toDt ? { lte: toDt } : {}),
          },
        };
      }
      return prisma.journalLine.findMany({
        where: lineWhere,
        include: { journalEntry: true },
        orderBy: [{ journalEntry: { entryDate: 'asc' } }, { id: 'asc' }],
        take: 500,
      });
    };

    if (q.typeCode === 1) {
      // Always fetch from journal_lines for the journals display (period summaries don't have the right shape)
      const found = await lookupAccount();
      if (!found) return reply.send({ typeCode: 1, accountCode: code, periodYear: currentYear, periodMonth: currentMonth, journals: [], lines: [] });
      const periodStart = new Date(currentYear, currentMonth - 1, 1);
      const periodEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59);
      // Also include prior months so the "all time" view has context - get last 6 months
      const sixMonthsAgo = new Date(currentYear, currentMonth - 7, 1);
      const rawLines = await fetchJournalLineRows(found.acct.id, sixMonthsAgo, periodEnd);
      const periodLines = await repo.getPeriodJournals(tenantId, code, currentYear, currentMonth);
      let running = 0;
      const journals = rawLines.map((l) => {
        const debit = Number(l.debit);
        const credit = Number(l.credit);
        running += debit - credit;
        return {
          id: l.id,
          entryDate: l.journalEntry.entryDate.toISOString(),
          reference: l.journalEntry.sourceRef ?? l.journalEntry.id,
          description: l.memo ?? l.journalEntry.description,
          debitAmount: debit,
          creditAmount: credit,
          runningBalance: running,
          status: l.journalEntry.status,
        };
      });
      return reply.send({ typeCode: 1, accountCode: code, periodYear: currentYear, periodMonth: currentMonth, journals, lines: periodLines, account: found.info });
    }

    if (q.typeCode === 3) {
      const priorMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const priorYear = currentMonth === 1 ? currentYear - 1 : currentYear;
      const found = await lookupAccount();
      if (!found) return reply.send({ typeCode: 3, accountCode: code, periodYear: priorYear, periodMonth: priorMonth, journals: [], lines: [] });
      const periodStart = new Date(priorYear, priorMonth - 1, 1);
      const periodEnd = new Date(priorYear, priorMonth, 0, 23, 59, 59);
      const rawLines = await fetchJournalLineRows(found.acct.id, periodStart, periodEnd);
      let running = 0;
      const journals = rawLines.map((l) => {
        const debit = Number(l.debit);
        const credit = Number(l.credit);
        running += debit - credit;
        return {
          id: l.id,
          entryDate: l.journalEntry.entryDate.toISOString(),
          reference: l.journalEntry.sourceRef ?? l.journalEntry.id,
          description: l.memo ?? l.journalEntry.description,
          debitAmount: debit,
          creditAmount: credit,
          runningBalance: running,
          status: l.journalEntry.status,
        };
      });
      return reply.send({ typeCode: 3, accountCode: code, periodYear: priorYear, periodMonth: priorMonth, journals, lines: journals, account: found.info });
    }

    if (q.typeCode === 2) {
      const histLines = await repo.getHistoryByAccount(tenantId, code, { afterDate: lastCloseDate });
      if (histLines.length > 0) {
        return reply.send({ typeCode: 2, accountCode: code, lastCloseDate: lastCloseDate.toISOString().slice(0, 10), lines: histLines, transactions: histLines });
      }
      const found = await lookupAccount();
      if (!found) return reply.send({ typeCode: 2, accountCode: code, transactions: [], lines: [] });
      const rawLines = await fetchJournalLineRows(found.acct.id, lastCloseDate);
      let running = 0;
      const transactions = rawLines.map((l) => {
        const amount = Number(l.debit) - Number(l.credit);
        running += amount;
        return {
          id: l.id,
          transactionDate: l.journalEntry.entryDate.toISOString(),
          transactionType: Number(l.debit) > 0 ? 'DEBIT' : 'CREDIT',
          sourceCode: l.journalEntry.source,
          amount,
          runningBalance: running,
        };
      });
      return reply.send({ typeCode: 2, accountCode: code, lastCloseDate: lastCloseDate.toISOString().slice(0, 10), transactions, lines: transactions, account: found.info });
    }

    if (q.typeCode === 4) {
      const histLines = await repo.getHistoryByAccount(tenantId, code, { onOrBeforeDate: lastCloseDate });
      if (histLines.length > 0) {
        return reply.send({ typeCode: 4, accountCode: code, lastCloseDate: lastCloseDate.toISOString().slice(0, 10), lines: histLines, transactions: histLines });
      }
      const found = await lookupAccount();
      if (!found) return reply.send({ typeCode: 4, accountCode: code, transactions: [], lines: [] });
      const periodEnd = lastCloseDate;
      const rawLines = await fetchJournalLineRows(found.acct.id, undefined, periodEnd);
      let running = 0;
      const transactions = rawLines.map((l) => {
        const amount = Number(l.debit) - Number(l.credit);
        running += amount;
        return {
          id: l.id,
          transactionDate: l.journalEntry.entryDate.toISOString(),
          transactionType: Number(l.debit) > 0 ? 'DEBIT' : 'CREDIT',
          sourceCode: l.journalEntry.source,
          amount,
          runningBalance: running,
        };
      });
      return reply.send({ typeCode: 4, accountCode: code, lastCloseDate: lastCloseDate.toISOString().slice(0, 10), transactions, lines: transactions, account: found.info });
    }

    // typeCode === 5: Filtered by source + controlNumber + date range
    const lines = await repo.getHistoryByAccount(tenantId, code, {
      source: q.source,
      controlNumber: q.controlNumber,
      fromDate: q.fromDate ? new Date(q.fromDate) : undefined,
      toDate: q.toDate ? new Date(q.toDate) : undefined,
    });
    if (lines.length > 0) {
      return reply.send({ typeCode: 5, accountCode: code, source: q.source, controlNumber: q.controlNumber, fromDate: q.fromDate, toDate: q.toDate, lines, transactions: lines });
    }
    const found = await lookupAccount();
    if (!found) return reply.send({ typeCode: 5, accountCode: code, transactions: [], lines: [] });
    const rawLines = await fetchJournalLineRows(
      found.acct.id,
      q.fromDate ? new Date(q.fromDate) : undefined,
      q.toDate ? new Date(q.toDate) : undefined,
    );
    let running = 0;
    const transactions = rawLines.map((l) => {
      const amount = Number(l.debit) - Number(l.credit);
      running += amount;
      return {
        id: l.id,
        transactionDate: l.journalEntry.entryDate.toISOString(),
        transactionType: Number(l.debit) > 0 ? 'DEBIT' : 'CREDIT',
        sourceCode: l.journalEntry.source,
        amount,
        runningBalance: running,
      };
    });
    return reply.send({
      typeCode: 5,
      accountCode: code,
      source: q.source,
      controlNumber: q.controlNumber,
      fromDate: q.fromDate,
      toDate: q.toDate,
      transactions,
      lines: transactions,
      account: found.info,
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
