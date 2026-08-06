# Accounting Modernization — All-159 Stories Completion Plan

**Program Branch:** `accounting-all-159-integration`  
**Baseline SHA:** `a4e9ae5f`  
**Baseline Branch:** `r1-final-certification`  
**Date:** 2026-08-04  
**Author:** Copilot — authorized program commencement

---

## Current Truth (as of baseline)

| Status | Count |
|--------|-------|
| CERTIFIED | 45 |
| BLOCKED_WITH_EXACT_GAP | 2 |
| PACKAGE_AUTHORIZED_DEFERRED | 112 |
| **TOTAL** | **159** |

> The user brief states "47 CERTIFIED, 112 DEFERRED, 0 BLOCKED."  
> The canonical matrix shows 45 CERTIFIED, 2 BLOCKED, 112 DEFERRED = 159.  
> Both BLOCKED stories (S219, S031) are active implementation targets in this program.  
> Final required result: **159 CERTIFIED, 0 DEFERRED, 0 BLOCKED**.

---

## Status Reclassification

All 112 PACKAGE_AUTHORIZED_DEFERRED stories are reclassified as follows:
- Stories with no existing code → **NOT_STARTED**  
- Stories with existing service stubs or partial schemas → **PARTIALLY_IMPLEMENTED**  
- Stories with implementation pending only test/cert → **IMPLEMENTED_PENDING_CERTIFICATION**

Both BLOCKED stories (S219, S031) are reclassified as **PARTIALLY_IMPLEMENTED** — code exists, gap is fixable without product decision.

No genuine BLOCKED_REQUIRING_PRODUCT_DECISION found — all gaps are technical implementation gaps, not unresolved accounting/legal policy decisions.

---

## Verified: 47 Needing Implementation = 2 BLOCKED + 112 DEFERRED - 47 already CERTIFIED = 114 stories

```
45 CERTIFIED (matrix) + 2 BLOCKED + 112 DEFERRED = 159 total
2 BLOCKED + 112 DEFERRED = 114 active remaining
45 currently certified
+ 114 active remaining
= 159 total ✓
```

---

## Canonical Epic Summary

| Epic | Name | Total | Certified | Remaining |
|------|------|-------|-----------|-----------|
| CE-01 | Legal Entity & User Foundation | 12 | 12 | 0 |
| CE-02 | Fiscal Calendar | 2 | 2 | 0 |
| CE-03 | Chart of Accounts | 8 | 8 | 0 |
| CE-04 | Manual Journal Entry | 6 | 5 | 1 (S219 BLOCKED) |
| CE-05 | GL Inquiry & Reporting | 4 | 4 | 0 |
| CE-06 | Governance & Controls | 12 | 6 | 6 |
| CE-07 | Posting Engine | 4 | 4 | 0 |
| CE-08 | Schedule & Open Items | 5 | 4 | 1 (S030) |
| CE-09 | AP/AR/Cash | 24 | 0 | 24 |
| CE-10 | Tax | 2 | 0 | 2 |
| CE-11 | Fixed Operations | 14 | 0 | 14 |
| CE-12 | Vehicle & Deal Accounting | 20 | 0 | 20 |
| CE-13 | Payroll & Compensation | 6 | 0 | 6 |
| CE-14 | OEM & Manufacturer | 9 | 0 | 9 |
| CE-15 | Period Close & Compliance | 13 | 0 | 13 |
| CE-16 | Migration & Onboarding | 4 | 0 | 4 |
| CE-17 | Advanced Automation | 14 | 0 | 14 |
| **TOTAL** | | **159** | **45** | **114** |

---

## Implementation Waves (Dependency Order)

### Wave 1 — CE-04 + CE-06 Remaining (7 stories)
*These are governance and core posting stories — all downstream epics depend on them.*

| Order | Story | Title | Status | First Implementation Target |
|-------|-------|-------|--------|----------------------------|
| 1 | S219 | Void/Delete Draft JE | PARTIALLY_IMPLEMENTED | Fix SoD check — close-service sod-validator → standalone permission |
| 2 | S031 | Manual JE Approval Governance | PARTIALLY_IMPLEMENTED | Remove in-memory fallback in approval-service/src/index.ts |
| 3 | S005 | HR-Event Provisioning Hooks | NOT_STARTED | Add HR-event bus consumer in tenant-service |
| 4 | S006 | MFA & Safeguards Evidence | NOT_STARTED | Add MFA flow in auth-service + evidence table |
| 5 | S033 | Allocation Entries | NOT_STARTED | Allocation template engine in gl-service |
| 6 | S034 | Intercompany Pairing & Net-Zero | NOT_STARTED | IC pairing validation in gl-service + tenant-service |
| 7 | S035 | Consolidation Eliminations | NOT_STARTED | Elimination posting engine using S003 attributes |

### Wave 2 — CE-08 Remaining (1 story)
*Depends on CE-09 AR customer master for statement recipients — implement after CE-09 core.*

| Order | Story | Title | Status |
|-------|-------|-------|--------|
| 8 | S030 | Schedule Statements & Dunning | NOT_STARTED |

### Wave 3 — CE-09 AP/AR/Cash (24 stories)
*AP/AR/Cash is foundational for Waves 4–11.*

