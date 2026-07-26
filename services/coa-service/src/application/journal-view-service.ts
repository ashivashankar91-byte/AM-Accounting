import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';

// ── S004A field-mask stub (BR217-1) ─────────────────────────────────────────────
// Real masks arrive with S004A. Until then a deny-nothing default plus a designated
// masked role (CLERK — lowest-privilege je.view holder) hides PII fields at
// serialization and triggers the audit.viewed PII-access event (§9).
const FIELD_MASKS: Record<string, readonly string[]> = {
  CLERK: ['postedBy'],
};

/** Fields hidden from `role` at serialization. Empty = full visibility. */
export function maskedFieldsFor(role: string | undefined): string[] {
  return role ? [...(FIELD_MASKS[role] ?? [])] : [];
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** Unknown journal number — 404 carrying a search suggestion (§3 negative). */
export class JournalNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'JOURNAL_NOT_FOUND';
  constructor(
    readonly journalNumber: string,
    readonly suggestion: { message: string; prefix: string; matches: string[] },
  ) {
    super(`Journal ${journalNumber} not found`);
    this.name = 'JournalNotFoundError';
  }
}

// ── View shapes ────────────────────────────────────────────────────────────────

export interface JournalLineView {
  lineIndex: number;
  account: string; // GL account number
  store: string;
  dept: string | null;
  dr: number;
  cr: number;
  memo: string | null;
}

export interface JournalLinkRef {
  id: string;
  journalNumber: string;
}

export interface AttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface JournalView {
  id: string;
  journalNumber: string;
  source: string;
  periodCode: string;
  entityId: string;
  entryDate: string; // YYYY-MM-DD
  postedBy?: string; // masked -> absent
  postedAt: string; // ISO
  memo?: string | null; // masked -> absent
  status: string;
  immutable: boolean; // BR217-2 — every persisted JE is immutable
  totalDebits: number;
  totalCredits: number;
  lines: JournalLineView[];
  reversalOf?: JournalLinkRef; // BR217-3 — this entry reverses X
  reversedBy?: JournalLinkRef; // BR217-3 — entry X reversed this one
  attachments: AttachmentView[];
  maskedFields?: string[]; // present only when a mask was applied
}

export interface ViewActor {
  userId: string;
  role?: string;
}

