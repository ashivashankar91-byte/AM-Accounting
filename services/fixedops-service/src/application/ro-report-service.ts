import { injectable, inject } from 'tsyringe';
import { ageInDays } from '../domain/aging';
import { toCents, centsToDollars } from '../domain/money';

/** S061 — Open-RO / WIP report. WIP-mode tie strip compares this report's
 * Σ (accumulated open-RO labor/parts/sublet value from operational
 * distribution-in-progress data) against the WIP GL account balance. This
 * service does not itself compute a GL balance (that lives in coa-service);
 * the HTTP layer passes an optional glWipBalance query param sourced from a
 * real GL inquiry so the strip never fabricates a number — if omitted, the
 * tie strip renders informationally (no fabricated BALANCED claim). */
@injectable()
export class RoReportService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async openRoReport(tenantId: string, storeId?: string) {
    const openRos = await this.prisma.repairOrder.findMany({
      where: { tenantId, ...(storeId ? { storeId } : {}), status: { in: ['OPEN', 'REOPENED'] } },
      include: { closeSubmissions: { include: { lines: true } } },
    });
    const now = new Date();
    const rows = openRos.map((ro: any) => {
      const ageDays = ageInDays(new Date(ro.openedAt), now);
      const lastSubmission = ro.closeSubmissions[ro.closeSubmissions.length - 1];
      const accumulatedCents = lastSubmission
        ? lastSubmission.lines.reduce((acc: number, l: any) => acc + toCents(l.saleAmount), 0)
        : 0;
      const payTypeMix = lastSubmission?.payTypeMix ?? null;
      return {
        roNumber: ro.roNumber, storeId: ro.storeId, status: ro.status, ageDays,
        accumulatedValue: centsToDollars(accumulatedCents), payTypeMix, wipMode: ro.wipMode,
      };
    });
    return { rows };
  }

  async wipTieOut(tenantId: string, legalEntityId: string, storeId: string | undefined, glWipBalance: number | string | null) {
    const openRos = await this.prisma.repairOrder.findMany({
      where: { tenantId, legalEntityId, ...(storeId ? { storeId } : {}), status: { in: ['OPEN', 'REOPENED'] }, wipMode: 'WIP_MODE' },
      include: { closeSubmissions: { include: { lines: { where: { category: 'LABOR' } } } } },
    });
    const reportCents = openRos.reduce((acc: number, ro: any) => {
      const last = ro.closeSubmissions[ro.closeSubmissions.length - 1];
      const laborCents = last ? last.lines.reduce((a: number, l: any) => a + toCents(l.saleAmount), 0) : 0;
      return acc + laborCents;
    }, 0);
    const reportTotal = centsToDollars(reportCents);
    if (glWipBalance === null || glWipBalance === undefined) {
      return { reportTotal, glWipBalance: null, status: 'GL_BALANCE_UNAVAILABLE' as const };
    }
    const glCents = toCents(glWipBalance);
    return { reportTotal, glWipBalance: centsToDollars(glCents), status: reportCents === glCents ? ('BALANCED' as const) : ('VARIANCE' as const) };
  }
}
