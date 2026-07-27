# GOLDEN R0 — Story Contract Gaps

**Gate:** GATE 1 — Authoritative Story Contract Verification
**Companion document:** `GOLDEN_R0_STORY_CONTRACT_MATRIX.md`
**Scope:** S202, S004A, S007, S224, S220, S221, S014, S222, S227

This document records every gap, conflict, unresolved dependency, or
stop-condition discovered while assembling the 9 Story Contracts, evaluated
strictly against the user's explicit stop-conditions:

> Do not implement a Story when: its authoritative definition is missing, its
> acceptance criteria are incomplete, its source mappings conflict, its
> dependency is unresolved, or its repository status contradicts
> `MODULE_STATE.json`.

---

## 1. Authoritative definition — completeness

**Result: no missing definitions.** All 9 stories have a complete, individually
authored `COPILOT_BUILD_PACKETS/R0/{StoryID}.md` covering all 17 packet
sections (implementation strategy, approved story, business rules, acceptance
criteria, Figma reference, existing-components-to-inspect, AMACC reuse
guidance, prohibited behavior, data changes, APIs/events, UI states,
security/audit, stub contracts, tests, success metrics, demo scenario,
required completion evidence, and explicit blockers). No story is missing a
packet, and no packet is truncated or a placeholder.

## 2. Acceptance criteria — completeness vs. approval status

**Result: textually complete, but not yet PO-approved as businesses-correct.**
Every story has Given/When/Then positive ACs plus at least one explicit
NEGATIVE/EXCEPTION AC. However, `BACKLOG_VALIDATION_REPORT.md` states Class 2
("Requirement completeness validation — are the 88 fields per R0 story
businessly right and sufficient?") is **"IN PO REVIEW"** package-wide, with
22 open UQs, 6 of which are DoR-blocking for *specific* stories elsewhere in
the backlog. None of the 6 DoR-blocking UQs target these 9 stories directly.
**This is a distinction, not a contradiction**: the AC text exists and is
internally coherent; it simply has not completed the PO's own
business-correctness sign-off process yet.

## 3. Source mapping conflicts

**Result: no conflicts found between packet, registry, and validation report.**
- `canonical_registry.json` epic/release/level values match every packet
  header exactly (S202/CE-01/R0/L0, S004A/CE-01/R0/L0, S007/CE-01/R0/L0,
  S224/CE-01/R0/L1, S220/CE-05/R0/L1, S221/CE-05/R0/L2, S014/CE-03/R0/L2,
  S222/CE-05/R0/L2, S227/CE-05/R0/L2).
- Traceability (Class 1) is machine-proven `PASS`: 132/132 original stories
  mapped, no dangling trace targets, no duplicate IDs, no dissolved-ID
  resurrection.
- One flagged (not conflicting) item: **S224's level classification (L1 vs
  L2) is explicitly marked `[FLAG]` — "PO review decision pending"** in
  `BACKLOG_VALIDATION_REPORT.md`. This is an open classification question,
  not a mapping conflict — the packet header and registry currently agree
  (both say L1); the flag says that agreement itself may not be final.

## 4. Dependency resolution

**Result: dependencies are documented and sequenced, but two are unresolved
blockers for specific stories, and one is a hard sequencing gate:**

| Dependency | Status | Affected stories |
|---|---|---|
| Real S007 (audit) | **Not yet built** — no tracked entry in `MODULE_STATE.json`; only referenced as a future obligation inside 12+ already-certified stories' gap text | S224 (hard block, no stub permitted); S202/S004A/S220/S221/S014/S222/S227 (stub-permitted, capped at `DONE_PENDING_INTEGRATION` until real) |
| Real S207 (authz) | Already real and deny-by-default per prior certification (`MODULE_STATE.json` confirms S207's engine `AuthzService.check()` is genuine), but only 2 of 21 previously-certified stories actually call it yet — tracked as a separate gap in `AUTHORIZATION_WRITE_PATH_CENSUS.csv` | All 9 (via stub contract until each story's own integration gate) |
| S013 (posted journals as source of truth) | Certified DONE in the prior Foundation Completion phase | S220, S014 |
| S211 (account hierarchy) | Certified DONE in the prior Foundation Completion phase | S222, S227 |
| S014 (Trial Balance API) | Not yet built (this gate) | S222, S227 (both consume S014's output) |
| S217 (journal-entry detail view) | Referenced as a drill-through target by S220; not one of the 9 in this gate — existence/status not verified here | S220 |
| UQ-14 (COA baseline conflict: production vs NADA-90 vs BP 3.2) | Open; interim PO-signed seed = BP 3.2 skeleton; **blocks S010's final content**, only *informs* S222 | S222 (informational, not a hard block per the UQ's own "BLOCKS" column) |
| UQ-15 (retention: 8-year legacy prune vs 10-year canonical) | Open; explicitly annotated **"NOT blocking R0"** | S007 (retention config only, not the log itself) |
| UQ-21 (source-level permission vs S207 catalog — complementary or duplicative) | Open, Sprint 1-2 SPIKE-05; interim resolution = "catalog primary + source-permission as additional gate"; **blocks S212's permission integration**, not S004A itself | S004A (informational) |