@injectable()
export class JournalViewService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  /**
   * S217 — open a posted JE by number and render header, lines, source, poster,
   * timestamps, attachments and reversal linkage (both directions). Read-only.
   * Field masks (S004A stub) hide PII for masked roles and emit audit.viewed.
   */
  async view(tenantId: string, journalNumber: string, actor: ViewActor): Promise<JournalView> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { tenantId, journalNumber },
    });

    if (!entry) {
      throw new JournalNotFoundError(journalNumber, await this.buildSuggestion(tenantId, journalNumber));
    }

    const lines = await this.prisma.journalLine.findMany({
      where: { journalEntryId: entry.id, tenantId },
      orderBy: { lineIndex: 'asc' },
    });

    // BR217-3 — resolve both reversal directions to navigable {id, number} refs.
    const [reversalOf, reversedBy] = await Promise.all([
      this.resolveLink(tenantId, entry.reversalOf),
      this.resolveLink(tenantId, entry.reversedBy),
    ]);

    // Attachments travel with the originating draft (S214) via the POSTED-LINKED back-ref.
    const attachments: AttachmentView[] = entry.draftId
      ? (
          await this.prisma.attachment.findMany({
            where: { tenantId, draftId: entry.draftId },
            orderBy: { createdAt: 'asc' },
          })
        ).map((a) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: Number(a.sizeBytes),
        }))
      : [];

    const masked = maskedFieldsFor(actor.role);

    const view: JournalView = {
      id: entry.id,
      journalNumber: entry.journalNumber,
      source: entry.sourceCode,
      periodCode: entry.periodCode,
      entityId: entry.entityId,
      entryDate: entry.entryDate.toISOString().slice(0, 10),
      postedAt: entry.postedAt.toISOString(),
      status: entry.status,
      immutable: true, // BR217-2 — posted JEs are immutable
      totalDebits: Number(entry.totalDebits),
      totalCredits: Number(entry.totalCredits),
      lines: lines.map((l) => ({
        lineIndex: l.lineIndex,
        account: l.accountNumber,
        store: l.storeId,
        dept: l.deptCode ?? null,
        dr: Number(l.dr),
        cr: Number(l.cr),
        memo: l.memo ?? null,
      })),
      attachments,
    };

    if (reversalOf) view.reversalOf = reversalOf;
    if (reversedBy) view.reversedBy = reversedBy;

    // Apply masks at serialization — a masked field is ABSENT, not nulled (§3).
    if (!masked.includes('postedBy')) view.postedBy = entry.postedBy;
    if (!masked.includes('memo')) view.memo = entry.memo ?? null;

    if (masked.length > 0) {
      view.maskedFields = masked;
      await this.emitViewed(tenantId, entry.id, entry.journalNumber, actor, masked);
    }

    return view;
  }

  /** Resolve a reversal id to a navigable {id, journalNumber} ref, tenant-scoped. */
  private async resolveLink(tenantId: string, id: string | null | undefined): Promise<JournalLinkRef | undefined> {
    if (!id) return undefined;
    const linked = await this.prisma.journalEntry.findFirst({
      where: { id, tenantId },
      select: { id: true, journalNumber: true },
    });
    return linked ? { id: linked.id, journalNumber: linked.journalNumber } : undefined;
  }

  /** §3 negative — a 404 that helps the user find the right entry (search suggestion). */
  private async buildSuggestion(
    tenantId: string,
    journalNumber: string,
  ): Promise<{ message: string; prefix: string; matches: string[] }> {
    // Derive the source-period prefix (e.g. 'GJ-2026-01-000999' -> 'GJ-2026-01-').
    const cut = journalNumber.lastIndexOf('-');
    const prefix = cut > 0 ? journalNumber.slice(0, cut + 1) : journalNumber;
    const near = await this.prisma.journalEntry.findMany({
      where: { tenantId, journalNumber: { startsWith: prefix } },
      select: { journalNumber: true },
      orderBy: { journalNumber: 'asc' },
      take: 5,
    });
    const matches = near.map((n) => n.journalNumber);
    return {
      message:
        matches.length > 0
          ? `No journal ${journalNumber}. Did you mean one of these?`
          : `No journal ${journalNumber}. Search by number, source or period.`,
      prefix,
      matches,
    };
  }

  /** §9 — audit.viewed when a masked-role user opens a JE (PII access policy). */
  private async emitViewed(
    tenantId: string,
    journalId: string,
    journalNumber: string,
    actor: ViewActor,
    maskedFields: string[],
  ): Promise<void> {
    const payload = {
      eventId: crypto.randomUUID(),
      tenantId,
      journalId,
      journalNumber,
      viewedBy: actor.userId,
      role: actor.role ?? null,
      maskedFields,
      ts: new Date().toISOString(),
      schemaV: 1,
    };
    // Outbox is the source of truth; broker publish is best-effort.
    await this.prisma.coaOutboxEvent.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        eventType: 'audit.viewed',
        aggregateId: journalId,
        payload: payload as any,
      },
    });
    // AuditPort stub (S007) — PII-access trail with actor, no before/after mutation.
    await this.prisma.auditOutboxEvent.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        docType: 'JOURNAL_ENTRY',
        docId: journalId,
        action: 'VIEWED',
        before: null as any,
        after: payload as any,
        actor: actor.userId,
      },
    });
    try {
      await this.events.publish({
        type: 'audit.viewed',
        tenantId,
        payload,
        occurredAt: new Date().toISOString(),
        correlationId: journalId,
      } as any);
    } catch {
      /* outbox row already durable */
    }
  }
}
