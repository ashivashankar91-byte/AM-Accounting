// S013 — Balanced Journal Posting rule engine (pure, no I/O).
//
// THIS IS THE SINGLE RULE SOURCE (BR215-1). The S013 posting path and the S215
// on-demand validation path BOTH call `evaluate()` here. There is no second
// engine — validate and post can never diverge (BR215-2). All I/O (loading
// accounts / period / source) happens in the application layer, which passes a
// fully-resolved PostingContext into this pure evaluator.
//
// Money is handled in integer cents to avoid binary-float drift; the DB columns
// are NUMERIC(15,2) and the DB-level DR=CR deferred trigger is the final
// safeguard. This evaluator produces the per-rule diagnostics (BR013-1..5).

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type SourceClass = 'MANUAL' | 'SYSTEM';
export type PeriodStatus = 'FUTURE' | 'OPEN' | 'SOFT_CLOSED' | 'HARD_CLOSED' | 'LOCKED';

/** P&L account types require a department dimension (BR013-5, UQ-16 interim). */
export const PNL_TYPES: readonly AccountType[] = ['REVENUE', 'EXPENSE'];

export interface PostingLineInput {
  accountId: string;
  storeId: string;
  deptCode?: string | null;
  controlNumber?: string | null;
  applyNumber?: string | null;
  dr?: number | string | null; // dollars; exactly one of dr|cr must be > 0
  cr?: number | string | null;
  memo?: string | null;
  /**
   * S011 — BR011-2/BR011-3, additive/optional. Read only by PostingService's
   * tag-persistence step after a clean evaluate() pass; the shared BR013
   * evaluator (evaluate(), below) never inspects this field, so tags
   * provably cannot influence balancing/posting math (BR011-3, NEG: "posting
   * a JE with no tags behaves byte-identically to pre-S011 behavior").
   */
  analysisTags?: { typeId: string; valueId: string }[] | null;
}

export interface PostingHeaderInput {
  entityId: string;
  date: string; // YYYY-MM-DD — resolved to a period by the app layer
  sourceCode: string;
  memo?: string | null;
  idempotencyKey: string;
  // S008 — per-journal adjusting-entry attribute (not inferred from the
  // period). Only relevant to BR013-2's SOFT_CLOSED exception below; the
  // real authorization/attestation check happens at the DB trigger layer
  // (enforce_period_postable) and in DraftService (fiscal.je.mark_adjusting).
  isAdjusting?: boolean;
}

/** Resolved reference data the evaluator needs — loaded by the app layer. */
export interface ResolvedAccount {
  id: string;
  accountNumber: string;
  type: AccountType | string;
  normalBalance: 'DR' | 'CR' | string;
  postable: boolean;
  status: string; // ACTIVE | INACTIVE
}

export interface ResolvedPeriod {
  id: string;
  code: string; // YYYY-MM | YYYY-13
  status: PeriodStatus | string;
  adjustmentsOnly: boolean;
}

export interface ResolvedSource {
  code: string;
  sourceClass: SourceClass | string;
  status: string; // ACTIVE | INACTIVE
}

export interface PostingContext {
  /** callerClass drives the source-class match (BR013-3). Manual JE = MANUAL. */
  callerClass: SourceClass;
  accounts: Map<string, ResolvedAccount>; // keyed by accountId
  period: ResolvedPeriod | null; // null = date resolved to no period
  source: ResolvedSource | null; // null = source not found
}

export interface Violation {
  rule: string; // BR013-1 .. BR013-5
  lineIndex?: number;
  field?: string;
  diagnostic: string;
}

export interface EvaluationResult {
  pass: boolean;
  violations: Violation[];
  totalDebitsCents: number;
  totalCreditsCents: number;
  deltaDr: number; // dollars
  deltaCr: number; // dollars
}

// ── Money helpers (integer cents) ───────────────────────────────────────────────

export function toCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

// ── The single evaluator (BR013-1..5) ────────────────────────────────────────────

