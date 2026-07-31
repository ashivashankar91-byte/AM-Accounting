# S023 — Approval Table

**Nothing in this table is accepted until a row is signed by its named decision owner.** This extends the workshop pack's own approval-table template with a "Repository reality check" column (one-line pointer to `S023_REPOSITORY_EVIDENCE.md`) so decision owners see the technical grounding at the point of signature. All decision/approval columns are intentionally blank — they are for the workshop, not for this preparation pass.

**Post-approval artifacts** (`S023_ACCEPTED_STORY_CONTRACT.md`, `S023_ACCEPTANCE_CRITERIA.md`, `S023_ACCOUNTING_RULE_MATRIX.md`, `S023_EVENT_CONTRACT.md`, `S023_PERMISSION_MATRIX.md`, `S023_DECISION_REGISTER.md`) are produced only after every row below is signed.

| Decision ID | Decision | Repository reality check | Approved option | Approved by | Approval date | Affected stories | Implementation notes |
|---|---|---|---|---|---|---|---|
| D-S023-01 | Business objective | Canonical CE-07 stub already states "zero direct GL writes from operational services" as exit criterion | | | | S023 | |
| D-S023-02 | AP transactions | S039/S043A built but emit no engine-consumable event | | | | S023, S039, S043A | |
| D-S023-03 | AR transactions | S052 event unconsumed/no GL call; S048 doesn't exist | | | | S023, S046, S048, S052 | |
| D-S023-04 | Cash transactions | Greenfield — no existing cash-posting rules anywhere to migrate | | | | S023, S052, S053 | |
| D-S023-05 | Banking in/out | S054A/B confirmed absent from repo entirely | | | | S023, S054A/B, S055 | |
| D-S023-06 | Source events + required fields | 3 incompatible event shapes exist; none envelope-compatible | | | | S023, S039, S043A, S052 | |
| D-S023-07 | Rule-pack selection criteria | Selection is tenantId+eventType only; store fixed-per-line, not event-driven | | | | S023 | |
| D-S023-08 | Rule precedence | **Conflicts with D-22** — cross-pack ambiguity silently tie-broken today, not rejected | | | | S023 | Resolve jointly with D-22 |
| D-S023-09 | Versioning & effective dates | Matches built behavior exactly; cross-packKey overlap gap noted | | | | S023 | |
| D-S023-10 | Tenant/entity/store/department overrides | No override hierarchy exists — new modeling required | | | | S023 | |
| D-S023-11 | Journal-source selection | S212 registry real but not auto-seeded; AP bypasses it via literal `'AP'` string today | | | | S023, S212 | |
| D-S023-12 | Debit/credit mapping ownership | Engine mechanics solid; zero DR/CR content exists anywhere | | | | S023 | Core SME deliverable |
| D-S023-13 | Posting-date determination | Matches built behavior (`envelope.businessDate`) exactly | | | | S023 | |
| D-S023-14 | Accounting-period validation | Matches built behavior (S013/BR013-2 gate) exactly | | | | S023 | |
| D-S023-15 | Closed-period behavior | DSL has no `isAdjusting` field — soft-close path structurally unreachable today | | | | S023 | |
| D-S023-16 | Schedule/subledger impacts | Existing linkage (gl-service→schedule-service) bypasses posting engine entirely | | | | S023, S026 | |
| D-S023-17 | Control-number/source-reference requirements | UQ-18 already resolved (interim) — reuse, don't re-litigate | | | | S023 | |
| D-S023-18 | Tax & fee treatment boundary | CE-10 not investigated this pass — needs technical confirmation first | | | | S023, CE-10 | |
| D-S023-19 | Rounding behavior | Remainder-absorption already prevents imbalance — different mechanism than proposed | | | | S023 | |
| D-S023-20 | Missing/invalid account behavior | Matches built behavior (reject, no suspense) exactly | | | | S023 | |
| D-S023-21 | Rule-validation failure taxonomy | Only 2 of 5+ failure kinds get a structured code today — real gap | | | | S023 | |
| D-S023-22 | Relationship with S019/S020 | True in isolation; **contradicted if D-08 or D-25 approved as drafted** | | | | S023, S019, S020 | Resolve jointly with D-08, D-25 |
| D-S023-23 | Relationship with S021 DLQ/replay | S021 not merged into r1-integration — no real DLQ exists today | | | | S023, S021 | Sequencing decision needed |
| D-S023-24 | Duplicate-event/idempotency | Matches built behavior exactly, fully built | | | | S023 | |
| D-S023-25 | Replay after configuration change | **Conflicts with actual S021 contract** — CH01 passthrough returns original result, never re-evaluates | | | | S023, S021 | Resolve jointly with D-22 |
| D-S023-26 | Replay into a different period | No existing behavior; also blocked pending S021 integration | | | | S023, S021 | |
| D-S023-27 | Correction/reversal/void behavior | S218 reversal fully built and reusable; replay half blocked by D-23/D-25 | | | | S023, S218 | |
| D-S023-28 | Approval & SoD | **Pack's "consistent with S041" claim is factually inaccurate** — S041 has no identity-based check either | | | | S023 | SECURITY_DECISION_REQUIRED |
| D-S023-29 | Permissions | 6 `posting_engine.*` permissions already exist under a different naming convention than drafted | | | | S023 | SECURITY_DECISION_REQUIRED |
| D-S023-30 | Audit & evidence | `before` always null today in posting-engine audit(); reusable pattern exists elsewhere | | | | S023 | SECURITY_DECISION_REQUIRED |
| D-S023-31 | UI | Raw-JSON draft editor + activation ceremony already built; no friendly mapping editor | | | | S023 | |
| D-S023-32 | Backend | Matches existing responsibility split exactly | | | | S023 | |
| D-S023-33 | API (incl. simulate) | CRUD/activate exist; simulate does not — new engine-adjacent work | | | | S023 | |
| D-S023-34 | Database/config model | Matches existing schema closely; additive columns possible per D-15/D-21 | | | | S023 | |
| D-S023-35 | Events consumed and emitted | No pack-lifecycle domain-event stream exists today | | | | S023 | |
| D-S023-36 | Inquiry/monitoring/reporting | 1 of 4 proposed surfaces already exists; rest missing or blocked | | | | S023 | |
| D-S023-37 | Acceptance criteria | AC items (2), (4) depend on how D-08/D-25/D-23 resolve; zero golden JEs authored | | | | S023 | Finalize last |
| D-S023-38 | Explicit exclusions | Mostly matches reality; "engine unchanged" clause in tension with D-08/D-25 | | | | S023 | |

## Sign-off gate

This table is complete, and the post-approval artifacts may be produced, only when:
1. Every row above has an `Approved option`, `Approved by`, and `Approval date`.
2. D-S023-08, D-S023-22, and D-S023-25 have been resolved **jointly** (not independently) given their documented conflict.
3. D-S023-23's sequencing decision (does S023 wait on S021 integration, proceed with a documented gap, or use an interim path) is recorded, since it gates D-S023-15, 21, 25, 26, 27, and 37.
4. D-S023-28 has been decided with the corrected understanding that no existing precedent (S041 or otherwise) implements identity-based SoD.

## Workshop readiness status

**S023_READY_FOR_DEFINITION_WORKSHOP** — consistent with the workshop pack's own final status. The pack is schedulable now; this preparation pass does not change that. It does mean the workshop should expect five items (D-06, D-08, D-22, D-23, D-25, D-28) to take materially longer than a single-pass PROPOSED/accept vote, because each has a documented conflict with current repository reality that must be resolved before a defensible sign-off.
