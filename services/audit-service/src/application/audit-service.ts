import { PrismaClient, Prisma } from '.prisma/audit-client';
import pino from 'pino';
import { createHash } from 'crypto';

const logger = pino({ name: 'audit-service' });

/**
 * Deterministic JSON stringification (object keys sorted recursively) so the
 * same logical content always hashes to the same value regardless of key
 * insertion order. Required for BR7-2 hash-chain integrity.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** BR7-2: hashSelf = sha256(hashPrev + canonical content). */
function computeHashSelf(hashPrev: string | null, content: Record<string, unknown>): string {
  const payload = stableStringify({ hashPrev, ...content });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * The subset of fields that participate in the hash chain, canonicalized the
 * same way whether computed at insert time (from the DTO) or at verification
 * time (from a persisted row). `id` is intentionally excluded: it does not
 * exist yet when hashSelf is first computed at insert time.
 */
function chainableContent(fields: {
  tenantId: string; eventType: string; entityType: string; entityId: string;
  actorType: string; actorId: string; actorName: string; action: string;
  previousState?: unknown; newState?: unknown; reason?: string | null;
  confidence?: number | null; metadata?: unknown; occurredAt: Date;
  ipAddress?: string | null; sessionId?: string | null; sourceEventId?: string | null;
}): Record<string, unknown> {
  return {
    tenantId: fields.tenantId,
    eventType: fields.eventType,
    entityType: fields.entityType,
    entityId: fields.entityId,
    actorType: fields.actorType,
    actorId: fields.actorId,
    actorName: fields.actorName,
    action: fields.action,
    previousState: fields.previousState ?? null,
    newState: fields.newState ?? null,
    reason: fields.reason ?? null,
    confidence: fields.confidence ?? null,
    metadata: fields.metadata ?? null,
    occurredAt: fields.occurredAt.toISOString(),
    ipAddress: fields.ipAddress ?? null,
    sessionId: fields.sessionId ?? null,
    sourceEventId: fields.sourceEventId ?? null,
  };
}

/** BR7-2 field inventory: partitioned by month+tenant. Must match the
 * `partition_key` generated column expression in the DB exactly. */
function partitionKeyFor(tenantId: string, occurredAt: Date): string {
  const yyyy = occurredAt.getUTCFullYear();
  const mm = String(occurredAt.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}:${tenantId}`;
}

/**
 * S224 BR224-2: human-readable field-level diff between an audit row's
 * previousState and newState. Top-level keys only (matches the shallow
 * before/after snapshots every write-path call site records — see
 * S007_WRITE_PATH_COVERAGE_CENSUS.md).
 */
export interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export interface DocumentHistoryEvent {
  id: string;
  ts: string;
  actor: string;
  action: string;
  eventType: string;
  fieldDiffs: FieldDiff[];
  reason: string | null;
}

/**
 * S224 BR224-3 ("PII views themselves emit audit events"): a fixed,
 * conservative allowlist of field names treated as PII wherever they appear
 * in a diffed field name (case-insensitive substring match), since audit
 * rows from different services/entities do not share one schema. This is a
 * deliberate, documented scoping decision, not an exhaustive PII classifier
 * — extend this list, not the detection logic, as new PII-bearing fields
 * are added to any in-scope service.
 */
const PII_FIELD_MARKERS = [
  'ssn', 'taxid', 'ein', 'bankaccount', 'routingnumber', 'accountnumber',
  'dob', 'dateofbirth', 'email', 'phone', 'address', 'driverlicense',
  'passport', 'salary', 'wage', 'compensation', 'creditcard',
];

function isPiiField(fieldName: string): boolean {
  const normalized = fieldName.toLowerCase();
  return PII_FIELD_MARKERS.some((marker) => normalized.includes(marker));
}

/** Shallow top-level diff of two snapshot objects. Keys present in either
 * side, added/removed/changed all surfaced uniformly. */
function diffFields(before: unknown, after: unknown): FieldDiff[] {
  const b = (before && typeof before === 'object') ? (before as Record<string, unknown>) : {};
  const a = (after && typeof after === 'object') ? (after as Record<string, unknown>) : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const diffs: FieldDiff[] = [];
  for (const key of keys) {
    const bv = b[key];
    const av = a[key];
    if (stableStringify(bv) !== stableStringify(av)) {
      diffs.push({ field: key, before: bv ?? null, after: av ?? null });
    }
  }
  return diffs;
}

export interface ChainVerifyResult {
  ok: boolean;
  partitionKey: string;
  recordsChecked: number;
  brokenAt?: string;
  reason?: string;
}

export interface CreateAuditLogDTO {
  tenantId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId: string;
  actorName: string;
  action: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  reason?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  ipAddress?: string;
  sessionId?: string;
  /** Source outbox row id (AuditOutboxDrainer). Enables idempotent retry:
   * a duplicate delivery of the same outbox row is a no-op, not a new row. */
  sourceEventId?: string;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async log(dto: CreateAuditLogDTO): Promise<{ id: string; idempotent: boolean }> {
    const occurredAt = dto.occurredAt ?? new Date();
    const partitionKey = partitionKeyFor(dto.tenantId, occurredAt);
    const content = chainableContent({ ...dto, occurredAt });

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Ensure the partition's chain-anchor row exists, then lock it for
        // the duration of this write (FOR UPDATE) so two concurrent inserts
        // into the SAME partition can never both read the same hashPrev
        // (which would fork the chain instead of extending it).
        await tx.$executeRaw`INSERT INTO audit_chain_anchors (partition_key, tail_hash) VALUES (${partitionKey}, NULL) ON CONFLICT (partition_key) DO NOTHING`;
        const anchorRows = await tx.$queryRaw<Array<{ tail_hash: string | null }>>`SELECT tail_hash FROM audit_chain_anchors WHERE partition_key = ${partitionKey} FOR UPDATE`;
        const hashPrev = anchorRows[0]?.tail_hash ?? null;
        const hashSelf = computeHashSelf(hashPrev, content);

        const record = await tx.auditLog.create({
          data: {
            tenantId: dto.tenantId,
            eventType: dto.eventType,
            entityType: dto.entityType,
            entityId: dto.entityId,
            actorType: dto.actorType,
            actorId: dto.actorId,
            actorName: dto.actorName,
            action: dto.action,
            previousState: (dto.previousState as Prisma.InputJsonValue) ?? undefined,
            newState: (dto.newState as Prisma.InputJsonValue) ?? undefined,
            reason: dto.reason,
            confidence: dto.confidence,
            metadata: (dto.metadata as Prisma.InputJsonValue) ?? undefined,
            occurredAt,
            ipAddress: dto.ipAddress,
            sessionId: dto.sessionId,
            sourceEventId: dto.sourceEventId,
            hashPrev,
            hashSelf,
          },
        });

        await tx.$executeRaw`UPDATE audit_chain_anchors SET tail_hash = ${hashSelf}, tail_audit_log_id = ${record.id}, updated_at = now() WHERE partition_key = ${partitionKey}`;

        logger.info({ auditId: record.id, eventType: dto.eventType, partitionKey }, 'Audit log created');
        return { id: record.id, idempotent: false };
      });
    } catch (err: any) {
      // Append-only table (immutable trigger blocks UPDATE/DELETE) — a
      // duplicate sourceEventId can never be "fixed up" by updating the
      // existing row. Retried/duplicate delivery of the same outbox row is
      // therefore idempotent by treating the unique-violation as success.
      // Because the create() above ran inside $transaction, the anchor's
      // tail_hash was never advanced when the create failed, so no gap is
      // left in the chain for this no-op retry.
      if (dto.sourceEventId && err?.code === UNIQUE_CONSTRAINT_VIOLATION) {
        const existing = await this.prisma.auditLog.findUnique({ where: { sourceEventId: dto.sourceEventId } });
        if (existing) {
          logger.info({ auditId: existing.id, sourceEventId: dto.sourceEventId }, 'Audit log delivery already recorded (idempotent)');
          return { id: existing.id, idempotent: true };
        }
      }
      throw err;
    }
  }

  /** Every distinct partition key that currently has at least one row, for
   * driving a periodic chain-verification job. */
  async listPartitions(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ partition_key: string }>>`SELECT DISTINCT partition_key FROM audit_logs WHERE partition_key IS NOT NULL ORDER BY partition_key`;
    return rows.map((r) => r.partition_key);
  }

  /**
   * BR7-2 tamper detection: walk one partition's chain in write order and
   * confirm each row's hashPrev matches the prior row's hashSelf, and each
   * row's own hashSelf still matches what its stored content would hash to.
   * A mismatch means the row (or the chain) was altered after the fact.
   */
  async verifyChain(partitionKey: string): Promise<ChainVerifyResult> {
    const rows = await this.prisma.auditLog.findMany({
      where: { partitionKey },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });

    let expectedPrev: string | null = null;
    let checked = 0;
    for (const row of rows) {
      checked += 1;
      if ((row.hashPrev ?? null) !== expectedPrev) {
        return { ok: false, partitionKey, recordsChecked: checked, brokenAt: row.id, reason: 'hashPrev does not match the prior record in this partition' };
      }
      const expectedSelf = computeHashSelf(row.hashPrev ?? null, chainableContent({
        tenantId: row.tenantId, eventType: row.eventType, entityType: row.entityType, entityId: row.entityId,
        actorType: row.actorType, actorId: row.actorId, actorName: row.actorName, action: row.action,
        previousState: row.previousState, newState: row.newState, reason: row.reason, confidence: row.confidence,
        metadata: row.metadata, occurredAt: row.occurredAt, ipAddress: row.ipAddress, sessionId: row.sessionId,
        sourceEventId: row.sourceEventId,
      }));
      if (row.hashSelf !== expectedSelf) {
        return { ok: false, partitionKey, recordsChecked: checked, brokenAt: row.id, reason: 'stored hashSelf does not match recomputed hash of the record content' };
      }
      expectedPrev = row.hashSelf ?? null;
    }
    return { ok: true, partitionKey, recordsChecked: checked };
  }

  async getByEntity(entityType: string, entityId: string, tenantId?: string) {
    const where: any = { entityType, entityId };
    if (tenantId) where.tenantId = tenantId;
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }

  async getByActor(actorId: string, tenantId?: string) {
    const where: any = { actorId };
    if (tenantId) where.tenantId = tenantId;
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }

  async getByPeriod(from: string, to: string, tenantId?: string) {
    const where: any = {
      occurredAt: {
        gte: new Date(from),
        lte: new Date(to),
      },
    };
    if (tenantId) where.tenantId = tenantId;
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: 500,
    });
  }

  async getByTenant(tenantId: string, limit = 100) {
    return this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }

  /**
   * S224 BR224-1: chronological (ascending) per-document event timeline with
   * field-level diffs. Returns an empty array (never throws/404s) when a
   * document has zero events — BR224's own exception workflow requires an
   * empty state, not an error, for a document with no history.
   */
  async getDocumentHistory(tenantId: string, docType: string, docId: string): Promise<DocumentHistoryEvent[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId, entityType: docType, entityId: docId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      ts: row.occurredAt.toISOString(),
      actor: row.actorName || row.actorId,
      action: row.action,
      eventType: row.eventType,
      fieldDiffs: diffFields(row.previousState, row.newState),
      reason: row.reason ?? null,
    }));
  }

  /** True if rendering this document's history would surface at least one
   * PII-marked field diff (BR224-3 trigger for emitting audit.viewed). */
  historyContainsPii(events: DocumentHistoryEvent[]): boolean {
    return events.some((e) => e.fieldDiffs.some((d) => isPiiField(d.field)));
  }

  /** S224 BR224-4: per-document CSV export, exact parity with the on-screen
   * timeline (same rows, same field-diff content, flattened to one column
   * per changed field name/before/after triple per row). */
  documentHistoryToCsv(events: DocumentHistoryEvent[]): string {
    const header = 'timestamp,actor,action,eventType,field,before,after,reason';
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [header];
    for (const e of events) {
      if (e.fieldDiffs.length === 0) {
        lines.push([e.ts, e.actor, e.action, e.eventType, '', '', '', e.reason ?? ''].map(escape).join(','));
        continue;
      }
      for (const d of e.fieldDiffs) {
        lines.push([e.ts, e.actor, e.action, e.eventType, d.field,
          typeof d.before === 'object' ? JSON.stringify(d.before) : d.before,
          typeof d.after === 'object' ? JSON.stringify(d.after) : d.after,
          e.reason ?? ''].map(escape).join(','));
      }
    }
    return lines.join('\n');
  }
}
