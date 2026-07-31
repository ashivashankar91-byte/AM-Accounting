# S023 — Current Event Payloads (AP / AR / Cash)

**Purpose:** ground D-S023-06 (source events + required fields) in what is actually emitted today, not what the workshop pack assumes. Read-only extraction from `r1-integration` HEAD; nothing here is a proposed contract.

**Headline finding:** none of the events below are shaped as the posting engine's `SourceEventEnvelope` (see `S023_EXISTING_ARCHITECTURE_MAP.md` §6). Two of the four "already-built" stories the workshop pack names (S039, S043A) don't emit a posting-relevant event *at all* — they post to GL by a direct synchronous HTTP call to gl-service, bypassing the event/outbox path and the S019/S020 engine entirely. A third (S052) emits an event that has zero consumers and never reaches GL. Building S023 against these will require new producer-side event contracts, not extraction of existing ones.

---

## S039 — Vendor Invoice Entry / 2-3-Way Match

**Merged:** yes (`2dfc7c7`).

Lifecycle-only outbox events (generic `outboxEvent(eventType, aggregateId, payload)` helper, `invoice-service.ts:440-443`, table `outboxEvent(tenantId, eventType, payload)`):

- `VENDOR_INVOICE_CREATED` — payload `{ vendorId, invoiceNumber }` (thin — `invoice-service.ts:285`)
- `VENDOR_INVOICE_UPDATED`
- `VENDOR_INVOICE_MATCH_RUN`
- `VENDOR_INVOICE_SUBMITTED`
- `VENDOR_INVOICE_VOIDED`
- `AP_INVOICE_APPROVAL_STARTED` (`invoice-approval-service.ts:127`)
- `AP_INVOICE_REJECTED` (`invoice-approval-service.ts:209`)

`CreateInvoiceDTO` (`invoice-service.ts:16-30`):
```ts
export interface CreateInvoiceDTO {
  tenantId: string;
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  poId?: string;
  freightAmount?: number;
  notes?: string;
  lines: InvoiceLineDTO[];
  override?: { reason: string };
}
```

**GL posting is not event-driven.** On final-tier approval, `invoice-approval-service.ts:_postApprovalLiability` (lines 223-287) makes a direct `fetch()` to `gl-service`'s `POST /api/v1/gl/journal-entries`:
```ts
// invoice-approval-service.ts:258-264
{
  entryDate: new Date().toISOString(),
  description: `AP invoice ${fullInvoice.invoiceNumber} approved — liability`,
  source: 'AP',                 // hardcoded literal — not the S212 numeric-code scheme
  sourceRef: fullInvoice.invoiceNumber.slice(0, 8),
  lines: [
    { glAccountId, debit: Number(line.lineTotal), credit: 0, memo: line.description, controlNumber: fullInvoice.invoiceNumber },
    // one line per invoice line
    { glAccountId: vendor.defaultGlAccount, debit: 0, credit: Number(fullInvoice.totalAmount), memo: `AP liability — invoice ${fullInvoice.invoiceNumber}`, controlNumber: fullInvoice.invoiceNumber },
  ],
}
```