**Conclusion:** No dependency is silently missing. S224's dependency on real
S007 is the one genuinely hard, unresolved blocker among the 9 — it cannot be
started at all until S007 ships for real. The others' dependencies are
resolvable via the documented stub-contract mechanism, with the explicit
consequence that any such story tops out at `DONE_PENDING_INTEGRATION`, never
full `DONE`, until the stub is replaced and re-certified.

## 5. Repository-status contradiction check against `MODULE_STATE.json`

**Result: no contradictions.** A full-text search of
`docs/accounting-modernization/MODULE_STATE.json` and
`docs/accounting-modernization/stabilization/STORY_CERTIFICATION_MATRIX.csv`
for all 9 story IDs found:

- **S202, S224, S220, S221, S014, S222, S227**: zero occurrences anywhere in
  either file. Clean `NOT_STARTED` baseline — consistent with each packet's
  own "PROPOSED, not yet released" status.
- **S004A**: 2 occurrences in `MODULE_STATE.json`, both as narrative
  dependency mentions inside *other* certified stories' text, never as its
  own tracked story entry.
- **S007**: 30 occurrences in `MODULE_STATE.json`, **all** as narrative
  references inside the `stubGate`/gap text of 12+ already-certified stories
  (e.g., "swap the AuditPort stub … for the real S007 audit consumer across
  S223, S208, S209, S210, S211, S010, S212, S213" and the equivalent for
  S201/S203/S204/S205/S206). **S007 itself has no tracked entry of its own.**
  This confirms, rather than contradicts, the packet's Sprint-1 "build this
  first" positioning — the 12+ stories that reference it are all waiting on
  a deliverable that does not yet exist.

No case was found where a story's packet claims a repository state that
disagrees with `MODULE_STATE.json`.

## 6. Existing reusable code — verified against live repository (not just crosswalk text)

| Story | Packet claim | Live repo verification |
|---|---|---|
| S202 | "Concept Reference Only" — `DealerGroup`/`DealerGroupTenant`, flat 2-level | **Confirmed**: `services/group-service/prisma/schema.prisma` has `DealerGroup` model, no hierarchy beyond flat grouping |
| S004A | "Missing from Prototype" — "confirm absence" of role screens | **Confirmed absent**: zero matches for `role_template`/`RoleTemplate` across `services/**` and `packages/**` |
| S007 | "Reuse After Refactoring" — immutable trigger + outbox exists for `agent_logs` only | **Consistent**: certified stories' `MODULE_STATE.json` entries reference `audit_outbox`/`*_outbox_events` tables already in active use, but no hash-chained, full-coverage `audit_event` table exists yet |
| S224 | "none applicable... net-new" | **Confirmed**: no per-document audit UI exists anywhere in `apps/web/src/pages/**` |
| S220 | "STRONGEST UI ASSET" — `GLInquiry.tsx` | **Confirmed live**: `apps/web/src/pages/accounting/GLInquiry.tsx` exists |
| S221 | `TransactionInquiry.tsx` patterns | **Confirmed live**: `apps/web/src/pages/accounting/TransactionInquiry.tsx` exists |
| S014 | `/trial-balance` endpoint + `GLAccountPeriodBalance`, unproven rebuild-equivalence | **Confirmed live**: trial-balance logic exists in `services/gl-service/src/http/routes.ts`, but **gl-service is not part of the currently-running certified live stack** (only auth/tenant/coa/api-gateway/audit services are live per prior Foundation Completion evidence) |
| S222 | `GLTrialBalance.tsx` (NADA format), foot-gate "Cannot-Determine" | **Confirmed live**: `apps/web/src/pages/accounting/reports/GLTrialBalance.tsx` exists |
| S227 | BS/IS endpoints + screens exist, invariant/tie tests absent | **Confirmed live**: balance-sheet/income-statement logic exists in `services/gl-service/src/http/routes.ts` and `application/gl-service.ts`, same live-stack caveat as S014 |

