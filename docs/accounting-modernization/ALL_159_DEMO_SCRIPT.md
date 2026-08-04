# ALL-159 Demo Script — Kunes Demo Automotive Group

> **Audience:** Demo presenter and facilitator.
>
> **Data notice:** All tenant, financial, employee, and vehicle data is
> fully synthetic. No real customer, dealer, employee, payroll, banking, or
> OEM data is used.
>
> **Environment:** Frontend → http://localhost:5174 | Gateway → http://localhost:3100
>
> **Demo password (all users):** `KunesDemo2026!`

---

## Tier A — Leadership Demonstration (20–25 minutes)

**Objective:** Communicate business value, financial control, and modernization
progress to executive and leadership stakeholders. No deep technical detail.

### Presentation Setup

- Browser: full-screen, bookmarks hidden
- Zoom level: 110–125% for projector legibility
- Seed state: `yarn seed:all-159-demo --reset` run within 30 minutes of start
- Have the preflight report (`yarn demo:all-159:preflight`) on a second screen

---

### Step A-1 — Login as Administrator and Tenant/Rooftop Switcher

| Field | Value |
|-------|-------|
| **User** | `admin@kunes-demo.local` / `KunesDemo2026!` |
| **Legal Entity** | Kunes Ford |
| **Route** | `/login` → `/dashboard` |
| **Seeded Record** | User: Alex Admin, Tenant: Kunes Demo Automotive Group |
| **Action** | Log in, then open the rooftop switcher (top-left header) and switch from Kunes Ford to Kunes Chevrolet and back |

**Expected Result:** Login succeeds, JWT is issued, rooftop switcher shows both entities. All data refreshes on switch.

**Business Narration:**
> "Every person logs into one unified platform. The rooftop switcher lets a group controller see Ford or Chevrolet data without separate logins, separate systems, or emailing spreadsheets between stores. Consolidated visibility across the group — with proper segregation — from day one."

**Stories Demonstrated:** S006 (MFA/auth), S005 (HR provisioning creates the user account)

**Recovery Step:** If login fails, run `yarn seed:all-159-demo --reset` and retry. See Troubleshooting § 6.

---

### Step A-2 — Executive Dashboard: Revenue, Margins, Open Items

| Field | Value |
|-------|-------|
| **User** | `admin@kunes-demo.local` (already logged in) |
| **Legal Entity** | Kunes Ford |
| **Route** | `/dashboard` |
| **Seeded Record** | March 2026 journal entries, AR aging, period close state |
| **Action** | Show revenue tile ($2.1M March estimate), gross margin % tile, open AP items badge, journal approval queue count |

**Expected Result:** Dashboard tiles display non-zero figures. Open approvals badge shows ≥1 pending items.

**Business Narration:**
> "Instead of waiting for month-end to know where the business stands, the executive dashboard shows real-time revenue recognition, margin percentage, and outstanding items. Every number traces back to a posted journal entry — nothing lives in a side spreadsheet."

**Stories Demonstrated:** S227 (financial statement rollup), S202 (dashboard KPIs)

**Recovery Step:** If tiles show 0, verify seed ran successfully: `yarn seed:all-159-demo --verify`.

---

### Step A-3 — Journal Entry: Creation → Approval → Posting → Audit Trail

| Field | Value |
|-------|-------|
| **User** | `accountant@kunes-demo.local` (create), then `approver@kunes-demo.local` (approve) |
| **Legal Entity** | Kunes Ford |
| **Route** | `/gl/journals/new` → `/gl/journals/:id` → `/gl/journals/:id/audit` |
| **Seeded Record** | COA accounts 4001 (Sales Revenue), 1200 (Accounts Receivable) |
| **Action** | 1. As Accountant — create a balanced journal entry: DR 1200 / CR 4001 for $12,500. Submit for approval. 2. Switch to Approver — approve the journal. 3. Post the journal. 4. Open the audit trail panel. |

**Expected Result:** Journal moves DRAFT → PENDING_APPROVAL → APPROVED → POSTED. Audit trail shows each state transition with timestamp, user, and IP.

**Business Narration:**
> "Every financial transaction goes through a controlled workflow — created by one person, approved by another. Once posted, it is immutable. The audit trail shows who touched the entry, from which IP, and at what time. This is the foundation of SOX compliance and separation of duties."

**Stories Demonstrated:** S008 (journal lifecycle), S014 (approval workflow), S026/S027 (audit trail, signed snapshots)

**Recovery Step:** If posting fails with balance error, ensure DR and CR amounts are equal. See Troubleshooting § 8.

---

### Step A-4 — Period Close: One Entity Closed, One In Progress

| Field | Value |
|-------|-------|
| **User** | `controller@kunes-demo.local` |
| **Legal Entity** | Both (switch between) |
| **Route** | `/close/status` |
| **Seeded Record** | Kunes Ford: Feb 2026 = HARD_CLOSED; Kunes Chevrolet: Feb 2026 = IN_PROGRESS |
| **Action** | Open the close dashboard. Show Ford February row: HARD_CLOSED. Switch to Chevrolet: February IN_PROGRESS with 3 of 7 checklist items complete. |

