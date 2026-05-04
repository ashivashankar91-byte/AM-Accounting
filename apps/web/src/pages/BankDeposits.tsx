import { useState } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';

type Tab = 'batches' | 'new' | 'reconcile';

export default function BankDeposits() {
  const [tab, setTab] = useState<Tab>('batches');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bank Deposits</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage deposit batches and bank reconciliation. Source: Recon Service.</p>
        </div>
        <HelpButton help={SCREEN_HELP['bank-deposits']} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Open Deposits</p><p className="text-2xl font-bold text-gray-400">—</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Undeposited Funds</p><p className="text-2xl font-bold text-gray-400">—</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">MTD Deposits</p><p className="text-2xl font-bold text-gray-400">—</p></div>
      </div>

      <div className="flex gap-2 border-b">
        {([['batches', 'Deposit Batches'], ['new', 'New Deposit'], ['reconcile', 'Bank Reconciliation']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'batches' && (
        <div className="bg-white rounded-lg shadow p-4">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Deposit #</th><th className="pb-2">Date</th><th className="pb-2">Bank Account</th>
              <th className="pb-2">Receipts</th><th className="pb-2 text-right">Total</th><th className="pb-2">Status</th><th className="pb-2">Actions</th>
            </tr></thead>
            <tbody>
              <tr><td colSpan={7} className="py-12 text-center">
                <div className="text-gray-300 text-4xl mb-3">🏦</div>
                <p className="text-gray-500 font-medium">No deposit batches yet</p>
                <p className="text-sm text-gray-400 mt-1">Record cash receipts and create deposit batches to track bank deposits.</p>
              </td></tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === 'new' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-lg font-semibold">Create Bank Deposit</h3>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700">Bank Account</label>
              <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                <option>1010 – Operating Account</option><option>1020 – Payroll Account</option></select></div>
            <div><label className="block text-sm font-medium text-gray-700">Deposit Date</label>
              <input type="date" className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Reference</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Deposit slip #" /></div>
          </div>
          <h4 className="font-semibold text-sm">Undeposited Cash Receipts</h4>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2 w-8"><input type="checkbox" /></th>
              <th className="pb-2">Receipt #</th><th className="pb-2">Date</th><th className="pb-2">Customer</th>
              <th className="pb-2">Method</th><th className="pb-2 text-right">Amount</th>
            </tr></thead>
            <tbody>
              {[
                { id: 'CR-1847', date: '03/14', cust: 'Smith Auto Group', method: 'Check', amt: 5200 },
                { id: 'CR-1846', date: '03/14', cust: 'Johnson Motors', method: 'Wire', amt: 12500 },
                { id: 'CR-1845', date: '03/13', cust: 'Walk-in Customer', method: 'Cash', amt: 3450 },
                { id: 'CR-1844', date: '03/13', cust: 'ABC Fleet Services', method: 'Check', amt: 8900 },
                { id: 'CR-1843', date: '03/13', cust: 'Davis Enterprises', method: 'ACH', amt: 4510 },
              ].map(r => (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2"><input type="checkbox" /></td>
                  <td className="py-2 font-mono text-xs">{r.id}</td>
                  <td className="py-2 text-gray-500">{r.date}</td>
                  <td className="py-2">{r.cust}</td>
                  <td className="py-2"><span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{r.method}</span></td>
                  <td className="py-2 text-right font-mono">${r.amt.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between items-center pt-2">
            <p className="text-sm text-gray-500">0 selected · $0.00</p>
            <button className="bg-amacc-600 text-white px-6 py-2 rounded text-sm">Create Deposit</button>
          </div>
        </div>
      )}

      {tab === 'reconcile' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-lg font-semibold">Quick Bank Reconciliation</h3>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700">Bank Account</label>
              <select className="w-full mt-1 border rounded px-3 py-2 text-sm"><option>1010 – Operating Account</option></select></div>
            <div><label className="block text-sm font-medium text-gray-700">Statement Date</label>
              <input type="date" className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Statement Balance</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" placeholder="0.00" /></div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <h4 className="font-semibold">Book Balance</h4>
              <div className="flex justify-between"><span>GL Balance:</span><span className="font-mono text-gray-400">—</span></div>
              <div className="flex justify-between"><span>Outstanding Deposits:</span><span className="font-mono text-gray-400">—</span></div>
              <div className="flex justify-between"><span>Outstanding Checks:</span><span className="font-mono text-gray-400">—</span></div>
              <div className="flex justify-between border-t pt-2"><span className="font-semibold">Adjusted Balance:</span><span className="font-mono text-gray-400">—</span></div>
              <p className="text-xs text-gray-400 italic mt-2">Enter a statement balance and reconcile to compute these values.</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <h4 className="font-semibold">Reconciliation Status</h4>
              <div className="flex justify-between"><span>Statement Balance:</span><span className="font-mono text-gray-400">—</span></div>
              <div className="flex justify-between"><span>Adjusted Book Balance:</span><span className="font-mono text-gray-400">—</span></div>
              <div className="flex justify-between border-t pt-2"><span className="font-semibold">Difference:</span><span className="font-mono text-gray-400">—</span></div>
            </div>
          </div>
          <p className="text-xs text-gray-500 italic">For full bank reconciliation with check clearing, use the Reconciliation page.</p>
        </div>
      )}
    </div>
  );
}
