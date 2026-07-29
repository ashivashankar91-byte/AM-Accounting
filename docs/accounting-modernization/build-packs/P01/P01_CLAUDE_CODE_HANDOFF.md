# P01 — CLAUDE CODE IMPLEMENTATION HANDOFF (CORRECTED)
**Target:** docs/accounting-modernization/build-packs/P01/ · **Pack-level status: PRODUCT_REVIEW_REQUIRED** with story-level readiness below. No global Golden R0 gate applies.

## Operating model — PARALLEL LANES (approved)
- **Golden R0 UI convergence** continues independently in its stabilization lane (S014/S220/S221/S222/S227/S224/JE reconciliation).
- **P01 full-stack implementation and certification** proceeds independently, now.
- **P02 design and decision resolution** runs one pack ahead.
Golden R0 *technical foundations* are dependencies only where explicitly named in a contract (S214/S218/S013 integration points for S032; S200 model for S003; certified line schema for S011). Golden R0 Product/SME **visual acceptance is not a prerequisite** for any P01 work.

## Story-level readiness
| Story | Status | Build treatment |
|---|---|---|
| S008 | **TECHNICALLY_CERTIFIED_PENDING_PRODUCT_SME_ACCEPTANCE** (branch `r1-s008-period-close-control`; PO checkpoint accepted 2026-07-28, commits `ce35c3f`/`762e2b4`) | Technical certification complete — no engineering work remains; awaiting Product + Accounting SME acceptance |
| S009 | **READY_FOR_TECHNICAL_VERIFICATION** | Full vertical slice |
| S003 | **READY_FOR_TECHNICAL_VERIFICATION** | Build where contract ready |
| S011 | **READY_WITH_DECISIONS** — BLOCKED only for accumulator-adjacent behavior (SES-3), isolated | Confirmed analysis-code semantics proceed |
| S032 | **READY_WITH_DECISIONS** — scheduled automatic generation EXCLUDED until approved | Template CRUD + manual generation with approved JE components |

## S008 current truth (technically certified 2026-07-28; PO checkpoint accepted, Product/SME acceptance still open)
Implemented AND technically certified on branch: schema+migrations · governed transition functions and triggers · RLS + SECURITY DEFINER · domain state machine · application services · HTTP endpoints · permission catalogue · actor-spoofing correction · adjusting-entry attestation integration · fresh migration proof · service tests + TypeScript verification · automated live-db concurrency/idempotency/RLS-negative suite · live-code PostingService proof · route-level authz-guard coverage (incl. two-tier-separation proof) · real live-gateway authorization proof · P01-SCR-01 UI (browser-verified) · Playwright lifecycle spec (executed, passing).
**Remaining (Product/SME acceptance lane only — no engineering work pending):** Product review of the workflow · Accounting SME confirmation of OPEN/SOFT_CLOSED/adjusting-entry/HARD_CLOSED/two-tier-reopen/terminal-LOCKED behavior · final screenshots or demonstration evidence · MODULE_STATE + certification-matrix alignment · merge/promotion approval. **Do not add new S008 functionality while this acceptance review is pending.**
**Contract rule:** the implemented/certified endpoints have already been reconciled against PROPOSED_CONTRACT_V1 as a contract correction (P01_STORY_CONTRACTS.md now marks S008 IMPLEMENTED_CONTRACT_V1) — never silently adopt either side going forward. The implemented answers to BLK-01/02/04 (soft-close allowlist, drafts handling, sequential close) are certified only when Product/SME acceptance confirms they match intent; BLK-03 (unlock mode) is resolved and moot (LOCKED is terminal, no unlock exists).

## Revised implementation sequence
**A. S008** — technically certified 2026-07-28, now in Product/Accounting SME acceptance review (no further engineering work; do not add new functionality while pending). Was sequenced first because it gates S032's refusal rules.
**B. S009** — full vertical slice (retires the statements limitation banner earliest).
**C. S003** — build where ready. **D. S011** — confirmed semantics only; SES-3 scope isolated, unrelated work never held. *(C and confirmed-D may run in parallel where dependencies allow.)*
**E. S032** — template CRUD + manual generation on the approved JE components; **no scheduler UI or backend** until the scheduling decision approves; manual path certifies independently.

## Blocking model — story-level, never pack-level
P01_STORY_BLOCKING_REGISTER.csv enumerates all 27 items with per-dimension blocking (design / frontend / backend / certification) and owners. Headline: **zero items block design; zero block the pack**; most block only certification of their own story. Repository and runtime verification (BLK-05/06/10/11/15/19/25/27) is a **Claude Code activity** — TECHNICAL_VERIFICATION_REQUIRED / API_CONFIRMATION_REQUIRED flags are work items in the implementation lane, not reasons to withhold Product/Design approval.

## Unchanged from the approved package
Design artifact and screens (no redesign) · story IDs · vertical-slice delivery rule (design+FE+BE+API+DB+authz+isolation+audit+tests+Playwright+Product acceptance+SME acceptance per story) · reuse mandates (JE line grid + balance bar in S032; Period Status Timeline as the one catalogued new pattern) · explicit non-goals (no S031 routing, no S004B SoD, no S026–S029 schedule semantics, no franchise packs, no elimination posting, no formula amounts) · stop conditions (certified-path divergence halts the story with a surfaced diff; generation never bypasses the posting lifecycle).
