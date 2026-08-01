# CE-08 — Formal Decision Approval Register

**Authoritative source (unmodified):** `docs/accounting-modernization/CE08_FABLE_EPIC_PACKAGE.md`
**Companion index:** `docs/accounting-modernization/CE08_REQUIREMENT_TRACEABILITY.md`
**Base commit at time of approval:** `4c3d387bdfeb6d791a2c02aec3243e358573bfb6`

**Final approver:** Shivashankar Angadi
**Approval authority:** Product, Accounting, Security and Engineering program owner
**Approval date:** 2026-08-01

**Scope of this record:** This document records the formal approval decision for
each of the 11 unresolved CE-08 decisions (D-CE08-01 through D-CE08-09,
P-CE08-A, P-CE08-B) identified in the authoritative Fable epic package. It does
**not** modify, rewrite, or reinterpret `CE08_FABLE_EPIC_PACKAGE.md`. Where the
package states an explicit `PROPOSED` or preferred option, that exact option is
recorded as approved, using the original Fable terminology verbatim. Where the
package does **not** state an explicit proposed/preferred option, this record
does not invent one — it records the decision as approved in principle only,
with the exact implementation option left open pending confirmation from the
source (per instruction), and explicitly flags that this is not permission to
invent accounting behavior.

---

## Approval Table

| Decision ID | Exact Approved Option (verbatim from source, where stated) | Approved By | Approval Date | Affected Stories | CE-07 Dependency | Implementation Status |
|---|---|---|---|---|---|---|
| D-CE08-01 | `APPROVED_IN_PRINCIPLE — EXACT_IMPLEMENTATION_OPTION_TO_BE_CONFIRMED_FROM_SOURCE` (no PROPOSED/preferred option stated in source; source lists only the option set "oldest-first / FIFO / per-account-class matrix" with no preference marked) | Shivashankar Angadi | 2026-08-01 | S028 | None stated | Approved development blocker — now closed |
| D-CE08-02 | `APPROVED_IN_PRINCIPLE — EXACT_IMPLEMENTATION_OPTION_TO_BE_CONFIRMED_FROM_SOURCE` (no PROPOSED/preferred option stated in source; source states only scope constraint "permission-only in CE-08; no S031 routing", no threshold value proposed) | Shivashankar Angadi | 2026-08-01 | S029 | None stated | Approved development blocker — now closed |
| D-CE08-03 | `APPROVED_IN_PRINCIPLE — EXACT_IMPLEMENTATION_OPTION_TO_BE_CONFIRMED_FROM_SOURCE` (source states "Default aging bands (30/60/90/120?)" — presented with a question mark as an example set, not marked PROPOSED or preferred) | Shivashankar Angadi | 2026-08-01 | S027 | None stated | Approved — confirmable during implementation |
| D-CE08-04 | **within-account** (transfer boundary limited to within the same control account); **cross-account transfer requires a journal** — exact source wording: "PROPOSED: within-account; cross-account = journal" | Shivashankar Angadi | 2026-08-01 | S029 | None stated | Approved development blocker — now closed |
| D-CE08-05 | `APPROVED_IN_PRINCIPLE — EXACT_IMPLEMENTATION_OPTION_TO_BE_CONFIRMED_FROM_SOURCE` (no PROPOSED/preferred option stated in source for statement/dunning content, branding, or escalation timing) | Shivashankar Angadi | 2026-08-01 | S030 | None stated | Approved development blocker — now closed |
| D-CE08-06 | **print/PDF only** — exact source wording: "Statement delivery channel scope v1 (print/PDF only PROPOSED)" | Shivashankar Angadi | 2026-08-01 | S030 | None stated | Approved development blocker — now closed |
| D-CE08-07 | `APPROVED_IN_PRINCIPLE — EXACT_IMPLEMENTATION_OPTION_TO_BE_CONFIRMED_FROM_SOURCE` (no PROPOSED/preferred option stated; source instructs "EVIDENCE from S026 implementation likely answers this; confirm, don't redesign" — the answer is to be read from existing code, not chosen here) | Shivashankar Angadi | 2026-08-01 | S026 (and S028 create-path) | None stated | Approved — confirmable during implementation |
| D-CE08-08 | `APPROVED_IN_PRINCIPLE — EXACT_IMPLEMENTATION_OPTION_TO_BE_CONFIRMED_FROM_SOURCE` (no PROPOSED/preferred option stated; source states "accounting judgment required" between "restore-and-flag vs block-reversal-until-downstream-reversed") | Shivashankar Angadi | 2026-08-01 | S028, S029 | None stated | Approved — confirmable during implementation |
| D-CE08-09 | **business date** — exact source wording: "age from business date (PROPOSED) vs posting date" | Shivashankar Angadi | 2026-08-01 | S027, S028 | Yes — tied to "Replay-into-open-period journals (CE-07 H)" behavior | Approved — confirmable during implementation |
| P-CE08-A | `APPROVED_IN_PRINCIPLE — EXACT_IMPLEMENTATION_OPTION_TO_BE_CONFIRMED_FROM_SOURCE` (not a decision among options — a pending technical fact: "JOURNAL_ENTRY_POSTED final payload/delivery/idempotency pattern"; no option to approve until CE-07 confirms) | Shivashankar Angadi | 2026-08-01 | S026 | Yes — entirely dependent on CE-07's final integration facts | Approved subject to final CE-07 technical reconciliation — does not block independent CE-08 implementation |
| P-CE08-B | `APPROVED_IN_PRINCIPLE — EXACT_IMPLEMENTATION_OPTION_TO_BE_CONFIRMED_FROM_SOURCE` (not a decision among options — a pending technical fact: "S023 schedule-effect declaration shape consumed by schedule-service"; no option to approve until CE-07 confirms) | Shivashankar Angadi | 2026-08-01 | S026, S028 | Yes | Approved subject to final CE-07 technical reconciliation — does not block independent CE-08 implementation |

