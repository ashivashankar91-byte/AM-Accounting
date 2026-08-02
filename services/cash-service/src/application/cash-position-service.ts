import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { PrismaClient } from '.prisma/cash-client';
import { computeLargeCashFlags } from '../domain/cash-position';
import { ReconServiceBankBalanceAdapter, AparServiceOutstandingChecksAdapter } from '../infrastructure/cash-position-adapters';

export interface DailyCashPositionQuery {
  tenantId: string;
  entityId: string;
  businessDate: string; // YYYY-MM-DD
  jurisdiction?: string;
}

/**
 * S057 — Daily Cash Position Dashboard: a read-only composition/
 * aggregation endpoint. Every field returned here is a direct sum/join of
 * already-posted or already-settled data from this service's own tables
 * (drawer sessions, undeposited receipts, deposits-in-transit) plus
 * best-effort reads from recon-service (bank balances) and apar-service
 * (outstanding checks) — NO financial calculation is performed beyond
 * simple sums, per the story's explicit AC. Every returned value carries
 * its source table/service so it is directly traceable (also per AC).
 */
@injectable()
export class CashPositionService {
  private readonly bankBalanceAdapter = new ReconServiceBankBalanceAdapter();
  private readonly outstandingChecksAdapter = new AparServiceOutstandingChecksAdapter();

  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async getDailyCashPosition(query: DailyCashPositionQuery) {
    const { tenantId, entityId, businessDate } = query;

    // ── Drawer sessions + undeposited receipts (source: cash_drawer, cash_receipt — S052) ──
    const drawers = await this.prisma.cashDrawer.findMany({
      where: { tenantId, entityId, businessDate: new Date(businessDate) },
    });
    const undepositedReceipts = await this.prisma.cashReceipt.findMany({
      where: { tenantId, entityId, status: 'ISSUED' },
    });
    const undepositedTotal = undepositedReceipts.reduce((acc, r) => acc + Number(r.totalAmount), 0);

    // ── Deposits-in-transit (source: cash_deposit, bank_feed_line — S053) ──
    // A deposit is "in transit" when it has been posted (sent to the bank)
    // but no bank-feed line has matched/cleared it yet — a direct join,
    // not a computed estimate.
    const postedDeposits = await this.prisma.cashDeposit.findMany({
      where: { tenantId, entityId, status: 'POSTED' },
      include: { lines: true },
    });
    const matchedDepositIds = new Set(
      (await this.prisma.bankFeedLine.findMany({ where: { tenantId, matchedDepositId: { not: null } } }))
        .map((l) => l.matchedDepositId as string),
    );
    const depositsInTransit = postedDeposits.filter((d) => !matchedDepositIds.has(d.id));
    const depositsInTransitTotal = depositsInTransit.reduce((acc, d) => acc + Number(d.totalAmount), 0);

    // ── Bank balances (source: recon-service, or MANUAL_ENTRY_REQUIRED) ──
    const bankAccountCodes = Array.from(new Set([...postedDeposits.map((d) => d.bankAccountCode)]));
    const bankBalances = await Promise.all(
      bankAccountCodes.map((code) => this.bankBalanceAdapter.getLatestBalance(tenantId, code)),
    );

    // ── Outstanding checks (source: apar-service, or PENDING_SERVICE_INTEGRATION) ──
    const outstandingChecks = await this.outstandingChecksAdapter.listOutstandingChecks(tenantId);

    // ── Large-cash-transaction flags (source: large_cash_threshold_config) ──
    const thresholds = query.jurisdiction
      ? await this.prisma.largeCashThresholdConfig.findMany({ where: { tenantId, jurisdiction: query.jurisdiction } })
      : await this.prisma.largeCashThresholdConfig.findMany({ where: { tenantId } });
    const jurisdiction = query.jurisdiction ?? thresholds[0]?.jurisdiction ?? 'UNSPECIFIED';
    const flagCandidates = [
      ...undepositedReceipts.map((r) => ({ sourceType: 'RECEIPT' as const, sourceId: r.id, amount: r.totalAmount.toString(), jurisdiction, businessDate })),
      ...postedDeposits.map((d) => ({ sourceType: 'DEPOSIT' as const, sourceId: d.id, amount: d.totalAmount.toString(), jurisdiction, businessDate })),
    ];
    const largeCashFlags = computeLargeCashFlags(flagCandidates, thresholds.map((t) => ({
      jurisdiction: t.jurisdiction, thresholdAmount: t.thresholdAmount.toString(), currency: t.currency,
    })));

    return {
      tenantId,
      entityId,
      businessDate,
      drawerSessions: {
        source: 'cash_drawer',
        items: drawers,
        total: drawers.reduce((acc, d) => acc + Number(d.openingFloat), 0),
      },
      undepositedReceipts: {
        source: 'cash_receipt (status=ISSUED)',
        count: undepositedReceipts.length,
        total: undepositedTotal,
      },
      depositsInTransit: {
        source: 'cash_deposit (status=POSTED, not yet bank_feed_line-matched)',
        count: depositsInTransit.length,
        total: depositsInTransitTotal,
      },
      bankBalances: {
        source: 'recon-service',
        items: bankBalances,
      },
      outstandingChecks: {
        source: 'apar-service',
        state: outstandingChecks.state,
        note: outstandingChecks.note,
        count: outstandingChecks.items.length,
        total: outstandingChecks.items.reduce((acc, i) => acc + Number(i.amount), 0),
        items: outstandingChecks.items,
      },
      largeCashTransactionFlags: {
        source: 'large_cash_threshold_config',
        configuredThresholdCount: thresholds.length,
        flags: largeCashFlags,
      },
    };
  }

  /**
   * Retains and audits a snapshot of the composed daily cash position —
   * no recomputation happens on export; the already-composed read model
   * is written verbatim so the export is provably traceable to what was
   * shown at request time.
   */
  async exportDailyCashPosition(query: DailyCashPositionQuery, requestedBy: string) {
    const snapshot = await this.getDailyCashPosition(query);
    const created = await this.prisma.cashPositionExport.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: query.tenantId,
        entityId: query.entityId,
        businessDate: new Date(query.businessDate),
        requestedBy,
        snapshot: snapshot as any,
      },
    });
    return created;
  }

  async listExports(tenantId: string, filters: { entityId?: string; limit?: number; offset?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const where: any = { tenantId };
    if (filters.entityId) where.entityId = filters.entityId;
    const [items, total] = await Promise.all([
      this.prisma.cashPositionExport.findMany({ where, orderBy: { requestedAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.cashPositionExport.count({ where }),
    ]);
    return { items, total, limit, offset };
  }
}
