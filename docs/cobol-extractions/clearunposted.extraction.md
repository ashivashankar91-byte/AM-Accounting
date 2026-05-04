# COBOL Extraction: clearunposted.cbl

**Extracted:** 2025  
**Extracted By:** GitHub Copilot (Wave 2 — COPILOT.md protocol)  
**Status:** Complete

---

## 1. Source

| Field | Value |
|-------|-------|
| File | `acct/src/clearunposted.cbl` |
| PROGRAM-ID | `CLEARUNPOSTED` |
| Purpose | Attempt to automatically clear stuck/unposted transactions in the COBOL tran file |
| Called By | Multiple COBOL programs that detect stuck transactions (via linkage section) |
| Lines | ~400 |
| Linkage | `acct/copy/clearunposted.link` — receives: COMPNO, TR-DATE, TR-SOURCE, TRAN-FILENAME, MODULE, CALLED-FROM-PROG; returns: TRANS-CLEARED flag, HAD-ERRORS flag |

---

## 2. Purpose

When a COBOL posting program encounters a "stuck" (unposted, orphaned) transaction batch in the tran file, it calls `clearunposted.cbl` to attempt automatic recovery. The program:

1. Validates all inputs (company number, date, source, filename, calling program, module)
2. If source is `RESERVED-FOR-YEAR-END`: log error, return `HAD-ERRORS = TRUE` (do not touch year-end batches)
3. Attempts to obtain an EXCLUSIVE lock on the tran file (up to 5 retries with 0.9-second sleep between retries)
4. If the lock is obtained: calls `pushunposted` (touch file mechanism) + verifies the push worked
5. Returns `TRANS-CLEARED = TRUE` if successful, `TRANS-CLEARED = FALSE` with retry count if not

---

## 3. Algorithm

```
1. ASSERTIONS:
   - COMPNO > 0
   - TR-DATE > 0
   - TR-SOURCE > SPACES
   - TRAN-FILENAME has numeric company number at positions 12-13
   - PROGRAM-ID of caller provided
   - MODULE is a valid value from the link copybook
   - Source is NOT RESERVED-FOR-YEAR-END

2. LOOP (max 5 retries):
   a. OPEN EXCLUSIVE I-O TRAN-FILE
   b. EVALUATE FILE-STATUS:
      - "00" (locked successfully):
        - Close TRAN-FILE
        - SEND-PUSH: call touch file mechanism
        - VERIFY-PUSH: re-read tran file to confirm batch was consumed
        - If TRANS-CLEARED: exit loop
        - Else: sleep 0.9s, retry
      - "93" (exclusive lock failed — another process holds the file):
        - Log, sleep 0.9s, retry
      - OTHER: log and GOBACK (fatal)
   c. After 5 tries without success: log "Tried 5 times, aborting"
```

---

## 4. Key Safety Rules

### Safety Rule 1: Year-End Sources Are Excluded
Same as `pushunposted.cbl` (ACC-4640): if `RESERVED-FOR-YEAR-END`, do not clear and do not push.

### Safety Rule 2: Exclusive Lock Required
Unlike `pushunposted.cbl` which just opens I-O, `clearunposted.cbl` uses `OPEN EXCLUSIVE` to ensure no other program is writing to the tran file during the clear operation. This prevents race conditions where a batch is being posted while `clearunposted` is trying to push it.

### Safety Rule 3: Verify the Push Worked
After sending the push (touch file), `clearunposted.cbl` waits (via `sleep .9`) and then re-opens the tran file to confirm the batch is gone. This verification prevents false-positive `TRANS-CLEARED` flags.

---

## 5. Decision: SKIP — No Equivalent Needed

`clearunposted.cbl` exists because COBOL ISAM files can have "stuck" batches — partially written or orphaned records that were not cleaned up after a crash or error. This is inherent to file-based storage with no transaction support.

In the TypeScript platform:
- Transaction batches are in PostgreSQL (`journalBatch` table with `status` field)
- Stuck batches are those with `status = 'DRAFT'` or `status = 'FAILED'` older than a threshold
- These are visible via `GET /api/v1/gl/batches?status=stuck`
- Recovery is via `POST /api/v1/gl/batches/:id/abandon` or `POST /api/v1/gl/batches/:id/resubmit`
- PostgreSQL's MVCC eliminates the ISAM file-locking race conditions entirely
- No "touch file" mechanism needed — all state is in the DB

The concept of "clearing a stuck batch" is replaced by the broader `journalBatch` lifecycle management in `gl-service`.

---

## 6. Traceability

- `@cobol-ancestry` clearunposted.cbl / CLEARUNPOSTED
- `@removes-need-for` clearunposted.cbl + ISAM exclusive-lock mechanism (replaced by PostgreSQL MVCC + journalBatch status management)
- `@cobol-equivalent` `journalBatch.status` lifecycle in gl-service; `POST /gl/batches/:id/abandon`
- `@intelligence-additions` No 5-retry spin loop needed; no file locking needed; stuck batches visible via API
