# Wave 3 Gap Analysis: Schedule Sub-System

**Status**: Wave 3 — Ground-up build  
**Date**: 2025  
**Service**: `amacc/services/schedule-service/`

---

## 1. Architecture Decision

The Schedule Sub-System is extracted as a **new independent microservice** (`schedule-service`). This is a ground-up build — no existing TypeScript service to modify.

**Key architectural decisions:**

| Decision | Rationale |
|----------|-----------|
| New microservice, not part of gl-service | Schedule detail is a large, independently query-able domain (up to 5,000 records per schedule) |
| gl-service MUST have `scheduleDetail` model REMOVED | gl-service posting must be ACID for GL + histtran + journal; schedule detail is eventually consistent |
| `JOURNAL_ENTRY_POSTED` event is the ONLY bridge from gl-service to schedule-service | No direct HTTP call from gl-service to schedule-service for writing detail records |
| gl-service retains `glAccount.scheduleNumber` field | gl-service must include `scheduleNumber` in `JOURNAL_ENTRY_POSTED` payload — schedule-service uses it to route the event to the correct schedule |
| schedule-service calls gl-service for GL validation and linkage updates | `scheduleNumber` on GL records is updated via `PATCH /api/v1/gl-accounts/:id` |

---

## 2. COBOL Programs Analysed

| Program | Size | Decision | Reason |
|---------|------|----------|--------|
| `getsched.cbl` | 2,363 B | ABSORBED | Trivial file-read subroutine — replaced by `ScheduleRepository.findById()` |
| `schedinvk.cbl` | 6,606 B | SKIP | Vehicle lookup, not a scheduling operation — future wave via vehicle-service |
| `schedsync.cbl` | 8,404 B | SKIP | ISAM→DB sync bridge — replaced by Prisma as primary store |
| `schedsec.cbl` | 21,646 B | BUILD | Per-user Y/N security model → `SchedulePermission` table |
| `komdetail.cbl` | 35,010 B | BUILD | CRUD file-pipe protocol → `ScheduleDetailRepository` + REST API |
| `schedmgr.cbl` | 28,802 B | BUILD | GL↔schedule linkage management → `ScheduleManager` |
| `schedup.cbl` | 77,343 B | BUILD | Schedule master CRUD with GL orchestration → `ScheduleApplicationService` |
| `schedprn.cbl` | 222,341 B | BUILD | Report generator → JSON API + `ScheduleReportService` |

---

## 3. Data Models

### Schedule (replaces SCHEDULE-FILE ISAM)

| COBOL Field | TypeScript Field | Type | Notes |
|-------------|-----------------|------|-------|
| `SD-SCHDNO` | `scheduleNumber` | `String @db.Char(2)` | Primary key (2-digit, right-justified) |
| `SD-TITLE` | `title` | `String @db.VarChar(29)` | Required |
| `SD-RPT-SEQ` | `reportSequence` | `String @db.Char(1)` | `C`/`N`/`A` |
| `SD-TYPE` | `scheduleType` | `Int` | 1–5, drives key structure |
| `SD-GLACCTNO[1..5]` | `glAccountNumbers` | `String[]` | Max 5 GL accounts |
| `SD-EOM-PURGE` | `eomPurgeType` | `Int` | 1–7 |
| `SD-CONT-NAMES` | `controlNameDisplay` | `String @db.Char(1)` | Y/2/D/V/blank |

### ScheduleDetail (replaces DETAIL-MF ISAM)

| COBOL Field | TypeScript Field | Type | Notes |
|-------------|-----------------|------|-------|
| `DE-SCHDNO` | `scheduleNumber` | `String @db.Char(2)` | FK to Schedule |
| `DE-CONTNO` | `controlNumber` | `String @db.VarChar(10)` | Alternate key |
| `DE-AMOUNT` | `amount` | `Decimal @db.Decimal(15,2)` | Monetary |
| `DE-REFNO` | `referenceNumber` | `String @db.VarChar(12)` | |
| `DE-SOURCE` | `journalSource` | `String @db.Char(2)` | 2-char source code |
| `DE-DATE1` | `transactionDate` | `DateTime` | YYYYMMDD in COBOL |
| `DE-ACCTNO` | `glAccountNumber` | `String @db.Char(5)` | |
| `DE-DESC` | `description` | `String @db.VarChar(35)` | |
| `DE-SEQNO` | — | Auto-generated CUID | COBOL 4-digit SEQNO → DB id |
| `DE-BAL-CUR` | `balanceCurrent` | `Decimal?` | Balance-forward records only |
| `DE-BAL-OVR30` | `balanceOver30` | `Decimal?` | Balance-forward records only |
| `DE-BAL-OVR60` | `balanceOver60` | `Decimal?` | Balance-forward records only |
| `DE-BAL-OVR90` | `balanceOver90` | `Decimal?` | Balance-forward records only |
| `DE-APPLYNO` | `applyNumber` | `String? @db.VarChar(12)` | Type 5 only |
| `DE-APPLY-CD` | `applyCd` | `String? @db.Char(1)` | Type 5: `#`=detail, `!`=bal-fwd |
| — | `isBalanceForward` | `Boolean @default(false)` | Computed flag |