**Expected Result:** Each entity shows its own close state. Closed periods reject new posting attempts (try posting to Feb Ford — expect rejection message).

**Business Narration:**
> "Close is not a calendar event — it is an enforced gate. Once Ford closes February, no retroactive adjustments can slip in. Chevrolet is still in-process, and the controller can see exactly which checklist items are blocking completion. Separation of duties is enforced — the person who created entries cannot also close the period."

**Stories Demonstrated:** S023 (period close), CE11 (SoD enforcement)

**Recovery Step:** If close state shows OPEN for both, re-run seed: `yarn seed:all-159-demo --reset`.

---

### Step A-5 — Payroll Batch: Validated, Pending Approval

| Field | Value |
|-------|-------|
| **User** | `payroll@kunes-demo.local` |
| **Legal Entity** | Kunes Ford |
| **Route** | `/payroll/batches` |
| **Seeded Record** | Payroll batch PR-2026-03-W3 status PENDING_APPROVAL, gross $348,000 |
| **Action** | Open the pending payroll batch. Show validation results (zero errors). Click "Submit for approval." |

**Expected Result:** Batch validation shows green, all employee records pass. Approval request is created and routed to the Approver role.

**Business Narration:**
> "Payroll is validated against GL account mappings before it ever goes to approval. The system checks for missing account codes, over-budget variances, and missing employee records. Nothing reaches the bank without passing those gates — and nothing posts to the general ledger without an approval."

**Stories Demonstrated:** S054B (payroll posting), S091B (GL automation from payroll)

**Recovery Step:** If batch shows POSTED, switch to the PR-2026-03-W3 batch — or recreate by running `yarn seed:all-159-demo --reset`.

---

### Step A-6 — OEM Reconciliation Summary

| Field | Value |
|-------|-------|
| **User** | `controller@kunes-demo.local` |
| **Legal Entity** | Kunes Chevrolet |
| **Route** | `/oem/statements` |
| **Seeded Record** | GM Q1 incentive statement, Factory Incentive Credit – GM Q1 journal |
| **Action** | Open the OEM statement. Show GM Q1 factory incentive import. Expand the matching panel — statement line matched to posted journal entry. Show unmatched line (intentional gap for demo). |

**Expected Result:** Statement displays with ≥1 matched line (green) and ≥1 unmatched line (amber). Co-op accounting summary shows $18,400 credit applied.

**Business Narration:**
> "Reconciling OEM factory statements used to take a week of manual work. Here, the statement is imported, the system automatically matches lines to posted journal entries, and the controller reviews only exceptions. Co-op advertising credits are tracked as their own accounting class — no more off-ledger spreadsheets."

**Stories Demonstrated:** S101B (OEM statement matching)

**Recovery Step:** If statement is empty, check oem-service health: `curl http://localhost:3052/health`.

---

### Step A-7 — Migration Status: Legacy Data Mapped

| Field | Value |
|-------|-------|
| **User** | `admin@kunes-demo.local` |
| **Legal Entity** | Kunes Ford |
| **Route** | `/migration/sources` |
| **Seeded Record** | CDK DMS source system registered, chart of accounts mapping |
| **Action** | Open migration dashboard. Show CDK DMS source registered. Click on account mapping — 85 accounts mapped, 4 flagged for review. |

**Expected Result:** Source system shows REGISTERED status. COA mapping shows green for mapped accounts and amber for exceptions.

**Business Narration:**
> "We are not asking the group to rebuild their books from scratch. The migration module ingests the CDK DMS export, maps every account to the new chart of accounts, and flags discrepancies for a human decision. The cutover is managed, audited, and reversible — not a big-bang overnight conversion."

**Stories Demonstrated:** S107 (migration cutover), S202 (source registration)

**Recovery Step:** If migration source is absent, check migration-service health and re-run `yarn seed:all-159-demo`.

---

### Step A-8 — Compliance Dashboard: SOX Evidence, MFA Status

| Field | Value |
|-------|-------|
| **User** | `auditor@kunes-demo.local` |
| **Legal Entity** | Kunes Ford |
| **Route** | `/compliance/dashboard` |
| **Seeded Record** | SOX evidence snapshots, MFA enrollment records |
| **Action** | Open the compliance dashboard. Show MFA enrollment: 11/11 users enrolled. Click SOX Evidence — show signed snapshot for the February 2026 period. Show the WORM archive status indicator. |

**Expected Result:** MFA coverage shows 100%. SOX evidence panel shows signed snapshots for at least two periods. WORM archive shows entries created (immutable badge).

**Business Narration:**
> "The auditor role is read-only by design — they cannot change anything they're reviewing. Every period produces a signed snapshot of the trial balance, stored in a write-once archive. When an auditor asks for evidence that February's books haven't changed since close, we can produce that cryptographically in seconds — not weeks."

