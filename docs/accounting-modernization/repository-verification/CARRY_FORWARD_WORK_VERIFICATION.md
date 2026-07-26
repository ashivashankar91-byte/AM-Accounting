# Carry-Forward Work Verification

For each item MODULE_STATE.json lists as carry-forward/closure work, here is what the repository actually shows versus what would need to happen.

## 1. Real S207 authorization wiring

- **Evidence found**: `AUTHORIZATION_AND_AUDIT_VERIFICATION.md` — the real engine exists and is deny-by-default, but is called only from within `auth-service` (S205, S206). 13 other route files (4 in tenant-service, 9 in coa-service) use local static stub maps.
- **Affected stories**: S200, S201, S203, S204 (tenant-service) + all 15 coa-service stories (S223, S208-S213, S010, S013, S214-S219) = 19 of the 22 "done" stories.
- **Exact missing implementation**: replace each route file's local `ROLE_PERMISSIONS`/`ADMIN` `Set` construction with an HTTP or in-process call to `AuthzService.check()` (or a shared client wrapping it), plus wiring role/permission read-models (`AuthzRoleAssignment`) to be populated by real `iam.assignment.*` events instead of the current seed-only data.
- **Category**: functional work (not merely integration-test rewiring) — the current state isn't "real logic behind a test double," it's 13 separately-hand-written stub authorization implementations that would all need to be deleted and replaced.
- **Belongs inside FINAL-R0?** Yes — R0's own GOLDEN-R0 exit script implies working, consistent authorization; shipping with 13 duplicated stub implementations is a functional gap, not a hardening nice-to-have.

## 2. Real S007 audit wiring

- **Evidence found**: `AUTHORIZATION_AND_AUDIT_VERIFICATION.md` — a real `audit-service` with write+read logic exists but is completely disconnected; `auth-service`/`coa-service` write to local `audit_outbox` stub tables with no consumer; `tenant-service` has no audit table at all.
- **Affected stories**: S200, S201, S203, S204 (no mechanism at all) + S205, S206 + all 15 coa-service stories (write-only stub, no consumer) = effectively all 22.
- **Exact missing implementation**: (a) add an `AuditOutboxEvent`/audit table to `tenant-service`'s schema (currently entirely absent), (b) build a poller/consumer that reads each service's outbox table and forwards to `audit-service`'s `AuditService.log()`, (c) wire `legal-entity-routes.ts`'s `/:id/audit` (and equivalents to be built for other entities) to genuinely resolve via that pipeline rather than silently returning `[]`.
- **Category**: functional + integration work — the consumer/poller doesn't exist in any form yet (not even a stub), so this is new-build, not just "point the stub at the real thing."
- **Belongs inside FINAL-R0?** Yes, per the same GOLDEN-R0 rationale (its step 7 explicitly requires "audit tab shows the complete chain").

## 3. Broker-backed event verification

