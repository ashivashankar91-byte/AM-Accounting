# Trial Balance — Server-Side Audited Export Proposal

**Status:** PROPOSAL ONLY — not implemented. Per Product Checkpoint instruction, this is for Product review before any code is written.
**Date:** 2026-07-28
**Author's note on grounding:** every field below is modeled directly on the real, already-shipped, already-certified `/reports/balance-sheet/export` and `/reports/income-statement/export` endpoints in `services/gl-service/src/http/routes.ts` (lines 744–786, 818+) — not invented. Trial Balance export has no special cases the BS/IS export pattern doesn't already solve.

---

## Why this is needed

Today, Trial Balance CSV export (`downloadCsv()` in `TrialBalance.tsx`) is generated **entirely client-side** from the already-fetched JSON. It works and is BR222-1-compliant (no recomputation — it only formats fields the API already returned), but unlike Balance Sheet and Income Statement, it produces **no audit trail** for the export action — a real inconsistency across three otherwise-identical reporting screens, and the one item flagged in this checkpoint's own request.

## Verified route recommendation

`GET /api/v1/gl/reports/trial-balance/export`

Mounted in `services/gl-service/src/http/routes.ts`, immediately following the existing `GET /reports/trial-balance` handler (line 648) and modeled on `GET /reports/balance-sheet/export` (line 748). **No new gateway entry required** — already covered by the existing `/api/v1/gl` prefix in `services/api-gateway/src/index.ts:50`.

## Method
`GET` (read-only, consistent with every other report/export endpoint in this codebase — no side effects beyond the audit write).

## Request parameters
Identical to the real `/reports/trial-balance` view endpoint's query schema (`routes.ts:650-656`) — no new parameters:
- `entity` (or `company` alias) — **required**, one of the two
- `store` — optional
- `dept` — optional
- `asOf` — **required**, `YYYY-MM` (validated by the same regex already in use)

## Permission
`report.tb.view` (`GL_PERMISSIONS.REPORT_TB_VIEW`, `security.ts:12`) — the **same** permission as the view endpoint, matching the established convention (BS/IS export also reuses their view permission, `report.fs.view` — no separate "export" permission exists anywhere in this codebase today).

## Tenant / entity / store scoping
Identical to the view endpoint — `tenantId` from `x-tenant-id` (required, `getTenantId()`), `entity`/`company` required and filtered, `store`/`dept` optional filters, all passed straight into `TrialBalanceService.getReport()` — the exact same service call the view endpoint makes, so scoping cannot drift between what a user sees and what they export.

## CSV columns
Matches the **existing, already-shipped client-side CSV** exactly (`TrialBalance.tsx`'s current `downloadCsv()`), for continuity — no visible change to users when this moves server-side:

`Account, Name, Type, Prior, Activity, Ending, Debit, Credit`

mapped from `TrialBalanceRow`: `accountCode, accountName, accountType, priorBalance, currentAmount, endingBalance, debitBalance, creditBalance` (`trial-balance-service.ts:11-22`) — the same fields already on-screen after this checkpoint's visual refinement (Opening/Activity columns), so the export continues to match the screen (BR220-3/BR227 convention: export must reuse the identical computation, never a parallel calculation).

## Filename convention
`trial-balance-{entity}-{asOf}.csv` — matches the current client-side download's filename exactly (`TrialBalance.tsx`'s existing `a.download = `trial-balance-${report.scope.entity}-${report.scope.asOf}.csv``), so switching to a server-generated file is invisible to users. (Note: this differs slightly from BS/IS's `balance-sheet-{asOf}.csv`/`income-statement-{asOf}.csv`, which don't include the entity — I recommend keeping TB's existing, already-in-use filename rather than changing user-visible behavior for consistency's own sake; flagging this as a minor, low-stakes naming inconsistency across the three exports, not proposing to change any of them.)

## Limits and streaming behavior
**No pagination, no streaming, no row cap** — matching the real BS/IS export pattern exactly (`toCsv()` at `routes.ts:695-703` builds the full string in memory, single `reply.send(csv)`). This is appropriate for Trial Balance specifically: one row per account in the entity's chart of accounts (typically low hundreds, never transaction-volume), not per-transaction like GL Search/GL Inquiry (which do have real `MAX_PAGE_SIZE=500` limits for exactly this reason). No new limit is proposed because none of the sibling exports have one and TB's row count is bounded by COA size, not ledger activity volume.