**Stories Demonstrated:** S006 (MFA), S016 (signed snapshots), S017 (WORM archive), S128 (SOX evidence)

**Recovery Step:** If compliance dashboard is empty, check compliance-service: `curl http://localhost:3043/health`.

---

### Step A-9 — Real-Time Balance Verification

| Field | Value |
|-------|-------|
| **User** | `controller@kunes-demo.local` |
| **Legal Entity** | Kunes Ford |
| **Route** | `/gl/trial-balance` |
| **Seeded Record** | All posted journal entries |
| **Action** | Open trial balance. Show that total debits = total credits. Click "Verify Balance" button — system confirms $0.00 out of balance. |

**Expected Result:** Trial balance renders all accounts. Debit total = Credit total. Verification confirms balanced state.

**Business Narration:**
> "The trial balance is live, not a month-end export. Every posted entry is reflected immediately. Balance verification runs in under a second — if anything were out of balance, the system would prevent period close from proceeding."

**Stories Demonstrated:** S227 (financial statement rollup), S008 (GL posting)

**Recovery Step:** If balance shows discrepancy, re-run `yarn seed:all-159-demo --reset` to restore clean journal state.

---

### Tier A Closing Talking Points

> "What you saw today is a fully integrated automotive group accounting platform — not a set of loosely coupled tools. Every number ties back to a source transaction. Every approval is enforced. Every period is locked when it closes. And every action is permanently recorded in an audit trail the external auditor can verify independently. This is accounting modernization for automotive dealership groups."

---

---

## Tier B — Complete Application Demonstration (60–90 minutes)

**Objective:** Demonstrate all 26 module areas end-to-end for a technical or functional audience including CFO, Controller, and IT leadership. Each module section includes 3–6 specific workflow steps.

> **Tip for the presenter:** Keep each module to 3–5 minutes. Use the module heading as a time marker.

---

### Module A — Authentication, Logout, Tenant Selection, Rooftop Switching, MFA

**Route prefix:** `/login`, `/profile/mfa`

1. **Login:** Navigate to http://localhost:5174. Enter `admin@kunes-demo.local` / `KunesDemo2026!`. Observe JWT cookie set and redirect to dashboard.
2. **MFA enrollment display:** Go to `/profile/mfa`. Show that MFA is enrolled (TOTP authenticator linked). Demonstrate that the MFA bypass flag is `false` in production mode.
3. **Rooftop switch:** Open the entity switcher (top-left). Switch from Kunes Ford to Kunes Chevrolet. Observe data context change — journal count, COA, and period state all refresh.
4. **Tenant context:** Navigate to `/admin/tenant`. Show `tenant-kunes` — Kunes Demo Automotive Group. Show legal entities list.
5. **Logout:** Click user avatar → Logout. Confirm session is destroyed (redirect to `/login`, no cookie persists).
6. **Role demonstration:** Log in as `auditor@kunes-demo.local`. Navigate to `/gl/journals/new` — expect 403 Forbidden (read-only role blocked from write).

**Stories:** S005, S006

---

### Module B — Dashboards and Financial Reporting (Trial Balance, P&L, Balance Sheet)

**Route prefix:** `/dashboard`, `/reports`

1. **Executive dashboard:** Log in as `admin@kunes-demo.local`. Show KPI tiles: revenue, margin %, open AP, open AR, pending approvals.
2. **Trial balance:** Navigate to `/reports/trial-balance`. Select entity Kunes Ford, period March 2026. Export as CSV (button in header).
3. **P&L:** Navigate to `/reports/pl`. Show March 2026 P&L — revenue $2.1M estimate, cost of sales, gross profit, operating expenses. Compare to February (HARD_CLOSED).
4. **Balance sheet:** Navigate to `/reports/balance-sheet`. Show assets, liabilities, equity. Verify assets = liabilities + equity.
5. **Financial statement rollup:** Navigate to `/reports/consolidated`. Show combined Kunes Ford + Kunes Chevrolet consolidated view with intercompany eliminations applied.
6. **Drill-through:** Click a revenue line on the P&L → drill to source journal entries → click one entry → see full debit/credit detail.

**Stories:** S227, S202, S096 (intercompany)

---

### Module C — Chart of Accounts, Fiscal Calendar, Periods, Mappings, Rule Packs

**Route prefix:** `/setup/coa`, `/setup/fiscal-calendar`, `/setup/periods`

1. **COA browse:** Navigate to `/setup/coa`. Show the automotive-structured chart: 1xxx Assets, 2xxx Liabilities, 3xxx Equity, 4xxx Revenue, 5xxx Cost of Sales, 6xxx Operating Expenses. Filter by account type.
2. **COA add account:** As `admin@kunes-demo.local`, add a new expense account (6510 Demo Marketing). Save. Verify it appears in the list.
3. **Fiscal calendar:** Navigate to `/setup/fiscal-calendar`. Show FY2026, 12 periods. Show that March is the current open period.
4. **Period states:** Show period states table: Jan LOCKED, Feb HARD_CLOSED, Mar IN_PROGRESS.
5. **Account mappings:** Navigate to `/setup/account-mappings`. Show CDK DMS → new COA mappings. Highlight a flagged mapping (amber) requiring human review.
6. **Rule packs:** Navigate to `/setup/rule-packs`. Show the F&I reserve rule pack — defines how Finance Reserve and Chargeback are posted automatically to specific accounts.

