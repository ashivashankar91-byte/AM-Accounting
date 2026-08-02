/**
 * CE-16 / S130 — Transformation engine.
 *
 * Applies a pinned mapping-set version to raw source rows, producing staged
 * rows. Contract:
 *
 *   * Deterministic — same source row + same mapping version ⇒ byte-identical
 *     staged output and identical row hash. No clock reads, no randomness,
 *     no ambient state.
 *   * Version-pinned — the mapping version used is embedded in every staged
 *     row's lineage; re-running with a different version yields a different
 *     transformation version stamp, never a silent in-place change.
 *   * Never invents legacy field meanings — a source value with no ALIGN/MAP/
 *     DIVERGE decision produces an exception, not a guess.
 *   * Idempotent — the row hash is a pure function of (sourceIdentity, mapped
 *     payload, transformationVersion), so a rerun collides on the staging
 *     unique index instead of double-loading.
 */

import { createHash } from 'crypto';

export type MappingClassification = 'ALIGN' | 'MAP' | 'DIVERGE';

export interface MappingDecision {
  id: string;
  sourceField: string;
  sourceValue: string;
  targetField: string | null;
  targetValue: string | null;
  classification: MappingClassification | null;
  status: 'MAPPED' | 'EXCLUDED' | 'MANUAL_REVIEW_REQUIRED';
}

export interface PinnedMappingSet {
  id: string;
  version: number;
  /** Frozen mapping sets are immutable and are the only ones usable for staging. */
  status: 'DRAFT' | 'FROZEN';
  entries: MappingDecision[];
}

export interface SourceRowInput {
  id: string;
  rowIndex: number;
  rawData: Record<string, unknown>;
}

export type TransformExceptionType =
  | 'AMBIGUOUS'
  | 'INVALID'
  | 'UNMAPPED'
  | 'DUPLICATE'
  | 'CONSERVATION_FAILED'
  | 'MAPPING_INCOMPLETE';

export interface TransformException {
  sourceRowId: string;
  exceptionType: TransformExceptionType;
  sourceField: string | null;
  sourceValue: string | null;
  reason: string;
  evidence: Record<string, unknown>;
}

export interface TransformedRow {
  sourceRowId: string;
  rowHash: string;
  stagedData: Record<string, unknown>;
  validationErrors: string[];
  lineageRef: {
    sourceRowRef: string;
    mappingSetId: string;
    mappingDecisionRefs: string[];
    transformationVersion: string;
  };
}

export interface TransformResult {
  rows: TransformedRow[];
  exceptions: TransformException[];
  transformationVersion: string;
}

export class MappingSetNotFrozenError extends Error {
  readonly code = 'MAPPING_SET_NOT_FROZEN';
  constructor(mappingSetId: string) {
    super(`Mapping set ${mappingSetId} must be FROZEN before it can be used for staging`);
    this.name = 'MappingSetNotFrozenError';
  }
}

/**
 * Stable stringify — key order must not depend on insertion order, otherwise
 * "same input ⇒ same hash" quietly stops holding for objects built by
 * different code paths.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

export function computeRowHash(
  sourceIdentity: string,
  payload: Record<string, unknown>,
  transformationVersion: string,
): string {
  return createHash('sha256')
    .update(`${transformationVersion}\u0000${sourceIdentity}\u0000${stableStringify(payload)}`)
    .digest('hex');
}

/** Hash of a raw source row — the extract-side idempotency key. */
export function computeSourceRowHash(rawData: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(rawData)).digest('hex');
}

export function buildTransformationVersion(mappingSet: PinnedMappingSet, engineVersion = 'ce16.v1'): string {
  return `${engineVersion}:mapping-${mappingSet.id}:v${mappingSet.version}`;
}

interface DecisionIndex {
  byFieldValue: Map<string, MappingDecision[]>;
}

function indexDecisions(entries: MappingDecision[]): DecisionIndex {
  const byFieldValue = new Map<string, MappingDecision[]>();
  for (const entry of entries) {
    const key = `${entry.sourceField}\u0000${entry.sourceValue}`;
    const list = byFieldValue.get(key) ?? [];
    list.push(entry);
    byFieldValue.set(key, list);
  }
  return { byFieldValue };
}

/** Fields carried through untouched — they are identity, not accounting meaning. */
export const PASSTHROUGH_FIELDS = new Set([
  'sourceIdentity',
  'documentRef',
  'documentDate',
  'dueDate',
  'debit',
  'credit',
  'amount',
  'openItemAmount',
  'currency',
  'agingBucket',
  'description',
  'partyRef',
  'legalEntityRef',
]);

/**
 * Applies the pinned mapping set to a batch of source rows.
 *
 * @param mappingSet must be FROZEN — a draft set may still change, so staging
 *                   from one would break the version-pinning guarantee.
 */
