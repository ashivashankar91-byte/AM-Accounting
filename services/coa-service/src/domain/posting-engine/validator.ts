// S019 — Structural, semantic and static-balance validator for the Posting
// DSL v1. Produces structured findings; never throws for a malformed rule
// pack (a parse failure becomes an ERROR finding, not an exception) so the
// backend can always render "why this draft doesn't validate" to the user.

import {
  RulePackDefinition, RuleDefinition, ConditionExpr,
  RULE_PACK_TOP_LEVEL_FIELDS, RULE_FIELDS, BLUEPRINT_FIELDS, POSTING_GROUP_FIELDS, ALLOCATION_FIELDS,
  CONDITION_OPERATORS, DSL_VERSION, SUPPORTED_MATCH_STRATEGIES, SUPPORTED_NO_MATCH_BEHAVIORS, BP_TOTAL,
} from './dsl';
import { parseStrictJson, StrictJsonParseError } from './strict-json';

export type FindingSeverity = 'ERROR' | 'WARNING';

export interface ValidationFinding {
  severity: FindingSeverity;
  code: string;
  path: string; // JSON-path-like pointer, e.g. "$.rules[2].blueprint.postingGroups[0]"
  ruleId?: string;
  message: string;
}

export interface AccountRef {
  accountNumber: string;
  type: string;
  postable: boolean;
  status: string;
}

/** Injected account-lookup — the validator never touches Prisma directly (BR S019-15: "through supported application/service contracts"). */
export type AccountLookup = (entityId: string, accountNumber: string) => Promise<AccountRef | null>;

export interface ValidationResult {
  valid: boolean;
  findings: ValidationFinding[];
  pack?: RulePackDefinition;
}

function err(findings: ValidationFinding[], code: string, path: string, message: string, ruleId?: string) {
  findings.push({ severity: 'ERROR', code, path, message, ...(ruleId ? { ruleId } : {}) });
}
function warn(findings: ValidationFinding[], code: string, path: string, message: string, ruleId?: string) {
  findings.push({ severity: 'WARNING', code, path, message, ...(ruleId ? { ruleId } : {}) });
}

const ALLOWED_PATH_ROOTS = [
  'eventId', 'tenantId', 'eventType', 'eventSchemaVersion', 'occurredAt', 'publishedAt',
  'sourceSystem', 'sourceEntityType', 'sourceEntityId', 'correlationId', 'causationId',
  'businessDate', 'payload', 'metadata',
];

function isAllowedPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0) return false;
  const root = path.split('.')[0];
  return ALLOWED_PATH_ROOTS.includes(root);
}

const EVENT_TYPE_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)*\.v[0-9]+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

