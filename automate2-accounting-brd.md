# AutoMate 2.0 Accounting Module — Business Requirements Document (BRD)

**Version:** 1.0  
**Date:** May 9, 2026  
**Author:** Shiva Angadi, Product Owner, Solera AMACC  
**Status:** In Specification  

---

## EXECUTIVE SUMMARY

AutoMate 2.0 Accounting Module (AMACC) is rebuilding the 30-year-old COBOL accounting system into a modern, AI-native cloud platform that automates accounting operations for franchised automotive dealerships. This BRD defines 14 feature initiatives (8 to implement, 3 to redesign, 4 to platform, 2 to drop) to close gaps identified in Step 4–6 triage and deliver industry-standard accounting capabilities.

**Business Goal:** Reduce month-end close time from 3–5 days to 4–6 hours and eliminate the top 20 dealer accounting pain points via AI-driven validation and automation.

---

## PART A: IMPLEMENT FEATURES (Phase 1 & 2)

### Feature 1: Sales Tax Accrual by Jurisdiction (Phase 1)

**Business Justification:**
- **Gap:** COBOL accounting had zero automated tax accrual; dealers manually track sales tax and file late
- **Impact:** Multi-state dealers manage 50+ jurisdictions with no central tracking; compliance risk, audit exposure
- **ROI:** Eliminate manual tax reconciliation spreadsheet; auto-compliance with state filing requirements
- **COBOL Origin:** Net-new (no COBOL equivalent)

**User Roles:** Controller, Accountant  
**Frequency:** Daily (accrual), Monthly (remittance calculation)

**User Stories:**

1. **Tax Configuration**
   - Given a controller configures tax jurisdiction rates in the system, When they set state=CA, county=ALAMEDA, city=OAKLAND with 8.625% rate and effective date, Then the system stores the rate with the GL payable and receivable account mappings
   - When a new jurisdiction is added, Then historical deals are NOT retroactively recalculated; only new deals use the new rate

2. **Automatic Accrual on Deal Posting**
   - Given a deal with taxable service ($1,000) and parts ($2,000) is posted, When the deal posts to GL, Then the system automatically creates a journal entry:
     - DR: Tax Receivable (GL account 1150) for $260 (3% of $1,000 service + 8.625% of $2,000)
     - CR: Sales Tax Payable - CA (GL account 2530) for $260
   - When the entry is posted, Then it flows through the GL Integrity Agent for duplicate/balance validation
   - When a tax-exempt customer (resale certificate on file) posts a deal, Then no tax accrual entry is created

3. **Tax-Exempt Customer Management**
   - Given a customer has a valid resale certificate, When the certificate is uploaded and stored in the system with expiration date, Then all subsequent deals are flagged as tax-exempt
   - When a certificate expires, Then the system flags it as expired and requires re-upload before next tax-exempt deal

4. **Monthly Tax Liability Report (EOM Integration)**
   - Given a controller initiates month-end close at 2026-05-31, When ACCT_062 (Sales Tax Report Generation) executes, Then the system generates a Sales Tax Liability Report grouped by:
     - State / County / City
     - Amount accrued in the month
     - Total due (month accrual + prior unpaid)
   - The report matches the format required by California, Texas, Florida, New York state filing portals
   - When the report is generated, Then a GL trial balance snapshot is appended for audit trail

5. **Multi-Tenant Isolation**
   - Given a dealer group with 5 rooftops (5 separate tenants), When tax accrual runs, Then each tenant's tax is calculated independently and isolated by `tenant_id`
   - The consolidated group report shows tax by rooftop for group-level compliance

6. **Tax Rate Changes (Effective Date)**
   - Given tax rates change on 2026-07-01 (CA raises sales tax), When the controller updates the rate in the system with effective_date=2026-07-01, Then:
     - Deals posted before 2026-07-01 use the old rate (retroactive recalc: NO)
     - Deals posted on/after 2026-07-01 use the new rate
     - The system logs the rate change in the audit trail

**Acceptance Criteria:**
- ✅ Tax rates configurable per jurisdiction (state, county, city, district) with effective dates
- ✅ Supports tax-exempt status per customer with certificate tracking
- ✅ Monthly summary report matches state filing requirements (CA, TX, FL, NY templates)
- ✅ Accrual entries post through full GL pipeline (GL Integrity Agent validation)
- ✅ Multi-rooftop dealer groups see isolated tax per tenant
- ✅ Tax exemption certificate management (upload, expiration, re-upload workflow)
- ✅ Audit trail for all rate changes and exemptions

---

### Feature 2: 1099 Contractor Report Generator (Phase 1)

**Business Justification:**
- **Gap:** COBOL had no 1099 tracking; dealers file IRS forms manually in Excel
- **Impact:** 1099 filing deadline (Jan 31) approach causes scramble; risk of missing vendors, incorrect TINs, underreporting
- **ROI:** Fully automated 1099 generation, correction workflow, IRS FIRE export
- **COBOL Origin:** Net-new (no COBOL equivalent)

**User Roles:** Controller, Payroll Administrator, Tax Preparer  
**Frequency:** Annual (January filing), Quarterly (review/correction)

**User Stories:**

1. **Vendor 1099 Eligibility**
   - Given a vendor record with a tax ID (TIN) and "1099-eligible" flag checked, When the controller reviews vendor master, Then the system marks them as eligible for 1099 generation
   - When a vendor is ineligible (unchecked 1099-eligible flag), Then they are excluded from 1099 generation

