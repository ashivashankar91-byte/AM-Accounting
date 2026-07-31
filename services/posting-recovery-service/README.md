# posting-recovery-service — S021 Posting Recovery (first slice)

A tenant-scoped, **read-only** dead-letter-queue (DLQ) inspection workbench for
accounting-posting events that failed before reaching the general ledger.
This is the first full-stack slice for AMACC-CH02 (S021). It does not post to
GL, does not replay events, and does not implement the posting evaluator
(CH01 / S019-S020) — see "CH01 adapter dependency" below.

## Scope of this slice

**In scope:** idempotent dead-letter intake, a stable failure taxonomy, case
lifecycle validation, tenant-scoped queue/case/attempt/correction/lineage/
audit read queries, payload masking, permission-gated payload access, audit
emission, RLS, and a usable frontend workbench.

**Explicitly out of scope (deferred):**
- Real replay execution (posting to GL). `domain/ch01-adapter.ts`'s
  `CH01PostingExecutionPort` is the seam a future slice implements against.
- The posting evaluator itself (S019/S020) — never reimplemented here.
- AP/AR/Cash accounting mappings — none appear anywhere in this slice; all
  fixture payloads are symbolic (`dealNumber`, `amount`, ...), not real
  chart-of-accounts mappings.
- Correction-authoring workflow — `posting_correction_revision` is a read
  model only; rows exist via fixtures.
- Final replay-attempt limits, correction-approval rules, and final
  accounting mappings — explicitly deferred product decisions, not blockers.

## Architecture

