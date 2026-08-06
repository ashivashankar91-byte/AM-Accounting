# S009 v1 — Decision Memo (FINAL, as approved by Product 2026-07-28)

**Status:** DECIDED — implementation authorized. Supersedes the draft options
presented in the prior repository-verification pass. Resolves
`P01_STORY_BLOCKING_REGISTER.csv` BLK-08, BLK-09, BLK-10 (already resolved),
BLK-11, and adds BLK-12 (DISTRIBUTION presentation, not previously numbered).

Ownership: **gl-service** (confirmed — see
`P01_REPOSITORY_VERIFICATION_RECONCILIATION.md` §3; `coa-service` has neither
the `COST_OF_SALES`/`DISTRIBUTION` account types nor the BS/IS endpoints).

---

## BLK-08 — Gross Profit subtotal placement — DECIDED: Option A

```
INCOME STATEMENT
  Revenue                          (type = REVENUE)
  Cost of Sales                    (type = COST_OF_SALES)
  GROSS PROFIT  = Revenue − Cost of Sales
  Operating Expenses               (type = EXPENSE)
  NET INCOME = Gross Profit − Operating Expenses
```

- No department-level Gross Profit sub-grouping in S009 v1 (Option C rejected
  for v1 — out of the approved S227 acceptance criteria scope; would require
  its own story contract extension).
- Balance Sheet is unaffected structurally — `netIncome` still flows into BS
  Equity as `currentEarnings` (S227 contract §6/§7); only its derivation
  changes from `revenue − expense` to `revenue − costOfSales − expense`.
- **Accounting SME final validation recorded as PENDING** — per Product
  instruction, this does **not** block implementation. Tracked in
  `P01_STORY_BLOCKING_REGISTER.csv` BLK-08.

## BLK-09 — Effective-period behavior — DECIDED: Option 2 (fully effective-dated, prospective)

- Every `statement_line_id` mapping/reclassification requires: `effectivePeriod`
  (YYYY-MM), `reason`, authenticated actor (`getActor()`), and must not
  overlap any existing effective range for the same account.
- Mapping history is immutable — append-only, never updated/deleted in place.
- A statement request for period `asOf` resolves, per account, the mapping row
  where `effective_from <= asOf` and (`effective_to IS NULL` or
  `asOf < effective_to`) — i.e. historical reports always reproduce the
  mapping that was in effect for that period, never today's mapping.
- **Initial migration/bootstrap mappings** (seeding the registry against
  existing accounts) may be backdated **only** through a governed migration
  process (a data migration script, not the runtime API), with explicit audit
  evidence (`GL_STATEMENT_LINE_BOOTSTRAPPED` outbox event recording the
  migration run, actor = `system`, and the full account→line mapping set
  applied).

## BLK-10 — Certified classification enum values — RESOLVED (no action)

No schema change to `GLAccount.type` — `ASSET | LIABILITY | EQUITY | REVENUE
| EXPENSE | COST_OF_SALES | DISTRIBUTION` already exist in gl-service
(`prisma/schema.prisma:18`, `packages/shared-kernel/src/types/index.ts:77`).

## BLK-11 — API response versioning — DECIDED: schemaVersion field, no new route

- Keep existing routes: `GET /reports/balance-sheet`, `GET
  /reports/income-statement` (and their `/export` CSV variants).
- Add `schemaVersion: 2` to both response bodies.
- Preserve all existing fields byte-for-byte in meaning; **add** `costOfSales:
  {rows, total}` and `grossProfit: number` to the income statement response.
- **`excludedAccounts` semantics change (documented, not silent):** under
  `schemaVersion: 1` behavior, both `COST_OF_SALES` and `DISTRIBUTION` rows
  appeared in `excludedAccounts` with `reason: 'OUT_OF_SCOPE_ACCOUNT_TYPE'`.
  Under `schemaVersion: 2`: `COST_OF_SALES` rows no longer appear in
  `excludedAccounts` at all (they move into `costOfSales`); `DISTRIBUTION`
  rows appear in `excludedAccounts` only when their balance is exactly zero
  (expected/normal case, `reason: 'DISTRIBUTION_ZERO_BALANCE'`) — a non-zero
  DISTRIBUTION balance no longer appears in `excludedAccounts` at all, it
  instead fails the entire request (see below).
- No `/v2/` path introduced.

## DISTRIBUTION — DECIDED: posting-expansion mechanism, fail-closed on anomaly

- `DISTRIBUTION`-type accounts are **not** a statement section. They exist
  solely as the percentage-split posting mechanism already implemented in
  `gl-service.ts:449-467` (`@cobol-origin getgldistr.cbl`), which expands any
  line posted to a DISTRIBUTION account into its `gl_distributions` targets
  **before** the journal entry is saved. A correctly-operating system should
  therefore always observe a **zero** resting balance on these accounts.
