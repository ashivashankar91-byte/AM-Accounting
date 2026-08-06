import { inject, injectable } from 'tsyringe';
import { IMappingRepository, ISourceRepository } from '../domain/interfaces';
import { computeCoverage, MappingDecision, PinnedMappingSet } from '../domain/transformation-engine';

export class MappingSetFrozenError extends Error {
  readonly code = 'MAPPING_SET_FROZEN';
  readonly statusCode = 409;
  constructor(id: string) {
    super(`Mapping set ${id} is FROZEN and immutable. Create a new version instead.`);
    this.name = 'MappingSetFrozenError';
  }
}

export class MappingCoverageIncompleteError extends Error {
  readonly code = 'MAPPING_COVERAGE_INCOMPLETE';
  readonly statusCode = 422;
  constructor(public readonly outstanding: number) {
    super(`${outstanding} mapping decision(s) are still MANUAL_REVIEW_REQUIRED; 100% disposition is required before freeze.`);
    this.name = 'MappingCoverageIncompleteError';
  }
}

export class MappingApprovalSoDError extends Error {
  readonly code = 'SOD_VIOLATION';
  readonly statusCode = 403;
  constructor(actor: string) {
    super(`${actor} decided this mapping and may not also approve it`);
    this.name = 'MappingApprovalSoDError';
  }
}

const VALID_CLASSIFICATIONS = ['ALIGN', 'MAP', 'DIVERGE'];

@injectable()
export class MappingService {
  constructor(
    @inject('IMappingRepository') private readonly repo: IMappingRepository,
    @inject('ISourceRepository') private readonly sources: ISourceRepository,
  ) {}

  listSets(tenantId: string, filters: { legalEntityId?: string; sourceSystemId?: string }) {
    return this.repo.listSets(tenantId, filters);
  }

  /**
   * Creates the next version of the mapping set for (entity × source system).
   * Versions are never edited in place once frozen, so a new version is the
   * only way to change a decision that a run has already consumed.
   */
  async createSet(input: { tenantId: string; legalEntityId: string; sourceSystemId: string; actor: string }) {
    const version = await this.repo.nextVersion(input.tenantId, input.legalEntityId, input.sourceSystemId);
    return this.repo.createSet({
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      sourceSystemId: input.sourceSystemId,
      version,
      createdBy: input.actor,
    });
  }

  async getSet(tenantId: string, id: string) {
    const set = await this.repo.findSet(tenantId, id);
    if (!set) {
      const err: any = new Error(`Mapping set ${id} not found`);
      err.statusCode = 404;
      err.code = 'MAPPING_SET_NOT_FOUND';
      throw err;
    }
    return set;
  }

  async listEntries(tenantId: string, mappingSetId: string) {
    await this.getSet(tenantId, mappingSetId);
    const entries = await this.repo.listEntries(tenantId, mappingSetId);
    return { items: entries, coverage: computeCoverage(entries as unknown as MappingDecision[]) };
  }

  /**
   * Seeds the workbench from the distinct source values actually present in a
   * snapshot. Every discovered value starts MANUAL_REVIEW_REQUIRED — a value
   * nobody has classified is never treated as ALIGN by default.
   */
  async seedFromSnapshot(input: { tenantId: string; mappingSetId: string; snapshotId: string; fields: string[] }) {
    const set = await this.getSet(input.tenantId, input.mappingSetId);
    if (set.status === 'FROZEN') throw new MappingSetFrozenError(input.mappingSetId);

    const rows = await this.sources.listRowsBySnapshot(input.tenantId, input.snapshotId);
    const discovered = new Map<string, Set<string>>();
    for (const row of rows as any[]) {
      const raw = row.rawData as Record<string, unknown>;
      for (const field of input.fields) {
        if (!(field in raw)) continue;
        const value = raw[field] === null || raw[field] === undefined ? '' : String(raw[field]);
        const set2 = discovered.get(field) ?? new Set<string>();
        set2.add(value);
        discovered.set(field, set2);
      }
    }

    const entries: { sourceField: string; sourceValue: string; status: string }[] = [];
    for (const [field, values] of discovered) {
      for (const value of values) entries.push({ sourceField: field, sourceValue: value, status: 'MANUAL_REVIEW_REQUIRED' });
    }
    const count = await this.repo.upsertEntries(input.tenantId, input.mappingSetId, entries);
    return { seeded: count, fields: [...discovered.keys()] };
  }

