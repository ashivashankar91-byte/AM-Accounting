# COBOL Extraction: eomsync.cbl

**Extracted:** 2025  
**Extracted By:** GitHub Copilot (Wave 2 — COPILOT.md protocol)  
**Status:** Complete

---

## 1. Source

| Field | Value |
|-------|-------|
| File | `acct/src/eomsync.cbl` |
| PROGRAM-ID | `EOMSYNC` |
| Purpose | HTTP sync trigger at end of EOM close |
| Called By | `purge.cbl` (EOJ) |
| Lines | ~100 |

---

## 2. Purpose

A minimal utility called by `purge.cbl` after the month-end close is complete. Makes a single HTTP call via the `invoker` CLI tool:

```
GET /accounting/api/{company}/acct/monthend
```

This HTTP call (to the Java backend) performs three things:
1. Syncs the `ACSYS-LSTCLOS-DATE` from ISAM to the relational database
2. Posts any standard journal entries configured to auto-post at month-end
3. Initiates a GL sync in the Java system

---

## 3. Business Logic

Minimal: no transformation, no data validation. It is a fire-and-forget HTTP trigger. Any errors are logged but do not abort the close (the close was already committed before this program is called).

---

## 4. Decision: SKIP — Replaced by Outbox Events

In the TypeScript rewrite:
- The last-close-date sync is done atomically inside the `EOMClose.complete()` transaction (no separate HTTP call needed)
- Standard journal entries that auto-post at month-end are processed by the `scheduled-entries` processor, triggered by the `MONTH_END_COMPLETED` outbox event
- The GL sync is handled by the `gl-service` which subscribes to `MONTH_END_COMPLETED`

The outbox pattern ensures reliability that the synchronous invoker call could not provide: if the eomsync HTTP call failed in COBOL, the close had already been committed to ISAM and the database was out of sync permanently. The outbox guarantees eventual consistency.

---

## 5. Traceability

- `@cobol-ancestry` eomsync.cbl / EOMSYNC
- `@removes-need-for` eomsync.cbl (replaced by `MONTH_END_COMPLETED` outbox event + `scheduled-entries` processor)
- `@intelligence-additions` Reliable delivery via outbox vs. fire-and-forget HTTP; retry on failure
