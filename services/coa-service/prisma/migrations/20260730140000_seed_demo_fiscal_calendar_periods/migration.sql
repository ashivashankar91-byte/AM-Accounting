-- Runtime stabilization: FY2026 fiscal calendar + monthly periods for the
-- demo legal entity, so period-dependent GL posting/close/inquiry features
-- have real periods to operate against (previously fiscal_period was
-- entirely empty). July (period 7) is OPEN; prior months are HARD_CLOSED;
-- later months are FUTURE. entity_id matches
-- tenant-service's 20260730140000_seed_demo_tenant_entity_store.
INSERT INTO "fiscal_calendar" ("id", "tenant_id", "entity_id", "fy_start_month", "structure", "status", "actor")
VALUES ('calendar-kunes-delavan-2026', 'tenant-kunes', 'entity-kunes-delavan', 1, 'TWELVE', 'DEFINED', 'system-bootstrap')
ON CONFLICT ("entity_id") DO NOTHING;

INSERT INTO "fiscal_period"
  ("id", "tenant_id", "entity_id", "calendar_id", "fiscal_year", "period_number", "code", "start_date", "end_date", "status", "has_postings")
VALUES
  ('period-kunes-2026-01', 'tenant-kunes', 'entity-kunes-delavan', 'calendar-kunes-delavan-2026', 2026, 1, '2026-01', '2026-01-01', '2026-01-31', 'HARD_CLOSED', false),
  ('period-kunes-2026-02', 'tenant-kunes', 'entity-kunes-delavan', 'calendar-kunes-delavan-2026', 2026, 2, '2026-02', '2026-02-01', '2026-02-28', 'HARD_CLOSED', false),
  ('period-kunes-2026-03', 'tenant-kunes', 'entity-kunes-delavan', 'calendar-kunes-delavan-2026', 2026, 3, '2026-03', '2026-03-01', '2026-03-31', 'HARD_CLOSED', false),
  ('period-kunes-2026-04', 'tenant-kunes', 'entity-kunes-delavan', 'calendar-kunes-delavan-2026', 2026, 4, '2026-04', '2026-04-01', '2026-04-30', 'HARD_CLOSED', false),
  ('period-kunes-2026-05', 'tenant-kunes', 'entity-kunes-delavan', 'calendar-kunes-delavan-2026', 2026, 5, '2026-05', '2026-05-01', '2026-05-31', 'HARD_CLOSED', false),
  ('period-kunes-2026-06', 'tenant-kunes', 'entity-kunes-delavan', 'calendar-kunes-delavan-2026', 2026, 6, '2026-06', '2026-06-01', '2026-06-30', 'HARD_CLOSED', false),
  ('period-kunes-2026-07', 'tenant-kunes', 'entity-kunes-delavan', 'calendar-kunes-delavan-2026', 2026, 7, '2026-07', '2026-07-01', '2026-07-31', 'OPEN', false),
  ('period-kunes-2026-08', 'tenant-kunes', 'entity-kunes-delavan', 'calendar-kunes-delavan-2026', 2026, 8, '2026-08', '2026-08-01', '2026-08-31', 'FUTURE', false),
  ('period-kunes-2026-09', 'tenant-kunes', 'entity-kunes-delavan', 'calendar-kunes-delavan-2026', 2026, 9, '2026-09', '2026-09-01', '2026-09-30', 'FUTURE', false),
  ('period-kunes-2026-10', 'tenant-kunes', 'entity-kunes-delavan', 'calendar-kunes-delavan-2026', 2026, 10, '2026-10', '2026-10-01', '2026-10-31', 'FUTURE', false),
  ('period-kunes-2026-11', 'tenant-kunes', 'entity-kunes-delavan', 'calendar-kunes-delavan-2026', 2026, 11, '2026-11', '2026-11-01', '2026-11-30', 'FUTURE', false),
  ('period-kunes-2026-12', 'tenant-kunes', 'entity-kunes-delavan', 'calendar-kunes-delavan-2026', 2026, 12, '2026-12', '2026-12-01', '2026-12-31', 'FUTURE', false)
ON CONFLICT ("entity_id", "code") DO NOTHING;
