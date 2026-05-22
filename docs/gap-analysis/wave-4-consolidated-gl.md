# Wave 4 Gap Analysis: Consolidated GL

**Date**: Wave 4  
**Programs**: consolgl.cbl (1570 lines), consolexpgl.cbl (780 lines)  
**Target Service**: group-service (extension of existing service)

---

## What COBOL Does

The consolidated GL feature allows a dealership group to create a single combined financial view by merging GL, journal, and source data from 2–40 individual company numbers into a single "consolidated company" number.

### COBOL Data Flow

```
consolgl.opts2 config file
    │
    ├─ Option 1 (Clear): truncate all 6 COBOL files + DELETE Postgres tables
    │
    └─ Option 2 (Import):
          User enters source company numbers
          User enters lastClosedDate
          Lock → write to COBOL sys file → sync to DB
                         │
                         └─ consolexpgl.cbl
                               For each source company:
                                 consolmap lookup/create (ACCTID assignment)
                                 GL merge (ADD balances on duplicate)
                                 Journal merge (ADD amounts on duplicate)
                                 Source merge (skip duplicates)
                               Rebuild GLbyID from consolmap
                               POST to Java rebuild endpoint
```

---

## TypeScript Gap Assessment

### What EXISTS in TypeScript
- `TenantGroup` concept not yet built — **GAP**
- `GlAccount`, `JournalEntry`, `JournalSource` models exist per-tenant in gl-service — **EXISTS**
- Multi-tenant Prisma via `x-tenant-id` header — **EXISTS**

### What NEEDS TO BE BUILT

#### 1. `TenantGroup` / Group Configuration (group-service)

Currently group-service exists but has no consolidation endpoints.

**New model needed**: `ConsolidatedGlConfig`
```prisma
model ConsolidatedGlConfig {
  id                    String   @id @default(cuid())
  groupId               String
  consolidatedTenantId  String   // the "consolidated company" tenant
  sourceTenantIds       String[] // up to 40 source companies
  lastClosedDate        String?  // YYYYMMDD
  lastImportedAt        DateTime?
  isValid               Boolean  @default(false)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@unique([groupId, consolidatedTenantId])
}
```

**New model needed**: `ConsolidationMapping`
```prisma
model ConsolidationMapping {
  consolidatedTenantId  String
  originalAccountCode   String  // from source tenant (12 chars)
  sourceTenantId        String
  consolidatedAccountId String  // assigned: "a0001" etc.
  createdAt             DateTime @default(now())

  @@id([consolidatedTenantId, originalAccountCode, sourceTenantId])
  @@index([consolidatedTenantId])
}
```

#### 2. Consolidation Service Logic (group-service)

**`ConsolidationService.clear(groupId)`**:
- Validate caller has admin permission for group
- Find `ConsolidatedGlConfig` for groupId
- Call gl-service: `DELETE /api/v1/gl/accounts?tenantId={consolidatedTenantId}` (bulk delete)
- Delete `ConsolidationMapping` rows for `consolidatedTenantId`
- Reset `isValid = false`, clear `lastImportedAt`

**`ConsolidationService.import(groupId, { companies, lastClosedDate })`**:
1. Validate companies list (2–40 entries, all must exist as tenants)
2. Validate lastClosedDate (YYYYMMDD, must be valid date)
3. For each source tenant:
   a. Fetch all GL accounts via gl-service (or direct Prisma query)
   b. For each account: look up or create `ConsolidationMapping`
   c. Upsert GL account in consolidated tenant (SUM balances on conflict)
   d. Fetch all journal entries from BOY to date
   e. Upsert journal entries in consolidated tenant (SUM amounts on conflict)
   f. Upsert journal sources
4. Update `ConsolidatedGlConfig`: `lastClosedDate`, `lastImportedAt = now()`, `isValid = true`
5. Emit `CONSOLIDATED_GL_IMPORTED` event (outbox pattern)

#### 3. API Endpoints

```typescript
// GET /api/v1/groups/:groupId/consolidated-gl
// Returns: ConsolidatedGlStatus

// POST /api/v1/groups/:groupId/consolidated-gl/clear
// Returns: 204

// POST /api/v1/groups/:groupId/consolidated-gl/import
// Body: { companies: number[], lastClosedDate: string }
// Returns: ConsolidatedGlStatus
```

---

## Architecture Decision: Cross-Tenant Access

**Problem**: consolexpgl reads GL data from multiple source companies. In the TypeScript multi-tenant architecture, each tenant has isolated data.

**Solution**: group-service is the cross-tenant coordinator. It has access to data across tenants within the same group. The consolidation service can:

Option A: Query each source tenant's gl-service endpoint with appropriate auth
Option B: Share a Postgres database where each tenant is a schema (group-service has access to all schemas)
Option C: group-service Prisma client accesses multiple tenant schemas directly

**Decision**: Option A (HTTP fan-out to gl-service per tenant). Simpler, consistent with service boundaries. Acceptable performance for periodic operation.

---

## ID Assignment Algorithm (TypeScript)

```typescript
async function getOrAssignConsolidatedId(
  consolidatedTenantId: string,
  sourceTenantId: string,
  originalAccountCode: string,
  prisma: PrismaClient
): Promise<string> {
  const existing = await prisma.consolidationMapping.findUnique({
    where: { consolidatedTenantId_originalAccountCode_sourceTenantId: {
      consolidatedTenantId, originalAccountCode, sourceTenantId
    }}
  });
  if (existing) return existing.consolidatedAccountId;

  // Count existing mappings for this consolidated company
  const count = await prisma.consolidationMapping.count({
    where: { consolidatedTenantId }
  });
  const consolidatedAccountId = numberToConsolidatedId(count + 1); // a0001, a0002...
  
  await prisma.consolidationMapping.create({
    data: { consolidatedTenantId, sourceTenantId, originalAccountCode, consolidatedAccountId }
  });
  return consolidatedAccountId;
}

function numberToConsolidatedId(n: number): string {
  const letter = String.fromCharCode('a'.charCodeAt(0) + Math.floor((n - 1) / 9999));
  const num = ((n - 1) % 9999) + 1;
  return letter + String(num).padStart(4, '0');
}
```

---

## COBOL vs TypeScript Capability Comparison

| Feature | COBOL | TypeScript |
|---------|-------|-----------|
| Max source companies | 40 | Unlimited (config limit) |
| Merge strategy | ADD numeric fields | Same (SUM on upsert) |
| Account ID assignment | a0001-z9999 (26×9999=259,974) | Same algorithm, same range |
| Validation after import | External java process | Inline Prisma aggregation query |
| Distributed lock | ISAM file lock | Postgres advisory lock |
| Rollback on error | Not supported (COBOL files mutated) | Full `$transaction` rollback |
| GLbyID file rebuild | Manual after merge | Not needed (Prisma JOIN) |

---

## Risk Flags

- **Performance**: Importing 40 companies with large GL histories — implement with streaming/pagination
- **Idempotency**: Re-importing same companies should produce same result — handle with `ON CONFLICT DO UPDATE`
- **Partial failure**: If import fails mid-way — wrap entire import in `$transaction` per source company
- **Concurrent imports**: Two users importing same group simultaneously — use Postgres advisory lock on `(groupId, 'import')`