2. **Automatic 1099 Generation**
   - Given it is January 2027, When the controller clicks "Generate 1099s for 2026", Then the system:
     - Queries all 1099-eligible vendors with TIN on file
     - Sums all AP check payments for the tax year 2026 by vendor TIN
     - Generates 1099-MISC for vendors with non-employee income (rent, royalties) >= $600
     - Generates 1099-NEC for vendors with other non-employee compensation >= $600
     - Status is set to DRAFT for review
   - When a vendor has $0 payments in the tax year, Then no 1099 is generated for that vendor
   - When a vendor has $599 payments, Then no 1099 is generated (below $600 threshold)

3. **Vendor Consolidation Across Rooftops**
   - Given a vendor has payments from rooftop A ($800) and rooftop B ($400) in 2026, When 1099 generation runs, Then:
     - All payments are summed by vendor TIN across all tenants in the dealer group
     - Single 1099 is generated for $1,200 total
     - Rooftop attribution is tracked internally but not shown on the 1099

4. **1099-MISC vs 1099-NEC Classification**
   - Given a vendor is classified as "rents" in the system, When 1099 generation runs, Then a 1099-MISC is generated with Box 1 (Rents)
   - Given a vendor is classified as "subcontractor labor", When 1099 generation runs, Then a 1099-NEC is generated with Box 1 (Non-employee comp)
   - The controller can override the classification for specific vendors in draft mode

5. **Review and Adjustment Workflow**
   - Given 1099s have been generated in DRAFT status, When the controller opens the 1099 review page, Then they see:
     - Vendor name, TIN, total amount, form type
     - Ability to edit amounts if corrections are needed
     - Ability to void/delete before filing
   - When the controller adjusts a 1099 amount (e.g., $1,200 → $1,100), Then:
     - Status remains DRAFT
     - The adjustment is logged with user ID and timestamp
     - An email notification is sent to auditor (if configured)

6. **IRS FIRE Format Export**
   - Given 1099s are in REVIEWED or FILED status, When the controller clicks "Export to FIRE", Then:
     - The system produces an IRS FIRE-format electronic filing file (.txt)
     - Format includes: transmitter info, vendor TIN, amounts, form type per IRS 1099 specs
     - File is downloadable and ready for upload to IRS e-Services
   - When export completes, Then a status message shows "Successfully exported N 1099s"

7. **PDF Generation and Printing**
   - Given a 1099-NEC has been finalized, When the controller clicks "Download PDF", Then:
     - A PDF is generated with official IRS 1099-NEC form layout
     - Copies 1 (For Filer's Files), 2 (For Recipient), B (For State), C (For Payer's State) are included
     - PDF is ready to print and mail to vendors by Jan 31 deadline

8. **Amended 1099 / Correction Workflow**
   - Given a 1099 was filed but an error is discovered, When the controller marks it as "CORRECTED", Then:
     - A new 1099-X (corrected form) can be generated
     - Original 1099 is marked as VOID
     - Corrected 1099 references the original in the audit trail

**Acceptance Criteria:**
- ✅ Automatically identifies 1099-eligible vendors (W-9 flag, TIN) with $600+ threshold
- ✅ Calculates total AP payments for tax year from check history
- ✅ Supports 1099-MISC (rents, royalties) and 1099-NEC (non-employee comp) classifications
- ✅ Consolidates payments by TIN across dealer group rooftops
- ✅ Correction and void workflow for amended filings
- ✅ Export to IRS FIRE format for e-filing
- ✅ PDF generation for printing/mailing to vendors
- ✅ Audit trail for all edits, filings, corrections

---

### Feature 3: Commission Tracking & Reporting (Phase 1)

**Business Justification:**
- **Gap:** COBOL had no commission calculation; dealers used manual worksheets, prone to errors
- **Impact:** Sales commission errors → employee disputes, delayed payroll, morale issues
- **ROI:** Eliminate manual commission worksheets; increase payroll cycle speed; transparency
- **COBOL Origin:** Net-new (no COBOL equivalent; manual spreadsheets only)

**User Roles:** Controller, Sales Manager, Service Manager, Payroll Administrator  
**Frequency:** Per-deal (accrual), Bi-weekly (payout), Monthly (reporting)

**User Stories:**

1. **Commission Plan Configuration**
   - Given a sales manager wants to set commission for a new employee, When they create a commission plan with:
     - Employee: John Smith (Sales)
     - Plan Type: PERCENTAGE
     - Rate: 2% of gross profit
     - Effective Date: 2026-06-01
     Then the system stores the plan and applies it to all deals posted after the effective date
   - When a sales advisor has tiered commission (0% on first $20K, 2% on $20K–$50K, 3% on >$50K), Then the system supports TIERED plan type with the tier thresholds

2. **Automatic Commission Accrual on Deal Posting**
   - Given a vehicle sale deal with gross profit of $5,000 is posted for employee "John Smith" (PERCENTAGE 2%), When the deal posts to GL, Then:
     - Commission amount = $5,000 × 2% = $100
     - A GL journal entry is created:
       - DR: Commission Expense (GL 6300) for $100
       - CR: Commission Payable (GL 2200) for $100
     - Commission record is created with status=ACCRUED
   - When the deal includes a finance charge or extended warranty, Then commission is calculated on the full gross profit including those items
   - When a deal is chargebacked, Then the commission is reversed and a new record is created with status=CHARGED_BACK

3. **Multi-Department Commission (Sales, F&I, Service)**
   - Given a used vehicle sale includes F&I products (gap insurance, extended warranty) sold by F&I Manager, When the deal posts, Then:
     - Sales commission accrues for the vehicle sale to Sales Rep
     - F&I commission accrues separately for the F&I products to F&I Manager
     - Each is accrued to their respective commission payable GL accounts (department-specific)
   - When a service advisor sells a warranty, When the warranty charges are posted, Then service commission accrues at the service commission rate

