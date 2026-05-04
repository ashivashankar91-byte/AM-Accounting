import { useState } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';

type Tab = 'list' | 'detail' | 'add';

const SAMPLE_VENDORS = [
  { id: 'V001', name: 'AutoParts Supply Co', contact: 'Mike Johnson', phone: '555-0101', email: 'mike@autoparts.com', terms: 'Net 30', balance: 12450, is1099: false, status: 'Active' },
  { id: 'V002', name: 'OEM Parts Direct', contact: 'Sarah Kim', phone: '555-0202', email: 'sarah@oemparts.com', terms: 'Net 45', balance: 34200, is1099: false, status: 'Active' },
  { id: 'V003', name: 'Shop Supplies Inc', contact: 'Tom Davis', phone: '555-0303', email: 'tom@shopsupplies.com', terms: 'Net 30', balance: 2340, is1099: false, status: 'Active' },
  { id: 'V004', name: 'Johnson Landscaping', contact: 'Bill Johnson', phone: '555-0404', email: 'bill@jlandscape.com', terms: 'Due Receipt', balance: 450, is1099: true, status: 'Active' },
  { id: 'V005', name: 'City Utilities', contact: 'Accounts Dept', phone: '555-0505', email: '', terms: 'Net 15', balance: 3200, is1099: false, status: 'Active' },
  { id: 'V006', name: 'Premier Cleaning LLC', contact: 'Rosa Martinez', phone: '555-0606', email: 'rosa@premierclean.com', terms: 'Net 30', balance: 0, is1099: true, status: 'Inactive' },
];

