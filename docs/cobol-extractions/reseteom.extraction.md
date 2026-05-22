# COBOL Extraction: reseteom.cbl

**Extracted:** 2025  
**Extracted By:** GitHub Copilot (Wave 2 — COPILOT.md protocol)  
**Status:** Complete

---

## 1. Source

| Field | Value |
|-------|-------|
| File | `acct/src/reseteom.cbl` |
| PROGRAM-ID | `RESETEOM` |
| Purpose | CLI utility to manually reset ACSYS-TRACK-EOM to 0 after a failed close |
| Called By | Command line only (never called by another COBOL program) |
| Lines | ~80 |
| Parameter | Company number (from command line argument) |

---

## 2. Purpose

Emergency recovery tool. When `purge.cbl` fails mid-close and leaves `ACSYS-TRACK-EOM` set to a non-zero value, `reseteom.cbl`:
1. Reads the system ISAM file for the given company
2. Sets `ACSYS-TRACK-EOM = 0`
3. Rewrites the system record
4. Calls the invoker to sync: `GET /acct/sync?table=SYSTEM`

Used exclusively by Auto/Mate support staff to unblock a stuck EOM.

**Safe usage:** Only if TRACK < 100. If TRACK ≥ 100, the schedule detail or GL file may have been partially purged, and resetting alone is insufficient — manual file restoration is also needed.

---

## 3. Business Logic

Single-purpose: reset one field. No validation beyond a company number check.

---

## 4. Decision: SKIP — Replaced by Admin Endpoint

In the TypeScript rewrite, the equivalent is:

```
POST /api/v1/eom/closes/:id/reset
```

Authorization: requires `OPERATOR` role (not available to regular users).  
Action: sets `EOMClose.status = BLOCKED` with `blockedReason` cleared, allowing `retry-step` to proceed from the last completed step.

This is safer than the COBOL equivalent because:
- It only resets the close record — does not blindly clear all state
- It requires authentication and authorization (COBOL reseteom accepted any operator with shell access)
- It logs who reset the close and when (`resetBy`, `resetAt` audit fields)
- It only allows reset for steps < 100 (steps ≥ 100 require a different recovery path)

---

## 5. Traceability

- `@cobol-ancestry` reseteom.cbl / RESETEOM
- `@removes-need-for` reseteom.cbl (replaced by `POST /:id/reset` admin endpoint)
- `@intelligence-additions` Role-based auth (COBOL was shell access only), audit trail, safe reset only for steps < 100
