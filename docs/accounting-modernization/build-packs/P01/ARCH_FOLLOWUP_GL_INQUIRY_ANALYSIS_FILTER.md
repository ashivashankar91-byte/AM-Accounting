# Architecture Follow-Up — GL Inquiry Analysis-Code Filter

**Status:** OPEN — architecture decision required before implementation
**Origin:** S011 P1-F2 (2026-07-29), formally deferred out of R1 S011 scope by
Product decision (2026-07-29)
**Owner:** Unassigned — requires a joint Product/Engineering decision on
service ownership before any implementation work begins
**Related stories:** S011 (Analysis Codes / Dimensions, coa-service), S220 /
S221 / S222 / S227 (GL Inquiry family, gl-service — see
`P01_REPOSITORY_VERIFICATION_RECONCILIATION.md`)

---

## 1. Problem Statement

coa-service already supports `analysisValueId` filtering on
`GET /inquiry/accounts/:id/activity` (proven live in S011). However, the
real, user-facing "GL Inquiry" screens that dealership users actually
navigate to and search from —

- `apps/web/src/pages/accounting/GLInquiry.tsx` (route `/accounting/inquiry/gl`)
- `apps/web/src/pages/GLAccountInquiry.tsx` (route `/gl/accounts/:code/inquiry`)

— are both routed by the API gateway (`services/api-gateway/src/index.ts`,
`SERVICES` table, `/api/v1/gl` prefix) to **gl-service**, a separate
microservice with its own database. gl-service's schema and source contain
**zero** `AnalysisCode` / `analysisTag` concept. coa-service's only inquiry
capability is consumed exclusively as a drill-through modal inside
`apps/web/src/pages/goldenpath/TrialBalance.tsx`, not as a standalone,
searchable screen.

There is therefore no safe way today to let a user filter the real GL
Inquiry screen by analysis code without one of:

1. An **unsupported synchronous cross-service join** at query time
   (gl-service calling coa-service, or vice versa, per inquiry row) — high
   latency risk, no defined contract, and couples two services' request
   paths together.
2. A **second, duplicate GL Inquiry implementation** built directly against
   coa-service's drill-through endpoint — explicitly prohibited (creates two
   inconsistent "GL Inquiry" experiences and duplicates gl-service's existing
   filtering/paging/permission logic).
3. **Copying analysis-tag metadata into gl-service without a defined
   ownership/reconciliation contract** — creates silent data drift the
   moment a tag is added, retagged, or an analysis-code value is deactivated
   in coa-service after gl-service's copy was taken.

All three are explicitly out of scope for this follow-up to implement blind;
this document exists so a deliberate decision can be made instead.

## 2. Decision Required

**Which service is the system of record for "give me GL Inquiry rows
filtered by analysis code", and by what mechanism does the other service's
data reach it?**

Candidate options (not a recommendation — for Product/Engineering to weigh):

- **Option A — Event-driven read model in gl-service.** coa-service publishes
  analysis-tag lifecycle events (tag applied/removed on a posted journal
  line, analysis-code value deactivated) to the existing outbox/event bus;
  gl-service consumes them into a local, gl-service-owned projection table
  (e.g. `gl_line_analysis_tag`) keyed by the same journal-line identifiers
  gl-service already ingests from coa-service's posting pipeline. GL Inquiry
  filters against its own local projection — no synchronous cross-service
  call at query time.
- **Option B — Promote coa-service's inquiry endpoint to a first-class,
  standalone GL Inquiry screen**, and treat the current gl-service-owned
  `GLInquiry.tsx` as legacy/to-be-retired for entities using coa-service as
  system of record. Requires a decision on which "GL Inquiry" is canonical
  going forward, and a migration/deprecation plan for the other.
- **Option C — Federated query at the API gateway layer** (gateway fans out
  to both services and merges results). Simpler to reason about than a
  cross-service join inside either service, but introduces gateway-level
  complexity, latency, and partial-failure handling that does not exist
  today.

