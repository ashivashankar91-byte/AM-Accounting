-- CE-10 (S124) — result-store immutability + append-only enforcement,
-- mirroring posting-recovery-service's proven
-- 20260729010002_add_immutability_posting_recovery_svc pattern (BEFORE
-- trigger raising an exception, not merely relying on application code).
--
-- tax_result / tax_result_line: AC per the epic — "Result immutability:
-- stored verbatim as evidence; recalculation creates a new result linked
-- to the document version — results are never edited." No UPDATE or
-- DELETE, ever, on either table.

CREATE OR REPLACE FUNCTION tax_service_prevent_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    '% is immutable/append-only. Modification of tax evidence is prohibited. Attempted operation: %, Record ID: %',
    TG_TABLE_NAME, TG_OP, OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tax_result_immutable ON tax_result;
CREATE TRIGGER tax_result_immutable
BEFORE UPDATE OR DELETE ON tax_result
FOR EACH ROW
EXECUTE FUNCTION tax_service_prevent_modification();

DROP TRIGGER IF EXISTS tax_result_line_immutable ON tax_result_line;
CREATE TRIGGER tax_result_line_immutable
BEFORE UPDATE OR DELETE ON tax_result_line
FOR EACH ROW
EXECUTE FUNCTION tax_service_prevent_modification();

DROP TRIGGER IF EXISTS tax_integrity_alert_append_only ON tax_integrity_alert;
CREATE TRIGGER tax_integrity_alert_append_only
BEFORE UPDATE OR DELETE ON tax_integrity_alert
FOR EACH ROW
EXECUTE FUNCTION tax_service_prevent_modification();

DROP TRIGGER IF EXISTS tax_engine_attempt_log_append_only ON tax_engine_attempt_log;
CREATE TRIGGER tax_engine_attempt_log_append_only
BEFORE UPDATE OR DELETE ON tax_engine_attempt_log
FOR EACH ROW
EXECUTE FUNCTION tax_service_prevent_modification();

DROP TRIGGER IF EXISTS tax_exception_disposition_append_only ON tax_exception_disposition;
CREATE TRIGGER tax_exception_disposition_append_only
BEFORE UPDATE OR DELETE ON tax_exception_disposition
FOR EACH ROW
EXECUTE FUNCTION tax_service_prevent_modification();

DROP TRIGGER IF EXISTS fee_table_usage_reference_append_only ON fee_table_usage_reference;
CREATE TRIGGER fee_table_usage_reference_append_only
BEFORE UPDATE OR DELETE ON fee_table_usage_reference
FOR EACH ROW
EXECUTE FUNCTION tax_service_prevent_modification();
