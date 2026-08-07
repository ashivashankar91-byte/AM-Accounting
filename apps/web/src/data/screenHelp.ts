/**
 * screenHelp.ts — Comprehensive help content for every AMACC page.
 *
 * Each entry maps a route key to structured help data displayed by
 * the HelpButton component on that page.
 *
 * Help content is curated from:
 *   - 684 legacy COBOL screen definitions (screen_metadata.json)
 *   - 105 accounting screens grouped by business function
 *   - 699 Java REST endpoint descriptions
 *   - Legacy UI workflows and field requirements
 */

import type { ScreenHelp } from '../components/HelpButton';

const SCREEN_HELP: Record<string, ScreenHelp> = {

  // ═══════════════════════════════════════════════════════════════
  // CORE PAGES
  // ═══════════════════════════════════════════════════════════════

  dashboard: {
    title: 'Dashboard',
    overview: 'The Dashboard provides a bird\'s-eye view of your dealership accounting operations. It shows key performance indicators (KPIs) at the top, active AI agent alerts that need human attention, the current End-of-Month close pipeline, and the most recent journal entries.',
    sections: {
      'KPI Cards': 'Four summary cards showing today\'s GL entries count, active EOM close processes, total agent interventions, and items requiring human review. Red highlights indicate urgent attention needed.',
      'Agent Alerts': 'When AI agents (GL Integrity, EOM Orchestration, Payroll, AP/AR) flag items needing human review, they appear here in red. Click "Resolve" to address each alert.',
      'EOM Pipeline': 'Visual representation of the current month-end close process. Each step shows its status: green (done), blue (running), red (blocked), gray (pending).',
      'Recent Entries': 'The 10 most recent journal entries with date, description, source, and posting status.',
    },
    tips: [
      'Check the dashboard first thing each morning for overnight agent activity',
      'Red "Human Required" count > 0 means agents need your decision before proceeding',
      'Click on any entry to navigate to the full General Ledger page',
    ],
  },

  'general-ledger': {
    title: 'General Ledger',
    overview: 'The General Ledger page is the core of your accounting system. It provides three views: Journal Entries for creating and posting transactions, Chart of Accounts for managing GL account definitions, and Trial Balance for period-end account balance verification.',
    sections: {
      'Journal Entries Tab': 'View, create, and post journal entries. Draft entries can be posted individually. Each entry shows the date, description, source (manual, agent, import), posting status, and whether an AI agent has reviewed it. The robot icon (🤖) indicates agent-verified entries.',
      'Chart of Accounts Tab': 'Complete list of GL accounts with code, name, type (Asset/Liability/Equity/Revenue/Expense), and active status. Account codes follow the standard dealership chart mapped to your OEM requirements.',
      'Trial Balance Tab': 'Period-specific trial balance showing all accounts with debit and credit balances. Select the year and month to view. Totals at the bottom must balance (debits = credits). Any imbalance indicates a posting error.',
    },
    tips: [
      'Always verify trial balance totals match before starting EOM close',
      'Draft entries not posted by month-end will carry forward — review regularly',
      'The AI GL Integrity agent automatically flags suspicious entries',
      'Use source codes to trace entries back to their originating module (AP, AR, Payroll, etc.)',
    ],
    legacyScreens: ['inqglacc', 'inqglhst', 'inqtran'],
    legacyContext: 'Replaces COBOL screens: GL Account Inquiry (INQGLACC), GL History Inquiry (INQGLHST), and Transaction Inquiry (INQTRAN). The legacy system required separate screens for each function — this page consolidates them into one tabbed interface.',
  },

  'eom-close': {
    title: 'EOM Close',
    overview: 'The EOM Close page manages the month-end closing process. The AI EOM Orchestration agent handles most steps automatically, but some require human approval. Each close follows a defined pipeline of steps that must complete in order.',
    sections: {
      'Current Close': 'Shows the active month-end close with its step pipeline. Each step is color-coded: green (complete), blue with animation (running), red (blocked), gray (pending). Use "Advance" to manually move to the next step, or "Retry" if a step failed.',
      'Initiate Close': 'Click "Initiate Close" to start a new month-end closing for the current period. The system validates that no unposted transactions remain before allowing close initiation.',
      'Historical Closes': 'Table showing all previous month-end closes with their period, status, start date, and completion date. Use this to track close duration trends.',
    },
    tips: [
      'Run trial balance BEFORE initiating EOM close to verify all accounts balance',
      'The EOM agent checks for unposted transactions, schedule discrepancies, and GL balance integrity',
      'If a step is blocked, review the error message — common causes include unmatched bank items or pending AP invoices',
      'Historical close data helps identify bottlenecks in your month-end process',
    ],
    legacyScreens: ['sysupeod'],
    legacyContext: 'Replaces the COBOL End of Day/Month screen (SYSUPEOD). The legacy system required manual execution of each close step through a series of menu selections. The new system automates the pipeline with AI oversight.',
  },

  payroll: {
    title: 'Payroll',
    overview: 'The Payroll page manages payroll batch processing. Batches flow through a pipeline: Pending → Validated → Posted. The AI Payroll Integrity agent automatically validates batches and flags anomalies, placing suspicious batches on hold for human review.',
    sections: {
      'Held Batches Alert': 'Yellow alert box showing batches that the AI agent has placed on hold. Each shows the batch reference, amount, and reason for hold. Click "Release" to approve and continue processing.',
      'Payroll Batches Table': 'Complete list of all payroll batches with reference, period dates, amount, status, submission date, and available actions. Use "Validate" on pending batches and "Post" on validated ones.',
    },
    tips: [
      'Always review the held reason before releasing a batch — the AI flags genuine anomalies',
      'Held batches typically involve: overtime limit exceeded, missing tax IDs, or unusual amounts',
      'Posted batches automatically generate GL journal entries in the Accounting source',
      'Run payroll validation before the 15th and end of each month',
    ],
  },

  reconciliation: {
    title: 'Bank Reconciliation',
    overview: 'Bank Reconciliation matches your GL cash account balances against bank statement records. The AI AP/AR Recon agent attempts automatic matching first, leaving unmatched items for human review.',
    sections: {
      'Recon Sessions Table': 'Each row represents a reconciliation session for a specific bank account. Shows the GL balance (from your books), bank balance (from statement), and the variance between them. A zero variance means fully reconciled.',
      'Status Indicators': 'OPEN = session started, IN_PROGRESS = matching underway, COMPLETED = fully reconciled. Click "Complete" when all items are matched and variance is acceptable.',
    },
    tips: [
      'Outstanding checks and deposits in transit are the most common causes of variance',
      'The AI agent auto-matches based on amount, date proximity, and reference numbers',
      'Review unmatched items weekly, not just at month-end',
      'Import bank statements in OFX/CSV format for automatic transaction loading',
    ],
  },

  'financial-statements': {
    title: 'Financial Statements',
    overview: 'Financial Statements generates OEM-formatted financial reports (GM, Ford, FCA, Toyota, Honda, etc.). Each OEM has a specific format requirement. The system maps your GL accounts to the OEM\'s standard chart, generates the statement, and allows AI agents to annotate potential issues before submission.',
    sections: {
      'Period & OEM Selection': 'Choose the reporting period (year-month) and target OEM. The system uses OEM-specific GL account mappings to populate each line item.',
      'Generate Preview': 'Click to build the financial statement from current GL data. Preview shows all pages and line items with calculated amounts.',
      'Statement Pages': 'Each OEM statement has multiple pages (Balance Sheet, Income Statement, etc.). Lines highlighted in yellow have been annotated by AI agents.',
      'Agent Annotations': 'AI agents review generated statements for anomalies — unusual variances from prior period, missing mappings, or balance inconsistencies. Each annotation shows severity (CRITICAL/WARN/INFO).',
      'Submit to OEM': 'Once reviewed, submit the statement electronically. Status tracks: DRAFT → SUBMITTED → ACCEPTED/REJECTED.',
    },
    tips: [
      'Generate preview AFTER completing EOM close for accurate numbers',
      'Review all CRITICAL and WARN annotations before submitting',
      'OEM rejections are usually caused by unmapped GL accounts — check the COA mapping page',
      'Keep 13th-month adjustments separate from regular period statements',
      'Compare current period to prior period for each page to catch anomalies',
    ],
    legacyScreens: [
      'consolcl', 'consolg2', 'consolgl', 'consoli2', 'consolim', 'consolpr',
      'finchoic', 'finchrup', 'finconky', 'finconup', 'finedt1a', 'finedt1b',
      'finedt1c', 'finedt1d', 'finedt2', 'finedt3a', 'finedt3b', 'finedt4',
      'finedt5', 'finedt6', 'finedtm', 'finfmtup', 'finhonup', 'finste13',
      'finstep', 'finstep3', 'finstmky', 'finstmmv', 'finstmp1', 'finstmp2',
      'finstmpg', 'finstmu2', 'finstmu3', 'finstmup', 'menufs', 'menufstm',
    ],
    legacyContext: 'Consolidates 36 COBOL Financial Statement screens into a single modern interface. The legacy system had separate screens for each step: format selection (FINCHOIC), editing lines (FINEDT1A-6), Honda-specific updates (FINHONUP), consolidated FS (CONSOLGL), format upload (FINFMTUP), 13th month FS (FINSTE13), and various step/key screens. The new system handles all these workflows in one page with OEM-aware formatting.',
  },

  approvals: {
    title: 'Approvals',
    overview: 'The Approvals page is your control panel for AI agent decisions. When agents detect situations requiring human judgment, they create approval requests here. This ensures no automated action exceeds your comfort level.',
    sections: {
      'Pending Approvals': 'Cards showing each pending request from AI agents. Each includes the agent name, what action it wants to take, its reasoning, affected entity, and supporting evidence. Approve to let the agent proceed, or Reject to block the action.',
      'Approval History': 'Complete audit trail of all past approval decisions showing agent, action, entity, status (Approved/Rejected/Expired), and date.',
    },
    tips: [
      'Approval requests auto-expire after the shown deadline if not acted upon',
      'Rejected actions are logged — the agent may try a different approach',
      'High-value transactions (>$10,000) always require approval regardless of agent confidence',
      'Review the evidence section carefully — agents provide specific data points supporting their recommendation',
    ],
  },

  agents: {
    title: 'AI Agents',
    overview: 'The AI Agents page lets you monitor all five accounting AI agents and interact with the T1 Copilot. Each agent handles a specific domain: GL Integrity validates journal entries, EOM Orchestration manages month-end closing, Payroll Integrity checks payroll batches, AP/AR Recon reconciles payables and receivables, and T1 Copilot answers your accounting questions.',
    sections: {
      'Agent Cards': 'Five cards showing each agent with its total action count. Agents operate continuously in the background.',
      'Human Required Queue': 'Items flagged by any agent for human decision. Click "Resolve" after reviewing and taking action.',
      'T1 Copilot Chat': 'Interactive chat with the T1 accounting AI. Ask questions about GL balances, transaction history, OEM requirements, or any accounting topic. T1 has full context of your dealership\'s data.',
      'Activity Log': 'Chronological table of all agent actions with agent name, action taken, outcome, whether human review was needed, and timestamp.',
    },
    tips: [
      'T1 Copilot can explain any number on your financial statements — just ask',
      'Agent actions are logged immutably for audit compliance',
      'Human Required items should be addressed promptly to avoid blocking automated processes',
      'Each agent learns from your approval/rejection patterns to improve future recommendations',
    ],
  },

  analytics: {
    title: 'Analytics',
    overview: 'Analytics provides visual insights into your accounting operations over time. Use these charts to identify trends, bottlenecks, and areas needing attention.',
    sections: {
      'GL Posting Volume': 'Bar chart showing daily journal entry counts. Spikes may indicate batch imports or month-end activity.',
      'Agent Interventions': 'Breakdown of AI agent actions by agent type. Increasing interventions may indicate data quality issues.',
      'EOM Close Duration': 'Historical trend of how long each month-end close took. Target: decreasing over time as processes stabilize.',
      'Payroll Summary': 'Grid showing batch counts by status. High held/rejected counts warrant investigation.',
    },
    tips: [
      'Compare posting volume to prior months for seasonal patterns',
      'Decreasing EOM close duration indicates process maturity',
      'Use agent intervention data to identify training needs',
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // NEW ACCOUNTING MODULE PAGES
  // ═══════════════════════════════════════════════════════════════

  transactions: {
    title: 'Transaction Manager',
    overview: 'The Transaction Manager handles the complete lifecycle of accounting transactions. Create new pending transactions, edit unposted entries, post to the GL, reverse posted transactions, and adjust existing records. All transactions maintain a full audit trail.',
    sections: {
      'Pending Transactions': 'Unposted transactions awaiting review and posting. Filter by type (Journal Entry, Adjustment, Reversal), date range, or source code. Select transactions to post individually or in batch.',
      'Posted Transactions': 'Immutable record of all posted transactions. Search by date, account, amount, or transaction ID. Posted transactions can only be reversed, never edited.',
      'Create Transaction': 'Form for new transaction entry. Enter header fields (date, source, description) then add line items. Each line requires an account code, amount, and optional description. Debits must equal credits.',
      'Adjustments': 'Create adjustment transactions that reference the original entry. Adjustments are tracked separately for audit purposes.',
      'Reversals': 'Reverse a posted transaction by creating an exact opposite entry. The reversal is linked to the original for traceability.',
      'Transaction Register': 'Print or export a register of transactions by date range, source, or type. Used for month-end verification.',
    },
    tips: [
      'Always verify debit/credit balance before posting — the system prevents imbalanced entries',
      'Use specific source codes to track transaction origin (CJ=Cash Journal, GJ=General Journal, AP=Accounts Payable, etc.)',
      'Reversals create a new transaction — the original remains unchanged in the audit trail',
      'Post transactions in chronological order for accurate running balances',
      'Use the Department field for profit center reporting',
    ],
    legacyScreens: [
      'adjtran', 'crfinchg', 'depatbal', 'depatcho', 'depatde1', 'depatde2',
      'depatde5', 'depatdet', 'depatke1', 'depatke2', 'depatke5', 'depatkey',
      'revadjt', 'revconfr', 'revtdate', 'revtrmsg', 'trandtch', 'tranpok1',
      'tranprk1', 'tranup88', 'tranupk1', 'tranupk2',
    ],
    legacyContext: 'Consolidates 22 COBOL transaction screens into one modern interface. Legacy screens included: Transaction Adjustment (ADJTRAN), Finance Charge Creation (CRFINCHG), Department Balance/Detail views (DEPATBAL-DEPATKEY), Reversal screens (REVADJT, REVCONFR, REVTDATE, REVTRMSG), and Transaction Update/Post screens (TRANDTCH, TRANPOK1-TRANUPK2). Each was a separate green-screen form — now unified with tabs and filters.',
  },

  schedules: {
    title: 'Schedule Format File Maintenance',
    overview: 'Schedule Format File Maintenance (SCHEDPR/SCHDUPKY) manages the 43 active schedule definitions for Lee Hyundai Inc. Each schedule links GL accounts to a subsidiary ledger with a specific type (1–5), purge code, and control requirements. Type 3 (Open Item — Multiple Accounts) is the highest-risk type.',
    sections: {
      'Schedule Grid': 'Card-based view of all 43 schedules showing schedule number, title, type chip, linked GL accounts as pills, risk level, and health indicator (green/amber/red border). Filter by schedule type.',
      'Schedule Detail': 'Expanded view with all fields: schedule type with description, purge code with behavior, name display code, control requirements, report sequence, and all linked GL accounts with control suffixes (L=Lookup, S=Stock#, D=Detail, A=Apply-To).',
      'Cross-Check (F7)': 'Replaces legacy F7 key. Validates GL account balances match subsidiary ledger balances for every schedule. Variances are highlighted in red. Run before EOM close.',
      'KPI Row': 'Shows total schedule count, Type 3 count (high risk), and health status breakdown (green/amber/red).',
      'Type Filters': 'Filter by schedule type: Type 1 (Current Month Detail), Type 2 (Aged Balance Forward), Type 3 (Open Item Multi-Acct), Type 4 (Credit Aged Bal Fwd), Type 5 (Open Item by Apply-To).',
    },
    tips: [
      'Run Cross-Check (F7) before every EOM close — GL-to-schedule variances block closing',
      'Type 3 schedules (red risk) link multiple GL accounts to one ledger — watch for orphaned lines',
      'Purge Code 6 (BalFwd by Control#) carries lines forward indefinitely — monitor for stale balances on OEM payables',
      'Schedule health: Green = 2+ GL accounts linked, Amber = 1 (verify), Red = 0 (broken — fix immediately)',
      'Each schedule supports max 5 GL account links — plan account structures accordingly',
    ],
    legacyScreens: ['schdupky', 'schedpr', 'schedpr2', 'schedup'],
    legacyContext: 'Replaces COBOL programs SCHEDPR (Schedule Format Print) and SCHDUPKY (Schedule Update by Key). Legacy required navigating between separate screens for viewing, editing, and cross-checking. Now unified with grid view, detail panel, and inline cross-check validation.',
  },

  'standard-journal-entries': {
    title: 'Standard Journal Entries',
    overview: 'Standard Journal Entries (STDJNL) manages recurring and automatic journal entries for Lee Hyundai Inc. Manual entries (Source 58) are posted on demand via checkbox selection. Automatic entries (Source 88) post on a scheduled basis. Two-panel layout separates Manual from Automatic for quick operational review.',
    sections: {
      'Overview': 'Two-panel layout: Manual entries (Source 58, blue) on the left, Automatic entries (Source 88, amber) on the right. Each entry shows name, reference, line count, total amount, and last post date. Checkbox to select entries for batch posting.',
      'Entry Detail': 'Full journal entry with all lines showing GL account, description, control number, debit, and credit amounts. Footer shows totals and balance validation. Unbalanced entries are flagged and cannot be posted.',
      'Batch Posting': 'Select multiple entries via checkboxes and post them in a single operation. The system validates balance before posting and uses optimistic locking to prevent duplicate posts.',
      'Reversal': 'Reverse a previously posted entry. Creates a mirror entry with debits and credits swapped for the current period.',
    },
    tips: [
      'Manual entries (Source 58) must be posted each month — they do not auto-post',
      'Automatic entries (Source 88) post on schedule — verify the "Next Post Date" is correct',
      'Entries MUST balance (total debits = total credits) before posting — unbalanced entries are blocked',
      'Use the "Select All" checkbox on each panel to quickly select all entries for batch posting',
      'Review last post dates — if a manual entry was not posted last month, it may be a missed accrual',
    ],
    legacyScreens: ['stdjnl'],
    legacyContext: 'Replaces COBOL program STDJNL — Standard Journal Entry Maintenance. Legacy required navigating entry list, detail, and posting on separate screens with function keys. Now unified with two-panel overview and inline detail.',
  },

  'vehicle-inventory': {
    title: 'Vehicle Inventory',
    overview: 'Vehicle Inventory (INVACC/SCHDUPKY) manages the complete vehicle inventory for Lee Hyundai Inc. including new Hyundai, new Genesis, used vehicles, service loaners, and in-transit units. Each vehicle links to GL accounts via schedule assignments. Age-based color coding highlights aging risk.',
    sections: {
      'Summary Cards': 'Four KPIs: New Units count, Used Units count, total Floorplan Exposure (cost), and Aged > 90 Days count (red if > 0).',
      'Status Filters': 'Filter by vehicle status: Available, Sold, Demo, Loaner, Wholesale, In Transit, Trade-In. Each chip shows count.',
      'Inventory List': 'Full vehicle table with stock#, year/make/model, color, status badge, age (color-coded: green 0-60, amber 61-90, red 91-120, bold critical >120), mileage, total cost, price, and GL account. Genesis vehicles show purple left border.',
      'Vehicle Detail': 'Expanded view with sub-tabs: Pricing & Cost (full cost breakdown and margin), Options (factory options with MSRP/invoice), GL Linkage (inventory GL and schedule assignment with derivation rules).',
      'Age Color Coding': 'Green: 0-60 days (healthy). Amber: 61-90 days (monitor). Red: 91-120 days (escalate). Bold Red: >120 days (critical — floorplan interest accumulating).',
    },
    tips: [
      'Monitor Aged > 90 Days count daily — floorplan interest erodes gross on aged units',
      'Genesis vehicles post to separate GL accounts (G-prefix) and schedules (#40/#41) from Hyundai',
      'Service loaners track on Schedule #13 with multiple GL accounts — reconcile monthly',
      'VIN is validated for format and check digit — 17 characters, last 6 used for warranty lookups',
      'Status transitions (e.g., Available → Sold) generate automatic GL reclassification entries via deal posting',
    ],
    legacyScreens: ['invacc', 'schdupky'],
    legacyContext: 'Replaces COBOL programs INVACC (Vehicle Inventory Account Maintenance) and SCHDUPKY (Schedule Update by Key for vehicle schedules). Legacy required separate navigation for each vehicle with function-key-driven tabs. Now unified with searchable table, age color coding, and integrated GL linkage view.',
  },

  'accounts-payable': {
    title: 'Accounts Payable',
    overview: 'Accounts Payable manages your vendor obligations. Enter invoices as vouchers, post them to create GL entries, then process payments via check, EFT, or credit card. The AP aging report shows outstanding vendor balances, and the cash requirements report helps plan payment runs.',
    sections: {
      'Voucher Entry': 'Create new vendor invoices. Enter vendor, invoice number, date, amount, and GL distribution (which accounts to debit). Apply discounts if paying within terms. Mark 1099 vendors for tax reporting.',
      'Voucher List': 'Filter and search vouchers by status, vendor, date range, or amount. Statuses: UNPOSTED (entered), POSTED (in GL), PENDING_PAYMENT, PAID, VOIDED.',
      'Payment Processing': 'Select posted vouchers for payment. Choose payment method: Check (prints physical checks), EFT (electronic transfer), or Credit Card. Group into payment batches for batch processing.',
      'AP Aging': 'Aging report showing all unpaid vendor balances in buckets: Current, 30, 60, 90, Over 90 days. Use for cash flow planning.',
      'Cash Requirements': 'Report showing total amount due by date range. Helps determine cash needed for upcoming payment runs.',
      'Vendor Master': 'View and manage vendor information including address, payment terms, default GL accounts, 1099 status, and payment history.',
    },
    tips: [
      'Always verify vendor invoice against purchase order before entering',
      'Take early payment discounts when cash flow allows — they add up significantly',
      'Run cash requirements report before scheduling payment runs',
      'EFT payments post faster than checks — preferred for recurring vendors',
      'Void vouchers rather than deleting them to maintain audit trail',
      'The AI AP/AR Recon agent automatically matches POs to invoices when amounts match',
    ],
  },

  'cash-receipts': {
    title: 'Cash Receipts',
    overview: 'Cash Receipts records incoming payments from customers. Payments are received, applied against open invoices on AR schedules, and grouped into bank deposit batches. Supports cash, check, credit card, and electronic fund transfers.',
    sections: {
      'New Receipt': 'Record a new payment: select customer (by control number or name), choose payment method, enter amount, and apply against specific open invoices.',
      'Receipt List': 'View all receipts with filters for date range, customer, payment method, or deposit status.',
      'Apply Payments': 'Match received payments to open invoices. Partial application is supported — unapplied amounts remain as credits.',
      'Bank Deposits': 'Group receipts into deposit batches for bank reconciliation. Each deposit batch has a total that should match the physical deposit.',
      'Payment Methods': 'Configure available payment methods and their GL account postings.',
    },
    tips: [
      'Apply payments to oldest invoices first (FIFO) unless customer directs otherwise',
      'Close deposit batches daily to simplify bank reconciliation',
      'Unapplied cash should be resolved within 48 hours',
      'Card payments through the integrated terminal are auto-applied',
    ],
  },

  reports: {
    title: 'Reports',
    overview: 'The Reports page provides access to all standard accounting reports. Select a report type, configure parameters (date range, account filters, etc.), and generate in PDF, Excel, or CSV format. Reports can be printed, downloaded, or emailed directly.',
    sections: {
      'GL Trial Balance': 'Account balances for a specific period showing prior balance, current activity, and YTD totals. The foundation report for verifying GL accuracy.',
      'Detailed GL & P&L': 'Journal-level detail for each GL account with breakdowns. Shows every transaction affecting each account in the period.',
      'Monthly Transaction Register': 'Daily transaction listing grouped by source code and account. Used for verifying all entries in a period.',
      'Aged Trial Balance': 'AR aging by control account showing current through 90+ day buckets. Essential for credit management.',
      'GL Annual Summary': '12-month rolling view of GL account activity. Used for annual planning and budgeting.',
      'Accumulator Report': 'GL group totals for configured accumulator categories. Used for departmental and summary reporting.',
      'Journal Source Listing': 'Reference listing of all journal source code definitions used in the system.',
      'Unposted Voucher Report': 'List of AP invoices not yet posted to GL. Must be zero before month-end close.',
      'AP Trial Balance': 'Vendor payable aging and summary. Paired with GL to verify AP subsidiary balance.',
      'Paid Invoice Report': 'Historical report of all paid vendor invoices with payment details.',
    },
    tips: [
      'Run Trial Balance BEFORE and AFTER month-end close to verify',
      'The Detailed GL report is your best tool for researching account discrepancies',
      'Export to Excel for ad-hoc analysis and pivot table creation',
      'Accumulator reports save time vs. running individual GL reports for department summaries',
      'Schedule recurring reports to auto-generate on specific days',
    ],
    legacyScreens: ['accumpr', 'accumrp2', 'accumrpt', 'delimdgl', 'misspr', 'transumm'],
    legacyContext: 'Consolidates 6 COBOL report screens plus the 17+ Java report types. Legacy screens: Accumulator Print (ACCUMPR/ACCUMRP2/ACCUMRPT), Detailed GL (DELIMDGL), Missing Documents (MISSPR), Transaction Summary (TRANSUMM). The Java system added Trial Balance, AP reports, Check Printing, and Export functions. All unified in one report center.',
  },

  'journal-sources': {
    title: 'Journal Source File — Company 01 (Lee Motor Co.)',
    overview: 'Journal Source File defines the 27 source codes for Company 01 (Lee Motor Co.), a Ford + Nissan dual-brand rooftop. Sources use an OEM brand-split pattern: parallel numeric codes per franchise (Ford=even, Nissan=odd). Balance method is D (Document — each transaction nets to $0) or S (Source — entire batch nets to $0). Source 85 (Intercompany Automatic) uses S-level balancing for sweep entries. Protected and system-reserved sources cannot be modified. Formerly part of the Other Files Sub-Menu (program 6203). Confluence refs: Deep Analysis §2.5, Batch 3/5, KT Accounting 1/5/7/22.',
    sections: {
      'Summary Bar': 'Seven stat cards showing total sources, Ford count, Nissan count, Shared count, Reserved/System count, Auto-Post count (with EOM sub-count), and Pending Posts. Pending posts in amber indicate batches awaiting manual review.',
      'Brand Filter': 'Filter by All (27), Ford (7), Nissan (7), Shared (7), or Reserved (6). Counts update dynamically. Multi-brand rooftops always show the brand filter.',
      'Source Table': 'Full list with Code, Name, OEM brand pill, Count Units flag, Post mode (Auto/Manual), Pending count badge, Status pill, and Last Post date. Click a row to open the detail panel. Protected sources show a 🔒 icon.',
      'Detail Panel': 'Right-side panel showing full source properties: OEM Brand, Balance Method (D=Document or S=Source with warning), Count Units toggle, Auto-Post toggle, EOM Auto-Post flag, Source Tag (Production/Test), Reserved Type, Last Post Date, Transaction Count, Pending Posts, Notes, and OEM Brand Pair reference. Protected sources (09, 80, 85, 88, TM, YE) have toggles disabled. Source 09 shows prior-period posting warning. Source 80 shows unit-count warning. Source-level (S) balancing sources show batch-balance warning.',
      'Validation Alerts': 'Automatic checks: missing OEM brand pairs, duplicate source names, duplicate source codes (COBOL ISAM bug — Confluence §1.6), payroll zero-post warning, TEST sources with auto-post (Confluence §1.5 — YE security risk), UNKNOWN sources with auto-post, source-level balancing advisories, source 09 prior-period posting info, pending transaction stuck alerts (>15 min).',
      'OEM Brand-Split Reference': 'Bottom panel showing all 7 Ford↔Nissan pairs: Vehicle Sale (10↔11), Vehicle Cost (15↔16), Finance (20↔21), Service (30↔31), Parts (32↔33), Warranty (56↔57), Inventory Adj (70↔71).',
      'AutoPost Pipeline': 'Visual flow showing how transactions route based on Auto-Post flag. Yes = immediate GL post (no review gate — Parts/Service EOD, deal posting). No = creates pending_transaction record in review queue (Program 37 equivalent). Stuck transactions (>15 min in processing) trigger alert; >1 hour triggers escalation to controller + manager. Replaces COBOL autopost.cbl + FileWatcher + scantran pipeline.',
      'Add Source': 'Create new sources with Code (2-char), Name (max 30 chars), optional OEM Brand, Balance Method (D/S), Count Units flag, Auto-Post flag, and EOM Auto-Post flag. Cannot reuse existing codes or reserved codes. Validates: TEST name + auto-post blocked, unique code enforced at DB level.',
    },
    tips: [
      'Ford sources use even numbers, Nissan sources use odd — always create pairs together',
      'Source 80 (General Journal) has Count Units = No — do NOT post vehicle unit transactions to it (BR-SRC-04)',
      'Source 09 (Prior Month) posts to PRIOR CLOSED PERIOD ending balances — changes ripple into current opening balance. Requires dual authorization + justification.',
      'Source 85 (Intercompany Automatic) uses Source-level (S) balancing — individual transactions can be unbalanced, only the batch must net to $0',
      'Source 88 can auto-post at EOM Step 300 — set autoPostAtEOM flag to include recurring entries in month-end close',
      'Protected sources (09, 80, 85, 88, TM, YE) cannot have their flags modified — they enforce system invariants',
      'Sources with "TEST" in name must NOT have Auto-Post = Yes (ref: YE close source test risk — Confluence §1.5)',
      'Missing source permissions silently block month-close — validate all period sources are accessible before EOM (ref: AMMAINT-29975)',
      'Intercompany source 85/88 maps to Schedule 02 and targets Company 03 (Lee Hyundai)',
      'COBOL ISAM allows duplicate source codes (known bug — Confluence §1.6). New system enforces unique constraint at DB level.',
    ],
    legacyScreens: ['6203-opt1', 'secjourn', 'srcupkey', 'autopost.cbl', 'scantran'],
    legacyContext: 'Replaces program 6203 option 1 (Journal Source File) from the "Other Files Sub-Menu" of the legacy COBOL system. Also replaces the autopost.cbl pipeline (auto-post sources bypass review), FileWatcher/Komodo pending transaction sync, and scantran stuck-transaction fixer. Journal source security migrated from COBOL tables file (AMACC-3975). The sub-menu itself is eliminated — both items are directly accessible from the main navigation. Open Jira: AMACC-3975 (source security), AMMAINT-21154 (KOMSRC REST API), AMMAINT-29975 (permissions block month-close).',
  },

  setup: {
    title: 'System Setup',
    overview: 'System Setup configures your accounting environment. Set company details, define the fiscal calendar (including 13th month for year-end adjustments), configure security roles, enable/disable modules, and set system-wide preferences.',
    sections: {
      'Company Settings': 'Basic company information: name, number, address, fiscal year start month. Multi-company environments can configure separate settings per company.',
      'Fiscal Calendar': 'Define your fiscal year start month and current period. Enable 13th month if your dealership uses year-end adjustment periods. The system supports non-calendar fiscal years.',
      'Security & Access': 'Configure user roles and permissions. Standard roles: Dealer Accountant, Group Controller, Platform Admin, Agent Approver. Custom roles can be created.',
      'Module Settings': 'Enable or disable accounting modules: AP, AR, Payroll, Cash Receipts, Bank Reconciliation, Purchase Orders, Financial Statements.',
      'Preferences': 'System-wide defaults: default department codes, report formatting, auto-post rules, notification preferences.',
      'Film/Report Menu': 'Configure available report types and menu organization for your users.',
    },
    tips: [
      'Set fiscal year start month BEFORE entering any transactions — changing it later requires data migration',
      '13th month should be enabled for dealerships that make year-end adjusting entries',
      'Test security roles with a non-admin account to verify restrictions work correctly',
      'Review module settings quarterly — disable unused modules to simplify the interface',
    ],
    legacyScreens: ['menu-d4', 'menufilm', 'reptmenu', 'sequp', 'sequpkey', 'stdentcr', 'sysup2'],
    legacyContext: 'Replaces 7 COBOL setup screens: Menu Configuration (MENU-D4), Film/Report Menu (MENUFILM, REPTMENU), Security Setup (SEQUP, SEQUPKEY), Standard Entry Criteria (STDENTCR), and System Setup (SYSUP2). The legacy system spread configuration across multiple menu-driven screens. The new system consolidates all settings in one organized page with sections.',
  },

  'chart-of-accounts': {
    title: 'Chart of Accounts — File Maintenance',
    overview: 'Chart of Accounts (GLACC) manages the 763+ GL accounts for Lee Hyundai Inc. (Company 03). Each account has a type (Asset, Liability, Expense, Income, DIST), control type requirements, schedule assignments, OEM prefix (Hyundai/Genesis), and unit tracking flags. DIST accounts (% suffix) are distribution/rollup accounts that split postings across multiple targets.',
    sections: {
      'Filter Chips': 'Filter accounts by type, OEM brand (Hyundai/Genesis), schedule assignment, or inactive status. Chips show count of matching accounts.',
      'Account List': 'Full account table with account number, name, type badge, control type, schedule link, Add Units flag, OEM badge (HYU/GEN), and flags (OEM-Critical, DIST, Inactive). Click any row for detail. Genesis accounts show a purple left border. DIST accounts have a violet background.',
      'Account Detail': 'Full account properties including control type enforcement, GL linkage (Cost GL, Inventory GL), distribution targets for DIST accounts, and OEM compliance warnings.',
      'Schedule Health Sidebar': 'Toggle the sidebar to see all 43 schedules with health indicators: Green (2+ GL accounts linked), Amber (1 account — verify), Red (no GL accounts — action needed).',
      'OEM-Critical Accounts': 'Accounts marked ⚠ OEM are mapped to HMA/GMA DDS feeds, warranty processing, or floorplan settlement. Modifications require compliance review.',
    },
    tips: [
      'Never modify OEM-critical accounts (amber ⚠) without compliance review — they impact DDS feeds and factory statements',
      'DIST accounts (% suffix) distribute postings to multiple targets — verify percentages sum to 100%',
      'Genesis accounts use G-prefix (e.g., G2310) and appear on separate schedules from Hyundai equivalents',
      'Accounts with Add Units flag (✓) track unit counts alongside dollar amounts — critical for inventory reconciliation',
      'Use the Schedule Health sidebar to identify schedules without proper GL linkage before EOM close',
    ],
    legacyScreens: ['glacc'],
    legacyContext: 'Replaces COBOL program GLACC — GL Account File Maintenance. Now features OEM-specific filtering, Genesis dual-brand support, DIST account visualization, and schedule health validation.',
  },

  'purchase-orders': {
    title: 'Purchase Orders',
    overview: 'Purchase Orders tracks vendor orders from creation through receipt. When goods are received, the system can automatically generate AP vouchers for payment. POs help control spending and provide three-way matching (PO → Receipt → Invoice).',
    sections: {
      'PO List': 'Filter orders by status, vendor, date range, or PO number. Statuses: Draft (not yet sent), Open (sent to vendor), Partial (some items received), Received (all items in), Closed (fully processed).',
      'Create PO': 'New purchase order form: select vendor, add line items with quantities and unit prices, specify GL account distribution, and set expected delivery date.',
      'Receive Items': 'Record receipt of ordered items. Enter quantities received per line item. Partial receipts are supported — remaining quantities stay on open PO.',
      'Three-Way Match': 'Compare PO (ordered), receipt (received), and invoice (billed) quantities/amounts. Discrepancies are flagged for review.',
    },
    tips: [
      'Use PO numbers in the invoice description to simplify AP matching',
      'Close POs only after final invoice is received and matched',
      'The AI agent flags invoice-to-PO discrepancies greater than 5%',
      'Set up recurring POs for regular vendor orders (monthly supplies, etc.)',
    ],
  },

  'vendor-management': {
    title: 'Vendor Management',
    overview: 'Vendor Management maintains your vendor master database. Each vendor record stores contact information, payment terms, tax reporting requirements, and links to AP transaction history. Proper vendor setup ensures smooth AP processing and accurate 1099 reporting.',
    sections: {
      'Vendor List': 'Searchable list of all vendors with name, contact, payment terms, 1099 status, and active flag. Filter by active/inactive, 1099 type, or search by name/ID.',
      'Vendor Detail': 'Full vendor record with tabs for: Contact Info, Payment Settings, Tax/1099, AP History, and Notes.',
      '1099 Management': 'View and manage 1099 vendor settings. Export 1099 data at year-end for tax reporting. Vendors are marked as 1099 or non-1099 based on entity type.',
      'Payment History': 'Complete history of payments to each vendor with amounts, dates, check numbers, and linked vouchers.',
    },
    tips: [
      'Verify Tax ID (EIN/SSN) for all 1099 vendors — incorrect IDs cause filing penalties',
      'Set default GL accounts on vendor records to speed up voucher entry',
      'Review inactive vendors annually and purge those with no activity in 2+ years',
      'Use the Ford MFG link for Ford dealer-specific vendor integrations',
    ],
    legacyScreens: ['contpr', 'contupfm'],
    legacyContext: 'Replaces COBOL screens: Control Number Print (CONTPR — Accounting Name Database Control Numbers) and Control Update Ford MFG (CONTUPFM — Name Database Ford MFG Information). Vendor management in the legacy system was integrated with the customer name database (AMDB domain). The new system provides dedicated vendor-focused management.',
  },

  intercompany: {
    title: 'Intercompany Transactions',
    overview: 'Intercompany manages financial transactions between companies in a multi-dealership group. When one company provides goods or services to another, intercompany entries ensure both sides record the transaction. Consolidation eliminates intercompany balances for group-level reporting.',
    sections: {
      'Intercompany Entries': 'Create and view entries between companies. Each entry generates matching debit and credit entries in both companies\' GLs.',
      'Settlement': 'Track net amounts owed between companies and process settlements (actual cash transfers to zero out intercompany balances).',
      'Consolidation': 'Combine multiple company GLs for group-level financial statements. Automatically generates elimination entries for intercompany balances.',
    },
    tips: [
      'Intercompany entries must be approved by both companies before posting',
      'Settle intercompany balances monthly before generating consolidated financials',
      'Elimination entries are automatic — review them to verify correct offsetting',
      'Use the consolidated view to verify group-level balance integrity',
    ],
  },

  'bank-deposits': {
    title: 'Bank Deposits',
    overview: 'Bank Deposits groups cash receipts into batches that correspond to physical bank deposits. This creates a clean audit trail from customer payment through bank reconciliation.',
    sections: {
      'Active Deposits': 'Open deposit batches being assembled. Add receipts to a batch throughout the day, then close when making the physical deposit.',
      'Deposit History': 'Closed deposits with date, bank account, amount, and receipt count. Links to bank reconciliation for matching.',
      'Create Deposit': 'Start a new deposit batch for a specific bank account. Add individual cash receipts from the Cash Receipts page.',
      'Deposit Slip': 'Print a deposit slip showing all included receipts, subtotals by payment method, and grand total.',
    },
    tips: [
      'Close deposits daily for easier bank reconciliation',
      'Deposit totals should match the bank statement deposit amount exactly',
      'Separate deposits by bank account if your dealership uses multiple banks',
      'Card payments are typically auto-deposited — verify against merchant statement',
    ],
  },

  'warranty-dcs': {
    title: 'Warranty & DCS',
    overview: 'Warranty & DCS handles the financial side of OEM warranty claims and the electronic transmission of financial data through Dealer Communication Systems. Each OEM (Acura, Ford, GM, Honda, Mercedes) has specific DCS requirements for financial statement submission.',
    sections: {
      'Warranty Claims': 'Track warranty claim financial entries. When your service department processes warranty repair orders, the financial postings appear here for GL verification.',
      'DCS Interface': 'Monitor electronic transmission of financial data to each OEM\'s system. View submission status, acknowledgments, and any rejection details.',
      'OEM-Specific Views': 'Each OEM has specific financial reporting requirements through their DCS. This page handles Acuralink (Honda/Acura), Ford, GM, and Mercedes-Benz DCS interfaces.',
    },
    tips: [
      'Verify warranty claim GL postings match service department records',
      'DCS transmissions should be confirmed within 24 hours',
      'Failed DCS transmissions are usually caused by GL mapping issues — check COA mappings',
      'Each OEM\'s DCS has an annual update cycle — watch for format changes',
    ],
    legacyScreens: ['acdcsfst', 'fordymnt', 'gmdcsfac', 'hndcsfst', 'mbdcsfst'],
    legacyContext: 'Replaces 5 COBOL DCS screens: Acuralink FS (ACDCSFST), Ford Payment (FORDYMNT), GM DCS Factory (GMDCSFAC), Honda DCS FS (HNDCSFST), Mercedes DCS FS (MBDCSFST). Each was an OEM-specific interface. The new system unifies all OEM DCS interactions.',
  },

  'year-end': {
    title: 'Year-End Processing',
    overview: 'Year-End Processing handles the annual closing of your fiscal year. This includes creating 13th month period adjusting entries, transferring net income to retained earnings, and resetting beginning balances for the new year.',
    sections: {
      'Year-End Close': 'Initiate and manage the annual close process. The system verifies all 12 monthly closes are complete, processes 13th month adjustments, transfers net income to retained earnings, and opens the new fiscal year.',
      '13th Month Adjustments': 'Special adjusting entries that don\'t belong to any regular month. Used for audit adjustments, tax provisions, and year-end corrections. These entries affect the annual totals without impacting any specific month\'s financials.',
      'Annual Summary': 'Year-end GL summary showing final account balances, net income, retained earnings adjustment, and beginning balances for the new year.',
    },
    tips: [
      'Complete all 12 monthly EOM closes before starting year-end',
      '13th month entries should only include legitimate year-end adjustments',
      'Get auditor sign-off on adjusting entries before finalizing year-end close',
      'Verify beginning balances in the new year match prior year ending balances',
      'Year-end close is irreversible — ensure all adjustments are correct before proceeding',
    ],
    legacyScreens: ['final13', 'yrend'],
    legacyContext: 'Replaces COBOL screens: 13th Month Final (FINAL13) and Year End Close (YREND). The legacy system had separate processes for 13th month entry and year-end closing. The new system combines them into a unified workflow.',
  },

  'system-settings': {
    title: 'System Settings — SYSUPCHO',
    overview: 'Unified System Settings replaces the legacy SYSUPCHO numbered menu. Manages Accounting Company Info, Fiscal & Period configuration, Accounting Behavior flags, OEM Warranty Remittance Setup, Role-Based Access Control for schedules and journal sources, and Service End-of-Day configuration. Scoped to Company 03 — Lee Hyundai Inc.',
    sections: {
      'Company Profile': 'Company name, phone area code, Account Type Code (OEM brand — Y=Hyundai), and NCM 20-group reporting. Account Type Code is the master OEM switch controlling all OEM-specific behavior. Changing it on a live company is DESTRUCTIVE.',
      'Fiscal & Period': 'Fiscal year start month, last close date (read-only, set by EOM orchestrator), cutoff date (read-only), and post-ahead months (max 6, warn above 4). Timeline visualization shows closed, current, and future posting windows.',
      'Accounting Behavior': 'Transaction audit trail visibility, decimal in transactions, suppress zero YTD on trial balance, journal print code (Print Preview / Edit Check Only), and LIFO valuation method (parts inventory only).',
      'OEM Warranty Remittance': 'Configures how OEM warranty reimbursements post to GL. Lee Hyundai has NO entries — Hyundai warranty flows via HMA DDS direct-posting. Ford reference shows 12 repair types with GL routing and write-off thresholds.',
      'Access & Permissions': 'Role-based access control replacing legacy login-ID × schedule-number matrix. 5 default roles (Controller, Accounting Clerk, Payroll Admin, Auditor, Service Manager). Schedule permission matrix for 43 schedules and journal source permissions for 7 source codes.',
      'Service EOD': 'Service End-of-Day method (Manual/Automatic/Batch), auto-run time, process password (separate from user login, min 8 chars), and notification recipients for EOD success/failure.',
    },
    tips: [
      'Account Type Code (Y=Hyundai) controls which OEM integrations, GL prefixes, and schedule types are available — never change on a live company without compliance review',
      'Last close and cutoff date are READ-ONLY — only the EOM close orchestrator can update them',
      'Post-ahead months > 4 is a warning; > 6 is blocked',
      'Lee Hyundai has no warranty remittance entries because Hyundai/Genesis warranty uses HMA DDS direct-posting',
      'Payroll schedules (2, 6, 15, 23, 24, 29, 32) are restricted to Payroll Admin and Controller roles',
      'Service EOD closes open ROs to WIP (GL 2470) and updates service loaner schedule (#13)',
      'DealerCONNECT tab is hidden for Hyundai rooftops — only shown for Stellantis franchises',
    ],
    legacyScreens: ['sysupcho'],
    legacyContext: 'Replaces the COBOL SYSUPCHO menu (14 numbered items) with a unified tabbed Settings page. Legacy items eliminated: Patch Detail File (Item 6) replaced by Opening Balance Import wizard, Patch Journal File (Item 7) replaced by GL Correction Entry workflow. Schedule Access Control (Item 11) and Journal Source Access Control (Item 12) merged into a unified RBAC model.',
  },

  utilities: {
    title: 'Utilities',
    overview: 'Utilities provides maintenance tools for system administrators. These are specialized operations for fixing data issues, regenerating indexes, and performing diagnostic checks. Use with caution — some operations modify live data.',
    sections: {
      'GL Regeneration': 'Rebuild GL-by-ID index files. Use when account lookups return incorrect data or after a data migration.',
      'Transaction Fixes': 'Repair or reverse problematic transactions that can\'t be handled through normal reversal process. Requires admin access.',
      'Journal Patch': 'Apply batch corrections to journal entries. Used for mass source code changes or date corrections.',
      'Data Diagnostics': 'Run integrity checks on GL data, schedule balances, and intercompany entries. Reports any discrepancies found.',
      'Out-of-Balance Fix': 'Identify and correct GL accounts that are out of balance due to system errors. Shows the imbalance amount and suggested correction.',
    },
    tips: [
      'Always back up data before running any utility operation',
      'GL regeneration should be run after any direct database modifications',
      'Review the execution log after each utility run for unexpected results',
      'Most utilities should only be run outside business hours',
      'Contact support if a diagnostic reports persistent integrity errors',
    ],
    legacyScreens: ['fixoob', 'jrpatch', 'jrpatkey', 'revtran'],
    legacyContext: 'Replaces 4 COBOL utility screens: Fix Out-of-Balance (FIXOOB), Journal Patch (JRPATCH/JRPATKEY), and Reverse Transaction (REVTRAN). The legacy system also had Java utility endpoints for GL regeneration and cleanup.',
  },

  // ═══════════════════════════════════════════════════════════════
  // ADMIN PAGES
  // ═══════════════════════════════════════════════════════════════

  tenants: {
    title: 'Tenants',
    overview: 'Tenants represent individual dealership groups or rooftops. Each tenant has isolated data (separate database schema), its own GL structure, and DMS connection. Platform admins can create and manage tenants here.',
    sections: {
      'Tenant List': 'Table showing all configured tenants with DMS type, rooftop count, status, schema name, and creation date. Click any row to select it as the active tenant.',
      'Add Tenant': 'Form for creating new tenants. Required: name, DMS type (AutoMate, CDK, Reynolds, DealerTrack), API credentials. Optional: webhook URL for event notifications.',
    },
    tips: [
      'Selecting a tenant applies it globally — all other pages will show that tenant\'s data',
      'The schema name is auto-generated and cannot be changed after creation',
      'Use the Onboarding wizard for full tenant setup including COA and OEM configuration',
    ],
  },

  onboarding: {
    title: 'Onboarding',
    overview: 'The Onboarding wizard guides you through setting up a new dealership tenant in five steps: DMS Connection, OEM Configuration, Chart of Accounts Setup, Historical Data Import, and Financial Statement Validation.',
    sections: {
      'Step 1 — DMS Connection': 'Configure your Dealer Management System connection. Select your DMS provider and enter the API endpoint for automatic data synchronization.',
      'Step 2 — OEM Configuration': 'Select which OEM manufacturers your dealership represents. This determines available financial statement formats and GL account mapping requirements.',
      'Step 3 — Chart of Accounts': 'Set up the standard chart of accounts with OEM-specific mappings. The system provides a base template that maps to all selected OEMs.',
      'Step 4 — Import History': 'Import historical journal entries from your DMS. This provides baseline data for AI agents to learn your dealership\'s patterns.',
      'Step 5 — FS Validation': 'Validate that financial statements can be generated correctly for all selected OEMs. The system generates test statements and checks for mapping completeness.',
    },
    tips: [
      'Complete all five steps before going live — each builds on the previous',
      'DMS API connections should be tested with a small data set first',
      'Historical import typically takes 15-30 minutes depending on data volume',
      'Keep OEM dealer codes handy for the FS validation step',
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // FINANCIAL DASHBOARD (WF-A010)
  // ═══════════════════════════════════════════════════════════════
  'financial-dashboard': {
    title: 'Financial Dashboard',
    overview: `Think of this as your dealership's morning newspaper — one page that tells you exactly how healthy the business is right now. Every number, every chart, and every alert here answers one question: "Is the money working the way it should?" You don't need to be an accountant to read this page — if something is red, it needs attention; if it's green, you're on track.`,
    sections: {
      '💵 Cash on Hand': `How much actual cash is sitting in your bank accounts right now — not on paper, but real, spendable money. Example: If the card shows $366K, that's the total across all your dealership's bank accounts combined. Think of it like checking your wallet before a big purchase — this is the dealership's wallet balance.`,

      '📈 Revenue MTD (Month-to-Date)': `Total money collected from ALL sales and services since the 1st of this month. This includes new car sales, used car sales, service repairs, and parts. Example: $219K means the dealership has billed out $219,000 in revenue this month. The "+0.0% vs bgt" tells you how you're tracking against your monthly target.`,

      '💰 Gross Profit': `After paying for what you sold (the car you bought for $35K and sold for $50K), how much is left. This is NOT total revenue — it's revenue minus the direct cost of goods. Example: 13.2% GP% means for every $100 you sold, $13.20 is pure margin before overhead. Industry benchmark for dealerships is 12-16%.`,

      '🏆 Net Income': `What's actually left after paying EVERYTHING — staff salaries, rent, utilities, advertising, insurance — all dealership operating costs. This is the real bottom line profit. Example: $13K net income means after paying all bills this month, the dealership made $13,000. This is what owners and CFOs watch most closely.`,

      '🔴 AR Outstanding (Accounts Receivable)': `Money that customers OWE YOU but haven't paid yet. Like an IOU stack. Example: $17K AR Outstanding means customers owe the dealership $17,000 — maybe a fleet account that buys cars and pays on 30-day terms, or insurance companies that haven't paid a warranty claim yet. The "90+ Days" bucket in red means someone hasn't paid in over 3 months — that needs a collection call.`,

      '🔵 AP Outstanding (Accounts Payable)': `Money YOU owe to vendors but haven't paid yet. Like your unpaid bills pile. Example: $9K AP Outstanding means the dealership owes $9,000 — maybe to GM for parts ordered, or to a marketing agency for last month's ads. Keeping this low means you're paying on time and maintaining good vendor relationships.`,

      '📊 MTD Income Statement': `Your monthly financial report card showing three key rows: Net Revenue (total sales), Cost of Sales (what those sales cost you), and Net Income (profit). The "Budget" column is your planned target and "Var %" shows how far above or below you are. Green = beating budget, Red = below budget.`,

      '🏢 Department GP%': `Compares profitability across every department — New Vehicles, Used Vehicles, Parts, Service, Body Shop, F&I. The colored bar shows actual (solid) vs target (line). Example: Service at 49.4% means Service is your most profitable department right now. Parts at -26.6% is a red flag — the parts department is losing money and needs investigation.`,

      '💸 Cash Flow Forecast': `An AI-powered prediction of how much cash you'll have in 7, 30, and 90 days. Based on your current AR/AP, scheduled payroll, and revenue trends. Example: 30-Day shows -$343K means the AI predicts you'll need $343K more cash than you currently have within 30 days — potentially a floor plan payment or large AP invoice coming due. Use this to plan ahead, not be surprised.`,

      '🤖 GL Health': `Your books' report card. The AI constantly monitors journal entries for problems. "Trial Balance OUT OF BALANCE" is a red alert — means debits don't equal credits somewhere, which MUST be fixed before month-end close. "2 Draft Entries" means someone started a journal entry but never finished posting it.`,

      '📅 EOM Close Status': `Shows where you are in the month-end closing process. Like a checklist of 12 steps that must complete in order before the books can be "locked" for the month. Green = done, Orange = in progress, Gray = waiting.`,

      '⏰ AR & AP Aging': `Buckets that show HOW LONG money has been owed or overdue. Current = normal, 30+ Days = getting late, 60+ Days = concerning, 90+ Days = urgent action needed. The rule of thumb: anything in 90+ Days needs a phone call today.`,
    },
    tips: [
      'Check this page every morning — the AI refreshes it every few minutes automatically',
      'If GL Health shows "OUT OF BALANCE" — stop everything and fix it before anything else',
      'Department GP% below 10% for any department = that department needs a pricing or cost review',
      'Cash Flow Forecast going negative at 30 days = talk to your CFO about a floor plan draw or line of credit',
      'AR 90+ Days growing month-over-month = your collections process needs tightening',
      'Net Income % below 2% of revenue = expenses are too high relative to sales volume',
    ],
    legacyContext: 'This dashboard replaces the daily manual process of printing 6-8 separate reports from the legacy system (Trial Balance, Aging Report, Cash Position, Income Summary, etc.) and manually compiling them into a morning brief. Everything is now live and in one place.',
  },

  // ═══════════════════════════════════════════════════════════════
  // JOURNAL ENTRIES (WF-A001)
  // ═══════════════════════════════════════════════════════════════
  'journal-entries': {
    title: 'General Ledger — Journal Entries',
    overview: `Journal entries are the DNA of your accounting system — they are the record of EVERY single financial event that happened in the dealership. Every car sold, every paycheck issued, every bill paid, every loan interest charge — all of it creates a journal entry. Think of them as receipts that your accounting system keeps forever. This page lets you see, create, and post those receipts.`,
    sections: {
      '📋 Entries List': `Every row is one financial transaction. Click the row to open it and see the detailed breakdown of which accounts were affected. Example: "New Vehicle Sales – Feb 2026" shows Cash Account debited $186,200 and Vehicle Sales Revenue credited $186,200 — meaning the dealership received $186,200 in cash from car sales.`,

      '💳 Debits vs Credits (The Most Important Concept)': `Every journal entry has two sides that MUST be equal — like a perfectly balanced scale. DEBIT = money flowing INTO an account (left side). CREDIT = money flowing OUT of an account (right side). Example: When you sell a $50,000 car — Debit Cash $50,000 (cash came in) + Credit Vehicle Revenue $50,000 (revenue was earned). Total Debit = Total Credit = balanced. If they don't match, the "✓ Balanced" won't appear and the entry can't be posted.`,

      '🏷️ Source Column': `Where did this entry come from? MANUAL = a human accountant typed it in. CONNECTOR CDK = automatically imported from your CDK DMS system (sales, service ROs). PAYROLL = created by the payroll module. The source helps you trace any entry back to its origin in seconds.`,

      '🚦 Status Column': `DRAFT = entry exists but is not final — like a saved draft email, not yet sent. POSTED = entry is final, locked, and counted in your financial reports — like a sent email. PENDING_REVIEW = AI agent is checking it before posting (takes ~30 seconds). You can only EDIT draft entries. Posted entries require a reversal to undo.`,

      '🔗 Ref # (Reference Number)': `The unique ID for each entry — like a receipt number. "DEMO-SERVICE-REVENUE---FE" was auto-generated. "DEMO-OPENING-BALANCE---JA" was the opening balance loaded on Jan 1. You can search or filter by Ref # to find any specific transaction.`,

      '📅 Date Column': `When the transaction occurred financially — NOT when it was entered into the system. A service repair completed on Feb 28 gets a Feb 28 date even if the accountant posts it on March 2. This date determines which month's financial statements include this entry.`,

      '↩️ REVERSAL Entries': `Sometimes an entry was posted by mistake (e.g., duplicate payroll). A REVERSAL entry creates an equal and opposite entry to cancel it out. Example: "REVERSAL: Duplicate Payroll Entry PR-2026-02-W3" shows that a $24,800 payroll was accidentally posted twice, and this entry reverses the duplicate.`,

      '📑 Templates': `Pre-built journal entries for recurring transactions — like a recurring bill payment or monthly depreciation. Instead of building the same entry from scratch every month, save it as a template and reuse it with one click.`,
    },
    tips: [
      'Every entry must be BALANCED (Total Debit = Total Credit) before it can be posted',
      'POSTED entries are permanent — to undo one, you must create a REVERSAL entry',
      'CONNECTOR CDK entries are auto-posted — you don\'t need to manually post them',
      'Check DRAFT entries weekly — anything sitting as Draft at month-end will cause problems during close',
      'The "View Source" link on CDK entries takes you directly to the original sale or RO in the DMS',
      'Use Templates for monthly recurring entries like rent, insurance, and depreciation',
    ],
    legacyScreens: ['inqglhst', 'inqtran', 'prg037'],
    legacyContext: 'Replaces Program 37 (Journal Entry creation/posting), GL History Inquiry, and Transaction Inquiry from the legacy system. In the legacy system, creating and posting were separate screens. Here they are unified.',
  },

  // ═══════════════════════════════════════════════════════════════
  // TRIAL BALANCE
  // ═══════════════════════════════════════════════════════════════
  'trial-balance': {
    title: 'Trial Balance',
    overview: `The Trial Balance is the most fundamental health check in accounting — it lists EVERY account in your chart of accounts with its current balance, and proves that your books are mathematically correct. Think of it like a double-entry ledger check: every dollar in the system must have come FROM somewhere and gone TO somewhere. If Debit Totals ≠ Credit Totals, something is wrong and needs to be found before closing the books.`,
    sections: {
      '🗓️ Period Selection (2026-08)': `You're viewing account balances as of this specific month. The trial balance is a SNAPSHOT — it shows where every account stands at the END of the selected period. Change the month to see a historical snapshot of any past period.`,

      '📊 Account / Name / Debit / Credit Columns': `Each row is one GL account. DEBIT balance = asset or expense accounts (things you own or spent). CREDIT balance = liability, equity, or revenue accounts (things you owe or earned). Example: Account 1010 "Operating Checking" shows $366,000 DEBIT — the dealership has $366,000 in the checking account. Account 4000 "Vehicle Sales Revenue" shows $219,000 CREDIT — the dealership earned $219,000 in revenue.`,

      '⚖️ Totals Row (THE MOST IMPORTANT LINE)': `The bottom row shows Total Debits and Total Credits. They MUST be equal. If they're equal: "✓ Balanced" — your books are mathematically correct. If they're not equal: "⚠️ OUT OF BALANCE" — there's an error somewhere that MUST be fixed before month-end close. A $1 difference is just as serious as a $1M difference.`,

      '🤖 AI Insight Panel': `After generating the trial balance, the AI automatically analyzes it and writes a plain-English summary of what changed from last month, any unusual movements, and what to watch. Example AI Insight: "Cash decreased 18% vs prior month ($447K → $366K), driven by $82K floor plan interest payment and $35K AP invoices paid. Recommend confirming with bank statement." This is your AI accountant summarizing the numbers for you.`,
    },
    tips: [
      'Run the trial balance before starting month-end close — if it\'s out of balance, stop and find the error first',
      'Compare this month to last month — large swings in any account are worth investigating',
      'If AI Insight says "No insight generated" — hit Regenerate to trigger the analysis',
      'A balanced trial balance does NOT mean the entries are correct — only that the math works. An amount could be in the wrong account but still balance.',
      'Print or export the trial balance before closing the period — it becomes your audit reference',
    ],
    legacyScreens: ['prgtb', 'inqtbkey'],
    legacyContext: 'Replaces the legacy Trial Balance program and Trial Balance Key inquiry. The legacy system required a separate print run to generate the trial balance as a report. This page is real-time and interactive.',
  },

  // ═══════════════════════════════════════════════════════════════
  // FINANCIAL STATEMENTS — ENHANCED (WF-A007)
  // ═══════════════════════════════════════════════════════════════
  'financial-statements-detail': {
    title: 'Financial Statements',
    overview: `Financial Statements are the official "report cards" of the dealership's financial performance — the documents that owners, banks, manufacturers, and auditors rely on. This page generates all of them from your live GL data. Think of these statements as the final, formatted version of everything that happened in the journal entries — organized into the standard reports that tell the full financial story of the business.`,
    sections: {
      '📈 Income Statement (Profit & Loss)': `The most-watched report — shows if the dealership made or lost money in a period. Structure: Revenue (what came in) MINUS Cost of Sales (what those sales cost) = Gross Profit. Then subtract Operating Expenses (rent, salaries, advertising) = Net Income. Example: Revenue $1.2M, COGS $950K, Gross Profit $250K, Operating Expenses $220K, Net Income $30K. A net income of $30K on $1.2M revenue = 2.5% net profit margin.`,

      '🏛️ Balance Sheet': `A snapshot of everything the dealership OWNS vs everything it OWES at a single point in time. Assets (left) = Cash + Inventory (vehicles) + Receivables + Equipment. Liabilities (right) = Floor Plan Loans + AP + Notes Payable. Equity = Assets minus Liabilities (what the owners actually own). Rule: Assets must ALWAYS equal Liabilities + Equity. If not, something is wrong.`,

      '💸 Cash Flow Statement': `Tracks ACTUAL cash movement — not sales on paper, but real money in and out. Three sections: Operating (day-to-day business cash), Investing (buying/selling equipment), Financing (loans and owner withdrawals). Critical for dealers: a dealership can show profit on the Income Statement but be cash-negative if floor plan payoffs are large.`,

      '🏢 Departmental Analysis': `Breaks down the Income Statement by department — New Cars, Used Cars, Service, Parts, F&I, Body Shop. Lets you see which departments are profitable and which are dragging down results. Example: Service Department shows Revenue $450K, COGS $200K, Gross Profit $250K (55% GP%). This is the most profitable department and deserves investment.`,

      '🏭 OEM Statement': `Formatted exactly as required by your manufacturer (GM, Ford, Toyota, Honda, etc.). OEMs require dealers to submit financial statements in their specific format for monthly review. This tab auto-formats your data into that exact template. Example: GM's "NCM20" format requires specific line items that map to your GL accounts — this page handles that mapping automatically.`,

      '📁 Archived Statements': `Previous months' finalized and locked financial statements. Once a period is closed, its statement is archived here permanently. These are your official accounting records for audits, bank financing, and OEM reviews.`,

      '⚙️ FS Version / Period / Department Filters': `FS Version = which format/template to use (V1 = standard). Period = which month to report. Department = show all departments consolidated, or drill into one department specifically. Calendar YTD = January to selected month. Fiscal YTD = based on your fiscal year start.`,

      '📊 Compare To / OEM Format checkboxes': `Compare To = shows current period vs same period last year side by side — great for spotting trends. OEM Format = switches the layout to exactly match your manufacturer's required submission format.`,
    },
    tips: [
      'Always run Financial Statements AFTER completing EOM Close — numbers before close may change',
      'Compare current month to same month last year using "Compare To" — seasonality matters in auto sales',
      'If GP%: NaN% appears — it means the revenue bucket is $0.00, likely a data seeding issue for that period',
      'Export to Excel before sending to your manufacturer or bank — they need the spreadsheet format',
      'Departmental Analysis is your management tool; the Consolidated tab is what you show the bank',
      'OEM Statement rejection is almost always caused by GL accounts not mapped to OEM line items — check COA mapping',
    ],
    legacyScreens: ['finstmp1', 'finstmp2', 'consolgl', 'finchoic', 'menufs'],
    legacyContext: 'Consolidates 36 legacy COBOL Financial Statement screens into one page. Previously, generating an Income Statement required FINCHOIC (format selection), FINEDT1A-6 (line editing), FINSTMP1-2 (print), and CONSOLGL (consolidation) — all separate programs run in sequence.',
  },

  // ═══════════════════════════════════════════════════════════════
  // BANK RECONCILIATION (WF-A004)
  // ═══════════════════════════════════════════════════════════════
  'bank-reconciliation': {
    title: 'Bank Reconciliation',
    overview: `Bank Reconciliation is the process of proving that your accounting books match your actual bank statement — dollar for dollar. Think of it like balancing your personal checkbook against your bank statement. Every deposit and every check that appears in your books should match exactly what the bank recorded. Discrepancies = errors that need to be found and fixed. This is typically done once a month before closing the books.`,
    sections: {
      '🏦 Bank Statement Balance': `The ending balance shown on your actual bank statement for the period. This is the "ground truth" — what the bank says you have. This number comes from your bank, not from your accounting system.`,

      '📚 GL Book Balance': `What your accounting system says your bank balance is — based on all posted journal entries. This is what your books say you have. The goal of reconciliation is to prove these two numbers represent the same reality.`,

      '⏳ Outstanding Checks': `Checks you wrote and recorded in your books, but the bank hasn't cleared yet — the payee hasn't cashed it. Example: You paid a vendor $5,000 by check on Dec 30, but they deposited it on Jan 3. Your books show -$5,000 but the bank statement doesn't yet. This is normal and expected.`,

      '📨 Outstanding Deposits': `Deposits you recorded in your books but the bank hasn't credited yet. Example: You recorded a $10,000 vehicle deposit on Dec 31 but it didn't clear the bank until Jan 2. This is called a "deposit in transit."`,

      '⚖️ Adjusted Balance': `After accounting for outstanding checks and deposits, the Bank Balance and Book Balance should match. Adjusted Bank Balance = Bank Statement + Deposits in Transit - Outstanding Checks. If Adjusted Bank Balance = Book Balance → ✅ Reconciled!`,

      '🤖 AI Auto-Match': `The AI scans your bank statement and your GL entries and automatically matches them up — like having a meticulous accountant do the tedious matching work for you in seconds. Unmatched items are flagged for your review.`,
    },
    tips: [
      'Reconcile every month without exception — skipping even one month makes the next one twice as hard',
      'Any variance under $5 is usually a bank fee or rounding — investigate anything over $100',
      'If a check has been outstanding for 90+ days, call the vendor — it may be lost and need to be re-issued',
      'The AI auto-match handles 85-90% of matches — the remaining 10-15% need human judgment',
    ],
    legacyScreens: ['bankrec', 'bankkey'],
    legacyContext: 'Replaces the legacy Bank Reconciliation program. The legacy system required manual matching of each line item. The AI auto-match feature is new in AMACC 2.0.',
  },

  // ═══════════════════════════════════════════════════════════════
  // ACCOUNTS PAYABLE (WF-A002)
  // ═══════════════════════════════════════════════════════════════
  'accounts-payable-detail': {
    title: 'Accounts Payable',
    overview: `Accounts Payable (AP) is your "bills to pay" system — tracking every invoice the dealership owes to vendors and ensuring they get paid correctly and on time. Think of it as your inbox for supplier invoices: they come in, get coded to the right expense accounts, get approved, and get paid. Good AP management means never paying a bill twice and never missing a discount for early payment.`,
    sections: {
      '📥 Vendor Invoices Tab': `Every bill the dealership has received. Each row shows: vendor name, invoice number, amount, due date, GL account it's coded to, and status (Draft/Approved/Paid). Example: "GM Parts Invoice #GM-2026-1847 — $23,400 — Due Feb 15" would appear here and be coded to Account 5100 (Parts Purchases).`,

      '🔍 Duplicate Detection': `The AI automatically flags if the same invoice number from the same vendor appears twice — a common and costly error called "double-payment." Example: If someone enters GM Invoice #GM-2026-1847 twice, a red warning appears immediately.`,

      '💳 Purchase Orders Tab': `Pre-authorized purchase orders created before goods arrive. When the invoice arrives, it's matched against the PO. A "3-way match" (PO + Receipt + Invoice) is the gold standard for AP control. Any invoice that doesn't match an approved PO requires extra review.`,

      '📊 AP Aging Tab': `Shows how long invoices have been outstanding in buckets: Current (not yet due), 30+ Days (past due), 60+ Days (seriously overdue), 90+ Days (call the vendor today). Example: $23K in 90+ Days means the dealership owes $23,000 that is 90 days overdue — risk of supply cutoff or late fees.`,

      '🧾 Use Tax Tab': `Tracks use tax obligations — a tax on items purchased out-of-state without sales tax. Example: If the dealership buys software from an out-of-state vendor and doesn't pay sales tax, it owes "use tax" to the state instead. This tab tracks those obligations so you don't miss them at tax time.`,
    },
    tips: [
      'Pay invoices with early-payment discounts (2/10 net 30) first — 2% discount = 36% annual ROI',
      'Never pay an invoice that doesn\'t have a corresponding PO or manager approval',
      'Check the 90+ Day aging weekly — overdue payables damage vendor relationships and credit ratings',
      'Use tax is commonly missed and can result in large state tax audits — keep this tab clean',
      'The AI codes most invoices to the correct GL account automatically — only review the exceptions',
    ],
    legacyScreens: ['menuap', 'apinvkey', 'apageing'],
    legacyContext: 'Replaces the legacy AP Menu, Invoice Key Entry, and AP Aging Report screens. Invoice approval workflow and duplicate detection are new capabilities in AMACC 2.0.',
  },

  // ═══════════════════════════════════════════════════════════════
  // PERIOD CLOSE / END OF MONTH (WF-A006)
  // ═══════════════════════════════════════════════════════════════
  'period-close': {
    title: 'Period Close — End of Month',
    overview: `Month-end close is the process of "locking" the books for a completed month — like putting a padlock on January so no one can accidentally change January's numbers in February. It's a multi-step checklist that ensures all transactions are recorded, all accounts reconcile, and the financial statements are accurate before the period is permanently sealed. The AI handles most of the steps automatically, but a few require your review and approval.`,
    sections: {
      '📋 Close Pipeline Steps': `12 sequential steps that must complete in order: (1) Verify trial balance is balanced, (2) Review all draft entries, (3) Post pending transactions, (4) Run depreciation, (5) Accrue unpaid expenses, (6) Reconcile bank accounts, (7) Reconcile AR/AP aging, (8) Generate financial statements preview, (9) Controller review & approval, (10) Lock the period, (11) Archive statements, (12) Open next period. Each step must complete before the next can start.`,

      '🤖 AI-Automated Steps': `The AI EOM Orchestration Agent handles steps 1, 3, 4, 5, 7, 11, and 12 automatically — you don't need to do anything for these. It will tell you if it finds a problem that needs human judgment.`,

      '👤 Human-Required Steps': `Steps 2, 6, 8, 9, and 10 require a human controller to review and approve. Step 9 (Controller Approval) is the most important — the controller signs off that they've reviewed all financials and the numbers are correct before the period is locked.`,

      '⏰ Close Status Indicators': `Green check = complete. Blue spinner = AI is working on it right now. Red X = blocked, needs attention. Gray = waiting for earlier steps. The timeline shows how long each step took.`,

      '⚠️ Destructive Steps (Steps 065+)': `Once step 065 (Period Lock) is executed, it CANNOT be reversed without special IT intervention. This is by design — a closed period should never be changed. Make absolutely sure all reviews are done before approving the lock step.`,
    },
    tips: [
      'Start the close process no later than the 3rd of the following month',
      'The most common blocker: draft journal entries not posted. Run a "Draft Entries Report" before starting',
      'Bank reconciliation (Step 6) usually takes the most human time — gather all bank statements beforehand',
      'Never approve the Period Lock (Step 10) under pressure — if you\'re not sure, ask your CFO first',
      'If the AI gets stuck on any step, check the EOM Dashboard for the specific error message',
    ],
    legacyScreens: ['purge13', 'menum', 'prgeom'],
    legacyContext: 'Replaces COBOL EOM PURGE Program 13 and the End-of-Month menu. The 12-step pipeline is the same sequence as the legacy system but now with AI automation for most steps and a visual progress tracker.',
  },
  // ─── Added entries for all routes ────────────────────────────────────────

  'command-center': {
    title: '⚡ Accounting Command Center',
    overview: 'Your real-time accounting operations hub. Think of it as air traffic control for your dealership\'s finances — every alert, unposted entry, GL imbalance, and AI agent finding surfaces here. Controllers start their day here to catch anything that needs attention before it becomes a problem.',
    sections: {
      'Live Stats Strip': 'Six tiles at the top show real-time counts: unposted entries, GL balance status, MTD revenue, net income, AR outstanding, and AP outstanding. These pull live from the GL service every 5 minutes.',
      'Exception Queue': 'Actionable items requiring a human decision: large AR balances, draft entries over $10K, zero-activity accounts. Each tile shows dollar exposure, age, and a one-click action button.',
      'GL Account Monitor': 'Lists all GL accounts with current balance. A red "Variance" alert means debits ≠ credits — must be resolved before month-end close.',
      'Revenue & Expenses': 'Bar chart comparing MTD revenue vs expenses by department. Spot which department is over-spending before the month closes.',
      'Dept Performance': 'GP% per department vs target. Green = at/above target. Red = below target and needs manager attention.',
      'Ashley AI Assistant': 'Ask anything in plain English (e.g., "Why is service GP below target?") and the AI answers using live GL data.',
    },
    tips: [
      'Start every morning here — unresolved items in the exception queue age daily and create audit exposure',
      'GL Variance > $0 means the books are out of balance — stop all postings and resolve this first',
      'Auto-refresh is ON by default for single-entity view, OFF for consolidated view',
      'Clicking any exception tile opens the relevant page directly — no extra navigation needed',
    ],
    legacyContext: 'Replaces running KOMNFIN (daily P&L), KOMBATCH (batch status), and KOMHISTTRAN (transaction history) separately.',
  },

  'recurring-entries': {
    title: '🔁 Recurring / Standard Journal Entries',
    overview: 'Templates for journal entries that repeat every month — depreciation, prepaid amortization, accruals, management fees. Set them up once and the system generates them automatically on the schedule you define. Eliminates the risk of forgetting a monthly accrual.',
    sections: {
      'Template List': 'All active recurring templates with: name, frequency, next run date, and last posted amount. Toggle active/inactive per template.',
      'Create Template': 'Define the GL accounts, amounts (fixed or formula-based), and schedule (monthly, quarterly, annually). For variable amounts, use the formula editor to reference prior-month balances.',
      'Generate Entries': 'Click to generate draft journal entries for all templates due this period. Review the drafts before posting.',
      'History Tab': 'Every entry ever generated from each template, with posting status. Use to verify an accrual was posted last month.',
    },
    tips: [
      'Set depreciation templates to run on the 1st of each month automatically',
      'Formula-based entries (e.g., "1/12 of annual prepaid balance") save hours of manual calculation',
      'Always review generated entries before posting — catch rounding errors or formula drift early',
      'Inactive templates are preserved — reactivate seasonal accruals without recreating them',
    ],
    legacyContext: 'Replaces manual recreation of monthly standard journal entries. Legacy had no template system — controllers maintained a spreadsheet.',
  },

  'accounts-receivable': {
    title: '💳 Accounts Receivable',
    overview: 'Tracks all money owed to the dealership — customer balances, manufacturer warranty reimbursements, and inter-store amounts. The AR sub-ledger must balance to the AR GL account at all times. Controllers review AR aging weekly to identify and collect overdue balances.',
    sections: {
      'AR Aging Summary': 'Balances owed by aging bucket: current, 30, 60, 90+ days. Red rows indicate accounts past 60 days that need collection action.',
      'Customer Balance Detail': 'Click any customer to see their open invoices, payments, and credits. From here you can apply a payment or issue a credit memo.',
      'Cash Application': 'Match incoming payments to open invoices. Unmatched cash sits in a clearing account until applied — keep this queue empty.',
      'Write-Off': 'For uncollectable balances, write-off posts a debit to bad debt expense and credits the AR balance. Requires controller approval.',
      'AR to GL Reconciliation': 'Verifies the total of all open AR items equals the AR GL account balance. Run before every month-end close.',
    },
    tips: [
      'Warranty AR is the most common reconciliation problem — match manufacturer remittance advices promptly',
      'Never leave unmatched cash in clearing for more than 48 hours — it distorts AR aging reports',
      'The write-off button requires supervisor approval — build that into your monthly AR review workflow',
    ],
  },

  'reconciliation-recon': {
    title: '🔍 Reconciliation',
    overview: 'The master reconciliation workspace where accounting staff match GL account balances to external statements. Covers bank accounts, schedule sub-ledgers, and clearing accounts. A fully reconciled set of books is required before month-end close can be approved.',
    sections: {
      'Reconciliation Dashboard': 'Overview of all accounts pending reconciliation with status indicators. Red = not started. Yellow = in progress. Green = completed and approved.',
      'Bank Reconciliation': 'Match GL cash account to bank statement line by line. System auto-clears items that match exactly on amount and date.',
      'Schedule Reconciliation': 'Verify that sub-ledger (AR, AP, floorplan) detail totals equal their respective GL account balances.',
      'Clearing Account Review': 'Clearing accounts should have zero balance at month-end. Any balance requires investigation — money is either missing or double-counted.',
      'Approval Workflow': 'Completed reconciliations require supervisor sign-off. Approved reconciliations are locked and cannot be changed.',
    },
    tips: [
      'Start bank reconciliation as soon as you receive the bank statement — don\'t wait until month-end',
      'Outstanding deposits older than 3 days are a red flag — investigate before they age further',
      'Clearing account balances at month-end almost always indicate a posting was done to the wrong account',
    ],
  },

  'allocation-templates': {
    title: '⚖️ Allocation Templates',
    overview: 'Defines rules for splitting shared expenses across departments, stores, or cost centers. For example, a single insurance bill can be automatically split 40% to Service, 35% to Parts, and 25% to F&I based on headcount or revenue. Eliminates manual journal entry splitting every month.',
    sections: {
      'Template List': 'All active allocation templates with split percentages and last-used date. Templates can be tagged by expense type.',
      'Create Template': 'Define the source GL account, split method (percentage, headcount, revenue), and target accounts. The percentages must add up to 100%.',
      'Allocation Basis': 'Choose how to calculate the split: fixed percentage, or dynamic (calculated from payroll headcount, department revenue, or square footage at month-end).',
      'Apply Allocation': 'Run the allocation for the current period — generates draft journal entries which you review before posting.',
      'Audit Trail': 'Shows every allocation run with the basis data used, the calculated amounts, and who approved the posting.',
    },
    tips: [
      'Dynamic allocations based on revenue are more accurate than fixed percentages — use them for variable shared costs',
      'Review allocation percentages annually — headcount and revenue mix changes over time',
      'Always post allocations before running department P&L reports so the expense split is reflected accurately',
    ],
  },

  'warranty': {
    title: '🛠️ Warranty',
    overview: 'Tracks open manufacturer warranty claims from repair order write-up through reimbursement receipt. The service accounting team uses this to ensure all warranty work is billed to the manufacturer and that reimbursements are posted correctly to the warranty AR account. Warranty reimbursements are a significant revenue stream that must be reconciled monthly.',
    sections: {
      'Open Claims': 'All warranty claims submitted but not yet reimbursed. Shows claim age, amount, and manufacturer. Claims over 60 days are flagged — most manufacturers have a submission deadline.',
      'Submit Claim': 'Send the warranty claim to the manufacturer\'s DCS portal. The system bundles the RO details and parts used.',
      'Reimbursement Matching': 'When the manufacturer remittance arrives, match it to open claims. Partial reimbursements (manufacturer adjustments) must be reviewed and posted.',
      'Warranty Accrual': 'Estimate of warranty claims filed but not yet reimbursed at month-end. Posted as an accrual entry to avoid understating warranty revenue.',
      'Chargeback Tracking': 'Manufacturer chargebacks (warranty claims rejected after initial payment) are recorded here and offset against warranty revenue.',
    },
    tips: [
      'Submit warranty claims within 30 days of repair — most manufacturers reject claims older than 60 days',
      'Reconcile warranty AR monthly — the balance should equal the total of open claims on this screen',
      'Chargebacks reduce net warranty revenue — review them with your service manager to identify and fix submission errors',
    ],
  },

  'ai-agents': {
    title: '🤖 AI Agents',
    overview: 'The monitoring dashboard for the five AI agents that run in the background of AutoMate Accounting. Each agent specializes in a domain: GL Integrity, EOM Orchestration, Payroll Verification, AP/AR Processing, and T1 Copilot (natural language assistant). Controllers can see what each agent is doing, review its findings, and override its recommendations.',
    sections: {
      'Agent Status': 'Live status for all five agents: Running, Idle, Needs Review, or Error. A "Needs Review" status means the agent found something it wants a human to look at.',
      'GL Integrity Agent': 'Continuously scans the GL for anomalies: unusual account balances, missing offsetting entries, and transactions that don\'t match historical patterns.',
      'EOM Agent': 'Orchestrates the month-end close process, automating the non-human steps and queuing the human-approval steps in the right order.',
      'Payroll Agent': 'Validates payroll runs against prior periods, flags unusual deductions or pay amounts, and prevents double-posting.',
      'AP/AR Agent': 'Processes incoming invoices, matches to POs and receipts, and auto-approves invoices within your configured thresholds.',
      'T1 Copilot': 'Natural language interface — ask questions about your financials and the agent answers using live data. Accessible from any page via the chat bubble.',
      'Agent Findings Log': 'History of every finding each agent has raised, what action was taken, and who resolved it. Your audit trail for AI-assisted decisions.',
    },
    tips: [
      'Review the GL Integrity Agent findings every morning — it catches errors that humans miss when volumes are high',
      'If an agent shows "Error" status, check the system logs immediately — agents in error state aren\'t protecting you',
      'Override any agent recommendation if your professional judgment disagrees — document your reasoning in the comment field',
    ],
  },



  'ml-dashboard': {
    title: '🧠 ML Dashboard',
    overview: 'Monitoring console for the machine learning models that power AutoMate\'s predictive and anomaly detection features. Platform administrators and data science team use this to monitor model health, retrain models on new data, and review prediction accuracy. Not typically used by dealership accounting staff.',
    sections: {
      'Model Registry': 'List of all deployed ML models with version, last trained date, accuracy score, and deployment status.',
      'Model Performance': 'Accuracy and precision metrics for each model over time. A declining accuracy trend indicates the model needs retraining.',
      'Training Jobs': 'History of model training runs — when they ran, how long they took, and whether they improved accuracy.',
      'Prediction Log': 'Sample of recent predictions made by each model with the actual outcome (when available) for validation.',
      'Feature Importance': 'For each model, shows which input features have the most influence on predictions. Useful for explaining model behavior to auditors.',
    },
    tips: [
      'Retrain models after major accounting events (ownership change, manufacturer switch) — the training data no longer reflects current patterns',
      'If a model\'s accuracy drops below 80%, disable its recommendations until it\'s retrained',
      'The anomaly detection model performs best when given clean, correctly posted GL data as training input',
    ],
  },

  'group-dashboard': {
    title: '🏢 Group Dashboard',
    overview: 'Consolidated view of all dealerships in the group on one screen. CFOs and group controllers use the group dashboard to see the financial health of the entire organization at a glance — consolidated revenue, net income, inter-store balances, and each entity\'s close status. Drill into any store for detail.',
    sections: {
      'Group P&L Summary': 'Consolidated revenue, gross profit, and net income for all entities. Intercompany transactions are eliminated before consolidation.',
      'Entity Status Grid': 'Each store shows its current-period status: books open, EOM in progress, period closed. Red = issues blocking close.',
      'Consolidated Balance Sheet': 'Group-level balance sheet with intercompany receivables/payables eliminated. Required for bank covenant reporting.',
      'Cash Position': 'Combined cash across all bank accounts in the group. Shows which stores have surplus cash and which may need a sweep.',
      'Comparative Analysis': 'Side-by-side P&L for all entities — instantly see which stores are above and below group average on key metrics.',
    },
    tips: [
      'The group dashboard auto-refreshes when any entity posts or closes a period — you always see current data',
      'Cash Position is the most time-sensitive metric — check it every morning for large groups',
      'Stores with red status in the Entity Status Grid need attention before the group can produce consolidated financials',
    ],
  },

  'user-settings': {
    title: '👤 User Settings',
    overview: 'Personal preferences and account settings for the logged-in user. Change your display name, notification preferences, default dashboard, and two-factor authentication settings. These settings affect only your account — system-wide settings are in System Settings.',
    sections: {
      'Profile': 'Name, email, phone, and profile photo. Used in approval audit trails and email notifications.',
      'Notifications': 'Choose which events trigger email or in-app alerts: GL variances, pending approvals, EOM reminders, payroll alerts.',
      'Default Dashboard': 'Choose which screen opens when you log in: Command Center, Financial Dashboard, or a custom saved analytics view.',
      'Two-Factor Authentication': 'Enable 2FA using an authenticator app (TOTP). Strongly recommended for all accounting staff — required for controllers.',
      'Session Settings': 'Adjust auto-logout timeout. Default is 30 minutes of inactivity — increase only on secured workstations.',
    },
    tips: [
      'Enable 2FA immediately after onboarding — it is required for SOX compliance in most dealership groups',
      'Set your default dashboard to Command Center if you are the primary controller — it shows the most actionable information first',
      'Notification settings can be overridden per-alert type — turn off low-priority alerts while keeping high-priority ones',
    ],
  },

  'query-explorer': {
    title: '🔎 Query Explorer',
    overview: 'A read-only SQL-like query interface for power users who need to extract specific data not covered by standard reports. Accounting managers and IT staff use this to answer ad-hoc questions (e.g., "show me all entries over $100K posted by a specific user in Q3") without needing a developer.',
    sections: {
      'Query Builder': 'Visual drag-and-drop query builder. Select a table, add filters, choose columns, and set sort order. Generates a safe read-only query.',
      'Results Grid': 'Query results in a sortable, filterable grid. Export to CSV or Excel.',
      'Saved Queries': 'Save frequently used queries for reuse. Share queries with other users.',
      'Query History': 'Last 50 queries you\'ve run with timestamps. Re-run any prior query with one click.',
      'Schema Browser': 'Browse available tables and their columns with descriptions. Hover over a column for its data type and meaning.',
    },
    tips: [
      'All queries are read-only — you cannot accidentally change data from this screen',
      'Large date ranges can return millions of rows — always add a date filter to keep results manageable',
      'Saved queries are great for recurring auditor requests — build them once, run them every quarter',
    ],
  },

  'tax-adapter': {
    title: '🧾 Tax Adapter',
    overview: 'Connects AutoMate to your tax calculation engine (Avalara, Vertex, or custom). Every taxable transaction — vehicle sales, parts, and service — runs through the tax adapter to calculate the correct state, county, and city tax amounts before posting. Keeps your tax calculations compliant without manual rate maintenance.',
    sections: {
      'Adapter Configuration': 'Select your tax engine provider and enter API credentials. Test the connection before going live.',
      'Transaction Log': 'Every tax calculation request and response. Use to diagnose why a specific transaction was taxed at an unexpected rate.',
      'Override Rules': 'Define exceptions to the tax engine\'s standard rules — e.g., fleet sales tax exemptions, resale certificates.',
      'Sync Status': 'Shows whether the tax engine\'s rate tables are current. Rates must be updated at least monthly.',
    },
    tips: [
      'Test the adapter connection after any provider credential change — a broken adapter means untaxed transactions',
      'Review the transaction log when a customer disputes their tax charge — it shows exactly what rate was applied and why',
      'Exemption certificates must be on file before applying tax-exempt status to a customer',
    ],
  },

  'tax-jurisdictions': {
    title: '🗺️ Tax Jurisdictions',
    overview: 'Manages the list of tax jurisdictions where your dealership operates. For multi-state groups, each state has different sales tax rules, rates, and remittance schedules. This screen maintains the jurisdiction configuration that drives tax calculations and determines which state returns to file.',
    sections: {
      'Jurisdiction List': 'All configured jurisdictions with current tax rates, effective dates, and remittance due dates.',
      'Add Jurisdiction': 'Register a new state or local jurisdiction when you expand into a new market or open a new store.',
      'Rate History': 'Complete history of rate changes for each jurisdiction. Required for audits — tax authorities may question rates applied in prior periods.',
      'Remittance Calendar': 'Shows tax payment due dates for all jurisdictions. Color-coded by urgency (red = due within 7 days).',
    },
    tips: [
      'Update jurisdiction rates immediately when your tax engine notifies you of a rate change',
      'Some jurisdictions have special rules for vehicle sales vs service — configure each separately',
      'The remittance calendar integrates with AP — due dates auto-create reminder items in the approval queue',
    ],
  },

  'tax-exemptions': {
    title: '🏷️ Tax Exemptions',
    overview: 'Manages tax exemption certificates for customers who are not subject to sales tax — government entities, resellers, and tax-exempt organizations. Storing exemption certificates here ensures they are automatically applied when processing transactions for those customers.',
    sections: {
      'Exemption List': 'All active exemption certificates by customer with expiration dates. Expired certificates are highlighted in red.',
      'Add Exemption': 'Upload the customer\'s exemption certificate and enter the certificate number, issuing state, and expiration date.',
      'Expiration Alerts': 'The system alerts you 30 days before a certificate expires so you can request a renewal from the customer.',
      'Audit Report': 'Generates a list of all tax-exempt transactions for a period, grouped by customer, for use in sales tax audits.',
    },
    tips: [
      'Never apply tax-exempt status without a valid certificate on file — it creates liability in a sales tax audit',
      'Government entities often have permanent exemptions — note this during setup so they never expire incorrectly',
      'The audit report is the first document a state auditor will ask for — keep it accurate and up-to-date',
    ],
  },

  'tax-results': {
    title: '📊 Tax Results',
    overview: 'Shows the output of tax calculations by period — total taxes collected, broken down by jurisdiction, transaction type, and tax category. Used by the accounting team to prepare sales tax returns and to reconcile the tax liability GL account.',
    sections: {
      'Tax Summary': 'Total taxes collected by jurisdiction for the selected period. This is the starting point for preparing your sales tax returns.',
      'Transaction Detail': 'Every taxable transaction with the tax amount, jurisdiction, and rate applied. Drill down on any jurisdiction to see its transactions.',
      'Reconciliation': 'Reconciles total taxes per this report to the sales tax payable GL account balance. Must be zero before filing.',
      'Export for Filing': 'Exports tax data in the format required for each jurisdiction\'s online filing portal.',
    },
    tips: [
      'Always reconcile before filing — a discrepancy between collected tax and GL balance means something was posted incorrectly',
      'Vehicle sales and service tax may be separated by jurisdiction — export each separately if required',
      'File early when possible — late sales tax filings carry significant penalties in most states',
    ],
  },

  'tax-exceptions': {
    title: '⚠️ Tax Exceptions',
    overview: 'A queue of transactions where tax calculation failed, returned unexpected results, or was flagged for manual review. Every exception must be resolved before the period\'s tax returns can be finalized. Common causes: invalid customer address, missing jurisdiction mapping, or an API timeout with the tax engine.',
    sections: {
      'Exception Queue': 'All unresolved tax exceptions for the current period with error type, transaction details, and recommended resolution.',
      'Resolve Exception': 'Options for each exception: retry with corrected data, manually override the tax amount, or flag as exempt (with reason).',
      'Exception History': 'Resolved exceptions from prior periods — useful for identifying recurring patterns.',
      'Bulk Retry': 'For exceptions caused by a temporary tax engine outage, bulk retry re-submits all failed calculations at once.',
    },
    tips: [
      'Resolve exceptions weekly — the queue grows fast during high-volume periods and becomes overwhelming at month-end',
      'Most exceptions are address-related — ensure customer addresses are complete before creating transactions',
      'Document your resolution reason for manual overrides — auditors will ask why the calculated tax was changed',
    ],
  },

  'tax-reconciliation': {
    title: '🔄 Tax Reconciliation',
    overview: 'Formally reconciles taxes collected (per transaction records) to taxes remitted (per payment records) and the tax liability GL account. Required before each filing period to ensure you\'re neither over-paying nor under-paying sales tax. A completed reconciliation is your defense in a tax audit.',
    sections: {
      'Collected vs Remitted': 'Side-by-side comparison of taxes collected from customers and taxes paid to jurisdictions. Any difference is your current tax liability or overpayment.',
      'Liability Account Tie-Out': 'The GL tax payable balance must equal the difference between collected and remitted. Discrepancies indicate a posting error.',
      'Filing History': 'Record of all tax returns filed with filing date, amount, and jurisdiction. Links to the source return documents.',
      'Audit Support Package': 'Generates a complete reconciliation package (collected, remitted, GL tie-out, and transaction detail) in a single PDF for auditor delivery.',
    },
    tips: [
      'This reconciliation should be completed before every monthly tax payment — don\'t file and then reconcile',
      'Overpayments to jurisdictions can be claimed as credits on the next return — document them here',
      'The audit support package takes 2-3 minutes to generate — run it at period close and store a copy offline',
    ],
  },

  'vehicle-units': {
    title: '🚗 Vehicle Units',
    overview: 'The inventory ledger for all vehicles — new, used, and demo. Every vehicle has a unit record with its cost, selling price, and accounting status. The vehicle accounting team uses this screen to post vehicle acquisitions, manage floorplan obligations, and verify cost of sale when a vehicle is sold.',
    sections: {
      'Unit List': 'All vehicles in inventory with stock number, VIN, year/make/model, cost, and days in stock. Sort by days to identify aged inventory.',
      'Unit Detail': 'Complete accounting history for a single vehicle: acquisition cost, floor plan principal, any reconditioning costs posted, and ultimate sale price.',
      'Acquisition Posting': 'Record a new vehicle purchase — debits vehicle inventory, credits floorplan payable (or accounts payable for cash purchase).',
      'Cost of Sale': 'When a vehicle sells, this posts the cost-of-sale entry: debit COGS, credit vehicle inventory. Must match the deal jacket cost exactly.',
      'Inventory Aging': 'Bar chart of inventory by age bucket. New vehicles over 60 days and used vehicles over 45 days need management attention.',
    },
    tips: [
      'Specific Identification per VIN is the only correct costing method for vehicles — never use averaging',
      'Reconditioning costs must be posted to the vehicle\'s unit record before it sells — late posting distorts gross profit',
      'The day count resets to zero when a vehicle transfers between stores — set up intercompany transfer rules correctly',
    ],
  },

  'floor-plan': {
    title: '🏦 Floor Plan Workbench',
    overview: 'Manages the dealership\'s floor plan financing — the line of credit used to purchase vehicle inventory. Every vehicle in stock has a floor plan obligation that accrues interest daily. The accounting team uses this screen to pay curtailments, post interest accruals, and reconcile the floor plan balance to the lender\'s statement.',
    sections: {
      'Floor Plan Balance': 'Current principal outstanding to each lender, broken down by vehicle. Total should match your lender\'s daily balance statement.',
      'Curtailment Schedule': 'Lenders require periodic principal payments (curtailments) on aged inventory. This screen shows which vehicles have curtailments due and the required payment amounts.',
      'Interest Accrual': 'Daily interest accrual posting. The system calculates interest per vehicle based on principal and your floor plan rate. Review and post monthly.',
      'Payoff Processing': 'When a vehicle sells, the floor plan principal for that unit is paid off. This screen processes the payoff and updates the lender balance.',
      'Lender Reconciliation': 'Compare AutoMate\'s floor plan balance to the lender\'s statement line by line. Discrepancies must be resolved before month-end.',
    },
    tips: [
      'Post interest accruals on the last day of the month — never before, as rates can change intra-month',
      'Curtailment due dates come directly from the lender — missing a curtailment can trigger a covenant violation',
      'Payoffs should be processed same-day as vehicle sale funding — every extra day costs you interest',
    ],
  },

  'sot-monitor': {
    title: '📡 SOT Monitor',
    overview: 'Statement of Terms (SOT) monitoring for manufacturer floor plan programs. Manufacturers provide monthly SOT reports showing eligible vehicles, funding status, and curtailment requirements. The SOT Monitor imports these reports and reconciles them against AutoMate\'s floor plan records.',
    sections: {
      'SOT Import': 'Upload the manufacturer\'s SOT file (typically CSV or XML). The system parses and maps it to your vehicle unit records.',
      'Funding Status': 'Shows which vehicles are funded, unfunded, or have discrepancies between the manufacturer\'s record and AutoMate\'s record.',
      'Variance Report': 'Any vehicle where the manufacturer\'s balance differs from AutoMate\'s balance. Must be investigated and resolved.',
      'Audit Trail': 'History of all SOT imports with import date, record count, and variance count.',
    },
    tips: [
      'Import the SOT report within 2 business days of receipt — late import delays the reconciliation process',
      'Funding discrepancies often result from vehicles being on different accounting systems — involve the manufacturer representative if a variance persists',
      'Print the variance report for your floor plan lender meeting — lenders appreciate seeing you actively monitor discrepancies',
    ],
  },

  'floor-plan-interest': {
    title: '💰 Floor Plan Interest',
    overview: 'Dedicated screen for reviewing, calculating, and posting floor plan interest charges. Interest is one of the largest variable expenses for a dealership — this screen helps you understand exactly what you\'re paying, by vehicle and by lender, every month.',
    sections: {
      'Interest Summary': 'Total interest by lender for the current month. Compared to prior month — a large increase usually means inventory levels grew or aged significantly.',
      'Per-Vehicle Detail': 'Interest accrued on each vehicle this month based on principal balance, number of days, and interest rate.',
      'Rate Management': 'Floor plan interest rates change with market rates. Update rates here when your lender notifies you of a rate change.',
      'Interest Posting': 'Review the calculated interest and post to GL — debit floor plan interest expense, credit accrued interest payable.',
      'Monthly Report': 'Lender-formatted report for reconciling interest charges to your lender statement.',
    },
    tips: [
      'Floor plan rates often adjust with prime rate — check for rate change notifications from your lender monthly',
      'Interest on demo vehicles may be treated differently (expensed to a demo account) — verify your accounting policy before posting',
      'Keeping average days in stock low is the most effective way to control floor plan interest expense',
    ],
  },

  'deal-postings': {
    title: '📝 Deal Postings',
    overview: 'The interface between the F&I deal jacket and the GL. When a vehicle deal is funded, the deal posting screen processes the financial transaction — recording vehicle cost of sale, F&I income, trade-in proceeds, and customer financing. This is the most financially significant single transaction type in a dealership.',
    sections: {
      'Unposted Deals': 'Funded deals awaiting GL posting. Each shows deal number, vehicle, sale price, front-end gross, and back-end gross.',
      'Deal Detail': 'Full financial breakdown of a deal: gross on vehicle, trade-in allowance vs ACV, F&I products sold, lender financing terms, and total dealer profit.',
      'Posting Preview': 'Before posting, shows all journal entry lines that will be created. Review to ensure the accounting is correct.',
      'Post Deal': 'Posts the deal to GL. Debits and credits span multiple accounts: vehicle COGS, inventory, F&I revenue, trade-in payable, and customer receivable.',
      'Posted Deal History': 'All deals posted in the current period with a link to the journal entry for each.',
    },
    tips: [
      'Never post a deal until it is fully funded — the journal entry should reflect the actual money received',
      'Trade-in ACV (actual cash value) vs trade allowance creates pack profit — ensure it\'s being posted to the correct pack account',
      'F&I reserve income may be deferred — confirm your accounting policy with your CFO before setting up the F&I revenue accounts',
    ],
    legacyContext: 'Deal posting replaces manual journal entry creation from paper deal jackets in the legacy system.',
  },

  'inquiry-menu': {
    title: '🔍 Accounting Inquiry',
    overview: 'Central navigation menu for all inquiry screens. Inquiry screens are read-only views into the GL, schedules, and transaction history. Use inquiry screens to answer questions ("What was posted to account 4100 last Tuesday?") without the risk of accidentally changing data.',
    sections: {
      'GL Inquiry': 'Search GL accounts by number or name, see current balance, and drill into all transactions posted to that account.',
      'Schedule Inquiry': 'View the open items on any schedule sub-ledger — AR, AP, floorplan, etc.',
      'Transaction Inquiry': 'Search all transactions by any combination of date, amount, account, or source.',
    },
    tips: [
      'Use inquiry screens for research — never use the journal entry or posting screens just to look something up',
      'Bookmark the GL Inquiry screen — it\'s the fastest way to answer the GM\'s question "what\'s in account X right now?"',
    ],
  },

  'schedule-inquiry': {
    title: '📋 Schedule Inquiry',
    overview: 'Read-only view of schedule sub-ledger detail. Look up any open item on any schedule account — useful when a vendor or customer calls about a specific transaction. Find the item, see its history, and confirm it\'s in the system correctly without any risk of changing data.',
    sections: {
      'Account Selector': 'Choose the schedule account to inspect (AR, AP, floorplan, warranty receivable, etc.).',
      'Open Items List': 'All open items on the selected account with original amount, payments applied, and remaining balance.',
      'Item History': 'Click any item to see its full posting history — original invoice, all payments, and any adjustments.',
      'Balance Check': 'Displays the schedule total and the corresponding GL account balance side by side. Shows any reconciling difference.',
    },
    tips: [
      'When a vendor disputes a payment, use this screen to show them the payment date and amount from your records',
      'If the schedule total differs from the GL balance, use the balance check tool to identify the discrepancy amount and isolate which item is causing it',
    ],
  },

  'transaction-inquiry': {
    title: '🔎 Transaction Inquiry',
    overview: 'Read-only search across the complete transaction history. Every posted journal entry line is searchable here. Auditors and controllers use this screen to trace any specific dollar amount back to its original source document.',
    sections: {
      'Search Filters': 'Filter by date range (required), GL account, amount range, source code, description keyword, or journal entry number.',
      'Results List': 'Matching transactions with account, amount, description, and date. Click any row for the full journal entry context.',
      'Amount Range Search': 'Particularly useful for auditors — search for "any transaction between $9,000 and $11,000 in the last quarter" to find potential structured transactions.',
    },
    tips: [
      'Always set a date range — open-ended searches across the full history are very slow',
      'Description keyword search is case-insensitive and supports partial matches',
      'For fraud investigation, combine the amount range filter with a specific user filter in the journal entry source field',
    ],
  },

  'schedule-open-items': {
    title: '📂 Schedule Open Items',
    overview: 'Dedicated view for working with open items on schedule sub-ledgers. Unlike the inquiry screen, this screen allows aging analysis and item-level actions (apply payment, write off, request credit memo). Used during the monthly schedule reconciliation process.',
    sections: {
      'Open Item List': 'All items not yet fully satisfied, with age, original amount, and remaining balance.',
      'Aging Buckets': 'Items categorized into current, 30, 60, and 90+ day buckets. High 90+ balances need immediate collection action.',
      'Apply Payment': 'Record a payment against one or more open items. The system applies it to the oldest item first (FIFO) by default.',
      'Write-Off': 'For uncollectable items, the write-off action records a debit to bad debt expense and closes the item. Requires controller approval.',
      'Credit Request': 'Generate a credit memo request to a vendor for an overcharge or return. Submitted to the vendor and holds the item open pending the credit.',
    },
    tips: [
      'Items in 90+ day bucket are costing you money — prioritize their collection in every weekly AR review',
      'FIFO payment application is standard — but if a vendor specifies which invoice a payment covers, override the auto-application',
      'Write-offs over $500 require controller approval — build this into your monthly review workflow',
    ],
  },

  'mfg-dcs': {
    title: '🏭 Manufacturer DCS',
    overview: 'Integration management for manufacturer Dealer Communication Systems (DCS). Manufacturers (Ford, GM, Toyota, etc.) exchange data with your DMS through their DCS portals — warranty claims, parts orders, financial statement submissions, and incentive programs all flow through here.',
    sections: {
      'Connected Manufacturers': 'List of all active manufacturer DCS connections with status (connected, error, not configured). Green = data flowing normally.',
      'Connection Settings': 'API credentials, endpoints, and authentication certificates for each manufacturer.',
      'Data Exchange Log': 'Record of all data sent to and received from each manufacturer with success/failure status.',
      'Financial Statement Submission': 'Submit your monthly financial statement to the manufacturer in their required format. Some manufacturers require submission by the 10th of the following month.',
      'Incentive Data': 'Incentive and holdback data received from manufacturers — feeds into the deal posting and revenue recognition calculations.',
    },
    tips: [
      'Check DCS connection status on the 1st of each month before attempting financial statement submission',
      'DCS credentials typically expire annually — set a calendar reminder to renew before expiration',
      'Financial statement submission errors from the manufacturer are shown here — read the error message carefully, most are data validation failures',
    ],
  },

  'parts-gl-accounts': {
    title: '🔧 Parts GL Accounts',
    overview: 'Configuration screen mapping parts inventory categories to their GL accounts. When parts are purchased, sold, or returned, the correct GL account is determined by the mapping configured here. Correctly configured parts GL accounts are essential for accurate gross profit reporting by department.',
    sections: {
      'Parts Category Mapping': 'Maps each parts category (OEM, aftermarket, tires, accessories) to its inventory GL account and COGS account.',
      'Vendor Configuration': 'Links each parts vendor to the appropriate AP account and payment terms.',
      'Adjustment Accounts': 'GL accounts used for parts inventory adjustments — overages, shortages, and obsolescence write-offs.',
      'Parts Department P&L Accounts': 'Revenue and expense accounts for the parts department P&L. Verify these match your chart of accounts structure.',
    },
    tips: [
      'Parts GL mapping must be set up before processing the first parts invoice — retroactive remapping is complex',
      'Tires are often treated as a separate revenue category by manufacturer — use a separate tire GL account if your manufacturer requires it',
      'Review parts GL mappings annually to ensure they still match your COA structure',
    ],
  },

  'service-gl-accounts': {
    title: '🛠️ Service GL Accounts',
    overview: 'Configuration screen mapping service repair order types to their GL accounts. Every RO type (customer pay, warranty, internal) has different revenue and expense accounts. Correct mapping ensures your service department P&L accurately reflects the three pay types.',
    sections: {
      'RO Type Mapping': 'Maps each RO type to its labor revenue account, parts revenue account, and sublet revenue account.',
      'Technician Pay Accounts': 'GL accounts for technician wages by classification — flat-rate technicians, hourly service advisors, etc.',
      'Warranty Receivable Account': 'The AR account where warranty reimbursements are tracked. Must be a separate account from customer AR.',
      'Internal RO Accounts': 'GL accounts for internal repair orders (prep work on new vehicles, dealer-owned vehicle repairs). Internal ROs should not appear in customer-facing revenue.',
    },
    tips: [
      'Customer pay, warranty, and internal must always use separate revenue accounts — mixing them makes department P&L meaningless',
      'Sublet work (outsourced to another shop) has its own revenue and cost accounts — ensure both are configured',
      'Internal RO postings net to zero at the department level but affect vehicle reconditioning costs — verify the flow with your CFO',
    ],
  },

  'statement-metadata': {
    title: '📄 Statement Metadata',
    overview: 'Configuration for financial statement line item definitions and layouts. Defines which GL accounts roll into which line on the P&L, balance sheet, and cash flow statement. Required for manufacturer financial statement submissions which must match specific line position requirements.',
    sections: {
      'Statement Layout Editor': 'Drag-and-drop configuration of financial statement line items. Each line maps to one or more GL account ranges.',
      'Manufacturer Line Mapping': 'Maps your internal account structure to the manufacturer\'s required line positions. Critical for financial statement compliance.',
      'Custom Subtotals': 'Define calculated lines (e.g., "Gross Profit = New Vehicle Revenue − New Vehicle COGS") that appear in your statements.',
      'Statement Preview': 'See how a financial statement would look with the current configuration using current-period data.',
    },
    tips: [
      'Never modify statement metadata mid-period — wait until after the period closes so prior period reports remain consistent',
      'Manufacturer line mapping must exactly match the specification in your manufacturer\'s accounting manual',
      'Use the preview function to validate layout changes before the next reporting period',
    ],
  },

  'analysis-codes': {
    title: '🏷️ Analysis Codes',
    overview: 'Defines custom categorization tags (analysis codes) that can be attached to GL transactions for secondary reporting. Common uses: tracking advertising spend by campaign, categorizing repair costs by vehicle type, or tagging expenses by cost center. Analysis codes let you create sub-GL reporting without adding more GL accounts.',
    sections: {
      'Code List': 'All active analysis codes with code, description, and the GL account ranges they apply to.',
      'Create Code': 'Define a new analysis code with a descriptive name and the applicable GL accounts. Codes can be mandatory or optional for a given account.',
      'Analysis Report': 'Generate a report filtered by analysis code — e.g., "All advertising expenses tagged with campaign code ADV-2024-Q4."',
      'Code Usage Audit': 'Shows which transactions are missing analysis codes on accounts where codes are required.',
    },
    tips: [
      'Keep analysis codes simple and well-named — vague codes (like "MISC") lose their value quickly',
      'Make analysis codes mandatory on advertising accounts — ad spend tracking is only useful if every transaction is tagged',
      'Review and retire unused analysis codes annually — code sprawl makes reports confusing',
    ],
  },

  'archive-admin': {
    title: '🗄️ Archive Administration',
    overview: 'Manages the archiving and retrieval of historical accounting data. AutoMate retains 8 years of fully accessible transaction detail (matching legacy COBOL behavior) and archives older records to cheaper storage. Archived data remains retrievable for audits but is not included in normal reports.',
    sections: {
      'Archive Status': 'Shows how much data is in active storage vs archive. Active storage is fast; archive retrieval takes 1-2 minutes.',
      'Archive Policy': 'Configure the retention period (default 8 years) and the archive schedule (runs nightly).',
      'Manual Archive': 'Force-archive a specific period range outside the normal schedule. Use when a fiscal year close needs to be moved to archive early.',
      'Retrieval': 'Request retrieval of archived data for a specific period. Retrieval is non-destructive — archived data returns to active status temporarily.',
      'Archive Verification': 'Confirms archived data is intact and readable. Run annually as part of your disaster recovery validation.',
    },
    tips: [
      'Never delete archived data — archive is not delete. All archived data must remain retrievable for 8 years.',
      'Retrieval requests during an IRS audit can be time-sensitive — test the retrieval process annually so you know how long it takes',
      'The 8-year retention period is derived from the COBOL legacy system behavior and aligns with IRS recordkeeping requirements',
    ],
    legacyContext: 'The 8-year prune rule matches the legacy COBOL behavior: DELETE if JR-DATE < (CUT-YEAR - 8) + CUT-MM.',
  },

  'currency-admin': {
    title: '💱 Currency Administration',
    overview: 'Configures multi-currency support for dealership groups that operate in multiple countries (e.g., US and Canada). Defines exchange rates, functional currencies per entity, and revaluation rules for foreign currency balances at period-end.',
    sections: {
      'Currency Setup': 'Define all currencies used across the group. Each entity has a functional currency; transactions in other currencies are translated.',
      'Exchange Rates': 'Daily exchange rates for all active currency pairs. Rates can be entered manually or pulled from an external rate feed.',
      'Revaluation': 'At period-end, foreign currency balances are revalued at the current rate. The revaluation gain/loss posts to the appropriate FX income/expense account.',
      'Translation Settings': 'Configure how foreign subsidiary financials are translated for consolidation (current rate method vs temporal method per ASC 830).',
    },
    tips: [
      'Update exchange rates daily for high-volume cross-border operations — stale rates create material translation errors',
      'Revaluation entries should be reversed at the start of the next period — use the recurring entry system to automate this',
      'For most single-country US dealerships, multi-currency is not needed — leave this section at default settings',
    ],
  },

  'automation-capabilities': {
    title: '⚡ Automation Capabilities',
    overview: 'Overview of all automation capabilities available in AutoMate Accounting and their current activation status. Think of this as the control panel for which tasks the system performs automatically vs which require human input. Controllers configure automation levels to match their internal controls requirements.',
    sections: {
      'Capability List': 'All available automations with on/off status, description, and the control it replaces. Grouped by category: GL, AP, AR, Payroll, Tax, EOM.',
      'Activation Controls': 'Toggle any capability on or off. Some capabilities are linked — disabling one may disable its dependents.',
      'Audit Requirements': 'For each automation, shows which SOX/audit controls it satisfies and what documentation is generated.',
      'Performance Metrics': 'How many transactions each automation has processed, how many it auto-approved vs flagged for review, and error rate.',
    },
    tips: [
      'Start with conservative automation settings (low auto-approve thresholds) and increase them as you gain confidence',
      'Never disable the "double-post prevention" automation — it is your safety net against the most common accounting error',
      'Document your automation configuration choices in your internal controls policy for auditor reference',
    ],
  },

  'automation-policies': {
    title: '📋 Automation Policies',
    overview: 'Defines the rules that govern automated decision-making — when to auto-approve, when to escalate, and what constitutes an exception. Policies are the "if-then" rules that replace manual review for routine transactions. Well-designed policies reduce manual work while maintaining control.',
    sections: {
      'Policy List': 'All active automation policies with their trigger conditions, actions, and approval chain.',
      'Create Policy': 'Define a new policy: select the transaction type, set the conditions (amount range, vendor, account), and choose the action (auto-approve, escalate, reject).',
      'Policy Testing': 'Test a policy against historical transactions to see how it would have behaved. Use this before activating a new policy.',
      'Conflict Resolution': 'When multiple policies match the same transaction, the conflict resolution rules determine which takes precedence. Higher priority = evaluated first.',
    },
    tips: [
      'Test every new policy against 3 months of historical data before activating — edge cases are hard to anticipate theoretically',
      'Policies with very broad conditions can auto-approve transactions you intended to review — start narrow and broaden gradually',
      'Annual policy review is part of SOX compliance — document that you reviewed and confirmed each policy annually',
    ],
  },

  'automation-queue': {
    title: '📥 Automation Queue',
    overview: 'The live queue of transactions currently being processed by automation engines. Shows what the system is working on right now, what\'s waiting, and what has completed. Use this to monitor automation throughput and identify bottlenecks during high-volume periods (month-end, payroll runs).',
    sections: {
      'Active Processing': 'Transactions currently being processed with elapsed time and current step.',
      'Pending Queue': 'Transactions waiting to be processed, sorted by arrival time. Large queues indicate the system is under load.',
      'Completed Today': 'Summary of transactions completed in the last 24 hours with pass/fail breakdown.',
      'Failed Items': 'Transactions that failed automation processing. Each shows the error message and a "retry" button. Failed items do not post automatically.',
      'Throughput Chart': 'Transactions processed per hour over the last 7 days. Useful for identifying peak load times.',
    },
    tips: [
      'Check the failed items queue every morning — failed automations mean transactions are stuck and not posting',
      'If the pending queue is growing and not shrinking, check whether the automation service itself is running correctly',
      'During month-end, expect higher queue depth — normal. Throughput should still be processing the queue down over time.',
    ],
  },

  'automation-health': {
    title: '🏥 Automation Health',
    overview: 'System health dashboard for the automation engines — API connectivity, processing latency, error rates, and service uptime. IT staff and the controller use this to ensure the automation infrastructure is operating correctly. A degraded automation system means manual fallback processes are needed.',
    sections: {
      'Service Status': 'Real-time status of each automation service: GL processor, AP matcher, AR cash applicator, payroll validator. Green/Yellow/Red.',
      'Error Rate Trend': 'Error rate over the last 30 days. A rising error rate needs investigation — it usually indicates a data quality issue or an external system change.',
      'API Connectivity': 'Status of connections to external systems: tax engine, bank ACH, manufacturer DCS. Failed connections prevent those automations from running.',
      'Performance Metrics': 'Average processing time per transaction type over the last 7 days. Sudden spikes indicate performance degradation.',
      'Incident Log': 'History of automation service incidents with root cause and resolution time.',
    },
    tips: [
      'Subscribe to health alerts so you\'re notified immediately if an automation service goes down',
      'API connectivity failures to the tax engine are the most common issue — check it when any taxable transaction fails',
      'A single day of automation downtime can create hundreds of manual follow-up items — address health issues immediately',
    ],
  },

  'automation-sandbox': {
    title: '🧪 Automation Sandbox',
    overview: 'A safe testing environment where you can run automation rules against real data without actually posting anything. Use the sandbox to validate new policies, test import mappings, or train new staff on automation configuration — nothing in the sandbox affects your production books.',
    sections: {
      'Sandbox Configuration': 'Load a date range of historical data into the sandbox environment. Choose whether to use current automation policies or a draft set you\'re testing.',
      'Simulation Run': 'Execute the automation against the loaded data. See what would have been auto-approved, escalated, or rejected.',
      'Simulation Results': 'Detailed results showing every decision made during the simulation — compare to what actually happened in production.',
      'Policy Comparison': 'Run the same data set through two different policy configurations to compare outcomes before changing production settings.',
    },
    tips: [
      'Always test policy changes in sandbox before activating in production — especially for high-volume transaction types',
      'Use sandbox for new staff training — let them try different configurations without any risk of production impact',
      'A simulation run showing >5% escalation rate on transactions you expected to auto-approve means your policy needs tuning',
    ],
  },

  'automation-ingestion': {
    title: '📨 Automation Ingestion',
    overview: 'Manages the intake of external data files into the AutoMate system for automated processing — vendor invoice feeds, bank transaction files, payroll provider exports, and manufacturer data files. Every data source has an ingestion configuration that maps file fields to AutoMate data structures.',
    sections: {
      'Data Sources': 'List of all configured external data sources with last successful import date and status.',
      'Ingestion Configuration': 'Field mapping for each source: maps the external file\'s columns to AutoMate\'s data model. Includes validation rules.',
      'Import History': 'Every file imported with record count, success count, error count, and error detail.',
      'Manual Upload': 'For sources that don\'t have automated delivery, upload the file manually and trigger processing.',
      'Error Handling': 'Configure what happens when a row fails validation — skip and continue, or halt the entire import.',
    },
    tips: [
      'Set up automated file delivery (SFTP, API) wherever possible — manual uploads are error-prone',
      'Always review error counts on import history — a 1% error rate on a 10,000-row file means 100 transactions didn\'t import',
      'Test new ingestion configurations with a small sample file before loading production data',
    ],
  },

  'automation-lockbox': {
    title: '🔒 Lockbox Processing',
    overview: 'Automates the processing of bank lockbox receipts — payments mailed by customers directly to a bank PO box. The bank scans the checks, extracts the data, and sends a file to AutoMate which automatically creates cash receipts and attempts to match them to open AR invoices. Reduces AR staff manual data entry significantly.',
    sections: {
      'Lockbox File Import': 'Import the daily lockbox file from your bank. The system parses check amounts, customer IDs, and invoice references.',
      'Auto-Match Results': 'Shows which lockbox items were automatically matched to open AR invoices and which require manual matching.',
      'Unmatched Items': 'Lockbox payments that couldn\'t be matched automatically. Review and manually apply each to the correct AR item.',
      'Exception Handling': 'Lockbox items with data quality issues (unreadable amount, unknown customer). Research and resolve before the deposit closes.',
      'Deposit Reconciliation': 'Verifies that the total of all lockbox receipts equals the bank\'s reported deposit amount for that day.',
    },
    tips: [
      'Process lockbox files daily — same-day processing keeps AR current and speeds up customer credit decisions',
      'The auto-match rate improves over time as the system learns your customer payment patterns',
      'Unmatched items left more than 3 days start to distort AR aging — prioritize their resolution',
    ],
  },

  'lifo-engine': {
    title: '📦 LIFO Engine',
    overview: 'Manages the LIFO (Last-In, First-Out) tax accounting layer for vehicle and parts inventory. LIFO accounting creates a difference between the GAAP inventory value (typically FIFO or specific ID) and the tax-basis inventory value. The LIFO reserve is the cumulative difference and is a significant tax deferral tool for growing dealerships.',
    sections: {
      'LIFO Reserve': 'Current LIFO reserve balance by inventory category (new vehicles, used vehicles, parts). Shows GAAP value, LIFO value, and the reserve (difference).',
      'LIFO Pool Management': 'LIFO pools group similar inventory items. Configuration determines which vehicles or parts belong to which pool.',
      'Annual Computation': 'Run at year-end to calculate the change in LIFO reserve for the year. This is the LIFO income/expense adjustment for tax purposes.',
      'Index Selection': 'Choose the inventory price index to use for LIFO computation — automotive dealer indexes are provided by industry associations.',
      'IRS Form 970': 'Generates the LIFO election form data required for first-year LIFO adoption and the annual LIFO disclosure attachment to the tax return.',
    },
    tips: [
      'LIFO is a tax election — once adopted, switching away requires IRS approval. Discuss with your CPA before activating.',
      'LIFO reserve grows in inflationary environments (good for tax deferral) and shrinks in deflationary ones',
      'Run the annual computation in draft mode first to review the impact before finalizing',
    ],
    legacyContext: 'Replaces the COBOL LIFO engine (BUILD-013). Same computational logic, now with UI and audit trail.',
  },

  'chargeback': {
    title: '↩️ Chargeback Management',
    overview: 'Tracks and processes chargebacks from manufacturers, customers, and lenders. A chargeback is money paid to the dealership that is subsequently taken back — warranty reimbursement adjustments, F&I product cancellations, and credit card disputes. Chargebacks reduce revenue and must be posted promptly to keep AR accurate.',
    sections: {
      'Open Chargebacks': 'All chargebacks received but not yet posted. Shows source (manufacturer, customer, lender), original transaction, and chargeback amount.',
      'Post Chargeback': 'Process the chargeback — reverses or offsets the original revenue posting and reduces the AR balance.',
      'Dispute Workflow': 'When you disagree with a chargeback, log the dispute here. The system tracks the dispute status and due date for lender responses.',
      'Chargeback Analysis': 'Monthly summary of chargebacks by source and type. High warranty chargeback rates indicate a submission quality problem.',
    },
    tips: [
      'Post chargebacks on the day received — a large unposted chargeback overstates your AR and income',
      'Dispute warranty chargebacks within the manufacturer\'s window (usually 30 days) or they become permanent',
      'High F&I chargeback rates are an early warning of customer complaint issues — bring to the F&I manager\'s attention immediately',
    ],
  },

  'portfolio': {
    title: '📊 Portfolio Management',
    overview: 'Manages the dealership\'s financial asset portfolio — investments, cash equivalents, and any BHPH (Buy Here Pay Here) loan portfolios if applicable. Controllers use this to monitor investment performance, manage maturity ladders, and ensure portfolio assets are correctly valued on the balance sheet.',
    sections: {
      'Portfolio Summary': 'Total portfolio value with breakdown by asset type: cash, money market, CDs, and loan portfolios.',
      'Asset Detail': 'Individual holdings with purchase price, current value, maturity date, and unrealized gain/loss.',
      'BHPH Loan Portfolio': 'For dealerships with in-house financing — tracks outstanding loan balances, payment history, and delinquency rates.',
      'Valuation Updates': 'Record mark-to-market adjustments for assets held at fair value. Posts unrealized gain/loss to the appropriate income account.',
      'Portfolio Report': 'Board-ready report of portfolio composition, performance, and comparison to benchmark.',
    },
    tips: [
      'CD maturity dates need attention — unrenewed CDs sitting in a checking account earn no interest',
      'BHPH portfolios require separate delinquency reserves — calculate and post monthly',
      'Portfolio assets are balance sheet items — verify they are correctly classified (current vs non-current) based on maturity',
    ],
  },

  'sox-compliance': {
    title: '🔐 SOX Compliance',
    overview: 'Documentation and monitoring tools for Sarbanes-Oxley Act compliance. While smaller dealerships are not legally required to comply with SOX, multi-entity groups with institutional investors or bank covenants are increasingly expected to demonstrate SOX-like internal controls. This screen documents your control environment.',
    sections: {
      'Control Framework': 'The list of internal controls in your accounting environment — segregation of duties, approval workflows, reconciliation procedures.',
      'Control Testing': 'Log evidence of control testing (e.g., "Reviewed 20 random journal entry approvals and confirmed all were authorized by a second party").',
      'Deficiency Tracking': 'Log control deficiencies found during testing with severity (significant vs material) and remediation plan.',
      'Audit Evidence Repository': 'Centralized storage for all audit evidence: reconciliations, approval records, policy documentation.',
      'Compliance Dashboard': 'Summary of control testing completion, open deficiencies, and remediation status for the current period.',
    },
    tips: [
      'Document control testing monthly, not just at year-end — auditors want to see a consistent testing cadence',
      'Segregation of duties is the most important control — ensure no single person can both create and approve a journal entry',
      'The audit evidence repository should be accessible to external auditors — organize it for readability',
    ],
  },

  'doc-report': {
    title: '📄 DOC Report',
    overview: 'The Document of Completeness (DOC) report verifies that all required financial documents for the period are present and posted. Used as a final checklist before period-end close. Every dealership must verify that no deals, receipts, or invoices are in draft state when the period closes.',
    sections: {
      'Completeness Check': 'Runs through all transaction types (deals, receipts, invoices, payroll) and flags any in draft, pending, or unposted status.',
      'Missing Documents': 'List of specific documents identified as missing or incomplete, with the responsible party and due date.',
      'Sign-Off': 'Controller attests that all required documents are present and accounted for. This sign-off is logged with timestamp.',
      'Prior Period Comparison': 'Compares document counts to prior period to identify unusual drops (e.g., 30% fewer invoices than last month — is something not being imported?).',
    },
    tips: [
      'Run the DOC report 3 days before EOM close to give staff time to find and post missing items',
      'The "prior period comparison" flag is often the first sign of an import or interface failure',
      'The controller\'s sign-off on the DOC report is required documentation for the period-end close package',
    ],
  },

  'statement-packages': {
    title: '📦 Statement Packages',
    overview: 'Assembles and delivers financial statement packages to manufacturers, banks, and management. Each manufacturer has a specific format and submission deadline. Statement packages bundle the trial balance, P&L, balance sheet, and supplemental schedules into the exact format required by each recipient.',
    sections: {
      'Package Templates': 'Pre-built templates for each manufacturer (Ford, GM, Toyota, etc.) and for common bank formats. Each template defines which reports are included and the formatting requirements.',
      'Build Package': 'Select the template, period, and entity, then click Build. The system generates all required reports and bundles them into a single PDF or electronic file.',
      'Submission History': 'Record of all packages submitted with date, recipient, and confirmation number (if electronic).',
      'Submission Deadlines': 'Calendar of upcoming submission deadlines with days remaining. Color-coded: green (on time), yellow (5 days out), red (due within 2 days).',
    },
    tips: [
      'Most manufacturers require submission by the 10th of the following month — set a reminder for the 8th to build and review',
      'Electronic submissions to manufacturer portals via DCS are preferred — they provide an instant acknowledgment',
      'Keep a copy of every submitted package in the audit evidence repository',
    ],
  },

  'compliance-pack': {
    title: '📋 Compliance Pack',
    overview: 'Generates regulatory compliance reports required for state licensing, franchise agreement compliance, and bank covenants. Different from manufacturer reporting, compliance packs address legal and contractual obligations to state DMVs, franchise regulators, and lenders.',
    sections: {
      'Compliance Calendar': 'All compliance report deadlines with days remaining. Missed compliance filings can trigger fines or franchise agreement violations.',
      'Report Builder': 'Configure and generate each compliance report. Fields are pre-mapped from your GL to the regulator\'s required format.',
      'Filing History': 'Record of all compliance reports filed with filing date, method, and confirmation.',
      'Covenant Monitoring': 'For bank loan covenants (e.g., minimum current ratio, maximum debt/equity), monitors your compliance in real time and alerts if you approach a violation threshold.',
    },
    tips: [
      'Bank covenant violations can trigger loan acceleration — monitor the covenant dashboard monthly even when not near threshold',
      'Some state DMV reports require vehicle unit data from multiple departments — ensure all departments have posted before running',
      'Franchise agreement compliance reports often have very specific account mapping requirements — validate with your manufacturer representative annually',
    ],
  },

  'fixed-ops-kpi': {
    title: '📊 Fixed Ops KPI',
    overview: 'Key Performance Indicators dashboard for Fixed Operations — the Service and Parts departments. Shows the leading metrics that determine fixed ops profitability: labor hours sold, effective labor rate, parts-to-labor ratio, technician efficiency, and fixed ops absorption rate.',
    sections: {
      'Absorption Rate': 'Fixed ops gross profit as a percentage of dealership total overhead. Healthy dealerships target 70%+ absorption — meaning fixed ops covers 70% of total overhead.',
      'Labor Metrics': 'Hours available vs hours sold, flat-rate efficiency by technician, and effective labor rate vs menu rate.',
      'Parts Metrics': 'Parts gross margin %, parts-to-labor ratio, and obsolescence rate. Parts gross should run 25-35% for a healthy department.',
      'Service Advisor Metrics': 'Customer pay RO count, average RO value, and CSI score by advisor. Identifies top performers and coaching opportunities.',
      'Trend Charts': 'Month-over-month trends for all KPIs with 13-month history.',
    },
    tips: [
      'Absorption rate below 60% is a warning sign — the dealership is dependent on variable ops to cover overhead',
      'Effective labor rate declining while hours sold is flat means customers are declining additional work — CSI and pricing review needed',
      'Review fixed ops KPIs with the service manager and parts manager in a monthly ops meeting',
    ],
  },

  'variable-ops-kpi': {
    title: '📊 Variable Ops KPI',
    overview: 'Key Performance Indicators for Variable Operations — New and Used Vehicle Sales and F&I. Tracks the metrics that determine variable ops profitability: units sold, front-end gross per unit, F&I income per unit, total PVR (per vehicle retailed), and market days supply.',
    sections: {
      'Units Sold': 'New and used unit counts by period vs target. Click any period to see deal-by-deal detail.',
      'Gross Per Unit': 'Front-end gross (vehicle margin), back-end gross (F&I income), and total PVR for new vs used. Industry average new PVR should run $3,000-$5,000.',
      'F&I Penetration': 'Product penetration rates by F&I product (warranty, GAP, paint protection, etc.). High penetration drives back-end gross.',
      'Inventory Metrics': 'Market days supply and turn rate. New vehicles over 60 days and used over 45 days drag on profitability.',
      'Sales Team Performance': 'Units and gross per salesperson. Identifies top performers and those below expectations.',
    },
    tips: [
      'PVR is the most important variable ops metric — it captures both front and back end in one number',
      'Low F&I penetration despite good unit volume means the F&I department needs training or process improvement',
      'Days supply over 90 on new vehicles indicates an ordering/allocation problem that needs manufacturer discussion',
    ],
  },

  'workers-comp': {
    title: '🦺 Workers Comp Report',
    overview: 'Payroll report for workers\' compensation insurance audits. Shows total wages by employee classification — a key input for workers\' comp premium calculation. Accurate classification of employees (technicians vs service advisors vs office staff) directly affects your premium.',
    sections: {
      'Classification Summary': 'Total wages grouped by workers\' comp classification code. This is the primary data used by your insurer for audit.',
      'Employee Classification': 'Individual employees with their assigned classification code. Review annually to ensure correct classification.',
      'Payroll Date Range': 'Select the audit period (typically the prior policy year). The report covers all payroll within that range.',
      'Export': 'Export in the format required by your insurer for the annual audit submission.',
    },
    tips: [
      'Misclassified employees result in premium adjustments — usually higher rates for technicians vs office staff',
      'New job titles created during the year may need classification codes added before the audit period ends',
      'Run a preliminary workers\' comp report mid-year to estimate your annual premium true-up',
    ],
  },

  'employee-history': {
    title: '👤 Employee History',
    overview: 'Payroll history for individual employees — all pay runs, year-to-date totals, deduction history, and employment periods. Used for employment verification, commission dispute resolution, and employee inquiries about their pay history.',
    sections: {
      'Employee Selector': 'Search by name or employee ID. Active and terminated employees are both accessible.',
      'Pay History': 'All payroll runs for the selected employee with gross, deductions, and net by pay period.',
      'YTD Totals': 'Year-to-date gross, each deduction category, and net pay. Matches what will appear on the W-2.',
      'Deduction Detail': 'History of each deduction type: 401k, health insurance, garnishments. Shows start date, rate, and any changes.',
      'Employment Periods': 'Hire date, termination date (if applicable), and department changes over time.',
    },
    tips: [
      'Commission disputes are best resolved by reviewing the commission detail on each payroll run in this screen',
      'For terminated employees, verify the final pay stub was processed correctly before closing out the employee record',
      'Year-to-date totals are the source of truth for W-2 preparation — any YTD correction requires a payroll adjustment run',
    ],
  },

  'earnings-deductions': {
    title: '💰 Earnings & Deductions',
    overview: 'Configuration and reporting for payroll earnings codes and deduction codes. Every type of pay (regular, overtime, commission, bonus) and every deduction (federal tax, state tax, 401k, health insurance) has a code that determines its tax treatment and GL posting. Correct configuration is essential for accurate tax withholding and GL entries.',
    sections: {
      'Earnings Codes': 'All configured earnings types with their FLSA treatment (exempt/non-exempt), W-2 box mapping, and GL account.',
      'Deduction Codes': 'All deduction types with pre/post-tax status, W-2 box, and employee/employer split.',
      'Employee Deduction Assignment': 'Which deductions are active for each employee. Benefit deduction changes (open enrollment) are managed here.',
      'Deduction Detail Report': 'Shows all employees with each deduction, their rate, and YTD total. Used for benefit reconciliation with insurance carriers.',
    },
    tips: [
      'Pre-tax vs post-tax deduction classification must be correct — getting this wrong affects FICA, income tax, and ACA reporting',
      'After open enrollment, review all deduction changes before the first payroll run with new rates',
      'The deduction detail report is sent to health insurance and 401k carriers monthly for reconciliation',
    ],
  },

  'payroll-tax-summary': {
    title: '📑 Payroll Tax Summary',
    overview: 'Summary of all payroll taxes withheld and employer taxes owed for a period. Used to prepare payroll tax deposits (941, state withholding, unemployment) and to reconcile the tax liability GL accounts. Accurate payroll tax reporting is one of the highest-risk compliance areas for any employer.',
    sections: {
      'Federal Tax Summary': 'Total federal income tax withheld, employee FICA (Social Security + Medicare), and employer FICA match for the period.',
      'State Tax Summary': 'State income tax withholding and state unemployment (SUTA) by state. Multi-state employees show allocation by state.',
      'Deposit Schedule': 'Federal and state tax deposit due dates based on your deposit frequency (semi-weekly, monthly, quarterly).',
      'Form 941 Data': 'Quarterly totals pre-formatted for IRS Form 941 completion.',
      'Year-to-Date Totals': 'Running YTD totals for all tax categories — essential for W-2 preparation at year-end.',
    },
    tips: [
      'Federal tax deposits have strict due dates — a single late deposit triggers a penalty of up to 15%',
      'If total wages are approaching the Social Security wage base ($168,600 in 2024) for any employee, verify the withholding stops at the cap',
      'The 941 data export should be reviewed by your CPA before filing — the system calculates but humans should verify',
    ],
  },

  'four-oh-one-k': {
    title: '🏦 401(k) Report',
    overview: 'Payroll reporting for 401(k) plan administration. Shows employee contribution deferrals, employer matching contributions, and loan repayments by employee. Required to transmit contributions to the plan administrator and to complete Form 5500 for IRS compliance.',
    sections: {
      'Contribution Summary': 'Total employee deferrals and employer match for the period. Must be transmitted to the plan trustee within 7 business days of payroll.',
      'Employee Deferral Detail': 'Each employee\'s deferral amount (dollar or percentage), catch-up contributions (age 50+), and YTD total vs annual limit.',
      'Employer Match Calculation': 'Shows the match formula applied and the calculated match for each employee.',
      'Loan Repayments': 'Employees with 401k loan repayments — amount deducted from payroll and sent to the plan as loan principal and interest.',
      'Transmission File': 'Generates the file in your plan administrator\'s required format for contribution upload.',
    },
    tips: [
      'Late 401k remittances are a prohibited transaction under ERISA — transmit within 7 business days, no exceptions',
      'Annual contribution limits change yearly ($23,000 + $7,500 catch-up for 2024) — update limits at year-start',
      'Employees approaching the annual limit need their deferral rate temporarily reduced to avoid excess contributions',
    ],
  },

  'nacha': {
    title: '🏧 NACHA / ACH File',
    overview: 'Generates and manages the NACHA-format ACH files for direct deposit payroll. The NACHA file is the electronic instruction to your bank to move money from the payroll account to each employee\'s personal bank account. Correct generation and timely submission is critical for employees to receive their pay on time.',
    sections: {
      'File Generation': 'Generate the NACHA file for the current payroll run. The file includes all employee bank routing numbers, account numbers, and net pay amounts.',
      'File Validation': 'Pre-submission check: verifies that all routing numbers are valid, all account numbers are present, and the total matches the payroll register.',
      'Submission Log': 'History of all NACHA files submitted with submission time, bank confirmation, and settlement date.',
      'Employee Bank Data': 'Manage employee bank account information for direct deposit. Changes require employee verification.',
      'Prenotes': 'For new employees or changed bank accounts, generate a zero-dollar prenote to validate the routing/account number before the first live payment.',
    },
    tips: [
      'Submit the NACHA file at least 2 banking days before the pay date — most banks require 2-day settlement',
      'Send prenotes for all new employees before their first live pay run — a returned prenote means their bank account data is wrong',
      'Never email NACHA files — they contain sensitive employee bank account data. Upload directly to your bank\'s secure portal.',
    ],
  },

  'report-mate': {
    title: '📊 Report Mate',
    overview: 'A custom report builder for creating ad-hoc reports not covered by the standard report library. Drag-and-drop columns from any data source, add calculated fields, apply filters, and format the output. Power users and accountants use Report Mate to build one-off analysis reports and save them for future reuse.',
    sections: {
      'Data Source Selection': 'Choose which data tables to include in your report: GL accounts, transactions, AR/AP schedules, payroll, etc. Join multiple sources for cross-functional reports.',
      'Column Builder': 'Drag fields from the data source into your report columns. Add calculated columns (e.g., gross margin % = (revenue - COGS) / revenue × 100).',
      'Filter Rules': 'Apply filters to limit data: date range, department, amount range, status. Filters can be hard-coded or left as user-input at run time.',
      'Sorting & Grouping': 'Group rows by any column (e.g., by department) with subtotals. Sort within groups.',
      'Output Formatting': 'Monetary columns right-aligned in monospace font. Date format. Column widths. Page breaks.',
      'Save & Share': 'Save your report to the report library. Optionally share with other users or make it public to all accounting staff.',
    },
    tips: [
      'Add a "run date" header to saved reports so readers know when the data was pulled',
      'Calculated fields are evaluated at run time — they always reflect the latest data',
      'For large reports, add a date range filter as a user-input prompt — this keeps the report fast regardless of history depth',
    ],
  },

  'doc-mate': {
    title: '📝 Doc Mate',
    overview: 'A document generation tool for creating accounting documents and letters from templates — confirmation letters, vendor statements, collection notices, and management reports. Merges live system data into Word/PDF templates. Eliminates manual document creation for common accounting correspondence.',
    sections: {
      'Template Library': 'Pre-built templates for common accounting documents. Each template shows the merge fields it uses.',
      'Custom Templates': 'Upload your own Word templates with merge field codes. Doc Mate substitutes live data for merge fields at generation time.',
      'Batch Generation': 'Generate the same document type for multiple records at once — e.g., create a statement for every customer with an outstanding balance.',
      'Send Options': 'Output to PDF, print directly, or send via email to the contact on the record.',
    },
    tips: [
      'Month-end vendor statements are a 5-minute job with batch generation vs hours of manual formatting',
      'Merge field codes use double-curly-brace syntax — {{CustomerName}}, {{BalanceDue}}, etc.',
      'Test templates with a single record before running a batch to catch merge field errors',
    ],
  },

  'technician-master': {
    title: '👷 Technician Master',
    overview: 'Master record management for service department technicians. Maintains each technician\'s pay rate, skill certifications, flat-rate multiplier, and GL cost center assignment. Correct configuration here drives technician labor cost allocation in the service department P&L.',
    sections: {
      'Technician List': 'All active and inactive technicians with current status, pay type (flat rate, hourly), and efficiency rating.',
      'Technician Profile': 'Individual record: personal info, hire date, certifications (ASE, manufacturer), and flat-rate pay scale.',
      'Pay Configuration': 'Set the flat-rate pay per hour, overtime rules, and any skill premiums. Changes take effect on the next payroll run.',
      'GL Assignment': 'Maps the technician to the correct labor cost center in the GL — critical for accurate department P&L.',
      'Certification Tracking': 'Records each certification with expiration date. Expired certifications are flagged — some warranty work requires current certification.',
    },
    tips: [
      'GL assignment must match the technician\'s department — a body shop technician posting to service labor distorts both department P&Ls',
      'Flat-rate changes should be made effective on the first day of a pay period — mid-period changes create payroll reconciliation issues',
      'Certification expiration alerts should go to the service manager as well as HR',
    ],
  },

  'service-history': {
    title: '🔧 Service History',
    overview: 'Complete repair order history for the service department — every RO ever written, with labor, parts, and sublet detail. Used by service accounting to research historical transactions, resolve billing disputes, and verify warranty claim accuracy.',
    sections: {
      'RO Search': 'Search by RO number, VIN, customer name, or date range. Returns matching ROs with status and total.',
      'RO Detail': 'Individual RO with all labor operations, parts used, sublet work, and payment method. Shows technician time and rate for each operation.',
      'Financial Summary': 'Labor revenue, parts revenue, sublet revenue, and total for the RO. Broken down by pay type (customer pay, warranty, internal).',
      'GL Audit Trail': 'Shows the exact journal entry lines generated when this RO was posted to GL. Useful for tracing a specific service transaction in the general ledger.',
    },
    tips: [
      'When a warranty chargeback arrives, use service history to find the original RO and verify the claim details',
      'Internal ROs (vehicle prep, dealer service) must be posted with the correct pay type to avoid inflating customer pay revenue',
      'The GL audit trail on an RO is the fastest way to answer "why is account 4220 showing an unexpected credit this month?"',
    ],
  },

  'entity-elimination': {
    title: '❌ Entity Elimination',
    overview: 'Manages the eliminating journal entries required to consolidate multiple dealership entities into a single set of group financial statements. Intercompany revenues, expenses, payables, and receivables must be eliminated so they don\'t double-count at the group level. Required for consolidated reporting to banks and investors.',
    sections: {
      'Elimination Rules': 'Configured rules that define which intercompany accounts eliminate against each other. Example: Entity A\'s intercompany receivable eliminates against Entity B\'s intercompany payable.',
      'Run Elimination': 'Execute the elimination process for the current period. Generates draft eliminating journal entries for review before posting.',
      'Elimination Report': 'Shows the full elimination impact: which accounts were eliminated and by how much. Required documentation for consolidated audit.',
      'Residual Balances': 'Any intercompany balances that didn\'t fully eliminate (due to timing differences or missing entries). Must be investigated before finalizing consolidated statements.',
    },
    tips: [
      'Residual balances are almost always caused by one entity posting an intercompany transaction that the other entity hasn\'t posted yet — check the intercompany module',
      'Elimination entries should be run in a consolidation entity that is not a legal trading entity — never post them in an operating entity\'s books',
      'Run the elimination report before your CFO sees the consolidated financials — intercompany elimination is the most common source of consolidation errors',
    ],
  },
};

export default SCREEN_HELP;
