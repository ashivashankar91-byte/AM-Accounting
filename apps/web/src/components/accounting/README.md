# Accounting Components Library

Production-ready React component library for AMACC (AutoMate 2.0 Accounting Module).

## 📦 What's Included

### 8 Core Components
1. **GLAccountLookup** — Searchable GL account selector with balance display
2. **JournalEntryTable** — Full journal entry editor with auto-balance validation
3. **VendorLookup** — Vendor selector from AP module
4. **AgingDisplay** — Horizontal aging bar with category breakdown
5. **PeriodSelector** — GL period dropdown with closed period locking
6. **FinancialStatementViewer** — Drill-down financial statement table
7. **ActionBar** — Fixed bottom action bar with keyboard shortcuts
8. **AuditTrailViewer** — Audit log with JSON diff viewer

### Documentation
- **COMPONENTS.md** — Complete API reference for all 8 components
- **INTEGRATION_CHECKLIST.md** — Integration verification checklist
- **BUILD_SUMMARY.md** — Build completeness report
- **INTEGRATION_EXAMPLE.tsx** — Working examples (3 full pages)

## 🚀 Quick Start

### Import
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

### Usage Example
```tsx
export function MyPage() {
  const [lines, setLines] = useState<JournalLine[]>([
    { id: '1', accountCode: '', debit: 0, credit: 0 }
  ]);

  return (
    <>
      <JournalEntryTable lines={lines} onChange={setLines} />
      <ActionBar
        actions={[
          { label: 'Save', onClick: save, variant: 'primary', shortcut: 'Ctrl+S' }
        ]}
      />
    </>
  );
}
```

## 📋 File Guide

| File | Purpose | Lines |
|------|---------|-------|
| **GLAccountLookup.tsx** | GL account dropdown with search | 156 |
| **JournalEntryTable.tsx** | Journal entry line editor | 255 |
| **VendorLookup.tsx** | Vendor selector | 145 |
| **AgingDisplay.tsx** | Aging report visualization | 117 |
| **PeriodSelector.tsx** | Period dropdown | 72 |
| **FinancialStatementViewer.tsx** | Drill-down table | 165 |
| **ActionBar.tsx** | Bottom action bar | 98 |
| **AuditTrailViewer.tsx** | Audit log table | 155 |
| **index.ts** | Barrel export | 23 |
| **COMPONENTS.md** | API reference | 428 |
| **BUILD_SUMMARY.md** | Build report | 238 |
| **INTEGRATION_CHECKLIST.md** | Integration checklist | - |
| **INTEGRATION_EXAMPLE.tsx** | Working examples | 309 |

## ⌨️ Keyboard Shortcuts

### GLAccountLookup / VendorLookup
- `↑` / `↓` — Navigate options
- `Escape` — Close dropdown
- `Enter` — Select highlighted

### JournalEntryTable
- `Ctrl+D` — Copy line from above
- `Delete` — Remove current line
- `Tab` — Move to next field (auto-adds row at end)

### ActionBar
- `Ctrl+S` / `Ctrl+P` / etc. — Custom shortcuts per action

## 💰 Monetary Formatting

All monetary values use consistent styling:
```tsx
// Display (monospace, right-aligned)
<div className="font-mono text-right tabular-nums">
  ${amount.toFixed(2)}
</div>

// Input
<input 
  type="number" 
  step="0.01" 
  min="0"
  className="font-mono text-right"
/>
```

## 🎨 Colors Used

- **ASSET** → Blue-100 / Blue-800
- **LIABILITY** → Red-100 / Red-800
- **INCOME** → Green-100 / Green-800
- **EXPENSE** → Orange-100 / Orange-800
- **EQUITY** → Purple-100 / Purple-800

Aging categories:
- **Current (0-30d)** → Emerald-500
- **31-60d** → Blue-500
- **61-90d** → Amber-500
- **91-120d** → Orange-500
- **120+d** → Red-600

## 🔧 Dependencies

All components require:
- React 18+
- TypeScript 4.9+
- Tailwind CSS 3+
- @tanstack/react-query v4+
- lucide-react v0+

## 📖 Documentation

1. **Start here:** [COMPONENTS.md](./COMPONENTS.md) — Full API reference
2. **Integration help:** [INTEGRATION_EXAMPLE.tsx](./INTEGRATION_EXAMPLE.tsx) — Working examples
3. **Before integration:** [INTEGRATION_CHECKLIST.md](./INTEGRATION_CHECKLIST.md) — Verification checklist
4. **Project details:** [BUILD_SUMMARY.md](./BUILD_SUMMARY.md) — Completeness report

## ✅ Quality Assurance

- ✓ Full TypeScript typing
- ✓ React 18 hooks + best practices
- ✓ Tailwind CSS only (no custom CSS)
- ✓ Keyboard navigation throughout
- ✓ Error handling + loading states
- ✓ Query caching (React Query)
- ✓ Accessibility (semantic HTML, ARIA, focus states)
- ✓ 1,163 lines of production code
- ✓ Zero external dependencies (except React, Tailwind, Lucide, React Query)

## 🎯 Typical Workflows

### WF-A001: GL Journal Entry
```tsx
<PeriodSelector />
<GLAccountLookup />  {/* header account (optional) */}
<JournalEntryTable /> {/* main entry editor */}
<ActionBar actions={[save, post, cancel]} />
```

### WF-A002: Accounts Payable
```tsx
<VendorLookup />     {/* filter by vendor */}
<AgingDisplay />     {/* aging breakdown */}
```

### WF-A007: Financial Statements
```tsx
<PeriodSelector />
<FinancialStatementViewer onDrillDown={...} />
```

## 🐛 Troubleshooting

**Components not rendering?**
- Check that Tailwind CSS is configured
- Verify React Query provider is in App.tsx
- Check console for API errors

**Search/dropdown not working?**
- Verify API client is exporting glApi, aparApi
- Check that API_BASE env var is set
- Ensure tenantId is in localStorage

**Styles looking wrong?**
- Clear .next/out build cache
- Restart dev server
- Check that Tailwind classes are in purge paths

**Keyboard shortcuts not firing?**
- Verify ActionBar is at page bottom (z-index)
- Check that window.addEventListener is being called
- Test in dev tools console

## 📞 Support

See component-specific docs in [COMPONENTS.md](./COMPONENTS.md) for detailed props, examples, and troubleshooting.

---

**Ready to integrate?** Start with [INTEGRATION_CHECKLIST.md](./INTEGRATION_CHECKLIST.md)

**Want to understand the code?** Read [COMPONENTS.md](./COMPONENTS.md)

**Need working examples?** See [INTEGRATION_EXAMPLE.tsx](./INTEGRATION_EXAMPLE.tsx)