  async upsertEntries(input: {
    tenantId: string; mappingSetId: string; actor: string;
    entries: {
      sourceField: string; sourceValue: string; targetField?: string | null; targetValue?: string | null;
      classification?: string | null; provenanceNote?: string | null; status?: string;
    }[];
  }) {
    const set = await this.getSet(input.tenantId, input.mappingSetId);
    if (set.status === 'FROZEN') throw new MappingSetFrozenError(input.mappingSetId);

    for (const entry of input.entries) {
      if (entry.classification && !VALID_CLASSIFICATIONS.includes(entry.classification)) {
        const err: any = new Error(`classification must be one of ${VALID_CLASSIFICATIONS.join(', ')}`);
        err.statusCode = 400;
        err.code = 'INVALID_CLASSIFICATION';
        throw err;
      }
      // A MAP or DIVERGE decision without a target is not a decision; it would
      // force the engine to invent a legacy field meaning at staging time.
      if (entry.classification && entry.classification !== 'ALIGN' && !entry.targetValue) {
        const err: any = new Error(`${entry.classification} decisions require a targetValue`);
        err.statusCode = 400;
        err.code = 'TARGET_VALUE_REQUIRED';
        throw err;
      }
    }

    const count = await this.repo.upsertEntries(
      input.tenantId,
      input.mappingSetId,
      input.entries.map((e) => ({ ...e, decidedBy: e.classification ? input.actor : null })),
    );
    const entries = await this.repo.listEntries(input.tenantId, input.mappingSetId);
    return { updated: count, coverage: computeCoverage(entries as unknown as MappingDecision[]) };
  }

  async updateEntry(input: {
    tenantId: string; mappingSetId: string; entryId: string; actor: string; patch: Record<string, unknown>;
  }) {
    const set = await this.getSet(input.tenantId, input.mappingSetId);
    if (set.status === 'FROZEN') throw new MappingSetFrozenError(input.mappingSetId);
    const entry = await this.repo.findEntry(input.tenantId, input.entryId);
    if (!entry) {
      const err: any = new Error(`Mapping entry ${input.entryId} not found`);
      err.statusCode = 404;
      err.code = 'MAPPING_ENTRY_NOT_FOUND';
      throw err;
    }

    const classification = input.patch['classification'] as string | undefined;
    if (classification && !VALID_CLASSIFICATIONS.includes(classification)) {
      const err: any = new Error(`classification must be one of ${VALID_CLASSIFICATIONS.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_CLASSIFICATION';
      throw err;
    }

    const status = classification
      ? 'MAPPED'
      : (input.patch['status'] as string | undefined) ?? entry.status;

    return this.repo.updateEntry(input.tenantId, input.entryId, {
      ...input.patch,
      status,
      decidedBy: classification ? input.actor : entry.decidedBy,
      decidedAt: classification ? new Date() : entry.decidedAt,
    });
  }

  /**
   * Approving a mapping decision is a second pair of eyes: the identity that
   * decided the mapping may not be the identity that approves it.
   */
  async approveEntry(input: { tenantId: string; mappingSetId: string; entryId: string; actor: string }) {
    await this.getSet(input.tenantId, input.mappingSetId);
    const entry = await this.repo.findEntry(input.tenantId, input.entryId);
    if (!entry) {
      const err: any = new Error(`Mapping entry ${input.entryId} not found`);
      err.statusCode = 404;
      err.code = 'MAPPING_ENTRY_NOT_FOUND';
      throw err;
    }
    if (entry.status === 'MANUAL_REVIEW_REQUIRED' || !entry.classification) {
      const err: any = new Error('Only a decided mapping entry can be approved');
      err.statusCode = 422;
      err.code = 'MAPPING_NOT_DECIDED';
      throw err;
    }
    if (entry.decidedBy && entry.decidedBy === input.actor) throw new MappingApprovalSoDError(input.actor);

    return this.repo.updateEntry(input.tenantId, input.entryId, {
      approvedBy: input.actor,
      approvedAt: new Date(),
    });
  }

  /**
   * Freeze ceremony. A mapping set may only be frozen at 100% coverage, and
   * once frozen it is immutable — which is what makes "transformation version
   * pinned" a real guarantee rather than a naming convention.
   */
  async freeze(input: { tenantId: string; mappingSetId: string; actor: string }) {
    const set = await this.getSet(input.tenantId, input.mappingSetId);
    if (set.status === 'FROZEN') return set;

    const entries = await this.repo.listEntries(input.tenantId, input.mappingSetId);
    const coverage = computeCoverage(entries as unknown as MappingDecision[]);
    if (!coverage.complete) throw new MappingCoverageIncompleteError(coverage.manualReviewRequired);

    return this.repo.freezeSet(input.tenantId, input.mappingSetId, input.actor);
  }

  /** Loads a frozen set in the shape the transformation engine pins against. */
  async loadPinned(tenantId: string, mappingSetId: string): Promise<PinnedMappingSet> {
    const set = await this.getSet(tenantId, mappingSetId);
    const entries = await this.repo.listEntries(tenantId, mappingSetId);
    return {
      id: set.id,
      version: set.version,
      status: set.status as 'DRAFT' | 'FROZEN',
      entries: entries.map((e: any) => ({
        id: e.id,
        sourceField: e.sourceField,
        sourceValue: e.sourceValue,
        targetField: e.targetField,
        targetValue: e.targetValue,
        classification: e.classification,
        status: e.status,
      })),
    };
  }

  markUsed(tenantId: string, mappingSetId: string, runId: string) {
    return this.repo.markUsed(tenantId, mappingSetId, runId);
  }
}