4. **Commission Payout During Payroll**
   - Given bi-weekly payroll is processed for a commission-based employee, When the payroll batch is validated, Then:
     - The Payroll Integrity Agent retrieves all ACCRUED commissions for the pay period
     - The commission amount is added to the payroll batch as a separate line item
     - Taxes (FICA, MEDICARE, FUTA, SUTA) are calculated on the commission
     - Accrued commission GL account is reversed
     - Actual commission payout GL entry is posted (DR Commission Payable, CR Cash)

5. **Commission Dashboard & Reporting**
   - Given a sales manager opens the commission dashboard, When they select period=2026-05 and employee=John Smith, Then they see:
     - YTD commissions: $5,000
     - Monthly breakdown (deals per month, commission per month)
     - Top 3 deals by commission amount with vehicle details
     - Commission plan details (rate, effective date)
   - When the manager filters by department=SALES and vehicle_type=NEW, Then they see only new vehicle sales commissions

6. **Commission Adjustment & Dispute Resolution**
   - Given a sales rep disputes their commission amount, When the controller reviews and agrees the calculation was wrong (e.g., deal chargebacked but commission not reversed), When they create an adjustment with reason "Deal was chargebacked 2026-05-28", Then:
     - A new GL journal entry is created:
       - DR: Commission Payable (GL 2200) for the adjustment amount
       - CR: Commission Adjustment/Reversal (GL 6310) for the adjustment amount
     - The adjustment is logged with audit trail (user, reason, timestamp)
     - The original commission record is marked as ADJUSTED

7. **Chargeback Management**
   - Given a vehicle sale deal (with $5,000 commission accrued) is chargebacked, When the deal status changes to CHARGEDBACK, Then:
     - The system automatically creates a reversal GL entry:
       - DR: Commission Payable (GL 2200) for $5,000
       - CR: Commission Expense (GL 6300) for $5,000
     - Commission record status is set to CHARGED_BACK
     - If the commission was already paid, then a journal entry creates a receivable from the employee

8. **Monthly Commission Summary Report**
   - Given it is month-end, When the controller runs the Commission Summary Report for May 2026, Then:
     - Report grouped by Employee, Department
     - Columns: Employee, Deal Count, Gross Profit, Commission Accrued, Commission Paid, Commission YTD, Plan Rate
     - Subtotals by department (Sales, F&I, Service)
     - Grand total across all employees
     - Comparison vs prior month
   - Report is exportable to CSV and email-deliverable to sales managers

**Acceptance Criteria:**
- ✅ Commission plans configurable per employee (flat, percentage, tiered) with effective dates
- ✅ Supports sales, F&I, and service advisor commissions with department isolation
- ✅ Chargeback support (deal unwind automatically reverses commission)
- ✅ Monthly commission report by employee with deal-level detail
- ✅ GL accrual through GL Integrity Agent validation
- ✅ Adjustment workflow with audit trail
- ✅ Payroll integration (commission included in bi-weekly payout)
- ✅ Dashboard with YTD, monthly, and plan tracking

---

### Feature 4: Floor Plan Financing Module (Phase 1)

**Business Justification:**
- **Gap:** COBOL treated floor plan as generic AP; no unit-level tracking, no daily interest accrual, no payoff automation
- **Impact:** Dealers float $500K–$2M on floored inventory; manual interest calculation error-prone; lender disputes common
- **ROI:** Reduce floor plan interest expense via accurate accrual; eliminate manual curtailment tracking; accelerate payoff workflow
- **COBOL Origin:** Net-new (no COBOL equivalent; generic AP only)

**User Roles:** Controller, Office Manager, Finance Director  
**Frequency:** Daily (interest accrual), Monthly (aging, curtailment tracking)

**User Stories:**

1. **Floor Plan Unit Registration**
   - Given a new vehicle arrives on lot and is floored with Wells Fargo for $25,000 at 6.5% annual rate, When the office manager enters:
     - VIN: 1HGCV41JXMN109186
     - Lender: Wells Fargo
     - Advance Amount: $25,000
     - Interest Rate: 6.5% annual
     - Floor Date: 2026-05-01
     Then the system creates a floor plan unit record with status=ACTIVE and GL liability account mapped to 2510 (Floor Plan Payable - Wells Fargo)

2. **Daily Interest Accrual Batch Job**
   - Given 50 vehicles are on floor as of 2026-05-02, When the scheduled daily interest accrual job runs at 6 AM, Then:
     - For each ACTIVE floor plan unit, interest is calculated: (current_balance × annual_rate / 365)
     - Interest is accrued to the corresponding GL account:
       - DR: Floor Plan Interest Expense (GL 5510) for total daily interest ($X)
       - CR: Floor Plan Payable (GL 2510) for total daily interest ($X)
     - Each unit's accrued_interest field is incremented
     - Job logs all calculations and GL posting details

3. **Interest Calculation Methodology**
   - Given a unit floored on 2026-05-01 with advance $25,000 and rate 6.5%, When daily accrual runs on 2026-05-02:
     - Interest = $25,000 × 6.5% / 365 = $4.45 per day
     - Interest compounds: accrued_interest on 2026-05-03 = $4.45 + ($25,000 × 6.5% / 365) = $8.90
   - When the lender requires monthly compounding (specified in lender config), Then interest is recalculated on month-end with compounding