**Stories:** S023 (COA/periods), CE12 (rule packs), CE13 (fiscal calendar)

---

### Module D — Journal Creation, Approval, Posting, Reversal, Audit Lineage

**Route prefix:** `/gl/journals`

1. **Create journal:** Log in as `accountant@kunes-demo.local`. Navigate to `/gl/journals/new`. Enter description "Accrued Advertising March", add two lines: DR 6220 Advertising Expense $8,400 / CR 2100 Accrued Liabilities $8,400. Save as DRAFT.
2. **Submit for approval:** Click "Submit for Approval." Confirm status moves to PENDING_APPROVAL.
3. **Approve:** Log in as `approver@kunes-demo.local`. Navigate to `/approvals`. Locate the journal. Click Approve.
4. **Post:** As Approver or Controller, click "Post Journal." Status moves to POSTED. Confirm trial balance updates.
5. **Reversal:** Navigate to the posted journal. Click "Create Reversal." Confirm reversal journal created with reversed lines, linked to original. Post the reversal.
6. **Audit lineage:** Open the original journal → Audit tab. Show creation event, submission, approval (with approver name + timestamp), posting, and reversal link — complete immutable lineage.

**Stories:** S008, S014, S026, S027, S016 (signed snapshot on post)

---

### Module E — Schedules and Open Items

**Route prefix:** `/schedules`, `/open-items`

1. **Schedule list:** Navigate to `/schedules`. Show amortization schedules for prepaid insurance and deferred revenue.
2. **Open items:** Navigate to `/open-items`. Show open items for Kunes Ford: unapplied cash, disputed invoice, pending warranty credit.
3. **Amortization entry:** Open a prepaid insurance schedule. Show that March amortization entry was auto-generated. Confirm it is posted.
4. **Aging:** Show open item aging buckets: current, 30, 60, 90+ days.
5. **Clear item:** Apply a payment to an open item (simulate receiving check). Confirm open item is cleared.

**Stories:** S220, S221

---

### Module F — AP: Vendor Invoices, Approvals, Payments, PO Matching, 1099

**Route prefix:** `/ap`

1. **Vendor invoice entry:** Log in as `ap.clerk@kunes-demo.local`. Navigate to `/ap/invoices/new`. Enter a Snap-on Tools invoice: $3,250, due 30 days, GL account 6410 Parts & Tools Expense.
2. **PO matching:** Navigate to an existing invoice. Open the PO Match panel. Show 3-way match (PO + Receipt + Invoice) with $0.01 tolerance pass.
3. **AP approval:** Submit invoice for approval. Log in as `approver@kunes-demo.local`. Approve the invoice.
4. **Payment run:** Navigate to `/ap/payments`. Select approved invoices due this week. Generate ACH payment batch. Show payment summary: $24,800 total.
5. **1099 tracking:** Navigate to `/ap/vendors`. Filter by 1099-eligible. Show that amounts paid YTD are tracked per vendor for 1099 reporting.
6. **Aging:** Navigate to `/ap/aging`. Show AP aging by vendor: current, 30, 60, 90+ days. Identify oldest outstanding item.

**Stories:** S036B (AP), S038 (vendor insurance), CE08 (payment run)

---

### Module G — AR: Receipts, Unapplied Cash, NSF, Write-offs, Aging

**Route prefix:** `/ar`

1. **Receipt entry:** Log in as `ar.clerk@kunes-demo.local`. Navigate to `/ar/receipts/new`. Record a customer payment $4,800, check number 10211.
2. **Apply to invoice:** Navigate to `/ar/unapplied`. Find the $4,800 unapplied cash. Apply it to open invoice INV-2026-03-0042. Confirm unapplied balance clears.
3. **NSF handling:** Navigate to `/ar/receipts`. Locate a previously posted receipt flagged NSF. Click "Process NSF" — system creates reversal journal and re-opens the original invoice.
4. **Write-off:** Navigate to `/ar/write-offs/new`. Write off a $320 small balance deemed uncollectible. System posts DR Bad Debt Expense / CR AR.
5. **AR aging:** Navigate to `/ar/aging`. Show aging by customer: current, 30–60, 60–90, 90+. Identify top overdue customers.
6. **Collections flag:** Mark a 90+ day customer account for collections. Confirm flag is visible in AR aging.

**Stories:** CE09 (AR), S222 (AR payments)

---

### Module H — Cash and Bank Reconciliation, Import, Match, Confirm

**Route prefix:** `/cash`

