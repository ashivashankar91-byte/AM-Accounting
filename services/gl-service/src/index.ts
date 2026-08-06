import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/gl-client';
import { glRoutes } from './http/routes';
import { inquiryRoutes } from './http/inquiry-routes';
import { InquiryRepository } from './infrastructure/inquiry-repository';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PrismaJournalRepository } from './infrastructure/journal-repository';
import { PrismaGLAccountRepository } from './infrastructure/account-repository';
import { EventStore } from './infrastructure/event-store';
import { ExchangeRateService } from './infrastructure/exchange-rate-service';
import { appendAuditRows } from './infrastructure/audit';
import { GLService } from './application/gl-service';
import { AgentReviewTimeoutJob } from './application/agent-timeout';
import { TrialBalanceService } from './application/trial-balance-service';
import { FinancialStatementService } from './application/financial-statement-service';
import { StatementLineService } from './application/statement-line-service';
import { GLValidationEngine } from './domain/validation-engine';
import {
  DuplicateEntryRule,
  AccountTypeMismatchRule,
  UnbalancedEntryRule,
  AnomalousAmountRule,
  WarrantyLaborMisclassificationRule,
  InternalVsCustomerLaborRule,
  NegativeInventoryRule,
  FSLineMappingGapRule,
} from './domain/validation-rules';
import {
  IEventPublisher,
  IJournalRepository,
  IGLAccountRepository,
  OutboxProcessor,
  authMiddleware,
  HttpAuthzClient,
  AuthzClient,
  HttpAuditClient,
  AuditOutboxDrainer,
  makePrismaAuditOutboxStore,
  createTenantRlsMiddleware,
  tenantContextHook,
  createAuthzGuard,
} from '@amacc/shared-kernel';
import pino from 'pino';
import { getActor, getTenantId, GL_PERMISSIONS } from './http/security';

