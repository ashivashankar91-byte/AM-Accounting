import { useState } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';

type Tab = 'claims' | 'submit' | 'factory';

const OEM_NAMES: Record<string, string> = { GM: 'General Motors', FORD: 'Ford Motor', FCA: 'FCA / Stellantis', HONDA: 'Honda', TOYOTA: 'Toyota' };

const SAMPLE_CLAIMS = [
  { id: 'WC-2026-0287', oem: 'GM', ro: 'RO-45210', vin: '1G1YY22G965...', op: 'Eng coolant leak', labor: 245, parts: 312, total: 557, status: 'Submitted', date: '03/14/2026' },
  { id: 'WC-2026-0286', oem: 'GM', ro: 'RO-45198', vin: '1G1FB1RS1L0...', op: 'Brake pad replacement', labor: 180, parts: 156, total: 336, status: 'Approved', date: '03/12/2026' },
  { id: 'WC-2026-0285', oem: 'FORD', ro: 'RO-45185', vin: '1FA6P8TH5L0...', op: 'Transmission valve body', labor: 420, parts: 890, total: 1310, status: 'Pending', date: '03/10/2026' },
  { id: 'WC-2026-0284', oem: 'GM', ro: 'RO-45170', vin: '3GKALVEV0ML...', op: 'A/C compressor', labor: 310, parts: 678, total: 988, status: 'Paid', date: '03/05/2026' },
  { id: 'WC-2026-0283', oem: 'HONDA', ro: 'RO-45155', vin: '2HGFC2F59MH...', op: 'Starter motor', labor: 195, parts: 245, total: 440, status: 'Rejected', date: '03/01/2026' },
];