Follows the same per-service Fastify + Prisma + tsyringe pattern as
`services/gl-service` and `services/tenant-service`:
`src/{domain,application,http,infrastructure}`, own Prisma schema/migrations,
own audit outbox, own permission keys enforced via the shared S207 authz
engine (`@amacc/shared-kernel`'s `createAuthzGuard`).

## Route inventory

All routes are under `/posting-recovery/v1` (proxied directly in
`apps/web/vite.config.ts` — this service is not yet wired into api-gateway).

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/dead-letters` | `posting-recovery.queue.read` | paginated, filterable, sortable queue |
| GET | `/dead-letters/summary` | `posting-recovery.queue.read` | counts by status / failure category |
| GET | `/dead-letters/:id` | `posting-recovery.case.read` | case detail; payload shaped by `payload.read`/`payload.read-sensitive` |
| GET | `/dead-letters/:id/attempts` | `posting-recovery.case.read` | append-only replay-attempt history |
| GET | `/dead-letters/:id/corrections` | `posting-recovery.case.read` | append-only correction-revision history |
| GET | `/dead-letters/:id/lineage` | `posting-recovery.case.read` | source-to-failure lineage + transitions |
| GET | `/dead-letters/:id/audit-timeline` | `posting-recovery.audit.read` | recovery audit timeline |
| POST | `/_fixtures/dead-letters` | none (env-gated) | test/demo intake — see below |
| POST | `/_fixtures/dead-letters/:id/attempts` | none (env-gated) | append a replay-attempt fixture |
| POST | `/_fixtures/dead-letters/:id/corrections` | none (env-gated) | append a correction fixture |
| POST | `/_fixtures/dead-letters/:id/transition` | none (env-gated) | lifecycle-transition fixture |

`/_fixtures/*` routes are only registered when
`POSTING_RECOVERY_FIXTURES_ENABLED=true` — never on by default. All routes
require `x-tenant-id` (400 if missing) and a valid `Authorization: Bearer`
JWT (401 if missing/invalid).

## Permissions

Added via `services/auth-service/prisma/migrations/20260729030000_extend_authz_catalog_s021_posting_recovery`:

- `posting-recovery.queue.read` — list/search/filter the queue (ADMIN, CONTROLLER, ACCOUNTANT)
- `posting-recovery.case.read` — open one case (ADMIN, CONTROLLER, ACCOUNTANT)
- `posting-recovery.payload.read` — view the masked payload (ADMIN, CONTROLLER, ACCOUNTANT)
- `posting-recovery.payload.read-sensitive` — view unmasked sensitive fields (ADMIN, CONTROLLER only)
- `posting-recovery.audit.read` — view the audit timeline (ADMIN, CONTROLLER, ACCOUNTANT)

## Failure taxonomy

`domain/taxonomy.ts` — 13 stable categories (`EVENT_CONTRACT_INVALID`,
`RULE_NOT_FOUND`, `RULE_CONFIGURATION_INVALID`,
`ACCOUNTING_MAPPING_UNRESOLVED`, `REFERENCE_DATA_MISSING`,
`ACCOUNTING_PERIOD_BLOCKED`, `SOURCE_STATE_CONFLICT`,
`IDEMPOTENCY_CONFLICT`, `AUTHORIZATION_FAILURE`, `DOWNSTREAM_TRANSIENT`,
`DOWNSTREAM_PERMANENT`, `INFRASTRUCTURE_FAILURE`, `UNKNOWN_FAILURE`), plus a
separate free-form `failureCode` for specificity. No automatic replay policy
is attached to any category in this slice.

## Lifecycle statuses

`domain/lifecycle.ts` — `QUARANTINED → UNDER_REVIEW → (AWAITING_CORRECTION |
READY_FOR_REPLAY) → REPLAY_IN_PROGRESS → RESOLVED`, with `ESCALATED` reachable
from most non-terminal states and `DISPOSITIONED` as an alternate terminal.
`RESOLVED`/`DISPOSITIONED` are terminal — `assertValidTransition` rejects any
transition out of them. Replay-attempt statuses:
`REQUESTED/AUTHORIZED/STARTED/SUCCEEDED/FAILED/NOOP_ALREADY_POSTED/REJECTED/TIMED_OUT`.

## Tenant isolation / RLS

Every tenant-owned table (`posting_dead_letter` and its five children) has
`ENABLE`+`FORCE ROW LEVEL SECURITY` with the shared 4-policy
(SELECT/INSERT/UPDATE/DELETE) pattern keyed on
`current_setting('app.current_tenant_id')`, granted to `amacc_rls_bypass`.
`posting_recovery_audit_reference` (this service's audit outbox) is
deliberately RLS-excluded (background drainer runs outside tenant context),
matching gl-service/tenant-service precedent.

Immutability (migration `20260729010002_add_immutability_posting_recovery_svc`):
- `posting_dead_letter`: a BEFORE UPDATE/DELETE trigger blocks changes to
  `source_event_id`, `correlation_id`, `causation_id`,
  `original_event_timestamp`, `posting_idempotency_key`, `payload`,
  `payload_hash`, `tenant_id`, `first_failure_at`, and blocks all deletes.
  Mutable fields (`status`, `assigned_owner`, `escalation_state`,
  `attempt_count`, `latest_failure_*`, `journal_reference`, `version`,
  `updated_at`) remain updatable.
- `posting_dead_letter_failure`, `posting_replay_attempt`,
  `posting_correction_revision`, `posting_case_transition`,
  `posting_case_assignment`: append-only — a BEFORE UPDATE/DELETE trigger
  raises on every attempted modification.

Proven against a real, non-superuser `amacc_app` Postgres role (not just
mocks) by `tests/live-db/rls-isolation.ts` — 16 assertions covering
cross-tenant read/write/insert denial, deny-by-default on missing tenant
context, immutability, append-only enforcement, and the `amacc_rls_bypass`
explicit-bypass-only guarantee.

## Payload masking

`domain/masking.ts` — field-name pattern match (ssn, tax_id, account_number,
routing_number, card_number, cvv, password, secret, api_key, token,
bank_account, dob, ...) masks matched values to `***<last 4 chars>`.
`containsSensitiveData` is computed at intake and stored for queue-level
signaling. The case-detail route shapes the response by permission:
- no `payload.read` → `payload: null, payloadRedacted: true`
- `payload.read` only → masked payload + masked `postingIdempotencyKey`
- `payload.read` + `payload.read-sensitive` → unmasked payload and identity

## Audit events

Emitted to this service's audit outbox (`posting_recovery_audit_reference`,
drained by the shared `AuditOutboxDrainer` to audit-service exactly like
every other service's `audit_outbox`):
- `posting_recovery.dead_letter_created` — on intake
- `posting_recovery.queue_viewed` — on `GET /dead-letters`
- `posting_recovery.case_viewed` — on case/attempts/corrections/lineage views
- `posting_recovery.payload_viewed` — whenever the payload is included in a response
- `posting_recovery.sensitive_payload_viewed` — whenever it's included unmasked

Every row carries tenantId, deadLetterId (nullable for queue-level events),
actor, before/after (route/params/query/statusCode — never unmasked
sensitive payload values), and timestamp.

## CH01 adapter dependency

As of this slice, CH01 (S019/S020, the posting evaluator) has **not** landed
as merged code — only uncommitted, untracked domain scratch work exists in
the sibling `r1-s019-s020-posting-engine` worktree (verified read-only, not
modified). `domain/ch01-adapter.ts` is the explicit seam this service depends
on instead of importing anything from CH01: `SourceEventEnvelope` /
`PostingFailureEnvelope` are shaped from this story's non-negotiable rules
(preserve event id/timestamp/correlation id/idempotency identity/payload+
hash), not from CH01's unstable in-flight types. `CH01PostingExecutionPort`
is never called by any route in this slice — it exists only as the future
replay-command seam. Reconcile field names here, not call sites, once CH01
lands.

## Test-only fixture mechanism

`tests/fixtures/sample-envelopes.ts` — 5 deterministic, symbolic fixtures (no
real accounting mappings): one `EVENT_CONTRACT_INVALID`, one
`RULE_NOT_FOUND`, one `DOWNSTREAM_TRANSIENT`, one with a subsequent failed
replay attempt (`ACCOUNTING_MAPPING_UNRESOLVED`), and one under a second
tenant for RLS isolation proof. `tests/fixtures/load-fixtures.ts` loads them
via the `/_fixtures/*` routes (see "Route inventory").

## Running focused tests

```bash
# Backend unit + API tests (mocked Prisma, fake AuthzClient)
cd services/posting-recovery-service && npm test

# Live-database RLS/immutability/append-only proof (ephemeral Postgres,
# non-superuser amacc_app role — never the shared amacc dev database)
services/posting-recovery-service/tests/live-db/setup.sh
PG_SUPERUSER_URL=postgresql://amacc_test@localhost:55440/amacc_posting_recovery_test \
PG_APP_URL=postgresql://amacc_app@localhost:55440/amacc_posting_recovery_test \
PG_ADMIN_URL=postgresql://amacc_admin@localhost:55440/amacc_posting_recovery_test \
npx tsx services/posting-recovery-service/tests/live-db/rls-isolation.ts
services/posting-recovery-service/tests/live-db/teardown.sh

# Frontend component tests
cd apps/web && npm test
```

## Running the browser journey

```bash
# 1. auth-service + posting-recovery-service running against the same
#    Postgres, with auth-service's S021 catalog migration and this
#    service's own migrations applied.
# 2. posting-recovery-service started with POSTING_RECOVERY_FIXTURES_ENABLED=true;
#    run services/posting-recovery-service/tests/fixtures/load-fixtures.ts once.
# 3. Two real auth-service users in the same tenant: one with an
#    ACCOUNTANT-equivalent role grant, one with no posting-recovery permission.
# 4. apps/web dev server running (API_TARGET / POSTING_RECOVERY_API_TARGET
#    pointed at your auth-service / posting-recovery-service ports).

BASE_URL=http://localhost:5174 \
PR_TENANT_ID=<your tenant uuid> \
PR_ACCOUNTANT_EMAIL=<...> PR_ACCOUNTANT_PASSWORD=<...> \
PR_NO_PERMISSION_EMAIL=<...> PR_NO_PERMISSION_PASSWORD=<...> \
npx playwright test tests/e2e/posting-recovery.spec.ts
```

See `tests/e2e/posting-recovery.spec.ts`'s header comment for the full
prerequisite list and rationale (this repo's existing E2E convention already
assumes a pre-seeded, already-running backend stack — see
`tests/e2e/golden-path.spec.ts`'s header — rather than something a spec
bootstraps itself).
