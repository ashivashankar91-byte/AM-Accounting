# S023 — Technical Feasibility Matrix

One row per workshop decision. `Fits PROPOSED?` reflects whether the pack's own PROPOSED option matches what is actually built today — **not** whether the option is a good idea. `Classification` is the approval routing per the task's taxonomy. Detailed evidence for every row is in `S023_REPOSITORY_EVIDENCE.md`.

| ID | Decision | Fits PROPOSED? | Classification | Key risk / conflict | Blocking dependency |
|---|---|---|---|---|---|
| D-01 | Business objective | Yes | PRODUCT_DECISION_REQUIRED | Should incorporate canonical registry's "zero direct GL writes" exit criterion explicitly | — |
| D-02 | AP transactions covered | Partial | ACCOUNTING_DECISION_REQUIRED | S039/S043A don't emit engine-consumable events yet | New event contract on S039/S043A |
| D-03 | AR transactions covered | Partial | ACCOUNTING_DECISION_REQUIRED | S052 event unconsumed/no GL call; S048 doesn't exist | New event contract on S052; S048 doesn't exist |
| D-04 | Cash transactions covered | Partial | ACCOUNTING_DECISION_REQUIRED | Greenfield, not "move hard-wired rules" — none exist | — |
| D-05 | Banking excluded | Yes | PRODUCT_DECISION_REQUIRED | None — S054A/B confirmed absent | — |
| D-06 | Source events + fields | **No** | TECHNICAL_CONFIRMATION_REQUIRED | 3 incompatible event shapes; none envelope-compatible | New producer-side event work |
| D-07 | Selection criteria | Partial | ACCOUNTING_DECISION_REQUIRED | Store is fixed-per-line, not event-driven | — |
| D-08 | Rule precedence | **No** (cross-pack case) | ACCOUNTING_DECISION_REQUIRED + ENGINEERING | Conflicts with D-22 "engine unchanged"; silent tie-break exists today | Engine change to `blueprint.ts`/`dsl.ts` |
| D-09 | Versioning & effective dates | Yes | NO_BLOCKER | Cross-packKey overlap not prevented (feeds D-08) | — |
| D-10 | Overrides | **No** | ACCOUNTING_DECISION_REQUIRED | No override hierarchy exists; new modeling | New schema/DSL work |
| D-11 | Journal-source selection | Partial | ACCOUNTING_DECISION_REQUIRED + TECHNICAL_CONFIRMATION_REQUIRED | Registry exists but not auto-seeded; AP bypasses it entirely today | `bootstrapReserved` invocation policy |
| D-12 | DR/CR mapping ownership | Yes (mechanics) / No (content) | ACCOUNTING_DECISION_REQUIRED | Zero DR/CR content exists anywhere | — |
| D-13 | Posting-date determination | Yes | NO_BLOCKER | Only one date field in envelope today | — |
| D-14 | Period validation | Yes | NO_BLOCKER | None — matches exactly | — |
| D-15 | Closed-period behavior | Partial | ACCOUNTING_DECISION_REQUIRED + TECHNICAL_CONFIRMATION_REQUIRED | No `isAdjusting` field in DSL — soft-close path unreachable for rule-pack postings | DSL change |
| D-16 | Schedule/subledger impacts | No evidence of linkage | ACCOUNTING_DECISION_REQUIRED + TECHNICAL_CONFIRMATION_REQUIRED | Existing linkage bypasses posting engine entirely | New integration path |
| D-17 | Control-number/reference requirements | Yes (precedent exists) | ACCOUNTING_DECISION_REQUIRED | UQ-18 already resolved — pack overstates this as open | — |
| D-18 | Tax & fee treatment boundary | Not assessed | TECHNICAL_CONFIRMATION_REQUIRED | CE-10 not investigated this pass; no tax-line concept in DSL | Confirm CE-10 exists/what it emits |
| D-19 | Rounding behavior | **No** | ACCOUNTING_DECISION_REQUIRED | Remainder-absorption already prevents imbalance; proposed model assumes a different mechanism | New engine work if independent rounding required |
| D-20 | Missing/invalid account behavior | Yes | NO_BLOCKER | None — matches exactly; suspense variant would be new work | — |
| D-21 | Rule-validation failure taxonomy | **No** | TECHNICAL_CONFIRMATION_REQUIRED | Only 2 of 5+ failure kinds get a structured code today | Engine + schema change |
| D-22 | Relationship with S019/S020 | Yes (in isolation) | PRODUCT_DECISION_REQUIRED | Contradicted if D-08 or D-25 approved as drafted | Resolve jointly with D-08/D-25 |
| D-23 | Relationship with S021 DLQ/replay | **No** | PRODUCT_DECISION_REQUIRED | S021 not merged into r1-integration at all | S021 integration |
| D-24 | Duplicate-event/idempotency | Yes | NO_BLOCKER | None — fully built, exact match | — |
| D-25 | Replay after configuration change | **No** | ACCOUNTING_DECISION_REQUIRED + ENGINEERING | CH01 idempotency-passthrough returns original result, never re-evaluates | Engine or recovery-service redesign |
| D-26 | Replay into a different period | No evidence | ACCOUNTING_DECISION_REQUIRED | No code exists for this at all | S021 integration first |
| D-27 | Correction/reversal/void behavior | Yes (reversal half) | NO_BLOCKER (reversal) / blocked (replay half) | S218 fully built and reusable; replay half blocked by D-23/D-25 | S021 integration for replay half |
| D-28 | Approval & SoD | **No** | SECURITY_DECISION_REQUIRED | Pack's "consistent with S041" claim is factually wrong — no identity-based check anywhere | New engineering work if identity-level SoD required |
| D-29 | Permissions | Partial | SECURITY_DECISION_REQUIRED | 6 permissions already exist under a different naming convention than drafted | — |
| D-30 | Audit & evidence | Partial | SECURITY_DECISION_REQUIRED | `before` is always null today; reusable pattern exists elsewhere | Code change to `audit()` helper |
| D-31 | UI | Partial | PRODUCT_DECISION_REQUIRED | Raw-JSON editor + activation ceremony already built; no friendly mapping editor | New UI work if structured editor required |
| D-32 | Backend | Yes | NO_BLOCKER | None — matches exactly | — |
| D-33 | API (incl. simulate) | Partial | PRODUCT_DECISION_REQUIRED | CRUD/activate exist; simulate does not | New engine-adjacent dry-run path |
| D-34 | Database/config model | Yes | NO_BLOCKER | Matches existing schema closely; additive columns may be needed per D-15/D-21 | — |
| D-35 | Events consumed/emitted | Partial | TECHNICAL_CONFIRMATION_REQUIRED | No pack-lifecycle domain-event stream exists today | New event emission work |
| D-36 | Inquiry/monitoring/reporting | Partial (1 of 4 exists) | PRODUCT_DECISION_REQUIRED | Simulate, DLQ-slice, pack-change report all missing or blocked | Depends on D-23, D-33, D-35 |
| D-37 | Acceptance criteria | Partial | ACCOUNTING_DECISION_REQUIRED | AC items 2 and 4 conflict with D-08/D-25 findings; zero golden JEs authored | Resolve D-08/D-25/D-23 first |
| D-38 | Explicit exclusions | Mostly yes | PRODUCT_DECISION_REQUIRED | "Engine unchanged" clause in tension with D-08/D-25 | — |

