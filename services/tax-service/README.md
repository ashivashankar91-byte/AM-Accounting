# tax-service (CE-10 — S124 Certified Tax Engine Adapter / S125 Regulatory Fee Tables)

## Ownership boundaries

See `docs/accounting-modernization/CE10_FABLE_EPIC_PACKAGE.md` for the
authoritative package. In short:

- **Tax calculation** is owned by the external/configured tax engine behind
  the S124 adapter. This service computes **no tax law**: no rates, no
  nexus, no taxability rules in code.
- **Tax/fee account mapping** ("which GL account does this post to") is
  owned by Accounting's S023 governed matrix, elsewhere. This service only
  exposes an opaque `TaxAccountMappingRef` lookup
  (`ACCOUNT_MAPPING_VALUES_PENDING` or a resolved-but-opaque reference) —
  it never stores or returns a real GL account number.
- **Posting** is owned by CE-07. tax/fee lines travel inside the source
  transaction's envelope; the posting engine posts one balanced journal.
  **tax-service has ZERO direct GL writes** — no code path in this service
  calls gl-service or any posting endpoint. See
  `tests/zero-gl-writes.test.ts` for the static proof.
- **Consumption** is owned by CE-09/CE-11(/CE-12): those transactions
  *request* tax via `POST /api/v1/tax/calculate`; this service answers or
  blocks — it never posts on their behalf.

## Vendor certification status

**No production tax vendor is certified by this package.** Three engine
implementations exist:

1. `NullEngine` — the truthful default. Always returns `NOT_CONFIGURED`.
2. `TestFixtureEngine` — deterministic, labeled fixtures for certification
   only. Refuses to run for any tenant that is not the labeled
   `TEST-TENANT-CE10-CERTIFICATION-ONLY` fixture tenant.
3. **Real vendor(s)** — a documented extension point only. Implementing
   `TaxEngineAdapter` (`src/domain/tax-adapter-contract.ts`) against a
   selected, certified vendor is the only change required to convert a
   `NullEngine` tenant to production tax calculation, once vendor
   selection + sandbox credentials + per-jurisdiction certification
   evidence are available (see `src/domain/engines/engine-registry.ts`).
   **No such implementation ships in this package.**

## Safety principle

When an authoritative tax result is unavailable, this service **blocks the
transaction or routes it to an explicit exception state**. It never
silently estimates tax, reuses a stale rate, or posts tax-less-than-
requested. See `src/domain/exception-lifecycle.ts` and
`src/application/tax-calculation-service.ts`.

## Reconciliation — PENDING_UPSTREAM_TECHNICAL_RECONCILIATION

CE-07's posting engine is a separate, not-yet-finalized service/worktree.
`src/application/reconciliation-service.ts` is built against an injectable
`PostedTaxLineSource` interface so the three-way-tie (engine Σ / posted Σ /
GL movement) reconciliation logic is fully testable now, with the real
wiring to CE-07's posted-tax-line data completed later without a contract
change. Every reconciliation API response carries a
`glMovementSourceIsPending: true` flag until that wiring lands, so the UI
renders honestly.

## Running

```bash
npm install
npm run build --workspace=@amacc/tax-service
npx vitest run --root services/tax-service
```

Migrations (additive-only, folder-per-migration Prisma format):

```bash
cd services/tax-service
npx prisma migrate deploy
```
