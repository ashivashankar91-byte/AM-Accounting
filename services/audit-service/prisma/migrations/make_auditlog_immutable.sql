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
