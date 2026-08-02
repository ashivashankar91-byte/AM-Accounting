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

## PENDING_CE07_TECHNICAL_RECONCILIATION — rule-pack activation / event selection not entity-scoped

**Discovered live during this session's gap-closure certification, not
previously known.** `coa-service`'s `posting-engine-service.ts`:
- `activateVersion()` supersedes the previously-ACTIVE rule-pack version by
  `{tenantId, packKey, status:'ACTIVE'}` only — no `entityId` filter.
- `submitEvent()`'s candidate-selection query for matching an incoming
  event to a rule pack is similarly entity-blind:
  `{tenantId, eventType, status:'ACTIVE', effectiveFrom<=...}` — again no
  `entityId` filter, picking whichever ACTIVE version has the latest
  `effectiveFrom` tenant-wide, regardless of which entity it was authored
  for.

**Reproduced live**: activating a rule-pack version scoped to a scratch
legal entity (for a missing-mapping rejection proof) silently superseded
the real production entity's ACTIVE version for the same `packKey`,
breaking real posting for that entity tenant-wide until a new version was
re-activated for the correct entity. Full reproduction and remediation
steps: `/tmp/ce11-cert-logs/certification-group-a.md` (session-local
certification evidence).

**Not fixed from this branch** per explicit instruction — this is CE-07's
call to make. **The final CE-07 implementation must make both
`activateVersion()`'s supersede query and `submitEvent()`'s candidate query
tenant-AND-legal-entity scoped** (or `packKey` must be entity-qualified at
the schema level so no two entities can ever collide on the same key).

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

`apps/web/src/pages/accounting/fixedops/InsuranceReceivableInquiry.tsx`
is a real, wired, consume-only surface for CE-09's S049 body-shop
insurance-claim items — it never redefines insurance-claim accounting.
Repository-wide search confirms no CE-09 S049 implementation exists in
this baseline; the screen renders an honest, explicit unavailable banner
rather than fabricating or estimating claim data. Will populate the
moment CE-09's S049 API lands — no CE-11-side change required then beyond
removing the banner.

## Confirmation

No CE-11-owned code modifies, works around silently, or duplicates any of
the above upstream surfaces. Every item above is either (a) a real,
already-implemented interim projection explicitly marked for removal once
the upstream contract lands, or (b) a real, honest "not yet available"
consume-only surface. None was invented or expanded in scope for this
gap-closure pass — the rule-pack entity-scoping item is a new *finding*,
not a new *workaround*; CE-11 does not touch coa-service source to fix it.