4. **Automatic Payoff on Vehicle Sale**
   - Given a floored vehicle is sold on 2026-05-15, When the sale deal posts to GL, Then:
     - System queries floor plan units by VIN and finds matching unit
     - Current_balance = original advance + all accrued interest = $25,000 + $67.15 = $25,067.15
     - A GL journal entry is created:
       - DR: Floor Plan Payable (GL 2510) for $25,067.15
       - CR: Cash - Checking (GL 1010) for $25,067.15
     - Unit status is set to PAID_OFF
     - A payoff check is scheduled to Wells Fargo (via AP module)

5. **Curtailment Tracking & Payment Scheduling**
   - Given a floor plan lender (e.g., Ally) requires monthly curtailment of $500/month, When the floor plan unit is created with curtailment_schedule={month:500}, Then:
     - The system creates recurring AP reminders on the 15th of each month
     - When the curtailment payment is due, a reminder is sent to Office Manager
     - When the payment is made, the floor plan liability is reduced by $500 and a GL entry is posted:
       - DR: Floor Plan Payable (GL 2510) for $500
       - CR: Cash (GL 1010) for $500

6. **Floor Plan Aging Report**
   - Given it is month-end, When the controller runs the Floor Plan Aging Report for May 2026, Then:
     - Report shows all ACTIVE units grouped by Lender
     - Columns: VIN, Vehicle Make/Model, Advance Amount, Accrued Interest, Days on Floor, Next Payoff Date, Status
     - Vehicles are sorted by Days on Floor (oldest first)
     - Subtotals by lender (total amount, total accrued interest)
     - Flag vehicles on floor >180 days (aged units)
   - Report is emailed to Finance Director and Finance Manager

7. **Multi-Lender Support & Lender Configuration**
   - Given the dealership has floor plans with Wells Fargo, Ally, and BMW Financial Services, When the controller manages lender configuration:
     - Lender name, interest calculation method (daily/monthly compound), GL payable account, GL interest account
     - Minimum advance amount per unit (lender policy)
     - Curtailment schedule and due dates
     Then each lender's floor plan transactions post to their respective GL accounts (isolation per lender)

8. **Floor Plan Recovery (Loss Mitigation)**
   - Given a floored vehicle is damaged/totaled, When the office manager marks the unit status as DAMAGED, Then:
     - The system creates a GL entry to write off the loss:
       - DR: Floor Plan Loss on Inventory (GL 6000) for the current balance
       - CR: Floor Plan Payable (GL 2510) for the current balance
     - Status changes to PAID_OFF (via loss write-off)
     - Insurance claim workflow is triggered (if insured)

**Acceptance Criteria:**
- ✅ Tracks individual units by VIN with lender, advance amount, floor date, interest rate
- ✅ Daily compound interest calculation (configurable by lender)
- ✅ Automatic payoff on vehicle sale with GL entry
- ✅ Curtailment tracking (lender-required periodic payments)
- ✅ Floor plan aging report by lender and days-on-lot
- ✅ Integrates with GL: liability, interest expense, payoff entries through GL Integrity Agent
- ✅ Multi-lender support with isolated GL accounts
- ✅ Loss mitigation workflow (damage, total loss, recovery)

---

### Feature 5: Inventory Valuation Methods — FIFO & Weighted-Average (Phase 2)

**Business Justification:**
- **Gap:** LIFO stub exists but FIFO and weighted-average not implemented; dealers must manually calculate quarterly
- **Impact:** Inventory valuation error → overstated/understated COGS → P&L misstatement, tax risk
- **ROI:** Automated quarterly valuation; compliance with GAAP; reduce audit adjustments
- **COBOL Origin:** Partial (COBOL had LIFO support; FIFO/weighted-average not implemented)

**User Roles:** Controller, Accountant, Auditor  
**Frequency:** Quarterly (valuation), Monthly (preview)

**User Stories:**

1. **Inventory Layer Tracking**
   - Given inventory accounts are configured with valuation method=FIFO, When purchases are posted:
     - Each purchase is recorded as a layer: (date, quantity, unit_cost, total_cost)
     - Layers are stored in chronological order
   - When sales/usage is recorded, Then FIFO pops the oldest layer first (COGS = oldest layer cost)

2. **Weighted-Average Calculation**
   - Given inventory is configured with valuation method=WEIGHTED_AVERAGE, When a quarterly valuation runs:
     - Weighted-average cost = Total Inventory Cost / Total Quantity
     - All layers are collapsed into single average-cost layer
     - COGS is calculated using the average cost

3. **Quarterly Valuation Job**
   - Given it is 2026-06-30 (quarter-end), When the controller initiates inventory valuation, Then:
     - System queries all inventory accounts with valuation method=FIFO or WEIGHTED_AVERAGE
     - For each account, valuation is calculated per the method
     - A DRAFT journal entry is created:
       - DR/CR: Inventory Valuation Adjustment (GL 1350) for the difference between prior and current valuation
     - Valuation report is generated showing method, old cost, new cost, COGS impact

4. **LIFO Reserve Comparison**
   - Given a company has LIFO inventory on books, When a quarterly valuation runs, Then:
     - FIFO value is calculated as reference
     - LIFO reserve = FIFO value – LIFO value on books
     - Reserve is displayed in balance sheet supplemental notes

**Acceptance Criteria (Phase 2):**
- ✅ FIFO layer tracking and COGS calculation
- ✅ Weighted-average cost calculation
- ✅ Quarterly valuation automation
- ✅ GL journal entry creation for valuation adjustments
- ✅ Valuation report with method comparison
- ✅ Audit trail for all layer changes

---

### Feature 6: Fixed Asset Management & Depreciation (Phase 2)

