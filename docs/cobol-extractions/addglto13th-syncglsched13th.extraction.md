# COBOL Extraction: addglto13th.cbl + syncglsched13th.cbl

## addglto13th.cbl

**Program ID**: ADDGLTO13TH  
**Size**: ~340 lines  
**Purpose**: Copies new GL accounts (added after the 13th month snapshot was taken) from the live GL file into the 13th month snapshot file. Run by 13thmenu.cbl on every entry.

### Algorithm

```
Open live-GL-file  (ADDGLTO13TH-2ND-GL-FILENAME)
Open snapshot-GL-file  (ADDGLTO13TH-GL-FILENAME) I-O

For each record in live-GL-file:
  READ snapshot-GL-file by GL-ACCTNO
  If NOT FOUND:
    WRITE record to snapshot-GL-file  (new account — copy structural fields only)
    // Does NOT copy balances/counts — new GL starts at zero in 13th month
  If FOUND:
    Skip (account already in snapshot)
```

### What Gets Copied

Only the **structural** fields of the GL record (account number, account name, GL type, cost/inv flags, etc.). Balance and count fields are NOT copied — the 13th month starts fresh for new accounts.

### TypeScript Verdict: **ELIMINATED**

In TypeScript, all GL records (including new ones added mid-year) are already in the same Postgres table with `periodYear`/`periodMonth` columns. Querying `periodMonth = 13` automatically includes all accounts — no snapshot synchronization needed.

---

## syncglsched13th.cbl

**Program ID**: SYNCGLSCHED13TH  
**Size**: ~258 lines  
**Purpose**: Ensures that schedule records in the 13th month snapshot file have corresponding schedule records in the snapshot sched file. Run during EOM/13th month processing.

### Algorithm

```
Open detail-snapshot-file (detail13thmoYYYY)
Open sched-snapshot-file (sched13thmoYYYY) I-O

For each detail record:
  READ sched-snapshot-file by DE-SCHEDNO
  If NOT FOUND:
    // Find schedule record from live sched file
    READ live-sched-file by DE-SCHEDNO
    WRITE to sched-snapshot-file
```

### Purpose

Prevents orphaned detail records in the 13th month snapshot (detail records that reference a schedule that wasn't in the sched snapshot). This was needed because the sched snapshot was taken at EOM but detail records could reference schedules added after the snapshot.

### TypeScript Verdict: **ELIMINATED**

In TypeScript:
- `ScheduleDetail` has FK to `Schedule` enforced by Prisma/Postgres
- No snapshot files = no orphan risk
- `periodMonth = 13` filter on detail records + FK join to schedule handles this automatically
- Prisma unique constraint on `(tenantId, scheduleNumber)` prevents duplicates

---

## Summary

Both programs exist solely to maintain consistency between COBOL ISAM snapshot files. Since TypeScript uses relational Postgres with FK constraints and period-based filtering, both programs have **zero equivalents** in the TypeScript architecture.