**New gap surfaced by this verification (not stated explicitly in any single
packet):** S014, S227 (and by extension S222) all reuse code that lives in
`services/gl-service`, which is present in the repository but is **not one of
the 5 services currently deployed/certified in the live stack**
(auth-service, tenant-service, coa-service, api-gateway, audit-service — per
`FINAL_R0_FOUNDATION_CERTIFICATION_REPORT.md`). Bringing gl-service into the
certified live stack (with its own migration history, RLS posture, and
gateway routing) is implied but understated work that any fleet-lane estimate
for S014/S222/S227 must account for explicitly.

## 7. Figma / UI design readiness

7 of the 9 stories are `FIGMA_REQUIRED` (S202, S004A, S224, S220, S221, S222,
S227); only S007 and S014 are `NO_UI_STORY`. `BACKLOG_VALIDATION_REPORT.md`
Class 4 (Figma validation) is **"PENDING (1 partial)"** package-wide — no
Figma designs have been produced for any of these 7. Each packet is explicit:
*"Do not invent UI beyond these textual states; interim R0 UI requires a
recorded PO waiver."* No such waiver exists for any of the 9 stories in the
repository today.

## 8. Governance / PO-release gate (the primary stop-condition for
implementation, distinct from contract completeness)

Every one of the 9 packets opens with the identical line:

> "Status: PROPOSED - implement ONLY when this packet is individually
> RELEASED by the Product Owner."

and closes with:

> "Implement ONLY this story. Do not start any dependent or blocked story.
> Do not begin S201 or any other packet without its individual PO release."

**None of the 9 stories has been individually released by the Product Owner
in this session or any prior one.** This is independent of whether the
contract itself is complete — it is a governance precondition the packets
themselves impose on top of contract completeness, and it is not satisfied
for any of the 9 stories today.

## 9. Summary of stop-conditions evaluated

| Stop-condition (per user directive) | S202 | S004A | S007 | S224 | S220 | S221 | S014 | S222 | S227 |
|---|---|---|---|---|---|---|---|---|---|
| Authoritative definition missing | No | No | No | No | No | No | No | No | No |
| Acceptance criteria incomplete (textually) | No | No | No | No | No | No | No | No | No |
| Source mappings conflict | No | No | No | No | No | No | No | No | No |
| Dependency unresolved (hard block) | No (stub OK) | No (stub OK) | No (root, no blockers) | **Yes — real S007 required, no stub** | No (stub OK) | No (stub OK) | No (stub OK) | No (stub OK, depends on S014) | No (stub OK, depends on S014) |
| Repository status contradicts `MODULE_STATE.json` | No | No | No | No | No | No | No | No | No |
| Individual PO release obtained (packet's own gate) | **No** | **No** | **No** | **No** | **No** | **No** | **No** | **No** | **No** |

## 10. Conclusion

The 9 Story Contracts are **complete and mutually consistent** as
documentation artifacts: every field is populated from authoritative sources
with no fabricated content, no cross-source conflicts were found, and the one
genuinely unresolved *technical* dependency (S224 → real S007) is correctly
identified and already reflected as a hard sequencing rule inside S224's own
packet — it is not a hidden gap.

However, per the packets' own explicit governance clause, **none of the 9
stories may begin implementation** until each is individually released by the
Product Owner, and per `BACKLOG_VALIDATION_REPORT.md`, business-completeness
(Class 2), legacy/SME validation (Class 3), and Figma design (Class 4) all
remain open package-wide. These are reported as gaps for Product Owner
awareness, not as defects in the contract-verification work itself.
