// S020 — Deterministic rule selection + balanced journal-blueprint generation.
// Pure, no I/O. The single evaluator posting-service.ts's PostingService.post()
// ultimately consumes (as PostingLineInput[]) is domain/journal-posting.ts's
// evaluate() — this module only gets the blueprint TO that point; it never
// posts anything itself.

import crypto from 'crypto';
import { RuleDefinition, RulePackDefinition, BP_TOTAL } from './dsl';
import { SourceEventEnvelope, resolveEnvelopePath } from './event-envelope';
import { evaluateCondition } from './conditions';
import { canonicalStringify } from './strict-json';
import { toCents, centsToDollars } from '../journal-posting';

export interface BlueprintLine {
  accountNumber: string;
  storeId: string;
  deptCode?: string | null;
  dr: number; // dollars
  cr: number; // dollars
  memo?: string | null;
  /** CE-12 — resolved from a fixed allocation's controlNumberPath, if set. */
  controlNumber?: string | null;
  /**
   * Resolved from a fixed allocation's applyNumberPath (CE-12), OR set on a
   * dynamic line item (debitLineItemsPath/creditLineItemsPath) whose event
   * payload item carries an `applyNumber` — the schedule open-item business
   * reference (ScheduleOpenItem.itemNumber) this line relieves via
   * gl-service's applyCd='#' mechanism, instead of creating a new open item.
   */
  applyNumber?: string | null;
}

function resolveOptionalStringPath(path: string | null | undefined, envelope: SourceEventEnvelope): string | null {
  if (!path) return null;
  const raw = resolveEnvelopePath(envelope, path);
  return raw === undefined || raw === null ? null : String(raw);
}

export interface RuleMatch {
  rule: RuleDefinition;
}

/** Rules evaluated in ascending priority order; first whose condition passes wins (BR S020-2/3). */
export function selectRule(pack: RulePackDefinition, envelope: SourceEventEnvelope): RuleMatch | null {
  const ordered = [...pack.rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    const matched = !rule.condition || evaluateCondition(rule.condition, envelope);
    if (matched) return { rule };
  }
  return null;
}

export class BlueprintResolutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'BlueprintResolutionError';
  }
}

function resolveBaseAmountCents(path: string, envelope: SourceEventEnvelope): number {
  const raw = resolveEnvelopePath(envelope, path);
  if (raw === undefined || raw === null || raw === '') {
    throw new BlueprintResolutionError('REQUIRED_VALUE_MISSING', `Base amount path "${path}" resolved to no value on the event.`);
  }
  const cents = toCents(raw as number | string);
  if (Number.isNaN(cents)) {
    throw new BlueprintResolutionError('INVALID_AMOUNT', `Base amount path "${path}" did not resolve to a valid decimal amount.`);
  }
  if (cents <= 0) {
    throw new BlueprintResolutionError('NON_POSITIVE_AMOUNT', `Base amount path "${path}" resolved to a non-positive amount.`);
  }
  return cents;
}

/** Split totalCents across allocations by basis points, deterministic largest-item-absorbs-remainder rounding. */
function allocateCents(totalCents: number, bps: number[]): number[] {
  const out: number[] = [];
  let running = 0;
  for (let i = 0; i < bps.length - 1; i++) {
    const c = Math.round((totalCents * bps[i]) / BP_TOTAL);
    out.push(c);
    running += c;
  }
  out.push(totalCents - running); // last allocation absorbs the rounding remainder — guarantees exact total
  return out;
}

interface RawDebitLineItem {
  accountNumber: string;
  storeId: string;
  deptCode?: string | null;
  amount: number | string;
  /** Schedule open-item relief reference — see BlueprintLine's doc-comment. */
  applyNumber?: string | null;
}

function isRawDebitLineItem(v: unknown): v is RawDebitLineItem {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['accountNumber'] === 'string' && o['accountNumber'].trim() !== ''
    && typeof o['storeId'] === 'string' && o['storeId'].trim() !== ''
    && (o['amount'] !== undefined && o['amount'] !== null)
    && (o['deptCode'] === undefined || o['deptCode'] === null || typeof o['deptCode'] === 'string')
    && (o['applyNumber'] === undefined || o['applyNumber'] === null || typeof o['applyNumber'] === 'string');
}

/** Resolve a `debitLineItemsPath`/`creditLineItemsPath` into one BlueprintLine per array item — see dsl.ts's PostingGroup doc comment. */
function resolveLineItems(fieldName: string, path: string, envelope: SourceEventEnvelope, memo: string | null, side: 'dr' | 'cr'): { lines: BlueprintLine[]; totalCents: number } {
  const raw = resolveEnvelopePath(envelope, path);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BlueprintResolutionError('MISSING_LINE_ITEMS', `${fieldName} "${path}" did not resolve to a non-empty array.`);
  }
  const lines: BlueprintLine[] = [];
  let totalCents = 0;
  raw.forEach((item, i) => {
    if (!isRawDebitLineItem(item)) {
      throw new BlueprintResolutionError('INVALID_LINE_ITEM_SHAPE', `${fieldName} "${path}"[${i}] is missing accountNumber/storeId/amount.`);
    }
    const cents = toCents(item.amount);
    if (Number.isNaN(cents) || cents <= 0) {
      throw new BlueprintResolutionError('INVALID_AMOUNT', `${fieldName} "${path}"[${i}].amount did not resolve to a positive decimal amount.`);
    }
    totalCents += cents;
    lines.push({
      accountNumber: item.accountNumber, storeId: item.storeId, deptCode: item.deptCode ?? null,
      dr: side === 'dr' ? centsToDollars(cents) : 0, cr: side === 'cr' ? centsToDollars(cents) : 0, memo,
      applyNumber: item.applyNumber ?? null,
    });
  });
  return { lines, totalCents };
}