export function transform(
  sourceRows: SourceRowInput[],
  mappingSet: PinnedMappingSet,
  options: { engineVersion?: string; requireFrozen?: boolean } = {},
): TransformResult {
  const requireFrozen = options.requireFrozen ?? true;
  if (requireFrozen && mappingSet.status !== 'FROZEN') throw new MappingSetNotFrozenError(mappingSet.id);

  const transformationVersion = buildTransformationVersion(mappingSet, options.engineVersion);
  const index = indexDecisions(mappingSet.entries);
  const rows: TransformedRow[] = [];
  const exceptions: TransformException[] = [];
  const seenIdentities = new Map<string, string>();

  for (const source of sourceRows) {
    const staged: Record<string, unknown> = {};
    const decisionRefs: string[] = [];
    const validationErrors: string[] = [];
    let rowBlocked = false;

    const sourceIdentity = String(
      source.rawData['sourceIdentity'] ?? source.rawData['documentRef'] ?? `${source.id}`,
    );

    for (const [field, rawValue] of Object.entries(source.rawData).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (PASSTHROUGH_FIELDS.has(field)) {
        staged[field] = rawValue;
        continue;
      }

      const value = rawValue === null || rawValue === undefined ? '' : String(rawValue);
      const candidates = index.byFieldValue.get(`${field}\u0000${value}`) ?? [];

      if (candidates.length === 0) {
        rowBlocked = true;
        validationErrors.push(`UNMAPPED:${field}`);
        exceptions.push({
          sourceRowId: source.id,
          exceptionType: 'UNMAPPED',
          sourceField: field,
          sourceValue: value,
          reason: `No mapping decision exists for ${field}='${value}'. Legacy field meaning is never inferred.`,
          evidence: { mappingSetId: mappingSet.id, mappingVersion: mappingSet.version },
        });
        continue;
      }

      // More than one decision for the same (field, value) is ambiguous by
      // construction — the workbench must resolve it, the engine must not pick.
      const distinct = new Set(candidates.map((c) => `${c.targetField}\u0000${c.targetValue}`));
      if (distinct.size > 1) {
        rowBlocked = true;
        validationErrors.push(`AMBIGUOUS:${field}`);
        exceptions.push({
          sourceRowId: source.id,
          exceptionType: 'AMBIGUOUS',
          sourceField: field,
          sourceValue: value,
          reason: `Multiple conflicting mapping decisions exist for ${field}='${value}'.`,
          evidence: {
            mappingSetId: mappingSet.id,
            candidates: candidates.map((c) => ({ id: c.id, targetField: c.targetField, targetValue: c.targetValue })),
          },
        });
        continue;
      }

      const decision = candidates[0];
      if (decision.status === 'MANUAL_REVIEW_REQUIRED' || !decision.classification) {
        rowBlocked = true;
        validationErrors.push(`MAPPING_INCOMPLETE:${field}`);
        exceptions.push({
          sourceRowId: source.id,
          exceptionType: 'MAPPING_INCOMPLETE',
          sourceField: field,
          sourceValue: value,
          reason: `Mapping decision for ${field}='${value}' is still MANUAL_REVIEW_REQUIRED.`,
          evidence: { mappingEntryId: decision.id, mappingSetId: mappingSet.id },
        });
        continue;
      }

      decisionRefs.push(decision.id);
      if (decision.status === 'EXCLUDED') continue;

      const targetField = decision.targetField ?? field;
      staged[targetField] = decision.classification === 'ALIGN' ? value : decision.targetValue;
      staged[`${targetField}__classification`] = decision.classification;
    }

    staged['sourceIdentity'] = sourceIdentity;

    const previous = seenIdentities.get(sourceIdentity);
    if (previous) {
      exceptions.push({
        sourceRowId: source.id,
        exceptionType: 'DUPLICATE',
        sourceField: 'sourceIdentity',
        sourceValue: sourceIdentity,
        reason: `Duplicate source identity '${sourceIdentity}' already staged from source row ${previous}.`,
        evidence: { firstSourceRowId: previous, duplicateSourceRowId: source.id },
      });
      continue;
    }
    seenIdentities.set(sourceIdentity, source.id);

    if (rowBlocked) continue;

    rows.push({
      sourceRowId: source.id,
      rowHash: computeRowHash(sourceIdentity, staged, transformationVersion),
      stagedData: staged,
      validationErrors,
      lineageRef: {
        sourceRowRef: source.id,
        mappingSetId: mappingSet.id,
        mappingDecisionRefs: decisionRefs,
        transformationVersion,
      },
    });
  }

  return { rows, exceptions, transformationVersion };
}

/** Coverage meter for the mapping workbench: 100% disposition is required. */
export interface CoverageMeter {
  totalEntries: number;
  disposedEntries: number;
  manualReviewRequired: number;
  coveragePercent: number;
  complete: boolean;
  byClassification: Record<string, number>;
}

export function computeCoverage(entries: MappingDecision[]): CoverageMeter {
  const byClassification: Record<string, number> = { ALIGN: 0, MAP: 0, DIVERGE: 0, EXCLUDED: 0 };
  let disposed = 0;
  let manualReview = 0;

  for (const entry of entries) {
    if (entry.status === 'MANUAL_REVIEW_REQUIRED') {
      manualReview += 1;
      continue;
    }
    disposed += 1;
    if (entry.status === 'EXCLUDED') byClassification['EXCLUDED'] += 1;
    else if (entry.classification) byClassification[entry.classification] += 1;
  }

  const total = entries.length;
  const coveragePercent = total === 0 ? 0 : Math.round((disposed / total) * 10000) / 100;
  return {
    totalEntries: total,
    disposedEntries: disposed,
    manualReviewRequired: manualReview,
    coveragePercent,
    complete: total > 0 && manualReview === 0,
    byClassification,
  };
}
