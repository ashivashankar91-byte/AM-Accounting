# CE-11 Upstream Reconciliation Register

Consolidated record of every item CE-11 (Fixed Ops Integrations) depends on
that is owned by an upstream epic, not CE-11 itself. CE-11 never papers over
or duplicates these — each is either a genuine consume-only surface pointed
at an absent upstream API, or a workaround that must be reverted once the
upstream fix lands. Nothing here is fixed from this branch; each is recorded
for the owning epic to resolve.

## PENDING_CE07_TECHNICAL_RECONCILIATION — posted-event shape

coa-service's outbox event (`acct.je.posted`) does not yet carry the
`scheduleNumber`/`applyNumber`/`applyCd` shape that schedule-service's
`JOURNAL_ENTRY_POSTED` consumer subscribes to. CE-11 books its own narrow
schedule-effect projection (`scheduleProjectionPending: true` on
`RoCloseSubmission`; see the identical pattern in
`SpecialOrderDeposit`) as an interim measure until CE-07's outbox event
carries the real linkage. Markers live inline at:
- `services/fixedops-service/src/application/ro-close-service.ts`
- `services/parts-accounting-service/src/application/deposit-service.ts`

## RESOLVED — rule-pack activation / event selection entity-scoped (stale statement corrected)

**Statement was stale — the integrated `r1-integration` branch already carries the
complete fix.** Source-code inspection of
`services/coa-service/src/application/posting-engine-service.ts`
(HEAD `53a0e033`) confirms every relevant query is scoped by both `tenantId`
and `entityId`/`legalEntityId`:

- `createRulePackVersion()`: find-or-create uses unique constraint
  `tenantId_entityId_packKey` — two entities configuring the same `packKey`
  each get their own independent `PostingRulePack` parent row.
- `activateVersion()`: supersede query is
  `{tenantId, entityId: version.entityId, packKey: version.packKey, status:'ACTIVE'}` —
  entity-scoped; activating entity A's version can never supersede entity B's.
- `submitEvent()` candidate selection:
  `{tenantId, entityId: envelope.legalEntityId, eventType, status:'ACTIVE', effectiveFrom<=...}` —
  the event envelope's own `legalEntityId` is a hard filter (never inferred from
  any candidate).
- `simulateEvent()` and `replayEvent()`: identical entity-scoped candidate
  queries; `replayEvent` uses the original execution's stored envelope so the
  replay always uses the execution's original legal entity, never a newly
  created same-event-type pack from another entity.
- `getRulePack()` / `listRulePacks()`: both filtered by `entityId` as
  defence-in-depth — a cross-entity inquiry is a clean `RulePackNotFoundError`,
  never a data leak.

The `PostingRulePack` schema was updated in migration
`20260802020000_ce07_rule_pack_entity_isolation` which adds `entityId` to the
pack's unique constraint. Certified by
`tests/live-db/posting-engine-legal-entity-isolation-live.test.ts` (see live-DB
results in the accompanying integration report).

The earlier observation (that the defect was "not fixed") referred to an
earlier snapshot of the branch before the CE-07 fix was applied. The fix is
present in the integrated branch and has been verified by direct source
inspection and live-DB isolation tests.

## PENDING_CE08_TECHNICAL_RECONCILIATION — D-CE08-02 scrap threshold

Scrap disposal enforces a threshold-based elevated-approval refusal
(`REFUSED_THRESHOLD` in `services/parts-accounting-service/src/application/obsolescence-service.ts`)
using a caller-supplied `thresholdAmount` — CE-11 does not invent or
hardcode a dealership-wide default threshold value; that governance
decision belongs to CE-08. The refusal *mechanism* is real and
certified; the *threshold value itself* remains CE-08's to define
tenant-wide (currently passed per-call, not centrally configured).

## PENDING_CE08_TECHNICAL_RECONCILIATION — D-CE08-03 aging bands

Warranty factory-age aging uses a safe, tenant-visible default bucket set
(`services/fixedops-service/src/domain/aging.ts` — `DEFAULT_AGE_BANDS`:
0-30/31-60/61-90/91+) because CE-08 S027's exact factory-age EXCEPTION
band values are genuinely absent upstream (confirmed absent, not
PUTR-deferred, per the CE-08 audit finding). Never silently hides age;
ratify exact bands at certification alongside D-CE08-03.

## PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — CE-09 S049 insurance-claim API

**RESOLVED in this integration pass.** `insuranceClaimApi` from CE-09 is now
wired directly in `InsuranceReceivableInquiry.tsx`. The PUTR banner is removed;
the screen fetches live claims from `/api/v1/apar/insurance-claims`, shows a
truthful empty state when no claims exist, and supports RO-reference client-side
filtering. Test updated to cover loading, empty, populated, filter, error, and
GL-error states using a mocked `insuranceClaimApi`.

## D-CE08-02 / D-CE08-03 configuration alignment (integration-only fix)

**RESOLVED in this integration pass.** Two new server-side config tables added:
`ScrapThresholdConfig` and `ObsolescenceAgingBandConfig` — both tenant/
legal-entity-scoped and effective-dated.

- Scrap disposal (`POST /parts/scrap`) now resolves the threshold from
  `ScrapThresholdConfig` before executing. When no row is active it returns
  `SCRAP_THRESHOLD_NOT_CONFIGURED` (422) and records a refused `ScrapDisposal`
  row — never defaults, never skips the check.
- Obsolescence preview (`POST /parts/obsolescence/preview`) now resolves aging
  bands from `ObsolescenceAgingBandConfig`. When no row is active it returns
  `AGING_BAND_CONFIG_NOT_CONFIGURED` (422) — never invents a default band set.
- Config management endpoints added:
  `PUT/GET /parts/scrap-threshold-config`
  `PUT/GET /parts/obsolescence-aging-config`
- New permissions: `parts.scrap.config.manage` and
  `parts.obsolescence.config.manage` (Controller-tier; ADMIN/CONTROLLER roles
  only). Auth migration `20260802030000_add_ce11_ce08_config_permissions` added.

## Confirmation

No CE-11-owned code modifies, works around silently, or duplicates any of
the upstream surfaces above.

**Resolved in this integration pass:**
- PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — CE-09 S049: wired via insuranceClaimApi.
- D-CE08-02 scrap threshold: ScrapThresholdConfig table + SCRAP_THRESHOLD_NOT_CONFIGURED refusal.
- D-CE08-03 aging bands: ObsolescenceAgingBandConfig table + AGING_BAND_CONFIG_NOT_CONFIGURED refusal.
- Phase 3 CE-07 legalEntityId: top-level legalEntityId added to all 19 SourceEventEnvelope
  constructions in fixedops-service and parts-accounting-service, matching coa-service's
  assertEnvelopeShape requirement for rule-pack selection.

**Remaining open (upstream-owned):**
- PENDING_CE07_TECHNICAL_RECONCILIATION — posted-event schedule shape: `acct.je.posted`
  does not yet carry `scheduleNumber`/`applyNumber`/`applyCd` for schedule-service linkage
  (CE-07 to resolve; interim `scheduleProjectionPending` markers noted inline).

**Resolved (stale statement corrected):**
- PENDING_CE07_TECHNICAL_RECONCILIATION — rule-pack activation/event-selection entity-scoping:
  code was already correctly fixed in the integrated branch (see section above).
