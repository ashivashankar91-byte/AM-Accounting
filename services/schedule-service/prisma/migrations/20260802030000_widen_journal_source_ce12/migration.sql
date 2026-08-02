-- CE-12 gap-closure — widen journal_source from CHAR(2) to VARCHAR(10) on
-- schedule_detail and schedule_open_item.
--
-- Root cause: coa-service's posting-engine JOURNAL_ENTRY_POSTED bridge
-- event (added for CE-12) sends its real journalSourceCode (coa-service's
-- own JournalSource.code is VarChar(6) — e.g. "CE12", "FLRPLN", "DEAL",
-- "FNI") into this column, which was CHAR(2) (a legacy gl-service PIC XX
-- convention). Postgres raises "value too long for type character(2)" on
-- any insert longer than 2 chars; schedule-service's RabbitMQ consumer
-- catches that exception and silently acks the message (poison-message
-- handling, by design, for an unrelated reason), so no ScheduleOpenItem
-- was ever created for any CE-12 posting — found via a real live-db proof
-- attempt, not by inspection.
--
-- Purely additive/widening: every existing 2-char value remains valid and
-- unaffected. The distinct 2-char VALIDATION rule for the manual schedule-
-- detail-entry endpoint (V-4, services/schedule-service/src/application/
-- schedule-service.ts's validateJournalSource / routes.ts's
-- CreateDetailSchema `z.string().max(2)`) is intentionally NOT touched —
-- that is a legitimate, separate legacy business rule for a human-entry
-- path unrelated to the automated posting-engine bridge this migration
-- fixes.

ALTER TABLE "schedule_details" ALTER COLUMN "journal_source" TYPE VARCHAR(10);
ALTER TABLE "schedule_open_items" ALTER COLUMN "journal_source" TYPE VARCHAR(10);
