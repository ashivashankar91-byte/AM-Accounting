# Extraction: schedup.cbl

**Decision: BUILD** — Schedule master CRUD with GL validation and schedmgr orchestration.

---

## Source

`acct/src/schedup.cbl` — 77,343 bytes (1,738 lines, fully read)

---

## Summary

`schedup` is the Schedule Format File Maintenance screen. It is the only program that creates, updates, and deletes schedule master records (SCHEDULE-FILE). Every save calls `schedmgr` to update GL↔schedule linkages and propagate detail record migrations. It also enforces the constraint that schedule type changes are allowed only if there are no detail records (unless the MIS password was entered).

---

## Operations

| Key | Action |
|-----|--------|
| Enter schedule# | Load schedule record (or start new if not found) |
| Enter/F13 (save) | Edit → validate → update GL linkages → write record |
| F2 (delete) | Delete schedule record (after calling `schedmgr DS` to purge details) |
| F3 (skip) | Accept screen state without saving; re-sync GL fields |
| F7 (print) | Print schedule listing (calls `schedprn` in print-preview mode) |
| F1 | Exit |

---

## Field Validation Rules

### SD-TITLE
- Required. Cannot be blank — `ERR: Schedule Name required.`

### GL account numbers (SD-GLNO1–SD-GLNO5)
- At least one account required — `ERR: You must have at least one account on a schedule.`
- No duplicate account numbers — `ERR: Cannot save schedule with duplicate account numbers.`
- Each provided GL must exist in GL-MF — `ERR: No Record in G/L File for Acct# {n}.`
- Cannot schedule a distributed account — `ERR: Cannot schedule a distributed Account: {n}.`
- Auto-compact: gaps in the 5-slot array are shifted left (no empty slots between filled ones).
- **Types 2, 4, 5**: only ONE account allowed — `ERR: Multiple account numbers only allowed on schedule types 1 & 3.`

### SD-TYPE (schedule type)
- Valid values: 1, 2, 3, 4, 5.
- Changing the type requires either: no detail records for the schedule, OR the MIS password was entered at login.
- Type change compatibility checked via `schedmgr CC` call. Incompatible changes blocked.

### SD-EOM-PURGE (purge code)
Valid purge codes by schedule type:

| Schedule Type | Allowed Purge Codes |
|---------------|---------------------|
| 1 | 1 only |
| 2 | 2 only |
| 3 | 1, 3, 6, 7 |
| 4 | 4 only |
| 5 | 5 only |

- Purge code 7 on an asset/liability account: warn but allow after user confirmation `WRN: Are you sure...? (Y/N)`.

### SD-RPT-SEQ (report sequence)
- Valid values: `C` (by control#), `N` (by name), `A` (by age).
- Auto-corrected to `C` if blank or invalid.

### SD-CONT-NAMES (control name display)
- `Y` = show control names, `2` = show first two lines, `D` = deal owner, `V` = vehicle.

---

## Save Flow (full orchestration)

When the user presses Enter/F13 to save:

```
1. Validate all fields (title, GL#s, type, purge code, report seq, cont-names)
2. REVIEW-ACCOUNT-SELECTION:
   a. Compare original GL set (WS-HOLD-GL) vs. new GL set (SD-GLACCTNO)
   b. Identify removed GLs and added GLs
   c. Scan DETAIL-MF to find if any removed/added GLs have detail records
   d. If removed GL has details:
      - Dialog: "(D)elete or (C)ancel?"
      - If D: proceed; if C: cancel save
   e. If added GL has details in another schedule:
      - Dialog: "(M)ove or (C)ancel?"
      - If M: check compatibility via schedmgr CC; if fail: cancel
      - If C: cancel save
3. REVIEW-CHECK-DONE-CHECKING:
   a. If removed GLs have details → schedmgr DA (delete account details)
   b. If added GLs to be moved → schedmgr MA (move account details)
4. REVIEW-RESET-GL-SCHDNO:
   - For all removed GLs → schedmgr RG (clear GL-SCHDNO)
5. REVIEW-SET-GL-SCHDNO:
   - For all current GLs → schedmgr SG (set GL-SCHDNO = current schedule)
6. DID-SCHED-TYPE-CHANGE:
   - If SD-TYPE changed → schedmgr CS (convert remaining detail records)
7. CHECK-REQ-CONTNO:
   - For type 2/5: schedmgr FC (force GL-REQ-CONTNO = L/A)
8. CHECK-ADDED-GL-BALANCES:
   - For added GLs without moved detail: check GL-OPEN-BAL / GL-OPEN-CNT
   - If non-zero: warning dialog "ATTENTION: You must patch the outstanding balance..."
9. WRITE-REC:
   - REWRITE (if existing) or WRITE (if new) SCHEDULE-REC
   - Call schedsync (update/add) → REPLACED by Prisma write
```

---

## Delete Flow

```
F2 pressed:
1. schedmgr DS (delete all details for this schedule)
2. For all GL accounts on schedule → schedmgr RG (clear GL-SCHDNO)
3. DELETE SCHEDULE-FILE RECORD
4. Call schedsync (delete) → REPLACED by Prisma delete
```

---

## TypeScript Replacement

### `ScheduleApplicationService` (application/schedule-service.ts)

```typescript
async createSchedule(tenantId: string, dto: CreateScheduleDto): Promise<Schedule>
async updateSchedule(tenantId: string, scheduleNumber: string, dto: UpdateScheduleDto): Promise<Schedule>
async deleteSchedule(tenantId: string, scheduleNumber: string): Promise<void>
async getSchedule(tenantId: string, scheduleNumber: string): Promise<Schedule>
async listSchedules(tenantId: string): Promise<Schedule[]>
```

### Business rules enforced in service layer

1. `validateGlAccounts(glNos: string[])` — all provided GLs exist, no duplicates, not distributed accounts.
2. `validatePurgeCode(type, purgeCode)` — valid combination per table above.
3. `validateTypeChange(fromType, toType, hasDetails)` — blocks incompatible changes.
4. On update: detect added/removed GLs, call `ScheduleManager` methods accordingly (in a single Prisma transaction).
5. On type change: call `ScheduleManager.convertScheduleType()`.
6. After write: publish `SCHEDULE_UPDATED` event (for gl-service to update GL records' `scheduleNumber` field via `schedmgr RG/SG` equivalent).

### API endpoints

```
GET    /api/v1/schedules                 — list all schedules for tenant
POST   /api/v1/schedules                 — create schedule
GET    /api/v1/schedules/:id             — get schedule by number
PUT    /api/v1/schedules/:id             — update schedule (full orchestration)
DELETE /api/v1/schedules/:id             — delete schedule + all details
```

---

## Notes on GL-Service Interaction

In COBOL, `schedup` reads and writes GL-MF directly. In TypeScript:
- Reading GL info for validation: `GET /api/v1/gl-accounts/:acctNo` on gl-service.
- Updating `GL-SCHDNO`: `PATCH /api/v1/gl-accounts/:acctNo { scheduleNumber: '05' | null }` on gl-service.
- Updating `GL-REQ-CONTNO`: `PATCH /api/v1/gl-accounts/:acctNo { requiresControlNumber: 'L' | 'A' | null }`.

These calls happen synchronously within `updateSchedule()` transaction orchestration.

---

## Traceability

- **COBOL program**: `acct/src/schedup.cbl`
- **TypeScript location**:
  - Application: `amacc/services/schedule-service/src/application/schedule-service.ts`
  - Routes: `amacc/services/schedule-service/src/http/routes.ts`
  - Domain validation: `amacc/services/schedule-service/src/domain/schedule.ts`
