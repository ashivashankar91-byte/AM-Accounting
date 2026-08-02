-- CE-07 final defect closure — legal-entity isolation for rule packs.
--
-- Root cause: posting_rule_pack (the stable parent/identity row for a
-- packKey) carried no entity_id at all, so two legal entities in the same
-- tenant could not even create independently-identified packs with the same
-- key without colliding on the (tenant_id, pack_key) unique constraint —
-- and activateVersion's supersede query / submitEvent's candidate-selection
-- query never filtered by entity, so activating a version in one entity
-- could supersede another entity's active version, and an event from one
-- entity could be matched against another entity's active pack.
-- posting_rule_pack_version ALREADY had entity_id (see
-- 20260729010000_add_posting_engine) — this migration brings the PARENT
-- table and the EXECUTION evidence table up to the same standard, and
-- widens both uniqueness constraints that previously ignored entity_id.
--
-- Additive only: no historical migration is rewritten, no prisma db push.
-- Both new entity_id columns are added nullable, backfilled, THEN (for
-- posting_rule_pack, where every row is expected to resolve) set NOT NULL.
-- posting_execution.entity_id stays nullable permanently — it is
-- denormalized best-effort evidence, not an identity column (see
-- schema.prisma doc-comment on PostingExecution.entityId).

-- ── posting_rule_pack: add entity_id ────────────────────────────────────────
ALTER TABLE "posting_rule_pack" ADD COLUMN "entity_id" TEXT;

-- Backfill: every currently-existing pack was, prior to this fix, only ever
-- populated by a single legal entity in practice (the defect this migration
-- closes prevented a second entity from EVER successfully sharing a packKey
-- row — createRulePackVersion's find-or-create always reused the same
-- parent row across entities, so all of that row's versions carry the same
-- entity_id in the overwhelming common case). MIN(entity_id) per
-- rule_pack_id is used as a deterministic, conservative backfill choice: if
-- a pack's versions somehow already span more than one entity_id (a
-- pre-existing data anomaly this migration does not attempt to silently
-- auto-split), the pack is conservatively assigned its lowest entity_id and
-- remains fully queryable/auditable; splitting such a row is an explicit,
-- reviewed data-remediation action, not a migration-time heuristic.
UPDATE "posting_rule_pack" p
SET "entity_id" = sub.min_entity_id
FROM (
  SELECT "rule_pack_id", MIN("entity_id") AS min_entity_id
  FROM "posting_rule_pack_version"
  GROUP BY "rule_pack_id"
) sub
WHERE sub."rule_pack_id" = p."id";

-- Any pack row with zero versions (draft creation failed mid-transaction
-- before a version was ever written, or otherwise orphaned) has no entity
-- to backfill from — assign a fixed, greppable sentinel so NOT NULL can
-- still be enforced without fabricating a plausible-looking entity id.
UPDATE "posting_rule_pack" SET "entity_id" = 'ce07-unbackfilled-orphan-pack' WHERE "entity_id" IS NULL;

ALTER TABLE "posting_rule_pack" ALTER COLUMN "entity_id" SET NOT NULL;

-- Widen posting_rule_pack's identity constraint to include entity_id.
DROP INDEX IF EXISTS "posting_rule_pack_tenant_id_pack_key_key";
CREATE UNIQUE INDEX "posting_rule_pack_tenant_id_entity_id_pack_key_key" ON "posting_rule_pack"("tenant_id", "entity_id", "pack_key");
CREATE INDEX "posting_rule_pack_tenant_id_entity_id_idx" ON "posting_rule_pack"("tenant_id", "entity_id");

-- ── posting_rule_pack_version: widen its own identity constraint ───────────
-- (tenant_id, pack_key, semver) alone forbade two entities from ever both
-- authoring their own "1.0.0" of the same packKey — an explicit
-- certification requirement ("each entity can independently activate
-- version 1"). entity_id already exists on this table since
-- 20260729010000_add_posting_engine; only the constraint needs widening.
DROP INDEX IF EXISTS "posting_rule_pack_version_tenant_id_pack_key_semver_key";
CREATE UNIQUE INDEX "posting_rule_pack_version_entity_pack_semver_key" ON "posting_rule_pack_version"("tenant_id", "entity_id", "pack_key", "semver");
CREATE INDEX "posting_rule_pack_version_entity_event_status_idx" ON "posting_rule_pack_version"("tenant_id", "entity_id", "event_type", "status");

-- ── posting_execution: denormalized entity_id for lineage/inquiry/audit ────
ALTER TABLE "posting_execution" ADD COLUMN "entity_id" TEXT;

-- Best-effort backfill for historical rows from their own stored envelope.
-- Rows predating this fix have no legalEntityId key in event_envelope at
-- all (the field did not exist on the canonical envelope type) and are left
-- NULL — deliberately, not defaulted to a guessed value; a NULL entity_id
-- on a pre-CE-07 execution is honest evidence, not a gap this migration
-- should paper over.
UPDATE "posting_execution"
SET "entity_id" = "event_envelope"->>'legalEntityId'
WHERE "event_envelope"->>'legalEntityId' IS NOT NULL;

CREATE INDEX "posting_execution_tenant_id_entity_id_idx" ON "posting_execution"("tenant_id", "entity_id");
