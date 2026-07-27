-- DEFECT FIX (discovered while verifying the BR7-2 hash-chain migration
-- against a fresh dev database): the file this content was copied from,
-- prisma/migrations/make_auditlog_immutable.sql, sat directly inside
-- prisma/migrations/ instead of inside its own timestamped subfolder.
-- `prisma migrate deploy` only discovers migration.sql files inside
-- subdirectories matching its migration-folder naming convention, so this
-- trigger was NEVER actually applied by the standard deploy path — verified
-- by running `prisma migrate deploy` against a live dev database and then
-- querying pg_trigger for audit_logs, which returned zero rows despite the
-- RLS migration's own comments and schema.prisma's doc-comment both
-- asserting the trigger "already" exists. The audit_logs table's core SOX/
-- SOC2 append-only guarantee did not actually exist in any environment
-- deployed via `prisma migrate deploy`. This migration is the fix: the
-- same trigger DDL, now in a folder Prisma actually applies. The stray
-- top-level file is left in place only as a pointer comment (not deleted,
-- to preserve history) — see that file for the redirect note.
--
-- Prevent any UPDATE or DELETE on audit_logs (AuditLog)
-- This makes the audit trail physically tamper-proof at the database level.
-- Required for SOX, SOC 2, and regulatory compliance.

CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'AuditLog records are immutable. Modification of audit trail is prohibited. Attempted operation: %, Record ID: %',
    TG_OP,
    OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Protect audit_logs table
DROP TRIGGER IF EXISTS immutable_audit_log ON audit_logs;

CREATE TRIGGER immutable_audit_log
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_modification();
