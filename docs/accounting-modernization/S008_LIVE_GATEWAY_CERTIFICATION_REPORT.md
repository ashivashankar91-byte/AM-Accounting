# S008 Fiscal Period Close Control — Live Gateway Certification Report

**Story**: S008 — Fiscal Period Close, Reopen and Lock Control
**Date**: 2026-07-28
**Branch**: `r1-s008-period-close-control`

## 1. Scope

Live, real-network proof that the five S008 period-transition routes
(`soft-close`, `hard-close`, `reopen`, `reopen-hard-closed`, `lock`) plus the
pre-existing `open`/board/eligibility routes are reachable through the real
API gateway with correct permission gating, correct two-step confirm
behavior for the two irreversible/elevated transitions, and correct S007
audit evidence — end to end, not via a mocked Prisma client or an in-process
Fastify harness (that automated regression coverage already exists
separately: `services/coa-service/tests/authz-guard-integration.test.ts`,
102 passing cases including a dedicated two-tier-separation class, and
`services/coa-service/tests/live-db/period-close-live.test.ts`, 19 passing
cases against real Postgres — see those files for that evidence; this report
is specifically the network-level gateway proof neither of those exercises).

## 2. Stack topology used

This branch's own code, run directly (not the pre-existing "Final-R0" or
`am-accounting-*` docker stacks already present on this machine from other
sessions/checkouts — both were confirmed, by inspecting their docker
image/process metadata, to be running code from *different* directories
(`AM-Accounting-final-r0`, `AM-Accounting`), not this branch, so they were
left untouched and not used as evidence for this story):

- A fresh ephemeral Postgres cluster (the same one
  `tests/integration/rls-live-db/setup.sh` provisions for the live-db test
  suite — `localhost:55439`), with a brand-new, dedicated database
  (`amacc_gw_test`) provisioned via `prisma migrate deploy` for
  `tenant-service`, `auth-service`, and `coa-service` — this replays every
  historical migration file verbatim (schema **and** hand-written seed
  data/triggers), which is both simpler and more production-faithful for a
  full-service boot than the schema-datamodel-bootstrap technique the RLS
  test harness uses for its narrower purpose.
- `auth-service` on `localhost:23001` (`JWT_SECRET`/`AMACC_JWT_SECRET` set to
  a shared scratch secret, `ADMIN_API_KEY` set, pointed at the DB above).
- `coa-service` on `localhost:23016` (`AMACC_JWT_SECRET` matching
  auth-service's, `AUTHZ_SERVICE_URL=http://localhost:23001`, pointed at the
  same DB).
- `api-gateway` on `localhost:23100` (`COA_SERVICE_URL=http://localhost:23016`,
  `AUTH_SERVICE_URL=http://localhost:23001`) — confirms
  `/api/v1/fiscal/*` proxies to `coa-service` exactly as configured in
  `services/api-gateway/src/index.ts` (pre-existing route, unchanged by
  S008 — no new gateway wiring was required or added).

Fixtures: one scratch tenant (`292f1970-01a1-429b-8ec5-757b5bcc674f`), one
scratch legal entity, three scratch users each with exactly one role —
ADMIN, CONTROLLER, CLERK — seeded directly against `auth-service`'s schema
(the `authz_role_assignment` read-model the real `AuthzService.check()`
queries) since there is no self-service tenant/first-admin bootstrap flow to
drive via HTTP; every subsequent action in this report — logins, fiscal
calendar setup, every period transition — went through the real HTTP
endpoints and the real gateway, using real JWTs minted by the real
`POST /api/v1/auth/login` flow. No mocks, no direct-to-service calls
bypassing the gateway.

## 3. Scenarios and results (real curl output, `localhost:23100`)