1. **Bank statement import:** Log in as `cashier@kunes-demo.local`. Navigate to `/cash/import`. Upload a CSV bank statement (Ford bank account). Show import preview — 28 transactions parsed.
2. **Auto-match:** Click "Auto-Match." System matches 24 of 28 transactions automatically. Show matched pairs.
3. **Manual match:** Locate an unmatched bank debit. Find the corresponding GL cash entry. Manually link them. Confirm match.
4. **Confirm reconciliation:** Click "Confirm Reconciliation." System records the reconciliation with timestamp and user.
5. **Reconciliation report:** Navigate to `/cash/reconciliation-history`. Show the completed reconciliation report — opening balance, transactions, closing balance, difference $0.00.

**Stories:** S008 (cash entries), CE15 (bank recon)

---

### Module I — Fixed Ops: Repair Orders, Labor, Parts, Warranty Accounting

**Route prefix:** `/fixedops`

1. **Repair order list:** Log in as `service.mgr@kunes-demo.local`. Navigate to `/fixedops/repair-orders`. Show seeded ROs: Customer Pay #8834, Warranty #8841, Body Shop #B-412.
2. **Customer pay RO:** Open RO #8834. Show labor lines ($320), parts ($184), total $504. Show how revenue is allocated: Service Revenue account 4200.
3. **Warranty RO:** Open RO #8841. Show warranty claim lines. Confirm warranty receivable account 1310 is debited — cash is recovered from the manufacturer, not the customer.
4. **Body shop / insurance:** Open RO #B-412. Show insurance claim — AR insurance subaccount, not retail customer account.
5. **Accounting posting:** Open any RO and click "View Accounting." Show the system-generated journal entry. Every labor line and parts line traces to a posted GL entry.

**Stories:** CE14 (Fixed Ops), S023 (accounting rules)

---

### Module J — Parts Inventory: Purchase, Receipt, Returns, Valuation

**Route prefix:** `/parts`

1. **Parts purchase:** Navigate to `/parts/purchase-orders`. Show open PO for Motorcraft filters — 200 units at $8.40 each.
2. **Receipt:** Navigate to `/parts/receipts`. Show receipt against that PO — 198 units received. Show inventory DR, AP CR journal auto-generated.
3. **Return:** Navigate to `/parts/returns`. Show a 5-unit return to vendor. System reverses inventory and AP entries.
4. **Valuation:** Navigate to `/parts/valuation`. Show FIFO cost layering — March cost layer shows $8.40, February layer $8.25.
5. **Inventory adjustment:** Make a small physical count adjustment (+2 units). Show the adjustment journal posted to inventory adjustment account 5410.

**Stories:** S103B (parts valuation), CE16 (parts inventory)

---

### Module K — Vehicle: Floorplan, Acquisition, Deal Accounting, F&I Reserve

**Route prefix:** `/vehicle`, `/deal`, `/fni`

1. **Floorplan balance:** Navigate to `/vehicle/floorplan`. Show active floorplan: 24 units, $1.2M outstanding, Ford Motor Credit as lender. Show interest accrual journal for March.
2. **Vehicle acquisition:** Navigate to `/vehicle/inventory`. Show new vehicle #VIN-2026-F150-001 (F-150 XLT MSRP $52,800) on floorplan. Show acquisition journal: DR Vehicle Inventory / CR Floorplan Payable.
3. **Deal accounting:** Navigate to `/deal/deals`. Open Deal #D-1221. Show deal structure: selling price $48,500, cost $42,000, gross $6,500. Show F&I products: extended warranty $2,200, GAP $890.
4. **F&I reserve:** Navigate to `/fni/reserves`. Show reserve earned on Deal #D-1221: finance reserve $840, product reserve $1,100. Show the reserve journal — unearned at deal, earned over time.
5. **Floorplan payoff:** On deal close, show floorplan payoff journal: DR Floorplan Payable CR Cash, inventory unit retired.

**Stories:** S095 (portfolio reserve), CE12 (deal accounting rules), CE17 (F&I)

---

### Module L — Payroll: Batch, Validate, Approve, Post, GL Reconcile

**Route prefix:** `/payroll`

1. **Batch list:** Log in as `payroll@kunes-demo.local`. Navigate to `/payroll/batches`. Show posted batches for PR-2026-02-W4, PR-2026-03-W1, PR-2026-03-W2. Show voided batch PR-2026-02-W3-REV.
2. **Open pending batch:** Open PR-2026-03-W3 (PENDING_APPROVAL). Show employee breakdown — gross $348,000, deductions $105,000, net $243,000.
3. **Validate:** Click "Validate Batch." Show validation report: 0 errors, 2 warnings (overtime flag). Review and dismiss warnings.
4. **Approve:** Log in as `approver@kunes-demo.local`. Approve the payroll batch.
5. **Post to GL:** As payroll manager, click "Post." System generates payroll journal: DR Wages Expense, DR Payroll Tax Expense / CR Cash, CR Payroll Tax Payable. Show journal in GL.
6. **GL reconcile:** Navigate to `/payroll/gl-reconcile`. Show that payroll liability account 2200 matches net pay total and payable account 2210 matches tax liability.

**Stories:** S054B (payroll posting), S091B (GL automation from payroll)

