import pino from 'pino';
import { IEventPublisher, createEvent } from '@amacc/shared-kernel';

const logger = pino({ name: 'close-monitor' });
const GL_SERVICE_URL = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';
const RECON_SERVICE_URL = process.env['RECON_SERVICE_URL'] ?? 'http://recon-service:3014';
const PAYROLL_SERVICE_URL = process.env['PAYROLL_SERVICE_URL'] ?? 'http://payroll-service:3012';
const APAR_SERVICE_URL = process.env['APAR_SERVICE_URL'] ?? 'http://apar-service:3013';
const APPROVAL_SERVICE_URL = process.env['APPROVAL_SERVICE_URL'] ?? 'http://approval-service:3033';

async function fetchJSON(url: string, tenantId: string): Promise<any> {
  try {
    const resp = await fetch(url, { headers: { 'x-tenant-id': tenantId } });
    if (!resp.ok) return null;
    return resp.json();
  } catch { return null; }
}

export interface CloseRisk {
  type: 'BLOCKER' | 'WARNING';
  category: string;
  description: string;
  count?: number;
  amount?: number;
}

export class CloseMonitor {
  constructor(private readonly eventPublisher: IEventPublisher) {}

  async checkReadiness(tenantId: string): Promise<{
    daysUntilMonthEnd: number;
    blockers: CloseRisk[];
    warnings: CloseRisk[];
    ready: boolean;
  }> {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysUntilMonthEnd = Math.max(0, Math.ceil((lastDay.getTime() - now.getTime()) / 86400000));

    const blockers: CloseRisk[] = [];
    const warnings: CloseRisk[] = [];

    // Check 1: DRAFT journal entries older than 24 hours
    const entries = await fetchJSON(
      `${GL_SERVICE_URL}/api/v1/gl/journal-entries?status=DRAFT&limit=500`,
      tenantId,
    );
    if (entries) {
      const staleEntries = (entries as any[]).filter((e) => {
        const age = now.getTime() - new Date(e.createdAt ?? e.entryDate).getTime();
        return age > 24 * 60 * 60 * 1000;
      });
      if (staleEntries.length > 0) {
        blockers.push({
          type: 'BLOCKER',
          category: 'STALE_DRAFTS',
          description: `${staleEntries.length} DRAFT journal entries older than 24 hours — these will block close`,
          count: staleEntries.length,
        });
      }
    }

    // Check 2: Open bank reconciliation sessions
    const recons = await fetchJSON(`${RECON_SERVICE_URL}/api/v1/recon`, tenantId);
    if (recons) {
      const openRecons = (recons as any[]).filter((r) =>
        r.status === 'OPEN' || r.status === 'IN_PROGRESS',
      );
      if (openRecons.length > 0) {
        const totalVariance = openRecons.reduce((s: number, r: any) => s + Math.abs(r.variance ?? 0), 0);
        blockers.push({
          type: 'BLOCKER',
          category: 'OPEN_RECON',
          description: `${openRecons.length} open bank reconciliation sessions with $${totalVariance.toFixed(2)} total variance`,
          count: openRecons.length,
          amount: totalVariance,
        });
      }
    }

    // Check 3: Cash clearing account balance
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const tb = await fetchJSON(
      `${GL_SERVICE_URL}/api/v1/gl/trial-balance?year=${year}&month=${month}`,
      tenantId,
    );
    if (tb?.accounts) {
      for (const acct of (tb.accounts as any[])) {
        if (acct.accountName?.toLowerCase().includes('clearing') ||
            acct.accountCode === '1050') {
          const balance = (acct.debit ?? 0) - (acct.credit ?? 0);
          if (Math.abs(balance) > 0.01) {
            warnings.push({
              type: 'WARNING',
              category: 'CLEARING_BALANCE',
              description: `Cash clearing account ${acct.accountCode} has non-zero balance: $${balance.toFixed(2)}`,
              amount: balance,
            });
          }
        }
      }
    }

    // Check 4: Unposted payroll batches
    const batches = await fetchJSON(`${PAYROLL_SERVICE_URL}/api/v1/payroll/batches`, tenantId);
    if (batches) {
      const unposted = (batches as any[]).filter((b) =>
        b.status === 'PENDING' || b.status === 'VALIDATED',
      );
      if (unposted.length > 0) {
        const totalAmount = unposted.reduce((s: number, b: any) => s + (b.totalAmount ?? 0), 0);
        blockers.push({
          type: 'BLOCKER',
          category: 'UNPOSTED_PAYROLL',
          description: `${unposted.length} payroll batches not yet posted — $${totalAmount.toFixed(2)} total`,
          count: unposted.length,
          amount: totalAmount,
        });
      }
    }

    // Check 5: Unmatched warranty AR older than 45 days
    const arEntries = await fetchJSON(`${APAR_SERVICE_URL}/api/v1/apar/ar`, tenantId);
    if (arEntries) {
      const oldWarranty = (arEntries as any[]).filter((ar) => {
        if (ar.type !== 'WARRANTY') return false;
        const age = (now.getTime() - new Date(ar.dueDate).getTime()) / 86400000;
        return age > 45 && ar.status !== 'MATCHED';
      });
      if (oldWarranty.length > 0) {
        const totalAmount = oldWarranty.reduce((s: number, ar: any) => s + (ar.amount ?? 0), 0);
        warnings.push({
          type: 'WARNING',
          category: 'UNMATCHED_WARRANTY',
          description: `${oldWarranty.length} warranty AR entries unmatched after 45 days — $${totalAmount.toFixed(2)}`,
          count: oldWarranty.length,
          amount: totalAmount,
        });
      }
    }

    const ready = blockers.length === 0;

    // Publish risks if any found
    if (blockers.length > 0 || warnings.length > 0) {
      try {
        // Create approval record for close risks
        await fetch(`${APPROVAL_SERVICE_URL}/api/v1/approvals/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
          body: JSON.stringify({
            agentName: 'close-monitor',
            actionType: 'FLAG_ANOMALY',
            entityRef: `EOM-${year}-${String(month).padStart(2, '0')}`,
            reasoning: `Close readiness check found ${blockers.length} blockers and ${warnings.length} warnings`,
            evidence: [...blockers, ...warnings].map((r) => r.description),
          }),
        }).catch(() => {});
      } catch { /* best effort */ }
    }

    return { daysUntilMonthEnd, blockers, warnings, ready };
  }

  startScheduledMonitoring(tenantId: string): NodeJS.Timeout {
    return setInterval(async () => {
      const now = new Date();
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const daysLeft = Math.ceil((lastDay.getTime() - now.getTime()) / 86400000);

      // Only run during last 5 business days
      if (daysLeft > 7) return;

      const minutesSinceHour = now.getMinutes();

      // Run at the appropriate interval
      if (daysLeft <= 2 || minutesSinceHour < 5) {
        try {
          const result = await this.checkReadiness(tenantId);
          logger.info({
            tenantId,
            daysLeft: result.daysUntilMonthEnd,
            blockers: result.blockers.length,
            warnings: result.warnings.length,
            ready: result.ready,
          }, 'Close readiness check completed');
        } catch (err) {
          logger.error({ tenantId, err: (err as Error).message }, 'Close readiness check failed');
        }
      }
    }, 15 * 60 * 1000); // Check every 15 minutes, logic inside determines whether to run
  }
}
