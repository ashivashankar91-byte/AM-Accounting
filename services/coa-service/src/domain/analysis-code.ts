// S011 — Analysis Codes and Accounting Dimensions (P01, confirmed slice).
// Pure domain helpers: no I/O, no Prisma. Mirrors the shape of
// domain/draft.ts (attachment admission) — small, testable, side-effect-free
// functions the application layer calls before/around persistence.
//
// AMD-005/accumulator-adjacent behavior (SES-3) is explicitly out of scope —
// nothing here concerns unit counts, statistics, or any accumulator concept.

/**
 * BR011-2 — "0..N analysis tags (proposed cap 3)". The Story Contract's own
 * text marks the cap `DECISION_REQUIRED` (BLK-13, owner PO); no PO decision
 * has been recorded in this repository, so the documented *proposed default*
 * is applied here, not invented independently. This constant is the single
 * source of truth for the cap so the decision can be revisited in one place
 * once Product confirms it.
 */
export const MAX_TAGS_PER_LINE = 3;

/** A single analysis tag reference on a line, as accepted by draft/post payloads. */
export interface AnalysisTagInput {
  typeId: string;
  valueId: string;
}

export interface AnalysisTagValidationContext {
  /** Active AnalysisCodeType rows for the tenant, keyed by id. */
  types: Map<string, { id: string; isActive: boolean }>;
  /** Active/inactive AnalysisCodeValue rows for the tenant, keyed by id. */
  values: Map<string, { id: string; typeId: string; isActive: boolean }>;
}

export type AnalysisTagViolationCode =
  | 'TAG_CAP_EXCEEDED'
  | 'DUPLICATE_TYPE_ON_LINE'
  | 'UNKNOWN_TYPE'
  | 'UNKNOWN_VALUE'
  | 'INACTIVE_TYPE'
  | 'INACTIVE_VALUE'
  | 'VALUE_TYPE_MISMATCH';

export interface AnalysisTagViolation {
  lineIndex?: number;
  rule: AnalysisTagViolationCode;
  message: string;
  typeId?: string;
  valueId?: string;
}

/**
 * BR011-1/BR011-4 — validate one line's tag set against the tenant's active
 * registry. Fails closed: an unknown/inactive type or value, a duplicate
 * type on the same line, or more than MAX_TAGS_PER_LINE tags is rejected
 * with a rule-referenced violation (AC011-2's "rule-referenced rejection").
 * Historical lines are never re-validated (BR011-4's "remain on history" —
 * this function is only ever called at tag-creation time, i.e. when a NEW
 * line is being posted).
 */
export function validateLineTags(
  tags: AnalysisTagInput[] | undefined,
  ctx: AnalysisTagValidationContext,
  lineIndex?: number,
): AnalysisTagViolation[] {
  const violations: AnalysisTagViolation[] = [];
  const list = tags ?? [];
  if (list.length === 0) return violations;

  if (list.length > MAX_TAGS_PER_LINE) {
    violations.push({
      lineIndex,
      rule: 'TAG_CAP_EXCEEDED',
      message: `A line may carry at most ${MAX_TAGS_PER_LINE} analysis tags (proposed default, BLK-13); ${list.length} were supplied.`,
    });
  }

  const seenTypes = new Set<string>();
  for (const tag of list) {
    if (seenTypes.has(tag.typeId)) {
      violations.push({
        lineIndex,
        rule: 'DUPLICATE_TYPE_ON_LINE',
        message: `Type ${tag.typeId} is tagged more than once on the same line; a line may carry at most one value per type.`,
        typeId: tag.typeId,
      });
      continue;
    }
    seenTypes.add(tag.typeId);

    const type = ctx.types.get(tag.typeId);
    if (!type) {
      violations.push({ lineIndex, rule: 'UNKNOWN_TYPE', message: `Analysis code type ${tag.typeId} does not exist for this tenant.`, typeId: tag.typeId });
      continue;
    }
    if (!type.isActive) {
      violations.push({ lineIndex, rule: 'INACTIVE_TYPE', message: `Analysis code type ${tag.typeId} is inactive.`, typeId: tag.typeId });
      continue;
    }

    const value = ctx.values.get(tag.valueId);
    if (!value) {
      violations.push({ lineIndex, rule: 'UNKNOWN_VALUE', message: `Analysis code value ${tag.valueId} does not exist for this tenant.`, valueId: tag.valueId });
      continue;
    }
    if (value.typeId !== tag.typeId) {
      violations.push({
        lineIndex,
        rule: 'VALUE_TYPE_MISMATCH',
        message: `Value ${tag.valueId} does not belong to type ${tag.typeId}.`,
        typeId: tag.typeId,
        valueId: tag.valueId,
      });
      continue;
    }
    // BR011-4 — inactive values reject on NEW lines only.
    if (!value.isActive) {
      violations.push({ lineIndex, rule: 'INACTIVE_VALUE', message: `Analysis code value ${tag.valueId} is inactive and cannot be used on a new line.`, typeId: tag.typeId, valueId: tag.valueId });
    }
  }

  return violations;
}

/** Code format shared by both types and values: 1-20 chars, tenant-defined (no reserved ranges, unlike department codes). */
export function isValidAnalysisCode(code: string): boolean {
  return typeof code === 'string' && code.trim().length > 0 && code.trim().length <= 20;
}
