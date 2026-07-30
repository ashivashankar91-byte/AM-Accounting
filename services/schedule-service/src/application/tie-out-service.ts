// @wave S026 — nightly (or on-demand) reconciliation of schedule-service's
// own open-item balances against gl-service's GL control-account balance.
// Discrepancies are persisted and exposed — never silently corrected.
import { randomUUID } from 'crypto';
import { injectable, inject } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/schedule-client';
import { SCHEDULE_REPO_TOKEN } from './schedule-service';
import type { IScheduleRepository } from '../infrastructure/schedule-repository';
import { SCHEDULE_OPEN_ITEM_REPO_TOKEN } from './open-item-service';
import type { IScheduleOpenItemRepository } from '../infrastructure/schedule-open-item-repository';
import type { IScheduleTieOutRepository } from '../infrastructure/schedule-tie-out-repository';
import type { IGlBalanceClient } from '../infrastructure/gl-balance-client';

export const SCHEDULE_TIE_OUT_REPO_TOKEN = 'IScheduleTieOutRepository';
export const GL_BALANCE_CLIENT_TOKEN = 'IGlBalanceClient';

// Tolerance for the number<->Decimal round-trip through gl-service's JSON
// trial-balance response (endingBalance is a plain `number`, not a Decimal
// string) — not a policy of "close enough is fine"; a variance under one
// cent is float-representation noise, anything at or above one cent is a
// real, persisted discrepancy.
const VARIANCE_TOLERANCE = new Prisma.Decimal('0.005');

@injectable()
export class TieOutService {
  constructor(
    @inject(SCHEDULE_REPO_TOKEN) private readonly scheduleRepo: IScheduleRepository,
    @inject(SCHEDULE_OPEN_ITEM_REPO_TOKEN) private readonly openItemRepo: IScheduleOpenItemRepository,
    @inject(SCHEDULE_TIE_OUT_REPO_TOKEN) private readonly tieOutRepo: IScheduleTieOutRepository,
    @inject(GL_BALANCE_CLIENT_TOKEN) private readonly glBalanceClient: IGlBalanceClient,
    @inject('PrismaClient') private readonly prisma: PrismaClient,
  ) {}

  async runTieOut(tenantId: string, asOfDate: Date, triggeredBy?: string) {
    const runId = randomUUID();
    const schedules = await this.scheduleRepo.findAll(tenantId);
    const rows = [];

    for (const schedule of schedules) {
      const sums = await this.openItemRepo.sumRemainingBalanceByGlAccount(tenantId, schedule.scheduleNumber);
      for (const s of sums) {
        if (!s.glAccountNumber) continue;
        const scheduleBalance = new Prisma.Decimal(s.totalRemaining);

        try {
          const ending = await this.glBalanceClient.getEndingBalance(
            tenantId,
            s.glAccountNumber,
            asOfDate.getUTCFullYear(),
            asOfDate.getUTCMonth() + 1,
          );
          const glBalance = new Prisma.Decimal(ending);
          const variance = scheduleBalance.sub(glBalance);
          const status = variance.abs().lte(VARIANCE_TOLERANCE) ? 'MATCHED' : 'DISCREPANCY';

          const row = await this.tieOutRepo.create(tenantId, {
            scheduleNumber: schedule.scheduleNumber,
            glAccountNumber: s.glAccountNumber,
            asOfDate,
            scheduleBalance,
            glBalance,
            variance,
            status,
            runId,
            triggeredBy,
          });
          rows.push(row);

          if (status === 'DISCREPANCY') {
            await (this.prisma as any).auditOutboxEvent.create({
              data: {
                tenantId,
                docType: 'SCHEDULE_GL_TIE_OUT',
                docId: row.id,
                action: 'DISCREPANCY_DETECTED',
                before: null,
                after: {
                  scheduleNumber: schedule.scheduleNumber,
                  glAccountNumber: s.glAccountNumber,
                  scheduleBalance: scheduleBalance.toFixed(2),
                  glBalance: glBalance.toFixed(2),
                  variance: variance.toFixed(2),
                },
                actor: triggeredBy ?? 'system:nightly-tie-out',
                correlationId: runId,
              },
            });
          }
        } catch (err: any) {
          const row = await this.tieOutRepo.create(tenantId, {
            scheduleNumber: schedule.scheduleNumber,
            glAccountNumber: s.glAccountNumber,
            asOfDate,
            scheduleBalance,
            glBalance: null,
            variance: null,
            status: 'GL_UNAVAILABLE',
            glQueryError: err?.message ?? String(err),
            runId,
            triggeredBy,
          });
          rows.push(row);
        }
      }
    }

    return { runId, rows };
  }

  async listTieOuts(tenantId: string, filters?: { scheduleNumber?: string; status?: string; asOfDate?: Date }) {
    return this.tieOutRepo.list(tenantId, filters);
  }

  async getLatestRun(tenantId: string) {
    const runId = await this.tieOutRepo.latestRunId(tenantId);
    if (!runId) return [];
    return this.tieOutRepo.listByRun(tenantId, runId);
  }
}