---

### Module M — OEM: Statement Import, Matching, Co-op Accounting

**Route prefix:** `/oem`

1. **Import statement:** Log in as `controller@kunes-demo.local`. Navigate to `/oem/import`. Show the GM Q1 statement import — 14 lines parsed.
2. **Auto-match:** Click "Auto-Match." System matches 11 of 14 lines to posted journals. Show matched panel with confidence scores.
3. **Manual match:** Take one unmatched OEM line. Search for a matching journal entry. Link them.
4. **Unmatched exceptions:** Show 2 unmatched lines flagged for investigation — one is a new incentive program not yet in the COA.
5. **Co-op accounting:** Navigate to `/oem/coop`. Show co-op advertising credit $4,200 — posted as a credit to advertising expense and debit to OEM receivable.
6. **Statement reconciliation:** Show statement balance vs. GL balance for the OEM receivable account — $0.00 difference.

**Stories:** S101B (OEM matching), CE11 (OEM upstream reconciliation)

---

### Module N — Tax: Engine Configuration, Rate Tables, Regulatory Fee Resolution

**Route prefix:** `/tax`

1. **Tax engine config:** Log in as `admin@kunes-demo.local`. Navigate to `/tax/config`. Show tax engine enabled for Illinois. Show effective date of rate table.
2. **Rate tables:** Navigate to `/tax/rates`. Show state sales tax 6.25%, county 1.75%, total 8.00% for Cook County. Show a custom regulatory fee: $25 title fee.
3. **Tax on a deal:** Navigate to Deal #D-1221 tax breakdown. Show $3,880 sales tax computed (8.00% × $48,500). Show title fee $175 (7 × $25).
4. **Regulatory fee resolution:** Navigate to `/tax/fees`. Show that the title fee maps to account 2300 Tax & Fee Payable — separate from sales tax.
5. **Tax posting:** Show the tax liability journal on deal close: DR Tax Receivable / CR Tax Payable, and separate regulatory fee entry.

**Stories:** S124 (tax engine), S125 (regulatory fees)

---

### Module O — Period Close and Reopen with Checklist and SoD Enforcement

**Route prefix:** `/close`

1. **Close dashboard:** Log in as `controller@kunes-demo.local`. Navigate to `/close/status`. Show all periods for both entities.
2. **Close checklist:** Open March 2026 for Kunes Ford. Show the checklist: 7 tasks. Click through completed tasks — bank recon, AP aging, payroll posting, journal approvals.
3. **Incomplete task block:** Attempt to advance the period to SOFT_CLOSE with one checklist item incomplete. System rejects — "All checklist items must be completed before advancing."
4. **Complete checklist:** Mark remaining item complete (OEM statement reconciled). Advance to SOFT_CLOSE.
5. **SoD enforcement:** As `accountant@kunes-demo.local` (not controller), attempt to lock the period — system rejects: "LOCK requires the Controller role."
6. **Reopen:** As controller, reopen February HARD_CLOSED. System requires reason code (AUDIT_ADJUSTMENT). Reopen is logged in the audit trail with mandatory justification.

**Stories:** S023 (period close), CE11 (SoD enforcement), S016 (signed snapshot on close)

---

### Module P — Migration: Source System Registration, Mapping, Cutover

**Route prefix:** `/migration`

1. **Source system:** Log in as `admin@kunes-demo.local`. Navigate to `/migration/sources`. Show CDK DMS registered for Kunes Ford — status REGISTERED.
2. **Account mapping:** Navigate to `/migration/mappings`. Show the COA mapping table: 85 accounts mapped, 4 flagged exceptions. Open a flagged exception — old account "Used Car Floorplan" maps to two possible new accounts.
3. **Resolve exception:** Select the correct new account (1420 – Used Vehicle Floorplan) and confirm. Exception clears.
4. **Dry-run cutover:** Click "Run Dry-Run Cutover." System validates all mappings — 0 unmapped accounts remaining. Show validation summary.
5. **Cutover package:** Show the cutover package: opening balance snapshot, migration run log, and confirmation of immutable archive entry.
6. **Migration audit:** Navigate to `/migration/audit`. Show full log of every mapping change, who made it, and when.

**Stories:** S107 (migration cutover), S202 (source registration)

---

### Module Q — Automation: Capability Registry, OBSERVE_ONLY Workflows

**Route prefix:** `/automation`

1. **Capability registry:** Log in as `admin@kunes-demo.local`. Navigate to `/automation/capabilities`. Show registered capabilities: GL auto-post, payroll GL sync, OEM auto-match.
2. **OBSERVE_ONLY mode:** Open the GL auto-post capability. Status shows OBSERVE_ONLY — the agent analyzes and suggests but does not execute automatically.
3. **Observation log:** Navigate to `/automation/observations`. Show recent observations: "Suggested: auto-reverse accrual JE-2026-03-0041 on April 1." Show that suggestion was not acted upon automatically.
4. **Enable for a workflow:** Simulate promoting one workflow to ACTIVE for demo purposes — show the confirmation dialog with audit log requirement.
5. **Agent health:** Navigate to `/automation/agents`. Show agent-gl (port 3020) and agent-payroll (port 3022) status: IDLE, healthy.

