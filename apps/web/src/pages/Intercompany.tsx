import { useState } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';

type Tab = 'transfers' | 'create' | 'companies';

const SAMPLE_COMPANIES = [
  { id: 'CO1', name: 'Main Dealership', franchise: 'GM', db: 'amacc_main' },
  { id: 'CO2', name: 'Used Car Center', franchise: 'Multi', db: 'amacc_used' },
  { id: 'CO3', name: 'Honda Store', franchise: 'Honda', db: 'amacc_honda' },
];

const SAMPLE_TRANSFERS = [
  { id: 'IC-2026-042', from: 'Main Dealership', to: 'Used Car Center', date: '03/14/2026', amount: 24500, desc: 'Vehicle transfer – Stock #U2041', status: 'Pending' },
  { id: 'IC-2026-041', from: 'Honda Store', to: 'Main Dealership', date: '03/12/2026', amount: 1200, desc: 'Shared advertising allocation', status: 'Posted' },
  { id: 'IC-2026-040', from: 'Main Dealership', to: 'Honda Store', date: '03/10/2026', amount: 8500, desc: 'Parts transfer for warranty work', status: 'Posted' },
  { id: 'IC-2026-039', from: 'Used Car Center', to: 'Main Dealership', date: '03/05/2026', amount: 500, desc: 'Management fee allocation', status: 'Posted' },
];

export default function Intercompany() {
  const [tab, setTab] = useState<Tab>('transfers');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Intercompany Transactions</h1><p className="text-sm text-gray-500 mt-0.5">Track and reconcile transactions between group companies. Source: GL Service.</p></div>
        <HelpButton help={SCREEN_HELP['intercompany']} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Linked Companies</p><p className="text-2xl font-bold">{SAMPLE_COMPANIES.length}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Pending Transfers</p><p className="text-2xl font-bold text-amber-600">{SAMPLE_TRANSFERS.filter(t => t.status === 'Pending').length}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">MTD Volume</p><p className="text-2xl font-bold text-amacc-700">${SAMPLE_TRANSFERS.reduce((s, t) => s + t.amount, 0).toLocaleString()}</p></div>
      </div>

      <div className="flex gap-2 border-b">
        {([['transfers', 'Transfer Log'], ['create', 'New Transfer'], ['companies', 'Linked Companies']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'transfers' && (
        <div className="bg-white rounded-lg shadow p-4">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Transfer #</th><th className="pb-2">From</th><th className="pb-2">To</th>
              <th className="pb-2">Date</th><th className="pb-2">Description</th><th className="pb-2 text-right">Amount</th>
              <th className="pb-2">Status</th><th className="pb-2">Actions</th>
            </tr></thead>
            <tbody>
              {SAMPLE_TRANSFERS.map(t => (
                <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 font-mono font-bold text-amacc-700">{t.id}</td>
                  <td className="py-2">{t.from}</td>
                  <td className="py-2">{t.to}</td>
                  <td className="py-2 text-gray-500">{t.date}</td>
                  <td className="py-2">{t.desc}</td>
                  <td className="py-2 text-right font-mono">${t.amount.toLocaleString()}</td>
                  <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${t.status === 'Pending' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{t.status}</span></td>
                  <td className="py-2">
                    {t.status === 'Pending' && <button className="text-xs text-green-600 hover:underline">Post</button>}
                    {t.status === 'Posted' && <button className="text-xs text-brand hover:underline">View</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'create' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-lg font-semibold">Create Intercompany Transfer</h3>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700">From Company</label>
                <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                  {SAMPLE_COMPANIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div><label className="block text-sm font-medium text-gray-700">From GL Account</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" placeholder="XXXX" /></div>
              <div><label className="block text-sm font-medium text-gray-700">From Department</label>
                <select className="w-full mt-1 border rounded px-3 py-2 text-sm"><option>01 – New</option><option>02 – Used</option><option>03 – Service</option><option>09 – Admin</option></select></div>
            </div>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700">To Company</label>
                <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                  {SAMPLE_COMPANIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div><label className="block text-sm font-medium text-gray-700">To GL Account</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" placeholder="XXXX" /></div>
              <div><label className="block text-sm font-medium text-gray-700">To Department</label>
                <select className="w-full mt-1 border rounded px-3 py-2 text-sm"><option>01 – New</option><option>02 – Used</option><option>03 – Service</option><option>09 – Admin</option></select></div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700">Amount</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" placeholder="0.00" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Transfer Date</label>
              <input type="date" className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Reference</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Transfer ref #" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700">Description</label>
            <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Reason for transfer" /></div>
          <div className="bg-brand-light rounded-lg p-3 text-sm text-brand">
            This will create matching debit/credit entries in both company ledgers. The intercompany clearing account will be used to balance the transaction.
          </div>
          <div className="flex justify-end gap-3">
            <button className="border px-4 py-2 rounded text-sm">Cancel</button>
            <button className="bg-amacc-600 text-white px-6 py-2 rounded text-sm">Create Transfer</button>
          </div>
        </div>
      )}

      {tab === 'companies' && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">Linked Companies</h3>
            <button className="text-sm bg-amacc-600 text-white px-4 py-2 rounded">Link Company</button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {SAMPLE_COMPANIES.map(c => (
              <div key={c.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex justify-between items-start">
                  <h4 className="font-semibold">{c.name}</h4>
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">Active</span>
                </div>
                <p className="text-sm text-gray-500">ID: {c.id} · {c.franchise}</p>
                <p className="text-xs text-gray-400 font-mono">{c.db}</p>
                <div className="flex gap-2 pt-2">
                  <button className="text-xs text-brand hover:underline">View Balance</button>
                  <button className="text-xs text-gray-500 hover:underline">Settings</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
