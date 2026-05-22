# Extraction: schedsync.cbl

**Decision: SKIP / REPLACED** — Prisma is the source of truth. No ISAM→DB sync needed.

---

## Source

`acct/src/schedsync.cbl` — 8,404 bytes

---

## Summary

`schedsync` makes an HTTP "invoker" call from COBOL to the AMPS web tier at `/accounting/api/{co}/acct/schedules/sync/{sched}` to synchronise a schedule master record from the COBOL ISAM file to the PostgreSQL database after any add, update, or delete operation. It exists because the legacy system used ISAM as the primary store and PostgreSQL as a secondary replica.

---

## Interface (COBOL)

```cobol
CALL "../../acct/prog/schedsync"
  USING LINK-RECORD
        SCHEDSYNC-LINK-AREA
```

**Input fields:**
| Field | Value | Description |
|-------|-------|-------------|
| `SCHEDSYNC-SND-ACT-ADD` | `"1"` | Add new schedule record to DB |
| `SCHEDSYNC-SND-ACT-UPDATE` | `"2"` | Update existing schedule record in DB |
| `SCHEDSYNC-SND-ACT-DELETE` | `"3"` | Delete schedule record from DB |
| `SCHEDSYNC-SND-SCHED` | 2-char schedule number | Schedule to sync |

**Called from**: `schedup.cbl` after every REWRITE/WRITE/DELETE on SCHEDULE-FILE.

---

## Why SKIP

In the TypeScript architecture, **PostgreSQL via Prisma is the primary store**. There is no secondary ISAM file. Every mutating operation goes directly to the database through `ScheduleRepository`. There is no sync step:

| COBOL pattern | TypeScript replacement |
|--------------|----------------------|
| `WRITE SCHEDULE-REC` then call `schedsync` with action=1 | `scheduleRepository.create(dto)` — single DB write |
| `REWRITE SCHEDULE-REC` then call `schedsync` with action=2 | `scheduleRepository.update(id, dto)` — single DB write |
| `DELETE SCHEDULE-FILE RECORD` then call `schedsync` with action=3 | `scheduleRepository.delete(id)` — single DB delete |

The `schedsync` invoke URL (`/acct/schedules/sync/{sched}`) was a migration bridge. It is not needed in the new microservice architecture.

---

## Traceability

- **COBOL program**: `acct/src/schedsync.cbl`
- **Decision**: Not implemented — replaced by Prisma as primary store
