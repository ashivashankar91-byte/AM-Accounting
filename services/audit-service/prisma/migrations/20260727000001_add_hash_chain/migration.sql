-- S007 BR7-2: hash chain makes tampering in audit_logs detectable.
-- Additive-only; audit_logs remains append-only (immutable trigger unchanged,
-- see make_auditlog_immutable.sql). No existing column is altered or dropped.
--
-- Design note (deliberate deviation from a literal "WRITTEN -> CHAINED via a
-- later hash job" reading of the story packet): audit_logs rows cannot be
-- UPDATEd after insert (the immutable_audit_log trigger blocks it), so a
-- background job that back-fills hashPrev/hashSelf onto already-inserted rows
-- is architecturally impossible without weakening that trigger. Instead, the
-- chain is computed SYNCHRONOUSLY at insert time (see AuditService.log):
-- every new row commits to (hashPrev + this row's own content) the moment it
-- is written, inside the same transaction as the write itself. This is
-- strictly stronger than an async job (there is never a window where a row
-- is unchained) and requires no relaxation of the immutability guarantee.
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "hash_prev" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "hash_self" TEXT;

-- Logical partition key (month + tenant), per the BR7-2 field inventory
-- ("audit_event ... partitioned by month+tenant"). Implemented as a
-- generated column (not native Postgres declarative table partitioning):
-- converting an existing table to declarative partitioning requires
-- recreating it, which is destructive DDL and explicitly out of scope
-- ("Additive migrations only; no destructive DDL"). This generated, indexed
-- column gives partition-scoped chain verification and querying today, and
-- is exactly the partition expression a later physical-partitioning
-- migration would reuse — recorded as a known follow-up, not silently
-- dropped.
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "partition_key" TEXT
  GENERATED ALWAYS AS (
    lpad(date_part('year', "occurred_at")::text, 4, '0') || '-' ||
    lpad(date_part('month', "occurred_at")::text, 2, '0') || ':' || "tenant_id"
  ) STORED;

CREATE INDEX IF NOT EXISTS "audit_logs_partition_key_idx" ON "audit_logs" ("partition_key", "occurred_at", "id");

-- Chain-anchor bookkeeping: the current tail hash for each partition, so the
-- next insert into that partition knows what hashPrev to chain from. This
-- table is ordinary, mutable bookkeeping (a pointer), NOT audit evidence
-- itself — the append-only/immutability guarantee applies to audit_logs,
-- never to this table. It intentionally carries no tenant_id column and is
-- not RLS-enabled: it stores only opaque hash pointers keyed by a partition
-- key that already embeds the tenant id, no audit content.
CREATE TABLE IF NOT EXISTS "audit_chain_anchors" (
  "partition_key" TEXT PRIMARY KEY,
  "tail_hash" TEXT,
  "tail_audit_log_id" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
