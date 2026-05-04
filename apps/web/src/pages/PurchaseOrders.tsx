import { useState } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';

type Tab = 'list' | 'create' | 'receiving';

const SAMPLE_POS = [
  { id: 'PO-2026-0142', vendor: 'AutoParts Supply Co', date: '03/12/2026', total: 12450, items: 8, status: 'Open', dept: '04' },
  { id: 'PO-2026-0141', vendor: 'OEM Parts Direct', date: '03/10/2026', total: 34200, items: 12, status: 'Partial', dept: '04' },
  { id: 'PO-2026-0140', vendor: 'Shop Supplies Inc', date: '03/08/2026', total: 2340, items: 5, status: 'Received', dept: '03' },
  { id: 'PO-2026-0139', vendor: 'Office Depot', date: '03/05/2026', total: 890, items: 3, status: 'Closed', dept: '09' },
  { id: 'PO-2026-0138', vendor: 'AutoParts Supply Co', date: '03/01/2026', total: 8900, items: 6, status: 'Closed', dept: '04' },
];

export default function PurchaseOrders() {
  const [tab, setTab] = useState<Tab>('list');
  const [statusFilter, setStatusFilter] = useState('');

  const filtered = SAMPLE_POS.filter(po => !statusFilter || po.status === statusFilter);
  const stats = { open: SAMPLE_POS.filter(p => p.status === 'Open').length, partial: SAMPLE_POS.filter(p => p.status === 'Partial').length, total: SAMPLE_POS.reduce((s, p) => s + (p.status !== 'Closed' ? p.total : 0), 0) };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Purchase Orders</h1><p className="text-sm text-gray-500 mt-0.5">Track and manage vendor purchase orders. Source: AP/AR Service.</p></div>
        <HelpButton help={SCREEN_HELP['purchase-orders']} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Open POs</p><p className="text-2xl font-bold text-blue-600">{stats.open}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Partially Received</p><p className="text-2xl font-bold text-amber-600">{stats.partial}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Outstanding Value</p><p className="text-2xl font-bold text-amacc-700">${stats.total.toLocaleString()}</p></div>
      </div>

      <div className="flex gap-2 border-b">
        {([['list', 'PO List'], ['create', 'New PO'], ['receiving', 'Receiving']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'list' && (
        <>
          <div className="flex gap-3">
            <input className="flex-1 border rounded px-3 py-2 text-sm" placeholder="Search POs..." />
            <select className="border rounded px-3 py-2 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option><option>Open</option><option>Partial</option><option>Received</option><option>Closed</option>
            </select>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b">
                <th className="pb-2">PO #</th><th className="pb-2">Vendor</th><th className="pb-2">Date</th>
                <th className="pb-2">Items</th><th className="pb-2 text-right">Total</th><th className="pb-2">Dept</th>
                <th className="pb-2">Status</th><th className="pb-2">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map(po => (
                  <tr key={po.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 font-mono font-bold text-amacc-700">{po.id}</td>
                    <td className="py-2 font-medium">{po.vendor}</td>
                    <td className="py-2 text-gray-500">{po.date}</td>
                    <td className="py-2">{po.items}</td>
                    <td className="py-2 text-right font-mono">${po.total.toLocaleString()}</td>
                    <td className="py-2 font-mono text-xs">{po.dept}</td>
                    <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${
                      po.status === 'Open' ? 'bg-blue-100 text-blue-700' : po.status === 'Partial' ? 'bg-amber-100 text-amber-700'
                      : po.status === 'Received' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{po.status}</span></td>
                    <td className="py-2 flex gap-2">
                      <button className="text-xs text-blue-600 hover:underline">View</button>
                      {po.status !== 'Closed' && <button className="text-xs text-green-600 hover:underline">Receive</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'create' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-lg font-semibold">Create Purchase Order</h3>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700">Vendor</label>
              <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                <option value="">Select vendor...</option><option>AutoParts Supply Co</option><option>OEM Parts Direct</option><option>Shop Supplies Inc</option>
              </select></div>
            <div><label className="block text-sm font-medium text-gray-700">Department</label>
              <select className="w-full mt-1 border rounded px-3 py-2 text-sm"><option>04 – Parts</option><option>03 – Service</option><option>09 – Admin</option></select></div>
            <div><label className="block text-sm font-medium text-gray-700">Ship To</label>
              <select className="w-full mt-1 border rounded px-3 py-2 text-sm"><option>Main Location</option></select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700">Required Date</label>
              <input type="date" className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Notes</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="PO notes..." /></div>
          </div>
          <h4 className="font-semibold text-sm mt-4">Line Items</h4>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Part #</th><th className="pb-2">Description</th><th className="pb-2">Qty</th>
              <th className="pb-2">Unit Cost</th><th className="pb-2">GL Account</th><th className="pb-2 text-right">Total</th><th className="pb-2"></th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-gray-50">
                <td className="py-2"><input className="border rounded px-2 py-1 text-sm w-full" placeholder="Part #" /></td>
                <td className="py-2"><input className="border rounded px-2 py-1 text-sm w-full" placeholder="Description" /></td>
                <td className="py-2"><input className="border rounded px-2 py-1 text-sm w-20" type="number" defaultValue={1} /></td>
                <td className="py-2"><input className="border rounded px-2 py-1 text-sm w-24" placeholder="0.00" /></td>
                <td className="py-2"><input className="border rounded px-2 py-1 text-sm font-mono w-20" placeholder="XXXX" /></td>
                <td className="py-2 text-right font-mono">$0.00</td>
                <td className="py-2"><button className="text-red-500 text-xs">×</button></td>
              </tr>
            </tbody>
          </table>
          <div className="flex justify-between">
            <button className="text-sm text-amacc-600 hover:underline">+ Add Line</button>
            <div className="flex gap-3">
              <button className="border px-4 py-2 rounded text-sm">Save Draft</button>
              <button className="bg-amacc-600 text-white px-6 py-2 rounded text-sm">Submit PO</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'receiving' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-lg font-semibold">Receive Against PO</h3>
          <div className="flex gap-3">
            <select className="flex-1 border rounded px-3 py-2 text-sm">
              <option value="">Select PO to receive against...</option>
              {SAMPLE_POS.filter(po => po.status === 'Open' || po.status === 'Partial').map(po =>
                <option key={po.id} value={po.id}>{po.id} – {po.vendor} (${po.total.toLocaleString()})</option>
              )}
            </select>
            <button className="bg-amacc-600 text-white px-4 py-2 rounded text-sm">Load PO</button>
          </div>
          <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-500">
            <p>Select a PO above to begin receiving items</p>
            <p className="text-xs mt-1">You can record partial or full receipts against open POs</p>
          </div>
        </div>
      )}
    </div>
  );
}