## Audit event and payload
No new audit-writing code is needed in the route handler itself — `attachRouteSecurity`'s generic `onRoute` hook (`security.ts:61-90`) handles it automatically for any route registered in `resolveAudit()`. Proposed addition to `resolveAudit()` (`routes.ts:171-198`):

```ts
if (url === '/reports/trial-balance/export') {
  return { docType: 'GL_LEDGER_REPORT', docId: () => url, action: 'EXPORTED' as const };
}
```

This produces the same shape already proven live for BS/IS exports: `eventType: 'audit.exported'`, `docType: 'GL_LEDGER_REPORT'`, `docId: '/reports/trial-balance/export'`, `actor` resolved server-side from the JWT (`getActor()`, `security.ts:26-28` — **never** client-supplied), `after: {route, method, params, query, statusCode}`. Critically, per the hook's own logic (`security.ts:71`), the audit write only fires when `reply.statusCode < 400` — so a `STRUCTURAL_IMBALANCE` failure (500) produces **no** misleading EXPORTED event for a report that was never actually produced, preserving the fail-closed guarantee end-to-end into the audit trail itself.

## Error contract
Identical to the view endpoint, because export reuses the identical `trialBalanceSvc.getReport()` call — no separate error paths to design:
- `400 MISSING_ENTITY` — neither `entity` nor `company` supplied.
- `500 STRUCTURAL_IMBALANCE {error, drSum, crSum, delta}` — the slice doesn't foot. **No CSV is ever generated for an unbalanced slice** — this is the explicit fail-closed preservation this checkpoint asked for, inherited automatically by reusing the same service call.

## Service tests (proposed, not written)
New cases in `services/gl-service/tests/trial-balance.service.test.ts` or a new `trial-balance-export.test.ts`, mirroring the existing BS/IS export test shapes:
1. Export returns real CSV text with the exact 8-column header.
2. Export CSV values match the JSON view response for the same scope (proves BR220-3-style parity, not a parallel computation).
3. Export on a structurally-imbalanced slice throws `StructuralImbalanceError` (500), never returns a partial/best-effort CSV.
4. Export respects `store`/`dept` filters identically to the view endpoint.

## Gateway tests (proposed)
Extend whatever existing live-gateway certification harness already covers `/reports/balance-sheet/export` (per `S227_LIVE_GATEWAY_CERTIFICATION_REPORT.md`) with the same three checks for `/reports/trial-balance/export`: 200 with a real JWT + permission, 401 without a token, 403 for a role lacking `report.tb.view`.

## Playwright scenario (proposed)
Add a `tb-export` step to the existing 16-step journey (`golden-path.spec.ts`), directly alongside the existing `bs-export` step 13 (lines ~296-304 today) — same pattern: click a new `tb-export` button, await the real `download` event, assert the filename contains `trial-balance`. This closes a real, current test gap: **the existing suite tests BS export but never tests TB export at all**, even though the client-side TB export button (`tb-export`) already exists today.

## Exact backend and frontend files affected (if approved)

**Backend:**
- `services/gl-service/src/http/routes.ts` — add the `/reports/trial-balance/export` handler (mirroring lines 744-786) and two small additions to the existing `resolvePermission`/`resolveAudit` functions (one line each).
- `services/gl-service/tests/trial-balance-export.test.ts` (new) or extend `trial-balance.service.test.ts`.

**Frontend:**
- `apps/web/src/api/client.ts` — add `exportTrialBalance(params)` using `apiFetchRaw`, mirroring the existing `exportBalanceSheet`/`exportIncomeStatement` wrappers exactly (both already in this file).
- `apps/web/src/pages/goldenpath/TrialBalance.tsx` — replace the client-side `downloadCsv()` function with a real fetch-and-download call (mirroring `BalanceSheet.tsx`'s/`IncomeStatement.tsx`'s existing `doExport()`), keeping the `tb-export` testid and the exact same filename so no test or user-visible behavior changes except that the export is now real and audited.
- `tests/e2e/golden-path.spec.ts` — add the `tb-export` download assertion described above.

## What this does NOT propose
No new permission, no new gateway route, no streaming/pagination infrastructure, no change to the CSV's columns or the filename users already see, and no change to the fail-closed structural-imbalance contract. This is the minimal change that makes Trial Balance export consistent with its two sibling reports.

---

Awaiting Product review before any of the above is implemented.
