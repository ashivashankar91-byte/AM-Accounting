import { PrismaClient } from '.prisma/cashflow-client';
import pino from 'pino';

const logger = pino({ name: 'cashflow-service' });
const GL_SERVICE_URL = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';
const APAR_SERVICE_URL = process.env['APAR_SERVICE_URL'] ?? 'http://apar-service:3013';
const PAYROLL_SERVICE_URL = process.env['PAYROLL_SERVICE_URL'] ?? 'http://payroll-service:3012';

async function fetchJSON(url: string, tenantId: string): Promise<any> {
  const resp = await fetch(url, { headers: { 'x-tenant-id': tenantId } });
  if (!resp.ok) return null;
  return resp.json();
}

export class CashFlowService {
  constructor(private readonly prisma: PrismaClient) {}

  async generateForecast(tenantId: string): Promise<{
    today: number;
    day7: number;
    day30: number;
    day90: number;
    forecasts: any[];
  }> {
    // 1. Get current cash balance from GL
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const tb = await fetchJSON(
      `${GL_SERVICE_URL}/api/v1/gl/trial-balance?year=${year}&month=${month}`,
      tenantId,
    );

    let currentCash = 0;
    if (tb?.accounts) {
      for (const acct of tb.accounts) {
        if (acct.accountCode === '1000' || acct.accountCode === '2025' ||
            acct.accountName?.toLowerCase().includes('cash') ||
            acct.accountName?.toLowerCase().includes('checking')) {
          currentCash += (acct.debit ?? 0) - (acct.credit ?? 0);
        }
      }
    }
    if (currentCash === 0 && !tb?.accounts) {
      throw new Error('GL_SERVICE_UNAVAILABLE: Cannot compute cash flow forecast without GL trial balance data');
    }

    // 2. Get AR aging (expected inflows)
    const arEntries = await fetchJSON(`${APAR_SERVICE_URL}/api/v1/apar/ar`, tenantId);
    let arCurrent = 0, ar30 = 0, ar60 = 0, ar90 = 0, arOver90 = 0;
    const nowMs = Date.now();
    for (const ar of (arEntries ?? [])) {
      const ageDays = Math.floor((nowMs - new Date(ar.dueDate).getTime()) / 86400000);
      if (ageDays <= 0) arCurrent += ar.amount;
      else if (ageDays <= 30) ar30 += ar.amount;
      else if (ageDays <= 60) ar60 += ar.amount;
      else if (ageDays <= 90) ar90 += ar.amount;
      else arOver90 += ar.amount;
    }

    // Collection probability by bucket
    const expectedCollections7d = arCurrent * 0.3;
    const expectedCollections30d = arCurrent * 0.9 + ar30 * 0.7;
    const expectedCollections90d = arCurrent * 0.9 + ar30 * 0.7 + ar60 * 0.4 + ar90 * 0.2 + arOver90 * 0.1;

    // 3. Get AP outstanding (expected outflows)
    const apEntries = await fetchJSON(`${APAR_SERVICE_URL}/api/v1/apar/ap`, tenantId);
    let apDue7 = 0, apDue30 = 0, apDue90 = 0;
    for (const ap of (apEntries ?? [])) {
      const dueInDays = Math.floor((new Date(ap.dueDate).getTime() - nowMs) / 86400000);
      if (dueInDays <= 7) apDue7 += ap.amount;
      else if (dueInDays <= 30) apDue30 += ap.amount;
      else if (dueInDays <= 90) apDue90 += ap.amount;
    }

    // 4. Get payroll scheduled
    const batches = await fetchJSON(`${PAYROLL_SERVICE_URL}/api/v1/payroll/batches`, tenantId);
    let payroll30 = 0, payroll90 = 0;
    for (const b of (batches ?? [])) {
      if (b.status === 'PENDING' || b.status === 'VALIDATED') {
        const periodEnd = new Date(b.periodEnd);
        const daysUntil = Math.floor((periodEnd.getTime() - nowMs) / 86400000);
        if (daysUntil <= 30) payroll30 += b.totalAmount;
        if (daysUntil <= 90) payroll90 += b.totalAmount;
      }
    }
    // Estimate recurring payroll if no pending batches
    if (payroll30 === 0) {
      const postedBatches = (batches ?? []).filter((b: any) => b.status === 'POSTED');
      if (postedBatches.length > 0) {
        const avgPayroll = postedBatches.reduce((s: number, b: any) => s + b.totalAmount, 0) / postedBatches.length;
        payroll30 = avgPayroll; // One cycle within 30 days
        payroll90 = avgPayroll * 3; // ~3 cycles in 90 days
      }
    }

    // 5. Calculate forecasts
    const day7 = currentCash + expectedCollections7d - apDue7;
    const day30 = currentCash + expectedCollections30d - apDue30 - apDue7 - payroll30;
    const day90 = currentCash + expectedCollections90d - apDue90 - apDue30 - apDue7 - payroll90;

    const forecasts = [
      { days: 7, predicted: day7, confidence: 0.9 },
      { days: 30, predicted: day30, confidence: 0.75 },
      { days: 90, predicted: day90, confidence: 0.55 },
    ];

    // Store forecasts
    for (const f of forecasts) {
      const forecastDate = new Date(nowMs + f.days * 86400000);
      await this.prisma.cashFlowForecast.create({
        data: {
          tenantId,
          forecastDate,
          predictedBalance: f.predicted,
          confidence: f.confidence,
          breakdown: {
            startingCash: currentCash,
            arCollections: f.days <= 7 ? expectedCollections7d : f.days <= 30 ? expectedCollections30d : expectedCollections90d,
            apPayments: f.days <= 7 ? apDue7 : f.days <= 30 ? apDue7 + apDue30 : apDue7 + apDue30 + apDue90,
            payroll: f.days <= 30 ? payroll30 : payroll90,
          } as any,
        },
      });
    }

    // Store daily actual
    const todayStart = new Date(year, now.getMonth(), now.getDate());
    await this.prisma.dailyCashActual.upsert({
      where: { tenantId_date: { tenantId, date: todayStart } },
      update: { balance: currentCash },
      create: { tenantId, date: todayStart, balance: currentCash },
    });

    return { today: currentCash, day7, day30, day90, forecasts };
  }

  async getActuals(tenantId: string, days = 90) {
    const since = new Date(Date.now() - days * 86400000);
    return this.prisma.dailyCashActual.findMany({
      where: { tenantId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });
  }

  async getLatestForecasts(tenantId: string) {
    return this.prisma.cashFlowForecast.findMany({
      where: { tenantId },
      orderBy: { generatedAt: 'desc' },
      take: 3,
    });
  }
}