- **Zero balance (expected):** the statement renders normally; the
  DISTRIBUTION account is listed in `excludedAccounts` with
  `reason: 'DISTRIBUTION_ZERO_BALANCE'` (diagnostic only, does not affect any
  total).
- **Non-zero balance (anomaly):** fail closed.
  - HTTP `500`, `code: 'DISTRIBUTION_BALANCE_ANOMALY'`.
  - No partial or misleading statement is returned (same "never a
    forced-balanced/silent statement" discipline as `STRUCTURAL_IMBALANCE`
    and `UNCLASSIFIED_ACCOUNT_TYPE`).
  - The balance is **never** folded into Expense and **never** silently
    dropped/excluded.
  - Diagnostic/audit evidence is recorded: an `AuditOutboxEvent` of type
    `GL_DISTRIBUTION_BALANCE_ANOMALY_DETECTED` is emitted with the account
    code(s), balance(s), and the requested statement scope, so this is
    discoverable even though the request itself fails.
- **Accounting SME final validation recorded as PENDING** — per Product
  instruction, this does **not** block implementation. Tracked in
  `P01_STORY_BLOCKING_REGISTER.csv` BLK-12 (new item, no prior BLK number
  existed for this).

---

## Implementation authorization

Per Product instruction (2026-07-28), S009 proceeds as a complete vertical
slice under gl-service ownership. See the accompanying implementation plan
(schema/migrations, API examples, permissions, audit events, UI routes,
BS/IS impact, backward-compatibility plan, and test plan) delivered alongside
this memo in the session record. Implementation continues unless a new
material repository conflict is discovered.

---

## Architecture follow-up (recorded, not in S009 v1 scope)

**Separate-ledger alignment question.** gl-service and coa-service remain
two independently-evolving ledgers with no live cross-service reconciliation
or drill-through (pre-existing, documented limitation — see
`decisions/ADR-JL-001_SEPARATE_LEDGER_LIMITATION.md` and
`KNOWN_LIMITATIONS_REGISTER.md` item 1). S009 v1 does **not** change this:
statement metadata, reporting classification, and the COST_OF_SALES/
DISTRIBUTION presentation fixes delivered here are gl-service-only, per the
explicit S009 v1 exclusion of "cross-service account synchronization" and
"ledger unification." Whether/how the two ledgers should eventually be
reconciled or unified (and whether coa-service should ever need its own,
separately-governed statement-metadata concept) is an open architecture
question, tracked here as a follow-up for a future story — not resolved,
not blocking, and explicitly out of scope for this implementation.

## Implementation status (as of this pass)

- Schema/migration (`StatementLine`, `GLAccountStatementLineHistory`,
  additive non-overlap `EXCLUDE` constraint): implemented, validated with
  `prisma validate`/`generate`, and functionally proven (migration deploy +
  overlap-rejection + sequential-range-acceptance) against a disposable
  Postgres instance.
- `financial-statement-service.ts`: rewritten per BLK-08/BLK-11/DISTRIBUTION
  decisions; unit-tested (`financial-statement.service.test.ts`) and
  live-DB-proven (`s227-rollup-contract.proof.test.ts`).
- `routes.ts`: `DistributionBalanceAnomalyError` handling added to all 4
  report routes; CSV export updated with Cost of Sales/Gross Profit rows;
  new statement-line/statement-metadata CRUD routes added.
- `statement-line-service.ts` (new): effective-dated statement-metadata
  CRUD, non-overlap pre-check, audit outbox events
  (`GL_STATEMENT_LINE_CREATED/UPDATED`, `GL_ACCOUNT_STATEMENT_METADATA_CHANGED`),
  and historical-period mapping resolution; live-DB-proven
  (`statement-line.service.integration.test.ts`).
- `auth-service`: new permission keys `gl.statement_line.manage` /
  `gl.statement_metadata.manage`, granted to ADMIN/CONTROLLER, applied via
  migration `20260728060000_extend_authz_catalog_s009_statement_metadata`
  (validated end-to-end against a disposable Postgres instance).
- Frontend: `BalanceSheet.tsx`/`IncomeStatement.tsx` updated to render
  Cost of Sales/Gross Profit and the `DISTRIBUTION_BALANCE_ANOMALY` banner;
  typechecked clean.
- Full gl-service regression suite (104 tests, 17 files) passes against the
  migrated schema; web app typechecks clean.
- Playwright: existing golden-path smoke assertions extended
  (`is-gross-profit` visibility) and a new negative-scenario suite added
  for the DISTRIBUTION fail-closed path, following the existing direct-SQL
  scratch-fixture convention — not executed in this pass (requires the full
  live docker-compose stack rebuilt with this code, which was not run here
  to avoid disrupting a shared environment).
