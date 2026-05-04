# Extraction: getsched.cbl

**Decision: ABSORBED** — Trivial subroutine, no standalone TypeScript file needed.

---

## Source

`acct/src/getsched.cbl` — 2,363 bytes

---

## Summary

`getsched` is a minimal subroutine that opens the SCHEDULE-FILE ISAM index, reads a single record by its 2-character schedule number, and returns either the record or an error status. It is called via COBOL `CALL` by other programs that need to look up a schedule master record.

---

## Interface (COBOL)

```cobol
CALL "../../acct/prog/getsched"
  USING SCHED-FILENAME   -- PIC X(30): path to ISAM file
        SD-STATUS         -- PIC XX: returned file status
        SD-SCHDNO         -- PIC XX: INPUT key (2-char schedule number)
        SCHEDULE-REC      -- 60-byte record OUT
```

**Return statuses:**
| Code | Meaning |
|------|---------|
| `00` | Success — SCHEDULE-REC populated |
| `02` | Success with duplicate key (alt-key hit) |
| `23` | Record not found |
| `35` | File not found |

---

## Business Logic

1. Open SCHEDULE-FILE INPUT using the provided filename.
2. Move the caller's `SD-SCHDNO` to the file key.
3. `READ SCHEDULE-FILE` — check status.
4. Return SCHEDULE-REC to caller if successful, or return error status.

---

## Data Structure Returned (SCHEDULE-REC)

| Field | Type | Length | Description |
|-------|------|--------|-------------|
| `SD-SCHDNO` | PIC XX | 2 | Schedule number (primary key, numeric digits, right-justified) |
| `SD-TITLE` | PIC X(29) | 29 | Schedule description |
| `SD-RPT-SEQ` | PIC X | 1 | Report sort sequence: `C`=by control#, `N`=by name, `A`=by age |
| `SD-TYPE` | PIC 9 | 1 | Schedule type 1–5 (drives key structure of detail records) |
| `SD-GLACCTNO(1–5)` | PIC X(5) OCCURS 5 | 25 | Up to 5 linked GL account numbers |
| `SD-EOM-PURGE` | PIC 9 | 1 | EOM purge code 1–7 |
| `SD-CONT-NAMES` | PIC X | 1 | Control name display flag (`Y`/`2`=show names, `D`=deal owner, `V`=vehicle) |

Total record: 60 bytes.

---

## TypeScript Equivalent

This subroutine is fully absorbed into `ScheduleRepository.findById()` in `schedule-service/src/infrastructure/schedule-repository.ts`:

```typescript
async findById(tenantId: string, scheduleNumber: string): Promise<Schedule | null> {
  return this.prisma.schedule.findUnique({
    where: { tenantId_scheduleNumber: { tenantId, scheduleNumber } },
  });
}
```

No separate file is needed. All callers use `ScheduleRepository` directly.

---

## Traceability

- **COBOL program**: `acct/src/getsched.cbl`
- **Replaces**: direct SCHEDULE-FILE ISAM read
- **TypeScript location**: `amacc/services/schedule-service/src/infrastructure/schedule-repository.ts`