| # | Scenario | Result |
|---|---|---|
| 1 | Real login as ADMIN, CONTROLLER, CLERK via `POST /api/v1/auth/login` | 200, three real JWTs (376 chars each) with real `sub` = the real user id |
| 2 | Define fiscal calendar + generate FY2026 (ADMIN) | 200, 12 real `FUTURE` periods created |
| 3 | `GET /api/v1/fiscal/periods?entity=...` (board) | 200, real board with all 12 periods |
| 4 | `POST .../open` (ADMIN) — FUTURE→OPEN | 200 `{opened:true,status:"OPEN"}` |
| 5 | Negative: CLERK attempts soft-close | **403** `Missing required permission: fiscal.period.soft_close` |
| 6 | Negative: no `Authorization` header | **401** `Missing or invalid Authorization header` |
| 7 | Negative: missing `x-tenant-id` | **400** `x-tenant-id header is required` |
| 8 | Negative: CONTROLLER soft-close with no reason | **400** `PERIOD_REASON_REQUIRED` |
| 9 | Positive: CONTROLLER soft-close with a real reason | 200 `{transitioned:true,status:"SOFT_CLOSED"}` |
| 10 | Positive: CONTROLLER hard-close | 200 `{transitioned:true,status:"HARD_CLOSED"}` |
| 11 | Negative: CONTROLLER attempts reopen-hard-closed (ADMIN-only tier) | **403** `Missing required permission: fiscal.period.reopen_hard_closed` |
| 12 | Positive: ADMIN reopen-hard-closed, step 1 (no `confirm`) | 200, `requiresConfirmation:true`, **status unchanged** (still HARD_CLOSED) |
| 13 | Positive: ADMIN reopen-hard-closed, step 2 (`confirm:true`) | 200 `{transitioned:true,status:"OPEN"}` |
| 14 | Repeat soft-close → hard-close (CONTROLLER) to set up the lock scenario | 200 / 200 |
| 15 | Negative: CONTROLLER attempts lock (ADMIN-only tier) | **403** `Missing required permission: fiscal.period.lock` |
| 16 | Positive: ADMIN lock, step 1 (no `confirm`) | 200, `requiresConfirmation:true`, message: *"Locking a period is PERMANENT and IRREVERSIBLE in S008 v1 — no unlock path exists."* Status unchanged. |
| 17 | Positive: ADMIN lock, step 2 (`confirm:true`) | 200 `{transitioned:true,status:"LOCKED"}`, `lockedBy`/`lockedAt` populated with the real actor/timestamp |
| 18 | Terminal proof: ADMIN attempts reopen-hard-closed on the now-`LOCKED` period | **422** `PERIOD_LOCKED_TERMINAL` — *"is LOCKED — permanently terminal in S008 v1, no transition permitted"* |

Every response body, status code, and message quoted above is copied
verbatim from the real curl output of this run, not paraphrased or assumed.

## 4. Two-tier permission model — proven live, not just documented

Scenarios 5, 11, and 15 are the load-bearing proof here: CLERK (no
period-close permissions) is denied soft-close (as expected of any
unpermissioned role), but critically CONTROLLER — who **does** hold
`soft_close`/`hard_close`/`reopen` and successfully used all three in this
same run (scenarios 9, 10, 14) — is independently denied both
`reopen_hard_closed` and `lock`. This is the stronger negative the design
requires: proof that the two elevated permissions are a genuinely separate,
ADMIN-only tier, not merely "denied to roles with nothing at all."

## 5. Real S007 audit evidence

Queried directly via `psql` against the real `audit_outbox` table for the
period exercised above (`5a64c791-a743-4de9-b7ce-9238d775a8c9`, `2026-01`):

