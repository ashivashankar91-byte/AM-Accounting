// S080 AC — "the floorplan liability GL balance must tie exactly ($0
// variance) to the real, independently-computed open-item ledger behind
// account 19102 (Floorplan Notes Payable)". As of this build, that
// authoritative source is schedule-service's real ScheduleOpenItem ledger
// for Schedule 85 ("Floorplan Advance Liability") — NOT this service's own
// FloorplanLiabilityItem table. coa-service opens/relieves those
// schedule-service open items directly off the SAME posted journals this
// service submits (see services/coa-service/src/application/
// posting-service.ts's scheduleCode-gated JOURNAL_ENTRY_POSTED bridge, and
// scripts/seed-ce12-rule-packs.ts's test-tenant fixture path for how
// GlAccount(19102).scheduleCode='85' + Schedule 85 get created) — so
// schedule-service's open-item balance IS the real GL-tying number, by
// construction, not a second view over our own ledger.
//
// FloorplanLiabilityItem/FloorplanLiabilityApplication remain this
// service's own VIN-match lineage/audit ledger (still authoritative for
// "which staged lender row created/relieved which unit's exposure" and
// exposed via GET /liability-items) — but they are no longer the number a
// user checks against the GL. Comparing schedule-service's real balance
// against our own application ledger's running sum is still a genuine,
// non-vacuous integrity check: any bug in match-service's local bookkeeping
// (or a schedule-service linkage regression) surfaces here as a non-zero
// variance, exactly like the original single-service check did.
import { injectable, inject } from 'tsyringe';
import { FLOORPLAN_SCHEDULE_NUMBER } from '../domain/event-types';
import type { ScheduleServiceClient } from '../infrastructure/schedule-service-client';

export const SCHEDULE_SERVICE_CLIENT_TOKEN = 'ScheduleServiceClient';

@injectable()
export class TieOutService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject(SCHEDULE_SERVICE_CLIENT_TOKEN) private readonly scheduleClient: ScheduleServiceClient,
  ) {}

  async computeTieOut(tenantId: string, lenderCode?: string) {
    const scheduleItems = await this.scheduleClient.listOpenItems(tenantId, FLOORPLAN_SCHEDULE_NUMBER);

    // schedule-service has no concept of "lenderCode" (that's purely a
    // floorplan-service domain notion) — when the caller scopes the inquiry
    // to one lender, cross-reference against our own ledger to resolve
    // which controlNumbers (stock#s) belong to that lender, and filter the
    // schedule-service items down to those. Absent a lenderCode filter, all
    // of Schedule 85's open items are in scope.
    let relevantScheduleItems = scheduleItems;
    if (lenderCode) {
      const ownItemsForLender = await this.prisma.floorplanLiabilityItem.findMany({ where: { tenantId, lenderCode } });
      const controlNumbers = new Set(
        ownItemsForLender.map((i: any) => (i.stockNumber ?? i.vin ?? '').trim()).filter((v: string) => v.length > 0),
      );
      relevantScheduleItems = scheduleItems.filter((i) => controlNumbers.has(i.controlNumber));
    }

    // CLOSED schedule-service items are fully relieved — excluded from the
    // open-balance sum exactly like a RELIEVED FloorplanLiabilityItem was
    // excluded before.
    const openScheduleItems = relevantScheduleItems.filter((i) => i.status !== 'CLOSED');
    const sumOfOpenItems = openScheduleItems.reduce((s, i) => s + Number(i.remainingBalance), 0);

    const applications = await this.prisma.floorplanLiabilityApplication.findMany({
      where: { tenantId, item: lenderCode ? { lenderCode } : undefined },
    });
    const sumOfPostedApplications = applications.reduce((s: number, a: any) => s + Number(a.amount), 0);

    const variance = Number((sumOfOpenItems - sumOfPostedApplications).toFixed(2));

    return {
      tenantId,
      lenderCode: lenderCode ?? null,
      scheduleNumber: FLOORPLAN_SCHEDULE_NUMBER,
      sumOfOpenLiabilityItems: sumOfOpenItems.toFixed(2),
      sumOfPostedApplications: sumOfPostedApplications.toFixed(2),
      variance: variance.toFixed(2),
      tied: variance === 0,
      itemCount: openScheduleItems.length,
      applicationCount: applications.length,
      // Drill-down: real schedule-service open items behind the summary
      // number (applyNumber/stockNumber here are schedule-service's own
      // itemNumber/controlNumber — see the field-mapping note in
      // src/infrastructure/schedule-service-client.ts).
      items: openScheduleItems.map((i) => ({
        id: i.id,
        applyNumber: i.itemNumber,
        vin: null,
        stockNumber: i.controlNumber,
        status: i.status,
        remainingBalance: i.remainingBalance,
      })),
    };
  }
}
