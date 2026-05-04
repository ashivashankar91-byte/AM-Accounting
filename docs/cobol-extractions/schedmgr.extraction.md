# Extraction: schedmgr.cbl

**Decision: BUILD** — GL↔Schedule linkage management implemented as `ScheduleManager` service.

---

## Source

`acct/src/schedmgr.cbl` — ~28,802 bytes (fully read)
`acct/copy/schedmgr.ws` — 52 lines (fully read)

---

## Summary

`schedmgr` is a stateless subroutine (`IS INITIAL`) called by `schedup` whenever a change to a schedule master record requires corresponding changes to either (a) the DETAIL-MF records or (b) the GL-MF records that reference this schedule. It is never called directly by users — only indirectly through the schedule maintenance screen.

It implements 7 operations dispatched by `LINK-FUNCTION`:

| Code | Operation | Description |
|------|-----------|-------------|
| `CC` | CHECK-COMPATIBILITY | Validate if schedule type change is allowed |
| `DS` | DELETE-SCHEDULE | Delete all detail records for a schedule number |
| `DA` | DELETE-ACCOUNT | Delete detail records for specific GL accounts |
| `MA` | MOVE-ACCOUNT | Move detail records from one schedule to another |
| `CS` | CONVERT-SCHED-TYPE | Convert detail records from one type to another |
| `RG` | RESET-GL-SCHDNO | Set `GL-SCHDNO = 0` on GL records (unlink) |
| `SG` | SET-GL-SCHDNO | Set `GL-SCHDNO = target schedule` on GL records |
| `FC` | FORCE-GL-REQ-CONTNO | Force GL accounts to require a control number |

---

## SCHEDMGR-LINK-AREA (Input/Output contract)

```cobol
01 SCHEDMGR-LINK-AREA.
  03 LINK-FUNCTION           PIC XX.   -- operation code (see table above)
  03 LINK-VALID-MIS-AT-LOGIN PIC X.    -- "Y" if super/MIS password used
  03 LINK-RESPONSE           PIC X.    -- OUT: "Y"=success, "N"=failure
  03 LINK-FROM-SCHEDULE      PIC 99.   -- source schedule# (0=look up from GL)
  03 LINK-TO-SCHEDULE        PIC 99.   -- target schedule#
  03 LINK-DELETE-SCHEDULE    PIC 99.   -- schedule# to delete (for DS/DA)
  03 LINK-FROM-TYPE          PIC 9.    -- source type (0=look up)
  03 LINK-TO-TYPE            PIC 9.    -- target type
  03 LINK-GLACCTNO(1..5)     PIC X(5). -- GL account numbers to operate on
  03 LINK-GLACCTNO-CUR-SCHDNO(1..5) PIC 99. -- OUT: current schedule# on each GL
  03 LINK-GLACCTNO-CUR-TYPE(1..5)   PIC 9.  -- OUT: current type of each GL's schedule
  03 LINK-GL-SUB             PIC 9.    -- internal loop counter
```

---

## Operation Algorithms

### CC — CHECK-COMPATIBILITY

Validates whether the from-type → to-type schedule type change is allowed (without data conversion requiring programmer intervention).

**Allowed conversions (no programmer needed):**

| From | To | Note |
|------|----|------|
| 1 | 1 | Same type |
| 2 | 2 | Same type |
| 2 | 4 | Compatible |
| 3 | 3 | Same type |
| 4 | 2 | Compatible |
| 4 | 4 | Same type |
| 5 | 5 | Same type |

**All other combinations are BLOCKED** — require programmer intervention (dialog shown to user, `LINK-RESPONSE = "N"`).

### DS — DELETE-SCHEDULE + DA — DELETE-ACCOUNT

```
DS: delete all DETAIL-MF records where DE-SCHDNO = LINK-DELETE-SCHEDULE
DA: delete DETAIL-MF records where DE-ACCTNO ∈ LINK-GLACCTNO[] (any of 5)
    (only within the schedule defined by LINK-DELETE-SCHEDULE)

Algorithm:
  START DETAIL-MF at first record (LOW-VALUES)
  loop:
    READ DETAIL-MF NEXT (no lock)
    if DE-SCHDNO > target → stop
    if DS: match on SCHDNO
    if DA: match on ACCTNO ∈ supplied list
    → READ DETAIL-MF (with lock, retry on "99")
    → DELETE DETAIL-MF RECORD
```

### MA — MOVE-ACCOUNT + CS — CONVERT-SCHED-TYPE

Moves detail records associated with a set of GL accounts to a new schedule, optionally converting the key structure if the schedule type changes.

```
For each GL account in LINK-GLACCTNO[]:
  START DETAIL-MF at first record for DE-SCHDNO = source
  loop:
    READ NEXT (no lock)
    if DE-ACCTNO = this GL:
      READ (with lock, retry on "99")
      SAVE-DETAIL-REC = DETAIL-REC
      DELETE old record
      DETAIL-REC = SAVE-DETAIL-REC
      DE-SCHDNO = LINK-TO-SCHEDULE
      if from-type ≠ to-type: PERFORM 4000-CONVERT
      WRITE DETAIL-REC (with SEQNO auto-increment on collision)
```

### 4000-CONVERT — Type Conversion Rules

When moving records between schedules of different types, the key fields are transformed:

