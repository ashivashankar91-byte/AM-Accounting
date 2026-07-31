-- S021 Posting Recovery — database-level immutability / append-only
-- enforcement, mirroring audit-service's proven
-- 20260727000002_make_auditlog_immutable pattern (BEFORE trigger raising an
-- exception, not merely relying on application code).

-- 1. posting_dead_letter: the original-event fields are immutable forever;
--    no row may ever be hard-deleted (recovery lineage is permanent).
--    Everything else (status, assigned_owner, escalation_state,
--    attempt_count, latest_failure_*, journal_reference, version,
--    updated_at) remains updatable — this is the live case record.
CREATE OR REPLACE FUNCTION posting_dead_letter_protect_original_event()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'posting_dead_letter rows cannot be deleted (recovery lineage is permanent). Record ID: %', OLD.id;
  END IF;

  IF NEW.source_event_id IS DISTINCT FROM OLD.source_event_id THEN
    RAISE EXCEPTION 'posting_dead_letter.source_event_id is immutable. Record ID: %', OLD.id;
  END IF;
  IF NEW.event_schema_version IS DISTINCT FROM OLD.event_schema_version THEN
    RAISE EXCEPTION 'posting_dead_letter.event_schema_version is immutable. Record ID: %', OLD.id;
  END IF;
  IF NEW.source_entity_id IS DISTINCT FROM OLD.source_entity_id THEN
    RAISE EXCEPTION 'posting_dead_letter.source_entity_id is immutable. Record ID: %', OLD.id;
  END IF;
  IF NEW.correlation_id IS DISTINCT FROM OLD.correlation_id THEN
    RAISE EXCEPTION 'posting_dead_letter.correlation_id is immutable. Record ID: %', OLD.id;
  END IF;
  IF NEW.causation_id IS DISTINCT FROM OLD.causation_id THEN
    RAISE EXCEPTION 'posting_dead_letter.causation_id is immutable. Record ID: %', OLD.id;
  END IF;
  IF NEW.original_event_timestamp IS DISTINCT FROM OLD.original_event_timestamp THEN
    RAISE EXCEPTION 'posting_dead_letter.original_event_timestamp is immutable. Record ID: %', OLD.id;
  END IF;
  IF NEW.original_event_published_at IS DISTINCT FROM OLD.original_event_published_at THEN
    RAISE EXCEPTION 'posting_dead_letter.original_event_published_at is immutable. Record ID: %', OLD.id;
  END IF;
  IF NEW.posting_idempotency_key IS DISTINCT FROM OLD.posting_idempotency_key THEN
    RAISE EXCEPTION 'posting_dead_letter.posting_idempotency_key is immutable. Record ID: %', OLD.id;
  END IF;
  IF NEW.payload IS DISTINCT FROM OLD.payload THEN
    RAISE EXCEPTION 'posting_dead_letter.payload is immutable. Record ID: %', OLD.id;
  END IF;
  IF NEW.payload_hash IS DISTINCT FROM OLD.payload_hash THEN
    RAISE EXCEPTION 'posting_dead_letter.payload_hash is immutable. Record ID: %', OLD.id;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'posting_dead_letter.tenant_id is immutable. Record ID: %', OLD.id;
  END IF;
  IF NEW.first_failure_at IS DISTINCT FROM OLD.first_failure_at THEN
    RAISE EXCEPTION 'posting_dead_letter.first_failure_at is immutable. Record ID: %', OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS posting_dead_letter_immutability ON posting_dead_letter;
CREATE TRIGGER posting_dead_letter_immutability
BEFORE UPDATE OR DELETE ON posting_dead_letter
FOR EACH ROW
EXECUTE FUNCTION posting_dead_letter_protect_original_event();

-- 2. Append-only children: no UPDATE or DELETE, ever.
CREATE OR REPLACE FUNCTION posting_recovery_prevent_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only. Modification of recovery history is prohibited. Attempted operation: %, Record ID: %',
    TG_TABLE_NAME, TG_OP, OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS posting_dead_letter_failure_append_only ON posting_dead_letter_failure;
CREATE TRIGGER posting_dead_letter_failure_append_only
BEFORE UPDATE OR DELETE ON posting_dead_letter_failure
FOR EACH ROW
EXECUTE FUNCTION posting_recovery_prevent_modification();

DROP TRIGGER IF EXISTS posting_replay_attempt_append_only ON posting_replay_attempt;
CREATE TRIGGER posting_replay_attempt_append_only
BEFORE UPDATE OR DELETE ON posting_replay_attempt
FOR EACH ROW
EXECUTE FUNCTION posting_recovery_prevent_modification();

DROP TRIGGER IF EXISTS posting_correction_revision_append_only ON posting_correction_revision;
CREATE TRIGGER posting_correction_revision_append_only
BEFORE UPDATE OR DELETE ON posting_correction_revision
FOR EACH ROW
EXECUTE FUNCTION posting_recovery_prevent_modification();

DROP TRIGGER IF EXISTS posting_case_transition_append_only ON posting_case_transition;
CREATE TRIGGER posting_case_transition_append_only
BEFORE UPDATE OR DELETE ON posting_case_transition
FOR EACH ROW
EXECUTE FUNCTION posting_recovery_prevent_modification();

DROP TRIGGER IF EXISTS posting_case_assignment_append_only ON posting_case_assignment;
CREATE TRIGGER posting_case_assignment_append_only
BEFORE UPDATE OR DELETE ON posting_case_assignment
FOR EACH ROW
EXECUTE FUNCTION posting_recovery_prevent_modification();