**Business Justification:**
- **Gap:** COBOL had no fixed asset module; dealers track depreciation in spreadsheet (lifts, hoists, computers, etc.)
- **Impact:** Depreciation not recorded → asset cost overstated, equity understated; IRS audit risk
- **ROI:** Automated depreciation, asset register, disposal tracking
- **COBOL Origin:** Net-new (no COBOL equivalent; spreadsheet only)

**User Roles:** Controller, Facility Manager, Accountant  
**Frequency:** Monthly (depreciation), Annual (asset review)

**User Stories:**

1. **Asset Registration**
   - Given a service lift is purchased for $15,000 with 10-year useful life, When the facility manager registers it:
     - Asset: Service Lift A
     - Description: Two-post hydraulic lift
     - Purchase Date: 2026-05-01
     - Cost: $15,000
     - Useful Life: 10 years
     - Depreciation Method: Straight-line
     - GL Asset Account: 1500 (Equipment)
     - GL Accumulated Depreciation Account: 1501 (Accumulated Depreciation)
     Then the system creates an asset record with depreciation schedule starting 2026-06-01

2. **Monthly Depreciation Accrual**
   - Given asset is registered with cost=$15,000 and useful life=10 years, When monthly depreciation accrual runs:
     - Monthly depreciation = $15,000 / 120 months = $125/month
     - GL journal entry is created:
       - DR: Depreciation Expense (GL 5700) for $125
       - CR: Accumulated Depreciation (GL 1501) for $125

3. **Asset Disposal & Gain/Loss Recognition**
   - Given an asset with cost=$15,000 and accumulated depreciation=$7,500 is sold for $6,000, When the disposal is recorded:
     - Net book value = $15,000 - $7,500 = $7,500
     - Gain/Loss = Sale Price - NBV = $6,000 - $7,500 = -$1,500 (loss)
     - GL journal entry is created:
       - DR: Cash (GL 1010) for $6,000
       - DR: Accumulated Depreciation (GL 1501) for $7,500
       - CR: Equipment (GL 1500) for $15,000
       - CR: Loss on Asset Disposal (GL 6200) for $1,500

**Acceptance Criteria (Phase 2):**
- ✅ Asset register (purchase, description, cost, useful life)
- ✅ Monthly depreciation accrual (straight-line, units of production methods)
- ✅ Asset disposal with gain/loss recognition
- ✅ GL integration for depreciation expense and accumulated depreciation
- ✅ Asset audit trail (acquisition, depreciation, disposal)

---

### Feature 7: Warranty Accrual Estimator (Phase 2)

**Business Justification:**
- **Gap:** COBOL had no warranty accrual; dealers manually estimate reserves, often understating
- **Impact:** Extended warranty sold but liability not recorded → equity overstated; auditor adjustments
- **ROI:** Automated warranty reserve estimation based on historical claims and sales; GAAP compliance
- **COBOL Origin:** Net-new (no COBOL equivalent)

**User Roles:** Controller, Service Manager, Accountant  
**Frequency:** Monthly (accrual), Quarterly (reserve review)

**User Stories:**

1. **Warranty Sales Tracking**
   - Given an extended warranty is sold as part of a vehicle deal for $2,500 (3-year term), When the warranty posts to GL:
     - Service Revenue - Warranty (GL 4600) is credited for $2,500
     - Warranty Liability (GL 2400) is accrued for an estimated reserve amount (TBD by claims analysis)

2. **Historical Claims Analysis**
   - Given the service manager has data showing:
     - 2024: $50K warranty sales, $35K claims paid (70% claims ratio)
     - 2025: $55K warranty sales, $38K claims paid (69% claims ratio)
     - Average claims ratio: 70%
     When the system calculates warranty reserve for 2026, Then the accrual rate is 70% of sales

3. **Monthly Warranty Reserve Accrual**
   - Given $2,500 warranty is sold with 70% estimated claims ratio, When the sale posts:
     - Warranty reserve accrual = $2,500 × 70% = $1,750
     - GL journal entry:
       - DR: Warranty Claims Expense (GL 5600) for $1,750
       - CR: Warranty Liability (GL 2400) for $1,750

4. **Warranty Claims Against Reserve**
   - Given a customer claims warranty on a transmission at year 2, When the claim is paid ($3,200), Then:
     - GL journal entry:
       - DR: Warranty Liability (GL 2400) for $3,200 (paid against reserve)
       - CR: Cash (GL 1010) for $3,200
     - Warranty liability balance decreases

**Acceptance Criteria (Phase 2):**
- ✅ Warranty sales tracking (amount, term, claims ratio)
- ✅ Historical claims analysis and reserve estimation
- ✅ Monthly warranty accrual based on claims ratio
- ✅ Claims payment against warranty reserve
- ✅ Quarterly reserve review and ratio re-estimation
- ✅ GL integration for warranty expense and liability

---

### Feature 8: Manufacturer Reconciliation Service (Phase 2)

**Business Justification:**
- **Gap:** COBOL had no automated OEM reconciliation; dealers manually match GM/Ford claims to AR entries
- **Impact:** Warranty claims mismatched → cash flow delays, AR aging; audit exposure
- **ROI:** Automated OEM claim matching; eliminate manual spreadsheet reconciliation
- **COBOL Origin:** Net-new (no COBOL equivalent)

**User Roles:** Controller, Warranty Manager, Finance Director  
**Frequency:** Daily (import), Weekly (reconciliation)

**User Stories:**

1. **OEM Feed Ingestion**
   - Given GM publishes a daily warranty claim file with approved claims, When the connector service imports the feed:
     - Each claim includes: dealer_id, claim_number, vin, labor_hours, labor_rate, parts_total, claim_amount, submission_date, approval_date
     - Claims are stored in an OEM claims table (staging)

