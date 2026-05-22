import { useState } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';

type Tab = 'new' | 'list' | 'deposits' | 'methods';

export default function CashReceipts() {
  const [tab, setTab] = useState<Tab>('list');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cash Receipts</h1>
          <p className="text-sm text-gray-500 mt-0.5">Record and track customer payments and cash received. Source: Cash Receipt Service.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setTab('new')} className="bg-amacc-600 text-white px-4 py-2 rounded text-sm hover:bg-amacc-700">New Receipt</button>
          <HelpButton help={SCREEN_HELP['cash-receipts']} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <KPI label="Receipts Today" value="—" />
        <KPI label="Total Received Today" value="—" />
        <KPI label="Unapplied Cash" value="—" color="text-gray-400" />
        <KPI label="Open Deposit Batches" value="—" />
      </div>

      <div className="flex gap-2 border-b">
        {([['list', 'Receipt List'], ['new', 'New Receipt'], ['deposits', 'Bank Deposits'], ['methods', 'Payment Methods']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'list' && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex gap-3 mb-4">
            <input type="date" className="border rounded px-3 py-2 text-sm" />
            <span className="text-sm text-gray-400 self-center">to</span>
            <input type="date" className="border rounded px-3 py-2 text-sm" />
            <input placeholder="Search customer..." className="border rounded px-3 py-2 text-sm w-64" />
            <select className="border rounded px-3 py-2 text-sm">
              <option value="">All Methods</option>
              <option value="cash">Cash</option><option value="check">Check</option>
              <option value="card">Credit Card</option><option value="eft">EFT</option>
            </select>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Receipt #</th><th className="pb-2">Date</th><th className="pb-2">Customer</th>
              <th className="pb-2">Method</th><th className="pb-2 text-right">Amount</th>
              <th className="pb-2 text-right">Applied</th><th className="pb-2">Deposit Batch</th>
            </tr></thead>
            <tbody>
              <tr><td colSpan={7} className="py-8 text-center text-gray-400">No receipts found. Click "New Receipt" to record a payment.</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === 'new' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="font-semibold mb-4">Record New Receipt</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Customer</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Search by name or control #" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Payment Method</label>
              <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                <option value="cash">Cash</option><option value="check">Check</option>
                <option value="card">Credit Card</option><option value="eft">EFT</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Amount</label>
              <input type="number" step="0.01" className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="0.00" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Receipt Date</label>
              <input type="date" className="w-full mt-1 border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Check # / Reference</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Check number or card ref" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Deposit Batch</label>
              <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                <option value="">Create New Batch</option>
              </select>
            </div>
          </div>

          <h4 className="text-sm font-semibold text-gray-600 mb-2 mt-6">Apply to Open Invoices</h4>
          <table className="w-full text-sm mb-4">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2 w-8"><input type="checkbox" /></th>
              <th className="pb-2">Invoice</th><th className="pb-2">Date</th>
              <th className="pb-2 text-right">Balance</th><th className="pb-2 text-right">Apply Amount</th>
            </tr></thead>
            <tbody>
              <tr><td colSpan={5} className="py-4 text-center text-gray-400 text-sm">Select a customer to see open invoices</td></tr>
            </tbody>
          </table>

          <div className="flex gap-2">
            <button className="bg-green-600 text-white px-4 py-2 rounded text-sm">Save Receipt</button>
            <button className="bg-gray-200 text-gray-700 px-4 py-2 rounded text-sm">Save & Print</button>
          </div>
        </div>
      )}

      {tab === 'deposits' && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Bank Deposit Batches</h3>
            <button className="text-xs bg-amacc-600 text-white px-3 py-1.5 rounded">New Deposit Batch</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Batch ID</th><th className="pb-2">Date</th><th className="pb-2">Bank Account</th>
              <th className="pb-2 text-right">Total</th><th className="pb-2 text-right">Receipts</th>
              <th className="pb-2">Status</th><th className="pb-2">Actions</th>
            </tr></thead>
            <tbody>
              <tr><td colSpan={7} className="py-8 text-center text-gray-400">No deposit batches found</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === 'methods' && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Payment Methods</h3>
            <button className="text-xs bg-amacc-600 text-white px-3 py-1.5 rounded">Add Method</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Method</th><th className="pb-2">GL Account</th>
              <th className="pb-2">Active</th><th className="pb-2">Actions</th>
            </tr></thead>
            <tbody>
              {['Cash', 'Check', 'Credit Card', 'EFT', 'Wire Transfer'].map((m, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 font-medium">{m}</td>
                  <td className="py-2 font-mono text-xs">1010-{(i + 1).toString().padStart(2, '0')}</td>
                  <td className="py-2 text-green-600">✓</td>
                  <td className="py-2"><button className="text-xs text-gray-400 cursor-not-allowed" disabled title="Edit payment method — coming soon">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ?? 'text-amacc-700'}`}>{value}</div>
    </div>
  );
}