## 3. Scope of the Follow-Up Decision and Implementation

Whichever option is chosen, the follow-up work must define and implement:

- **Metadata ownership** — which service is authoritative for
  analysis-code type/value definitions (today: coa-service) versus which
  service is authoritative for a given journal line's tag assignment once
  posted (today: coa-service; gl-service has no copy).
- **Event/projection contract** — if an event-driven model is chosen
  (Option A), the exact event schema, delivery guarantees (at-least-once vs.
  exactly-once), ordering requirements, and idempotency key for gl-service's
  projection to consume coa-service's analysis-tag lifecycle events.
- **gl-service read model** — the concrete schema addition to gl-service
  (if any), including whether it stores denormalized tag codes/names or
  only IDs (requiring a lookup back to coa-service for display), and how
  the projection handles a tag's underlying analysis-code value being
  deactivated after the fact (does the historical gl-service row still show
  the (now-inactive) tag it had at posting time, or is it hidden?).
- **Backfill and reconciliation** — how existing (pre-S011 and
  already-posted) journal lines' tags, if any, get backfilled into
  gl-service's read model, and what reconciliation job (if any) detects and
  heals drift between coa-service's source-of-truth tags and gl-service's
  projection.
- **Tenant isolation** — the projection/join mechanism must preserve the
  same tenant-scoping and RLS guarantees both services already enforce
  independently; a cross-service data path must not become a new
  cross-tenant leak vector.
- **Filter API** — the exact request/response contract the real GL Inquiry
  screen's frontend control will call (whether that remains
  `GET /api/v1/gl/...` with a new `analysisValueId` parameter served from
  gl-service's own projection, or something else per the chosen option).
- **Canonical route ownership** — a single, explicit decision on which
  route(s) are "the" GL Inquiry screen going forward, recorded in
  `P01_SCREEN_INVENTORY.csv` and `P01_TRACEABILITY.csv`, so this ambiguity
  does not recur for a future story.
- **End-to-end acceptance tests** — live-database and Playwright coverage
  proving the chosen mechanism works across the real tenant-isolation
  boundary, including a negative case for a deactivated analysis-code value
  and a cross-tenant isolation case, mirroring the rigor already established
  for S011's coa-service-side filtering.

## 4. Explicitly Not Authorized by This Document

This document is a problem statement and decision framework only. It does
**not** authorize:

- Any of the three rejected approaches in Section 1 (synchronous
  cross-service join, duplicate GL Inquiry screen, or unreconciled metadata
  copy).
- Any production code change. No implementation should begin until the
  Section 2 decision is made and a follow-up story/build-pack is chartered
  for it.

## 5. Current Disposition

Per Product decision (2026-07-29), the user-facing GL Inquiry analysis-code
filter is **formally deferred out of R1 S011 scope** — it is not a residual
defect of S011, but a separate, cross-story architecture decision. S011
itself is considered complete for its revised, accepted scope (see
`S011_CERTIFICATION_EVIDENCE.md` Section 16 and `MODULE_STATE.json`).

## 6. References

- `services/api-gateway/src/index.ts` (`SERVICES` routing table — evidence
  for the `/api/v1/gl` → gl-service, `/api/v1/coa` → coa-service boundary).
- `docs/accounting-modernization/build-packs/P01/P01_REPOSITORY_VERIFICATION_RECONCILIATION.md`
  (documents Golden R0's S220/S221/S222/S227 already running on gl-service).
- `apps/web/src/pages/accounting/GLInquiry.tsx`,
  `apps/web/src/pages/GLAccountInquiry.tsx` (the real, gl-service-backed GL
  Inquiry screens).
- `apps/web/src/pages/goldenpath/TrialBalance.tsx` (only consumer of
  coa-service's `GET /inquiry/accounts/:id/activity` drill-through).
- `docs/accounting-modernization/build-packs/P01/S011_CERTIFICATION_EVIDENCE.md`
  Section 16.2 (original P1-F2 investigation and escalation).