export function evaluate(
  header: PostingHeaderInput,
  lines: PostingLineInput[],
  ctx: PostingContext,
): EvaluationResult {
  const violations: Violation[] = [];

  // Structural: at least one line.
  if (!Array.isArray(lines) || lines.length === 0) {
    violations.push({ rule: 'BR013-1', diagnostic: 'A journal must have at least one line.' });
  }

  let totalDr = 0;
  let totalCr = 0;

  lines.forEach((line, i) => {
    const drC = toCents(line.dr);
    const crC = toCents(line.cr);

    // Amount shape: exactly one side > 0, non-negative, numeric.
    if (Number.isNaN(drC) || Number.isNaN(crC)) {
      violations.push({ rule: 'BR013-1', lineIndex: i, field: 'amount', diagnostic: 'Line amount is not a valid number.' });
    } else {
      if (drC < 0 || crC < 0) {
        violations.push({ rule: 'BR013-1', lineIndex: i, field: 'amount', diagnostic: 'Line amounts must be non-negative.' });
      }
      const drSet = drC > 0;
      const crSet = crC > 0;
      if (drSet && crSet) {
        violations.push({ rule: 'BR013-1', lineIndex: i, field: 'amount', diagnostic: 'A line may set exactly one of debit or credit, not both.' });
      } else if (!drSet && !crSet) {
        violations.push({ rule: 'BR013-1', lineIndex: i, field: 'amount', diagnostic: 'A line must set exactly one of debit or credit.' });
      }
      totalDr += Math.max(drC, 0);
      totalCr += Math.max(crC, 0);
    }

    // BR013-4 — account active + postable + type present/known.
    const acct = ctx.accounts.get(line.accountId);
    if (!acct) {
      violations.push({ rule: 'BR013-4', lineIndex: i, field: 'accountId', diagnostic: `Account ${line.accountId} not found in this entity.` });
    } else {
      if (acct.status !== 'ACTIVE') {
        violations.push({ rule: 'BR013-4', lineIndex: i, field: 'accountId', diagnostic: `Account ${acct.accountNumber} is not ACTIVE.` });
      }
      if (!acct.postable) {
        violations.push({ rule: 'BR013-4', lineIndex: i, field: 'accountId', diagnostic: `Account ${acct.accountNumber} is a non-postable summary account (BR210-5).` });
      }
      if (!acct.type) {
        violations.push({ rule: 'BR013-4', lineIndex: i, field: 'accountId', diagnostic: `Account ${acct.accountNumber} has no type.` });
      }
      // BR013-5 — dimensions valid: P&L lines require a department (UQ-16 interim).
      if (PNL_TYPES.includes(acct.type as AccountType)) {
        const dept = (line.deptCode ?? '').toString().trim();
        if (!dept) {
          violations.push({ rule: 'BR013-5', lineIndex: i, field: 'deptCode', diagnostic: `P&L account ${acct.accountNumber} (${acct.type}) requires a department code.` });
        }
      }
    }

    // BR013-5 — every line needs a store dimension.
    if (!line.storeId || !line.storeId.toString().trim()) {
      violations.push({ rule: 'BR013-5', lineIndex: i, field: 'storeId', diagnostic: 'Line requires a storeId dimension.' });
    }
  });

  // BR013-1 — sum(dr) == sum(cr) to the cent.
  if (totalDr !== totalCr) {
    violations.push({
      rule: 'BR013-1',
      field: 'balance',
      diagnostic: `Debits (${centsToDollars(totalDr).toFixed(2)}) must equal credits (${centsToDollars(totalCr).toFixed(2)}); difference ${centsToDollars(Math.abs(totalDr - totalCr)).toFixed(2)}.`,
    });
  }

  // BR013-2 — period eligibility: OPEN, or SOFT_CLOSED for an authorized
  // adjusting entry (S008 v1). Mirrors domain/period-status.ts eligibility()
  // and the enforce_period_postable() DB trigger — must never diverge from
  // either (the DB trigger is the real backstop regardless of this check).
  if (!ctx.period) {
    violations.push({ rule: 'BR013-2', field: 'date', diagnostic: `No fiscal period contains date ${header.date}.` });
  } else if (ctx.period.status !== 'OPEN' && !(ctx.period.status === 'SOFT_CLOSED' && header.isAdjusting)) {
    violations.push({
      rule: 'BR013-2',
      field: 'date',
      diagnostic:
        ctx.period.status === 'SOFT_CLOSED'
          ? `Period ${ctx.period.code} is SOFT_CLOSED; only an authorized adjusting entry (fiscal.je.mark_adjusting) may post here.`
          : `Period ${ctx.period.code} is ${ctx.period.status}; postings require an OPEN period.`,
    });
  }

  // BR013-3 — source valid + active + caller-class-matched.
  if (!ctx.source) {
    violations.push({ rule: 'BR013-3', field: 'sourceCode', diagnostic: `Journal source ${header.sourceCode} not found.` });
  } else {
    if (ctx.source.status !== 'ACTIVE') {
      violations.push({ rule: 'BR013-3', field: 'sourceCode', diagnostic: `Journal source ${ctx.source.code} is inactive.` });
    }
    if (ctx.source.sourceClass !== ctx.callerClass) {
      violations.push({ rule: 'BR013-3', field: 'sourceCode', diagnostic: `Journal source ${ctx.source.code} is ${ctx.source.sourceClass}; caller is ${ctx.callerClass}.` });
    }
  }

  // Idempotency key required (BR013-6 enforced at persistence via unique index).
  if (!header.idempotencyKey || !header.idempotencyKey.toString().trim()) {
    violations.push({ rule: 'BR013-6', field: 'idempotencyKey', diagnostic: 'idempotencyKey is required.' });
  }

  return {
    pass: violations.length === 0,
    violations,
    totalDebitsCents: totalDr,
    totalCreditsCents: totalCr,
    deltaDr: centsToDollars(totalDr),
    deltaCr: centsToDollars(totalCr),
  };
}

/**
 * Signed balance delta for an account line in NORMAL-BALANCE terms:
 * DR-normal accounts increase with debits; CR-normal with credits.
 * Returned in dollars for the gl_account.balance NUMERIC(15,2) column.
 */
export function balanceDelta(normalBalance: string, drCents: number, crCents: number): number {
  const net = normalBalance === 'CR' ? crCents - drCents : drCents - crCents;
  return centsToDollars(net);
}