2. **Auto-Matching to AR**
   - Given an AR entry exists for claim_number=GM123456789 for $5,200, When OEM reconciliation runs:
     - System matches OEM claim to AR by claim_number and amount
     - If matched, AR status is marked as "OEM_MATCHED"
     - If unmatched (claim in OEM feed but not in AR), Then flagged as "UNMATCHED_OEM_CLAIM" for investigation

3. **Short-Payment Detection**
   - Given an AR entry for $5,200 exists but OEM approved only $4,800, When reconciliation runs:
     - System detects short-payment (discrepancy = $400)
     - AR status is marked as "SHORT_PAYMENT"
     - AP/AR Reconciliation Agent flags for human review (WARN severity)

4. **Payment Posting from OEM**
   - Given OEM transfers remittance of $50K with details for 20 claims, When the remittance is received:
     - Connector service imports remittance with claim allocations
     - For each matched AR entry, a cash receipt is created:
       - DR: Cash (GL 1010) for claim amount
       - CR: Warranty AR (GL 1130) for claim amount
     - GL journal entries post through GL Integrity Agent

**Acceptance Criteria (Phase 2):**
- ✅ OEM feed ingestion (daily, validated schema)
- ✅ Auto-matching to AR by claim_number + amount
- ✅ Short-payment detection and escalation
- ✅ Remittance posting with GL integration
- ✅ Unmatched claim investigation workflow
- ✅ Audit trail for all matches and discrepancies

---

## PART B: REDESIGN FEATURES (AI-Native Approach)

### Redesign 1: GL Exception Detection — From Rule Engine to Claude Agent

**Current State (Rule Engine):**
- Hardcoded validation rules: "If journal entry > $50K, flag it"
- No contextual understanding; many false positives
- Rules require code changes to update thresholds
- No explanation to user: "Why was this flagged?"

**Redesigned State (Claude Agent):**
- GL Exception Agent continuously monitors journal entries post-submission
- Claude analyzes entry in context: account type, department, historical patterns, peer activity
- Agent generates natural-language explanation: "This entry is 2.5x the 30-day average for this account. The entry also has conflicting account types (revenue posted to asset)."
- Controller sees ranked exception list with severity and reasoning
- Agent learns from exceptions marked "false positive" by controller (feedback loop)

**User Stories:**

1. **AI-Driven Anomaly Detection**
   - Given a $500K journal entry is submitted for a vehicle dealer trade (unusual), When GL Exception Agent analyzes it:
     - Agent queries: historical average for account, peer dealerships' patterns, journal entry description
     - Agent detects: Amount is 10x average, but account type (Inventory) is correct for dealer trade
     - Agent assigns severity: WARN (not CRITICAL)
     - Explanation: "Large amount due to dealer trade, account type correct. May need manager approval."
   - Controller reviews in 30 seconds (vs 10 minutes of manual checks)

2. **Human-Agent Collaboration**
   - Given agent marks 10 entries for review per day, When the controller opens the GL Exception Dashboard:
     - Entries ranked by severity (CRITICAL, WARN, INFO)
     - Controller can click "Flag as False Positive" if agent was wrong
     - System learns from feedback; future similar entries are flagged differently
   - When controller marks "Approve" on an entry, Then agent proceeds with posting automatically

**What Agent Does:**
- ✅ Real-time monitoring of all journal entries
- ✅ Pattern analysis (historical, peer, department-level)
- ✅ Context-aware severity assignment
- ✅ Natural-language explanation generation
- ✅ Learning from feedback (no code change needed)

**What Human Does:**
- ✅ Review top exceptions (severity-ranked)
- ✅ Approve/reject with feedback
- ✅ Investigate anomalies (phone calls, emails)
- ✅ Set policy (e.g., "No entries >$100K without CFO pre-approval")

---

### Redesign 2: Deal Profitability Analysis — From Static Report to GL-Sourced AI Dashboard

**Current State (Static Report):**
- Finance system generates deal P&L report: "Deal #ABC sold for $30K, COGS $20K, GP $10K"
- User exports to Excel, creates pivot tables to understand profitability by vehicle type, salesperson, department
- Data lag: report generated once/day, stale by afternoon

**Redesigned State (GL-Sourced AI Dashboard):**
- T1 Copilot Agent queries GL in real-time to reconstruct deal P&L
- User asks: "Which sales rep had the highest profit margin last month?"
- Agent queries: sales GL accounts, COGS GL accounts, expense GL accounts tied to sales deals
- Agent returns: "John Smith: 18% margin ($45K deals, 18% margin). Sarah Brown: 12% margin ($62K deals, 12% margin)."
- User can drill down: "Why is Sarah's margin lower? Show me top 3 deals and the COGS breakdown."
- Agent shows: "Deal A: high F&I penetration (gap insurance, wheel/tire coverage) but high COGS due to extended warranty accrual."

**User Stories:**

1. **Real-Time Deal Profitability Query**
   - Given a sales manager asks "What was our YTD gross profit by vehicle type?", When they type this into T1 Copilot:
     - Agent queries GL sales revenue accounts (by vehicle type) and COGS accounts
     - Agent calculates: New Vehicle Sales $500K, New COGS $400K, GP $100K (20%)
     - Agent returns ranked by margin: New > Used > Trade > Service
   - Response time: <5 seconds (GL queries are indexed)

