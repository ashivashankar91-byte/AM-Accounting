import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';
import crypto from 'crypto';
import {
  MANIFESTS,
  DEFAULT_MANIFEST_VERSION,
  SeedAccount,
  SeedManifest,
  orderedForSeed,
  canonicalFields,
} from '../domain/coa-blueprint';

// ── Errors ───────────────────────────────────────────────────────────────────

/** S010 — requested manifest version is not registered → 422. */
export class UnknownManifestError extends Error {
  readonly code = 'UNKNOWN_MANIFEST_VERSION';
  constructor(version: string) {
    super(`Unknown COA manifest version "${version}"`);
    this.name = 'UnknownManifestError';
  }
}

// ── DTOs / results ────────────────────────────────────────────────────────────

export interface SeedDTO {
  tenantId: string;
  entityId: string;
  manifestVersion?: string;
  actor: string;
}

export interface SeedConflict {
  number: string;
  diffs: Record<string, { canonical: unknown; existing: unknown }>;
}

export interface SeedResult {
  manifestVersion: string;
  created: number;
  merged: number;
  conflicts: SeedConflict[];
}

export interface DiffResult {
  manifestVersion: string;
  missing: string[]; // canonical numbers absent from the entity
  divergent: SeedConflict[]; // present but attributes differ
  extra: string[]; // entity numbers not in the canonical manifest
}

@injectable()
export class SeedService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  private resolveManifest(version?: string): SeedManifest {
    const v = version ?? DEFAULT_MANIFEST_VERSION;
    const manifest = MANIFESTS[v];
    if (!manifest) throw new UnknownManifestError(v);
    return manifest;
  }

  /**
   * BR010-1/2 — idempotent per-entity seed. Creates missing accounts (parents
   * first), leaves existing consistent accounts untouched (merged), and reports
   * divergent numbers as conflicts WITHOUT overwriting (AC negative path).
   */
  async seed(dto: SeedDTO): Promise<SeedResult> {
    const manifest = this.resolveManifest(dto.manifestVersion);

    const existing = await this.prisma.glAccount.findMany({
      where: { tenantId: dto.tenantId, entityId: dto.entityId },
    });
    const byNumber = new Map(existing.map((a) => [a.accountNumber, a]));
    const idByNumber = new Map(existing.map((a) => [a.accountNumber, a.id]));

    let created = 0;
    let merged = 0;
    const conflicts: SeedConflict[] = [];

    for (const acct of orderedForSeed(manifest)) {
      const current = byNumber.get(acct.number);
      if (current) {
        const diffs = this.compare(acct, current);
        if (Object.keys(diffs).length === 0) merged += 1;
        else conflicts.push({ number: acct.number, diffs });
        continue; // never overwrite
      }
      const parentId = acct.parentNumber ? (idByNumber.get(acct.parentNumber) ?? null) : null;
      const isContra = acct.normalBalance !== this.defaultBalance(acct.type);
      const row = await this.prisma.glAccount.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: dto.tenantId,
          entityId: dto.entityId,
          accountNumber: acct.number,
          name: acct.name,
          type: acct.type,
          normalBalance: acct.normalBalance,
          isContra,
          contraReason: isContra ? (acct.contraReason ?? 'Canonical contra account') : null,
          postable: acct.postable,
          parentId,
          status: 'ACTIVE',
          version: 1,
        },
      });
      idByNumber.set(acct.number, row.id);
      byNumber.set(acct.number, row as any);
      created += 1;
    }

    await this.recordRun(dto, manifest.version, created, merged, conflicts.length);
    await this.audit(dto.tenantId, dto.entityId, dto.actor, {
      manifestVersion: manifest.version,
      created,
      merged,
      conflicts: conflicts.length,
    });
    await this.emitSeeded(dto.tenantId, dto.entityId, manifest.version, created, dto.actor);

    return { manifestVersion: manifest.version, created, merged, conflicts };
  }

  /** BR010-3 — divergence report of the entity's COA vs the canonical manifest. */
  async diffFromCanonical(tenantId: string, entityId: string, manifestVersion?: string): Promise<DiffResult> {
    const manifest = this.resolveManifest(manifestVersion);
    const existing = await this.prisma.glAccount.findMany({ where: { tenantId, entityId } });
    const byNumber = new Map(existing.map((a) => [a.accountNumber, a]));
    const canonicalNumbers = new Set(manifest.accounts.map((a) => a.number));

    const missing: string[] = [];
    const divergent: SeedConflict[] = [];
    for (const acct of manifest.accounts) {
      const current = byNumber.get(acct.number);
      if (!current) {
        missing.push(acct.number);
        continue;
      }
      const diffs = this.compare(acct, current);
      if (Object.keys(diffs).length > 0) divergent.push({ number: acct.number, diffs });
    }
    const extra = existing.filter((a) => !canonicalNumbers.has(a.accountNumber)).map((a) => a.accountNumber);

    return { manifestVersion: manifest.version, missing, divergent, extra };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private compare(canonical: SeedAccount, existing: any): SeedConflict['diffs'] {
    const c = canonicalFields(canonical);
    const diffs: SeedConflict['diffs'] = {};
    for (const [k, v] of Object.entries(c)) {
      if (existing[k] !== v) diffs[k] = { canonical: v, existing: existing[k] };
    }
    return diffs;
  }

  private defaultBalance(type: string): 'DR' | 'CR' {
    return type === 'ASSET' || type === 'EXPENSE' ? 'DR' : 'CR';
  }

  private async recordRun(
    dto: SeedDTO,
    version: string,
    created: number,
    merged: number,
    conflicts: number,
  ) {
    try {
      await this.prisma.coaSeedRun.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: dto.tenantId,
          entityId: dto.entityId,
          manifestVersion: version,
          createdCount: created,
          mergedCount: merged,
          conflictCount: conflicts,
          actor: dto.actor,
        },
      });
    } catch {
      /* non-fatal */
    }
  }

  private async audit(tenantId: string, entityId: string, actor: string, after: unknown) {
    try {
      await this.prisma.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          docType: 'coa_seed',
          docId: entityId,
          action: 'SEED',
          before: undefined as any,
          after: after as any,
          actor,
        },
      });
    } catch {
      /* non-fatal */
    }
  }

  private async emitSeeded(
    tenantId: string,
    entityId: string,
    manifestVersion: string,
    createdCount: number,
    actor: string,
  ) {
    const eventId = crypto.randomUUID();
    const payload = {
      eventId,
      entityId,
      manifestVersion,
      createdCount,
      actor,
      ts: new Date().toISOString(),
      schemaV: 1,
    };
    try {
      await this.prisma.coaOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          eventType: 'coa.seeded',
          aggregateId: entityId,
          payload: payload as any,
        },
      });
    } catch {
      /* non-fatal */
    }
    try {
      await this.events.publish({
        type: 'coa.seeded',
        tenantId,
        payload,
        occurredAt: new Date(),
        correlationId: eventId,
      } as any);
    } catch {
      /* best-effort */
    }
  }
}
