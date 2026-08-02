# parts-accounting-service — permission catalog additions

Naming convention: `parts.<resource>.<action>`, matching the existing
`tax.<resource>.<action>` convention (see
`services/auth-service/prisma/migrations/20260801020000_add_ce10_tax_permissions/migration.sql`).
Not yet migrated into auth-service — consolidate centrally alongside
fixedops-service's PERMISSIONS.md into one additive auth-service migration.

A new persona, **PARTS_MANAGER**, is introduced for physical-inventory and
valuation-config actions per the CE-11 package's screen personas (#8, #10
in MANDATORY ACCOUNTING UI). It is layered alongside the existing
ADMIN/CONTROLLER/ACCOUNTANT roles, not a replacement for any of them.

| Key | Description | ADMIN | CONTROLLER | ACCOUNTANT | PARTS_MANAGER |
|---|---|---|---|---|---|
| `parts.movement.view` | View parts movements | ✓ | ✓ | ✓ | ✓ |
| `parts.movement.post` | Post a parts movement (receipt/issue/sale/return) | ✓ | ✓ | | ✓ |
| `parts.reconciliation.view` | View perpetual-to-GL reconciliation runs | ✓ | ✓ | ✓ | ✓ |
| `parts.reconciliation.run` | Trigger an on-demand reconciliation run | ✓ | ✓ | ✓ | |
| `parts.valuation.view` | View valuation config (method, landed-cost rules) | ✓ | ✓ | ✓ | ✓ |
| `parts.valuation.manage` | Create/update valuation config (effective-dated ceremony) | ✓ | ✓ | | |
| `parts.pricetape.view` | View price-tape loads and history | ✓ | ✓ | ✓ | ✓ |
| `parts.pricetape.approve` | Load/preview/approve a price-tape revaluation | ✓ | ✓ | | |
| `parts.obsolescence.view` | View obsolescence provision runs | ✓ | ✓ | ✓ | ✓ |
| `parts.obsolescence.approve` | Preview/approve an obsolescence provision | ✓ | ✓ | | |
| `parts.scrap.view` | View scrap disposals | ✓ | ✓ | ✓ | ✓ |
| `parts.scrap.execute` | Execute a scrap disposal (distinct permission per S068's "distinct permission" requirement — deliberately NOT granted alongside obsolescence.approve by default) | ✓ | ✓ | | ✓ |
| `parts.physical.view` | View physical-inventory sessions/variance reports | ✓ | ✓ | ✓ | ✓ |
| `parts.physical.count` | Open a session, freeze scope, enter counts | ✓ | ✓ | | ✓ |
| `parts.physical.approve` | Approve a variance-reviewed session (posts the adjustment) | ✓ | ✓ | | |
| `parts.deposit.view` | View special-order deposits, abandoned queue | ✓ | ✓ | ✓ | |
| `parts.deposit.manage` | Create/apply/refund/escheat a deposit | ✓ | ✓ | ✓ | |
| `parts.oemreturn.view` | View OEM parts-return authorizations | ✓ | ✓ | ✓ | ✓ |
| `parts.oemreturn.manage` | Authorize/ship/credit/disposition an OEM return | ✓ | ✓ | | ✓ |
| `parts.exception.view` | View the CE-11 posting exception/recovery queue | ✓ | ✓ | ✓ | |
| `parts.exception.manage` | Resolve/re-request an exception | ✓ | ✓ | ✓ | |
| `parts.mapping.view` | View tenant account-mapping status per event family | ✓ | ✓ | ✓ | |
| `parts.mapping.manage` | Set a tenant-configured GL account for a mapping role (Controller-tier, matches tax.config.manage) | ✓ | ✓ | | |

Rationale for `parts.scrap.execute` as a distinct key from
`parts.obsolescence.approve`: S068 explicitly calls for "a distinct
permission" for scrap disposal separate from provision approval — a
Controller who can approve obsolescence provisions should not automatically
be able to physically scrap inventory without a separate grant decision;
ADMIN/CONTROLLER get both by default here, but the keys remain independent
so a tenant can split them via role_permission edits without a new
migration.