2. **Deal-Level Drill-Down**
   - Given manager wants to understand "Why did Deal #ABC have lower margin?", When they ask:
     - Agent queries: invoice GL entries for Deal #ABC, breakdown by labor/parts/warranty/F&I
     - Agent identifies: high extended warranty accrual ($2K reserve on $500 sale price)
     - Agent explains: "Extended warranty reserve estimated at 70% of sale price reduces profit margin by 4%."

3. **Chargeback Impact Analysis**
   - Given a deal was chargebacked (warranty paid out), When the agent is asked "How much did chargebacks reduce our profit?":
     - Agent queries warranty liability reversals and claims paid
     - Agent calculates: $50K warranty sales × 70% reserve = $35K liability. Q1 claims paid = $18K (36% of reserve). YTD profit impact: -2.5%

**What Agent Does:**
- ✅ Real-time GL querying for deal profitability
- ✅ Multi-dimensional analysis (by rep, vehicle type, department, time period)
- ✅ Natural-language explanation of profitability drivers
- ✅ Drill-down capability (answer follow-up questions)
- ✅ Chargeback impact quantification

**What Human Does:**
- ✅ Ask questions in natural language
- ✅ Interpret results and take action
- ✅ Identify coaching opportunities (low-margin sales)
- ✅ Set targets and track progress

---

### Redesign 3: Bank Reconciliation Workflow — From Manual Matching to AI Auto-Match + Human Review

**Current State (Manual Matching):**
- Accountant exports bank statement (CSV) and GL journal detail (CSV)
- Opens Excel, manually matches lines:
  - "Bank statement line $5,200 on 2026-05-15 matches GL journal $5,200 on 2026-05-14 (1-day lag)"
  - Marks as matched
  - Unmatched items get investigated (outstanding checks, timing differences)
- Time: 2–4 hours per bank account per month

**Redesigned State (AI Auto-Match + Human Review):**
- Bank statement and GL data are ingested automatically
- AP/AR Reconciliation Agent runs matching algorithm:
  - Exact match: amount and date (amount × date, within 3-day window)
  - Fuzzy match: amount close (within $1), date close (within 7 days)
  - Pattern match: recurring amount (e.g., monthly ACH payment)
- Agent generates confidence score for each match
- High-confidence matches (>95%) are auto-marked; accountant reviews only the unmatched and low-confidence items
- Time: 15–20 minutes per account (vs 2–4 hours)

**User Stories:**

1. **Automated Bank Feed Ingestion**
   - Given a bank statement is received from Wells Fargo for May 2026, When the connector service processes it:
     - Statement lines are parsed: date, amount, payee, check number (if applicable)
     - GL journal entries for the period are queried
     - Agent immediately begins matching

2. **High-Confidence Auto-Matching**
   - Given bank statement shows: 2026-05-15, -$15,050, "Floor Plan Payment - Wells Fargo", When agent matches:
     - Agent queries GL for Journal Entry posted 2026-05-14 or 2026-05-15 for $15,050
     - Agent finds: JE posted 2026-05-14 with description "Floor Plan Payable - Wells Fargo"
     - Confidence: 99% (amount exact, payee exact, 1-day lag expected)
     - Agent auto-marks as matched; accountant does NOT see this item

3. **Low-Confidence Escalation**
   - Given bank statement shows: 2026-05-20, -$8,500, "Unknown Payee", When agent matches:
     - Agent finds 2 GL entries close to $8,500: one for $8,495, one for $8,520
     - Agent assigns 65% confidence to the $8,495 match
     - Agent flags for accountant review with message: "Possible match: Amount difference $5. Check outstanding?"

4. **Unmatched Investigation Workflow**
   - Given accountant sees 5 unmatched bank items and 3 unmatched GL entries, When they review:
     - For each unmatched bank item, accountant can:
       - Mark as outstanding check/deposit (expected to clear next month)
       - Manually match to a GL entry
       - Flag as NSF / error / timing issue
     - Agent learns from manual matches (feedback loop)

**What Agent Does:**
- ✅ Automatic bank/GL data ingestion and parsing
- ✅ Pattern matching (exact, fuzzy, recurring)
- ✅ Confidence scoring for each match
- ✅ Auto-matching high-confidence items (no human review)
- ✅ Flagging low-confidence and unmatched items

**What Human Does:**
- ✅ Review and approve auto-matches (spot-check 10% for quality)
- ✅ Investigate low-confidence matches (call bank, check outstanding checks)
- ✅ Resolve timing differences (deposits in transit, checks outstanding)
- ✅ Mark items as NSF, reversal, error
- ✅ Provide feedback to agent (improve future matching)

---

## PART C: PLATFORM FEATURES (Solera Integration Layer)

### Platform Feature 1: Multi-Currency Support (FX Revaluation)

**Deferral Rationale:**
Dealerships in border markets (TX, CA, AZ) may sell vehicles for CAD/MXN, but 95% of accounting is USD. Multi-currency GL revaluation (mark-to-market FX gains/losses, elimination entries for consolidation) requires:
1. Enterprise-level currency master data (exchange rates, volatility, hedging policies)
2. Treasury function (who manages FX exposure)
3. Consolidation logic (eliminate intercompany FX differences)

These are better handled by Solera's platform layer (data warehouse, consolidation engine) than embedded in AMACC GL service. AMACC's role: post multi-currency transactions to GL; Solera's role: FX revaluation and consolidated reporting.

**Integration Contract:**
- **Event:** `JOURNAL_ENTRY_POSTED` with currency_code=CAD/MXN
- **AMACC Publishes:** Entry with original currency and USD equivalent (at posting rate)
- **Solera Consumes:** Monthly FX revaluation job reads GL entries by currency, applies current rates, publishes `FX_REVALUATION_ADJUSTMENTS`
- **AMACC Subscribes:** Receives consolidated FX adjustment entries for posting

