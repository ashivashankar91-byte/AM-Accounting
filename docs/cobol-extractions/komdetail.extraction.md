# Extraction: komdetail.cbl

**Decision: BUILD** — Full CRUD interface becomes `ScheduleDetailRepository` with REST API.

---

## Source

`acct/src/komdetail.cbl` — ~35,010 bytes (~75% read; sufficient for extraction)

---

## Summary

`komdetail` is NOT a screen program. It accepts batched transactions from a pipe/file protocol (RECEIVE-FILE = line-sequential input), performs CRUD operations on DETAIL-MF (the schedule detail ISAM file), and writes results to a RESPONSE-FILE. It is the canonical write path for all schedule detail records in the legacy system. It validates that the schedule exists, parses keys by SD-TYPE, handles record locking with retry, auto-increments SEQNO on INSERT, and supports 4 operations: DELETE, INSERT, REPLACE, CHANGEKEY.

---

## Input Protocol

### File format (RECEIVE-FILE — line-sequential)

```
Line 1:  <writeback filename>            -- response file path
Line 2:  "1"                             -- version number
Line 3:  <module name>                   -- caller identifier
Line 4:  <company number>                -- 1-char company
Line 5:  "DIE" | "CONTINUE"             -- action-on-fail
--- per transaction ---
Line N:  <transaction-id>               -- echo'd back in response
Line N+1: "DELETE"|"INSERT"|"REPLACE"|"CHANGEKEY"
Line N+2: <pipe-delimited key fields>
--- data lines (for INSERT/REPLACE) ---
Line N+3...: field values
--- end ---
EOF
```

### Response format (RESPONSE-FILE)

Each transaction writes:
```
" START: <transaction-id>"
...operation result...
" END: <transaction-id>"
```

Error lines start with `E` (fatal) or `L` (lock warning).

---

## Operations

### DELETE

1. Parse key from input line (pipe-delimited, by SD-TYPE).
2. `READ DETAIL-MF WITH LOCK` — retry up to 10 times (0.1s sleep per retry).
3. After 10 retries: return `L22002` error with the user ID holding the lock.
4. `DELETE DETAIL-MF RECORD`.

### INSERT

1. Parse key from input line. `DE-SEQNO = 0`.
2. Read subsequent lines to populate data fields.
3. `WRITE DETAIL-REC` — if `INVALID KEY` (duplicate), increment `DE-SEQNO` and retry.
4. If `DE-SEQNO` wraps back to 0 (overflowed 9999): fatal `E33001` — out of sequence numbers.

### REPLACE

1. `READ DETAIL-MF WITH LOCK` (retry 10×).
2. Read subsequent lines to populate data fields.
3. `REWRITE DETAIL-REC`.

### CHANGEKEY

1. Parse OLD key and NEW key from same input line.
2. `READ DETAIL-MF WITH LOCK` using OLD key.
3. `DELETE` old record.
4. Populate data fields with NEW key.
5. `WRITE DETAIL-REC` with SEQNO auto-increment retry (same as INSERT).

---

## Key Parsing by SD-TYPE

Before parsing, `komdetail` reads the schedule master to get `SD-TYPE`:

| Type | Key fields (pipe-separated) |
|------|-----------------------------|
| 1 | `schedNo\|source(XX)\|refNo(X12)\|date(X8)\|seqno` |
| 2, 4 | `schedNo\|contNo(X10)\|date(YYYYMMDD)\|seqno` |
| 3 | `schedNo\|contNo(X10)\|date(X8)\|seqno` |
| 5 | `schedNo\|contNo(X10)\|applyNo(X12)\|applyCd(X)\|seqno` |

For CHANGEKEY, OLD key fields come first, then NEW key fields in the same pipe-delimited line.

### Special date value
- Type 2/4: `DE-DATE = "00000000"` signals a **balance-forward record** (not a dated transaction).

---

## SEQNO Auto-Increment Algorithm

```
DE-SEQNO = 0
loop:
  WRITE DETAIL-REC
  if INVALID KEY:
    DE-SEQNO += 1
    if DE-SEQNO == 0:   -- wrapped (was 9999, overflowed COMP-6 4-digit)
      FATAL: "E33001: Out of sequence numbers"
    goto loop
  else:
    exit loop
```

SEQNO is `PIC 9(4) COMP-6`. Max value = 9999. Overflow back to 0 = fatal.

---

## Record Locking

```
TRY-COUNT = 0
loop:
  READ DETAIL-MF WITH LOCK
  if DE-STATUS == "99":   -- locked by another user
    TRY-COUNT += 1
    CALL "SYSTEM" USING "sleep 0.1"
    if TRY-COUNT > 10:
      get lock holder user ID
      return "L22002: Ask <userId> to close screen on detail sched #: <schdNo>"
    goto loop
  else:
    continue
```

---

## Data Fields (per INSERT/REPLACE)

| Field | Type | Notes |
|-------|------|-------|
| `DE-CONTNO` | PIC X(10) | Control number (alternate key) |
| `DE-AMOUNT` | S9(9)V99 COMP-3 | Transaction amount |
| `DE-REFNO` | PIC X(12) | Reference number |
| `DE-SOURCE` | PIC XX | Journal source code |
| `DE-DATE1` | PIC X(8) | Transaction date (YYYYMMDD) |
| `DE-ACCTNO` | PIC X(5) | GL account number |
| `DE-DESC` | PIC X(35) | Description |
| `DE-BAL-CUR/OVR30/OVR60/OVR90` | S9(9)V99 COMP-3 | Aging buckets (balance-forward records only) |

---

## TypeScript Replacement

### `ScheduleDetailRepository` methods

```typescript
class ScheduleDetailRepository {
  async create(tenantId: string, dto: CreateScheduleDetailDto): Promise<ScheduleDetail>
  async findById(tenantId: string, id: string): Promise<ScheduleDetail | null>
  async findBySchedule(tenantId: string, scheduleNumber: string, filters?: DetailFilters): Promise<ScheduleDetail[]>
  async findByControlNumber(tenantId: string, scheduleNumber: string, controlNumber: string): Promise<ScheduleDetail[]>
  async update(tenantId: string, id: string, dto: UpdateScheduleDetailDto): Promise<ScheduleDetail>
  async delete(tenantId: string, id: string): Promise<void>
  async deleteBySchedule(tenantId: string, scheduleNumber: string): Promise<number>
  async deleteByControlNumber(tenantId: string, scheduleNumber: string, controlNumber: string): Promise<number>
}
```

### Sequence number

SEQNO auto-increment is replaced by database auto-generated IDs (`@id @default(cuid())`). The COBOL 4-digit SEQNO limitation is eliminated.

### Record locking

Pessimistic locking (COBOL `WITH LOCK`) is replaced by Prisma transactions and optimistic concurrency at the database level (PostgreSQL row-level locking via `SELECT ... FOR UPDATE`).

---

## Traceability

- **COBOL program**: `acct/src/komdetail.cbl`
- **TypeScript location**:
  - Repository: `amacc/services/schedule-service/src/infrastructure/schedule-detail-repository.ts`
  - Routes: `amacc/services/schedule-service/src/http/routes.ts`
  - Event handler: `amacc/services/schedule-service/src/application/event-handlers.ts` (INSERT path via `JOURNAL_ENTRY_POSTED`)
