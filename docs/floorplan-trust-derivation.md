# Floorplan Trust Position — Derivation, for Accounting SME Sign-Off

**Status: NEEDS SME REVIEW. Nothing below has been confirmed by an accounting SME. Do not treat this exception as production-ready until it has been signed off.**

This document explains, in plain language, exactly how the Command Center's
"Floorplan Trust Position" exception tile decides a unit is **out of trust**
(sold/delivered while a lender's floorplan payable against it is still open —
a covenant and potential legal event). It documents the logic as it exists
today; it does not change it.

## What "sold" means here

The tile treats a unit as sold when `vehicle_status = 'SOLD'` on the
`FloorPlanUnit` record in gl-service.

**Why this field and not another:** it is the only status-like field on this
record that distinguishes "sold" from other states. There is no dedicated
"sale date" or "delivery date" column on this table.

**Important limitation found while writing this document:** `vehicle_status`
is set once, optionally, when the unit is registered onto the floorplan line
(`POST /floor-plan/units`). There is **no update endpoint** in gl-service
that transitions `vehicle_status` to `SOLD` when a vehicle is actually sold
in the showroom. The only other write path that touches this record post
-registration is the payoff endpoint (`POST /floor-plan/payoff/:unitId`),
which sets `status = 'PAID_OFF'` and `payoffDate`, but does **not** touch
`vehicle_status`. One other reference in the codebase
(`apar-service/src/http/routes.ts`, vehicle-PO blocking check) treats
`vehicle_status = SOLD` as a stubbed, not-yet-real integration.

**Practical consequence:** as the system exists today, nothing in the normal
sales workflow flips a unit to `vehicle_status = SOLD`. This exception can
only fire for units where `vehicle_status` was set to `SOLD` directly
(e.g., manually, via a future integration, or via a seed/test fixture). This
is a **false-negative risk of the whole tile, not just an edge case** — real
sold units may simply never appear here until a real system (Sales/F&I/DMS)
is wired to update this field. This must be resolved (or at minimum
explicitly acknowledged and monitored) before this tile is relied on as a
covenant-compliance control.

## What "still on floorplan" means

A unit is treated as still on an open floorplan payable when
`payoff_date IS NULL`. `payoff_date` is set only by the payoff endpoint,
which zeroes the balance and marks `status = 'PAID_OFF'` at the same time.
There is no partial-payoff or curtailment-only state that clears
`payoff_date` early — a curtailment payment reduces `currentBalance` but
does not set `payoffDate`, which is correct: a partially-curtailed unit is
still open on the line.

## The exception condition, exactly

```
out_of_trust = vehicle_status === 'SOLD' && payoff_date == null
```

Both conditions are required. A unit missing `vehicle_status` entirely
(`undefined`/`null`, which is legal — the field is optional at registration)
is **not** flagged, because the filter is a strict equality check against
`'SOLD'`, not a "not IN_STOCK" check.

## Full set of `vehicle_status` values observed

From the zod schema on `POST /floor-plan/units`
(`services/gl-service/src/http/floor-plan-routes.ts`), the only values the
system accepts are:

- `IN_STOCK`
- `SOLD`
- `IN_TRANSIT`
- `HOLD`

There is no `WHOLESALE`, `DEALER_TRADE`, `DEMO`, or `LOANER` value in this
enum. Those concepts exist only on the separate `vehicle_condition` field
(`NEW`, `USED`, `DEMO`, `CPO`), which is unrelated to trust-position logic
and is not consulted by this exception at all.

## Null / edge-case handling, stated explicitly

- **Null `vehicle_status`:** treated as not-sold (excluded from the
  exception, silently). This is the single largest unknown — an SME must
  confirm whether a null status should ever be treated as "assume sold" for
  safety (favoring false positives over false negatives) rather than
  "assume not sold" as it does today.
- **Null `payoff_date` with `vehicle_status = null` or `IN_STOCK`:** correctly
  excluded — a unit still in stock and never sold is not out of trust.
- **`vehicle_status = 'HOLD'` or `'IN_TRANSIT'`:** never flagged regardless of
  `payoff_date`, even though a unit "on hold" could plausibly represent a
  pending deal close. Not currently treated as any form of exception or
  warning.
- **Wholesale units:** there is no field distinguishing a wholesale
  disposition from a retail sale. If a wholesale unit is ever marked
  `vehicle_status = 'SOLD'` (again, no workflow currently does this), it
  would be flagged identically to a retail sale. Whether wholesale
  dispositions should be excluded, and how they'd be identified, is an open
  question for the SME.
- **Dealer trades:** same gap as wholesale — no distinguishing field exists.
- **Demo/loaner units:** distinguished only by `vehicle_condition = 'DEMO'`,
  which this exception does not read. A demo unit taken out of rotation and
  later sold would be treated the same as any other sold unit; a demo unit
  that is simply reclassified without a sale is unaffected either way since
  nothing here reads `vehicle_condition`.

## Known false-positive and false-negative risks

**False negative (the more dangerous direction for a covenant issue):**
Because nothing in the current system flips `vehicle_status` to `SOLD` as
part of the actual sales workflow (see above), the tile will under-report —
potentially reporting **zero** out-of-trust units even when real units have
been sold and delivered while still floored. This is the primary risk that
must be closed before this tile can be trusted operationally.

**False positive:** If a future integration sets `vehicle_status = SOLD`
optimistically (e.g., at deal write-up rather than at delivery/funding), a
unit could be flagged before it is genuinely out of trust. The exception
does not distinguish "sold on paper" from "delivered to customer."
`floor_date` (when the unit went onto the floorplan line) is used as the
tile's "oldest age" figure for lack of a better date — it is genuinely "days
on floorplan," not "days since sale," and is labeled that way in the code
comment, but a reader skimming the tile could still misread it as urgency
since the sale date.

## What this document does not do

It does not change the exception logic, does not add a `vehicle_status`
update path, and does not recommend which fix (writing `vehicle_status` from
a real sales event, adding a dedicated `soldDate` column, excluding
wholesale/dealer-trade dispositions, etc.) to pursue. Those are accounting
and product decisions for the SME and Product Owner, not engineering
assumptions.

---

**Sign-off**

| Role | Name | Date | Approved variant / notes |
|---|---|---|---|
| Accounting SME | | | |
| Product Owner (Shiva) | | | |
