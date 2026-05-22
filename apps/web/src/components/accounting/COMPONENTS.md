# Accounting Components Library

8 production-ready React components for AMACC module. All use React 18 + TypeScript, Tailwind CSS + Lucide icons. Monetary values use `font-mono text-right tabular-nums`.

## Quick Import

```tsx
import {
  GLAccountLookup,
  JournalEntryTable,
  VendorLookup,
  AgingDisplay,
  PeriodSelector,
  FinancialStatementViewer,
  ActionBar,
  AuditTrailViewer,
} from './components/accounting';
```

---

## 1. GLAccountLookup

**Searchable GL account selector with type badges and balance display.**

### Props
```tsx
interface GLAccountLookupProps {
  value: string;                          // current account code
  onChange: (code: string, account?: GLAccount) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

interface GLAccount {
  account_code: string;
  description: string;
  type: 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE' | 'EQUITY';
  current_balance: number;
}
```

### Features
- Search requires ≥2 characters (stale time: 60s)
- Type badges: colored by account type
- Current balance shown in monospace
- Keyboard navigation: ↑↓ to navigate, Escape to close, Enter to select
- "No accounts found" message when empty

### Example
```tsx
const [accountCode, setAccountCode] = useState('');

<GLAccountLookup
  value={accountCode}
  onChange={(code, account) => {
    setAccountCode(code);
    console.log(account?.description);
  }}
  placeholder="Search accounts..."
/>
```

---

## 2. JournalEntryTable

**Full journal entry editor with line items, balance checking, keyboard shortcuts.**

### Props
```tsx
interface JournalEntryTableProps {
  lines: JournalLine[];
  onChange: (lines: JournalLine[]) => void;
  readOnly?: boolean;
  className?: string;
}

interface JournalLine {
  id: string;
  accountCode: string;
  department?: string;
  debit: number;
  credit: number;
  memo?: string;
}
```

### Features
- Columns: # | GL Account (lookup) | Dept | Debit | Credit | Memo | Delete
- Footer: Total Debits | Total Credits | Balance (green ✓ if equal, red ✗ if not)
- Keyboard: Ctrl+D copies line, Delete removes, Tab moves to next cell (auto-adds new row on Tab from last credit)
- Debit/credit: `input type="number" step="0.01" min="0"`, monospace + right-aligned
- Debits/credits formatted with `font-mono text-right`

### Example
```tsx
const [lines, setLines] = useState<JournalLine[]>([
  { id: '1', accountCode: '1000', debit: 100, credit: 0 },
  { id: '2', accountCode: '2000', debit: 0, credit: 100 },
]);

<JournalEntryTable lines={lines} onChange={setLines} />
```

---

## 3. VendorLookup

**Vendor selector with payment terms and default GL account display.**

### Props
```tsx
interface VendorLookupProps {
  value: string;
  onChange: (code: string, vendor?: Vendor) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

interface Vendor {
  vendor_code: string;
  vendor_name: string;
  payment_terms?: string;
  default_gl_account?: string;
}
```

### Features
- Fetches vendor list from `aparApi.getAP()`
- Dropdown shows vendor_name, payment_terms, default_gl_account
- Keyboard: Escape closes, ↑↓ navigates, Enter selects
- "No vendors found" when empty

### Example
```tsx
const [vendorCode, setVendorCode] = useState('');

<VendorLookup
  value={vendorCode}
  onChange={(code, vendor) => {
    console.log(`Selected: ${vendor?.vendor_name}`);
  }}
/>
```

---

## 4. AgingDisplay

**Horizontal stacked bar with aging categories and legend.**

### Props
```tsx
interface AgingDisplayProps {
  current: number;       // 0-30 days (emerald-500)
  days30: number;        // 31-60 days (blue-500)
  days60: number;        // 61-90 days (amber-500)
  days90: number;        // 91-120 days (orange-500)
  over90: number;        // 120+ days (red-600)
  total?: number;        // optional override total
  className?: string;
}
```

### Features
- Stacked horizontal bar with 5 color-coded sections
- Legend below with $amount + % for each category
- Hover shows tooltip: "Current: $X (Y%)" etc.
- Footer: "Total Due: $X"
- Smart percentage calculation

### Example
```tsx
<AgingDisplay
  current={1000}
  days30={500}
  days60={200}
  days90={100}
  over90={50}
/>
```

---

## 5. PeriodSelector

**GL period dropdown with lock icon for closed periods.**

### Props
```tsx
interface PeriodSelectorProps {
  value: string;
  onChange: (period: string) => void;
  disabled?: boolean;
  className?: string;
}

interface Period {
  code: string;
  name: string;
  isClosed: boolean;
}
```

### Features
- Fetches from `glApi.getPeriods()` (stale time: 60s)
- Shows "Jan 2026 (OPEN)" or "Feb 2026 (CLOSED)" with 🔒 icon prepended
- Closed periods: disabled, muted text
- Error message display on load failure

### Example
```tsx
const [period, setPeriod] = useState('');

<PeriodSelector value={period} onChange={setPeriod} />
```

---

## 6. FinancialStatementViewer

**Nested table for financial statement drill-down with collapsible sections.**

