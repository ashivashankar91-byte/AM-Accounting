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
    const toCreate: { acct: SeedAccount; parentId: string | null; isContra: boolean }[] = [];

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
      // Reserve the id now so later accounts in this same seed pass can
      // resolve THIS account as their parent before the transaction commits.
      const reservedId = crypto.randomUUID();
      idByNumber.set(acct.number, reservedId);
      byNumber.set(acct.number, { id: reservedId } as any);
      toCreate.push({ acct, parentId, isContra });
      created += 1;
    }

    // S007 BR7-1/BR7-4 — every seeded account, the seed-run record, and the
    // audit event are one atomic transaction: a failure partway through
    // never leaves a partially-seeded, unaudited chart of accounts.
    await this.prisma.$transaction(async (tx) => {
      for (const { acct, parentId, isContra } of toCreate) {
        const id = idByNumber.get(acct.number)!;
        await tx.glAccount.create({
          data: {
            id,
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
      }

      await tx.coaSeedRun.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: dto.tenantId,
          entityId: dto.entityId,
          manifestVersion: manifest.version,
          createdCount: created,
          mergedCount: merged,
          conflictCount: conflicts.length,
          actor: dto.actor,
        },
      });

      await this.audit(dto.tenantId, dto.entityId, dto.actor, {
        manifestVersion: manifest.version,
        created,
        merged,
        conflicts: conflicts.length,
      }, tx);
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

  private async audit(
    tenantId: string,
    entityId: string,
    actor: string,
    after: unknown,
    tx: Pick<PrismaClient, 'auditOutboxEvent'> = this.prisma,
  ) {
    await tx.auditOutboxEvent.create({
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
