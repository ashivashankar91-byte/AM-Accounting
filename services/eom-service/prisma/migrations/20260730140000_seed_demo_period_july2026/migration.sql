-- Runtime stabilization: GET /api/v1/gl/periods (gl-service.getPeriods)
-- reads the list of eom_closes from eom-service, not coa-service's
-- fiscal_period table. Without a row here, /gl/periods always returned []
-- even after fiscal periods existed in coa-service. Seed the current
-- (July 2026) period as IN_PROGRESS and June as CLOSED so period-aware
-- screens (journal entry date picker, EOM readiness) have real data.
INSERT INTO "eom_closes" ("id", "tenant_id", "period_year", "period_month", "close_type", "status", "started_at", "completed_at")
VALUES
  ('eomclose-kunes-2026-06', 'tenant-kunes', 2026, 6, 'MONTHLY', 'CLOSED',      '2026-07-01 00:00:00', '2026-07-02 00:00:00'),
  ('eomclose-kunes-2026-07', 'tenant-kunes', 2026, 7, 'MONTHLY', 'IN_PROGRESS', '2026-07-30 00:00:00', NULL)
ON CONFLICT ("tenant_id", "period_year", "period_month", "close_type") DO NOTHING;