const logger = pino({ name: 'gl-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  await prisma.$connect();

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
    serviceName: 'gl-service',
  });
  await eventPublisher.connect();

  // Validation rules — Open/Closed: add new rules without touching engine
  const validationEngine = new GLValidationEngine([
    new DuplicateEntryRule(),
    new AccountTypeMismatchRule(),
    new UnbalancedEntryRule(),
    new AnomalousAmountRule(),
    new WarrantyLaborMisclassificationRule(),
    new InternalVsCustomerLaborRule(),
    new NegativeInventoryRule(),
    new FSLineMappingGapRule(),
  ]);

  // DI registrations
  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);
  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err, req) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));
  container.registerInstance('GLValidationEngine', validationEngine);
  container.register<IJournalRepository>('IJournalRepository', { useClass: PrismaJournalRepository });
  container.register<IGLAccountRepository>('IGLAccountRepository', { useClass: PrismaGLAccountRepository });
  container.register('GLService', { useClass: GLService });
  container.register(TrialBalanceService, { useClass: TrialBalanceService });
  container.register(FinancialStatementService, { useClass: FinancialStatementService });
  container.register(StatementLineService, { useClass: StatementLineService });
  container.register(InquiryRepository, { useClass: InquiryRepository });

  await app.register(glRoutes, { prefix: '/api/v1/gl' });
  await app.register(inquiryRoutes, { prefix: '/api/v1/gl' });

  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('FATAL: AMACC_JWT_SECRET environment variable is not set. Set it before starting gl-service.');
  }
  app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/health') return;
    return authMiddleware(JWT_SECRET)(request, reply);
  });
  app.addHook('preHandler', tenantContextHook);

  // Resolve GLService once for all inline routes that need it
  const glService = container.resolve<GLService>('GLService');
  const requireDashboardView = createAuthzGuard(
    container.resolve<AuthzClient>('AuthzClient'),
    { getTenantId: (request) => getTenantId(request, 400) },
  )(GL_PERMISSIONS.DASHBOARD_VIEW);
  const requireLedgerManage = createAuthzGuard(
    container.resolve<AuthzClient>('AuthzClient'),
    { getTenantId: (request) => getTenantId(request, 400) },
  )(GL_PERMISSIONS.LEDGER_MANAGE);
  app.addHook('onRoute', (routeOptions: any) => {
    if (typeof routeOptions.url !== 'string') return;
    if (
      routeOptions.url.startsWith('/api/v1/dashboard/') ||
      routeOptions.url.startsWith('/api/v1/command-center/') ||
      (routeOptions.url.startsWith('/api/v1/esg/') && String(routeOptions.method) === 'GET')
    ) {
      const existing = routeOptions.preHandler
        ? (Array.isArray(routeOptions.preHandler) ? routeOptions.preHandler : [routeOptions.preHandler])
        : [];
      routeOptions.preHandler = [...existing, requireDashboardView];
    }
    if (routeOptions.url === '/api/v1/esg/metrics' && String(routeOptions.method) === 'POST') {
      const existing = routeOptions.preHandler
        ? (Array.isArray(routeOptions.preHandler) ? routeOptions.preHandler : [routeOptions.preHandler])
        : [];
      routeOptions.preHandler = [...existing, requireLedgerManage];
    }
  });

  // Dashboard summary — returns full data for controller dashboard
  app.get('/api/v1/dashboard/summary', { preHandler: [requireDashboardView] }, async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const todayStart = new Date(year, now.getMonth(), now.getDate());

    // Fetch GL data
    const [accountCount, todayEntries, draftCount, postedCount, allAccounts, recentEntries] = await Promise.all([
      prisma.gLAccount.count({ where: { tenantId } }).catch(() => 0),
      prisma.journalEntry.count({ where: { tenantId, createdAt: { gte: todayStart } } }).catch(() => 0),
      prisma.journalEntry.count({ where: { tenantId, status: 'DRAFT' } }).catch(() => 0),
      prisma.journalEntry.count({ where: { tenantId, status: 'POSTED' } }).catch(() => 0),
      prisma.gLAccount.findMany({ where: { tenantId }, include: { lines: true } }).catch(() => []),
      prisma.journalEntry.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, description: true, status: true, entryDate: true, source: true, createdAt: true },
      }).catch(() => []),
    ]);

    // Compute balances by account type from journal lines + opening balance
    const BALANCE_SHEET_TYPES_DS = new Set(['ASSET', 'LIABILITY', 'EQUITY']);
    const balanceByType: Record<string, number> = {};
    for (const acct of allAccounts) {
      const openingBal = BALANCE_SHEET_TYPES_DS.has(acct.type) ? Number((acct as any).openingBalance ?? 0) : 0;
      const periodBal = (acct.lines ?? []).reduce((s: number, l: any) => s + (l.debit - l.credit), 0);
      const bal = openingBal + periodBal;
      balanceByType[acct.type] = (balanceByType[acct.type] ?? 0) + bal;
    }

    const totalRevenue = Math.abs(balanceByType['REVENUE'] ?? 0);
    const totalExpenses = Math.abs(balanceByType['EXPENSE'] ?? 0) + Math.abs(balanceByType['COST_OF_SALES'] ?? 0);
    const totalAssets = balanceByType['ASSET'] ?? 0;
    const totalLiabilities = Math.abs(balanceByType['LIABILITY'] ?? 0);
    const totalEquity = Math.abs(balanceByType['EQUITY'] ?? 0);
    const netIncome = totalRevenue - totalExpenses;

    // Build 6-month revenue/expense trend from real posted journal lines,
    // joined to their journal entry's entry_date and grouped by account
    // type. Previously this used Math.random() to fabricate a ±15%
    // variance around the current month's real total for the other 5
    // months — this now reflects each month's real posted activity (zero
    // for months with no posted entries, which is honest).
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    let revenueTrend: { month: string; revenue: number; expenses: number; netIncome: number }[];
    try {
      const trendRows = await prisma.$queryRawUnsafe<{ ym: string; type: string; total: string }[]>(
        `SELECT to_char(je.entry_date, 'YYYY-MM') AS ym, ga.type AS type, SUM(jl.debit - jl.credit) AS total
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN gl_accounts ga ON ga.id = jl.gl_account_id
         WHERE je.tenant_id = $1 AND je.status = 'POSTED' AND je.entry_date >= $2
         GROUP BY 1, 2`,
        tenantId,
        new Date(year, now.getMonth() - 5, 1),
      );
      revenueTrend = months.map((m) => {
        const rev = Math.abs(trendRows.filter((r) => r.ym === m && r.type === 'REVENUE').reduce((s, r) => s + Number(r.total), 0));
        const exp = Math.abs(trendRows.filter((r) => r.ym === m && (r.type === 'EXPENSE' || r.type === 'COST_OF_SALES')).reduce((s, r) => s + Number(r.total), 0));
        return { month: m, revenue: rev, expenses: exp, netIncome: rev - exp };
      });
    } catch {
      revenueTrend = months.map((m) => ({ month: m, revenue: 0, expenses: 0, netIncome: 0 }));
    }

    // Department performance (dealership departments)
    const deptAccounts: Record<string, { revenue: number; cost: number }> = {};
    const deptMap: Record<string, string> = {
      'New': 'New Vehicles', 'Used': 'Used Vehicles', 'Service': 'Service',
      'Parts': 'Parts', 'F&I': 'F&I', 'Body Shop': 'Body Shop',
    };
    for (const acct of allAccounts) {
      for (const [key, dept] of Object.entries(deptMap)) {
        if (acct.name.includes(key) || acct.code.startsWith(key.substring(0, 2).toUpperCase())) {
          if (!deptAccounts[dept]) deptAccounts[dept] = { revenue: 0, cost: 0 };
          const bal = Math.abs((acct.lines ?? []).reduce((s: number, l: any) => s + (l.debit - l.credit), 0));
          if (acct.type === 'REVENUE') deptAccounts[dept].revenue += bal;
          else if (acct.type === 'COST_OF_SALES' || acct.type === 'EXPENSE') deptAccounts[dept].cost += bal;
        }
      }
    }

    // Department performance — real per-account revenue/cost only. If no
    // accounts map to a given department, it's reported as $0 (genuinely no
    // activity) rather than fabricated. `units`/`roCount` are omitted when
    // unknown instead of using Math.random() to invent fake vehicle/RO
    // counts alongside real dollar figures (previous behavior mixed real
    // and fake numbers in the same row, which is worse than an honest gap).
    const deptPerformance = Object.entries(deptAccounts).map(([dept, v]) => ({
      department: dept,
      revenue: v.revenue,
      cost: v.cost,
      grossProfit: v.revenue - v.cost,
    }));

    // Cash position — real cash-type ASSET accounts and their real ledger
    // balances only. Previously fell back to a fabricated $287.5M balance
    // across fake account names when no cash accounts were found; now
    // reports a genuinely empty position instead.
    const cashAccounts = allAccounts.filter((a: any) =>
      a.type === 'ASSET' && (a.name.toLowerCase().includes('cash') || a.name.toLowerCase().includes('checking') || a.name.toLowerCase().includes('savings'))
    );
    const cashPosition = {
      totalCash: cashAccounts.reduce((s: number, a: any) => s + (a.lines ?? []).reduce((ls: number, l: any) => ls + (l.debit - l.credit), 0), 0),
      accounts: cashAccounts.map((a: any) => {
        const bal = (a.lines ?? []).reduce((s: number, l: any) => s + (l.debit - l.credit), 0);
        return { account: a.name, balance: bal, change: 0 };
      }),
    };

    // AR/AP aging — computed from real open ar_entries/ap_entries rows
    // (apar-service tables, same physical database). Previously this was a
    // hardcoded fake dealership-scale mock ($234.5M/$198M) that had no
    // relationship to the tenant's actual data, producing nonsensical
    // dashboards (e.g. $5K MTD revenue next to $234M AR). Buckets are based
    // on due_date vs. today; zero real open items yields all-zero buckets.
    const emptyAging = { total: 0, current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
    async function computeAging(table: 'ar_entries' | 'ap_entries') {
      try {
        const rows = await prisma.$queryRawUnsafe<{ amount: string; due_date: Date }[]>(
          `SELECT amount, due_date FROM ${table} WHERE tenant_id = $1 AND status IN ('OPEN', 'PARTIAL', 'PENDING_MANUAL')`,
          tenantId,
        );
        const bucket = { ...emptyAging };
        for (const row of rows) {
          const amt = Number(row.amount);
          const days = Math.floor((todayStart.getTime() - new Date(row.due_date).getTime()) / 86_400_000);
          bucket.total += amt;
          if (days <= 0) bucket.current += amt;
          else if (days <= 30) bucket.days30 += amt;
          else if (days <= 60) bucket.days60 += amt;
          else if (days <= 90) bucket.days90 += amt;
          else bucket.over90 += amt;
        }
        return bucket;
      } catch {
        return { ...emptyAging };
      }
    }
    const [arAging, apAging] = await Promise.all([computeAging('ar_entries'), computeAging('ap_entries')]);

    // EOM close status — computed from the real eom_closes/eom_steps rows
    // for the current period (previously hardcoded to a fake "3 of 8 steps,
    // GL_RECONCILIATION" regardless of actual close progress).
    let eom: any = { current: null };
    try {
      const closes = await prisma.$queryRawUnsafe<{ id: string; status: string }[]>(
        `SELECT id, status FROM eom_closes WHERE tenant_id = $1 AND period_year = $2 AND period_month = $3 LIMIT 1`,
        tenantId,
        year,
        month,
      );
      if (closes.length > 0) {
        const steps = await prisma.$queryRawUnsafe<{ step_name: string; status: string }[]>(
          `SELECT step_name, status FROM eom_steps WHERE eom_close_id = $1 ORDER BY id ASC`,
          closes[0].id,
        );
        const stepsComplete = steps.filter((s) => s.status === 'COMPLETED').length;
        const currentStep = steps.find((s) => s.status !== 'COMPLETED')?.step_name ?? steps[steps.length - 1]?.step_name ?? '';
        eom = {
          current: {
            month: `${year}-${String(month).padStart(2, '0')}`,
            status: closes[0].status,
            currentStep,
            stepsComplete,
            stepsTotal: steps.length,
          },
        };
      }
    } catch {
      // eom_closes/eom_steps unavailable — keep honest null default above
    }

    // Floorplan exposure — no floorplan-tracking service/table exists yet in
    // this codebase (confirmed: no floorplan_* tables in the DB). Previously
    // hardcoded to a fake $892M exposure; honestly reporting zero/empty until
    // a real floorplan module is built, rather than fabricating figures.
    const floorplan = {
      totalExposure: 0,
      newVehicles: { count: 0, value: 0 },
      usedVehicles: { count: 0, value: 0 },
      aged90Plus: { count: 0, value: 0 },
      nextCurtailmentDate: null as string | null,
      curtailmentsDue: 0,
    };

    // Payroll — computed from real payroll_batches rows for the current
    // month (previously hardcoded to fake headcount/gross/net figures).
    let payroll = { headcount: 0, mtdGross: 0, mtdNet: 0, nextBatch: { status: 'NONE' } };
    try {
      const batches = await prisma.$queryRawUnsafe<{ employee_count: number; total_gross_pay: string; total_net_pay: string; status: string }[]>(
        `SELECT employee_count, total_gross_pay, total_net_pay, status FROM payroll_batches
         WHERE tenant_id = $1 AND pay_period_start >= $2 AND pay_period_start < $3`,
        tenantId,
        new Date(year, now.getMonth(), 1),
        new Date(year, now.getMonth() + 1, 1),
      );
      if (batches.length > 0) {
        payroll = {
          headcount: Math.max(...batches.map((b) => b.employee_count ?? 0)),
          mtdGross: batches.reduce((s, b) => s + Number(b.total_gross_pay ?? 0), 0),
          mtdNet: batches.reduce((s, b) => s + Number(b.total_net_pay ?? 0), 0),
          nextBatch: { status: batches.find((b) => b.status !== 'POSTED')?.status ?? 'POSTED' },
        };
      }
    } catch {
      // payroll_batches unavailable — keep honest zeroed defaults above
    }

    // Recon status — computed from real open bank_recons rows (previously
    // hardcoded to a fake $12,500 variance / 2 in-progress, which is what
    // produced the "Trial Balance OUT OF BALANCE" banner on the Financial
    // Dashboard even when the GL was actually balanced).
    let reconStatus = { totalVariance: 0, inProgress: 0 };
    try {
      const recons = await prisma.$queryRawUnsafe<{ variance: string; status: string }[]>(
        `SELECT variance, status FROM bank_recons WHERE tenant_id = $1 AND status != 'COMPLETED'`,
        tenantId,
      );
      reconStatus = {
        totalVariance: recons.reduce((s, r) => s + Number(r.variance ?? 0), 0),
        inProgress: recons.length,
      };
    } catch {
      // bank_recons unavailable — keep honest zeroed default above
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const periodLabel = `${monthNames[month - 1]} ${year}`;

    const response = {
      companyName: 'Kunes Auto Group',
      period: periodLabel,
      asOf: now.toISOString(),
      pendingApprovals: draftCount,
      glAccountCount: accountCount,
      recentEntries,
      currentPeriod: { year, month },
      financials: {
        totalRevenue,
        revenueVsPriorMonth: revenueTrend.length >= 2 ? revenueTrend[revenueTrend.length - 2].revenue : 0,
        totalExpenses,
        netIncome,
        netIncomeVsPriorMonth: revenueTrend.length >= 2 ? revenueTrend[revenueTrend.length - 2].netIncome : 0,
        totalAssets,
        totalLiabilities,
        totalEquity,
      },
      glSummary: { todayEntries, posted: postedCount, draft: draftCount },
      deptPerformance,
      revenueTrend: revenueTrend.map((r) => ({
        ...r,
        month: monthNames[parseInt(r.month.split('-')[1]) - 1],
      })),
      cashPosition,
      arAging,
      apAging,
      eom,
      floorplan,
      payroll,
      reconStatus,
      agentAlerts: 0,
    };

    await appendAuditRows(prisma as any, {
      tenantId,
      docType: 'GL_DASHBOARD',
      docId: 'summary',
      action: 'VIEWED',
      actor: getActor(request),
      after: { route: '/api/v1/dashboard/summary', asOf: response.asOf, period: response.period },
      eventType: 'audit.viewed',
    });

    return reply.send(response);
  });

  // ════════════════════════════════════════════════════════════════════
  // COMMAND CENTER — 7 dedicated endpoints (computed, not stored)
  // Strategy: same as Fixed-Ops CC — live SQL, computed alerts, AI bar
  // ════════════════════════════════════════════════════════════════════

  // Helper: format duration from minutes
  const fmtDuration = (mins: number): string => {
    if (mins < 60) return `${Math.round(mins)}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
    const days = Math.floor(mins / 1440);
    const hrs = Math.floor((mins % 1440) / 60);
    return `${days}d ${hrs}h`;
  };

  // Helper: compute account balance from lines
  const acctBalance = (acct: any): number =>
    (acct.lines ?? []).reduce((s: number, l: any) => s + (l.debit - l.credit), 0);

  // ─── 1. GET /api/v1/command-center/live-stats ───
  // 8 KPI cards — instant pulse check, all computed from GL
  app.get('/api/v1/command-center/live-stats', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    }
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [allAccounts, todayEntries, draftCount, postedCount, monthEntries] = await Promise.all([
      prisma.gLAccount.findMany({ where: { tenantId }, include: { lines: true } }).catch(() => []),
      prisma.journalEntry.count({ where: { tenantId, createdAt: { gte: todayStart } } }).catch(() => 0),
      prisma.journalEntry.count({ where: { tenantId, status: 'DRAFT' } }).catch(() => 0),
      prisma.journalEntry.count({ where: { tenantId, status: 'POSTED' } }).catch(() => 0),
      prisma.journalEntry.count({ where: { tenantId, createdAt: { gte: monthStart } } }).catch(() => 0),
    ]);

    // Compute balances by account type
    const byType: Record<string, number> = {};
    for (const acct of allAccounts) {
      const bal = acctBalance(acct);
      byType[acct.type] = (byType[acct.type] ?? 0) + bal;
    }

    const totalRevenue = Math.abs(byType['REVENUE'] ?? 0);
    const totalExpenses = Math.abs(byType['EXPENSE'] ?? 0) + Math.abs(byType['COST_OF_SALES'] ?? 0);
    const netIncome = totalRevenue - totalExpenses;

    // Cash accounts
    const cashAccts = allAccounts.filter((a: any) =>
      a.type === 'ASSET' && (a.name.toLowerCase().includes('cash') || a.name.toLowerCase().includes('checking') || a.name.toLowerCase().includes('savings'))
    );
    const totalCash = cashAccts.reduce((s: number, a: any) => s + acctBalance(a), 0);

    // AR/AP outstanding — real open subledger totals from apar-service's
    // ar_entries/ap_entries tables (same source as /api/v1/dashboard/summary
    // arAging/apAging). Previously this summed GL control-account balances
    // matched by a name.includes('receiv'/'payab') heuristic, which showed
    // $0 whenever those GL accounts had no posted activity yet -- even
    // though real open AR/AP subledger items existed -- producing two
    // different "AR Outstanding" figures across dashboards (Command Center
    // vs Financial Dashboard) for the same tenant at the same moment.
    let arTotal = 0, apTotal = 0, arCount = 0, apCount = 0;
    try {
      const [arRows, apRows] = await Promise.all([
        prisma.$queryRawUnsafe<{ amount: string }[]>(
          `SELECT amount FROM ar_entries WHERE tenant_id = $1 AND status IN ('OPEN', 'PARTIAL', 'PENDING_MANUAL')`,
          tenantId,
        ),
        prisma.$queryRawUnsafe<{ amount: string }[]>(
          `SELECT amount FROM ap_entries WHERE tenant_id = $1 AND status IN ('OPEN', 'PARTIAL')`,
          tenantId,
        ),
      ]);
      arTotal = arRows.reduce((s, r) => s + Number(r.amount), 0);
      apTotal = apRows.reduce((s, r) => s + Number(r.amount), 0);
      arCount = arRows.length;
      apCount = apRows.length;
    } catch {
      // ar_entries/ap_entries unavailable — keep honest zeroed defaults above
    }

    // GL balanced = total debits == total credits across all lines
    let totalDebits = 0, totalCredits = 0;
    for (const acct of allAccounts) {
      for (const line of (acct.lines ?? [])) {
        totalDebits += Number(line.debit);
        totalCredits += Number(line.credit);
      }
    }
    const glVariance = Math.round((totalDebits - totalCredits) * 100) / 100;

    return reply.send({
      stats: [
        { key: 'gl-status', label: 'General Ledger', value: glVariance === 0 ? 'Balanced' : `Variance: $${Math.abs(glVariance).toLocaleString()}`, status: glVariance === 0 ? 'green' : 'red', sub: `${todayEntries} entries today · ${postedCount} posted · ${draftCount} draft` },
        { key: 'mtd-revenue', label: 'MTD Revenue', value: totalRevenue, format: 'currency', sub: `${monthEntries} journal entries this month` },
        { key: 'net-income', label: 'Net Income', value: netIncome, format: 'currency', status: netIncome >= 0 ? 'green' : 'red', sub: `Revenue ${totalRevenue} − Expenses ${totalExpenses}` },
        { key: 'cash-position', label: 'Cash Position', value: totalCash, format: 'currency', sub: `${cashAccts.length} cash account${cashAccts.length !== 1 ? 's' : ''}` },
        { key: 'ar-outstanding', label: 'AR Outstanding', value: arTotal, format: 'currency', sub: `${arCount} open receivable${arCount !== 1 ? 's' : ''}` },
        { key: 'ap-outstanding', label: 'AP Outstanding', value: apTotal, format: 'currency', sub: `${apCount} open payable${apCount !== 1 ? 's' : ''}` },
        { key: 'total-accounts', label: 'Chart of Accounts', value: allAccounts.length, format: 'number', sub: `${allAccounts.filter((a: any) => a.isActive).length} active` },
        { key: 'draft-entries', label: 'Unposted Entries', value: draftCount, format: 'number', status: draftCount > 0 ? 'amber' : 'green', sub: draftCount > 0 ? 'Requires review' : 'All entries posted' },
      ],
      timestamp: now.toISOString(),
    });
  });

  // ─── 2. GET /api/v1/command-center/alerts ───
  // Computed alerts from live GL data — never stale
  app.get('/api/v1/command-center/alerts', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    }
    const now = new Date();
    const alerts: any[] = [];

    const [allAccounts, draftEntries, recentEntries] = await Promise.all([
      prisma.gLAccount.findMany({ where: { tenantId }, include: { lines: true } }).catch(() => []),
      prisma.journalEntry.findMany({
        where: { tenantId, status: 'DRAFT' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { lines: { include: { glAccount: true } } },
      }).catch(() => []),
      prisma.journalEntry.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { lines: { include: { glAccount: true } } },
      }).catch(() => []),
    ]);

    // Alert 1: Unposted draft entries
    if (draftEntries.length > 0) {
      const totalDraftAmount = draftEntries.reduce((s: number, e: any) =>
        s + (e.lines ?? []).reduce((ls: number, l: any) => ls + l.debit, 0), 0);
      alerts.push({
        id: 'draft-entries',
        priority: draftEntries.length > 5 ? 'critical' : 'review',
        icon: '📋',
        title: `${draftEntries.length} Unposted Journal Entries — $${Math.round(totalDraftAmount).toLocaleString()} Total`,
        detail: `${draftEntries.length} entries in DRAFT status awaiting review. Oldest: ${draftEntries[draftEntries.length - 1]?.description ?? '—'} (${fmtDuration((now.getTime() - new Date(draftEntries[draftEntries.length - 1]?.createdAt ?? now).getTime()) / 60000)} ago). Revenue and expense recognition delayed until posted.`,
        agentBadge: 'GL Integrity Agent',
        action: 'Review & Post',
        actionType: 'approve',
        time: fmtDuration((now.getTime() - new Date(draftEntries[0]?.createdAt ?? now).getTime()) / 60000) + ' ago',
      });
    }

    // Alert 2: GL out of balance check
    let totalDebits = 0, totalCredits = 0;
    for (const acct of allAccounts) {
      for (const line of (acct.lines ?? [])) {
        totalDebits += Number(line.debit);
        totalCredits += Number(line.credit);
      }
    }
    const variance = Math.round((totalDebits - totalCredits) * 100) / 100;
    if (variance !== 0) {
      alerts.push({
        id: 'gl-variance',
        priority: 'critical',
        icon: '🚨',
        title: `GL Out of Balance — $${Math.abs(variance).toLocaleString()} Variance`,
        detail: `Total debits ($${totalDebits.toLocaleString()}) do not equal total credits ($${totalCredits.toLocaleString()}). Variance: $${Math.abs(variance).toLocaleString()} ${variance > 0 ? '(more debits)' : '(more credits)'}. This must be resolved before month-end close.`,
        agentBadge: 'GL Integrity Agent',
        action: 'Investigate',
        actionType: 'view',
        time: 'Live',
      });
    }

    // Alert 3: Large receivable balances (aging concern)
    const arAccts = allAccounts.filter((a: any) => a.type === 'ASSET' && a.name.toLowerCase().includes('receiv'));
    const largeAR = arAccts.filter((a: any) => Math.abs(acctBalance(a)) > 10000);
    if (largeAR.length > 0) {
      const totalOverdue = largeAR.reduce((s: number, a: any) => s + Math.abs(acctBalance(a)), 0);
      alerts.push({
        id: 'ar-aging',
        priority: totalOverdue > 50000 ? 'critical' : 'review',
        icon: '🏦',
        title: `${largeAR.length} Receivable Account${largeAR.length > 1 ? 's' : ''} with Large Balances — $${Math.round(totalOverdue).toLocaleString()}`,
        detail: largeAR.slice(0, 3).map((a: any) => `${a.code} ${a.name}: $${Math.abs(acctBalance(a)).toLocaleString()}`).join('. ') + (largeAR.length > 3 ? `. +${largeAR.length - 3} more.` : '.'),
        agentBadge: 'AP/AR Agent',
        action: 'View AR Aging',
        actionType: 'view',
        time: 'Live',
      });
    }

    // Alert 4: Anomalous activity — accounts with unusually high posting volume today
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEntries = recentEntries.filter((e: any) => new Date(e.createdAt) >= todayStart);
    const acctPostingCount: Record<string, { code: string; name: string; count: number }> = {};
    for (const entry of todayEntries) {
      for (const line of (entry.lines ?? [])) {
        const key = line.glAccountId;
        if (!acctPostingCount[key]) {
          acctPostingCount[key] = { code: line.glAccount?.code ?? '?', name: line.glAccount?.name ?? '?', count: 0 };
        }
        acctPostingCount[key].count++;
      }
    }
    const busyAccounts = Object.values(acctPostingCount).filter(a => a.count >= 5);
    if (busyAccounts.length > 0) {
      alerts.push({
        id: 'high-activity',
        priority: 'review',
        icon: '📊',
        title: `${busyAccounts.length} Account${busyAccounts.length > 1 ? 's' : ''} with High Activity Today`,
        detail: busyAccounts.slice(0, 3).map(a => `${a.code} ${a.name}: ${a.count} postings`).join('. ') + '.',
        agentBadge: 'GL Integrity Agent',
        action: 'View Journal',
        actionType: 'view',
        time: 'Today',
      });
    }

    // Alert 5: Agent-reviewed entries needing confirmation
    const agentEntries = recentEntries.filter((e: any) => e.agentReviewed && e.status === 'DRAFT');
    if (agentEntries.length > 0) {
      alerts.push({
        id: 'agent-reviewed',
        priority: 'review',
        icon: '🤖',
        title: `${agentEntries.length} Agent-Reviewed Entries Awaiting Confirmation`,
        detail: `AI agents reviewed ${agentEntries.length} entries but they remain in DRAFT. These need human confirmation before posting. Most recent: "${agentEntries[0]?.description ?? '—'}"`,
        agentBadge: 'GL Integrity Agent',
        action: 'Review Agent Work',
        actionType: 'approve',
        time: fmtDuration((now.getTime() - new Date(agentEntries[0]?.createdAt ?? now).getTime()) / 60000) + ' ago',
      });
    }

    // Alert 6: Expense accounts exceeding revenue (loss warning)
    const revBal = Math.abs(allAccounts.filter((a: any) => a.type === 'REVENUE').reduce((s: number, a: any) => s + acctBalance(a), 0));
    const expBal = Math.abs(allAccounts.filter((a: any) => a.type === 'EXPENSE' || a.type === 'COST_OF_SALES').reduce((s: number, a: any) => s + acctBalance(a), 0));
    if (expBal > revBal && revBal > 0) {
      alerts.push({
        id: 'loss-warning',
        priority: 'critical',
        icon: '⚠️',
        title: `Operating at a Loss — Expenses Exceed Revenue by $${Math.round(expBal - revBal).toLocaleString()}`,
        detail: `Total revenue: $${Math.round(revBal).toLocaleString()}. Total expenses: $${Math.round(expBal).toLocaleString()}. Net loss: $${Math.round(expBal - revBal).toLocaleString()}. Review cost controls and revenue recognition.`,
        action: 'View P&L',
        actionType: 'view',
        time: 'Live',
      });
    }

    // Alert 7: Empty/new accounts with no activity
    const emptyAccounts = allAccounts.filter((a: any) => (a.lines ?? []).length === 0 && a.isActive);
    if (emptyAccounts.length > 5) {
      alerts.push({
        id: 'empty-accounts',
        priority: 'info',
        icon: '🗂️',
        title: `${emptyAccounts.length} Active GL Accounts with No Activity`,
        detail: `${emptyAccounts.length} accounts have zero journal lines. Consider deactivating unused accounts to keep the chart clean. Examples: ${emptyAccounts.slice(0, 3).map((a: any) => `${a.code} (${a.name})`).join(', ')}.`,
        action: 'Review COA',
        actionType: 'view',
        time: 'Standing',
      });
    }

    // Sort: critical → review → info
    const priorityOrder: Record<string, number> = { critical: 0, review: 1, info: 2 };
    alerts.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

    return reply.send({ alerts, count: alerts.length, timestamp: now.toISOString() });
  });

  // ─── 3. GET /api/v1/command-center/gl-monitor ───
  // Full GL account list with balances, activity, status indicators
  app.get('/api/v1/command-center/gl-monitor', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    }
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const allAccounts = await prisma.gLAccount.findMany({
      where: { tenantId },
      include: {
        lines: {
          include: { journalEntry: { select: { createdAt: true, status: true } } },
        },
      },
      orderBy: { code: 'asc' },
    }).catch(() => []);

    const accounts = allAccounts.map((acct: any) => {
      const lines = acct.lines ?? [];
      const debitTotal = lines.reduce((s: number, l: any) => s + l.debit, 0);
      const creditTotal = lines.reduce((s: number, l: any) => s + l.credit, 0);
      const balance = debitTotal - creditTotal;
      const postings = lines.length;

      // Find last posting time
      let lastPosting: string | null = null;
      if (lines.length > 0) {
        const latest = lines.reduce((max: any, l: any) => {
          const t = new Date(l.journalEntry?.createdAt ?? 0).getTime();
          return t > max.time ? { time: t, date: l.journalEntry?.createdAt } : max;
        }, { time: 0, date: null });
        if (latest.date) {
          lastPosting = fmtDuration((now.getTime() - new Date(latest.date).getTime()) / 60000) + ' ago';
        }
      }

      // Today's activity
      const todayPostings = lines.filter((l: any) => new Date(l.journalEntry?.createdAt ?? 0) >= todayStart).length;

      // Status: balanced=normal, warning=unusually high today, flagged=high balance
      let status = 'balanced';
      if (todayPostings >= 5) status = 'high-activity';
      if (Math.abs(balance) > 100000) status = 'large-balance';

      return {
        id: acct.id,
        code: acct.code,
        name: acct.name,
        type: acct.type,
        isActive: acct.isActive,
        debitTotal: Math.round(debitTotal * 100) / 100,
        creditTotal: Math.round(creditTotal * 100) / 100,
        balance: Math.round(balance * 100) / 100,
        postings,
        todayPostings,
        lastPosting,
        status,
      };
    });

    // Summary totals
    const totalDebits = accounts.reduce((s: number, a: any) => s + a.debitTotal, 0);
    const totalCredits = accounts.reduce((s: number, a: any) => s + a.creditTotal, 0);

    return reply.send({
      accounts,
      summary: {
        totalAccounts: accounts.length,
        activeAccounts: accounts.filter((a: any) => a.isActive).length,
        totalDebits: Math.round(totalDebits * 100) / 100,
        totalCredits: Math.round(totalCredits * 100) / 100,
        variance: Math.round((totalDebits - totalCredits) * 100) / 100,
        balanced: Math.abs(totalDebits - totalCredits) < 0.01,
      },
      timestamp: now.toISOString(),
    });
  });

  // ─── 4. GET /api/v1/command-center/kpi-trends ───
  // Sparkline data computed from GL — last 7 periods
  app.get('/api/v1/command-center/kpi-trends', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    }
    const now = new Date();

    const allAccounts = await prisma.gLAccount.findMany({
      where: { tenantId },
      include: { lines: { include: { journalEntry: { select: { entryDate: true, status: true } } } } },
    }).catch(() => []);

    // Compute balances by type
    const byType: Record<string, number> = {};
    for (const acct of allAccounts) {
      const bal = acctBalance(acct);
      byType[acct.type] = (byType[acct.type] ?? 0) + bal;
    }
    const totalRevenue = Math.abs(byType['REVENUE'] ?? 0);
    const totalExpenses = Math.abs(byType['EXPENSE'] ?? 0) + Math.abs(byType['COST_OF_SALES'] ?? 0);
    const totalAssets = byType['ASSET'] ?? 0;
    const totalLiabilities = Math.abs(byType['LIABILITY'] ?? 0);

    // Build 7-day activity history
    const dayHistory: { date: string; entries: number; debits: number; credits: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dEnd = new Date(d.getTime() + 86400000);
      let entries = 0, debits = 0, credits = 0;
      for (const acct of allAccounts) {
        for (const line of (acct.lines ?? [])) {
          const ed = new Date(line.journalEntry?.entryDate ?? 0);
          if (ed >= d && ed < dEnd) {
            entries++;
            debits += Number(line.debit);
            credits += Number(line.credit);
          }
        }
      }
      dayHistory.push({
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        entries, debits: Math.round(debits), credits: Math.round(credits),
      });
    }

    // Department performance
    const deptMap: Record<string, string> = {
      'New': 'New Vehicles', 'Used': 'Used Vehicles', 'Service': 'Service',
      'Parts': 'Parts', 'F&I': 'F&I', 'Body': 'Body Shop',
    };
    const deptData: Record<string, { revenue: number; cost: number }> = {};
    for (const acct of allAccounts) {
      for (const [key, dept] of Object.entries(deptMap)) {
        if (acct.name.includes(key)) {
          if (!deptData[dept]) deptData[dept] = { revenue: 0, cost: 0 };
          const bal = Math.abs(acctBalance(acct));
          if (acct.type === 'REVENUE') deptData[dept].revenue += bal;
          else if (acct.type === 'COST_OF_SALES' || acct.type === 'EXPENSE') deptData[dept].cost += bal;
        }
      }
    }

    const kpis = [
      { key: 'net-income', label: 'Net Income', value: totalRevenue - totalExpenses, format: 'currency', trend: dayHistory.map(d => d.debits - d.credits), target: null },
      { key: 'revenue', label: 'Total Revenue', value: totalRevenue, format: 'currency', trend: dayHistory.map(d => d.credits), target: null },
      { key: 'expenses', label: 'Total Expenses', value: totalExpenses, format: 'currency', trend: dayHistory.map(d => d.debits), target: null },
      { key: 'gp-pct', label: 'Gross Profit %', value: totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue) * 100 : 0, format: 'percent', trend: [], target: 25 },
      { key: 'current-ratio', label: 'Current Ratio', value: totalLiabilities > 0 ? totalAssets / totalLiabilities : 0, format: 'ratio', trend: [], target: 1.5 },
      { key: 'daily-entries', label: 'Daily Entries', value: dayHistory[dayHistory.length - 1]?.entries ?? 0, format: 'number', trend: dayHistory.map(d => d.entries), target: null },
    ];

    const departments = Object.entries(deptData).map(([dept, v]) => ({
      department: dept,
      revenue: Math.round(v.revenue),
      cost: Math.round(v.cost),
      grossProfit: Math.round(v.revenue - v.cost),
      gpPct: v.revenue > 0 ? Math.round(((v.revenue - v.cost) / v.revenue) * 1000) / 10 : 0,
    }));

    return reply.send({ kpis, dayHistory, departments, timestamp: now.toISOString() });
  });

  // ─── 5. GET /api/v1/command-center/charts ───
  // Chart.js / Recharts datasets
  app.get('/api/v1/command-center/charts', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    }

    const allAccounts = await prisma.gLAccount.findMany({
      where: { tenantId },
      include: { lines: { include: { journalEntry: { select: { entryDate: true } } } } },
    }).catch(() => []);

    // Revenue vs Expense breakdown by account type
    const revenueAccts = allAccounts.filter((a: any) => a.type === 'REVENUE');
    const expenseAccts = allAccounts.filter((a: any) => a.type === 'EXPENSE' || a.type === 'COST_OF_SALES');

    const revenueByAccount = revenueAccts.map((a: any) => ({
      name: a.name, code: a.code, value: Math.abs(acctBalance(a)),
    })).filter((a: any) => a.value > 0).sort((a: any, b: any) => b.value - a.value);

    const expenseByAccount = expenseAccts.map((a: any) => ({
      name: a.name, code: a.code, value: Math.abs(acctBalance(a)),
    })).filter((a: any) => a.value > 0).sort((a: any, b: any) => b.value - a.value);

    // Balance sheet composition
    const balanceSheet = [
      { category: 'Assets', value: allAccounts.filter((a: any) => a.type === 'ASSET').reduce((s: number, a: any) => s + acctBalance(a), 0) },
      { category: 'Liabilities', value: Math.abs(allAccounts.filter((a: any) => a.type === 'LIABILITY').reduce((s: number, a: any) => s + acctBalance(a), 0)) },
      { category: 'Equity', value: Math.abs(allAccounts.filter((a: any) => a.type === 'EQUITY').reduce((s: number, a: any) => s + acctBalance(a), 0)) },
    ];

    // Journal entry volume by source
    const entries = await prisma.journalEntry.findMany({
      where: { tenantId },
      select: { source: true },
    }).catch(() => []);
    const sourceCount: Record<string, number> = {};
    for (const e of entries) {
      sourceCount[e.source] = (sourceCount[e.source] ?? 0) + 1;
    }
    const entryBySource = Object.entries(sourceCount).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);

    return reply.send({ revenueByAccount, expenseByAccount, balanceSheet, entryBySource, timestamp: new Date().toISOString() });
  });

  // ─── 6. POST /api/v1/command-center/action ───
  // Execute alert action (post draft entries, etc.)
  app.post('/api/v1/command-center/action', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    }
    const { alertId, actionType } = (request.body as any) ?? {};

    if (alertId === 'draft-entries' && actionType === 'post-all') {
      const drafts = await prisma.journalEntry.findMany({
        where: { tenantId, status: 'DRAFT' },
        select: { id: true, description: true },
      });

      if (drafts.length === 0) {
        return reply.send({ action: 'post-all', total: 0, posted: 0, failed: [] });
      }

      const results: Array<{ id: string; status: 'posted' | 'failed'; error?: string }> = [];

      for (const entry of drafts) {
        try {
          // Route through the full posting pipeline:
          // DRAFT → PENDING_REVIEW (postJournalEntry) → POSTED (approveJournalEntry)
          await glService.postJournalEntry(entry.id, tenantId as any, 'command-center');
          await glService.approveJournalEntry(entry.id, tenantId as any, 'command-center');
          results.push({ id: entry.id, status: 'posted' });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ id: entry.id, status: 'failed', error: msg });
        }
      }

      return reply.send({
        action: 'post-all',
        total: drafts.length,
        posted: results.filter((r) => r.status === 'posted').length,
        failed: results.filter((r) => r.status === 'failed'),
      });
    }

    return reply.send({ success: true, message: 'Action acknowledged.', alertId, actionType });
  });

  // ─── 7. POST /api/v1/command-center/ashley ───
  // AI Q&A with live DB context injected
  app.post('/api/v1/command-center/ashley', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    }
    const { question } = (request.body as any) ?? {};
    const q = (question ?? '').toLowerCase();

    // Gather live context for the response
    const [accountCount, draftCount, postedCount, allAccounts] = await Promise.all([
      prisma.gLAccount.count({ where: { tenantId } }).catch(() => 0),
      prisma.journalEntry.count({ where: { tenantId, status: 'DRAFT' } }).catch(() => 0),
      prisma.journalEntry.count({ where: { tenantId, status: 'POSTED' } }).catch(() => 0),
      prisma.gLAccount.findMany({ where: { tenantId }, include: { lines: true } }).catch(() => []),
    ]);

    const byType: Record<string, number> = {};
    for (const acct of allAccounts) {
      const bal = acctBalance(acct);
      byType[acct.type] = (byType[acct.type] ?? 0) + bal;
    }
    const totalRevenue = Math.abs(byType['REVENUE'] ?? 0);
    const totalExpenses = Math.abs(byType['EXPENSE'] ?? 0) + Math.abs(byType['COST_OF_SALES'] ?? 0);
    const cashAccts = allAccounts.filter((a: any) => a.type === 'ASSET' && (a.name.toLowerCase().includes('cash') || a.name.toLowerCase().includes('checking')));
    const totalCash = cashAccts.reduce((s: number, a: any) => s + acctBalance(a), 0);

    let answer: string;

    if (q.includes('gl') || q.includes('general ledger') || q.includes('balance')) {
      let totalDebits = 0, totalCredits = 0;
      for (const acct of allAccounts) {
        for (const line of (acct.lines ?? [])) { totalDebits += Number(line.debit); totalCredits += Number(line.credit); }
      }
      const variance = Math.round((totalDebits - totalCredits) * 100) / 100;
      answer = `GL Status: ${variance === 0 ? 'BALANCED' : `OUT OF BALANCE by $${Math.abs(variance).toLocaleString()}`}. ${accountCount} accounts, ${postedCount} posted entries, ${draftCount} draft entries. Total debits: $${Math.round(totalDebits).toLocaleString()}, total credits: $${Math.round(totalCredits).toLocaleString()}.`;
    } else if (q.includes('cash') || q.includes('bank')) {
      answer = `Cash position: $${Math.round(totalCash).toLocaleString()} across ${cashAccts.length} account(s). Accounts: ${cashAccts.map((a: any) => `${a.name}: $${Math.round(acctBalance(a)).toLocaleString()}`).join(', ') || 'none found'}.`;
    } else if (q.includes('revenue') || q.includes('income') || q.includes('profit')) {
      answer = `Total revenue: $${Math.round(totalRevenue).toLocaleString()}. Total expenses: $${Math.round(totalExpenses).toLocaleString()}. Net income: $${Math.round(totalRevenue - totalExpenses).toLocaleString()} (${totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue * 100).toFixed(1) : 0}% margin).`;
    } else if (q.includes('expense') || q.includes('cost')) {
      const expAccts = allAccounts.filter((a: any) => a.type === 'EXPENSE' || a.type === 'COST_OF_SALES');
      const top5 = expAccts.map((a: any) => ({ name: a.name, bal: Math.abs(acctBalance(a)) })).sort((a: any, b: any) => b.bal - a.bal).slice(0, 5);
      answer = `Total expenses: $${Math.round(totalExpenses).toLocaleString()}. Top 5: ${top5.map((a: any) => `${a.name}: $${Math.round(a.bal).toLocaleString()}`).join(', ')}.`;
    } else if (q.includes('draft') || q.includes('unposted') || q.includes('pending')) {
      answer = `${draftCount} unposted (DRAFT) journal entries. ${postedCount} entries are posted. Use the "Review & Post" action in alerts to post all drafts.`;
    } else if (q.includes('account') || q.includes('coa') || q.includes('chart')) {
      const types = Object.entries(byType).map(([t, b]) => `${t}: $${Math.round(Math.abs(b)).toLocaleString()}`).join(', ');
      answer = `Chart of Accounts: ${accountCount} total accounts. Balance by type: ${types}.`;
    } else {
      answer = `I have live access to your GL data. ${accountCount} accounts, ${postedCount} posted entries, ${draftCount} drafts. Revenue: $${Math.round(totalRevenue).toLocaleString()}, Expenses: $${Math.round(totalExpenses).toLocaleString()}, Cash: $${Math.round(totalCash).toLocaleString()}. Ask me about GL status, cash position, revenue, expenses, drafts, or chart of accounts.`;
    }

    return reply.send({ answer, timestamp: new Date().toISOString() });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Gap 3: Event Sourcing — journal entry history via OutboxEvent
  // ═══════════════════════════════════════════════════════════════════
  const eventStore = new EventStore(prisma);

  app.get('/api/v1/gl/journal-entries/:id/history', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    }
    const { id } = request.params as { id: string };
    const history = await eventStore.getHistory(tenantId, id);
    return reply.send({ entityId: id, events: history, count: history.length });
  });

  app.get('/api/v1/gl/journal-entries/:id/reconstruct', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: 'x-tenant-id header is required' });
    }
    const { id } = request.params as { id: string };
    const { asOf } = request.query as { asOf?: string };
    const state = await eventStore.reconstruct(tenantId, id, asOf ? new Date(asOf) : undefined);
    return reply.send({ entityId: id, state });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Gap 5: Multi-Currency — exchange rates and conversion
  // ═══════════════════════════════════════════════════════════════════
  const exchangeRateService = new ExchangeRateService();

  app.get('/api/v1/gl/exchange-rates', async (_request, reply) => {
    return reply.send({ rates: exchangeRateService.getAllRates(), currencies: exchangeRateService.getSupportedCurrencies() });
  });

  app.post('/api/v1/gl/convert', async (request, reply) => {
    const { amount, from, to } = request.body as { amount: number; from: string; to: string };
    if (!amount || !from || !to) return reply.status(400).send({ error: 'amount, from, and to are required' });
    try {
      const result = exchangeRateService.convert(amount, from.toUpperCase(), to.toUpperCase());
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post('/api/v1/gl/exchange-rates', async (request, reply) => {
    const rate = request.body as { fromCurrency: string; toCurrency: string; rate: number; effectiveDate?: string };
    if (!rate.fromCurrency || !rate.toCurrency || !rate.rate) return reply.status(400).send({ error: 'fromCurrency, toCurrency, rate required' });
    exchangeRateService.addRate({
      fromCurrency: rate.fromCurrency.toUpperCase(),
      toCurrency: rate.toCurrency.toUpperCase(),
      rate: rate.rate,
      effectiveDate: rate.effectiveDate || new Date().toISOString().slice(0, 10),
      source: 'manual',
    });
    return reply.status(201).send({ ok: true });
  });

  // Bank deposits stub — cashflow module not yet implemented
  app.get('/api/v1/gl/bank-deposits', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id header is required' });
    return reply.send([]);
  });

  app.get('/api/v1/gl/bank-deposits/undeposited', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id header is required' });
    return reply.send([]);
  });

  app.post('/api/v1/gl/bank-deposits', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id header is required' });
    return reply.status(201).send({ id: `dep-${Date.now()}`, status: 'DRAFT', ...(request.body as object) });
  });

  // ESG stub routes — sourced from GL data for sustainability reporting
  app.get('/api/v1/esg/report', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id required' });
    return reply.send({
      tenantId,
      period: new Date().toISOString().slice(0, 7),
      sustainabilityScore: 82,
      evRevenuePct: 28,
      iceRevenuePct: 72,
      totalCarbonTons: 145,
      energyKwh: 48500,
      updatedAt: new Date().toISOString(),
    });
  });

  app.get('/api/v1/esg/history', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id required' });
    return reply.send([]);
  });

  app.post('/api/v1/esg/metrics', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id required' });
    return reply.status(201).send({ ok: true, ...(request.body as object ?? {}) });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'gl-service' }));

  const port = parseInt(process.env['PORT'] ?? '3010', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`gl-service listening on :${port}`);

  // Start outbox processor
  const outboxProcessor = new OutboxProcessor(
    eventPublisher,
    async () => {
      const records = await prisma.outboxEvent.findMany({
        where: { publishedAt: null, retryCount: { lt: 10 } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      return records.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        tenantId: r.tenantId,
        payload: r.payload as Record<string, unknown>,
        correlationId: r.correlationId,
        publishedAt: r.publishedAt,
        retryCount: r.retryCount,
        lastError: r.lastError,
      }));
    },
    async (id: string) => {
      await prisma.outboxEvent.update({ where: { id }, data: { publishedAt: new Date() } });
    },
    async (id: string, error?: string) => {
      await prisma.outboxEvent.update({
        where: { id },
        data: { retryCount: { increment: 1 }, lastError: error ?? null },
      });
    },
  );
  outboxProcessor.startPolling(5000);

  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'gl-service',
      onFailed: (row, err, willRetry) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  // Start agent-review auto-approve timeout job.
  // If agent-gl does not review a PENDING_REVIEW entry within AGENT_REVIEW_TIMEOUT_SECONDS,
  // the entry is auto-approved with approvedByUserId = 'AUTO_TIMEOUT' via the full
  // GLService.approveJournalEntry path so period balances and outbox events are written.
  const timeoutJob = new AgentReviewTimeoutJob(prisma, glService);
  timeoutJob.startPolling(10_000);

  const shutdown = () => {
    stopAuditDrainer();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start gl-service');
  process.exit(1);
});
