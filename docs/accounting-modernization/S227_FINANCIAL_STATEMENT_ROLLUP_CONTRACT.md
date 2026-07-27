# S227 — Financial Statement Roll-Up Contract

Status: **PRODUCED, PROOF-VALIDATED** (per PO instruction: this contract must exist
and its roll-up math must be proven against real data *before* S227
implementation begins; it is not itself the S227 implementation).

Companion proof: `services/gl-service/tests/s227-rollup-contract.proof.test.ts`
(real live-DB test, same `describe.skipIf(!DATABASE_URL)` convention as the
S014 integration test; run and passing — see §9).

This document is the single source of truth S227 must implement against. It
does **not** invent new accounting rules — every rule below is either (a) a
direct restatement of the approved Story Contract's BR227-1..4, or (b) derived
mechanically from data S014 (`TrialBalanceService`) already produces, with no
new calculation logic.

## 1. Scope and non-goals

S227 renders a Balance Sheet (BS) and Income Statement (IS) as a
**reclassification and summation** of the exact rows already returned by
S014's `GET /reports/trial-balance` for a given `{entity, store?, dept?,
asOf}` slice. S227 must not run its own ledger query, its own balance
computation, or its own rounding — it consumes `TrialBalanceReport.accounts`
as-is.

Because BS/IS is a pure re-grouping of the same rows S014 already produced,
**A = L + E ties to S014's own `drSum`/`crSum` by construction**, not by a
separate reconciliation step bolted on afterward (see §8).

## 2. Account classification

Source of truth: `TrialBalanceRow.accountType`, which is `GLAccount.type` in
gl-service (`ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE | COST_OF_SALES |
DISTRIBUTION` — schema comment, `services/gl-service/prisma/schema.prisma:16`).

The approved Story Contract (row 12) defines BS sections as exactly
`{Assets, Liabilities, Equity(+currentEarnings)}` and IS sections as exactly
`{Revenue, Expense, netIncome}` — five types only. `COST_OF_SALES` and
`DISTRIBUTION` are **explicitly out of scope** for this basic BS/IS (they are
not named anywhere in the approved contract). This is a documented
non-goal, not a silent drop:

- Any row whose `accountType` is `COST_OF_SALES` or `DISTRIBUTION` is
  **excluded from both statements** and reported in a `unclassifiedTotal`/
  `excludedAccounts` diagnostic list so a controller can see it was omitted,
  not silently absorbed into Expense.
- Any row whose `accountType` is missing, empty, or is not one of the seven
  known values is a **structural error** (`500 UNCLASSIFIED_ACCOUNT_TYPE`),
  never silently included in a miscellaneous bucket and never dropped
  without surfacing it. This mirrors the "never a forced-balanced statement"
  mandate: an unclassifiable account means the statement cannot be trusted,
  so it must fail loudly, exactly like `STRUCTURAL_IMBALANCE`.

## 3. Hierarchy aggregation

**Architecture caveat carried over from S222 (ADR-JL-001):** gl-service (S014)
and coa-service (S211) are separate ledgers with disjoint account IDs and
disjoint numbering conventions; there is no consumer/projection syncing them.
S227 therefore **cannot** use coa-service's certified S211 `parentId`
hierarchy for gl-service data — the same honest limitation already
documented and proven live for S222's drill-through.

gl-service's own `GLAccount` model does carry its own `parentId` field
(`schema.prisma:20`) plus `subtotalGroup1/2/3` (BUILD-014) and `glGroup`. For
the basic BS/IS required by S227's approved contract (flat sections by
`accountType`, no sub-hierarchy roll-up is named in the acceptance criteria),
**no hierarchy traversal is required at all** — `accountType` alone fully
determines section placement. Hierarchy-based sub-section grouping (e.g.
Current vs. Fixed Assets) is explicitly **not** part of the approved S227
acceptance criteria and is called out as a known gap, not implemented here,
to avoid inventing scope beyond the contract.

## 4. Normal balances

Reused verbatim from S014: each row already carries `normalBalance` (`DEBIT`
| `CREDIT`) and pre-computed `debitBalance`/`creditBalance` (mutually
exclusive; one is always 0) via `TrialBalanceService.toBalanceSides()`. S227
introduces **one new derived value**, computed uniformly for every row with
no per-type branching:

```
signedNatural(row) = row.debitBalance - row.creditBalance
```

This single formula, applied identically to every row regardless of type or
contra status, is sufic to build both statements (§6). No special-casing is
needed anywhere else.

## 5. Contra accounts

gl-service has **no explicit `isContra` flag** (unlike coa-service's S211
`GlAccount.isContra`/`contraReason`). A contra account is therefore *any*
account whose `normalBalance` is the opposite of its type's textbook default
(ASSET/EXPENSE default DEBIT; LIABILITY/EQUITY/REVENUE default CREDIT) — e.g.
"Accumulated Depreciation" is `type=ASSET`, `normalBalance=CREDIT`.

**No special-case math is introduced for contra accounts.** Because
`signedNatural()` (§4) is computed from `debitBalance`/`creditBalance`
(already normal-balance-aware, per-row, from S014) rather than from
`accountType` assumptions, a contra-asset's negative contribution to total
Assets falls out of the same uniform sum used for every other account. This
was proven in the companion test (§9): an Accumulated Depreciation row
correctly nets to **reduce** total Assets with no branch in the roll-up code
dedicated to "if contra, flip sign."

## 6. Roll-up formulas (BR227-1, BR227-2)

For a report scoped to the same `{entity, store?, dept?, asOf}` as the
underlying S014 call, using only rows returned by that call (excluding
`COST_OF_SALES`/`DISTRIBUTION` per §2):

```
totalAssets      =  sum( signedNatural(row) | row.accountType = ASSET )
totalLiabilities = -sum( signedNatural(row) | row.accountType = LIABILITY )
totalEquity(exclCurrentEarnings)
                 = -sum( signedNatural(row) | row.accountType = EQUITY )