**Stories:** S091B (GL automation), CE17 (automation registry)

---

### Module R — Compliance: MFA, Signed Snapshots, WORM/Archive, SOX Evidence

**Route prefix:** `/compliance`

1. **MFA status:** Log in as `auditor@kunes-demo.local`. Navigate to `/compliance/mfa`. Show 11/11 users enrolled, 0 exceptions.
2. **Signed snapshots:** Navigate to `/compliance/snapshots`. Show February 2026 snapshot — signed with SHA-256 hash, immutable flag set.
3. **Verify snapshot:** Click "Verify Signature" on the February snapshot. System re-computes hash and confirms match — "Snapshot integrity verified."
4. **WORM archive:** Navigate to `/compliance/archive`. Show WORM entries — each close event produces an archive record that cannot be deleted or modified.
5. **SOX evidence package:** Navigate to `/compliance/sox-evidence`. Show downloadable evidence bundle for Feb 2026: trial balance, signed snapshot, journal approval log, period close log.
6. **Audit trail search:** Navigate to `/compliance/audit`. Search for events by user `approver@kunes-demo.local`. Show full chronological event list with entity, action, and timestamp.

**Stories:** S006 (MFA), S016 (signed snapshots), S017 (WORM), S128 (SOX evidence)

---

### Module S — Allocations, Intercompany, Consolidation Eliminations

**Route prefix:** `/allocations`, `/intercompany`, `/reports/consolidated`

1. **Allocation rule:** Log in as `controller@kunes-demo.local`. Navigate to `/allocations/rules`. Show overhead allocation rule: shared IT expense $24,000 split 60% Ford / 40% Chevrolet by headcount.
2. **Run allocation:** Click "Run March Allocations." System generates two journal entries — $14,400 DR Ford, $9,600 DR Chevrolet.
3. **Intercompany transaction:** Navigate to `/intercompany/transactions`. Show an intercompany loan between Kunes Ford and Kunes Chevrolet — $50,000 outstanding.
4. **Intercompany elimination:** Navigate to `/reports/consolidated`. Click "Apply Eliminations." System offsets the intercompany receivable/payable pair before consolidation.
5. **Consolidated trial balance:** Show the consolidated trial balance — both entities combined, intercompany items eliminated. Total assets reconcile.

**Stories:** S033 (allocations), S096 (intercompany)

---

### Module T — Newly Completed Stories

For each story below, demonstrate the specific capability and its integration point.

| Story | What to Show | Route |
|-------|-------------|-------|
| **S005 HR Provisioning** | Bob's account auto-provisioned from Workday HR event `HR_USER_ROLE_CHANGED`. Show user `bob@kunes-demo.local` in user list with role set by HR event. | `/admin/users` |
| **S006 MFA** | MFA enrollment panel, enforcement on login, 100% coverage report. | `/profile/mfa`, `/compliance/mfa` |
| **S016 Signed Snapshots** | Snapshot for Feb 2026 — hash value, immutability flag, verify button. | `/compliance/snapshots` |
| **S017 WORM Archive** | WORM entries created on each period close. Show delete attempt rejected. | `/compliance/archive` |
| **S033 Allocations** | Overhead allocation rule, run result, two allocation journals. | `/allocations` |
| **S054B Payroll Posting** | Posted payroll batch journals, GL debit/credit breakdown. | `/payroll/batches` |
| **S091B GL Automation** | OBSERVE_ONLY agent suggestions, no auto-execution in this mode. | `/automation/observations` |
| **S095 Portfolio Reserve** | F&I portfolio reserve earned on deal #D-1221. | `/fni/reserves` |
| **S096 Intercompany** | Intercompany loan + elimination in consolidated reports. | `/intercompany` |
| **S101B OEM Matching** | GM Q1 statement matched to posted journals. | `/oem/statements` |
| **S103B Parts Valuation** | FIFO cost layers, inventory adjustment journal. | `/parts/valuation` |
| **S107 Migration Cutover** | Dry-run cutover validation, opening balance snapshot. | `/migration` |
| **S124 Tax Engine** | Rate table, deal tax computation, tax liability journal. | `/tax` |
| **S125 Regulatory Fees** | Title fee $175 on deal, mapped to separate payable account. | `/tax/fees` |
| **S128 SOX Evidence** | SOX evidence bundle download for Feb 2026 audit period. | `/compliance/sox-evidence` |

---

---

## Tier C — Module-Specific SME Deep Dives

Brief guide for subject matter expert audiences. Each section is a standalone 15–30 minute deep dive.

---

### SME: General Ledger (GL)

