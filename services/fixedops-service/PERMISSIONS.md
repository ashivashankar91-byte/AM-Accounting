# fixedops-service — CE-11 permission keys

Proposed for consolidation into a single auth-service manifest migration
alongside parts-accounting-service's keys (see that service's
PERMISSIONS.md), following the exact grant-shape convention established by
`services/auth-service/prisma/migrations/20260801020000_add_ce10_tax_permissions/migration.sql`
(ADMIN + CONTROLLER get every key including `.manage`/`.execute`/`.elect`/
`.disposition`/`.resolve`; ACCOUNTANT gets view + the operational actions
the package explicitly names for that persona; WARRANTY_ADMIN — new persona
named in CE11_FABLE_EPIC_PACKAGE.md §5 "Warranty Receivable & Claim Aging"
— gets the warranty-specific actions at the same tier as ACCOUNTANT until a
dedicated role definition exists).

| Key | Description | ADMIN | CONTROLLER | ACCOUNTANT | WARRANTY_ADMIN |
|---|---|---|---|---|---|
| `fixedops.ro.view` | View RO close postings, distribution, and detail | Y | Y | Y | Y |
| `fixedops.ro.close.execute` | Execute an RO close event (S059) | Y | Y | Y | — |
| `fixedops.ro.reversal.execute` | Execute a reopen/void reversal (S060) | Y | Y | Y | — |
| `fixedops.wip.view` | View WIP mode history and open-RO/WIP report | Y | Y | Y | — |
| `fixedops.wip.elect` | Elect WIP mode (ceremony, Controller-tier) | Y | Y | — | — |
| `fixedops.sublet.view` | View sublet PO lifecycle | Y | Y | Y | — |
| `fixedops.sublet.manage` | Create sublet PO, match invoice, accrue | Y | Y | Y | — |
| `fixedops.techtime.view` | View unapplied-time/guarantee absorption | Y | Y | Y | — |
| `fixedops.techtime.post` | Post period-boundary time absorption | Y | Y | Y | — |
| `fixedops.techtime.reverse` | Reverse a posted tech-time absorption, reusing its captured rate/amount | Y | Y | Y | — |
| `fixedops.laborrate.view` | View LaborRateConfig rows (technician/department burdened labor-cost rates) | Y | Y | Y | — |
| `fixedops.laborrate.manage` | Set an effective-dated technician or department burdened labor-cost rate (Controller-tier ceremony) | Y | Y | — | — |
| `fixedops.deferred.view` | View deferred maintenance contracts | Y | Y | Y | — |
| `fixedops.deferred.manage` | Sell/redeem deferred maintenance contracts | Y | Y | Y | — |
| `fixedops.warranty.view` | View warranty claim lifecycle and aging | Y | Y | Y | Y |
| `fixedops.warranty.disposition` | Submit/remit/disposition a warranty claim | Y | Y | — | Y |
| `fixedops.mapping.view` | View FixedOpsAccountMapping rows | Y | Y | Y | — |
| `fixedops.mapping.manage` | Resolve a pending account mapping (out of scope for this service — mapping resolution UI lives centrally; reserved) | Y | Y | — | — |
| `fixedops.exception.view` | View the S021-aligned exception/recovery queue | Y | Y | Y | — |
| `fixedops.exception.resolve` | Resolve/re-request an exception | Y | Y | Y | — |
| `fixedops.audit.view` | View audit history for Fixed Ops entities | Y | Y | Y | — |

All routes are gated with `createAuthzGuard` exactly like
`coa-service`'s `posting-engine-routes.ts` (deny-by-default, centralized
through the real S207 authz service). `x-tenant-id` is required on every
request (400 if missing). Cross-tenant and cross-legal-entity denial is
enforced by every query being scoped on `tenantId` (and, where applicable,
`legalEntityId`) — never client-supplied trust.