/** Generate the balanced blueprint lines for a matched rule against a resolved event. Stable order: groups, then debit allocations/line items, then credit allocations, all in definition-array order. */
export function generateBlueprint(rule: RuleDefinition, envelope: SourceEventEnvelope): BlueprintLine[] {
  const lines: BlueprintLine[] = [];
  for (const group of rule.blueprint.postingGroups) {
    const baseCents = resolveBaseAmountCents(group.baseAmountPath, envelope);
    const memo = resolveMemoTemplate(rule.blueprint.memoTemplate, envelope);

    if (group.debitLineItemsPath) {
      const { lines: itemLines, totalCents } = resolveLineItems('debitLineItemsPath', group.debitLineItemsPath, envelope, memo, 'dr');
      if (totalCents !== baseCents) {
        throw new BlueprintResolutionError('LINE_ITEMS_TOTAL_MISMATCH', `debitLineItemsPath "${group.debitLineItemsPath}" items total ${centsToDollars(totalCents)} but baseAmountPath "${group.baseAmountPath}" resolved to ${centsToDollars(baseCents)}.`);
      }
      lines.push(...itemLines);
    } else {
      const drCents = allocateCents(baseCents, group.debitAllocations.map((a) => a.bp));
      group.debitAllocations.forEach((alloc, i) => {
        lines.push({
          accountNumber: alloc.accountNumber,
          storeId: alloc.storeId,
          deptCode: alloc.deptCode ?? null,
          dr: centsToDollars(drCents[i]),
          cr: 0,
          memo,
          controlNumber: resolveOptionalStringPath(alloc.controlNumberPath, envelope),
          applyNumber: resolveOptionalStringPath(alloc.applyNumberPath, envelope),
        });
      });
    }

    if (group.creditLineItemsPath) {
      const { lines: itemLines, totalCents } = resolveLineItems('creditLineItemsPath', group.creditLineItemsPath, envelope, memo, 'cr');
      if (totalCents !== baseCents) {
        throw new BlueprintResolutionError('LINE_ITEMS_TOTAL_MISMATCH', `creditLineItemsPath "${group.creditLineItemsPath}" items total ${centsToDollars(totalCents)} but baseAmountPath "${group.baseAmountPath}" resolved to ${centsToDollars(baseCents)}.`);
      }
      lines.push(...itemLines);
    } else {
      const crCents = allocateCents(baseCents, group.creditAllocations.map((a) => a.bp));
      group.creditAllocations.forEach((alloc, i) => {
        lines.push({
          accountNumber: alloc.accountNumber,
          storeId: alloc.storeId,
          deptCode: alloc.deptCode ?? null,
          dr: 0,
          cr: centsToDollars(crCents[i]),
          memo,
          controlNumber: resolveOptionalStringPath(alloc.controlNumberPath, envelope),
          applyNumber: resolveOptionalStringPath(alloc.applyNumberPath, envelope),
        });
      });
    }
  }
  return lines;
}

const TEMPLATE_PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function resolveMemoTemplate(template: string | null | undefined, envelope: SourceEventEnvelope): string | null {
  if (!template) return null;
  return template.replace(TEMPLATE_PLACEHOLDER, (_match, path: string) => {
    const v = resolveEnvelopePath(envelope, path);
    return v === undefined || v === null ? '' : String(v);
  });
}

export interface BlueprintViolation {
  code: string;
  lineIndex?: number;
  message: string;
}

/**
 * Defensive re-verification of an already-generated blueprint (BR S020-11).
 * Runs even though generateBlueprint() should always produce a balanced
 * result — this is the belt-and-suspenders check the story requires before
 * anything is submitted to the accepted posting path.
 */
export function verifyBlueprint(lines: BlueprintLine[]): BlueprintViolation[] {
  const violations: BlueprintViolation[] = [];
  if (lines.length === 0) {
    violations.push({ code: 'EMPTY_BLUEPRINT', message: 'Blueprint has no lines.' });
    return violations;
  }
  let totalDr = 0;
  let totalCr = 0;
  let hasDebit = false;
  let hasCredit = false;
  lines.forEach((line, i) => {
    const drC = toCents(line.dr);
    const crC = toCents(line.cr);
    if (drC > 0 && crC > 0) violations.push({ code: 'LINE_BOTH_SIDES', lineIndex: i, message: 'Line has both a debit and a credit.' });
    if (drC === 0 && crC === 0) violations.push({ code: 'ZERO_VALUE_LINE', lineIndex: i, message: 'Line has a zero value on both sides.' });
    if (drC > 0) hasDebit = true;
    if (crC > 0) hasCredit = true;
    totalDr += drC;
    totalCr += crC;
    if (!line.storeId) violations.push({ code: 'MISSING_STORE_ID', lineIndex: i, message: 'Line is missing a storeId dimension.' });
  });
  if (!hasDebit) violations.push({ code: 'NO_DEBIT_LINE', message: 'Blueprint has no debit line.' });
  if (!hasCredit) violations.push({ code: 'NO_CREDIT_LINE', message: 'Blueprint has no credit line.' });
  if (totalDr !== totalCr) {
    violations.push({ code: 'UNBALANCED_BLUEPRINT', message: `Debit total (${centsToDollars(totalDr)}) does not equal credit total (${centsToDollars(totalCr)}).` });
  }
  return violations;
}

/** Stable hash over the resolved lines + selected rule identity — used for traceability, not for idempotency (that's the event hash's job). */
export function hashBlueprint(ruleId: string, lines: BlueprintLine[]): string {
  return crypto.createHash('sha256').update(canonicalStringify({ ruleId, lines })).digest('hex');
}