- Walk the COA structure (1xxx–6xxx automotive classification)
- Create a multi-line journal with 4+ account codes
- Show the journal approval matrix — who can approve what amounts
- Demonstrate journal reversal and the linked audit lineage
- Run trial balance for a closed period vs. open period — show read-only lock
- Show the automation capability registry and the OBSERVE_ONLY GL agent
- Deep-dive the signed snapshot process: when is it triggered, what is hashed, where is it stored
- Demonstrate posting recovery service — what happens if a post fails mid-flight

---

### SME: Accounts Payable (AP)

- Vendor master — add a new vendor with 1099 flag
- Full 3-way PO match walkthrough — tolerance settings, partial match
- Invoice approval matrix — amounts under $5K auto-approve, over $5K require controller
- ACH payment batch — bank format, remittance advice
- Aged payables report — filter by vendor, date range, GL account
- 1099 summary report — YTD amounts by vendor

---

### SME: Accounts Receivable (AR)

- Customer setup and credit limit configuration
- Billing from deal vs. manual AR invoice
- Cash receipt — check, ACH, wire — different entry paths
- Unapplied cash resolution workflow
- NSF process — reversal journal, re-open invoice, fee posting
- Bad debt write-off with reserve method
- AR aging report with drill-through to source invoice

---

### SME: Payroll

- Payroll batch structure — pay period, pay date, employee count
- Validation rules — missing GL codes, overtime thresholds, budget variance
- Payroll journal anatomy — gross wages, each deduction type, employer tax
- GL reconciliation report — payroll expense vs. budget
- Void and reissue workflow for a single employee paycheck
- Year-end close implications — accrued wages, W-2 preparation readiness

---

### SME: Fixed Ops

- Repair order lifecycle — open, labor posting, parts posting, close
- Customer pay vs. warranty vs. internal vs. sublet
- Warranty claim accounting — receivable, OEM reconciliation linkage
- Body shop / insurance — AR subaccount separation
- Fixed Ops P&L report — labor gross, parts gross, total service department contribution
- Flat-rate labor calculation and technician productivity metrics

---

### SME: Parts

- Parts purchase order → receipt → inventory valuation
- FIFO cost layer demonstration — cost layering by receipt date
- Bin and location tracking (if configured)
- Physical count adjustment — journal entry and approval
- Parts return to vendor — reversal of receipt, AP credit memo
- Parts inventory aging — slow-moving and obsolete parts flag

---

### SME: Vehicle / Deal / F&I

- New vehicle acquisition — floorplan draw, inventory accounting
- Deal desking — retail price, trade allowance, lender advance
- Finance reserve calculation — lender gross income spread
- F&I product accounting — extended warranty, GAP, VSC
- Deal close accounting — floorplan payoff, cost of sales, gross profit
- Portfolio reserve amortization — earned income over contract term
- Chargeback handling — reserve reversal on early payoff

---

### SME: OEM

- OEM statement import — CSV/EDI format requirements
- Auto-match algorithm — statement line → GL entry matching logic
- Match tolerance configuration (exact match vs. ±$1 tolerance)
- Co-op advertising accrual and earned/unearned split
- Factory incentive credit — receivable setup, cash receipt, close
- OEM statement aging — outstanding OEM receivables

---

### SME: Tax

- Tax engine configuration — jurisdictions, effective dates
- Rate table management — state, county, city, special district
- Deal tax calculation walkthrough — taxable amount, tax amount, journal
- Regulatory fee table — DMV fees, title fees, tire tax
- Tax liability reconciliation — payable account to returns filed
- Tax audit support — drill-through from tax return line to source deals

---

### SME: Period Close

- Close checklist configuration — which tasks are required, which are advisory
- Close sequence: OPEN → IN_PROGRESS → SOFT_CLOSE → HARD_CLOSED → LOCKED
- Separation of duties enforcement at each close stage
- Reopen workflow — required justification, controller override, audit log
- Signed snapshot trigger — exactly when is the snapshot created
- Close report package — what is included in the controller sign-off package

---

### SME: Migration

- Source system registration — CDK DMS connector configuration
- Account mapping table — legacy code → new COA code
- Exception handling — unmapped accounts, duplicate accounts
- Dry-run validation — what checks are performed
- Cutover package — opening balances, migration run log, immutable archive
- Post-migration reconciliation — legacy trial balance vs. new system trial balance

---

### SME: Automation

- Capability registry architecture — how capabilities are registered
- OBSERVE_ONLY vs. ACTIVE mode — risk controls, promotion workflow
- Observation log — what the agent sees, what it recommends
- Human-in-the-loop confirmation — what triggers a required human step
- Agent health monitoring — port 3020 (GL), 3021 (EOM), 3022 (Payroll)
- Rollback capability — if an automated action is incorrect, how is it reversed

---

### SME: Compliance

- MFA enrollment and enforcement — TOTP configuration, bypass conditions
- Audit trail architecture — what events are captured, storage format
- Signed snapshot integrity — SHA-256, storage location, verification API
- WORM archive — immutability guarantee, retention policy
- SOX evidence package — what a complete evidence bundle contains
- User access review — export of all user roles and last login for SOX ITGC

---

*Last updated: 2026-08-04 | ALL-159 stakeholder demonstration*
