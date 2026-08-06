import { injectable, inject } from 'tsyringe';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAudit } from '../infrastructure/audit';
import { OemNotFoundError, OemValidationError } from '../domain/errors';
import { computeDocumentIdentity, computeContentHash } from '../domain/dedupe';
import { computeDocumentDiff } from '../domain/diff';
import { OemAdapterRegistry } from '../domain/adapter-spi';

export interface ManualImportInput {
  make: string;
  kind: string;
  storeId?: string | null;
  naturalKey: string;
  specVersion?: string | null;
  /** Manual-entry statement rows — package line 20: "full manual grid for
   * makes with no adapter", S101A AC: "manual-entry statement fully
   * equivalent to fed one". */
  rows: Array<{ canonicalType?: string | null; fields: Record<string, unknown> }>;
}

export interface FeedImportInput {
  make: string;
  storeId?: string | null;
  /** Raw feed/file content — parsed via the make's registered S098 SPI adapter. */
  rawContent: string;
}

/**
 * S098 — staging store: immutable raw+parsed rows, dedupe on document
 * identity, diff alerts on re-delivery. Manual import always available
 * (package line 16).
 */
@injectable()
export class OemStagingService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('OemAdapterRegistry') private readonly adapters: OemAdapterRegistry,
  ) {}

  private async getProfile(tenantId: string, make: string) {
    const profile = await this.prisma.oemIntegrationProfile.findUnique({
      where: { tenantId_make: { tenantId, make: make.toUpperCase() } },
    });
    if (!profile) {
      throw new OemValidationError(
        'NO_PROFILE',
        `No OEM profile configured for make ${make.toUpperCase()} — an adapter framework profile must exist before import (package S098 AC)`,
      );
    }
    return profile;
  }

  /** Shared ingestion path for both feed-parsed and manually-entered documents. */
  private async ingest(
    tenantId: string,
    profileId: string,
    make: string,
    storeId: string | null,
    kind: string,
    sourceType: 'FEED' | 'MANUAL',
    naturalKey: string,
    specVersion: string | null,
    rawContent: string,
    rows: Array<{ rowIndex: number; parseStatus: 'PARSED' | 'UNPARSED'; canonicalType: string | null; fields: Record<string, unknown>; rawLine: string }>,
    actor: string,
  ) {
    const documentIdentity = computeDocumentIdentity(tenantId, make, kind, naturalKey);
    const contentHash = computeContentHash(rawContent);

    const latest = await this.prisma.oemStagedDocument.findFirst({
      where: { tenantId, documentIdentity },
      orderBy: { importedAt: 'desc' },
      include: { rows: true },
    });

    // Byte-identical re-delivery — dedupe silently (package S098 AC:
    // "staged docs immutable + deduped"). Recorded as an audit event so the
    // dedupe is itself observable, without creating a duplicate row.
    if (latest && latest.contentHash === contentHash) {
      await appendAudit(this.prisma, {
        tenantId, docType: 'OemStagedDocument', docId: latest.id,
        action: 'IMPORT_DEDUPED', actor, after: { documentIdentity, contentHash },
      });
      return { document: latest, diffAlert: null, deduped: true };
    }

    const created = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const document = await tx.oemStagedDocument.create({
        data: {
          tenantId, storeId, profileId, make: make.toUpperCase(), sourceType, kind,
          documentIdentity, contentHash, specVersion, rawContent,
          supersedesDocumentId: latest?.id ?? null,
          importedBy: actor,
        },
      });
      if (rows.length > 0) {
        await tx.oemStagedDocumentRow.createMany({
          data: rows.map((r) => ({
            tenantId, documentId: document.id, rowIndex: r.rowIndex,
            parseStatus: r.parseStatus, canonicalType: r.canonicalType,
            fields: r.fields as any, rawLine: r.rawLine,
          })),
        });
      }
      const fullRows = await tx.oemStagedDocumentRow.findMany({ where: { documentId: document.id } });

      let diffAlert = null;
      if (latest) {
        const diffs = computeDocumentDiff(
          { specVersion: latest.specVersion, rowCount: latest.rows.length, rows: latest.rows.map((r: any) => ({ rowIndex: r.rowIndex, fields: r.fields })) },
          { specVersion: document.specVersion, rowCount: fullRows.length, rows: fullRows.map((r: any) => ({ rowIndex: r.rowIndex, fields: r.fields })) },
        );
        if (diffs.length > 0) {
          diffAlert = await tx.oemDiffAlert.create({
            data: {
              tenantId, profileId, priorDocumentId: latest.id, newDocumentId: document.id,
              fieldDiffs: diffs as any,
            },
          });
        }
      }

      await appendAudit(tx, {
        tenantId, docType: 'OemStagedDocument', docId: document.id,
        action: sourceType === 'FEED' ? 'FEED_IMPORTED' : 'MANUAL_STATEMENT_ENTERED', actor,
        after: { documentId: document.id, rowCount: fullRows.length, unparsedCount: fullRows.filter((r: any) => r.parseStatus === 'UNPARSED').length, diffAlertId: diffAlert?.id ?? null },
      });

      return { document, rows: fullRows, diffAlert };
    });

    return { document: created.document, diffAlert: created.diffAlert, deduped: false };
  }

  /** S099/S100 — feed import through a registered make adapter. */
  async importFeed(tenantId: string, input: FeedImportInput, actor: string) {
    const profile = await this.getProfile(tenantId, input.make);
    const adapter = this.adapters.get(input.make);
    if (!adapter) {
      throw new OemValidationError(
        'NO_ADAPTER',
        `No feed adapter registered for make ${input.make.toUpperCase()} — use manual import instead (package S098: "Manual import always available")`,
      );
    }
    const parsed = adapter.parse(input.rawContent);
    return this.ingest(
      tenantId, profile.id, input.make, input.storeId ?? null, parsed.kind, 'FEED',
      parsed.naturalKey, parsed.specVersion, input.rawContent,
      parsed.rows, actor,
    );
  }

  /** S098/S101A — manual import (fixture feed for no-adapter makes, or the
   * manual-entry statement grid). */
  async importManual(tenantId: string, input: ManualImportInput, actor: string) {
    const profile = await this.getProfile(tenantId, input.make);
    if (!input.rows?.length) throw new OemValidationError('ROWS_REQUIRED', 'at least one row is required');
    const rawContent = JSON.stringify({ naturalKey: input.naturalKey, rows: input.rows });
    const rows = input.rows.map((r, idx) => ({
      rowIndex: idx, parseStatus: 'PARSED' as const, canonicalType: r.canonicalType ?? null,
      fields: r.fields, rawLine: JSON.stringify(r.fields),
    }));
    return this.ingest(
      tenantId, profile.id, input.make, input.storeId ?? null, input.kind, 'MANUAL',
      input.naturalKey, input.specVersion ?? null, rawContent, rows, actor,
    );
  }

  async listDocuments(tenantId: string, make?: string) {
    return this.prisma.oemStagedDocument.findMany({
      where: { tenantId, ...(make ? { make: make.toUpperCase() } : {}) },
      include: { rows: true },
      orderBy: { importedAt: 'desc' },
    });
  }

  async getDocument(tenantId: string, id: string) {
    const doc = await this.prisma.oemStagedDocument.findFirst({ where: { tenantId, id }, include: { rows: true } });
    if (!doc) throw new OemNotFoundError('OemStagedDocument', id);
    return doc;
  }

  async listDiffAlerts(tenantId: string, resolved?: boolean) {
    return this.prisma.oemDiffAlert.findMany({
      where: { tenantId, ...(resolved === undefined ? {} : resolved ? { resolvedAt: { not: null } } : { resolvedAt: null }) },
      orderBy: { raisedAt: 'desc' },
    });
  }

  async resolveDiffAlert(tenantId: string, id: string, actor: string) {
    const alert = await this.prisma.oemDiffAlert.findFirst({ where: { tenantId, id } });
    if (!alert) throw new OemNotFoundError('OemDiffAlert', id);
    const updated = await this.prisma.oemDiffAlert.update({
      where: { id }, data: { resolvedAt: new Date(), resolvedBy: actor },
    });
    await appendAudit(this.prisma, {
      tenantId, docType: 'OemDiffAlert', docId: id, action: 'DIFF_ALERT_RESOLVED', actor, before: alert, after: updated,
    });
    return updated;
  }
}