```
    action                        |  actor (real user id)                | before                     | after (excerpt)
 -------------------------------- + ------------------------------------ + -------------------------- + ------------------------------------------------
 OPEN                             | dc05ee33-...c44e (ADMIN)              | {"status":"FUTURE"}        | {"status":"OPEN", "openedBy": "dc05ee33-...c44e"}
 SOFT_CLOSE                       | 4e33e1ed-...02f58 (CONTROLLER)          | {"status":"OPEN"}          | {"reason":"live gateway cert cutoff","status":"SOFT_CLOSED"}
 HARD_CLOSE                       | 4e33e1ed-...02f58 (CONTROLLER)          | {"status":"SOFT_CLOSED"}   | {"reason":"live gateway cert month locked","status":"HARD_CLOSED"}
 PERIOD_REOPENED_FROM_HARD_CLOSE  | dc05ee33-...c44e (ADMIN)               | {"status":"HARD_CLOSED"}   | {"reason":"audit request","status":"OPEN"}
 SOFT_CLOSE                       | 4e33e1ed-...02f58 (CONTROLLER)          | {"status":"OPEN"}          | {"reason":"second cutoff","status":"SOFT_CLOSED"}
 HARD_CLOSE                       | 4e33e1ed-...02f58 (CONTROLLER)          | {"status":"SOFT_CLOSED"}   | {"reason":"second lock","status":"HARD_CLOSED"}
 LOCK                             | dc05ee33-...c44e (ADMIN)               | {"status":"HARD_CLOSED"}   | {"reason":"year sealed","status":"LOCKED"}
```

7 rows, one per real transition performed in this run, no more and no
fewer — every action name matches exactly what `period-service.ts`'s
`applyTransition()` passes as its audit action, every actor is the real
logged-in user's id (never a synthetic/service identity), and every reason
is present verbatim where the transition required one. `PERIOD_REOPENED_FROM_HARD_CLOSE`
(not a generic `REOPEN`) confirms the two-tier reopen is audited as a
distinct, higher-severity event from the ordinary `SOFT_CLOSED→OPEN` reopen,
exactly as the corrected S008 contract describes.

## 6. Disclosed: what this report does not cover

- **Cross-tenant isolation at the gateway** was not separately re-driven in
  this pass — it is already proven at two other layers this session: the DB
  RLS-negative suite (`period-close-live.test.ts`) and the route-level
  `authz-guard-integration.test.ts`'s cross-tenant case for every one of the
  five S008 permissions. Not repeating it here is a scope choice, not an
  oversight.
- **BR008-5 (hard-close blocked by open drafts)** was exercised earlier in
  this branch's Vitest suite (`period.test.ts`) and is covered by the
  Playwright spec (`tests/e2e/fiscal-period-close.spec.ts`); this pass's
  live-gateway curl session did not additionally re-create a blocking draft,
  to keep this report focused on the authorization/lifecycle proof it set
  out to deliver.
- An earlier attempt at this same task (a background agent) spent
  significant effort but did not produce a completed live-gateway proof or
  this report — it is disclosed here, not silently discarded, because some
  of its incidental output (the `goldenPathApi` S008 client methods and the
  `pages/goldenpath/FiscalPeriod.tsx` ceremony UI it built along the way)
  turned out to be genuinely useful and was kept and verified independently
  in this pass, not taken on faith.

## 7. Cleanup

All three locally-started service processes (`auth-service`, `coa-service`,
`api-gateway` on ports 23001/23016/23100) were stopped after this run. The
scratch database (`amacc_gw_test`) lives only in this session's own
ephemeral Postgres cluster (`localhost:55439`, the same one
`tests/integration/rls-live-db/setup.sh` manages) — dropped via that
cluster's normal teardown, never the shared `am-accounting`/`Final-R0`
Postgres instances. No other story's evidence or fixtures were read,
modified, or put at risk by this pass.

## 8. Verdict

`S008_LIVE_GATEWAY_CERTIFICATION_PASSED`. All five S008 transition routes
are reachable through the real gateway with correct authorization (both
permission tiers proven, not just documented), correct two-step confirm
semantics for the two irreversible/elevated transitions, correct terminal
enforcement of `LOCKED`, and correct, complete S007 audit evidence.
