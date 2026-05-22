import { useState, useMemo } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';
import {
  AccountType, ControlType, OEMPrefix,
  OEM_CRITICAL_ACCOUNTS,
  LEE_HYUNDAI_SCHEDULES,
  type GLAccount, type DistributionEntry,
} from '../types/file-maintenance';

// ── Representative GL Account seed data for Company 03 ───────────
const SEED_ACCOUNTS: GLAccount[] = [
  { acctNum: '2020', name: 'Truist Cash in Bank', costGL: null, inventoryGL: null, schedule: '17', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2027', name: 'WellsFargo Cash in Bank', costGL: null, inventoryGL: null, schedule: '21', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2030', name: 'Southern Cash in Bank', costGL: null, inventoryGL: null, schedule: '43', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2050', name: 'Customer Deposits', costGL: null, inventoryGL: null, schedule: '11', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2200', name: 'Accounts Receivable', costGL: null, inventoryGL: null, schedule: '19', controlRequired: ControlType.APPLY_TO, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2200P', name: 'Prepaid SOR Parts', costGL: null, inventoryGL: null, schedule: '18', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2220', name: 'Deal Settlement Clearing', costGL: null, inventoryGL: null, schedule: '11', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2240', name: 'Wholesale D/T A/R', costGL: null, inventoryGL: null, schedule: '33', controlRequired: ControlType.STOCK_NUMBER, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2250', name: 'Cash Sales', costGL: null, inventoryGL: null, schedule: '42', controlRequired: ControlType.DO_NOT_LOOKUP, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2259', name: 'Internet Parts Sales', costGL: null, inventoryGL: null, schedule: '38', controlRequired: ControlType.DO_NOT_LOOKUP, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2260', name: 'Warranty Receivable (HYU)', costGL: null, inventoryGL: null, schedule: '10', controlRequired: ControlType.DO_NOT_LOOKUP, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: '2262', name: 'Warranty Parts Receivable', costGL: null, inventoryGL: null, schedule: '10', controlRequired: ControlType.DO_NOT_LOOKUP, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: '2265', name: 'Warranty Labor Receivable', costGL: null, inventoryGL: null, schedule: '10', controlRequired: ControlType.DO_NOT_LOOKUP, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: '2270', name: 'Hyundai Rebates Receivable', costGL: null, inventoryGL: null, schedule: '9', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: 'G2270', name: 'Genesis Rebates Receivable', costGL: null, inventoryGL: null, schedule: '9', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.GENESIS, isDistAccount: false },
  { acctNum: '2280', name: 'Hyundai Holdback Receivable', costGL: null, inventoryGL: null, schedule: '25', controlRequired: ControlType.DO_NOT_LOOKUP, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: 'G2280', name: 'Genesis Holdback Receivable', costGL: null, inventoryGL: null, schedule: '25', controlRequired: ControlType.DO_NOT_LOOKUP, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.GENESIS, isDistAccount: false },
  { acctNum: '2290', name: 'Flooring Assistance', costGL: null, inventoryGL: null, schedule: '27', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2300', name: 'New Hyundai Invoice', costGL: null, inventoryGL: null, schedule: '3', controlRequired: ControlType.STOCK_NUMBER, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: '2310', name: 'New Hyundai Inventory', costGL: null, inventoryGL: null, schedule: '3', controlRequired: ControlType.STOCK_NUMBER, addUnits: true, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: '2311', name: 'New Hyundai Additions', costGL: null, inventoryGL: null, schedule: '3', controlRequired: ControlType.STOCK_NUMBER, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: '2312', name: 'Service Loaner Additions', costGL: null, inventoryGL: null, schedule: '13', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2320', name: 'Hyundai Dealer Cash', costGL: null, inventoryGL: null, schedule: '37', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: 'G2310', name: 'New Genesis Inventory', costGL: null, inventoryGL: null, schedule: '40', controlRequired: ControlType.STOCK_NUMBER, addUnits: true, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.GENESIS, isDistAccount: false },
  { acctNum: 'G2311', name: 'New Genesis Additions', costGL: null, inventoryGL: null, schedule: '40', controlRequired: ControlType.STOCK_NUMBER, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.GENESIS, isDistAccount: false },
  { acctNum: 'G2320', name: 'Genesis Dealer Cash', costGL: null, inventoryGL: null, schedule: '37', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.GENESIS, isDistAccount: false },
  { acctNum: '2400', name: 'Used Car Inventory', costGL: null, inventoryGL: null, schedule: '4', controlRequired: ControlType.STOCK_NUMBER, addUnits: true, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2403', name: 'Used Car Additions', costGL: null, inventoryGL: null, schedule: '4', controlRequired: ControlType.STOCK_NUMBER, addUnits: true, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2403L', name: 'Service Loaner Used', costGL: null, inventoryGL: null, schedule: '13', controlRequired: ControlType.STOCK_NUMBER, addUnits: true, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2410', name: 'Service Loaners', costGL: null, inventoryGL: null, schedule: '13', controlRequired: ControlType.STOCK_NUMBER, addUnits: true, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2411', name: 'Loaner Depreciation', costGL: null, inventoryGL: null, schedule: '13', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: 'G2390', name: 'Used Genesis Inventory', costGL: null, inventoryGL: null, schedule: '41', controlRequired: ControlType.STOCK_NUMBER, addUnits: true, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.GENESIS, isDistAccount: false },
  { acctNum: 'G2403', name: 'Genesis Used Additions', costGL: null, inventoryGL: null, schedule: '41', controlRequired: ControlType.STOCK_NUMBER, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: OEMPrefix.GENESIS, isDistAccount: false },
  { acctNum: '2460', name: 'Sublet Repairs WIP', costGL: null, inventoryGL: null, schedule: '12', controlRequired: ControlType.DO_NOT_LOOKUP, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2470', name: 'Work in Process', costGL: null, inventoryGL: null, schedule: '36', controlRequired: ControlType.DO_NOT_LOOKUP, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2620', name: 'Finance Reserve', costGL: null, inventoryGL: null, schedule: '24', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2640', name: 'F&I Cancellation Receivable', costGL: null, inventoryGL: null, schedule: '28', controlRequired: ControlType.DO_NOT_LOOKUP, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2740', name: 'Prepaid Expenses', costGL: null, inventoryGL: null, schedule: '5', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2940', name: 'Employee Advances', costGL: null, inventoryGL: null, schedule: '15', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '2950', name: 'Other Notes & A/R', costGL: null, inventoryGL: null, schedule: '30', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.ASSET, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3000', name: 'HMA Payable', costGL: null, inventoryGL: null, schedule: '8', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: '3001', name: 'Accounts Payable', costGL: null, inventoryGL: null, schedule: '35', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3005', name: 'A/P Other (Misc)', costGL: null, inventoryGL: null, schedule: '39', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3006', name: 'JMA Payable', costGL: null, inventoryGL: null, schedule: '22', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: '3007', name: 'A/P HPP (Protection Plans)', costGL: null, inventoryGL: null, schedule: '31', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: '3010', name: 'Tax & Tag Fees', costGL: null, inventoryGL: null, schedule: '14', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3020', name: 'Deal Settlement (Liability)', costGL: null, inventoryGL: null, schedule: '11', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3050', name: 'Lease Tax', costGL: null, inventoryGL: null, schedule: '16', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3090', name: 'We Owe', costGL: null, inventoryGL: null, schedule: '34', controlRequired: ControlType.STOCK_NUMBER, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3100', name: 'Floorplan — New Hyundai', costGL: null, inventoryGL: null, schedule: '3', controlRequired: ControlType.STOCK_NUMBER, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: 'G3100', name: 'Floorplan — New Genesis', costGL: null, inventoryGL: null, schedule: '40', controlRequired: ControlType.STOCK_NUMBER, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: OEMPrefix.GENESIS, isDistAccount: false },
  { acctNum: 'G3110', name: 'Floorplan — Used Genesis', costGL: null, inventoryGL: null, schedule: '41', controlRequired: ControlType.STOCK_NUMBER, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3120', name: 'Floorplan — Used', costGL: null, inventoryGL: null, schedule: '4', controlRequired: ControlType.STOCK_NUMBER, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3130', name: 'Floorplan — Service Loaners', costGL: null, inventoryGL: null, schedule: '13', controlRequired: ControlType.STOCK_NUMBER, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3210', name: 'Accrued Payroll', costGL: null, inventoryGL: null, schedule: '23', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3211', name: 'Sales Commission Accrual', costGL: null, inventoryGL: null, schedule: '2', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3234', name: '401K Employee', costGL: null, inventoryGL: null, schedule: '29', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3235', name: '401K Employer Match', costGL: null, inventoryGL: null, schedule: '29', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3238', name: '401K Roth', costGL: null, inventoryGL: null, schedule: '29', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3239', name: 'FSA (Flexible Spending)', costGL: null, inventoryGL: null, schedule: '32', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3280', name: "Employee Bonus Accrual", costGL: null, inventoryGL: null, schedule: '6', controlRequired: ControlType.LOOKUP_CONTROL, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '3310', name: 'Accrued Other', costGL: null, inventoryGL: null, schedule: '20', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.LIABILITY, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '4100', name: 'New Vehicle Sales — Hyundai', costGL: '5100', inventoryGL: '2310', schedule: '', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.INCOME, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: '4200', name: 'Used Vehicle Sales', costGL: '5200', inventoryGL: '2400', schedule: '', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.INCOME, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: '5100', name: 'New Vehicle Cost — Hyundai', costGL: null, inventoryGL: null, schedule: '', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.EXPENSE, inactive: false, oemPrefix: OEMPrefix.HYUNDAI, isDistAccount: false },
  { acctNum: '5200', name: 'Used Vehicle Cost', costGL: null, inventoryGL: null, schedule: '', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.EXPENSE, inactive: false, oemPrefix: null, isDistAccount: false },
  { acctNum: 'G4100', name: 'New Vehicle Sales — Genesis', costGL: 'G5100', inventoryGL: 'G2310', schedule: '', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.INCOME, inactive: false, oemPrefix: OEMPrefix.GENESIS, isDistAccount: false },
  { acctNum: 'G5100', name: 'New Vehicle Cost — Genesis', costGL: null, inventoryGL: null, schedule: '', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.EXPENSE, inactive: false, oemPrefix: OEMPrefix.GENESIS, isDistAccount: false },
  { acctNum: '9000%', name: 'Total Expense Distribution', costGL: null, inventoryGL: null, schedule: '', controlRequired: ControlType.NONE, addUnits: false, type: AccountType.DIST, inactive: false, oemPrefix: null, isDistAccount: true, distributionTargets: [{ targetAcct: '5100', percentage: 40 }, { targetAcct: '5200', percentage: 35 }, { targetAcct: '5300', percentage: 25 }] },
];

type Tab = 'list' | 'detail';
type TypeFilter = 'All' | AccountType | 'Hyundai' | 'Genesis' | 'HasSchedule' | 'Inactive';
const FILTER_CHIPS: { key: TypeFilter; label: string }[] = [
  { key: 'All', label: 'All' },
  { key: AccountType.ASSET, label: 'Asset' },
  { key: AccountType.LIABILITY, label: 'Liability' },
  { key: AccountType.EXPENSE, label: 'Expense' },
  { key: AccountType.INCOME, label: 'Income' },
  { key: AccountType.DIST, label: 'DIST' },
  { key: 'Hyundai', label: 'Hyundai' },
  { key: 'Genesis', label: 'Genesis' },
  { key: 'HasSchedule', label: 'Has Schedule' },
  { key: 'Inactive', label: 'Inactive' },
];

function matchFilter(a: GLAccount, f: TypeFilter): boolean {
  switch (f) {
    case 'All': return true;
    case 'Hyundai': return a.oemPrefix === OEMPrefix.HYUNDAI;
    case 'Genesis': return a.oemPrefix === OEMPrefix.GENESIS;
    case 'HasSchedule': return !!a.schedule;
    case 'Inactive': return a.inactive;
    default: return a.type === f;
  }
}

const TYPE_COLORS: Record<AccountType, string> = {
  [AccountType.ASSET]: 'bg-brand-light text-brand',
  [AccountType.LIABILITY]: 'bg-orange-50 text-orange-700',
  [AccountType.EXPENSE]: 'bg-red-50 text-red-700',
  [AccountType.INCOME]: 'bg-green-50 text-green-700',
  [AccountType.DIST]: 'bg-violet-50 text-violet-700',
};

function scheduleTitle(num: string): string {
  const s = LEE_HYUNDAI_SCHEDULES.find(sc => sc.scheduleNumber === Number(num));
  return s ? `#${num} ${s.title}` : `#${num}`;
}

export default function ChartOfAccounts() {
  const [tab, setTab] = useState<Tab>('list');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');
  const [selected, setSelected] = useState<GLAccount | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);

  const accounts: GLAccount[] = [];

  if (accounts.length === 0 && tab === 'list') {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Chart of Accounts</h1>
            <p className="text-sm text-gray-500 mt-0.5">View and manage GL accounts by type, OEM prefix, and schedule. Source: COA Service / GL Service.</p>
          </div>
          <HelpButton help={SCREEN_HELP['chart-of-accounts']} />
        </div>
        <div className="text-center py-16">
          <div className="text-gray-300 text-5xl mb-4">🗂️</div>
          <p className="text-gray-500 font-medium text-lg">No chart of accounts data yet</p>
          <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">Chart of Accounts data will appear here once a COA is configured for this tenant. Use the Onboarding wizard to set up your initial chart of accounts, or create accounts via the General Ledger page.</p>
        </div>
      </div>
    );
  }

  const filtered = useMemo(() =>
    accounts.filter(a =>
      matchFilter(a, typeFilter) &&
      (!search || a.acctNum.toLowerCase().includes(search.toLowerCase()) || a.name.toLowerCase().includes(search.toLowerCase()))
    ), [accounts, typeFilter, search]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { All: accounts.length };
    accounts.forEach(a => {
      counts[a.type] = (counts[a.type] || 0) + 1;
      if (a.oemPrefix === OEMPrefix.HYUNDAI) counts['Hyundai'] = (counts['Hyundai'] || 0) + 1;
      if (a.oemPrefix === OEMPrefix.GENESIS) counts['Genesis'] = (counts['Genesis'] || 0) + 1;
      if (a.schedule) counts['HasSchedule'] = (counts['HasSchedule'] || 0) + 1;
      if (a.inactive) counts['Inactive'] = (counts['Inactive'] || 0) + 1;
    });
    return counts;
  }, [accounts]);

  const scheduleHealth = useMemo(() => {
    const linked = new Set(accounts.filter(a => a.schedule).map(a => a.schedule));
    return LEE_HYUNDAI_SCHEDULES.map(s => ({
      number: s.scheduleNumber,
      title: s.title,
      hasGL: linked.has(String(s.scheduleNumber)),
      glCount: accounts.filter(a => a.schedule === String(s.scheduleNumber)).length,
    }));
  }, [accounts]);

  const openDetail = (a: GLAccount) => { setSelected(a); setTab('detail'); };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Chart of Accounts</h2>
          <p className="text-sm text-gray-500">Lee Hyundai Inc. — Company 03 • GLACC</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowSidebar(!showSidebar)} className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50">
            {showSidebar ? 'Hide' : 'Show'} Schedule Health
          </button>
          <HelpButton help={SCREEN_HELP['chart-of-accounts']} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTER_CHIPS.map(fc => (
          <button key={fc.key}
            onClick={() => setTypeFilter(typeFilter === fc.key ? 'All' : fc.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              typeFilter === fc.key
                ? 'bg-amacc-600 text-white border-amacc-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}>
            {fc.label} <span className="ml-1 opacity-70">{typeCounts[fc.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-2 border-b">
        {([['list', 'Account List'], ['detail', 'Account Detail']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex gap-4">
        <div className={showSidebar ? 'flex-1 min-w-0' : 'w-full'}>
          {tab === 'list' && (
            <>
              <div className="flex gap-3 mb-3">
                <input className="flex-1 border rounded px-3 py-2 text-sm" placeholder="Search by account # or name..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b bg-gray-50">
                      <th className="px-4 py-2.5">Account #</th><th className="py-2.5">Name</th><th className="py-2.5">Type</th>
                      <th className="py-2.5">Control</th><th className="py-2.5">Schedule</th>
                      <th className="py-2.5 text-center">Units</th><th className="py-2.5">OEM</th><th className="py-2.5">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(a => {
                      const isCritical = OEM_CRITICAL_ACCOUNTS.has(a.acctNum);
                      const isDist = a.isDistAccount;
                      const isGenesis = a.oemPrefix === OEMPrefix.GENESIS;
                      return (
                        <tr key={a.acctNum}
                          onClick={() => openDetail(a)}
                          className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${
                            isDist ? 'bg-violet-50/30' : isGenesis ? 'border-l-2 border-l-purple-400' : ''
                          } ${a.inactive ? 'opacity-50' : ''}`}>
                          <td className="px-4 py-2 font-mono font-bold text-amacc-700">{a.acctNum}</td>
                          <td className="py-2 font-medium">{a.name}</td>
                          <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${TYPE_COLORS[a.type]}`}>{a.type}</span></td>
                          <td className="py-2 text-xs text-gray-600">{a.controlRequired || '—'}</td>
                          <td className="py-2">
                            {a.schedule ? <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-xs">{scheduleTitle(a.schedule)}</span> : '—'}
                          </td>
                          <td className="py-2 text-center">{a.addUnits ? <span className="text-green-600 text-xs font-bold">✓</span> : ''}</td>
                          <td className="py-2">
                            {a.oemPrefix === OEMPrefix.HYUNDAI && <span className="bg-brand-light text-brand px-1.5 py-0.5 rounded text-[10px] font-bold">HYU</span>}
                            {a.oemPrefix === OEMPrefix.GENESIS && <span className="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded text-[10px] font-bold">GEN</span>}
                          </td>
                          <td className="py-2 flex gap-1">
                            {isCritical && <span title="OEM-Critical — Do not modify without compliance review" className="bg-amber-200 text-amber-900 px-1 py-0.5 rounded text-[9px] font-bold">⚠ OEM</span>}
                            {isDist && <span title="Distribution/Rollup Account" className="bg-violet-200 text-violet-900 px-1 py-0.5 rounded text-[9px] font-bold">DIST</span>}
                            {a.inactive && <span className="bg-gray-200 text-gray-600 px-1 py-0.5 rounded text-[9px]">INACTIVE</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-xs text-gray-400 p-3">Showing {filtered.length} of {accounts.length} accounts</p>
              </div>
            </>
          )}

          {tab === 'detail' && (
            <div className="bg-white rounded-lg shadow p-6 space-y-5">
              {!selected ? (
                <p className="text-gray-400 text-sm">Select an account from the list to view details.</p>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-xl font-bold font-mono">{selected.acctNum}</h3>
                        <span className={`px-2 py-0.5 rounded text-xs ${TYPE_COLORS[selected.type]}`}>{selected.type}</span>
                        {selected.oemPrefix === OEMPrefix.HYUNDAI && <span className="bg-brand-light text-brand px-2 py-0.5 rounded text-xs font-bold">Hyundai</span>}
                        {selected.oemPrefix === OEMPrefix.GENESIS && <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs font-bold">Genesis</span>}
                        {OEM_CRITICAL_ACCOUNTS.has(selected.acctNum) && <span className="bg-amber-200 text-amber-900 px-2 py-0.5 rounded text-xs font-bold">⚠ OEM-Critical</span>}
                      </div>
                      <h4 className="text-lg text-gray-700 mt-1">{selected.name}</h4>
                    </div>
                    <button onClick={() => { setSelected(null); setTab('list'); }} className="text-sm text-gray-500 hover:text-gray-700">← Back to List</button>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <DetailField label="Account Type" value={selected.type} />
                    <DetailField label="Control Type" value={selected.controlRequired || 'None'} />
                    <DetailField label="Schedule" value={selected.schedule ? scheduleTitle(selected.schedule) : 'None'} />
                    <DetailField label="Add Units" value={selected.addUnits ? 'Yes' : 'No'} />
                    <DetailField label="Cost GL" value={selected.costGL || '—'} />
                    <DetailField label="Inventory GL" value={selected.inventoryGL || '—'} />
                    <DetailField label="OEM Prefix" value={selected.oemPrefix ?? 'None'} />
                    <DetailField label="Status" value={selected.inactive ? 'Inactive' : 'Active'} />
                    <DetailField label="Distribution Account" value={selected.isDistAccount ? 'Yes' : 'No'} />
                  </div>

                  {selected.isDistAccount && selected.distributionTargets && (
                    <div>
                      <h4 className="font-semibold text-sm mb-2">Distribution Targets</h4>
                      <div className="bg-violet-50 rounded p-3">
                        {selected.distributionTargets.map((d: DistributionEntry, i: number) => (
                          <div key={i} className="flex justify-between text-sm py-1">
                            <span className="font-mono">{d.targetAcct}</span>
                            <span className="font-bold">{d.percentage}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {OEM_CRITICAL_ACCOUNTS.has(selected.acctNum) && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
                      <h4 className="font-bold text-amber-800">⚠ OEM-Critical Account</h4>
                      <p className="text-amber-700 mt-1">
                        This account is mapped to HMA/GMA DDS feeds, warranty processing, or floorplan settlement.
                        Modifications require compliance review. Changes may impact factory statement submission (FS-HYU).
                      </p>
                    </div>
                  )}

                  {selected.controlRequired === ControlType.STOCK_NUMBER && (
                    <div className="bg-brand-light border border-brand-border rounded-lg p-4 text-sm">
                      <h4 className="font-bold text-blue-800">Stock Number Control</h4>
                      <p className="text-brand mt-1">
                        Transactions posted to this account require a valid stock number. The system will derive
                        the vehicle record and validate GL linkage automatically.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {showSidebar && (
          <div className="w-72 flex-shrink-0">
            <div className="bg-white rounded-lg shadow p-4 sticky top-4">
              <h3 className="font-semibold text-sm mb-3">Schedule Health</h3>
              <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                {scheduleHealth.map(sh => (
                  <div key={sh.number} className="flex items-center gap-2 text-xs">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${sh.glCount >= 2 ? 'bg-green-500' : sh.glCount === 1 ? 'bg-amber-500' : 'bg-red-500'}`} />
                    <span className="font-mono text-gray-500 w-6">{sh.number}</span>
                    <span className="truncate flex-1">{sh.title}</span>
                    <span className="text-gray-400">{sh.glCount} GL</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t text-[10px] text-gray-400 space-y-1">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" /> 2+ GL accounts linked</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> 1 GL account — verify</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> No GL accounts — action needed</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-medium text-sm mt-0.5">{value}</dd>
    </div>
  );
}
