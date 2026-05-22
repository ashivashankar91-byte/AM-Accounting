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
};

export default SCREEN_HELP;
