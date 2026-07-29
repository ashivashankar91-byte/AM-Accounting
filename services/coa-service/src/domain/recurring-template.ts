// S032 — Recurring Journal Templates domain helpers (pure, no I/O).
//
// R1 scope (per PO-ratified BLK-20..24): fixed debit/credit amounts only
// (BLK-23 — no formula/percent amounts); a template must balance at save
// (BR032-1); generation is a client of the certified S214 draft path, never a
// second posting path — this module owns only shape validation + the balance
// arithmetic, mirroring domain/journal-posting.ts's cents-based approach to
// avoid binary-float drift.

import { toCents, centsToDollars } from './journal-posting';

export interface TemplateLineInput {
  accountId?: string | null;
  accountNumber?: string | null;
  storeId?: string | null;
  deptCode?: string | null;
  controlNumber?: string | null;
  applyNumber?: string | null;
  dr?: number | string | null; // fixed dollars (BLK-23) — exactly one of dr|cr must be > 0
  cr?: number | string | null;
  memo?: string | null;
}

export interface TemplateLineViolation {
  lineIndex: number;
  field: string;
  diagnostic: string;
}

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,39}$/;

export function isValidTemplateCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_RE.test(code);
}

export function isValidTemplateName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length >= 1 && name.length <= 120;
}

/** Normalize a template line for storage (trim empties to null, like draft lines). */
export function normalizeTemplateLine(line: TemplateLineInput): TemplateLineInput {
  const s = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
  const n = (v: unknown) => (v === undefined || v === null || v === '' ? 0 : Number(v));
  return {
    accountId: s(line.accountId),
    accountNumber: s(line.accountNumber),
    storeId: s(line.storeId),
    deptCode: s(line.deptCode),
    controlNumber: s(line.controlNumber),
    applyNumber: s(line.applyNumber),
    dr: n(line.dr),
    cr: n(line.cr),
    memo: s(line.memo),
  };
}

/**
 * BR032-1 — shape validation at save: at least 2 lines, every line has an
 * account + store, exactly one of dr/cr > 0 per line, no negative amounts.
 * This is intentionally stricter than draft.ts's normalizeLine (BR214-1 lets a
 * draft save in ANY state) — a *template* is a reusable master record, not a
 * scratchpad, so BR032-1 requires it valid at save.
 */
export function validateTemplateLines(lines: TemplateLineInput[]): TemplateLineViolation[] {
  const violations: TemplateLineViolation[] = [];
  if (lines.length < 2) {
    violations.push({ lineIndex: -1, field: 'lines', diagnostic: 'A template requires at least 2 lines' });
    return violations;
  }
  lines.forEach((line, i) => {
    if (!line.accountId) {
      violations.push({ lineIndex: i, field: 'accountId', diagnostic: 'accountId is required' });
    }
    if (!line.storeId) {
      violations.push({ lineIndex: i, field: 'storeId', diagnostic: 'storeId is required' });
    }
    const drCents = toCents(line.dr);
    const crCents = toCents(line.cr);
    if (!Number.isFinite(drCents) || !Number.isFinite(crCents) || drCents < 0 || crCents < 0) {
      violations.push({ lineIndex: i, field: 'dr/cr', diagnostic: 'dr and cr must be non-negative numbers' });
    } else if (drCents === 0 && crCents === 0) {
      violations.push({ lineIndex: i, field: 'dr/cr', diagnostic: 'exactly one of dr or cr must be greater than zero' });
    } else if (drCents > 0 && crCents > 0) {
      violations.push({ lineIndex: i, field: 'dr/cr', diagnostic: 'a line cannot carry both a debit and a credit amount' });
    }
  });
  return violations;
}

export interface TemplateBalance {
  totalDrCents: number;
  totalCrCents: number;
  totalDr: number;
  totalCr: number;
  balanced: boolean;
}

/** BR032-1 — "balanced required at save". Same cents-arithmetic discipline as BR013-1. */
export function computeTemplateBalance(lines: TemplateLineInput[]): TemplateBalance {
  let totalDrCents = 0;
  let totalCrCents = 0;
  for (const line of lines) {
    totalDrCents += toCents(line.dr) || 0;
    totalCrCents += toCents(line.cr) || 0;
  }
  return {
    totalDrCents,
    totalCrCents,
    totalDr: centsToDollars(totalDrCents),
    totalCr: centsToDollars(totalCrCents),
    balanced: totalDrCents === totalCrCents,
  };
}

/** Mirror a template's fixed lines DR<->CR (BLK-22 auto-reverse draft lines). */
export function mirrorTemplateLines(lines: TemplateLineInput[]): TemplateLineInput[] {
  return lines.map((l) => ({ ...l, dr: l.cr ?? 0, cr: l.dr ?? 0 }));
}