- **Evidence found**: the `RabbitMQEventPublisher` in both `tenant-service` and `auth-service` (`infrastructure/event-publisher.ts`) is a **real** `amqplib` client — it actually connects to RabbitMQ and asserts exchanges, with a documented graceful fallback ("RabbitMQ unavailable — falling back to in-memory event bus") if the broker can't be reached. However, `subscribe()` only registers **in-process JavaScript callbacks** invoked synchronously from the same process's own `publish()` — no queue is ever declared or bound to the exchange, so no other process (or even a restarted instance of the same process) could ever actually receive a message via the broker. This is a publish-with-local-fanout client, not a broker-backed pub/sub system, regardless of whether RabbitMQ is reachable.
- **Affected stories**: all 22 (every emitted domain event: `org.entity.created`, `org.franchise.*`, `iam.user.deactivated`, `acct.je.posted`, `coa.*`, `fiscal.*`, `je.draft.*`, etc.)
- **Exact missing implementation**: declare and bind a durable queue per consumer, replace the in-process `handlers` map with real `channel.consume()` registration, and specifically build the `iam.user.deactivated` → S206 auto-revoke cross-service consumer MODULE_STATE calls out as a named carry-forward item — none of this exists today in any form.
- **Category**: integration + functional work (the consumer side doesn't exist at all).
- **Belongs inside FINAL-R0?** Yes for the specific `iam.user.deactivated` → auto-revoke fan-out (a named AC in the org-foundation packet); broader broker hardening across all event types could reasonably be scoped to an integration-gate follow-up rather than blocking FINAL-R0, but that is a Product Owner scoping call, not something the repository evidence can decide for you.

## 4. Tenant-isolation hardening (RLS)

- **Evidence found**: see `TENANT_ISOLATION_VERIFICATION.md` — zero RLS policies exist anywhere, despite ADR-001 describing RLS as already delivered.
- **Category**: this is squarely production-hardening work that was never actually started, misrepresented in the ADR as done.
- **Belongs inside FINAL-R0?** At minimum, the ADR itself needs correcting (its claim of a delivered "reference implementation" is false) before any further planning proceeds on top of it. Whether RLS itself must land before FINAL-R0 executes is a PO risk-acceptance call — but continuing to assert it's done, without correcting the ADR, is not acceptable regardless of that call.

## 5. Integration tests

- **Evidence found**: `TEST_EXECUTION_REPORT.md` — the entire unit-test suite (442 tests across 3 services) runs in under 1.5 seconds combined, which is only possible against mocked Prisma clients, not a live Postgres instance. No test file was found that requires a real database connection or exercises the SERIALIZABLE-retry concurrency path against actual Postgres (the "20 concurrent HTTP allocations" claim for S213 is an unverified `completionEvidence.runtime` narrative string, not a reproducible test).
- **Category**: none of this exists yet — it would need to be authored from scratch, not merely "re-run."
- **Belongs inside FINAL-R0?** Yes — several BR rules (SERIALIZABLE retry, atomic sequence allocation, DR=CR DB trigger) are specifically claimed to depend on real Postgres behavior that a mocked-Prisma unit test cannot exercise.

## 6. Browser E2E

- **Evidence found**: 5 Playwright specs exist, covering only the 4 tenant-service org-foundation stories (S200/S201/S203/S204) plus a generic `qa-review.spec.ts`. Zero E2E coverage exists for S205, S206, S207 (auth-service) or any of the 15 coa-service stories (S223, S208-S213, S010, S013, S214-S219) — i.e., the entire Journal Lifecycle vertical, which is the product's core value proposition, has no browser-level test at all. No CI workflow was found wiring Playwright as a required check.
- **Category**: functional test-coverage work, net-new for 18 of 22 stories.
- **Belongs inside FINAL-R0?** Yes — this is precisely what GOLDEN-R0's CI requirement calls for (see `FINAL_R0_SCOPE_VERIFICATION.md`).

## 7. REM-S200-E2E-LOCATORS

- **Evidence found**: this exact string does not appear anywhere in the repository. **EVIDENCE_NOT_AVAILABLE.**

## 8. DONE_PENDING_INTEGRATION closure gate

- **Evidence found**: MODULE_STATE.json's own `onStoryComplete` execution rule requires, for every story close: "Run all required tests... Write completion evidence... Regenerate CURRENT_RELEASE.md summary from this file." `CURRENT_RELEASE.md` was **not** regenerated after any of the 7 R0-JOURNAL-LIFECYCLE stories closed (S013/S214-S219) — it still describes the prior R0-ACCOUNTING-SETUP package as active and explicitly states journal posting is "out of scope." This means the repository's own defined process for closing a story was not followed for at least the last 7 of 22 stories claimed complete.
- **Category**: process/governance gap, not purely a code gap — but it directly undermines confidence in whether the other steps in that same closure checklist (test runs, evidence write-up) were actually followed either.
- **Belongs inside FINAL-R0?** Yes, as a blocking documentation-hygiene fix — `CURRENT_RELEASE.md` must be regenerated before any further automated story execution, per the repo's own stated rules.
