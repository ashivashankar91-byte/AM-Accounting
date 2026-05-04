import { useState } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';
import AIInsight from '../components/AIInsight';

type ReportType = 'trial-balance' | 'detailed-gl' | 'transaction-register' | 'aged-tb' | 'annual-summary' | 'accumulator' | 'journal-source' | 'unposted-voucher' | 'ap-trial-balance' | 'paid-invoice';

const REPORT_TYPES: { id: ReportType; name: string; category: string; description: string }[] = [
  { id: 'trial-balance', name: 'GL Trial Balance', category: 'General Ledger', description: 'Account balances with prior/current/YTD totals' },
  { id: 'detailed-gl', name: 'Detailed GL & P&L', category: 'General Ledger', description: 'Every journal entry by GL account with distributions' },
  { id: 'transaction-register', name: 'Monthly Transaction Register', category: 'General Ledger', description: 'Daily transactions by source and account' },
  { id: 'aged-tb', name: 'Aged Trial Balance', category: 'Receivables', description: 'AR aging by control account (Current/30/60/90/Over)' },
  { id: 'annual-summary', name: 'GL Annual Summary', category: 'General Ledger', description: '12-month rolling GL activity overview' },
  { id: 'accumulator', name: 'Accumulator Report', category: 'General Ledger', description: 'GL group totals by accumulator category' },
  { id: 'journal-source', name: 'Journal Source Listing', category: 'Reference', description: 'All journal source codes and definitions' },
  { id: 'unposted-voucher', name: 'Unposted Voucher Report', category: 'Payables', description: 'AP invoices not yet posted to GL' },
  { id: 'ap-trial-balance', name: 'AP Trial Balance', category: 'Payables', description: 'Vendor payable aging and summary' },
  { id: 'paid-invoice', name: 'Paid Invoice Report', category: 'Payables', description: 'Historical paid vendor invoice detail' },
];

export default function Reports() {
  const [selected, setSelected] = useState<ReportType | null>(null);
  const [generating, setGenerating] = useState(false);

  const categories = [...new Set(REPORT_TYPES.map(r => r.category))];

  const handleGenerate = () => {
    if (!selected) return;
    setGenerating(true);
    setTimeout(() => setGenerating(false), 2000);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Reports</h1><p className="text-sm text-gray-500 mt-0.5">Generate financial and operational reports. Source: GL Service, Analytics Service.</p></div>
        <HelpButton help={SCREEN_HELP.reports} />
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Report selection sidebar */}
        <div className="col-span-4 space-y-4">
          {categories.map(cat => (
            <div key={cat}>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{cat}</h3>
              <div className="space-y-1">
                {REPORT_TYPES.filter(r => r.category === cat).map(r => (
                  <button key={r.id} onClick={() => setSelected(r.id)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      selected === r.id
                        ? 'bg-amacc-600 text-white'
                        : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200'
                    }`}>
                    <div className="font-medium">{r.name}</div>
                    <div className={`text-xs mt-0.5 ${selected === r.id ? 'text-blue-100' : 'text-gray-400'}`}>{r.description}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Report configuration */}
        <div className="col-span-8">
          {!selected ? (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <div className="text-4xl mb-3">📊</div>
              <h3 className="text-lg font-semibold text-gray-700">Select a Report</h3>
              <p className="text-sm text-gray-400 mt-1">Choose a report from the left to configure and generate.</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">{REPORT_TYPES.find(r => r.id === selected)?.name}</h3>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Start Date</label>
                  <input type="date" className="w-full mt-1 border rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">End Date</label>
                  <input type="date" className="w-full mt-1 border rounded px-3 py-2 text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Account Range From</label>
                  <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="1000" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Account Range To</label>
                  <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="9999" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Department</label>
                  <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                    <option value="">All Departments</option>
                    <option value="new">New</option><option value="used">Used</option>
                    <option value="service">Service</option><option value="parts">Parts</option>
                    <option value="body">Body Shop</option><option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Output Format</label>
                  <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                    <option value="pdf">PDF</option><option value="excel">Excel</option><option value="csv">CSV</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mb-6">
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" /> Include Zero Balances</label>
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" defaultChecked /> Compare to Prior Period</label>
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" /> Subtotals by Department</label>
              </div>

              <div className="flex gap-2">
                <button onClick={handleGenerate} disabled={generating}
                  className="bg-amacc-600 text-white px-6 py-2 rounded text-sm hover:bg-amacc-700 disabled:opacity-50">
                  {generating ? 'Generating...' : 'Generate Report'}
                </button>
                <button className="bg-gray-200 text-gray-700 px-4 py-2 rounded text-sm">Preview</button>
                <button className="bg-gray-200 text-gray-700 px-4 py-2 rounded text-sm">Schedule</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <AIInsight pageType="reports" context="Reports" data={{ selectedReport: selected, reportTypes: REPORT_TYPES }} />
    </div>
  );
}
