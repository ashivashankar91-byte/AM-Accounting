import { inject, injectable } from 'tsyringe';

// ── Constants ────────────────────────────────────────────────────────────────

/** S039: match-type values, determined automatically — never caller-supplied. */
export const MATCH_TYPE_VALUES = ['NONE', 'TWO_WAY', 'THREE_WAY'] as const;
export type MatchType = (typeof MATCH_TYPE_VALUES)[number];

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface Variance {
  poLineId: string;
  invoiceLineId: string;
  type: 'PRICE_VARIANCE' | 'QUANTITY_OVER_PO' | 'QUANTITY_OVER_RECEIPT';
  expected: number;
  actual: number;
  varianceAmount: number;
  withinTolerance: boolean;
}

export interface MatchRunResult {
  matchType: MatchType;
  status: 'MATCHED' | 'EXCEPTION';
  toleranceAmountUsed: number;
  tolerancePercentUsed: number;
  variances: Variance[];
}

export interface ResolveToleranceInput {
  tenantId: string;
  vendorId?: string | null;
}

export interface ToleranceResolution {
  amountTolerance: number;
  percentTolerance: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * S039 — 2-way/3-way invoice match engine.
 *
 * Tolerance resolution mirrors the S052 CashVarianceToleranceConfig
 * scope-resolution pattern exactly: VENDOR -> TENANT -> 0.00. No configured
 * tolerance means only an exact match avoids EXCEPTION — the conservative
 * default, never a silently invented accounting assumption (see
 * ApInvoiceMatchToleranceConfig doc comment in schema.prisma).
 *
 * matchType is always derived here, never trusted from caller input:
 *  - no poId on the invoice           -> NONE (nothing to match)
 *  - poId set, no goods receipts      -> TWO_WAY  (PO vs Invoice)
 *  - poId set, >=1 goods receipt line -> THREE_WAY (PO vs Receipt vs Invoice)
 */
@injectable()
export class InvoiceMatchService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async resolveTolerance(input: ResolveToleranceInput): Promise<ToleranceResolution> {
    if (input.vendorId) {
      const row = await this.prisma.apInvoiceMatchToleranceConfig.findFirst({
        where: { tenantId: input.tenantId, scope: 'VENDOR', scopeId: input.vendorId },
      });
      if (row) {
        return { amountTolerance: Number(row.amountTolerance), percentTolerance: Number(row.percentTolerance) };
      }
    }
    const tenantRow = await this.prisma.apInvoiceMatchToleranceConfig.findFirst({
      where: { tenantId: input.tenantId, scope: 'TENANT', scopeId: null },
    });
    if (tenantRow) {
      return { amountTolerance: Number(tenantRow.amountTolerance), percentTolerance: Number(tenantRow.percentTolerance) };
    }
    return { amountTolerance: 0, percentTolerance: 0 };
  }

  private withinTolerance(expected: number, actual: number, tolerance: ToleranceResolution): boolean {
    const diff = Math.abs(expected - actual);
    if (diff <= tolerance.amountTolerance) return true;
    if (expected !== 0 && (diff / Math.abs(expected)) * 100 <= tolerance.percentTolerance) return true;
    return diff === 0;
  }