totalRevenue     = -sum( signedNatural(row) | row.accountType = REVENUE )
totalExpense     =  sum( signedNatural(row) | row.accountType = EXPENSE )

netIncome        = totalRevenue - totalExpense           // BR227-2 (IS)
currentEarnings  = netIncome                              // tie test, by construction
totalEquity      = totalEquity(exclCurrentEarnings) + currentEarnings

BS invariant (BR227-1): totalAssets == totalLiabilities + totalEquity
IS↔BS tie (BR227-2):   netIncome (IS) == currentEarnings line (BS)   // trivially true — same value, computed once
```

`currentEarnings` and IS `netIncome` are **the same computed number, not two
independently-derived values that happen to match** — this is what makes the
tie test structurally guaranteed rather than a coincidence to be tested for.

If `totalAssets != totalLiabilities + totalEquity` (beyond floating-point
rounding, i.e. after `money()` rounding — see §7), S227 must respond
`500 STRUCTURAL_IMBALANCE` with the computed `totalAssets`/`totalLiabilitiesAndEquity`/
`delta`, in the same shape as S014's own `StructuralImbalanceError` — **never**
a forced-balanced statement, matching the approved contract's exception
workflow (row 11) and acceptance criterion (d).

## 7. Retained earnings / net income — explicit limitation

The approved contract's BS Equity section is `{Equity(+currentEarnings
line)}` — **current-period** earnings only, not a separate multi-year
Retained Earnings accumulation engine. This contract does **not** invent a
close/roll-forward process:

- If a real `EQUITY`-type "Retained Earnings" account already exists in the
  ledger (populated by whatever real EOY/EOM close process exists), it is
  presented as its own real row like any other Equity account — its real
  balance, not a synthesized plug.
- No fabricated "Retained Earnings" balancing entry is invented to force
  A=L+E. If the ledger has no such account and the books don't balance
  without one, that is a genuine `STRUCTURAL_IMBALANCE`, not something to
  paper over.
- Multi-period YTD accumulation beyond the S014 slice's own `asOf` period is
  **out of scope** and flagged as a known gap — S227 shows exactly what
  S014 shows for that period, nothing accumulated across periods that S014
  itself doesn't already accumulate via `priorBalance`.

## 8. Rounding

Reused verbatim: `TrialBalanceService.money()` (2-decimal rounding, see
`trial-balance-service.ts:326`). S227 performs **no independent rounding** —
every intermediate and total value in §6 is a sum of already-`money()`-rounded
`debitBalance`/`creditBalance` values, so the aggregate is applied through the
same rounding convention by construction, and STRUCTURAL_IMBALANCE compares
using the identical `money()` helper (imported, not reimplemented) to avoid a
new source of penny-level false positives/negatives.

## 9. Reconciliation to S014 — proof, not assertion

Because `totalAssets - (totalLiabilities + totalEquity_exclCurrentEarnings) =
sum(signedNatural(row) for all rows in ASSET/LIABILITY/EQUITY)` and
`netIncome = sum(signedNatural(row) for REVENUE/EXPENSE) `, the full BS+IS
identity `totalAssets = totalLiabilities + totalEquity_exclCurrentEarnings +
netIncome` reduces algebraically to `sum(signedNatural(row) over ALL rows) =
0`, which is exactly S014's own footing invariant
`drSum == crSum` (since `signedNatural = debitBalance - creditBalance` summed
over all rows is `drSum - crSum`). **The BS/IS tie-out is mathematically the
same statement as S014's TB footing** — not a coincidence to be separately
verified per report, but a structural guarantee inherited directly from
S014 already having thrown `STRUCTURAL_IMBALANCE` if it didn't foot.

This was proven, not just asserted, against a real live database with a
five-account fixture including one contra account (`s227-rollup-contract.proof.test.ts`,
§9 below and results recorded there).

## 10. What S227 implementation must NOT do

- Must not re-query journal lines/entries directly (that duplicates S014).
- Must not use the existing `gl-service.ts` `getBalanceSheet()`/
  `getIncomeStatement()`/`computeAccountBalances()` prototype methods as-is:
  live code inspection (§11) found they (a) bypass `TrialBalanceService`
  entirely with their own independent balance computation, (b) do not call
  `money()` anywhere, and (c) report `balanced: <boolean>` in the response
  body on imbalance rather than **erroring loudly** — a direct violation of
  the approved contract's exception workflow (row 11: "never a forced-balanced
  statement" implies imbalance must be a hard error, not a quiet flag in a
  200 response). These are documented here as a known-gap prototype, not
  reused.
- Must not invent hierarchy/sub-section roll-ups beyond flat `accountType`
  sections (§3) — not in the approved acceptance criteria.
- Must not synthesize a Retained Earnings plug (§7).

## 11. Existing prototype code inspected (not reused)

`services/gl-service/src/application/gl-service.ts`:
- `getBalanceSheet()` (line ~1212) and `getIncomeStatement()` (line ~1247)
  exist and are wired to routes (`/balance-sheet`, `/income-statement`,
  `/financial-statements/*` in `src/http/routes.ts`), confirming row 26 of
  the Story Contract ("existing reusable code... prototype-only"). Verified
  live by reading the code (not by calling the routes): `getBalanceSheet()`
  computes `balanced: Math.abs(totalAssets - (totalLiabilities+totalEquity))
  < 0.01` and returns it as a field in a 200 response regardless of value —
  it never throws/errors on imbalance. This confirms the Story Contract's
  known-gap note (row 27: "force-balancing plugs... have not been ruled
  out") was well-founded caution: while this specific code does not insert a
  plug, it also does not satisfy BR227-1's "or errors loudly" requirement,
  and it duplicates calculation logic outside S014 (violates §1/§10). It
  must not be reused for the real S227 implementation.

## 12. Definition of Done for this contract (per PO instruction)

- [x] Account classification rule specified and grounded in real schema.
- [x] Hierarchy aggregation approach specified, with the cross-service
      limitation transparently documented (no fabricated hierarchy).
- [x] Normal balance handling specified (reused verbatim from S014).
- [x] Contra account handling specified and proven to need no special-case
      code.
- [x] Retained earnings / net income handling specified, with explicit
      scope limitation (current-period only, no YTD/close engine invented).
- [x] Unclassified account handling specified (hard error, never silently
      dropped or bucketed).
- [x] Rounding specified (reused verbatim from S014, no new rounding).
- [x] Reconciliation to S014 proven algebraically and validated with a real
      live-database test fixture including a contra account (§9, and see
      `s227-rollup-contract.proof.test.ts`).

S227 implementation may begin now that this contract has been produced and
its roll-up proof passes (see test results, §13 below is intentionally
omitted here — results are recorded in the commit message and the fleet
checkpoint report, not duplicated in this contract document).
