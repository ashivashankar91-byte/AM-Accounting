// S019 — Posting DSL v1: declarative JSON rule-pack shape.
//
// Pure type definitions + structural (shape-only) parsing. No JavaScript/
// TypeScript execution, no SQL, no network/DB calls, no current-time or
// random functions can appear here — the condition grammar below is a
// closed set of operators (domain/posting-engine/conditions.ts), and
// amounts are resolved from the event envelope, never invented at
// evaluation time. See domain/posting-engine/validator.ts for semantic
// validation (this file only defines shapes + a structural parse).

export const DSL_VERSION = 1;
export const SUPPORTED_MATCH_STRATEGIES = ['FIRST_MATCH'] as const;
export const SUPPORTED_NO_MATCH_BEHAVIORS = ['NO_RULE_MATCH_EXCEPTION'] as const;

export type MatchStrategy = (typeof SUPPORTED_MATCH_STRATEGIES)[number];
export type NoMatchBehavior = (typeof SUPPORTED_NO_MATCH_BEHAVIORS)[number];

export type JsonPrimitive = string | number | boolean | null;

// ── Condition grammar (S019 minimum operator set) ────────────────────────────

export type ConditionExpr =
  | { and: ConditionExpr[] }
  | { or: ConditionExpr[] }
  | { not: ConditionExpr }
  | { equals: { path: string; value: JsonPrimitive } }
  | { notEquals: { path: string; value: JsonPrimitive } }
  | { greaterThan: { path: string; value: number } }
  | { greaterThanOrEqual: { path: string; value: number } }
  | { lessThan: { path: string; value: number } }
  | { lessThanOrEqual: { path: string; value: number } }
  | { in: { path: string; values: JsonPrimitive[] } }
  | { notIn: { path: string; values: JsonPrimitive[] } }
  | { exists: { path: string } }
  | { isNull: { path: string } }
  | { isNotNull: { path: string } };

export const CONDITION_OPERATORS = [
  'and', 'or', 'not', 'equals', 'notEquals', 'greaterThan', 'greaterThanOrEqual',
  'lessThan', 'lessThanOrEqual', 'in', 'notIn', 'exists', 'isNull', 'isNotNull',
] as const;

// ── Posting groups (balance-safe, basis-point allocation) ────────────────────

export const BP_TOTAL = 10_000;

export interface PostingAllocation {
  /** Account number, resolved against the pack's entityId via GlAccount (BR210-1 uniqueness). */
  accountNumber: string;
  /** Fixed store dimension (BR013-5). v1 does not support event-driven store resolution. */
  storeId: string;
  /** Required when the resolved account is a P&L type (REVENUE/EXPENSE) — BR013-5. */
  deptCode?: string | null;
  /** Basis points of the group's base amount allocated to this line. Must be > 0. */
  bp: number;
}

export interface PostingGroup {
  groupId: string;
  /** Canonical path into the event envelope resolving to a decimal amount (dollars). */
  baseAmountPath: string;
  /**
   * Exactly one of `debitAllocations` (non-empty) or `debitLineItemsPath`
   * must be set — never both. `debitAllocations` covers the common case
   * (a fixed, rule-authored set of accounts). `debitLineItemsPath` covers
   * source events whose debit side is inherently dynamic per-occurrence
   * (e.g. an AP invoice with N lines, each independently GL-coded) — see
   * CE-07 Requirement C: apar-service's AP invoice liability posting has
   * exactly this shape and cannot be expressed as a fixed allocation set.
   */
  debitAllocations: PostingAllocation[];
  /**
   * Canonical path into the event envelope resolving to a non-empty array
   * of `{accountNumber: string, storeId: string, deptCode?: string|null,
   * amount: number|string}` items. Each item becomes exactly one debit
   * line at its own dollar amount (never basis-point allocated — the
   * event itself already carries the exact per-line amount). The sum of
   * all item amounts must equal the group's baseAmountPath-resolved total
   * (enforced at blueprint-generation time via LINE_ITEMS_TOTAL_MISMATCH),
   * keeping the balance invariant identical to the fixed-allocation case.
   * Per-item account existence/postability/deptCode can only be checked at
   * posting time (INVALID_ACCOUNT/MISSING_DEPT_CODE), never at rule-pack
   * validate/activate time, since the accounts are event-driven, not
   * rule-authored — a documented, narrower validation guarantee than the
   * fixed-allocation path.
   */
  debitLineItemsPath?: string | null;
  /**
   * Mirrors `debitLineItemsPath` for the credit side — e.g. an AP invoice
   * whose liability account varies per-vendor (`Vendor.defaultGlAccount`),
   * not a single tenant-wide fixed account. Exactly one of
   * `creditAllocations` (non-empty) or `creditLineItemsPath` must be set.
   */
  creditAllocations: PostingAllocation[];
  creditLineItemsPath?: string | null;
}

export interface JournalBlueprintDefinition {
  /** Optional memo template. `{{path}}` placeholders resolve against the event envelope. */
  memoTemplate?: string | null;
  postingGroups: PostingGroup[];
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export interface RuleDefinition {
  ruleId: string;
  /** Deterministic priority — lower value evaluates first. Must be unique within a pack version. */
  priority: number;
  description: string;
  /** null/omitted = unconditional (always matches). */
  condition?: ConditionExpr | null;
  blueprint: JournalBlueprintDefinition;
}

// ── Rule pack (top level) ────────────────────────────────────────────────────

export interface RulePackDefinition {
  dslVersion: number;
  packKey: string;
  semver: string;
  eventType: string;
  supportedEventSchemaVersions: string[];
  /** Tenant this pack version is scoped to (must equal the authenticated tenant). */
  tenantScope: string;
  /** Legal entity this pack posts into (GlAccount / FiscalPeriod are entity-scoped). */
  entityId: string;
  effectiveFrom: string; // ISO 8601
  effectiveTo?: string | null; // ISO 8601
  journalSourceCode: string;
  matchStrategy: MatchStrategy;
  noMatchBehavior: NoMatchBehavior;
  rules: RuleDefinition[];
}

/** The set of top-level keys a v1 rule pack may contain — anything else is UNKNOWN_FIELD. */
export const RULE_PACK_TOP_LEVEL_FIELDS = [
  'dslVersion', 'packKey', 'semver', 'eventType', 'supportedEventSchemaVersions',
  'tenantScope', 'entityId', 'effectiveFrom', 'effectiveTo', 'journalSourceCode',
  'matchStrategy', 'noMatchBehavior', 'rules',
] as const;

export const RULE_FIELDS = ['ruleId', 'priority', 'description', 'condition', 'blueprint'] as const;
export const BLUEPRINT_FIELDS = ['memoTemplate', 'postingGroups'] as const;
export const POSTING_GROUP_FIELDS = ['groupId', 'baseAmountPath', 'debitAllocations', 'debitLineItemsPath', 'creditAllocations', 'creditLineItemsPath'] as const;
export const ALLOCATION_FIELDS = ['accountNumber', 'storeId', 'deptCode', 'bp'] as const;
