# Extraction: schedinvk.cbl

**Decision: SKIP / REPLACED** — Vehicle lookup is out-of-scope for schedule-service. Data already available via vehicle-service or included in journal event payload.

---

## Source

`acct/src/schedinvk.cbl` — 6,606 bytes

---

## Summary

`schedinvk` makes an HTTP "invoker" call from COBOL to the AMPS web tier at `/accounting/api/{co}/vehc/stock/{stocknum}` to retrieve vehicle information for a given stock number. It is NOT a schedule-posting program — it is a pure vehicle data lookup used by schedule-print and other programs that need to display a vehicle description alongside schedule detail lines.

---

## Interface (COBOL)

```cobol
CALL "../../acct/prog/schedinvk"
  USING LINK-RECORD
        SCHEDINVK-LINK-AREA
```

**Input (`SCHEDINVK-SND-STOCKNUM`):** PIC X(10) — the stock number to look up.

**Output fields returned:**
| Field | Type | Description |
|-------|------|-------------|
| `SCHEDINVK-RCV-VIN` | PIC X(17) | Full VIN |
| `SCHEDINVK-RCV-YEAR` | PIC X(4) | Vehicle year |
| `SCHEDINVK-RCV-MAKE` | PIC X(10) | Vehicle make |
| `SCHEDINVK-RCV-MODEL` | PIC X(10) | Vehicle model |
| `SCHEDINVK-RCV-STATUS` | PIC X(1) | Inventory status code |

---

## Why SKIP

1. This is a **vehicle data lookup**, not a schedule accounting operation.
2. In TypeScript, vehicle data is owned by **vehicle-service**, not schedule-service.
3. The schedule report endpoint (`GET /api/v1/schedules/:id/report`) that needs vehicle descriptions will call vehicle-service directly via HTTP if needed.
4. For EOM reports, vehicle metadata may be included in the `JOURNAL_ENTRY_POSTED` event payload (stock number, VIN) so schedule-service never needs to call vehicle-service synchronously.

---

## TypeScript Replacement Pattern

```typescript
// In report generation — if controlNumber is a stock number and schedule
// requires vehicle display (SD-CONT-NAMES = 'V' or 'S'), call vehicle-service:
const vehicleInfo = await vehicleServiceClient.getByStockNumber(stockNumber);
```

This call is out of scope for Wave 3. The `GET /api/v1/schedules/:id/report` endpoint will return `vehicleDescription: null` initially and be wired to vehicle-service in a follow-on wave.

---

## Traceability

- **COBOL program**: `acct/src/schedinvk.cbl`
- **Decision**: Not implemented in schedule-service
- **Future**: vehicle-service HTTP integration (separate wave)