### SchedulePermission (replaces TABLES-FILE SS records)

| COBOL Field | TypeScript Field | Type |
|-------------|-----------------|------|
| login-id (14-char key) | `userId` | `String` |
| `TB-SS-ACCESS[schedNo]` | `scheduleNumber` + `canAccess` | normalized rows |
| company# in key | `tenantId` | `String` |

---

## 4. Event Architecture

### `JOURNAL_ENTRY_POSTED` (consumed by schedule-service)

**Published by**: gl-service after a journal entry is successfully committed to the database.

**Payload fields used by schedule-service:**

```typescript
interface JournalEntryPostedEvent {
  tenantId: string;
  journalEntryId: string;
  glAccountNumber: string;
  scheduleNumber: string | null;   // null = not scheduled
  controlNumber: string;
  amount: string;                  // string representation of Decimal
  referenceNumber?: string;
  journalSource: string;
  transactionDate: string;         // ISO date string
  description?: string;
}
```

**schedule-service handler**: if `scheduleNumber` is non-null, validate schedule exists, then call `ScheduleDetailRepository.create()`.

### `SCHEDULE_DETAIL_WRITTEN` (published by schedule-service)

Not needed for Wave 3. Future use if other services need to react to schedule detail writes.

### `SCHEDULE_PURGED` (published by schedule-service)

Published after successful EOM purge. Consumed by eom-service to advance the ACCT_100 step.

```typescript
interface SchedulePurgedEvent {
  tenantId: string;
  closeDate: string;
  eomCloseId: string;
  schedulesPurged: number;
  detailsProcessed: number;
}
```

---

## 5. EOM Purge Types (from purge.extraction.md INV-EOM-08)

The `SD-EOM-PURGE` code on each schedule drives the purge algorithm at ACCT_100:

| Code | Type | Algorithm |
|------|------|-----------|
| 1 | Balance-forward | Compute net balance → write one bal-fwd record → delete all dated records |
| 2 | Date purge | Delete all records with `transactionDate <= closeDate` |
| 3 | Zero-balance net | Delete all records for a controlNumber WHERE `SUM(amount) = 0` |
| 4 | Age-credit | Same as 2, delete aged credits |
| 5 | Apply-to zero-balance | Delete all records for an applyNumber WHERE `SUM(amount) = 0` |
| 6 | Age-debit with GL subtotals | Age-debit variant with GL column breakdown |
| 7 | Delete all | Delete ALL records regardless of date |

**TypeScript purge dispatch:**

```typescript
interface PurgeRequest {
  tenantId: string;
  closeDate: Date;
  eomCloseId: string;
}

class PurgeService {
  async purgeAll(req: PurgeRequest): Promise<PurgeSummary>
  private async purgeType1(scheduleNumber: string, closeDate: Date): Promise<void>  // balance-forward
  private async purgeType2(scheduleNumber: string, closeDate: Date): Promise<void>  // date purge
  private async purgeType3(scheduleNumber: string): Promise<void>                   // zero-balance net
  private async purgeType4(scheduleNumber: string, closeDate: Date): Promise<void>  // age-credit
  private async purgeType5(scheduleNumber: string): Promise<void>                   // apply-to zero
  private async purgeType6(scheduleNumber: string, closeDate: Date): Promise<void>  // age-debit
  private async purgeType7(scheduleNumber: string): Promise<void>                   // delete all
}
```

---

## 6. API Surface

### Schedule CRUD
```
GET    /api/v1/schedules                      — list all
POST   /api/v1/schedules                      — create
GET    /api/v1/schedules/:id                  — get by schedule number
PUT    /api/v1/schedules/:id                  — update (full orchestration)
DELETE /api/v1/schedules/:id                  — delete + purge details
```

