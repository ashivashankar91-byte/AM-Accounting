# GOLDEN R0 — Story Contract Matrix

**Gate:** GATE 1 — Authoritative Story Contract Verification
**Scope:** S202, S004A, S007, S224, S220, S221, S014, S222, S227
**Branch:** golden-r0-fleet
**Authoritative source:** `docs/accounting-modernization/AutoMate2_Accounting_Backlog_Package_v1.1.zip`
→ extracted: `ACCOUNTING_MASTER_BACKLOG.md`, `canonical_registry.json`,
`COPILOT_BUILD_PACKETS/R0/{StoryID}.md`, `AMACC_REUSE_CROSSWALK_FINAL.md`,
`BACKLOG_VALIDATION_REPORT.md`, `FIGMA_STORY_COVERAGE.md`,
`OPEN_QUESTIONS_AND_DECISIONS.md`
**Cross-checked against repository state:** `docs/accounting-modernization/MODULE_STATE.json`,
`docs/accounting-modernization/stabilization/STORY_CERTIFICATION_MATRIX.csv`,
live source tree (`apps/web/src/pages/**`, `services/**/prisma/schema.prisma`, `services/**/src/http/routes.ts`)

**Global conventions inherited by every story (from `ACCOUNTING_MASTER_BACKLOG.md`), not repeated per field:**
GLOBAL-CALC (NUMERIC(15,2), half-up rounding), GLOBAL-AUDIT (S007 event on every state
change), GLOBAL-RETENTION, GLOBAL-ERROR (rule-referenced diagnostics, no silent
fallback), GLOBAL-IDEMPOTENCY, GLOBAL-CONCURRENCY (optimistic lock + SERIALIZABLE
retry), GLOBAL-OBS, GLOBAL-PERF, GLOBAL-SEC (S207 deny-by-default), GLOBAL-A11Y,
GLOBAL-UI, GLOBAL-BUILD-OUTPUT, GLOBAL-EVIDENCE.

**Package-wide prohibited-behavior list applies to all 9 stories:** AI gate in
posting path; 30-sec silent auto-approve; tenant=entity=rooftop conflation;
in-memory persistence for financial state; unvalidated-credential token issuance;
seeded mock data behind real widgets; validation logic divergent from the posting
path.

---

## S202 — Dealer Group Hierarchy View & Maintenance

