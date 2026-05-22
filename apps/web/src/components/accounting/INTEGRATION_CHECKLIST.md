# Integration Checklist — 8 Accounting Components

Use this checklist when integrating the accounting components into your pages and workflows.

## Pre-Integration (Setup)

- [ ] Verify `apps/web/src/api/client.ts` has these exports:
  - [ ] `glApi.searchAccounts(q)`
  - [ ] `glApi.getPeriods()`
  - [ ] `aparApi.getAP()`

- [ ] Verify dependencies installed:
  - [ ] `@tanstack/react-query` (v4+)
  - [ ] `lucide-react` (v0+)
  - [ ] `tailwindcss` (v3+)

- [ ] Tailwind CSS is configured in `tailwind.config.js` with:
  - [ ] Color palette: blue, red, green, amber, orange, emerald
  - [ ] Font-mono: JetBrains Mono or system monospace
  - [ ] Opacity variants enabled

## Component-Specific Checks

### 1. GLAccountLookup
- [ ] Renders without API errors
- [ ] Search requires 2+ characters (doesn't trigger on single char)
- [ ] Results show account_code, description, type badge, balance
- [ ] Type badges are colored correctly (blue=ASSET, red=LIABILITY, etc.)
- [ ] Balance displays in monospace right-aligned
- [ ] Keyboard: ↓ moves down, ↑ moves up, Escape closes, Enter selects
- [ ] Selected value updates parent `onChange` callback
- [ ] `disabled` prop disables input

### 2. JournalEntryTable
- [ ] Table renders with columns: # | Account | Dept | Debit | Credit | Memo | Delete
- [ ] Each line can add GL account via GLAccountLookup
- [ ] Debit/credit inputs are type="number" step="0.01" min="0"
- [ ] Debit/credit format with monospace right-align
- [ ] Footer shows Total Debits, Total Credits, Balance
- [ ] Balance shows green ✓ when debits = credits (tolerance: 0.01)
- [ ] Balance shows red ✗ when not balanced
- [ ] Ctrl+D copies a line (including values, generates new ID)
- [ ] Delete key on a line removes it
- [ ] Tab on last credit field auto-adds new blank line
- [ ] `readOnly` prop disables all editing
- [ ] `onChange` fires with updated lines array

### 3. VendorLookup
- [ ] Renders without API errors
- [ ] Initial load fetches all vendors from `aparApi.getAP()`
- [ ] Dropdown shows filtered results (code + name match)
- [ ] Each option shows vendor_name, payment_terms (if present), default_gl_account (if present)
- [ ] Keyboard: ↓ down, ↑ up, Escape close, Enter select
- [ ] "No vendors found" message when filter returns empty
- [ ] Selected value updates parent `onChange`
- [ ] `disabled` prop disables input

### 4. AgingDisplay
- [ ] Renders horizontal stacked bar
- [ ] Bar sections color-coded:
  - [ ] current: emerald-500
  - [ ] days30: blue-500
  - [ ] days60: amber-500
  - [ ] days90: orange-500
  - [ ] over90: red-600
- [ ] Legend below shows 5 categories with label, $amount, %
- [ ] Hover on bar section or legend highlights that section
- [ ] Percentages calculated correctly: (amount / total) * 100
- [ ] Total Due footer shows sum of all amounts
- [ ] Handles zero/null values gracefully
- [ ] Responsive on mobile (legend wraps)

### 5. PeriodSelector
- [ ] Renders as `<select>` dropdown
- [ ] Initial load fetches periods from `glApi.getPeriods()`
- [ ] Options show "Jan 2026 (OPEN)" format
- [ ] Closed periods show "🔒 Feb 2026 (CLOSED)"
- [ ] Closed periods have `disabled` attribute
- [ ] Selection updates parent via `onChange`
- [ ] Error message displays if API fails
- [ ] `disabled` prop disables select
- [ ] Helper text explains closed periods cannot be modified

### 6. FinancialStatementViewer
- [ ] Renders table with columns: Description | Amount | % of Parent
- [ ] Lines display with indentation based on level (0/1/2)
- [ ] Click on any line triggers `onDrillDown` callback (if provided)
- [ ] Selected line highlighted in blue
- [ ] Expandable sections show ↓ when open, → when closed
- [ ] Amount formatted as currency (no $ prefix in table, right-aligned)
- [ ] Negative amounts show in parentheses: (123.45)
- [ ] % of Parent calculated correctly
- [ ] Drill-down passes lineCode + mock transactions to callback

### 7. ActionBar
- [ ] Fixed position at bottom: `left: 192px; right: 0; height: 48px`
- [ ] Left side displays keyboard hints in `<kbd>` tags
- [ ] Right side displays action buttons sorted by variant
- [ ] Each button shows label + shortcut (e.g., "Save (Ctrl+S)")
- [ ] Primary variant: blue-600 background
- [ ] Secondary variant: gray-200 background
- [ ] Danger variant: red-600 background
- [ ] Button onClick fires correctly when clicked
- [ ] Keyboard shortcuts trigger onClick (Ctrl+key, Shift+key)
- [ ] Disabled buttons appear grayed out, don't fire onClick
- [ ] Multiple keyboard hints display without wrapping issues

### 8. AuditTrailViewer
- [ ] Renders table with columns: Timestamp | User | Action | Before | After
- [ ] Rows show ISO timestamp format (YYYY-MM-DDTHH:MM:SSZ)
- [ ] Rows show userId (email or ID)
- [ ] Rows show action description
- [ ] Expandable rows (click ↓/→ chevron) show:
  - [ ] Before value (JSON pretty-printed)
  - [ ] After value (JSON pretty-printed)
  - [ ] Change summary (before → after)
- [ ] "No audit entries" message when empty
- [ ] Total entry count shown at bottom
- [ ] Entries display in reverse chronological order (newest first)

## Integration Patterns

### Pattern 1: Journal Entry Page (WF-A001)
```tsx
import { GLAccountLookup, JournalEntryTable, ActionBar } from './components/accounting';

export function JournalEntryPage() {
  const [lines, setLines] = useState<JournalLine[]>([...]);
  
  return (
    <>
      <PeriodSelector value={period} onChange={setPeriod} />
      <JournalEntryTable lines={lines} onChange={setLines} />
      <ActionBar actions={[
        { label: 'Save', onClick: handleSave, variant: 'primary', shortcut: 'Ctrl+S' },
        { label: 'Post', onClick: handlePost, variant: 'primary', shortcut: 'Ctrl+P' },
      ]} />
    </>
  );
}
```
- [ ] Component renders without errors
- [ ] All keyboard shortcuts work
- [ ] Save/Post callbacks fire correctly

### Pattern 2: AP Aging Report (WF-A002)
```tsx
import { VendorLookup, AgingDisplay } from './components/accounting';

export function APAgingPage() {
  const [vendor, setVendor] = useState('');
  const agingData = fetchAgingData(vendor);
  
  return (
    <>
      <VendorLookup value={vendor} onChange={setVendor} />
      <AgingDisplay {...agingData} />
    </>
  );
}
```
- [ ] Component renders
- [ ] Vendor lookup filters data correctly
- [ ] Aging bar updates when vendor changes

### Pattern 3: Financial Statements (WF-A007)
```tsx
import { FinancialStatementViewer, PeriodSelector } from './components/accounting';

export function FinancialStatementPage() {
  const [period, setPeriod] = useState('');
  const fsData = fetchFSData(period);
  
  return (
    <>
      <PeriodSelector value={period} onChange={setPeriod} />
      <FinancialStatementViewer data={fsData} onDrillDown={handleDrillDown} />
    </>
  );
}
```
- [ ] Component renders
- [ ] Period selector filters data
- [ ] Drill-down callbacks work

## Testing Scenarios

### Keyboard Navigation
- [ ] Tab through fields in JournalEntryTable (debit → credit → next line)
- [ ] Tab from last credit field auto-adds new line
- [ ] Ctrl+D copies line from above
- [ ] Delete key removes current line
- [ ] Escape closes all dropdowns (GLAccountLookup, VendorLookup)
- [ ] Arrow keys navigate dropdown options
- [ ] Enter selects highlighted option
- [ ] Action bar shortcuts fire (Ctrl+S, Ctrl+P, etc.)

### Data Validation
- [ ] JournalEntryTable debits = credits validation works
- [ ] AgingDisplay percentages sum to ~100%
- [ ] AuditTrailViewer shows JSON diffs correctly
- [ ] PeriodSelector disables closed periods
- [ ] GLAccountLookup shows correct type colors

### Error Handling
- [ ] API timeouts show error message
- [ ] Empty search results show "No accounts found"
- [ ] Malformed API responses don't crash
- [ ] Network errors display gracefully

### Performance
- [ ] GLAccountLookup search debounced (doesn't fire on every keystroke)
- [ ] React Query caches results (hitting same search twice is instant)
- [ ] Large journal tables (100+ lines) scroll smoothly
- [ ] Expanding all audit trail entries doesn't lag

### Accessibility
- [ ] All inputs have accessible labels (via placeholder or aria-label)
- [ ] Keyboard navigation works without mouse
- [ ] Color + icon differentiation (not color-only)
- [ ] Focus states visible (blue ring on inputs/buttons)

## Integration Readiness Sign-Off

- [ ] All 8 components render without errors
- [ ] All TypeScript types are satisfied
- [ ] All API calls work correctly
- [ ] All keyboard shortcuts function
- [ ] All mouse interactions work
- [ ] All error states display properly
- [ ] Components composable in pages
- [ ] Performance acceptable on large data

## Notes for Implementation Teams

1. **GLAccountLookup + JournalEntryTable:** Always use together. JournalEntryTable imports GLAccountLookup internally.

2. **VendorLookup:** Uses `aparApi.getAP()` which may return large vendor list. Consider pagination/virtualization if >1000 vendors.

3. **AgingDisplay:** Designed for read-only display. For editing, build a custom component.

4. **ActionBar:** Place at end of page (before closing div) to avoid z-index stacking issues.

5. **FinancialStatementViewer:** onDrillDown is optional. If not provided, clicking amounts is a no-op.

6. **Query Caching:** All API calls use 60s cache. Force refresh with:
   ```tsx
   const queryClient = useQueryClient();
   queryClient.invalidateQueries({ queryKey: ['periods'] });
   ```

7. **Styling:** All components use Tailwind classes only. No CSS modules needed.

8. **Mobile:** All components are responsive but tested for desktop-first. Mobile UX may need tweaks (narrow screens, touch events).

## Support Contacts

- **Frontend Components:** Check COMPONENTS.md for detailed API
- **Integration Questions:** See INTEGRATION_EXAMPLE.tsx for working examples
- **Build Issues:** Verify Tailwind + React Query in package.json
