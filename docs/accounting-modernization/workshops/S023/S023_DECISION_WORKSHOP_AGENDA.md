# S023 — Decision Workshop Agenda

Based on the workshop pack's suggested three-sitting structure, adjusted for what repository validation actually found. Full evidence: `S023_REPOSITORY_EVIDENCE.md`. Feasibility summary: `S023_TECHNICAL_FEASIBILITY_MATRIX.md`. Sign-off mechanism: `S023_APPROVAL_TABLE.md`.

**Before scheduling, read the "Read this first" and "Major conflicts" sections of `S023_REPOSITORY_EVIDENCE.md`.** Five decisions (D-06, D-08, D-22, D-23, D-25, D-28) are not simple policy choices — approving them as drafted, without acknowledging what repository validation found, risks the workshop signing off on criteria the current engine cannot meet. Suggest surfacing these five at the *start* of Sitting 1, not waiting for them to arrive in sequence, so attendees calibrate expectations for the rest of the day.

**Suggested attendees (unchanged from the pack):** Product (Shiva), Accounting SMEs (Sreeni's list), engineering lead for the posting engine, security reviewer for SoD items. **Add for this revised agenda:** whoever owns S039/S043A/S052 (apar-service/cash-service), since D-02/03/04/06 now require their input on producer-side event work, not just accounting content.

---

## Pre-read (send before Sitting 1)

- This agenda + the five "major conflicts."
- `S023_CURRENT_EVENT_PAYLOADS.md` — so SMEs walk in knowing S039/S043A/S052 don't emit engine-consumable events today; this reframes Section A/B from "select among existing flows" to "define new pipelines."
- The canonical CE-07 exit criterion ("zero direct GL writes from operational services") — sets the actual bar S023 is measured against, more concrete than the pack's draft objective.

---

## Sitting 1 — Scope & Events (D-01…10, 35, 38)

**Opening (15 min):** repository-reality briefing — AP/AR/Cash today post via direct gl-service HTTP calls (S039/S043A) or don't post at all (S052); none emit an engine-consumable event. Confirm this doesn't change *what* S023 should cover, but does change *how much new producer-side work* is implied by D-02/03/04/06.

- **D-01** Business objective — ratify with the canonical registry's exit criterion folded in explicitly.
- **D-05, D-38** Exclusions — mechanical, low-risk, confirm quickly (S054A/B confirmed absent; note the "engine unchanged" clause needs a caveat pending Sitting 2's D-08/D-22 discussion).
- **D-02, D-03, D-04** AP/AR/Cash transaction scope — decide content scope as planned, but explicitly flag for each: does covering this event require new producer-side emission work (yes for all three), and who owns that work (S023, or a dependency ticket against S039/S043A/S052)?
- **D-06** Source events + fields — this is the pivotal item. Recommend treating it as two sub-decisions: (a) the accounting-sufficiency of a proposed field set (SME call), and (b) whether adding envelope-shaped emission to S039/S043A/S052 is in S023's scope or a prerequisite (Product + Engineering call). Don't let (b) get silently folded into "SME approves sufficiency."
- **D-07, D-10** Selection criteria & overrides — decide with the caveat that store is fixed-per-line today (not event-driven) and no override hierarchy exists; both are new engineering work if the "richer" option is chosen.
- **D-08** Rule precedence — **do not finalize in Sitting 1.** Table it to open Sitting 2 jointly with D-22, since it can't be decided without Engineering scoping an option.
- **D-09** Versioning — quick ratify, matches built behavior; note the cross-packKey overlap gap for awareness.
- **D-35** Emitted events — defer detailed design to Engineering; confirm in-principle that a new emitted-event set is acceptable scope.

---

## Sitting 2 — Posting Semantics & Failure (D-11…27) — every item in Section C defaults to ACCOUNTING_DECISION_REQUIRED; nothing here proceeds on a PROPOSED value without explicit SME sign-off

**Opening (10 min):** resolve the D-08/D-22 tension left from Sitting 1, jointly with Engineering. Options: (i) accept the engine's current silent-tie-break-across-packs behavior and drop "reject on true ambiguity" from D-08; (ii) approve a narrow, scoped engine change and update D-22/D-38 to reflect it as an explicit, approved exception. **Do not let this resolve by default/omission** — pick one and record it.

- **D-11** Journal-source selection — decide source codes, and separately confirm (Engineering) whether `bootstrapReserved()` needs to run automatically for this to work in production, or whether S023's rollout must trigger it.
- **D-12, D-19, D-20** Mapping ownership, rounding, missing-account — D-12 is the core SME deliverable (golden DR/CR matrix); D-19 needs SMEs to confirm remainder-absorption rounding is acceptable (it's a different mechanism than the pack assumed, not clearly worse, but should be an informed choice); D-20 is a quick ratify (matches built behavior exactly).
- **D-13, D-14** Posting date, period gate — quick ratify, both already match.
- **D-15** Closed-period behavior — decide policy, but flag the DSL gap: rule-pack postings cannot use the soft-close/adjusting exception today regardless of what's decided here, unless Engineering adds an `isAdjusting` field to the DSL. If SMEs pick "always reject," this gap is moot; if they want any soft-close path, it's new engineering work that must be scoped before D-15 can actually be implemented as decided.
- **D-16, D-17** Schedule/subledger — note UQ-18 is already resolved (the pack overstates it as still gating); D-17 should be a quick ratify reusing the existing `schedule_key`/`controlNumber`/`applyNumber` fields. D-16 needs a real integration-path decision (route through the existing gl-service→schedule-service path, or build a new posting-engine-native mechanism) — flag as needing Engineering scoping before final sign-off.
- **D-18** Tax boundary — likely needs a follow-up technical spike before this sitting (CE-10's actual state wasn't confirmed in repository validation); consider deferring this item until Engineering confirms what CE-10 emits.
- **D-21** Failure taxonomy — decide naming, but flag as real engineering work (schema + service change), not configuration; S021's own 13-value taxonomy (once merged) is a candidate model.
- **D-22, D-23** Engine relationship / S021 relationship — **D-23 cannot be meaningfully approved today**: S021 isn't merged into `r1-integration`. Decide sequencing (does S023 wait for S021 integration, proceed with a documented gap, or is there an interim non-DLQ failure path?) rather than approving the decision as if the dependency were satisfied.
- **D-24** Idempotency — quick ratify, fully built and exact match.
- **D-25** Replay after config change — **do not approve as drafted.** The proposed option is not achievable under S021's actual (unmerged) contract without an engine or recovery-service change. This needs the same joint SME+Engineering treatment as D-08 — table for a dedicated discussion, don't let it pass on a show of hands.
- **D-26** Replay into a different period — no existing behavior; decide policy, but note it's blocked on S021 integration and D-25's resolution before it can be built.
- **D-27** Correction/reversal — the reversal half (S218) is a quick ratify, real and complete. The replay half depends on D-23/D-25's resolution — don't sign off on the combined "reversal + corrected replay" AC language (see D-37) until those are settled.

---

## Sitting 3 — Control, Surfaces & Acceptance (D-28…37)

**Opening (10 min):** correct the record on D-28 before discussing it — S041 does **not** implement author≠activator identity separation (verified directly in `invoice-approval-service.ts`); it only enforces role-tier separation, the same gap the pack is asking S023 to close. Security should treat this as a fresh decision, not an extension of an existing mechanism.

- **D-28** Approval & SoD — Security decides role-tier-only (zero new engineering cost, matches everything built so far) vs. identity-based author≠activator enforcement (new engineering work, no precedent anywhere in the codebase to reuse).
- **D-29** Permissions — ratify reuse of the existing `posting_engine.<noun>.<verb>` namespace and its 6 existing permissions; scope any new permission strings needed for decisions made elsewhere (simulate if approved under D-33; any S023-specific DLQ interaction if approved under D-23).
- **D-30** Audit — decide requirements; note the `before:null` gap in the existing audit() helper needs an actual code fix, not just configuration, to satisfy "mapping-change diffs before/after account."
- **D-31** UI — decide whether raw-JSON draft editing (what's built today) is acceptable for v1, or whether a structured mapping editor is required (materially larger UI scope than the pack implies, since it's not starting from a blank console).
- **D-32** Backend — quick ratify, matches existing responsibility split exactly.
- **D-33** API / simulate — decide if simulate is in v1; if yes, this is new engine-adjacent work (a dry-run path stopping short of `PostingService.post()`), not a flag flip.
- **D-34** DB model — quick ratify; flag that D-15/D-21 decisions may require additive columns beyond the current schema.
- **D-36** Inquiry/monitoring — decide which of the 3 currently-missing surfaces (simulate, DLQ-slice, pack-change report) are v1-required vs. deferred; the 4th (execution/version inquiry) already exists.
- **D-37** Acceptance criteria — **finalize last**, after D-08, D-25, and D-23 are settled, since AC items (2) and (4) in the pack's skeleton directly depend on how those resolve. This sitting's other output — the actual SME-authored golden journals — is the workshop's largest genuinely unstarted deliverable; budget real time for it, not just AC wording.

---

## Explicit non-goals for this workshop (per the source task)

Do not produce `S023_ACCEPTED_STORY_CONTRACT.md`, `S023_ACCEPTANCE_CRITERIA.md`, `S023_ACCOUNTING_RULE_MATRIX.md`, `S023_EVENT_CONTRACT.md`, or `S023_PERMISSION_MATRIX.md` in or immediately after this workshop. Those are produced only once every row of `S023_APPROVAL_TABLE.md` is signed by its named decision owner.