### Schedule Detail
```
GET    /api/v1/schedules/:id/details          — list details (with filters)
POST   /api/v1/schedules/:id/details          — manual create (admin use)
GET    /api/v1/schedules/:id/details/summary  — aggregated totals by control#
DELETE /api/v1/schedules/:id/details/:detailId — delete single detail
```

### Reports
```
GET    /api/v1/schedules/:id/report           — detail or summary report JSON
GET    /api/v1/schedules/:id/report/summary   — summary totals only
```
Query params: `cutoffDate`, `format=DETAIL|SUMMARY`, `includeZeroBalance`, `sort=C|N|A`

### Purge
```
POST   /api/v1/schedules/purge                — EOM purge (all schedules)
GET    /api/v1/schedules/purge/preview        — dry-run: what would be purged?
```

### Security
```
GET    /api/v1/schedules/security/users           — list users with access
GET    /api/v1/schedules/security/users/:userId   — get user access map
PUT    /api/v1/schedules/security/users/:userId   — replace user access map
DELETE /api/v1/schedules/security/users/:userId   — remove user access
GET    /api/v1/schedules/:id/security/check       — check current user access
```

---

## 7. Type Compatibility Matrix (from schedmgr.cbl)

Allowed schedule type changes (no programmer intervention):

```
1→1, 2→2, 2→4, 3→3, 4→2, 4→4, 5→5
```

All other from→to pairs are BLOCKED and require a support ticket.

---

## 8. EOM Purge Code Validation (from schedup.cbl)

Required purge code per schedule type:

| Type | Valid Purge Codes |
|------|-------------------|
| 1 | 1 |
| 2 | 2 |
| 3 | 1, 3, 6, 7 |
| 4 | 4 |
| 5 | 5 |

---

## 9. Integration with gl-service

### gl-service changes required (Wave 3)
1. **Remove** `ScheduleDetail` Prisma model from `gl-service/prisma/schema.prisma`
2. **Remove** `writeScheduleDetail()` from `gl-service/src/application/gl-service.ts`
3. **Add** `scheduleNumber` field to `JOURNAL_ENTRY_POSTED` event payload (field already exists on `GlAccount` record)
4. **Add** architecture comment explaining eventual consistency with schedule-service

### eom-service changes required (Wave 3)
1. Wire `AcctScheduleDetailPurgeHandler` (ACCT_100) to call `POST /api/v1/schedules/purge`
2. Change stub from `success: false` to real HTTP call with retry

---

## 10. Out-of-Scope (Future Waves)

| Feature | COBOL Origin | Reason Deferred |
|---------|-------------|-----------------|
| Vehicle description enrichment | `schedinvk.cbl`, `schedprn.cbl` SD-CONT-NAMES=V | Requires vehicle-service integration |
| Deal owner name lookup | `schedprn.cbl` SD-CONT-NAMES=D | Requires deal-service integration |
| Name/customer lookup | `schedprn.cbl` SD-CONT-NAMES=Y/2 | Requires name-service integration |
| PDF export of reports | `schedprn.cbl` print-preview path | PDF generation library TBD |
| Type conversion (non-trivial paths) | `schedmgr.cbl 4000-CONVERT` commented-out conversions | Requires programmer review per COBOL comments |

---

## 11. Critical Implementation Notes

1. **SEQNO overflow is no longer fatal**: COBOL's 4-digit SEQNO (max 9999) is replaced by DB-generated CUIDs. The `E33001` error cannot occur.

2. **Balance-forward record detection**: A `ScheduleDetail` row is a balance-forward if `isBalanceForward = true`. In COBOL this was detected by checking if the 4 aging bucket fields were numeric (vs. using the amount/refno layout). In TypeScript, this is an explicit boolean field set at write time.

3. **ACCT_100 prerequisite check**: Before running `POST /api/v1/schedules/purge`, the eom-service ACCT_100 handler must verify that all `JOURNAL_ENTRY_POSTED` events for this close period have been consumed (check outbox table is empty for this tenant). If pending, return 409 Conflict.

4. **Prisma transaction scope**: All `ScheduleManager` operations (move, convert, delete) must run within a Prisma transaction to ensure atomicity. The COBOL relied on ISAM file-level locking; Prisma uses row-level locks (`SELECT FOR UPDATE` via `$transaction`).

5. **Schedule number is 2-digit numeric string**: `"01"` through `"99"`. Schedule `"00"` means "all schedules" in print context only — it is not a valid schedule master key.

6. **Multi-account types (1 and 3 only)**: Schedules of type 2, 4, 5 can only have ONE GL account. This must be validated in `ScheduleApplicationService.validateGlAccounts()`.
