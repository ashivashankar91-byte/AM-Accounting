-- CE-07 — schedule-service's open-item relief path (ScheduleOpenItem.
-- itemNumber match, gated by applyCd='#') was structurally unreachable
-- through gl-service's real posting API: journal_lines had apply_cd and
-- control_number but no apply_number column, so gl-service.ts's outbox
-- payload construction (`applyNumber: line.applyCd === '#' ? (line.
-- applyNumber ?? null) : null`) could never produce a non-null value for a
-- journal created via POST /journal-entries — every schedule-relevant
-- posted line became a NEW open item, never an application/relief,
-- regardless of caller intent. Additive column only.

ALTER TABLE "journal_lines" ADD COLUMN "apply_number" VARCHAR(20);