| # | Field | Value |
|---|---|---|
| 1 | Story ID | S202 |
| 2 | Title | Dealer Group Hierarchy View & Maintenance |
| 3 | Parent Epic | CE-01 (Foundation Masters) — confirmed identical in packet header and `canonical_registry.json` |
| 4 | Parent Feature | Not separately named in registry; epic-level only (registry schema has no `feature` key — see Known Gap) |
| 5 | Release | R0, Sprint 3, Level L0, Priority P0 |
| 6 | Persona | Group CFO |
| 7 | Business problem | No single place shows the full group→entity→store→franchise structure; scoping mistakes go unseen |
| 8 | User outcome | One authoritative, exportable hierarchy underlies consolidation scoping and onboarding review |
| 9 | Primary workflow | View tree (group→entity→store→franchise) with status/effective dates → export CSV |
| 10 | Alternate workflows | Re-parent a node (effective-dated edit) |
| 11 | Exception workflows | Cycle creation attempt → 422 `BR202-1` |
| 12 | UI screens/fields | Tree view, node status badges, export screen. Node: `{type:GROUP|ENTITY|STORE|FRANCHISE, id, code, name, status, effectiveFrom, effectiveTo}`. FIGMA_REQUIRED — no interim UI permitted without a recorded PO waiver |
| 13 | API endpoints/events | `GET /org/tree?asOf=date` → 200 nested nodes; `POST /org/tree:reparent {nodeId,newParentId,effectiveFrom}` → 200 \| 422 `{error:BR202-1}`. Event produced: `org.node.reparented {eventId,nodeId,oldParentId,newParentId,effectiveFrom,actor,ts,schemaV:1}`. Consumes: `org.entity.*`, `org.store.*`, `org.franchise.*` |
| 14 | Data entities/relationships | Reads entity/store/franchise; single-parent tree, additive migrations only |
| 15 | Accounting rules/calculations | None (organizational structure story, not GL-calculation) |
| 16 | Validation rules | BR202-1 single-parent tree, cycles impossible; BR202-2 re-parenting is effective-dated, not a separate state; BR202-3 CSV export must match screen exactly |
| 17 | Authorization permissions | `org.tree.view`, `org.tree.manage` (re-parent) — enforced via AuthzPort/S207, deny-by-default |
| 18 | Tenant/entity/store/dept scope | Tenant-scoped tree; nodes span entity/store/franchise levels under the tenant |
| 19 | Audit events | Every state change (re-parent) emits event (§13) **and** an audit record via AuditPort with before/after images |
| 20 | Source requirement IDs | Traced from 132 original V1 stories per `canonical_registry.json.traceability` (132/132 mapped, registry-validated `PASS`); packet does not cite a specific legacy BR-code source (organizational hierarchy is net-new relative to AMACC's flat DealerGroup/DealerGroupTenant model) |
| 21 | Acceptance criteria | (a) tree renders all nodes with status + effective dates; (b) re-parent saved → effective-dated + audit-logged; (c) export CSV parity with screen; (d) NEGATIVE: cycle creation → 422 |
| 22 | Definition of Ready | Packet self-contained; no open UQ blocks S202 directly (see §16.2) |
| 23 | Definition of Done | Tree renders full pilot hierarchy, zero cycle defects; CSV export parity is a functional (non-numeric) AC; full completion evidence per §15 (CI run, migration diff, runtime transcript, demo, OpenAPI diff, PR reference, known limitations, integration-gate checklist if stubs used) |
| 24 | Dependencies | Depends on S007 (audit)/S207 (authz), both "may be in-flight" — permitted to use AuditPort/AuthzPort **stub contracts**; explicit blocker: S204 in same sprint; sequencing note: do not begin any other packet without its own individual PO release |
| 25 | Current repository implementation status | **NOT TRACKED** in `MODULE_STATE.json` or `STORY_CERTIFICATION_MATRIX.csv` (verified via full-text grep — zero hits for `S202`). No contradiction found (clean NOT_STARTED baseline) |
| 26 | Existing reusable code | `DealerGroup`/`DealerGroupTenant` models exist in `services/group-service/prisma/schema.prisma` (verified live) — packet classifies this as **"Concept Reference Only"**: current model is a **flat 2-level grouping**, explicitly prohibited as the reuse target (§7: "Do not adopt flat grouping as the hierarchy model") |
| 27 | Known gaps | Stub-based work is capped at `DONE_PENDING_INTEGRATION` until real S007/S207 integration reruns pass; Figma design not yet produced (Class 4 validation `PENDING` per `BACKLOG_VALIDATION_REPORT.md`); Class 2 (business/AC completeness) is `IN PO REVIEW` package-wide |
| 28 | Proposed fleet lane | Sequenced after S007 (Sprint 1) and alongside S204 (same sprint); requires individual PO release per packet header before implementation start |

---

## S004A — Dealership Position Role Templates

| # | Field | Value |
|---|---|---|
| 1 | Story ID | S004A |
| 2 | Title | Dealership Position Role Templates |
| 3 | Parent Epic | CE-01 (Foundation Masters) |
| 4 | Parent Feature | Not separately named in registry (epic-level only) |
| 5 | Release | R0, Sprint 3, Level L0, Priority P0 |
| 6 | Persona | Security administrator |
| 7 | Business problem | Generic roles don't match dealership hiring reality — Biller, Cashier, Title Clerk need one-click profiles with cost masking |
| 8 | User outcome | Store onboarding in minutes; salesperson vehicle-cost visibility risk closed via serialization-level masking |
| 9 | Primary workflow | Apply a shipped role template to a user → permission set + field masks take effect |
| 10 | Alternate workflows | Tenant clones/customizes a shipped template |
| 11 | Exception workflows | Template edit does not retroactively change already-customized clones without explicit confirm |
| 12 | UI screens/fields | Template gallery, apply wizard, mask preview. Template: `{position:enum BILLER|CASHIER|TITLE_CLERK|AP_CLERK|AR_CLERK|ACCOUNTANT|OFFICE_MGR|CONTROLLER|SALESPERSON_RO, permissions:[keys], fieldMasks:[e.g. vehicle.cost]}`. FIGMA_REQUIRED |
| 13 | API endpoints/events | `GET /role-templates` → 200 shipped set; `POST /role-templates:apply {templateId,userId,entityId,storeIds}` → 201 assignment. Event: `iam.template.applied {eventId,templateId,userId,scope,actor,ts,schemaV:1}`. Consumes: none |
| 14 | Data entities/relationships | New `role_template` table; additive migration only |
| 15 | Accounting rules/calculations | None directly; enforces `cost_masked` field policy at API serialization for sales-facing roles (security/masking rule, not GL calc) |
| 16 | Validation rules | BR4A-1 templates are cloneable defaults, tenant-customizable; BR4A-2 cost-mask policy enforced at serialization |
| 17 | Authorization permissions | `iam.roletemplate.manage`, `iam.roletemplate.apply` |
| 18 | Tenant/entity/store/dept scope | Applied per user at entity/store scope; template definitions are tenant-customizable |
| 19 | Audit events | Vehicle-cost view attempt by a masked role is itself audit-logged; every apply/state-change emits §13 event + AuditPort record |
| 20 | Source requirement IDs | Traceability: mapped under the 132-original mapping (registry `PASS`); no specific legacy BR-code cited — packet classifies as **"Missing from Prototype"** (net-new) |
| 21 | Acceptance criteria | (a) Biller-applied template permission set matches spec sheet exactly (contract test); (b) cost-masked role requesting vehicle cost → field absent from payload **and** view attempt audit-logged; (c) NEGATIVE: template edit does not retro-mutate existing customized clones without confirm |
| 22 | Definition of Ready | Blocked in part by open question UQ-21 (see field 24/27) |
| 23 | Definition of Done | All BP 1.4 positions covered by templates; masking proven by serialization test (target class: `REGULATORY_REQUIREMENT`); full §15 evidence package |
| 24 | Dependencies | Depends on S007/S207 (stub-permitted); **UQ-21** ("Source-level user security vs permission catalog — complementary or duplicative? JournalSourcePermission vs S207") explicitly lists S004A as an affected story, Sprint 1-2 SPIKE-05, interim resolution = "catalog primary + source-permission as additional gate" — **not itself DoR-blocking for S004A**, but the interim nature should be tracked |
| 25 | Current repository implementation status | **NOT TRACKED** in `MODULE_STATE.json`/`STORY_CERTIFICATION_MATRIX.csv` as its own story (S004A appears only twice in `MODULE_STATE.json`, both as narrative dependency references inside *other* stories' `stubGate`/gap text — e.g. audit-integration close-out lists — never as its own tracked entry). No contradiction; clean NOT_STARTED |
| 26 | Existing reusable code | Packet states "React role screens (none expected — confirm absence)" — **confirmed absent**: repo-wide search for `role_template`/`RoleTemplate` in `services/**` and `packages/**` returns zero matches. Classification: **"Missing from Prototype"** |
| 27 | Known gaps | UQ-21 interim resolution still open (not finalized); Figma pending (Class 4); Class 2 business-completeness PO review pending package-wide |
| 28 | Proposed fleet lane | Sprint 3 placement per packet; sequenced after S007 for real audit wiring, and informed by UQ-21 SPIKE-05 outcome for permission-catalog interplay |

---

## S007 — Immutable Audit Log

| # | Field | Value |
|---|---|---|
| 1 | Story ID | S007 |
| 2 | Title | Immutable Audit Log |
| 3 | Parent Epic | CE-01 (Foundation Masters) |
| 4 | Parent Feature | Not separately named in registry (epic-level only) |
| 5 | Release | R0, **Sprint 1**, Level L0, Priority P0 — earliest-sequenced of the 9 target stories |
| 6 | Persona | Auditor |
| 7 | Business problem | AMACC audits only `agent_logs` via trigger on some tables; most writes leave no immutable trace |
| 8 | User outcome | Every state change is provable, tamper-evident, survivable for the retention period — the audit backbone of the platform |
| 9 | Primary workflow | Any write commits an audit event transactionally via outbox in the same transaction as the source write |
| 10 | Alternate workflows | Nightly/periodic hash-chain verification job; retention tiering to WORM archive |
| 11 | Exception workflows | Outbox write failure → source transaction rolls back (never silent loss); chain-verification detects tamper → alarm |
| 12 | UI screens/fields | **NO_UI_STORY** (n/a) |
| 13 | API endpoints/events | No public write API — internal outbox ingest only; query surfaced via S224 (`GET /audit/events?docType&docId`); chain-verify job. Emits `audit.chain.alert {partition,brokenAt,ts}` on tamper detection. Consumes **all** domain events (`org.*`, `iam.*`, `coa.*`, `fiscal.*`, `je.*`, `acct.*`) plus direct tx-coupled writes |
| 14 | Data entities/relationships | New `audit_event {eventId:uuid, tenantId, actor, ts, docType, docId, action, before:jsonb?, after:jsonb?, hashPrev, hashSelf}`, partitioned by month+tenant; additive migration only |
| 15 | Accounting rules/calculations | None (infrastructure story) |
| 16 | Validation rules | BR7-1 audit event written transactionally via outbox with the source write; BR7-2 hash chain makes tampering detectable; BR7-3 retention per policy pending UQ-15 (WORM tiering); BR7-4 audit-write failure rolls back the source transaction |
| 17 | Authorization permissions | Internal write path (no external permission); `audit.read` gated via S224's permissions |
| 18 | Tenant/entity/store/dept scope | `tenantId` is a first-class column; partitioned by month+tenant |
| 19 | Audit events | This story **is** the audit-event provider (AuditPort implementation) — see dependency stub contract note below |
| 20 | Source requirement IDs | Classified **"Reuse After Refactoring"** — existing AMACC immutable DB-trigger + outbox pattern (SPIKE-06 governs); AMACC currently covers only `agent_logs`, consumes 5 of 30+ events — explicit gap vs. the "100% write-path coverage" target |
| 21 | Acceptance criteria | (a) any write → audit event committed in same transaction; (b) chain-verification job over a corrupted row → alarm raised (tamper test); (c) retention tiering moves events to WORM archive per policy; (d) NEGATIVE: fault-injection of outbox failure → source rollback, never silent loss |
| 22 | Definition of Ready | Open question **UQ-15** (retention: 8-year AMACC/legacy prune vs 10-year canonical) is explicitly annotated **"NOT blocking R0"** — the log itself may ship; only retention *configuration* is blocked |
| 23 | Definition of Done | 100% write-path coverage (census in CI) — classified `APPROVED_TARGET` (PO condition); tamper detection proven; retention period itself is `PENDING UQ-15` (no number stated, does not block R0 completion of the log) |
| 24 | Dependencies | **None** listed as explicit blockers; this story is itself the dependency-root for S202/S004A/S220/S221/S014/S222/S227 (all use its AuditPort stub contract until it merges) and for S224 (which requires it to be REAL, no stub) |
| 25 | Current repository implementation status | Referenced 30× in `MODULE_STATE.json`, but **only as a narrative dependency** inside other (already-certified) stories' gap/stubGate text (e.g., "swap the AuditPort stub … for the real S007 audit consumer" across S223/S208/S209/S210/S211/S010/S212/S213/S201/S203/S204/S205/S206). **S007 itself has no tracked entry** in `MODULE_STATE.json` or `STORY_CERTIFICATION_MATRIX.csv` as its own story — meaning the "real S007 audit consumer" referenced by 12+ already-certified stories **does not yet exist as a certified deliverable**. This is a significant, load-bearing finding, not a contradiction (the file consistently describes S007 as future work) |
| 26 | Existing reusable code | Live repo confirms an audit-outbox/immutable-trigger pattern already exists and is exercised by the certified stories (e.g., `audit_outbox`/`*_outbox_events` tables referenced in `MODULE_STATE.json` promotion notes) — consistent with packet's "Reuse After Refactoring" classification; genuine S007 build must extend this from partial (`agent_logs`, 5 of 30+ events) to full coverage with hash-chaining, which does not yet exist |
| 27 | Known gaps | This is the **most load-bearing gap of the 9**: every other story in this batch (and 12+ already-DONE_PENDING_INTEGRATION stories) is capped below full DONE until S007 ships for real. UQ-15 retention policy remains open (non-blocking). Figma: N/A (no-UI story) |
| 28 | Proposed fleet lane | **Must be built first** among the 9 (Sprint 1 designation, zero explicit blockers) — its completion is the trigger for the stub→real integration-gate rerun across the already-certified stack and for unblocking S224 |

---

## S224 — Document Audit History View

| # | Field | Value |
|---|---|---|
| 1 | Story ID | S224 |
| 2 | Title | Document Audit History View |
| 3 | Parent Epic | CE-01 (Foundation Masters) |
| 4 | Parent Feature | Not separately named in registry |
| 5 | Release | R0, Sprint 3, **Level L1** (flagged) |
| 6 | Persona | Auditor |
| 7 | Business problem | An audit log nobody can read in context is auditor-hostile; AMACC has no per-document audit UI at all |
| 8 | User outcome | Sub-minute explainability of any record — turns audits from archaeology into navigation |
| 9 | Primary workflow | Open a document's "Audit" tab → chronological who/what/when + before→after diffs render in order |
| 10 | Alternate workflows | Per-document export (PDF/CSV) |
| 11 | Exception workflows | Document with no events renders an **empty state**, never an error |
| 12 | UI screens/fields | Audit tab, diff renderer, export; empty/loading/error states. Timeline row: `{ts, actor, action, fieldDiffs:[{field,before,after}]}`. FIGMA_REQUIRED |
| 13 | API endpoints/events | `GET /audit/documents/{docType}/{docId}` → 200 ordered events (empty-state for zero events, **not 404**); `:export` → file. Emits `audit.viewed {eventId,docType,docId,viewer,ts,schemaV:1}` when PII fields are rendered. Consumes: reads the `audit_event` store (from S007) |
| 14 | Data entities/relationships | Read-only consumer of `audit_event`; no new writable entities; additive migrations only if any supporting view/index is needed |
| 15 | Accounting rules/calculations | None (pure read/UI story) |
| 16 | Validation rules | BR224-1 events render chronologically per document; BR224-2 field diffs human-readable; BR224-3 PII views themselves emit audit events; BR224-4 per-document export |
| 17 | Authorization permissions | `audit.view` (per doc-type scoping), `audit.export` |
| 18 | Tenant/entity/store/dept scope | Tenant-scoped by the underlying `audit_event.tenantId`; doc-type scoping enforced |
| 19 | Audit events | Uniquely, this story's own act-of-viewing PII emits an audit event (`audit.viewed`) — a "views audit itself" requirement |
| 20 | Source requirement IDs | Classified **"Missing from Prototype"** — "log exists, no per-document UI"; net-new screens on S007 data |
| 21 | Acceptance criteria | (a) posted-JE Audit tab renders create→validate→post(→reverse) chain in order; (b) master-data record shows field-level diffs; (c) PII field render emits an audit event; (d) NEGATIVE: document with zero events → empty state, not error |
| 22 | Definition of Ready | **`[FLAG]`** open item per `BACKLOG_VALIDATION_REPORT.md` Class 1 check: "S224 classified L1 (PO review decision pending)" — level classification (L1 vs L2) is an explicit, unresolved PO-review flag |
| 23 | Definition of Done | Any posted amount explainable via UI in under 60 seconds (Sprint-3 demo criterion, classified `PROPOSED_TARGET`); full §15 evidence |
| 24 | Dependencies | **Hard, non-negotiable dependency**: "Depends on REAL S007 — no stub permitted for this story; sequence after S007 merge." This is the only one of the 9 stories explicitly barred from using the AuditPort stub contract |
| 25 | Current repository implementation status | **NOT TRACKED** in `MODULE_STATE.json`/`STORY_CERTIFICATION_MATRIX.csv` (zero hits for `S224`). Consistent with "Missing from Prototype" — no contradiction |
| 26 | Existing reusable code | None — packet explicitly states "none applicable (UI absent in AMACC) — net-new screens on S007 data" |
| 27 | Known gaps | Cannot start until S007 is REAL and merged (not stubbed); L1-vs-L2 level classification unresolved (PO-flagged); Figma pending |
| 28 | Proposed fleet lane | Must sequence strictly **after** S007's real (non-stub) completion; cannot join the same wave as S007 |

---

## S220 — GL Account Activity Inquiry

| # | Field | Value |
|---|---|---|
| 1 | Story ID | S220 |
| 2 | Title | GL Account Activity Inquiry |
| 3 | Parent Epic | **CE-05** (distinct from CE-01 — first epic change among the 9) |
| 4 | Parent Feature | Not separately named in registry |
| 5 | Release | R0, Sprint 3, Level L1, Priority P0 |
| 6 | Persona | Accountant |
| 7 | Business problem | The most-used accounting screen was absent from all 132 V1 stories; without it the ledger is API-only |
| 8 | User outcome | Any account's story — beginning balance, activity, running balance, drill — readable in seconds |
| 9 | Primary workflow | Select account + date range/preset/dimension filters → beginning balance, chronological lines, running balance, ending balance |
| 10 | Alternate workflows | Drill from any line to S217 (journal-entry view); export CSV |
| 11 | Exception workflows | Zero-activity account renders beginning=ending, **not an error** |
| 12 | UI screens/fields | Inquiry grid, filter panel, export; all standard states + keyboard nav. Filters: `{accountId, dateRange|preset(12 presets incl OPEN_MONTH), storeId?, deptCode?, sourceCode?}`. Columns: `{postDate, journalNumber(link→S217), source, memo, store, dept, dr, cr, runningBalance}`. FIGMA_REQUIRED |
| 13 | API endpoints/events | `GET /inquiry/accounts/{id}/activity?range|preset&store&dept` → 200 `{beginningBalance, lines[], endingBalance}` where `ending=beginning+sum(lines)` provably. No events produced/consumed |
| 14 | Data entities/relationships | Reads `journal` + projections; additive migrations only |
| 15 | Accounting rules/calculations | BR220-1 beginning balance = prior-period snapshot; ending = beginning + sum(lines), provable (foot/cross-foot property) |
| 16 | Validation rules | BR220-2 every line drills to S217; BR220-3 export CSV matches screen exactly; BR220-4 source transactions = all posted journals (via S013) |
| 17 | Authorization permissions | `inquiry.account.view` |
| 18 | Tenant/entity/store/dept scope | Filterable by store/department; tenant-scoped implicitly through account/journal scoping |
| 19 | Audit events | Read-only story; no state-change events, but package-wide AuditPort/AuthzPort convention still applies to any admin action (none defined here) |
| 20 | Source requirement IDs | Classified **"Reuse After Validation"** — explicitly named as the **"STRONGEST UI ASSET"**: `GLInquiry.tsx` (12 date presets incl. OPEN_MONTH, running balance, multi-GL, localStorage preferences); SPIKE-04 ports one preset end-to-end with per-widget data-source audit |
| 21 | Acceptance criteria | (a) account 10000 for 2026-08: beginning + chronological lines + running balance, ending = beginning+sum; (b) line click → S217 opens; (c) store filter re-scopes and still foots; (d) export CSV parity; (e) NEGATIVE: zero-activity account renders beginning=ending, not error |
| 22 | Definition of Ready | Open question: "SME confirm preset list matches production accountant workflow" (part of SPIKE-04) — not marked DoR-blocking, but unresolved |
| 23 | Definition of Done | Explain-any-amount <60s (`PROPOSED_TARGET`, Sprint-3 demo); grid renders ≤2s on 100k-line account (`TARGET_REQUIRES_BASELINE` — baseline is pilot data volume at R6, i.e. **not yet measurable at R0**) |
| 24 | Dependencies | Depends on S007/S217/S013 (posted-journal source); uses AuditPort/AuthzPort stub contracts pending S007/S207 |
| 25 | Current repository implementation status | **NOT TRACKED** in `MODULE_STATE.json`/`STORY_CERTIFICATION_MATRIX.csv` (zero hits for `S220`) |
| 26 | Existing reusable code | Confirmed live: `apps/web/src/pages/accounting/GLInquiry.tsx` exists in the repo, matching the packet's named reuse asset |
| 27 | Known gaps | Performance target (≤2s/100k lines) has no current baseline data to validate against; preset-list SME confirmation outstanding; Figma pending |
| 28 | Proposed fleet lane | Sequenced with the CE-05 reporting cluster (S220/S221/S014/S222/S227), all Sprint 3, after S007/S207 real integration |

---

## S221 — GL Search

| # | Field | Value |
|---|---|---|
| 1 | Story ID | S221 |
| 2 | Title | GL Search |
| 3 | Parent Epic | CE-05 |
| 4 | Parent Feature | Not separately named in registry |
| 5 | Release | R0, Sprint 3, **Level L2**, Priority P0 |
| 6 | Persona | Accountant |
| 7 | Business problem | Research that starts with "which account was that in?" wastes hours |
| 8 | User outcome | Amount/date/memo/user search across the whole ledger in seconds |
| 9 | Primary workflow | Enter search criteria (amount/range, dates, source, memo, user, doc ref) → paginated cross-account results |
| 10 | Alternate workflows | Save a search and re-run it later |
| 11 | Exception workflows | Over-broad search paginates, **never times out silently** |
| 12 | UI screens/fields | Search form, results grid, saved searches. Criteria: `{amount|amountRange, dateRange, sourceCode?, memoContains?, postedBy?, docRef?}`. Results = S220 column set + `accountNumber`. `savedSearch {name, criteria}`. FIGMA_REQUIRED |
| 13 | API endpoints/events | `GET /inquiry/search?...` → 200 paginated. No events produced/consumed |
| 14 | Data entities/relationships | Reads `journal`; additive migrations only |
| 15 | Accounting rules/calculations | None beyond result correctness (search, not calculation) |
| 16 | Validation rules | BR221-1 results respect scoping and masks; BR221-2 saved searches re-runnable |
| 17 | Authorization permissions | `inquiry.search` |
| 18 | Tenant/entity/store/dept scope | Results respect tenant/store/dept scoping and any field masks (interacts with S004A masking) |
| 19 | Audit events | None specific to this read-only story beyond package-wide convention |
| 20 | Source requirement IDs | Classified **"Reuse After Validation"** — `TransactionInquiry.tsx` patterns, "benchmark required" |
| 21 | Acceptance criteria | (a) amount 999.00 → all matching lines ≤2s on 1M-line ledger; (b) saved search re-runnable; (c) NEGATIVE: over-broad search paginates, never silently times out |
| 22 | Definition of Ready | No open questions listed for this story specifically |
| 23 | Definition of Done | CI performance benchmark green (≤2s on 1M-line ledger, classified `PROPOSED_TARGET`) |
| 24 | Dependencies | Sprint 3 placement; uses AuditPort/AuthzPort stub contracts pending S007/S207 |
| 25 | Current repository implementation status | **NOT TRACKED** in `MODULE_STATE.json`/`STORY_CERTIFICATION_MATRIX.csv` (zero hits for `S221`) |
| 26 | Existing reusable code | Confirmed live: `apps/web/src/pages/accounting/TransactionInquiry.tsx` exists, matching the packet's named reuse asset |
| 27 | Known gaps | 1M-line performance benchmark not yet run/established in this repo; Figma pending |
| 28 | Proposed fleet lane | CE-05 reporting cluster, alongside S220, after S007/S207 real integration |

---

## S014 — Trial Balance API

| # | Field | Value |
|---|---|---|
| 1 | Story ID | S014 |
| 2 | Title | Trial Balance API |
| 3 | Parent Epic | **CE-03** (distinct from CE-01/CE-05 — third epic among the 9) |
| 4 | Parent Feature | Not separately named in registry |
| 5 | Release | R0, Sprint 3, Level L2, Priority P0 |
| 6 | Persona | "The reporting layer" (system/service persona, not a named human role) |
| 7 | Business problem | Every report above the ledger is only as trustworthy as the TB computation, and AMACC's period-balance table has no rebuild proof |
| 8 | User outcome | One provably-correct TB source that every screen/statement inherits |
| 9 | Primary workflow | Request TB slice (entity/store/dept, as-of period) → foots or returns structural-error payload |
| 10 | Alternate workflows | As-of a prior period matches that period's snapshot |
| 11 | Exception workflows | Empty entity returns a zeroed TB, **not an error** |
| 12 | UI screens/fields | **NO_UI_STORY** — feeds S222 |
| 13 | API endpoints/events | `GET /reports/trial-balance?entity&store&dept&asOf` → 200 foots, or 500 `{error:STRUCTURAL_IMBALANCE, drSum, crSum, delta}` (never silent). Nightly job emits `report.tb.variance {delta}` on projection-vs-raw mismatch (alert). Consumes `acct.je.posted` (projection updates) |
| 14 | Data entities/relationships | Reads `journal` + `balance_snapshot`; additive migrations only |
| 15 | Accounting rules/calculations | BR014-1 any slice foots (sum DR = sum CR) or returns structural-error payload, never silent; BR014-2 projection-vs-raw comparison job runs nightly with zero variance |
| 16 | Validation rules | BR014-3 source = ALL posted journals via S013 (report lineage rule) |
| 17 | Authorization permissions | `report.tb.view` |
| 18 | Tenant/entity/store/dept scope | Slice by `entityId, storeId?, deptCode?, asOfPeriod` |
| 19 | Audit events | None specific beyond package-wide convention (read/compute story) |
| 20 | Source requirement IDs | Classified **"Reuse After Validation"** — `/trial-balance` endpoint + `GLAccountPeriodBalance` exist, but **"REQUIRED runtime proof: drop, rebuild from journal, compare — unproven in AMACC"** |
| 21 | Acceptance criteria | (a) any slice foots or returns structural-error payload; (b) comparison job → zero variance; (c) as-of prior period matches that period's snapshot; (d) NEGATIVE: empty entity returns zeroed TB, not error |
| 22 | Definition of Ready | No open questions listed specifically for S014 (UQ-14 references S010/S210/S222, not S014 directly) |
| 23 | Definition of Done | Nightly zero-variance job green (`APPROVED_TARGET` — PO condition: rebuild-equivalence proof) |
| 24 | Dependencies | Feeds S222 and (transitively) S220/S227; uses AuditPort/AuthzPort stub contracts pending S007/S207 |
| 25 | Current repository implementation status | **NOT TRACKED** in `MODULE_STATE.json`/`STORY_CERTIFICATION_MATRIX.csv` (zero hits for `S014`) |
| 26 | Existing reusable code | Confirmed live: `trial-balance` route logic present in `services/gl-service/src/http/routes.ts` (and referenced in `group-service`, `fs-service`, `cashflow-service`, `eom-service`, `agent-gl`, `agent-t1`, `user-service`) — **but these services are not part of the currently-running certified live stack** (only auth-service, tenant-service, coa-service, api-gateway, audit-service are live); the rebuild-equivalence proof required by the packet has **not been run** in this repo |
| 27 | Known gaps | Rebuild-equivalence proof (drop `GLAccountPeriodBalance`, rebuild from journal, compare) is explicitly unproven and required before reuse; gl-service is prototype-only in the current stack, not yet certified/deployed alongside the certified 5-service stack |
| 28 | Proposed fleet lane | Must precede S222 (screen consumes this API); after S007/S207 real integration; requires gl-service to be brought into the certified live stack as part of implementation, not merely referenced |

---

## S222 — Trial Balance Screen & Export

| # | Field | Value |
|---|---|---|
| 1 | Story ID | S222 |
| 2 | Title | Trial Balance Screen & Export |
| 3 | Parent Epic | CE-05 |
| 4 | Parent Feature | Not separately named in registry |
| 5 | Release | R0, Sprint 3, Level L2, Priority P0 |
| 6 | Persona | Controller |
| 7 | Business problem | Release 0 must end in a report a controller recognizes — a TB that proves itself on screen |
| 8 | User outcome | Daily controller sanity-check with drill-through and export |
| 9 | Primary workflow | View on-screen TB (slice, as-of, zero-suppression, hierarchy subtotals) → export |
| 10 | Alternate workflows | Row click drills to S220 pre-filtered |
| 11 | Exception workflows | S014 structural error surfaces as a full-width banner, never a silently-unbalanced render |
| 12 | UI screens/fields | Report grid, subtotal rendering, export, error banner. Controls: `{entity, store?, dept?, asOfPeriod, zeroSuppression:bool}`. Columns: `{accountNumber, name, dr, cr}` + hierarchy subtotal rows (from S211). FIGMA_REQUIRED |
| 13 | API endpoints/events | Uses `GET /reports/trial-balance` (S014); `STRUCTURAL_IMBALANCE` → full-width error banner |
| 14 | Data entities/relationships | Reads S014 output only; no new writable entities |
| 15 | Accounting rules/calculations | BR222-1 TB foots or renders structural-error banner, never silently unbalanced |
| 16 | Validation rules | BR222-2 zero-suppression leaves totals unchanged; BR222-3 sources = all posted journals via S014 |
| 17 | Authorization permissions | `report.tb.view` |
| 18 | Tenant/entity/store/dept scope | Same slicing as S014: entity/store/dept/as-of |
| 19 | Audit events | Read-only screen; package-wide convention applies (no state-change event defined) |
| 20 | Source requirement IDs | Classified **"Reuse After Validation"** — `GLTrialBalance.tsx` exists (NADA format); "VERIFY foot-gate behavior — Cannot-Determine in crosswalk; format alignment pending **UQ-14**" |
| 21 | Acceptance criteria | (a) any slice foots or error banner; (b) row click → S220 pre-filtered; (c) suppression leaves totals unchanged; (d) NEGATIVE: S014 structural error → full-width banner |
| 22 | Definition of Ready | **UQ-14** open ("COA baseline: production vs NADA-90 vs BP 3.2 skeleton"; three conflicting baselines; interim PO-signed seed = BP 3.2 skeleton) — packet lists this as its open question, though UQ-14's own "BLOCKS" column targets **S010** final content, not S222 directly; S222 is listed only as "informed by" |
| 23 | Definition of Done | Foot-gate proven; drill E2E green (`APPROVED_TARGET` — PO condition) |
| 24 | Dependencies | Depends on S014 (data source), S211 (hierarchy subtotals), S220 (drill target); uses AuditPort/AuthzPort stub contracts |
| 25 | Current repository implementation status | **NOT TRACKED** in `MODULE_STATE.json`/`STORY_CERTIFICATION_MATRIX.csv` (zero hits for `S222`) |
| 26 | Existing reusable code | Confirmed live: `apps/web/src/pages/accounting/reports/GLTrialBalance.tsx` exists, matching packet's named reuse asset (NADA format) |
| 27 | Known gaps | Foot-gate behavior of the existing `GLTrialBalance.tsx` is explicitly "Cannot-Determine" pending verification; UQ-14 format-alignment session not yet held; Figma pending |
| 28 | Proposed fleet lane | Must sequence after S014, S211 (already certified DONE per prior foundation phase), and S220 |

---

## S227 — Basic Balance Sheet & Income Statement

| # | Field | Value |
|---|---|---|
| 1 | Story ID | S227 |
| 2 | Title | Basic Balance Sheet & Income Statement |
| 3 | Parent Epic | CE-05 |
| 4 | Parent Feature | Not separately named in registry |
| 5 | Release | R0, Sprint 3, Level L2, Priority P0 |
| 6 | Persona | Controller |
| 7 | Business problem | Dealers judge an accounting system by whether it produces financial statements; simple BS/IS must exist from month one |
| 8 | User outcome | Real, self-proving financial statements without waiting for factory (OEM) formats |
| 9 | Primary workflow | View BS (Assets/Liabilities/Equity incl. current-earnings line) and IS (Revenue/Expense/net income) rendered purely from account type + hierarchy |
| 10 | Alternate workflows | Drill from a statement line to S220 |
| 11 | Exception workflows | Unbalanced structural state renders an error, **never a forced-balanced statement** (no plugs) |
| 12 | UI screens/fields | Statement views, tie-out indicator, export. BS sections: `{Assets, Liabilities, Equity(+currentEarnings line)}`. IS: `{Revenue, Expense, netIncome}`. Tie-out indicator: IS net == BS current earnings. FIGMA_REQUIRED |
| 13 | API endpoints/events | `GET /reports/balance-sheet?entity&asOf` → 200 balanced or 500 `STRUCTURAL_IMBALANCE` (never force-balanced); `GET /reports/income-statement` → nets to BS current earnings (tie test) |
| 14 | Data entities/relationships | Reads S014 (TB) and S211 (hierarchy structure); no new writable entities |
| 15 | Accounting rules/calculations | BR227-1 BS balances (A = L + E incl. current earnings) or errors loudly; BR227-2 IS nets to the current-earnings line shown on BS (tie test) |
| 16 | Validation rules | BR227-3 drill to S220; BR227-4 sources: posted journals via S014, structure via S211 |
| 17 | Authorization permissions | `report.fs.view` |
| 18 | Tenant/entity/store/dept scope | Entity-scoped, as-of period |
| 19 | Audit events | Read-only screen; package-wide convention applies |
| 20 | Source requirement IDs | Classified **"Reuse After Validation"** — "endpoints + screens exist; REQUIRED: A=L+E invariant test and IS↔BS tie test" (both explicitly absent in AMACC today) |
| 21 | Acceptance criteria | (a) period-end BS balances or loud error; (b) IS ties to BS current earnings; (c) drill → S220; (d) NEGATIVE: unbalanced structural state renders error, never a forced-balanced statement |
| 22 | Definition of Ready | No open questions listed specifically for S227 |
| 23 | Definition of Done | A=L+E invariant + IS↔BS tie tests green (classified `REGULATORY_REQUIREMENT`) |
| 24 | Dependencies | Depends on S014 (TB) and S211 (hierarchy, already certified DONE); Sprint 3 placement |
| 25 | Current repository implementation status | **NOT TRACKED** in `MODULE_STATE.json`/`STORY_CERTIFICATION_MATRIX.csv` (zero hits for `S227`) |
| 26 | Existing reusable code | Confirmed via live grep: `balance-sheet`/`income-statement` route logic present in `services/gl-service/src/http/routes.ts` and `application/gl-service.ts` — same caveat as S014: gl-service is prototype-only, not part of the certified live stack |
| 27 | Known gaps | Neither the A=L+E invariant test nor the IS↔BS tie test has been proven to exist/pass in this repo; "force-balancing plugs" (explicitly prohibited) have not been ruled out in the existing gl-service code without inspection at implementation time |
| 28 | Proposed fleet lane | Last in the CE-05 reporting chain — depends on S014 and S211; after S007/S207 real integration |

---

## Cross-Story Consistency Check

| Check | Result |
|---|---|
| All 9 IDs exist in `canonical_registry.json` with matching epic/release/level to their build packet headers | **PASS** — no discrepancies found |
| Registry consistency validation (Class 1, `BACKLOG_VALIDATION_REPORT.md`) | **PASS (machine-proven)** — 159 total stories, 31 R0, traceability 132/132 mapped, no missing trace targets |
| Business/AC completeness validation (Class 2) | **IN PO REVIEW** (package-wide) — 22 UQs open, 6 DoR-blocking for *specific* stories (none of the 6 DoR-blocking UQs target these 9 stories directly; UQ-14/UQ-21 *inform* S222/S004A but are not listed as blocking them) |
| Legacy/SME validation (Class 3) | **PENDING** package-wide |
| Figma validation (Class 4) | **PENDING** — 7 of the 9 stories are `FIGMA_REQUIRED` (S202, S004A, S224, S220, S221, S222, S227); only S007 and S014 are `NO_UI_STORY` |
| Runtime implementation validation (Class 5) | **PENDING** — only S200 (already certified) has ever been implementation-audited; none of these 9 have been implemented |
| Repository status contradiction check (`MODULE_STATE.json` / `STORY_CERTIFICATION_MATRIX.csv`) | **No contradictions found.** All 9 stories are simply absent as tracked entries (clean NOT_STARTED baseline). S007 and S004A are mentioned only as *narrative dependencies* inside other stories' text, never as their own tracked/certified entries |
| Dependency resolution | S007 has zero blockers and must ship first. S224 requires REAL S007 (no stub). All others (S202, S004A, S220, S221, S014, S222, S227) may use AuditPort/AuthzPort **stub contracts** but are capped at `DONE_PENDING_INTEGRATION` until the real S007/S207 integration suite reruns green. S222/S227 further depend on S014; S222/S227 further depend on S211 (already certified DONE) |
| Governance/PO-release gate | **Every one of the 9 packets carries the identical header**: *"Status: PROPOSED — implement ONLY when this packet is individually RELEASED by the Product Owner."* **None of the 9 has been individually released.** This is a hard, explicit stop-condition independent of contract completeness |