| From | To | Conversion |
|------|----|------------|
| 1→2/3/4 | 1TO2 | Copy `DE-CONTNO → DE-CONTNO3` (control number preserved) |
| 1→5 | 1TO5 | Copy contno; copy refno1 → applyno; detect bal-fwd by numeric aging fields |
| 2→1/3→1/4→1 | 2TO1 | If bal-fwd: set source=00, refno="BALFRW", date=last-close-date; else copy source/refno |
| 2→3 | 2TO3 | If bal-fwd: compute total = sum(4 aging buckets), set refno="BALFWD", date=last-close-date |
| 2→5/3→5/4→5 | 2TO5 | Set applyno from refno; set apply-cd="#" (detail) or "!" (bal-fwd) |
| 5→1 | 5TO1 | If apply-cd="!" (bal-fwd): source=00, refno="BALFRW"; else copy source/refno/date |
| 5→2/3/4 | 5TO2 | If bal-fwd: date=zeros; else copy date from DE-DATE1 |

**Balance-forward detection**: A record is a balance-forward if `DE-BAL-CUR`, `DE-BAL-OVR30`, `DE-BAL-OVR60`, `DE-BAL-OVR90` are all numeric (i.e., the record uses the balance-forward layout vs. the detail layout). For type 5, `apply-cd = "!"` = bal-fwd, `apply-cd = "#"` = regular detail.

### RG — RESET-GL-SCHDNO

For each GL in LINK-GLACCTNO[]:
- READ GL-MF → check `GL-SCHDNO ≠ 0`
- READ GL-MF WITH LOCK (retry on "99")
- Set `GL-SCHDNO = 0`
- REWRITE GL-REC
- If `ACCT-SYNC-ON = "Y"`: call glsync to propagate to database

### SG — SET-GL-SCHDNO

For each GL in LINK-GLACCTNO[]:
- READ GL-MF → check `GL-SCHDNO ≠ target`
- If `GL-SCHDNO ≠ 0`: read and potentially remove GL from its current schedule (auto-delete schedule if empty, with user confirmation dialog)
- READ GL-MF WITH LOCK (retry on "99")
- Set `GL-SCHDNO = LINK-TO-SCHEDULE`
- REWRITE GL-REC
- If `ACCT-SYNC-ON`: call glsync

### FC — FORCE-GL-REQ-CONTNO

For each GL in LINK-GLACCTNO[]:
- If type=5 and `GL-REQ-CONTNO` already = "A": skip
- If type=2 and `GL-REQ-CONTNO` already = "L": skip
- Otherwise: READ WITH LOCK, set `GL-REQ-CONTNO` based on type (type 5 → "A", type 2 → "L"), REWRITE

---

## TypeScript Replacement

### `ScheduleManager` application service

```typescript
class ScheduleManager {
  // Check if type change is allowed (returns allowed: boolean)
  checkTypeCompatibility(fromType: ScheduleType, toType: ScheduleType): boolean
  
  // Delete all details for a schedule
  deleteScheduleDetails(tenantId: string, scheduleNumber: string): Promise<number>
  
  // Delete details for specific GL accounts within a schedule
  deleteAccountDetails(tenantId: string, scheduleNumber: string, glAccountNumbers: string[]): Promise<number>
  
  // Move GL account detail records to a different schedule
  moveAccountDetails(
    tenantId: string,
    glAccountNumbers: string[],
    toScheduleNumber: string,
    fromType: ScheduleType,
    toType: ScheduleType
  ): Promise<void>
  
  // Convert detail records in-place to a new schedule type
  convertScheduleType(
    tenantId: string,
    scheduleNumber: string,
    glAccountNumbers: string[],
    fromType: ScheduleType,
    toType: ScheduleType
  ): Promise<void>
  
  // Update GL accounts' schedule linkage (via gl-service API)
  resetGlScheduleLinkage(tenantId: string, glAccountNumbers: string[]): Promise<void>
  setGlScheduleLinkage(tenantId: string, glAccountNumbers: string[], targetSchedule: string): Promise<void>
  forceGlRequireControlNumber(tenantId: string, glAccountNumbers: string[], scheduleType: ScheduleType): Promise<void>
}
```

### Type compatibility matrix (enforced in domain)

```typescript
const COMPATIBLE_TYPE_CHANGES = new Set([
  '1→1', '2→2', '2→4', '3→3', '4→2', '4→4', '5→5'
]);

function isCompatibleTypeChange(from: number, to: number): boolean {
  return COMPATIBLE_TYPE_CHANGES.has(`${from}→${to}`);
}
```

### GL linkage updates

`resetGlScheduleLinkage` and `setGlScheduleLinkage` must call **gl-service** via HTTP since GL records are owned by gl-service. These calls go to:
```
PATCH /api/v1/gl-accounts/:acctNo  { scheduleNumber: null | "05" }
```

---

## Backup Note

The COBOL `schedmgr.cbl` comments mention "A backup of the detail file is taken for any call to this program that will alter the detail file." In TypeScript, this is replaced by database transactions — if the move/convert fails partway, the Prisma transaction rolls back automatically.

---

## Traceability

- **COBOL program**: `acct/src/schedmgr.cbl`
- **Copybook**: `acct/copy/schedmgr.ws`
- **TypeScript location**:
  - Domain: `amacc/services/schedule-service/src/domain/schedule-manager.ts`
  - Application: `amacc/services/schedule-service/src/application/schedule-service.ts` (orchestrates calls)
  - Routes: `PUT /api/v1/schedules/:id` triggers `ScheduleManager` on field changes