  /**
   * Runs the match for a single VendorInvoice (identified by its lines,
   * already loaded). Pure function of its inputs — no DB writes here;
   * InvoiceService.runMatch() persists the VendorInvoiceMatchResult row and
   * updates the invoice's matchType/matchStatus inside its own transaction.
   */
  async match(params: {
    tenantId: string;
    vendorId: string;
    poId: string | null;
    invoiceLines: Array<{ id: string; poLineId: string | null; quantity: number; unitPrice: number }>;
  }): Promise<MatchRunResult> {
    const tolerance = await this.resolveTolerance({ tenantId: params.tenantId, vendorId: params.vendorId });

    if (!params.poId) {
      return { matchType: 'NONE', status: 'MATCHED', toleranceAmountUsed: tolerance.amountTolerance, tolerancePercentUsed: tolerance.percentTolerance, variances: [] };
    }

    const poLines: any[] = await this.prisma.pOLine.findMany({ where: { poId: params.poId } });
    const poLineById = new Map(poLines.map((l) => [l.id, l]));

    const receiptLines: any[] = await this.prisma.goodsReceiptLine.findMany({
      where: { poLineId: { in: poLines.map((l) => l.id) }, receipt: { status: 'OPEN' } },
    });
    const receivedQtyByPoLine = new Map<string, number>();
    for (const rl of receiptLines) {
      receivedQtyByPoLine.set(rl.poLineId, (receivedQtyByPoLine.get(rl.poLineId) ?? 0) + Number(rl.qtyReceived));
    }
    const matchType: MatchType = receiptLines.length > 0 ? 'THREE_WAY' : 'TWO_WAY';

    // Sum invoiced quantity per PO line across this invoice's lines (a PO
    // line may be split across multiple invoice lines/invoices over time).
    const invoicedQtyByPoLine = new Map<string, number>();
    for (const il of params.invoiceLines) {
      if (!il.poLineId) continue;
      invoicedQtyByPoLine.set(il.poLineId, (invoicedQtyByPoLine.get(il.poLineId) ?? 0) + il.quantity);
    }

    const variances: Variance[] = [];
    for (const il of params.invoiceLines) {
      if (!il.poLineId) continue;
      const poLine = poLineById.get(il.poLineId);
      if (!poLine) {
        variances.push({
          poLineId: il.poLineId, invoiceLineId: il.id, type: 'QUANTITY_OVER_PO',
          expected: 0, actual: il.quantity, varianceAmount: il.quantity, withinTolerance: false,
        });
        continue;
      }

      // Price variance: invoice unit price vs PO unit cost.
      const priceDiff = Math.abs(il.unitPrice - Number(poLine.unitCost));
      variances.push({
        poLineId: il.poLineId, invoiceLineId: il.id, type: 'PRICE_VARIANCE',
        expected: Number(poLine.unitCost), actual: il.unitPrice, varianceAmount: priceDiff,
        withinTolerance: this.withinTolerance(Number(poLine.unitCost), il.unitPrice, tolerance),
      });

      // Quantity vs PO line ordered qty — cannot invoice more than ordered.
      const totalInvoicedForLine = invoicedQtyByPoLine.get(il.poLineId) ?? il.quantity;
      const poQty = Number(poLine.qty);
      if (totalInvoicedForLine > poQty) {
        const overAmt = totalInvoicedForLine - poQty;
        variances.push({
          poLineId: il.poLineId, invoiceLineId: il.id, type: 'QUANTITY_OVER_PO',
          expected: poQty, actual: totalInvoicedForLine, varianceAmount: overAmt,
          withinTolerance: this.withinTolerance(poQty, totalInvoicedForLine, tolerance),
        });
      }

      // 3-way only: cannot invoice more than actually received.
      if (matchType === 'THREE_WAY') {
        const receivedQty = receivedQtyByPoLine.get(il.poLineId) ?? 0;
        if (totalInvoicedForLine > receivedQty) {
          const overAmt = totalInvoicedForLine - receivedQty;
          variances.push({
            poLineId: il.poLineId, invoiceLineId: il.id, type: 'QUANTITY_OVER_RECEIPT',
            expected: receivedQty, actual: totalInvoicedForLine, varianceAmount: overAmt,
            withinTolerance: this.withinTolerance(receivedQty, totalInvoicedForLine, tolerance),
          });
        }
      }
    }

    const status: 'MATCHED' | 'EXCEPTION' = variances.every((v) => v.withinTolerance) ? 'MATCHED' : 'EXCEPTION';

    return {
      matchType,
      status,
      toleranceAmountUsed: tolerance.amountTolerance,
      tolerancePercentUsed: tolerance.percentTolerance,
      variances,
    };
  }
}