function validateConditionShape(expr: unknown, path: string, findings: ValidationFinding[], ruleId: string): void {
  if (typeof expr !== 'object' || expr === null || Array.isArray(expr)) {
    err(findings, 'INVALID_CONDITION_SHAPE', path, 'Condition must be an object with exactly one operator key.', ruleId);
    return;
  }
  const keys = Object.keys(expr as Record<string, unknown>);
  if (keys.length !== 1) {
    err(findings, 'INVALID_CONDITION_SHAPE', path, 'Condition object must have exactly one operator key.', ruleId);
    return;
  }
  const op = keys[0];
  if (!(CONDITION_OPERATORS as readonly string[]).includes(op)) {
    err(findings, 'UNSUPPORTED_OPERATOR', `${path}.${op}`, `Unsupported condition operator "${op}".`, ruleId);
    return;
  }
  const body = (expr as Record<string, unknown>)[op];
  if (op === 'and' || op === 'or') {
    if (!Array.isArray(body) || body.length === 0) {
      err(findings, 'INVALID_CONDITION_SHAPE', `${path}.${op}`, `"${op}" requires a non-empty array of conditions.`, ruleId);
      return;
    }
    body.forEach((c, i) => validateConditionShape(c, `${path}.${op}[${i}]`, findings, ruleId));
    return;
  }
  if (op === 'not') {
    validateConditionShape(body, `${path}.not`, findings, ruleId);
    return;
  }
  if (op === 'exists' || op === 'isNull' || op === 'isNotNull') {
    const b = body as { path?: unknown };
    if (!isAllowedPath(b?.path)) err(findings, 'INVALID_EVENT_PATH', `${path}.${op}.path`, `"${op}" has an invalid or missing event path.`, ruleId);
    return;
  }
  if (op === 'in' || op === 'notIn') {
    const b = body as { path?: unknown; values?: unknown };
    if (!isAllowedPath(b?.path)) err(findings, 'INVALID_EVENT_PATH', `${path}.${op}.path`, `"${op}" has an invalid or missing event path.`, ruleId);
    if (!Array.isArray(b?.values) || b.values.length === 0) err(findings, 'INVALID_CONDITION_SHAPE', `${path}.${op}.values`, `"${op}" requires a non-empty values array.`, ruleId);
    return;
  }
  // equals/notEquals/greaterThan/greaterThanOrEqual/lessThan/lessThanOrEqual
  const b = body as { path?: unknown; value?: unknown };
  if (!isAllowedPath(b?.path)) err(findings, 'INVALID_EVENT_PATH', `${path}.${op}.path`, `"${op}" has an invalid or missing event path.`, ruleId);
  if (b?.value === undefined) err(findings, 'INVALID_CONDITION_SHAPE', `${path}.${op}.value`, `"${op}" requires a comparison value.`, ruleId);
  if ((op === 'greaterThan' || op === 'greaterThanOrEqual' || op === 'lessThan' || op === 'lessThanOrEqual') && typeof b?.value !== 'number') {
    err(findings, 'INVALID_CONDITION_SHAPE', `${path}.${op}.value`, `"${op}" requires a numeric comparison value.`, ruleId);
  }
}

function unknownFieldFindings(obj: Record<string, unknown>, allowed: readonly string[], path: string, findings: ValidationFinding[], ruleId?: string) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) err(findings, 'UNKNOWN_FIELD', `${path}.${key}`, `Unknown field "${key}" is not permitted in the Posting DSL v1.`, ruleId);
  }
}

/**
 * Parse + fully validate a rule-pack source document.
 * `authenticatedTenantId` is the caller's real tenant context (never trust
 * the document's own `tenantScope` claim without cross-checking it).
 */
