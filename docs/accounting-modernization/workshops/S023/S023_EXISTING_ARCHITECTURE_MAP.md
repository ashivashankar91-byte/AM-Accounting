# S023 — Existing Architecture Map

**Status:** Read-only repository research. Nothing here is a design decision — it is what is actually built today on `r1-integration` (HEAD `51ad9d6` at the time of this pack), gathered to support the S023 Definition Workshop. Where evidence comes from an unmerged branch, that is called out explicitly — it is not part of `r1-integration` today regardless of certification claims made on that branch.

---

## 1. Canonical registry status (corrects the workshop pack's own premise)

The workshop pack states S023's "accepted contract, acceptance criteria, decision records and legacy evidence are NOT available in the repository or accessible Fable workspace." That is **half true**. A prior read-only verification pass in this session (before this pack was supplied) searched the plain-text tree and genuinely found nothing. This pass found more, because the canonical registry is **tracked in git but zipped**:

- `docs/accounting-modernization/AutoMate2_Accounting_Backlog_Package_v1.1.zip` (git blob `6df1667`, committed at `8453d0f`, present at HEAD) contains `out/ACCOUNTING_MASTER_BACKLOG.md`, `out/canonical_registry.json`, and `out/OPEN_QUESTIONS_AND_DECISIONS.md` — the exact `OPEN_QUESTIONS_AND_DECISIONS.md` the workshop pack cites by name and says doesn't exist.

**What it actually says about CE-07 / S023** (`out/ACCOUNTING_MASTER_BACKLOG.md:151-164, 710`):

```
## EPIC CE-07 - Posting Rule Engine
3 Layman: The rules engine that turns business events (an RO closing, a car selling)
  into correct accounting entries automatically - no code changes.
8 Stories (4): S019 S020 S021 S023
9 Release/sprints: R1 / Sprints 4-6
10 Dependencies: CE-03
15 Key risks: Rule misconfiguration (sim sandbox deferred to R6 by design)
16 Open decisions: None
17 Success metrics: Golden tests per pack entry green; zero direct GL writes
   from operational services
18 Exit criteria: Rule pack v1 posts AP/AR/Cash goldens
20 Explicitly deferred: Simulation sandbox (S022/R6)

| S023 | Rule Pack v1 (AP/AR/Cash) | CE-07 | R1 | L2 | EXPANSION_PENDING |
```

`canonical_registry.json`: `{"id":"S023","title":"Rule Pack v1 (AP/AR/Cash)","epic":["CE-07"],"release":"R1","level":[2]}`, disposition `RETAINED`.

This resolves why **S022** never appears anywhere in the repo: it's an R6 story (simulation sandbox), explicitly deferred, not part of R1/CE-07 — its absence is by design, not a gap.