| Order | Story | Title | Status |
|-------|-------|-------|--------|
| 9 | S036A | Vendor Master CRUD | PARTIALLY_IMPLEMENTED |
| 10 | S036B | Vendor Verification Integrations | PARTIALLY_IMPLEMENTED |
| 11 | S039 | AP Invoice Entry & 2/3-Way Match | PARTIALLY_IMPLEMENTED |
| 12 | S041 | AP Approval Matrix | NOT_STARTED |
| 13 | S042 | Use-Tax Self-Assessment | NOT_STARTED |
| 14 | S043A | Manual Single Payment | PARTIALLY_IMPLEMENTED |
| 15 | S043B | Payment Runs & Rails | NOT_STARTED |
| 16 | S044 | Trade-Payoff Fast Lane | NOT_STARTED |
| 17 | S045 | Void/Stop/Reissue & Check Escheat | NOT_STARTED |
| 18 | S046 | Customer AR Master, Credit & Statements | PARTIALLY_IMPLEMENTED |
| 19 | S048 | Wholesale Vehicle AR & Title Gate | NOT_STARTED |
| 20 | S049 | Insurance AR (Body Shop) | NOT_STARTED |
| 21 | S050 | AR Write-offs & Allowance Model | NOT_STARTED |
| 22 | S051 | NSF Handling | NOT_STARTED |
| 23 | S052 | Receipting POS & Drawers | PARTIALLY_IMPLEMENTED |
| 24 | S053 | Deposit Workflow & Bank Feed Match | PARTIALLY_IMPLEMENTED |
| 25 | S054A | Manual Bank Reconciliation Workbench | NOT_STARTED |
| 26 | S054B | Rule-Based Bank Auto-Match | NOT_STARTED |
| 27 | S055 | Merchant Settlement Reconciliation | NOT_STARTED |
| 28 | S056 | ZBA Sweeps & FP-Offset Allocation | NOT_STARTED |
| 29 | S057 | Daily Cash Position Dashboard | NOT_STARTED |
| 30 | S037 | 1099/T4A Flag Rules & Preview | NOT_STARTED |
| 31 | S038 | Vendor Insurance-Cert Tracking | NOT_STARTED |
| 32 | S047 | Fleet AR Consolidated Billing | NOT_STARTED |

### Wave 4 — CE-10 Tax (2 stories)
| Order | Story | Title | Status |
|-------|-------|-------|--------|
| 33 | S124 | Tax Code Registry & Taxability Rules | NOT_STARTED |
| 34 | S125 | Tax Posting Integration | NOT_STARTED |

### Wave 5 — CE-11 Fixed Operations (14 stories)
| Order | Story | Title | Status |
|-------|-------|-------|--------|
| 35–48 | S059–S072 | RO Close, Parts, Warranty, WIP | NOT_STARTED |

### Wave 6 — CE-12 Vehicle & Deal Accounting (20 stories)
| Order | Story | Title | Status |
|-------|-------|-------|--------|
| 49–68 | S024, S074–S094 | Vehicle Ledger, Deal JE, F&I, Floorplan | NOT_STARTED |

### Wave 7 — CE-13 Payroll (6 stories)
| Order | Story | Title | Status |
|-------|-------|-------|--------|
| 69–74 | S025, S108–S112 | Payroll GL, Commission, Accruals | NOT_STARTED |

### Wave 8 — CE-14 OEM/Manufacturer (9 stories)
| Order | Story | Title | Status |
|-------|-------|-------|--------|
| 75–83 | S098–S106, S102 | OEM Adapters, Incentives, Warranty | NOT_STARTED |

### Wave 9 — CE-15 Period Close & Compliance (13 stories)
| Order | Story | Title | Status |
|-------|-------|-------|--------|
| 84–96 | S015–S017, S113–S123 | Multi-Currency, Close Calendar, Reporting | NOT_STARTED |

### Wave 10 — CE-16 Migration & Onboarding (4 stories)
| Order | Story | Title | Status |
|-------|-------|-------|--------|
| 97–100 | S129–S132 | Schedule Migration, TB Conversion, Parallel Run | NOT_STARTED |

### Wave 11 — CE-17 Advanced Automation (14 stories)
| Order | Story | Title | Status |
|-------|-------|-------|--------|
| 101–114 | S022, S040, S058, S073, S091B, S095–S096, S101B, S103B, S107, S118, S126–S128 | AI/Automation, LIFO, SOX, DSAR | NOT_STARTED |

---

## Financial Execution Standard (all financial stories)

Every financial story must pass:
1. Balance proof (Σ debits = Σ credits)
2. Idempotency (duplicate event = same result)
3. Reversal (reversed journal restores all downstream state)
4. Closed-period rejection (hard-close rejects posting)
5. Missing-mapping refusal (no mapping = no posting)
6. Zero-mutation on validation failure
7. Tenant isolation (cross-tenant data never visible)
8. Legal-entity isolation
9. Source-to-journal traceability

---

## Demo Seed Commands (target)

```
yarn seed:r1-demo           # Existing — backward compatible, unchanged
yarn seed:all-159-demo      # New — seeds all 159 story scenarios
yarn seed:all-159-demo --reset    # Drop and reseed
yarn seed:all-159-demo --verify   # Verify seed completeness
```

---

## First Epic Implementation: CE-04 (S219) + CE-06 Remaining

**Starting SHA:** a4e9ae5f  
**Target:** Implement S219, S031, S005, S006, S033, S034, S035  
**Implementation commit target:** one squashed commit per epic group  