export async function validateRulePackSource(
  source: string,
  authenticatedTenantId: string,
  accountLookup: AccountLookup,
): Promise<ValidationResult> {
  const findings: ValidationFinding[] = [];

  let raw: unknown;
  try {
    raw = parseStrictJson(source);
  } catch (e) {
    const msg = e instanceof StrictJsonParseError ? e.message : String((e as Error).message ?? e);
    err(findings, 'JSON_PARSE_ERROR', '$', `Rule pack is not valid strict JSON: ${msg}`);
    return { valid: false, findings };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    err(findings, 'INVALID_ROOT_SHAPE', '$', 'Rule pack document must be a JSON object.');
    return { valid: false, findings };
  }
  const doc = raw as Record<string, unknown>;
  unknownFieldFindings(doc, RULE_PACK_TOP_LEVEL_FIELDS, '$', findings);

  if (doc['dslVersion'] !== DSL_VERSION) {
    err(findings, 'UNSUPPORTED_DSL_VERSION', '$.dslVersion', `dslVersion must be ${DSL_VERSION}.`);
  }
  if (typeof doc['packKey'] !== 'string' || doc['packKey'].trim() === '') {
    err(findings, 'MISSING_PACK_KEY', '$.packKey', 'packKey is required.');
  }
  if (typeof doc['semver'] !== 'string' || !SEMVER_PATTERN.test(doc['semver'])) {
    err(findings, 'INVALID_SEMVER', '$.semver', 'semver must be MAJOR.MINOR.PATCH.');
  }
  if (typeof doc['eventType'] !== 'string' || !EVENT_TYPE_PATTERN.test(doc['eventType'])) {
    err(findings, 'INVALID_EVENT_TYPE', '$.eventType', 'eventType must look like "a.b.c.vN".');
  }
  if (!Array.isArray(doc['supportedEventSchemaVersions']) || doc['supportedEventSchemaVersions'].length === 0
    || !doc['supportedEventSchemaVersions'].every((v) => typeof v === 'string' && v.trim() !== '')) {
    err(findings, 'MISSING_EVENT_SCHEMA_VERSIONS', '$.supportedEventSchemaVersions', 'supportedEventSchemaVersions must be a non-empty array of strings.');
  }
  if (typeof doc['tenantScope'] !== 'string' || doc['tenantScope'].trim() === '') {
    err(findings, 'MISSING_TENANT_SCOPE', '$.tenantScope', 'tenantScope is required.');
  } else if (doc['tenantScope'] !== authenticatedTenantId) {
    err(findings, 'TENANT_SCOPE_MISMATCH', '$.tenantScope', 'tenantScope does not match the authenticated tenant.');
  }
  if (typeof doc['entityId'] !== 'string' || doc['entityId'].trim() === '') {
    err(findings, 'MISSING_ENTITY_ID', '$.entityId', 'entityId is required.');
  }
  let effectiveFromDate: Date | null = null;
  let effectiveToDate: Date | null = null;
  if (typeof doc['effectiveFrom'] !== 'string' || Number.isNaN(Date.parse(doc['effectiveFrom']))) {
    err(findings, 'INVALID_EFFECTIVE_FROM', '$.effectiveFrom', 'effectiveFrom must be a valid ISO 8601 date/time.');
  } else {
    effectiveFromDate = new Date(doc['effectiveFrom']);
  }
  if (doc['effectiveTo'] !== undefined && doc['effectiveTo'] !== null) {
    if (typeof doc['effectiveTo'] !== 'string' || Number.isNaN(Date.parse(doc['effectiveTo'] as string))) {
      err(findings, 'INVALID_EFFECTIVE_TO', '$.effectiveTo', 'effectiveTo must be a valid ISO 8601 date/time when present.');
    } else {
      effectiveToDate = new Date(doc['effectiveTo'] as string);
    }
  }
  if (effectiveFromDate && effectiveToDate && effectiveToDate <= effectiveFromDate) {
    err(findings, 'INVALID_EFFECTIVE_RANGE', '$.effectiveTo', 'effectiveTo must be after effectiveFrom.');
  }
  if (typeof doc['journalSourceCode'] !== 'string' || doc['journalSourceCode'].trim() === '') {
    err(findings, 'MISSING_JOURNAL_SOURCE', '$.journalSourceCode', 'journalSourceCode is required.');
  }
  if (!(SUPPORTED_MATCH_STRATEGIES as readonly string[]).includes(doc['matchStrategy'] as string)) {
    err(findings, 'UNSUPPORTED_MATCH_STRATEGY', '$.matchStrategy', `matchStrategy must be one of: ${SUPPORTED_MATCH_STRATEGIES.join(', ')}.`);
  }
  if (!(SUPPORTED_NO_MATCH_BEHAVIORS as readonly string[]).includes(doc['noMatchBehavior'] as string)) {
    err(findings, 'UNSUPPORTED_NO_MATCH_BEHAVIOR', '$.noMatchBehavior', `noMatchBehavior must be one of: ${SUPPORTED_NO_MATCH_BEHAVIORS.join(', ')}.`);
  }

  if (!Array.isArray(doc['rules']) || doc['rules'].length === 0) {
    err(findings, 'MISSING_RULES', '$.rules', 'At least one rule is required.');
    return { valid: findings.every((f) => f.severity !== 'ERROR'), findings };
  }

  const seenRuleIds = new Set<string>();
  const priorityToRuleIds = new Map<number, string[]>();
  const entityId = typeof doc['entityId'] === 'string' ? doc['entityId'] : '';

  const rules = doc['rules'] as unknown[];
  for (let i = 0; i < rules.length; i++) {
    const rulePath = `$.rules[${i}]`;
    const r = rules[i];
    if (typeof r !== 'object' || r === null || Array.isArray(r)) {
      err(findings, 'INVALID_RULE_SHAPE', rulePath, 'Each rule must be an object.');
      continue;
    }
    const robj = r as Record<string, unknown>;
    const ruleId = typeof robj['ruleId'] === 'string' ? robj['ruleId'] : `(index ${i})`;
    unknownFieldFindings(robj, RULE_FIELDS, rulePath, findings, ruleId);

    if (typeof robj['ruleId'] !== 'string' || robj['ruleId'].trim() === '') {
      err(findings, 'MISSING_RULE_ID', `${rulePath}.ruleId`, 'ruleId is required.', ruleId);
    } else {
      if (seenRuleIds.has(robj['ruleId'])) {
        err(findings, 'DUPLICATE_RULE_ID', `${rulePath}.ruleId`, `Duplicate ruleId "${robj['ruleId']}".`, ruleId);
      }
      seenRuleIds.add(robj['ruleId']);
    }
    if (!Number.isInteger(robj['priority'])) {
      err(findings, 'INVALID_PRIORITY', `${rulePath}.priority`, 'priority must be an integer.', ruleId);
    } else {
      const list = priorityToRuleIds.get(robj['priority'] as number) ?? [];
      list.push(ruleId);
      priorityToRuleIds.set(robj['priority'] as number, list);
    }
    if (typeof robj['description'] !== 'string' || robj['description'].trim() === '') {
      err(findings, 'MISSING_DESCRIPTION', `${rulePath}.description`, 'description is required.', ruleId);
    }
    if (robj['condition'] !== undefined && robj['condition'] !== null) {
      validateConditionShape(robj['condition'], `${rulePath}.condition`, findings, ruleId);
    }

    if (typeof robj['blueprint'] !== 'object' || robj['blueprint'] === null || Array.isArray(robj['blueprint'])) {
      err(findings, 'MISSING_BLUEPRINT', `${rulePath}.blueprint`, 'blueprint is required.', ruleId);
      continue;
    }
    const blueprint = robj['blueprint'] as Record<string, unknown>;
    unknownFieldFindings(blueprint, BLUEPRINT_FIELDS, `${rulePath}.blueprint`, findings, ruleId);
    if (blueprint['memoTemplate'] !== undefined && blueprint['memoTemplate'] !== null) {
      if (typeof blueprint['memoTemplate'] !== 'string') {
        err(findings, 'INVALID_MEMO_TEMPLATE', `${rulePath}.blueprint.memoTemplate`, 'memoTemplate must be a string.', ruleId);
      } else {
        for (const m of blueprint['memoTemplate'].matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) {
          if (!isAllowedPath(m[1])) {
            err(findings, 'INVALID_TEMPLATE_PLACEHOLDER', `${rulePath}.blueprint.memoTemplate`, `Template placeholder "{{${m[1]}}}" references a disallowed path.`, ruleId);
          }
        }
      }
    }

    if (!Array.isArray(blueprint['postingGroups']) || blueprint['postingGroups'].length === 0) {
      err(findings, 'MISSING_POSTING_GROUPS', `${rulePath}.blueprint.postingGroups`, 'At least one posting group is required.', ruleId);
      continue;
    }
    const groups = blueprint['postingGroups'] as unknown[];
    for (let g = 0; g < groups.length; g++) {
      const groupPath = `${rulePath}.blueprint.postingGroups[${g}]`;
      const group = groups[g];
      if (typeof group !== 'object' || group === null || Array.isArray(group)) {
        err(findings, 'INVALID_POSTING_GROUP_SHAPE', groupPath, 'Each posting group must be an object.', ruleId);
        continue;
      }
      const gobj = group as Record<string, unknown>;
      unknownFieldFindings(gobj, POSTING_GROUP_FIELDS, groupPath, findings, ruleId);
      if (typeof gobj['groupId'] !== 'string' || gobj['groupId'].trim() === '') {
        err(findings, 'MISSING_GROUP_ID', `${groupPath}.groupId`, 'groupId is required.', ruleId);
      }
      if (!isAllowedPath(gobj['baseAmountPath'])) {
        err(findings, 'INVALID_EVENT_PATH', `${groupPath}.baseAmountPath`, 'baseAmountPath is missing or references a disallowed path.', ruleId);
      }

      const sides: Array<['debitAllocations' | 'creditAllocations', string]> = [
        ['debitAllocations', 'debit'], ['creditAllocations', 'credit'],
      ];
      for (const [field, label] of sides) {
        const allocations = gobj[field];
        if (!Array.isArray(allocations) || allocations.length === 0) {
          err(findings, `MISSING_${label.toUpperCase()}_ALLOCATION`, `${groupPath}.${field}`, `At least one ${label} allocation is required.`, ruleId);
          continue;
        }
        let bpSum = 0;
        for (let a = 0; a < allocations.length; a++) {
          const allocPath = `${groupPath}.${field}[${a}]`;
          const alloc = allocations[a];
          if (typeof alloc !== 'object' || alloc === null || Array.isArray(alloc)) {
            err(findings, 'INVALID_ALLOCATION_SHAPE', allocPath, 'Each allocation must be an object.', ruleId);
            continue;
          }
          const aobj = alloc as Record<string, unknown>;
          unknownFieldFindings(aobj, ALLOCATION_FIELDS, allocPath, findings, ruleId);
          if (typeof aobj['accountNumber'] !== 'string' || aobj['accountNumber'].trim() === '') {
            err(findings, 'MISSING_ACCOUNT_NUMBER', `${allocPath}.accountNumber`, 'accountNumber is required.', ruleId);
          }
          if (typeof aobj['storeId'] !== 'string' || aobj['storeId'].trim() === '') {
            err(findings, 'MISSING_STORE_ID', `${allocPath}.storeId`, 'storeId is required.', ruleId);
          }
          if (aobj['deptCode'] !== undefined && aobj['deptCode'] !== null && typeof aobj['deptCode'] !== 'string') {
            err(findings, 'INVALID_DEPT_CODE', `${allocPath}.deptCode`, 'deptCode must be a string when present.', ruleId);
          }
          if (!Number.isInteger(aobj['bp']) || (aobj['bp'] as number) <= 0) {
            err(findings, 'INVALID_ALLOCATION_BP', `${allocPath}.bp`, 'bp must be a positive integer.', ruleId);
          } else {
            bpSum += aobj['bp'] as number;
          }

          // BR S019-15 — account reference + dimension validation via the accepted lookup contract.
          if (typeof aobj['accountNumber'] === 'string' && aobj['accountNumber'].trim() !== '' && entityId) {
            // eslint-disable-next-line no-await-in-loop
            const account = await accountLookup(entityId, aobj['accountNumber']);
            if (!account) {
              err(findings, 'ACCOUNT_NOT_FOUND', `${allocPath}.accountNumber`, `Account ${aobj['accountNumber']} was not found for entity ${entityId}.`, ruleId);
            } else {
              if (!account.postable) err(findings, 'ACCOUNT_NOT_POSTABLE', `${allocPath}.accountNumber`, `Account ${aobj['accountNumber']} is not postable.`, ruleId);
              if (account.status !== 'ACTIVE') err(findings, 'ACCOUNT_NOT_ACTIVE', `${allocPath}.accountNumber`, `Account ${aobj['accountNumber']} is not ACTIVE.`, ruleId);
              if ((account.type === 'REVENUE' || account.type === 'EXPENSE') && (!aobj['deptCode'] || String(aobj['deptCode']).trim() === '')) {
                err(findings, 'MISSING_DEPT_CODE', `${allocPath}.deptCode`, `P&L account ${aobj['accountNumber']} (${account.type}) requires a deptCode.`, ruleId);
              }
            }
          }
        }
        if (allocations.length > 0 && bpSum !== BP_TOTAL) {
          err(findings, `${label.toUpperCase()}_BP_NOT_10000`, `${groupPath}.${field}`, `${label} allocation basis points must total exactly ${BP_TOTAL}; found ${bpSum}.`, ruleId);
        }
      }
    }
  }

  for (const [priority, ids] of priorityToRuleIds) {
    if (ids.length > 1) {
      for (const ruleId of ids) {
        err(findings, 'AMBIGUOUS_PRIORITY', '$.rules', `Priority ${priority} is used by more than one rule: ${ids.join(', ')}.`, ruleId);
      }
    }
  }

  const valid = findings.every((f) => f.severity !== 'ERROR');
  if (!valid) return { valid, findings };

  return { valid: true, findings, pack: doc as unknown as RulePackDefinition };
}