**What is still genuinely missing**: no dedicated `S023.md` build packet exists anywhere (the zip's `COPILOT_BUILD_PACKETS/R0/` only covers R0 stories, S200-series + a few R0 CE-03/CE-04 items). `EXPANSION_PENDING` status means exactly what it says — a one-line stub, no accepted AC, no DR/CR matrix, no event contract. **The prior verdict `S023_ACCEPTED_RECORD_NOT_FOUND` is upgraded, not reversed: a canonical stub exists; a full accepted contract still does not.**

`OPEN_QUESTIONS_AND_DECISIONS.md` names **zero** UQ rows against S023 or CE-07 directly. Tangential UQs that do bear on S023's decisions:

| UQ | Subject | Status | Relevance |
|---|---|---|---|
| UQ-06 | Default posting mode direct vs approval-required | Resolved (R0 default=direct, PO-signed) | Background only |
| UQ-13 | Source coding: legacy numeric codes vs mnemonics | **Open** — "BLOCKS S212 final AC" | Directly gates D-S023-11 |
| UQ-16 | Department dimension line rules | Open, interim | Touches D-S023-07 store/dept resolution |
| UQ-18 | Control#/Apply# semantics (schedule keys) | **Resolved (interim)** — `schedule_key` model shipped in S026/S027 | Workshop pack overstates this as an open gate for D-S023-16/17 |
| UQ-21 | Source-level security vs permission catalog | Open — "BLOCKS S212 permission integration" | Touches D-S023-11/29 |

---

## 2. Existing journal sources (D-S023-11)

Two parallel registries exist — **this split is itself an open architectural question the workshop pack does not ask**:

| Registry | Service | Model | Scope | Used by posting engine? |
|---|---|---|---|---|
| S212 Journal Source Registry | coa-service | `JournalSource` (`prisma/schema.prisma:268-287`) | tenant-scoped, `code VARCHAR(6)`, `numericAlias Int?` (placeholder, UQ-13 not resolved), `sourceClass MANUAL\|SYSTEM`, `reserved`, `autoPost`, `yearEndOnly`, `thirteenthOnly`, `status` | **Yes** — `PostingService.resolveContext()` looks up here; BR013-3 enforces existence/active/class-match |
| Legacy `gl_sources` | gl-service | separate table, numeric-first (per CLAUDE.md PO-DEC-004: 88/3/30/32/40/95 etc.) | tenant-scoped | No — gl-service's own direct journal-entry API doesn't route through coa-service's posting engine at all |

Reserved codes are defined as an **application-level constant list** (`services/coa-service/src/domain/journal-source.ts:26-45`): `GJ`(88), `ADJ`(3), `YE`(90), `M13`(91), `SVC`(30, auto_post), `PART`(32, auto_post), `WARR`(40, auto_post), `PAY`(95, auto_post), `RT`(50). These are **not** seeded by any SQL migration — they only enter the database when `SourceService.bootstrapReserved(tenantId, actor)` is explicitly invoked (`source-service.ts:224-230`, called only from `POST` in `source-routes.ts:114`, or from tests). **No evidence this bootstrap runs automatically on tenant provisioning.** TECHNICAL_CONFIRMATION_REQUIRED: does every tenant actually have these rows today, or only tenants where an operator has manually called the bootstrap endpoint?

Rule-pack versions stamp exactly one `journalSourceCode` string (`dsl.ts:98`), immutable once active. The rule-pack **validator only checks the code is a non-empty string** at draft-validate time (`validator.ts:184-185`) — it does **not** check the code exists in the `JournalSource` registry. A pack can be VALIDATED and ACTIVATED with a source code that doesn't exist; the failure only surfaces per-event at actual posting time via BR013-3.

---

## 3. Posting-engine permissions (D-S023-29)

Auth catalog sequence: `1.0.0 → 1.26.0` (last: S043A, migration `20260730110000`). **Next free slot for any S023 auth migration: `1.27.0`.**

`posting_engine.*` (6 total, migration `20260729020000_extend_authz_catalog_posting_engine`, catalog v1.16.0), naming convention `posting_engine.<noun>.<verb>`:

| Permission | ADMIN | CONTROLLER | ACCOUNTANT |
|---|---|---|---|
| `posting_engine.rule_pack.view` | ✓ | ✓ | ✓ |
| `posting_engine.rule_pack.edit` | ✓ | ✓ | |
| `posting_engine.rule_pack.validate` | ✓ | ✓ | ✓ |
| `posting_engine.rule_pack.activate` | ✓ (only) | | |
| `posting_engine.execution.view` | ✓ | ✓ | ✓ |
| `posting_engine.exception.view` | ✓ | ✓ | ✓ |

`POST /posting-engine/events` (the actual event-submission endpoint) is **not gated by any of these** — explicit code comment: "service-to-service call," authenticated via `SERVICE`-role JWT which bypasses the RBAC lookup in `authz-guard.ts` entirely.

No `replay` or `simulate` permission exists (neither capability is built). S021's own (unmerged) permission is a separate namespace: `posting-recovery.replay.execute`, ADMIN+CONTROLLER only.

**SoD reality (D-S023-28)**: role-tier separation exists (CONTROLLER can edit/validate, only ADMIN can activate) but there is **no identity-based author≠activator check** — `activateVersion()` (`posting-engine-service.ts:180-201`) never compares the activating `actor` to `version.createdBy`. An ADMIN can author and activate their own draft today. The workshop pack's claim that this would be "consistent with the S041 pattern" is **not accurate** — S041's approval matrix (`invoice-approval-service.ts:148-150`) enforces only that different approval *tiers* require different *roles*; it has no `actor !== createdBy` identity check anywhere either. There is no existing precedent in this repo for true author≠activator SoD enforcement — it would be new engineering work if Security requires it.

---

## 4. Current idempotency model (D-S023-24)

Single, exact, already-built mechanism in the merged S019/S020 engine:

- Identity key: `tenantId + eventId`.
- Same identity + same canonical payload hash → **exact duplicate**, no-op, returns the original result (`idempotent: true`).
- Same identity + **different** hash → `EventIdentityConflictError` (HTTP 409) + a durable `posting_exception` row (`reasonCode: EVENT_IDENTITY_CONFLICT`).
- Enforced by a real DB unique index: `posting_execution_tenant_id_event_id_key`.
- Race-safe: concurrent submissions catch Postgres `P2002` and return the winner's result rather than erroring (`createOrReconcileExecution()`, `posting-engine-service.ts:371-388`).

This is the **only** idempotency mechanism in the merged codebase relevant to posting. S052 cash receipts has its own, separate, stronger mechanism (explicit `idempotencyKey` string + DB unique constraint on `(tenantId, idempotencyKey)`) — the two are not unified and use different key shapes (`tenantId+eventId` vs. arbitrary caller-supplied string).

**The unmerged S021 branch's "CH01 idempotency-passthrough" behavior rides on top of this same key**: replaying an event whose `(tenantId, eventId)` already has a terminal `postingExecution` row (POSTED **or** REJECTED/FAILED/NO_RULE_MATCH) returns that **same original result** — it does not re-run rule evaluation. This is a property of the merged engine's contract, not something the recovery service can change without altering S019/S020 itself.

---

## 5. Rule versioning model (D-S023-09)

- Version lifecycle: `DRAFT → VALIDATED → ACTIVE → SUPERSEDED` (+ `REJECTED`), enum enforced by DB check.
- Activating a version **atomically supersedes** any prior ACTIVE version for the same `packKey` — exactly one ACTIVE version per `packKey` at a time.
- `effectiveFrom`/`effectiveTo` dating validated at draft-validate time (`effectiveTo` must be after `effectiveFrom`).
- A DB trigger (`enforce_posting_rule_pack_version_immutability`) blocks any content/date/source-code mutation once a version is ACTIVE or SUPERSEDED, and blocks reverting status backward.
- Every `posting_execution` row pins `rule_pack_version_id`, `rule_id`, and `blueprint_hash` — full traceability of which version posted which journal.

**Gap**: this discipline holds *within* one `packKey`. It does **not** prevent two *different* `packKey`s from having overlapping active effective ranges that both match the same `(tenantId, eventType)` — version selection across packs silently tie-breaks (`effectiveFrom DESC, packKey ASC`) rather than rejecting the ambiguity. See feasibility matrix D-S023-08/09 for the direct consequence.

---

## 6. Event / outbox model (D-S023-06, D-S023-35)

**There is no single event/outbox convention in this repository today — three incompatible shapes coexist:**

| Producer | Shape | Required envelope fields present? |
|---|---|---|
| coa-service posting engine (`SourceEventEnvelope`, `event-envelope.ts`) | Structured envelope: `eventId`, `eventType`, `eventSchemaVersion`, `sourceSystem`, `sourceEntityType`, `sourceEntityId`, `businessDate`, `correlationId`, `causationId`, payload | Yes — this is the only producer that emits the full envelope |
| cash-service (`cashOutboxEvent`) | Generic `{type, tenantId, payload, occurredAt, correlationId}` | No — missing `eventId`, `eventSchemaVersion`, `sourceSystem`, `sourceEntityType/Id`, `businessDate` |
| apar-service (generic `outboxEvent(eventType, aggregateId, payload)` helper) | `{aggregateId, ...payload}` written to a generic `outboxEvent` table | No — same gaps as cash-service |

**Concretely, none of S039/S043A/S052's actual outbox events are `SourceEventEnvelope`-shaped.** The workshop pack's D-S023-06 framing ("field set derived from the already-built S039/S043A/S052/S053 payloads... extraction") is not achievable as pure extraction — see `S023_CURRENT_EVENT_PAYLOADS.md` for the exact payloads and the gap each one has against the envelope contract.

Emitted-events question (D-S023-35): the merged engine already emits exactly one outcome shape per execution (`postingExecution` row + `acct.je.posted` on the `coaOutboxEvent` table for successful posts) — there is no separate `rule.evaluated`/`pack.activated` event stream today; pack lifecycle changes (validate/activate) are audit-logged but not published as domain events.

---

## 7. Tenant / RLS conventions

Consistent pattern across every service touched by this investigation (posting-engine, posting-recovery [unmerged], cash-service, apar-service, coa-service journal/period tables):

- Every tenant-owned table carries `tenant_id`.
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`, plus 4 policies (SELECT/INSERT/UPDATE/DELETE) keyed on `tenant_id = current_setting('app.current_tenant_id')`.
- A bypass role (`amacc_rls_bypass`) exists for background/cross-tenant drainers (e.g. audit-reference tables that a drainer processes outside tenant context) — audit-reference tables are the one deliberate RLS exclusion, consistently applied (gl-service and the unmerged posting-recovery-service both do this the same way).
- This is ADR-001's tenant-isolation pattern, applied identically everywhere checked. No conflict expected for any new S023 tables — reuse the pattern as-is.

---

## 8. Current DLQ and replay limitations

**The single most important cross-cutting fact for Section D of the workshop pack: there is no real DLQ on `r1-integration` today.**

- S021 (`posting-recovery-service`) — the only DLQ/replay implementation that exists anywhere in this codebase — lives exclusively on two unmerged branches (`r1-s021-posting-recovery-foundation` @ `f738d75`, `r1-s021-posting-recovery-completion` @ `be22817`/`8c283c2`/`52361db`). Confirmed via `git merge-base --is-ancestor`: **none of these four commits are ancestors of `r1-integration` HEAD.**
- On `r1-integration` as it stands, a posting-engine rejection just produces a `postingExecution` row (`status: REJECTED`/`FAILED`) plus, for only 2 of the ~5+ failure kinds (`NO_RULE_MATCH`, `EVENT_IDENTITY_CONFLICT`), a `posting_exception` row. Everything else (ambiguous match, unbalanced blueprint, bad account, missing field) is a free-text `failureReason` string with no structured classification and no queue to land in.
- Every "reject to DLQ" option in Section D of the workshop pack (D-15, D-21, D-23, D-26) is therefore proposing behavior that has **no real destination** until S021 is integrated. This is a blocking dependency for the *whole* Failure & Recovery section, not a per-decision nuance.
- Even once merged, S021's own certification report discloses two unresolved limitations: (a) a crash between acquiring `REPLAY_IN_PROGRESS` and the finalize transaction leaves a case stuck with no automatic reaper — manual operator intervention required; (b) its Playwright e2e was never run against a real browser (substituted with live HTTP-level proof). Its own verdict is `S021_TECHNICALLY_CERTIFIED_PENDING_INTEGRATION`, and its commits explicitly disclaim "S023 complete" or "production readiness."
- **Hard conflict already discovered**: S021's replay mechanism re-POSTs the original envelope and relies on CH01's `(tenantId, eventId)` idempotency to short-circuit to the **original terminal result** — it does not re-run rule selection/evaluation. This directly conflicts with D-S023-25's proposed option (a) ("replay uses the current active pack version... both versions recorded on the audit trail") — under the actual built contract, replaying an event that already has a terminal non-POSTED outcome returns that **same old outcome**, not a fresh evaluation under a corrected rule. Resolving this requires either a change to S019/S020's engine contract (which conflicts with D-S023-22's "engine unchanged" premise) or a different replay design than what S021 currently builds.

---

## 9. Existing schedule / open-item linkage (D-S023-16/17)

- S026 (Open-Item Core) + S027 (Aging) are merged on `r1-integration` (commit `3964146`). S028 (Exception & Escalation) and S029 (Split/Transfer/Writeoff) do **not exist anywhere** — not even on an unmerged branch.
- Real, working linkage precedent exists: `ScheduleOpenItem` (`services/schedule-service/prisma/schema.prisma:132-176`) is created/relieved from `JOURNAL_ENTRY_POSTED` events emitted directly by **gl-service**'s `approveJournalEntry()` — keyed by `sourceCorrelationId` for idempotency, with `applyNumber` matching an existing `itemNumber` to relieve (unset → opens a new item).
- The resolved (interim) `schedule_key` model from UQ-18: `schedule_key = (tenantId, scheduleNumber, controlNumber)`, `scheduleNumber` sourced from `account.scheduleCode`, `controlNumber` from `line.controlNumber` — directly descended from legacy `DE-SCHDNO`/`DE-CONTNO`.
- **This entire linkage bypasses the S019/S020 posting engine** — it runs gl-service → schedule-service directly. CE-08's own dependency note in the canonical registry states this explicitly: "the live schedule-service pipeline bypasses CE-07 entirely today." Whether S023-authored rule packs must produce postings that flow through this exact same gl-service-driven path (to trigger schedule effects) or whether a new, engine-native schedule-effect mechanism must be built is a genuinely open integration question — not something either UQ-18 or the current schedule-service code answers.
