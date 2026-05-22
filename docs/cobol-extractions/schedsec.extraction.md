# Extraction: schedsec.cbl

**Decision: BUILD** — Per-user, per-schedule security model implemented as `SchedulePermission` table.

---

## Source

`acct/src/schedsec.cbl` — 21,646 bytes

---

## Summary

`schedsec` is the schedule security maintenance screen. It manages a per-user, per-schedule-number access control list stored in the TABLES-FILE (`SS##` + 14-char login ID). Each user record holds a 970-entry boolean array where index `N` = schedule number `N` and value `Y`/`N` indicates access. The screen supports listing users, adding/updating/deleting a user's complete schedule access record, and showing which schedules a user can access.

---

## Security Model

### Storage key structure

```
TABLES-FILE key: "SS" + "##" + LOGIN-ID(14) + SEQNO(1)
```
- `SS` = section literal (identifies this as a schedule-security record)
- `##` = 2-char company number (multi-tenant separator)
- `LOGIN-ID(14)` = left-justified user ID, space-padded to 14 chars
- `SEQNO(1)` = always `1` (single record per user)

### Data structure

```cobol
01 TB-SS-ACCESS     PIC X OCCURS 970 TIMES.
   -- index 1..970 = schedule number 1..970
   -- value "Y" = user has access, "N" or SPACE = no access
```

### Screen capacity
- Displays up to **30 schedules** at a time (pagination for > 30)
- Supports up to **75 distinct users** in list view
- Bug ACC-36726: display issue when > 30 schedules fixed

---

## Operations

| Key | Action |
|-----|--------|
| Enter / F13 | Save user's schedule access record |
| F2 | List all users with schedule access |
| F3 | Previous page (pagination) |
| F4 | Delete entire user access record |
| ESC | Get new user (enter different login) |
| F1 | Exit program |

---

## Business Rules

1. **Access is per-user, per-schedule-number, per-tenant.** A user either has `Y` or `N`/space for each schedule number.
2. **All-or-nothing save**: the entire 970-entry array is saved in one operation — there is no per-row granularity in ISAM.
3. **Security check at print time** (`schedprn.cbl`): the report program reads the user's SS record and checks `TB-SS-ACCESS(scheduleNumber)` before printing each schedule. Schedule `00` (print all) requires access to all requested schedules.
4. **No access record = no access**: if no record exists for a user, they have access to no schedules.
5. **MIS/super-password bypass**: users with the MIS password can access all schedules regardless.

---

## TypeScript Model

### Prisma schema (in `schedule-service/prisma/schema.prisma`)

```prisma
model SchedulePermission {
  id             String  @id @default(cuid())
  tenantId       String
  userId         String
  scheduleNumber String  @db.Char(2)
  canAccess      Boolean @default(false)
  
  @@unique([tenantId, userId, scheduleNumber])
  @@index([tenantId, userId])
}
```

### Repository methods

```typescript
// Check single schedule access
canUserAccess(tenantId: string, userId: string, scheduleNumber: string): Promise<boolean>

// Get all schedules accessible to user
getAccessibleSchedules(tenantId: string, userId: string): Promise<string[]>

// Set user's complete access map (replaces the entire record)
setUserAccess(tenantId: string, userId: string, permissions: Record<string, boolean>): Promise<void>

// Delete user's entire access record
deleteUserAccess(tenantId: string, userId: string): Promise<void>

// List all users who have any schedule access (for admin listing)
listUsersWithAccess(tenantId: string): Promise<string[]>
```

### API endpoints

```
GET    /api/v1/schedules/security/users              — list users with any schedule access
GET    /api/v1/schedules/security/users/:userId      — get user's complete access map
PUT    /api/v1/schedules/security/users/:userId      — replace user's complete access map
DELETE /api/v1/schedules/security/users/:userId      — delete user's access record
GET    /api/v1/schedules/:id/security/check          — check if current user can access schedule
```

### Access enforcement

The `scheduleAccessGuard` middleware reads `x-user-id` from the request context (set by `authMiddleware` after JWT decode) and checks `SchedulePermission` before any read or write on schedule detail. Super-admin role (`isMis: true` on JWT) bypasses the check.

---

## Migration Notes

The COBOL TABLES-FILE `SS` record has 970-entry array indexed by schedule number. In the TypeScript model, this becomes normalized rows (one row per schedule permission). The bulk-replace operation (`PUT /users/:userId`) must be implemented as a transaction: delete all existing permissions for that user, insert new ones.

---

## Traceability

- **COBOL program**: `acct/src/schedsec.cbl`
- **TypeScript location**: 
  - Model: `amacc/services/schedule-service/prisma/schema.prisma` — `SchedulePermission`
  - Repository: `amacc/services/schedule-service/src/infrastructure/schedule-permission-repository.ts`
  - Routes: `amacc/services/schedule-service/src/http/routes.ts`