---

### Platform Feature 2: Consolidated Group Reporting & Multi-Rooftop P&L

**Deferral Rationale:**
Dealer groups with 5–50 rooftops need consolidated P&L, balance sheet, and cash flow. Consolidation requires:
1. Inter-group elimination entries (intercompany transactions)
2. Upstream/downstream profit eliminations
3. Segment reporting (by rooftop, by OEM brand)

AMACC can post intercompany transactions per-tenant; but the consolidation logic (elimination entries, segment reporting, group-level GL) is better in Solera's data warehouse. AMACC publishes per-tenant GL; Solera aggregates and consolidates.

**Integration Contract:**
- **Event:** `EOM_CLOSE_COMPLETED` for each tenant with trial balance snapshot
- **AMACC Publishes:** Per-tenant trial balance, journal entries, intercompany transactions
- **Solera Consumes:** Reads all tenant GL data, generates consolidated trial balance with elimination entries
- **Solera Publishes:** Consolidated P&L, balance sheet, segment reports to AMACC reporting module (read-only)

---

### Platform Feature 3: Budgeting & Forecasting (Master Budget, Variance Analysis, Rolling Forecast)

**Deferral Rationale:**
Master budgeting and rolling forecasts span HR planning (headcount, compensation), capital expenditure planning, and statistical forecasting (sales by model, service hours by month). This is cross-functional and better centralized in Solera.

AMACC's role: record actual GL transactions; Solera's role: manage budget master data, variance calculations, forecast updates.

**Integration Contract:**
- **Event:** `MONTH_CLOSED` with final GL balances
- **AMACC Publishes:** Actual GL balances for budget period
- **Solera Consumes:** Compares actuals vs budget, calculates variances, updates rolling forecast
- **Solera Publishes:** Variance report, budget vs actual, forecast updates to AMACC analytics module

---

### Platform Feature 4: Advanced Compliance & Regulatory Reporting (GAAP Exceptions, Tax Compliance)

**Deferral Rationale:**
Compliance reporting (GAAP vs IFRS, SOX audit trail, state-specific tax compliance) involves regulatory interpretation and centralized policy. Better handled by Solera's compliance framework than buried in individual GL services.

AMACC's role: immutable audit trail (DB triggers prevent UPDATE/DELETE); Solera's role: compliance rules engine and regulatory reporting.

**Integration Contract:**
- **Event:** All domain events (journal entry posted, payroll posted, EOM close completed)
- **AMACC Publishes:** Complete audit trail with timestamps, user IDs, entry details
- **Solera Consumes:** Applies compliance rules (GAAP checklist, tax compliance rules, SOX requirements)
- **Solera Publishes:** Compliance report, exception list, required adjustments

---

## PART D: DROP FEATURES (Not Building)

### Drop Feature 1: Intercompany Billing Rules Engine

**Justification:**
Intercompany billing rules (e.g., "Parts sold from Rooftop A to Rooftop B are billed at cost + 5% markup") are complex, require policy updates, and are rarely used in practice. Most dealer groups use simplified billing or don't bill at all. The cost to build and maintain rules engine exceeds ROI.

**Alternative:** Continue supporting manual intercompany journal entries. Finance team records IC transactions in GL; Solera consolidation engine eliminates them at group-level. No need for automated rules.

---

### Drop Feature 2: Custom Aging Report Buckets (AP/AR)

**Justification:**
Standard 30/60/90-day aging buckets address 95% of use cases. Requests for custom buckets (e.g., 45/75/120) are rare and can be addressed with spreadsheet exports. The engineering effort to support dynamic bucket configuration is not justified.

**Alternative:** Standard aging reports in AMACC; users can export GL data and pivot in Excel if custom analysis is needed. Solera can support custom bucket definitions at the data warehouse level if demand emerges.

---

## ROADMAP & SEQUENCING

**Phase 1 (Q3 2026):** 4 features
- Sales Tax Accrual by Jurisdiction
- 1099 Contractor Report Generator
- Commission Tracking & Reporting
- Floor Plan Financing Module

**Phase 2 (Q4 2026 – Q1 2027):** 4 features
- Inventory Valuation (FIFO, Weighted-Average)
- Fixed Asset Management & Depreciation
- Warranty Accrual Estimator
- Manufacturer Reconciliation Service

**Redesign (In Parallel):**
- GL Exception Detection (Claude Agent)
- Deal Profitability Analysis (T1 Copilot Integration)
- Bank Reconciliation Workflow (AP/AR Recon Agent Enhancement)

**Platform Roadmap (Solera):**
- Multi-currency support (Q4 2026)
- Consolidated group reporting (Q1 2027)
- Budgeting & forecasting (Q2 2027)
- Advanced compliance reporting (Q2 2027)

---

## SUCCESS METRICS

| Metric | Target | Measurement |
|--------|--------|-------------|
| Month-end close time | 4–6 hours | Time log from EOM initiation to final close |
| Duplicate journal entry incidents | 0 per month | GL Integrity Agent catch rate |
| Tax compliance issues | 0 (vs 5+ per year) | Tax authority correspondence |
| Commission dispute resolution time | 1 hour (vs 1 day) | Support ticket tracking |
| Floor plan interest accrual accuracy | 99.5% | Reconciliation vs lender statement |
| 1099 filing accuracy | 100% | IRS correspondence, audit results |
| Controller time on reconciliation | 1 hour/month (vs 10 hours) | Time tracking |

---

**Document Version:** 1.0  
**Next Review:** June 2026  
**Owner:** Shiva Angadi (Product Owner)