---

## Items Lacking an Explicit Fable Proposed/Preferred Option

The following 8 of 11 decisions had **no explicit `PROPOSED` tag or stated
preferred option** in `CE08_FABLE_EPIC_PACKAGE.md`, and are therefore recorded
as `APPROVED_IN_PRINCIPLE — EXACT_IMPLEMENTATION_OPTION_TO_BE_CONFIRMED_FROM_SOURCE`
rather than with an invented specific value:

- **D-CE08-01** — option set given (oldest-first / FIFO / per-account-class matrix), no preference marked
- **D-CE08-02** — no threshold value or refusal-path option proposed
- **D-CE08-03** — example band values given with a question mark, not marked PROPOSED
- **D-CE08-05** — topic named (content/branding source, escalation timing), no option proposed
- **D-CE08-07** — explicitly deferred to existing S026 code confirmation, not a business choice
- **D-CE08-08** — explicitly flagged "accounting judgment required," no preference marked
- **P-CE08-A** — pending CE-07 technical fact, not a decision among stated options
- **P-CE08-B** — pending CE-07 technical fact, not a decision among stated options

Only **3 of 11** decisions carried an explicit Fable `PROPOSED` option, which is
recorded verbatim above: **D-CE08-04**, **D-CE08-06**, **D-CE08-09**.

---

## Approval Groupings (per instruction)

**Approved development blockers now closed:**
D-CE08-01, D-CE08-02, D-CE08-04, D-CE08-05, D-CE08-06

**Approved and confirmable during implementation:**
D-CE08-03, D-CE08-07, D-CE08-08, D-CE08-09

**Approved subject to final CE-07 technical reconciliation (non-blocking to independent CE-08 implementation):**
P-CE08-A, P-CE08-B

---

## Explicit Non-Invention Notice

For every decision recorded as `APPROVED_IN_PRINCIPLE —
EXACT_IMPLEMENTATION_OPTION_TO_BE_CONFIRMED_FROM_SOURCE` above, this approval
authorizes proceeding with development planning and non-behavioral scaffolding
only. It does **not** authorize selecting or implementing any specific
accounting behavior, threshold, rule, or configuration value on behalf of
Fable. The exact implementation option for these items must still be confirmed
from the authoritative source (or a subsequent explicit Fable/product
addendum) before the corresponding accounting logic is coded.
