import { useState } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';

type Tab = 'company' | 'periods' | 'departments' | 'defaults';

export default function Setup() {
  const [tab, setTab] = useState<Tab>('company');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">System Setup</h1><p className="text-sm text-gray-500 mt-0.5">Configure company info, fiscal periods, departments, and integrations. Source: Tenant Service.</p></div>
        <HelpButton help={SCREEN_HELP['setup']} />
      </div>

      <div className="flex gap-2 border-b">
        {([['company', 'Company Info'], ['periods', 'Accounting Periods'], ['departments', 'Departments'], ['defaults', 'Defaults']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'company' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <h3 className="text-lg font-semibold">Company Information</h3>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700">Company Name</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm" defaultValue="Sample Dealership Inc." /></div>
              <div><label className="block text-sm font-medium text-gray-700">DBA Name</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Tax ID (EIN)</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="XX-XXXXXXX" /></div>
              <div><label className="block text-sm font-medium text-gray-700">OEM / Franchise</label>
                <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                  <option>General Motors</option><option>Ford</option><option>FCA / Stellantis</option>
                  <option>Toyota</option><option>Honda</option><option>Nissan</option><option>BMW</option><option>Mercedes-Benz</option><option>Other</option>
                </select></div>
            </div>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700">Address</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="block text-sm font-medium text-gray-700">City</label>
                  <input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
                <div><label className="block text-sm font-medium text-gray-700">State</label>
                  <input className="w-full mt-1 border rounded px-3 py-2 text-sm" maxLength={2} /></div>
                <div><label className="block text-sm font-medium text-gray-700">ZIP</label>
                  <input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700">Phone</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Fiscal Year Start Month</label>
                <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                  {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2000, i).toLocaleString('en', { month: 'long' })}</option>)}
                </select></div>
            </div>
          </div>
          <div className="flex justify-end"><button className="bg-amacc-600 text-white px-6 py-2 rounded">Save Changes</button></div>
        </div>
      )}

      {tab === 'periods' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Accounting Periods</h3>
            <div className="flex gap-2">
              <select className="border rounded px-3 py-1.5 text-sm"><option>2026</option><option>2025</option></select>
              <button className="text-sm bg-gray-100 border px-3 py-1.5 rounded hover:bg-gray-200">Generate Periods</button>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Period</th><th className="pb-2">Name</th><th className="pb-2">Start Date</th>
              <th className="pb-2">End Date</th><th className="pb-2">Status</th><th className="pb-2">Actions</th>
            </tr></thead>
            <tbody>
              {Array.from({ length: 13 }, (_, i) => {
                const isP13 = i === 12;
                const month = isP13 ? 'Period 13' : new Date(2026, i).toLocaleString('en', { month: 'long' });
                return (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 font-mono font-bold">{String(i + 1).padStart(2, '0')}</td>
                    <td className="py-2">{month} {isP13 ? '(Adjusting)' : '2026'}</td>
                    <td className="py-2 text-gray-500">{isP13 ? '12/31/2026' : new Date(2026, i, 1).toLocaleDateString()}</td>
                    <td className="py-2 text-gray-500">{isP13 ? '12/31/2026' : new Date(2026, i + 1, 0).toLocaleDateString()}</td>
                    <td className="py-2">
                      {i < 2 ? <span className="px-2 py-0.5 rounded text-xs bg-gray-200 text-gray-600">Closed</span>
                        : i === 2 ? <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">Current</span>
                        : <span className="px-2 py-0.5 rounded text-xs bg-brand-light text-brand">Future</span>}
                    </td>
                    <td className="py-2">
                      {i >= 2 && <button className="text-xs text-brand hover:underline">Edit</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 italic">Period 13 is used for year-end adjusting entries that do not affect monthly financial statements.</p>
        </div>
      )}

      {tab === 'departments' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Department Configuration</h3>
            <button className="text-sm bg-amacc-600 text-white px-4 py-2 rounded">Add Department</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Code</th><th className="pb-2">Name</th><th className="pb-2">Type</th>
              <th className="pb-2">GL Range</th><th className="pb-2">Manager</th><th className="pb-2">Status</th><th className="pb-2">Actions</th>
            </tr></thead>
            <tbody>
              {[
                { code: '01', name: 'New Vehicle Sales', type: 'Revenue', range: '1000-1999' },
                { code: '02', name: 'Used Vehicle Sales', type: 'Revenue', range: '2000-2999' },
                { code: '03', name: 'Service', type: 'Revenue', range: '3000-3999' },
                { code: '04', name: 'Parts', type: 'Revenue', range: '4000-4999' },
                { code: '05', name: 'Body Shop', type: 'Revenue', range: '5000-5999' },
                { code: '06', name: 'F&I', type: 'Revenue', range: '6000-6999' },
                { code: '09', name: 'Administration', type: 'Overhead', range: '9000-9999' },
              ].map(d => (
                <tr key={d.code} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 font-mono font-bold">{d.code}</td>
                  <td className="py-2 font-medium">{d.name}</td>
                  <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${d.type === 'Revenue' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{d.type}</span></td>
                  <td className="py-2 font-mono text-xs">{d.range}</td>
                  <td className="py-2 text-gray-500">—</td>
                  <td className="py-2"><span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">Active</span></td>
                  <td className="py-2"><button className="text-xs text-brand hover:underline">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'defaults' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <h3 className="text-lg font-semibold">System Defaults</h3>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">General Ledger</h4>
              <div><label className="block text-sm text-gray-600">Default Cash Account</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" defaultValue="1010" /></div>
              <div><label className="block text-sm text-gray-600">Retained Earnings Account</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" defaultValue="3900" /></div>
              <div><label className="block text-sm text-gray-600">Suspense Account</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" defaultValue="9999" /></div>
              <div className="flex items-center gap-2"><input type="checkbox" defaultChecked /><span className="text-sm">Require balanced entries</span></div>
              <div className="flex items-center gap-2"><input type="checkbox" defaultChecked /><span className="text-sm">Auto-assign transaction numbers</span></div>
            </div>
            <div className="space-y-4">
              <h4 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">Accounts Payable</h4>
              <div><label className="block text-sm text-gray-600">Default AP Account</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" defaultValue="2010" /></div>
              <div><label className="block text-sm text-gray-600">1099 Threshold</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm" defaultValue="600.00" /></div>
              <div><label className="block text-sm text-gray-600">Payment Terms (days)</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm" type="number" defaultValue={30} /></div>
              <div className="flex items-center gap-2"><input type="checkbox" /><span className="text-sm">Require PO for vouchers</span></div>
              <div className="flex items-center gap-2"><input type="checkbox" defaultChecked /><span className="text-sm">Auto-calculate discounts</span></div>
            </div>
          </div>
          <div className="flex justify-end"><button className="bg-amacc-600 text-white px-6 py-2 rounded">Save Defaults</button></div>
        </div>
      )}
    </div>
  );
}