export default function WarrantyDCS() {
  const [tab, setTab] = useState<Tab>('claims');
  const [oemFilter, setOemFilter] = useState('');

  const filtered = SAMPLE_CLAIMS.filter(c => !oemFilter || c.oem === oemFilter);
  const stats = {
    pending: SAMPLE_CLAIMS.filter(c => ['Submitted', 'Pending'].includes(c.status)).length,
    approved: SAMPLE_CLAIMS.filter(c => c.status === 'Approved').length,
    totalOutstanding: SAMPLE_CLAIMS.filter(c => ['Submitted', 'Pending', 'Approved'].includes(c.status)).reduce((s, c) => s + c.total, 0),
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Warranty & DCS Claims</h1><p className="text-sm text-gray-500 mt-0.5">Track warranty, DCS, and recall claim financials. Source: AP/AR Service.</p></div>
        <HelpButton help={SCREEN_HELP['warranty-dcs']} />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Pending Review</p><p className="text-2xl font-bold text-amber-600">{stats.pending}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Approved</p><p className="text-2xl font-bold text-green-600">{stats.approved}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Outstanding Value</p><p className="text-2xl font-bold text-amacc-700">${stats.totalOutstanding.toLocaleString()}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">MTD Claims</p><p className="text-2xl font-bold">{SAMPLE_CLAIMS.length}</p></div>
      </div>

      <div className="flex gap-2 border-b">
        {([['claims', 'Claims'], ['submit', 'New Claim'], ['factory', 'Factory Statements']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'claims' && (
        <>
          <div className="flex gap-3">
            <input className="flex-1 border rounded px-3 py-2 text-sm" placeholder="Search by claim #, RO #, or VIN..." />
            <select className="border rounded px-3 py-2 text-sm" value={oemFilter} onChange={e => setOemFilter(e.target.value)}>
              <option value="">All OEMs</option>
              {Object.entries(OEM_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Claim #</th><th className="pb-2">OEM</th><th className="pb-2">RO #</th>
                <th className="pb-2">VIN</th><th className="pb-2">Operation</th>
                <th className="pb-2 text-right">Labor</th><th className="pb-2 text-right">Parts</th><th className="pb-2 text-right">Total</th>
                <th className="pb-2">Status</th><th className="pb-2">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 font-mono font-bold text-amacc-700">{c.id}</td>
                    <td className="py-2"><span className="px-2 py-0.5 bg-brand-light text-brand rounded text-xs font-semibold">{c.oem}</span></td>
                    <td className="py-2 font-mono text-xs">{c.ro}</td>
                    <td className="py-2 font-mono text-xs text-gray-500">{c.vin}</td>
                    <td className="py-2">{c.op}</td>
                    <td className="py-2 text-right font-mono">${c.labor}</td>
                    <td className="py-2 text-right font-mono">${c.parts}</td>
                    <td className="py-2 text-right font-mono font-bold">${c.total.toLocaleString()}</td>
                    <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${
                      c.status === 'Paid' ? 'bg-green-100 text-green-700' : c.status === 'Approved' ? 'bg-brand-light text-brand'
                      : c.status === 'Rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{c.status}</span></td>
                    <td className="py-2 flex gap-2">
                      <button className="text-xs text-brand hover:underline">Detail</button>
                      {c.status === 'Rejected' && <button className="text-xs text-amber-600 hover:underline">Resubmit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'submit' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-lg font-semibold">Submit Warranty Claim</h3>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700">OEM</label>
              <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                {Object.entries(OEM_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium text-gray-700">Repair Order #</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" placeholder="RO-XXXXX" /></div>
            <div><label className="block text-sm font-medium text-gray-700">VIN</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" placeholder="17-character VIN" maxLength={17} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700">Operation Code</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Factory op code" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Complaint</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Customer complaint" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700">Cause</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Root cause" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Correction</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Repair performed" /></div>
          </div>
          <h4 className="font-semibold text-sm mt-2">Claim Lines</h4>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Type</th><th className="pb-2">Part # / Op Code</th><th className="pb-2">Description</th>
              <th className="pb-2">Qty / Hours</th><th className="pb-2 text-right">Amount</th><th className="pb-2"></th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-gray-50">
                <td className="py-2"><select className="border rounded px-2 py-1 text-sm"><option>Labor</option><option>Parts</option><option>Sublet</option></select></td>
                <td className="py-2"><input className="border rounded px-2 py-1 text-sm w-full" /></td>
                <td className="py-2"><input className="border rounded px-2 py-1 text-sm w-full" /></td>
                <td className="py-2"><input className="border rounded px-2 py-1 text-sm w-20" type="number" /></td>
                <td className="py-2 text-right"><input className="border rounded px-2 py-1 text-sm w-24 text-right" placeholder="0.00" /></td>
                <td className="py-2"><button className="text-red-500">×</button></td>
              </tr>
            </tbody>
          </table>
          <button className="text-sm text-amacc-600 hover:underline">+ Add Line</button>
          <div className="flex justify-end gap-3 pt-2">
            <button className="border px-4 py-2 rounded text-sm">Save Draft</button>
            <button className="bg-amacc-600 text-white px-6 py-2 rounded text-sm">Submit to DCS</button>
          </div>
        </div>
      )}

      {tab === 'factory' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-lg font-semibold">Factory Statements</h3>
          <p className="text-sm text-gray-500">Reconcile factory statement credits against submitted claims</p>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700">OEM</label>
              <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                {Object.entries(OEM_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium text-gray-700">Statement Period</label>
              <input type="month" className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
          </div>
          <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-500">
            <p className="text-lg">Select OEM and period to load factory statement</p>
            <p className="text-xs mt-1">Statements are downloaded from factory DCS portals and reconciled against your warranty receivable accounts</p>
          </div>
          <div className="bg-amber-50 rounded p-3 text-sm text-amber-700">
            <strong>Legacy Context:</strong> This replaces the ACDCSFST, GMDCSFAC, FORDYMNT, HNDCSFST, and MBDCSFST screens from the legacy system, consolidating all OEM-specific factory statement processing into a single unified interface.
          </div>
        </div>
      )}
    </div>
  );
}
