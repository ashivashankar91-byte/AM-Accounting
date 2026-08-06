# P01-S003 — Elimination Entity Configuration: Product / Accounting SME Demonstration Script

Status: TECHNICALLY_CERTIFIED_PENDING_PRODUCT_SME_ACCEPTANCE
Branch: `r1-s003-elimination-configuration` (do not merge)
Purpose: walk Product Owner + Accounting SME through the S003 slice for acceptance sign-off. Nothing below adds new functionality; this reuses the already-certified build exactly as committed at `b55ff49`.

## Scope reminder (read aloud before starting)

**In scope (this demo):** elimination-entity attributes/configuration, mandatory reason, authorization, tenant/entity isolation, audit trail, UI states, guard behavior (version conflict, OWNS_STORES).
**Explicitly out of scope (do not demo, do not imply exists):** automated elimination journals, entity-pairing workflow, consolidation calculations, intercompany balancing, period-close/reporting integration.

## Environment setup

S003 has no fixture users in the shared/persistent dev stack yet — the certification round used a disposable, ephemeral Postgres + services stack that was torn down after evidence capture. Before the live demo, either:
1. Re-run the certification setup procedure (fresh `initdb` cluster → `prisma migrate deploy` for tenant-service and auth-service → seed the fixture tenant/users below → start auth-service, tenant-service, api-gateway, apps/web), or
2. Seed the same fixture identifiers into whatever target stack (e.g., shared docker-compose `amacc` stack) the demo will run against.

### Fixture identifiers (match the committed Playwright spec exactly — no spec edits needed)

| Field | Value |
|---|---|
| Tenant id | `1cf31f14-cb0b-4261-a41d-f79953594c86` |
| Authorized user (ADMIN) | `admin@kunes-final-r0.test` |
| Unauthorized user (CLERK) | `clerk@kunes-final-r0.test` |
| Password (both) | `FinalR0-Evidence-2026!` |

### UI route

- Elimination configuration screen: **`/golden-path/entity-elimination`**
- Org hierarchy (badge view): **`/golden-path/org-hierarchy`**

### Reference test file (source of truth for the flows below)

`tests/e2e/elimination-entity.spec.ts` — every step in this script mirrors one of its 5 certified scenarios.

## Demonstration flow

1. **Entity list / hierarchy** — Log in as `admin@kunes-final-r0.test`. Open `/golden-path/org-hierarchy`. Show the legal-entity tree for the tenant. Then open `/golden-path/entity-elimination` and show the entity picker/list (loading state, then populated state).

2. **Elimination designation control** — Select a non-eliminated entity that does **not** currently own any stores. Show the "Flag as elimination entity" control.

3. **Mandatory reason (validation state)** — Attempt to confirm the flag **without** entering a reason. Show the inline validation error and the `422 REASON_REQUIRED` behavior — call out explicitly that this is required for **every** change, regardless of whether the entity has posted journal activity (the corrected rule from the last checkpoint).

4. **Successful authorized update** — Enter a reason, confirm. Show `200` success, the entity row updating in place, and the version incrementing.

5. **Elimination badge** — Navigate to `/golden-path/org-hierarchy` and show the "Elimination" badge now rendered on that entity in the tree.

6. **Audit-history result** — Show the audit trail for the entity (via the entity's audit view, or by referencing the persisted `audit_outbox` evidence in `P01_S003_CERTIFICATION_EVIDENCE.md` §5 if no audit-history UI panel is wired for this entity type yet) — confirm the `ELIMINATION_CHANGED` event, the reason text, and the actor (`admin@kunes-final-r0.test`) are all present.

7. **Unauthorized behavior** — Log out, log in as `clerk@kunes-final-r0.test`. Attempt the same flag action. Show `403` and the unauthorized-state UI (button disabled/hidden or explicit "not authorized" message — per implementation in `EntityElimination.tsx`).

8. **Version-conflict behavior** — Log back in as `admin@kunes-final-r0.test`. Open the same entity in two tabs (or replay a stale PATCH), submit an update from the stale tab/request. Show `409 VERSION_CONFLICT` and the resulting error state.

9. **OWNS_STORES guard** — Attempt to flag an entity that **does** currently own an active store. Show the `409` rejection and the message identifying the owned store(s). Then demonstrate the reverse direction: attempt to create/assign a new store under an entity that is **already** flagged as an elimination entity, and show that this is also rejected.

10. **Close** — Restate exclusions: no elimination journals were generated, no consolidation math ran, no intercompany balancing occurred, and no posting restrictions were enforced by this feature — those remain explicitly out of scope for S003 v1.

## Evidence reference

Full certification evidence (migrations, service tests, gateway proofs, audit query results, Playwright run) is indexed in `docs/accounting-modernization/build-packs/P01/P01_S003_CERTIFICATION_EVIDENCE.md`. A screenshot of the configured entity + badge + audit result should be captured live during step 4–6 of this session and attached to the sign-off record (see note in that document, §8).

## Product / Accounting SME acceptance questions

Please confirm or raise concerns on each of the following before S003 is promoted past `TECHNICALLY_CERTIFIED_PENDING_PRODUCT_SME_ACCEPTANCE`:

1. Is the **flag-only** scope (no entity-pairing metadata, no consolidation math, no automated journals) acceptable for this release, with pairing/consolidation explicitly deferred?
2. Is a **reason required for every single change** to the elimination designation — not only when the entity has posted journal activity — the correct permanent rule, or was this intended only as a stricter interim policy?
3. Is a **distinct `acct.entity.elimination_configure` permission**, granted only to ADMIN and CONTROLLER, the right governance model, versus folding this into a broader `acct.entity.manage` permission?
4. Is it acceptable that **posting-restriction configuration/enforcement** for elimination entities is **not** part of this release (deferred to a later story, per `BLK-18`)?
5. Is the **no-op guard** (re-flagging the same value returns `422 NO_CHANGE` rather than silently succeeding) the desired UX?
6. Is the **"Elimination" badge** label/placement on the org hierarchy tree the correct visual treatment, or does Product want a different label/icon before this ships more broadly?
7. Is the **OWNS_STORES guard direction** — an elimination entity can never own an active store, in either direction (cannot flag an entity that owns stores; cannot assign a store to an already-flagged entity) — a complete statement of the business rule, or are there exceptions (e.g., inactive/closed stores)?
8. Is the **version-conflict (409)** behavior and messaging acceptable as the concurrency-safety UX, or is a friendlier retry/refresh flow expected before general release?

## Sign-off

Record the outcome of this session (accepted / accepted-with-changes / rejected, plus any follow-up items) in `docs/accounting-modernization/MODULE_STATE.json` under `stories.S003.remainingCertificationItems` and in `STORY_CERTIFICATION_MATRIX.csv`, updating status only after explicit Product Owner + Accounting SME sign-off is recorded.