## Classification totals

| Classification | Count | Decision IDs |
|---|---|---|
| NO_BLOCKER | 8 | D-09, D-13, D-14, D-20, D-24, D-27 (reversal half), D-32, D-34 |
| PRODUCT_DECISION_REQUIRED | 9 | D-01, D-05, D-22, D-23, D-31, D-33, D-36, D-38, (D-16 also Product-adjacent) |
| ACCOUNTING_DECISION_REQUIRED | 15 | D-02, D-03, D-04, D-07, D-08, D-10, D-11, D-12, D-15, D-16, D-17, D-19, D-25, D-26, D-37 |
| SECURITY_DECISION_REQUIRED | 3 | D-28, D-29, D-30 |
| TECHNICAL_CONFIRMATION_REQUIRED | 8 (overlapping with above) | D-06, D-11, D-15, D-16, D-18, D-21, D-25, D-35 |

(Several decisions carry two classifications simultaneously — e.g. D-08 and D-25 are both accounting-policy questions *and* require engineering scoping before SMEs can meaningfully choose an option. These are not double-counted as separate rows above; the table lists every classification that applies.)

## The five decisions that most threaten workshop timeline if not raised explicitly beforehand

1. **D-08 / D-22 conflict** — cannot both be approved as drafted.
2. **D-25 / S021-passthrough conflict** — the proposed replay policy is not implementable under the current (even once merged) engine contract without a redesign.
3. **D-23** — the entire Failure & Recovery section assumes a DLQ that does not exist on `r1-integration`.
4. **D-06** — AP/AR/Cash do not currently emit engine-consumable events; this is materially more scope than "extract the field set."
5. **D-28** — the cited precedent (S041) does not do what the pack says it does; Security is being asked to approve based on an inaccurate premise.