- Idempotency: none via event/idempotency key — guarded only by an `invoice.approvalGlEntryId` presence check (`ALREADY_POSTED` domain error).
- Journal source stamped: literal string `'AP'` — not from the S212 `JournalSource` registry, not a numeric code.
- Target: `gl-service` directly (not `coa-service`'s posting engine, not RabbitMQ/outbox).

---

## S043A — Manual Single Payment

**Merged:** yes (`156b49f`).

Lifecycle events: `AP_MANUAL_PAYMENT_CREATED` (`manual-payment-service.ts:143`), `AP_MANUAL_PAYMENT_VOIDED` (`:178`).

`CreatePaymentDTO` (`manual-payment-service.ts:6-10`):
```ts
export interface CreatePaymentDTO {
  invoiceId: string;
  bankAccountId: string;
  paymentDate?: Date;
}
```
No `idempotencyKey` field — dedup relies on invoice state (`APPROVED` required before posting), not an explicit key.

GL posting: same direct-`fetch()`-to-`gl-service` pattern as S039 (`manual-payment-service.ts:182-220`):
```ts
// manual-payment-service.ts:194-206
{
  entryDate: new Date().toISOString(),
  description: `Manual payment — invoice ${invoice.invoiceNumber}`,
  source: 'AP',
  sourceRef: invoice.invoiceNumber.slice(0, 8),
  lines: [
    { glAccountId: vendor.defaultGlAccount, debit: Number(invoice.totalAmount), credit: 0, memo: `AP relief — invoice ${invoice.invoiceNumber}`, controlNumber: invoice.invoiceNumber },
    { glAccountId: bankAccount.glAccountId, debit: 0, credit: Number(invoice.totalAmount), memo: `Check payment — invoice ${invoice.invoiceNumber}` },
  ],
}
```
Journal source: `'AP'` literal, same as S039.

---

## S046 — Customer Master

**Merged:** yes (`91d4ec8` batch). **Emits zero posting-relevant events.**

All outbox events are pure master-data lifecycle (`customer-service.ts`): `CUSTOMER_CREATED` (:388), `CUSTOMER_UPDATED` (:457), `CUSTOMER_INACTIVATED` (:487), `CUSTOMER_REACTIVATED` (:514), `CUSTOMER_DELETED` (:550), `CUSTOMER_CREDIT_HOLD_SET` (:605), `CUSTOMER_CREDIT_HOLD_RELEASED` (:636). No invoice/charge event, no GL call anywhere in this service.

This matches the S046 integration commit's own disclosure: "statements/invoicing/receipts/cash application/write-offs/NSF explicitly out of scope (S047-S051)." **The workshop pack's D-S023-03 reference to "customer invoice/charge posting for the S046/S048 wave" describes work that does not exist yet** — S048 has no commit, branch, or file anywhere in this repository. Any AR rule-pack entries for "customer invoice/charge posting" would be defining rules for an event that has no producer today.

---

## S052 — Cash Receipts & Drawer Controls

**Merged:** yes (`b08693f`).

Event type: `cash.receipt.issued` (and `cash.receipt.voided`) — dot-namespaced, a third and different naming convention from AP's `SCREAMING_SNAKE_CASE`.

`CreateReceiptDTO` (`cash-receipt-service.ts:60-74`):
```ts
export interface CreateReceiptDTO {
  tenantId: string;
  entityId: string;
  drawerId: string;
  sourceDocType: string;
  sourceDocId: string;
  sourceDisplayNumber?: string | null;
  payerReference?: string | null;
  amountDue?: number | string | null;
  totalAmount: number | string;
  currency?: string | null;
  tenders: TenderInput[];
  idempotencyKey: string;
  actor: string;
}
```

- Idempotency: **explicit `idempotencyKey`**, enforced by a real DB unique constraint on `(tenantId, idempotencyKey)` (`tenantId_idempotencyKey` index, `cash-receipt-service.ts:111`) — a duplicate call returns the original receipt (`idempotent: true`) rather than erroring or double-posting. This is a materially stronger, and materially *different*, idempotency model than AP's (arbitrary caller-supplied string vs. the posting engine's `tenantId+eventId`).
- Publish/outbox: written to both an audit outbox (`auditOutboxEvent`, action `CASH_RECEIPT_ISSUED`) and a dedicated `cashOutboxEvent` table, then best-effort published (`cash-receipt-service.ts:190-208`) with payload `{ receiptId, receiptNumber, drawerId, totalAmount, sourceDocType, sourceDocId }`.
- **No GL/journal call exists anywhere in `cash-receipt-service.ts`, and no consumer of `cash.receipt.issued` exists anywhere in the repository.** Cash receipts do not post to GL today at all — the event is emitted into a void. Any S023 AR/Cash rule pack keyed on this event would be the **first** consumer ever built for it.

---

## S053 — Cash Deposit Posting

**NOT present on `r1-integration`.** Branch `r1-s053-cash-deposit-posting` (tip `f710ec5`) exists but is **not an ancestor** of `r1-integration` HEAD (`git merge-base --is-ancestor f710ec5 HEAD` is false). Its tip also predates the S019/S020 posting-engine work (missing the posting-engine test files that exist on `r1-integration`), consistent with it being a stale/abandoned branch rather than completed, unmerged work. No payload is reported — extracting one from this branch and presenting it as current would misrepresent unbuilt work as built.

---

## S054A — Not Present Anywhere

`git log --all --oneline | grep -i S054` and `git branch --all | grep -i s054` both return nothing across all local branches, tags, and remote refs. S054A does not exist in any form in this repository. This is consistent with the workshop pack's own D-S023-05, which characterizes S054A/B as unbuilt banking stories correctly excluded from S023 v1 scope.

---

## Summary table

| Story | Merged? | Event type(s) | Envelope-compatible? | Idempotency key | Posts to GL today? | Journal source stamped |
|---|---|---|---|---|---|---|
| S039 | Yes (`2dfc7c7`) | `VENDOR_INVOICE_*`, `AP_INVOICE_*` (generic outbox) | No | None (status-check only) | Yes — direct HTTP to gl-service, bypasses posting engine | `'AP'` literal |
| S043A | Yes (`156b49f`) | `AP_MANUAL_PAYMENT_*` | No | None | Yes — same direct-HTTP pattern | `'AP'` literal |
| S046 | Yes (`91d4ec8`) | `CUSTOMER_*` (master-data only) | N/A | N/A | No — no posting-relevant event exists | N/A |
| S052 | Yes (`b08693f`) | `cash.receipt.issued` / `.voided` | No | Explicit `idempotencyKey`, DB-unique | **No** — no GL call, no consumer at all | N/A |
| S053 | **No** — unmerged, stale | — | — | — | — | — |
| S054A | **No** — does not exist | — | — | — | — | — |
