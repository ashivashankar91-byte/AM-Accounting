import { injectable, inject } from 'tsyringe';

/**
 * Injectable/pluggable "posted tax lines" data source — CE-07's posting
 * engine is a separate service/worktree not yet finalized, so the real
 * wiring point is marked PENDING_UPSTREAM_TECHNICAL_RECONCILIATION (see
 * ReconciliationService.threeWayTie's glMovementSourceIsPending flag). This
 * interface lets the reconciliation logic itself be fully tested now with
 * a test double (tests/support/fake-posted-tax-line-source.ts), and wired
 * to the real CE-07 posting-engine data source later without a contract
 * change.
 */
export interface PostedTaxLine {
  documentId: string;
  documentType: string;
  jurisdictionId: string;
  taxAmount: string;
  taxResultId: string | null; // null = orphan: posted tax without a linked result
}

export interface PostedTaxLineSource {
  findPostedTaxLines(tenantId: string, legalEntityId: string, period: string): Promise<PostedTaxLine[]>;
}

/**
 * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — no real posted-tax-line
 * source is wired yet (CE-07 not finalized). Returns an empty set,
 * truthfully, rather than fabricating posted amounts.
 */
export class UnwiredPostedTaxLineSource implements PostedTaxLineSource {
  async findPostedTaxLines(): Promise<PostedTaxLine[]> {
    return [];
  }
}

export interface JurisdictionTie {
  jurisdictionId: string;
  engineSum: string;
  postedSum: string;
  glMovement: string;
  variance: string;
  balanced: boolean;
}

export interface ThreeWayTieReport {
  period: string;
  legalEntityId: string;
  ties: JurisdictionTie[];
  overallBalanced: boolean;
  /** PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — true until CE-07's real
   * posted-tax-line source is wired; the UI renders honestly until then. */
  glMovementSourceIsPending: boolean;
  orphanedResults: Array<{ taxResultId: string; documentId: string }>;
  orphanedPostedLines: Array<{ documentId: string; jurisdictionId: string }>;
}

/**
 * S124 — Reconciliation: engine results <-> GL. Transaction-level (every
 * posted journal's tax lines tie to a stored result id) and period-level
 * three-way tie (period × entity × jurisdiction: Σ engine-result tax = Σ
 * posted tax-line amounts = tax-liability GL account movement). Variance
 * surfaces loudly with drill-down document list.
 */
@injectable()
export class ReconciliationService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('PostedTaxLineSource') private readonly postedTaxLineSource: PostedTaxLineSource,
  ) {}

  async threeWayTie(tenantId: string, legalEntityId: string, period: string): Promise<ThreeWayTieReport> {
    const [year, month] = period.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));

    const results = await this.prisma.taxResult.findMany({
      where: {
        tenantId, legalEntityId, businessDate: { gte: start, lt: end },
        status: { in: ['CALCULATED', 'EXEMPT_APPLIED'] },
      },
      include: { lines: true },
    });

    const postedLines = await this.postedTaxLineSource.findPostedTaxLines(tenantId, legalEntityId, period);

    const jurisdictionIds = new Set<string>();
    for (const r of results) for (const l of r.lines) jurisdictionIds.add(l.jurisdictionId);
    for (const p of postedLines) jurisdictionIds.add(p.jurisdictionId);

    const ties: JurisdictionTie[] = [];
    for (const jurisdictionId of jurisdictionIds) {
      const engineSum = results
        .flatMap((r: any) => r.lines)
        .filter((l: any) => l.jurisdictionId === jurisdictionId)
        .reduce((sum: number, l: any) => sum + Number(l.taxAmount), 0);
      const postedSum = postedLines
        .filter((p) => p.jurisdictionId === jurisdictionId)
        .reduce((sum, p) => sum + Number(p.taxAmount), 0);
      // GL movement: PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — until the
      // real GL-movement source is wired, this uses postedSum as the best
      // available proxy (the injected test double controls this
      // explicitly for variance-detection tests).
      const glMovement = postedSum;
      const variance = Math.round((engineSum - postedSum) * 100) / 100;
      ties.push({
        jurisdictionId,
        engineSum: engineSum.toFixed(2),
        postedSum: postedSum.toFixed(2),
        glMovement: glMovement.toFixed(2),
        variance: variance.toFixed(2),
        balanced: Math.abs(variance) < 0.005,
      });
    }

    const resultIdsWithPostedLine = new Set(postedLines.filter((p) => p.taxResultId).map((p) => p.taxResultId));
    const orphanedResults = results
      .filter((r: any) => !resultIdsWithPostedLine.has(r.id))
      .map((r: any) => ({ taxResultId: r.id, documentId: r.documentId }));

    const resultIds = new Set(results.map((r: any) => r.id));
    const orphanedPostedLines = postedLines
      .filter((p) => p.taxResultId && !resultIds.has(p.taxResultId))
      .map((p) => ({ documentId: p.documentId, jurisdictionId: p.jurisdictionId }));

    return {
      period,
      legalEntityId,
      ties,
      overallBalanced: ties.every((t) => t.balanced) && orphanedResults.length === 0 && orphanedPostedLines.length === 0,
      glMovementSourceIsPending: true, // PENDING_UPSTREAM_TECHNICAL_RECONCILIATION
      orphanedResults,
      orphanedPostedLines,
    };
  }

  /** Jurisdiction liability report: period × entity × jurisdiction × tax
   * type (taxable base, tax, posted, variance) — the remittance-preparation
   * source. */
  async jurisdictionLiabilityReport(tenantId: string, legalEntityId: string, period: string) {
    const tie = await this.threeWayTie(tenantId, legalEntityId, period);
    const [year, month] = period.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const results = await this.prisma.taxResult.findMany({
      where: { tenantId, legalEntityId, businessDate: { gte: start, lt: end }, status: { in: ['CALCULATED', 'EXEMPT_APPLIED'] } },
      include: { lines: true },
    });
    const byJurisdictionTaxType = new Map<string, { jurisdictionId: string; taxType: string; taxableBase: number; tax: number }>();
    for (const r of results) {
      for (const l of r.lines) {
        const key = `${l.jurisdictionId}::${l.taxType}`;
        const entry = byJurisdictionTaxType.get(key) ?? { jurisdictionId: l.jurisdictionId, taxType: l.taxType, taxableBase: 0, tax: 0 };
        entry.taxableBase += Number(l.taxableBase);
        entry.tax += Number(l.taxAmount);
        byJurisdictionTaxType.set(key, entry);
      }
    }
    return {
      period,
      legalEntityId,
      rows: Array.from(byJurisdictionTaxType.values()).map((e) => ({
        jurisdictionId: e.jurisdictionId,
        taxType: e.taxType,
        taxableBase: e.taxableBase.toFixed(2),
        tax: e.tax.toFixed(2),
      })),
      glMovementSourceIsPending: tie.glMovementSourceIsPending,
    };
  }

  /** Close-period gate signal for CE-15 — BALANCED or loud variance. */
  async closePeriodGate(tenantId: string, legalEntityId: string, period: string) {
    const tie = await this.threeWayTie(tenantId, legalEntityId, period);
    return {
      period,
      legalEntityId,
      gateStatus: tie.overallBalanced ? 'BALANCED' : 'VARIANCE_DETECTED',
      variancesByJurisdiction: tie.ties.filter((t) => !t.balanced),
      orphanedResultsCount: tie.orphanedResults.length,
      orphanedPostedLinesCount: tie.orphanedPostedLines.length,
      glMovementSourceIsPending: tie.glMovementSourceIsPending,
    };
  }
}