export default function VendorManagement() {
  const [tab, setTab] = useState<Tab>('list');
  const [filter, setFilter] = useState('');
  const [show1099Only, setShow1099Only] = useState(false);

  const filtered = SAMPLE_VENDORS.filter(v =>
    (!filter || v.name.toLowerCase().includes(filter.toLowerCase()) || v.id.includes(filter)) &&
    (!show1099Only || v.is1099)
  );

  const totalOwed = SAMPLE_VENDORS.filter(v => v.status === 'Active').reduce((s, v) => s + v.balance, 0);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Vendor Management</h1><p className="text-sm text-gray-500 mt-0.5">Manage vendor profiles, terms, and payment history. Source: AP/AR Service.</p></div>
        <HelpButton help={SCREEN_HELP['vendor-management']} />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Total Vendors</p><p className="text-2xl font-bold">{SAMPLE_VENDORS.filter(v => v.status === 'Active').length}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Total Outstanding</p><p className="text-2xl font-bold text-red-600">${totalOwed.toLocaleString()}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">1099 Vendors</p><p className="text-2xl font-bold text-amber-600">{SAMPLE_VENDORS.filter(v => v.is1099).length}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Inactive</p><p className="text-2xl font-bold text-gray-400">{SAMPLE_VENDORS.filter(v => v.status === 'Inactive').length}</p></div>
      </div>

      <div className="flex gap-2 border-b">
        {([['list', 'Vendor List'], ['detail', 'Vendor Detail'], ['add', 'Add Vendor']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'list' && (
        <>
          <div className="flex gap-3 items-center">
            <input className="flex-1 border rounded px-3 py-2 text-sm" placeholder="Search by name or ID..." value={filter} onChange={e => setFilter(e.target.value)} />
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={show1099Only} onChange={e => setShow1099Only(e.target.checked)} /> 1099 Only</label>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b">
                <th className="pb-2">ID</th><th className="pb-2">Name</th><th className="pb-2">Contact</th>
                <th className="pb-2">Terms</th><th className="pb-2 text-right">Balance</th><th className="pb-2">1099</th>
                <th className="pb-2">Status</th><th className="pb-2">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 font-mono text-xs">{v.id}</td>
                    <td className="py-2 font-medium">{v.name}</td>
                    <td className="py-2 text-gray-600">{v.contact}</td>
                    <td className="py-2 text-xs">{v.terms}</td>
                    <td className="py-2 text-right font-mono">{v.balance > 0 ? `$${v.balance.toLocaleString()}` : '—'}</td>
                    <td className="py-2">{v.is1099 ? <span className="text-amber-600 font-bold text-xs">1099</span> : ''}</td>
                    <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${v.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{v.status}</span></td>
                    <td className="py-2 flex gap-2">
                      <button className="text-xs text-blue-600 hover:underline" onClick={() => setTab('detail')}>Detail</button>
                      <button className="text-xs text-gray-400 cursor-not-allowed" disabled title="Edit vendor — coming soon">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'detail' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-lg font-semibold">AutoParts Supply Co</h3>
              <p className="text-gray-500 text-sm">V001 · Active since Jan 2020</p>
            </div>
            <button className="text-sm text-blue-600 hover:underline">Edit Vendor</button>
          </div>
          <div className="grid grid-cols-3 gap-6">
            <div className="space-y-2 text-sm">
              <h4 className="font-semibold text-gray-700">Contact Info</h4>
              <p>Mike Johnson</p><p>555-0101</p><p>mike@autoparts.com</p>
              <p className="text-gray-400 mt-2">123 Industrial Blvd<br />Anytown, ST 12345</p>
            </div>
            <div className="space-y-2 text-sm">
              <h4 className="font-semibold text-gray-700">Payment Terms</h4>
              <p>Terms: Net 30</p><p>Default GL: 1510 (Parts Inventory)</p><p>Payment Method: Check</p>
              <p className="text-amber-600 mt-2">1099: No</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 text-sm">
              <h4 className="font-semibold text-gray-700 mb-2">YTD Summary</h4>
              <div className="space-y-1">
                <div className="flex justify-between"><span>Purchases:</span><span className="font-mono font-bold">$87,340</span></div>
                <div className="flex justify-between"><span>Payments:</span><span className="font-mono">$74,890</span></div>
                <div className="flex justify-between border-t pt-1"><span>Outstanding:</span><span className="font-mono text-red-600 font-bold">$12,450</span></div>
              </div>
            </div>
          </div>
          <h4 className="font-semibold text-sm">Recent Activity</h4>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Date</th><th className="pb-2">Type</th><th className="pb-2">Ref</th><th className="pb-2">Description</th><th className="pb-2 text-right">Amount</th>
            </tr></thead>
            <tbody>
              {[
                { date: '03/12', type: 'Voucher', ref: 'AP-2304', desc: 'Parts order #4521', amt: 3450 },
                { date: '03/08', type: 'Payment', ref: 'CHK-1102', desc: 'Payment on account', amt: -8900 },
                { date: '03/01', type: 'Voucher', ref: 'AP-2298', desc: 'Parts order #4498', amt: 8900 },
              ].map((t, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 text-gray-500">{t.date}</td>
                  <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${t.type === 'Voucher' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>{t.type}</span></td>
                  <td className="py-2 font-mono text-xs">{t.ref}</td>
                  <td className="py-2">{t.desc}</td>
                  <td className={`py-2 text-right font-mono ${t.amt < 0 ? 'text-green-600' : ''}`}>{t.amt < 0 ? '-' : ''}${Math.abs(t.amt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'add' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-lg font-semibold">Add New Vendor</h3>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Basic Info</h4>
              <div><label className="block text-sm text-gray-600">Vendor Name *</label><input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
              <div><label className="block text-sm text-gray-600">DBA Name</label><input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
              <div><label className="block text-sm text-gray-600">Contact Name</label><input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm text-gray-600">Phone</label><input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
                <div><label className="block text-sm text-gray-600">Email</label><input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
              </div>
              <div><label className="block text-sm text-gray-600">Address</label><input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="block text-sm text-gray-600">City</label><input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
                <div><label className="block text-sm text-gray-600">State</label><input className="w-full mt-1 border rounded px-3 py-2 text-sm" maxLength={2} /></div>
                <div><label className="block text-sm text-gray-600">ZIP</label><input className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
              </div>
            </div>
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Payment Settings</h4>
              <div><label className="block text-sm text-gray-600">Payment Terms</label>
                <select className="w-full mt-1 border rounded px-3 py-2 text-sm"><option>Net 30</option><option>Net 15</option><option>Net 45</option><option>Net 60</option><option>Due on Receipt</option></select></div>
              <div><label className="block text-sm text-gray-600">Payment Method</label>
                <select className="w-full mt-1 border rounded px-3 py-2 text-sm"><option>Check</option><option>EFT/ACH</option><option>Credit Card</option></select></div>
              <div><label className="block text-sm text-gray-600">Default GL Account</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" placeholder="XXXX" /></div>
              <div className="flex items-center gap-2 mt-3"><input type="checkbox" /><span className="text-sm font-medium">1099 Vendor</span></div>
              <div><label className="block text-sm text-gray-600">Tax ID / SSN</label><input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="XX-XXXXXXX" /></div>
              <div><label className="block text-sm text-gray-600">Notes</label><textarea className="w-full mt-1 border rounded px-3 py-2 text-sm" rows={3} /></div>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button className="border px-4 py-2 rounded text-sm" onClick={() => setTab('list')}>Cancel</button>
            <button className="bg-amacc-600 text-white px-6 py-2 rounded text-sm">Save Vendor</button>
          </div>
        </div>
      )}
    </div>
  );
}