### Props
```tsx
interface FinancialStatementViewerProps {
  data: FinancialStatementData;
  onDrillDown?: (lineCode: string, transactions: Transaction[]) => void;
  className?: string;
}

interface FinancialStatementData {
  lineAmounts: Record<string, number>;
  departmentAmounts: Record<string, Record<string, number>>;
  structure?: Array<{ code: string; label: string; level: number; children?: string[] }>;
}

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  accountCode: string;
}
```

### Features
- Renders nested table with Description | Amount | % of Parent
- Indentation: section level × 2 (0=top, 1=subsection, 2=line item)
- Click any number: triggers onDrillDown callback
- Expandable/collapsible sections with ↓/→ chevrons
- Selected row highlighted in blue

### Example
```tsx
const data: FinancialStatementData = {
  lineAmounts: { 'ASSETS': 100000, '1000': 50000 },
  departmentAmounts: {},
};

<FinancialStatementViewer
  data={data}
  onDrillDown={(code, txns) => console.log(code, txns)}
/>
```

---

## 7. ActionBar

**Fixed bottom action bar with keyboard hints and button actions.**

### Props
```tsx
interface ActionBarProps {
  actions: ActionDefinition[];
  hints?: string[];
}

interface ActionDefinition {
  label: string;
  onClick: () => void;
  variant: 'primary' | 'secondary' | 'danger';
  shortcut?: string;
  disabled?: boolean;
}
```

### Features
- Fixed position: `bottom: 0; left: 192px; right: 0; height: 48px`
- Left side: `<kbd>` tags for keyboard hints (e.g., "F8: Post", "Ctrl+S: Save")
- Right side: buttons ordered by importance (primary first, danger last)
- Keyboard shortcuts auto-registered (Ctrl+key, Shift+key, etc.)
- Variant colors: primary=blue-600, secondary=gray-200, danger=red-600

### Example
```tsx
<ActionBar
  actions={[
    { label: 'Save', onClick: handleSave, variant: 'primary', shortcut: 'Ctrl+S' },
    { label: 'Delete', onClick: handleDelete, variant: 'danger', shortcut: 'Ctrl+D', disabled: !canDelete },
  ]}
  hints={['Ctrl+S: Save', 'Escape: Cancel']}
/>
```

---

## 8. AuditTrailViewer

**Audit log table with expandable before/after JSON diffs.**

### Props
```tsx
interface AuditTrailViewerProps {
  entries: AuditEntry[];
  className?: string;
}

interface AuditEntry {
  timestamp: Date;
  userId: string;
  action: string;
  beforeValue?: any;
  afterValue?: any;
}
```

### Features
- Table columns: Timestamp | User | Action | Before | After
- Timestamp in ISO format
- Expandable rows with ↓/→ chevrons
- JSON diffs for before/after values (pretty-printed)
- "No audit entries" message when empty
- Rows scrollable, each shows one audit entry

### Example
```tsx
const entries: AuditEntry[] = [
  {
    timestamp: new Date(),
    userId: 'user123',
    action: 'Updated GL Account',
    beforeValue: { balance: 100 },
    afterValue: { balance: 150 },
  },
];

<AuditTrailViewer entries={entries} />
```

---

## Shared Conventions

### Monetary Formatting
All monetary values across components use:
```tsx
// Display
<div className="font-mono text-right tabular-nums">
  ${amount.toFixed(2)}
</div>

// Input
<input type="number" step="0.01" min="0" className="font-mono text-right" />
```

### Error Handling
- Components gracefully handle API failures
- Loading states with "Loading..." or spinner placeholders
- Error messages displayed inline (red background)

### Keyboard Navigation
All lookup/selector components:
- Arrow keys: navigate options
- Enter: select highlighted option
- Escape: close dropdown
- Tab: move to next field (context-dependent)

### Dependencies
All components use:
- `@tanstack/react-query` for data fetching
- `lucide-react` for icons (ChevronDown, ChevronRight, Trash2, Check, X, Lock)
- Standard React 18 hooks: useState, useRef, useEffect, useQuery

### API Client
All components import from `../../api/client`:
- `glApi.searchAccounts(q)` — GL account search
- `glApi.getPeriods()` — period list
- `aparApi.getAP()` — vendor/AP list

---

## Testing Checklist

- [ ] All 8 components render without errors
- [ ] Keyboard shortcuts work (Ctrl+D, Delete, Tab, Escape, Enter)
- [ ] Search queries work with ≥2 characters
- [ ] Debits/credits format with monospace + right-align
- [ ] Type badges colored correctly (ASSET/LIABILITY/INCOME/EXPENSE)
- [ ] Aging display bar calculates percentages correctly
- [ ] Action bar shortcuts fire correctly
- [ ] Audit trail expandable rows show JSON diffs
- [ ] Period selector disables closed periods
- [ ] Loading/error states render properly

---

## File Locations

```
apps/web/src/components/accounting/
├── GLAccountLookup.tsx          (5.2 KB)
├── JournalEntryTable.tsx        (10 KB)
├── VendorLookup.tsx             (4.7 KB)
├── AgingDisplay.tsx             (3.6 KB)
├── PeriodSelector.tsx           (1.9 KB)
├── FinancialStatementViewer.tsx (5.2 KB)
├── ActionBar.tsx                (3.1 KB)
├── AuditTrailViewer.tsx         (6.3 KB)
├── index.ts                     (1.0 KB)
└── COMPONENTS.md                (this file)
```

Total: 1,163 lines of production TypeScript code.
