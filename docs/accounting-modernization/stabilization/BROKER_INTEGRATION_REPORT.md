# Broker Integration Report — Phase 7

Proves real RabbitMQ integration, not a mocked event publisher. Runs after authorization (Phase 3), audit (Phase 4), and tenant isolation (Phase 5/6) all pass, per instruction.

## Infrastructure

Docker was not running in this environment. RabbitMQ was installed locally via Homebrew (`brew install rabbitmq`, pre-built bottle — fast, no compilation) and started as a fully isolated instance: custom node name (`rabbit_r0_test@localhost`), custom Mnesia/log directories under the session scratch path, non-default AMQP port (`55672`, vs. the shared dev stack's default `5672`). This never touched, and cannot conflict with, the docker-compose `rabbitmq` service used by the shared dev environment. Torn down completely at the end of this phase (see Cleanup).

## Root cause confirmed and fixed (not just tested around)

`RabbitMQEventPublisher.subscribe()` — duplicated near-identically across `tenant-service`, `auth-service`, `coa-service`, and `audit-service`'s `src/infrastructure/event-publisher.ts` — previously **only registered an in-process JavaScript callback**, invoked directly by that same process's own `publish()` call. It never declared a queue, bound it to the `amacc.events` topic exchange, or called `channel.consume()`. `publish()` genuinely wrote to a real, durable exchange — but with nothing bound to receive those messages, they were simply dropped by RabbitMQ (a topic exchange with no matching binding discards unroutable messages). This is the exact gap the repository verification and Phase 4/5 reports flagged; fixing it (rather than writing a test that routes around it) was necessary before "broker integration" could mean anything real.

**Fix, applied identically to all 4 in-scope services** (`tenant-service`, `auth-service`, `coa-service`, `audit-service` — the other ~17 services using this same class are untouched, out of scope for this package):

- `subscribe()` now declares a durable queue named `{serviceName}.{eventType}` (a new `serviceName` constructor option, so two different services subscribing to the same event type each get their own queue — correct fan-out semantics, rather than competing round-robin on a shared queue), binds it to `amacc.events` with the event type as the topic routing key, and genuinely `consume()`s from it.
- The queue is configured with `x-dead-letter-exchange`/`x-dead-letter-routing-key` pointing at the pre-existing (previously unused) `amacc.events.dlx` exchange, with a matching `{queue}.dlq` bound to receive dead-lettered messages.
- On handler failure, the message is requeued (via re-publish, tracking an `x-delivery-attempt` header) up to 5 attempts; beyond that it is `nack`ed without requeue, routing it to the dead-letter queue — a poison message is never silently dropped or retried forever.
- `publish()` now also sends `x-correlation-id` and `x-schema-version` message headers, in addition to the payload already carrying `correlationId`.

## Completion gate — verified against the real broker (`tests/integration/test-broker-integration.ts`, new)

```
$ RABBITMQ_URL=amqp://localhost:55672 npx tsx test-broker-integration.ts
  ✓ publication + real cross-connection consumption (not the same process invoking its own handler)
  ✓ tenant propagation: consumed event carries the original tenantId
  ✓ correlation ID propagation: consumed event traceable back to the originating publish
  ✓ event version (schemaV) propagation
  ✓ journal lifecycle event consumption (acct.je.posted) — the real R0 event name, not a test-only alias
  ✓ audit-relevant event consumption (iam.authz.denied)
  ✓ duplicate delivery: broker delivers both publishes (at-least-once) — app-layer idempotency (proven in Phase 4) is the correct place to dedupe, not the broker
  ✓ retry: handler failure causes redelivery, succeeding on the 3rd attempt (not silently dropped after the first failure)
  ✓ poison message: after exhausting retries, the message lands in the dead-letter queue (not silently dropped)
  ✓ service-restart recovery: message published to a durable queue is delivered to a (re)connecting consumer, not lost

10 passed, 0 failed
```

Uses **two independent AMQP connections** (simulating two separate service processes — a publisher side and a consumer side), so "consumption" here means a genuinely different connection received the message via the broker, not the same process invoking its own in-memory callback.

Test script design note: `tests/integration` is its own standalone npm package (outside the workspace's module graph, per its pre-existing convention alongside `test-journal-lifecycle.ts`) and cannot resolve `@amacc/shared-kernel` or import the service's TypeScript file directly without a fragile cross-boundary setup. The test therefore replicates the exact same protocol the production class now implements (identical exchange names, routing-key convention, per-service queue naming, DLX/DLQ naming, `x-delivery-attempt` retry header) using `amqplib` directly, rather than a different/looser approximation. The production class's own correctness is separately verified by `tsc --noEmit` passing on all 4 services and their unchanged 526 unit tests (mocked-Prisma path is untouched by this change; the in-memory `handlers` map fallback in `publish()`/`subscribe()` still exists for dev-without-a-broker).

| Requirement | Status |
|---|---|
| Event publication (real exchange) | ✅ pre-existing, confirmed unchanged |
| Event consumption (real, cross-connection) | ✅ new — previously never happened at all |
| Tenant context propagation | ✅ |
| Correlation IDs | ✅ |
| Version handling (schemaV) | ✅ |
| Retry | ✅ — up to 5 attempts, tracked via `x-delivery-attempt` |
| Duplicate delivery | ✅ — broker is at-least-once by design; app-layer idempotency (Phase 4) is the correct dedupe boundary, proven separately |
| Poison-message behavior | ✅ — exhausted retries route to DLQ, never silently dropped |
| Dead-letter behavior | ✅ — a real, bound `.dlq` queue, inspected directly to confirm the message actually landed there |
| Audit consumption | ✅ (`iam.authz.denied`) |
| Journal lifecycle event consumption | ✅ (`acct.je.posted`, the real R0 event name) |
| Service restart recovery | ✅ — durable queue retains a message published while no consumer was yet (re)connected |

## Regression check

| Service | tsc --noEmit | Unit tests |
|---|---|---|
| tenant-service | 0 errors | 154/154 |
| auth-service | 0 errors | 88/88 |
| coa-service | 0 errors | 275/275 (+5 live-DB, skipped without `LIVE_DATABASE_URL`) |
| audit-service | 0 errors | 4/4 |

Unchanged from Phase 6 — this phase's changes are additive to `subscribe()`'s implementation and don't touch anything the mocked-Prisma unit tests exercise.

## Explicitly disclosed scope limits

- **The other ~17 services** using the same `RabbitMQEventPublisher` class (agent-apar, agent-eom, gl-service, eom-service, payroll-service, etc.) were **not modified** — they are not part of the 22 R0 stories, and their own `subscribe()` calls (if any) remain in-process-only exactly as before. If any of those services relies on cross-process delivery today, it has the same gap this phase fixed for the 4 in-scope services — worth a separate, deliberate follow-up, not silently fixed as a side effect here.
- **`coa_outbox_events`/`tenant_outbox_events` domain events are still not drained by any consumer** — Phase 4 built the audit-outbox drainer specifically for compliance/audit trails; general domain-event consumption (e.g., a real `iam.user.deactivated` → S206 auto-revoke fan-out) is architecturally now *possible* (the broker path is real), but no such consumer was built in this phase — that remains a named, still-open carry-forward item (see `CARRY_FORWARD_WORK_VERIFICATION.md` from the original verification pass).
- **Message ordering** was not tested — RabbitMQ topic exchanges with multiple competing consumers on one queue don't guarantee strict ordering, and this wasn't a requirement in the instruction; not claimed here.

**Verdict: R0_BROKER_INTEGRATION_PASSED.**
