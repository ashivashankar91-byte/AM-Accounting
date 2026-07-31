-- CE-07 integration slice — resolves the crash/restart recovery limitation
-- disclosed in S021's own certification report (S021_CERTIFICATION_REPORT.md,
-- "Known limitation ... No automatic reaper/timeout exists"):
--
-- ReplayService.replay() acquires REPLAY_IN_PROGRESS via an atomic DB-level
-- compare-and-swap before ever calling CH01. If the process crashes between
-- that CAS and the finalize transaction, the case was previously left
-- stuck in REPLAY_IN_PROGRESS forever with no automatic recovery — CH01's
-- own (tenantId, eventId) idempotency still made this financially safe (no
-- duplicate journal could result), but the case itself required manual
-- operator intervention with no visibility into how long it had been stuck.
--
-- This migration adds the timestamp the reaper (ReplayReaperService) needs
-- to detect a stale lock: replay_lock_acquired_at is set only when a case
-- transitions into REPLAY_IN_PROGRESS, and cleared when it leaves that
-- status (by the reaper or by a normal completed replay). It is a live-case
-- field (like status/version), not an original-event field, so the existing
-- posting_dead_letter_immutability trigger does not need modification —
-- that trigger's field list never included this column.

ALTER TABLE "posting_dead_letter" ADD COLUMN "replay_lock_acquired_at" TIMESTAMP(3);

-- Efficient reaper scan: "find every case stuck in REPLAY_IN_PROGRESS whose
-- lock is older than the staleness threshold", tenant-agnostic (the reaper
-- runs as a background/admin process across all tenants, each protected by
-- the same RLS policy every other query in this service already goes
-- through — see 20260729010001_add_rls_policies_posting_recovery_svc).
CREATE INDEX "posting_dead_letter_status_replay_lock_acquired_at_idx"
  ON "posting_dead_letter" ("status", "replay_lock_acquired_at");
