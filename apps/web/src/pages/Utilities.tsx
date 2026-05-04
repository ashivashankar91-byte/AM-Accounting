import { useState } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';

type Tab = 'tools' | 'fixoob' | 'audit';

interface ToolCard { name: string; desc: string; icon: string; risk: 'low' | 'medium' | 'high'; }

const UTILITY_TOOLS: ToolCard[] = [
  { name: 'Fix Out-of-Balance', desc: 'Detect and correct GL entries that are out of balance', icon: '⚖️', risk: 'high' },
  { name: 'Journal Repair', desc: 'Repair or patch corrupted journal entries', icon: '🔧', risk: 'high' },
  { name: 'Reverse Transaction', desc: 'Create reversing entries for posted transactions', icon: '↩️', risk: 'medium' },
  { name: 'Recalculate Balances', desc: 'Rebuild running balances from transaction history', icon: '🔄', risk: 'medium' },
  { name: 'Purge Old Data', desc: 'Archive and remove data beyond retention period', icon: '🗄️', risk: 'high' },
  { name: 'Rebuild Indexes', desc: 'Rebuild search indexes for optimal performance', icon: '📊', risk: 'low' },
  { name: 'Export Audit Trail', desc: 'Generate complete audit trail export for compliance', icon: '📋', risk: 'low' },
  { name: 'Validate COA', desc: 'Check chart of accounts integrity and OEM compliance', icon: '✅', risk: 'low' },
];

export default function Utilities() {
  const [tab, setTab] = useState<Tab>('tools');
  const [running, setRunning] = useState<string | null>(null);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">System Utilities</h1><p className="text-sm text-gray-500 mt-0.5">Fix out-of-balance conditions, recalculate totals, and rebuild indexes. Source: GL Service.</p></div>
        <HelpButton help={SCREEN_HELP['utilities']} />
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
        <strong>Administrative Area:</strong> These utilities modify system data. Operations are logged in the audit trail. High-risk tools require confirmation.
      </div>

      <div className="flex gap-2 border-b">
        {([['tools', 'Utility Tools'], ['fixoob', 'Fix Out-of-Balance'], ['audit', 'Utility Log']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'tools' && (
        <div className="grid grid-cols-2 gap-4">
          {UTILITY_TOOLS.map(tool => (
            <button key={tool.name} onClick={() => { setRunning(tool.name); setTab(tool.name === 'Fix Out-of-Balance' ? 'fixoob' : 'tools'); }}
              className="bg-white rounded-lg shadow p-4 text-left hover:shadow-md transition-shadow border-l-4"
              style={{ borderLeftColor: tool.risk === 'high' ? '#ef4444' : tool.risk === 'medium' ? '#f59e0b' : '#22c55e' }}>
              <div className="flex items-start gap-3">
                <span className="text-2xl">{tool.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold">{tool.name}</h4>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      tool.risk === 'high' ? 'bg-red-100 text-red-700' : tool.risk === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                      {tool.risk.toUpperCase()} RISK
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{tool.desc}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {tab === 'fixoob' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-lg font-semibold">Fix Out-of-Balance Entries</h3>
          <p className="text-sm text-gray-500">Scan GL transactions for entries where debits do not equal credits and generate correcting entries.</p>

          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700">Scan Period</label>
              <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                <option>Current Period (March 2026)</option><option>All Open Periods</option><option>Custom Range</option>
              </select></div>
            <div><label className="block text-sm font-medium text-gray-700">Correction Account</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" defaultValue="9999" placeholder="Suspense acct" /></div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setRunning('scan')} className="bg-amacc-600 text-white px-4 py-2 rounded text-sm">
              {running === 'scan' ? 'Scanning...' : 'Scan for Issues'}
            </button>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b text-sm font-semibold">Scan Results</div>
            <div className="p-4">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Trans #</th><th className="pb-2">Date</th><th className="pb-2">Source</th>
                  <th className="pb-2 text-right">Debits</th><th className="pb-2 text-right">Credits</th>
                  <th className="pb-2 text-right">Difference</th><th className="pb-2">Fix</th>
                </tr></thead>
                <tbody>
                  {[
                    { id: 'TRN-45210', date: '03/10', src: 'GJ', dr: 1500, cr: 1499.5 },
                    { id: 'TRN-44892', date: '02/28', src: 'AP', dr: 3200.25, cr: 3200 },
                  ].map(t => (
                    <tr key={t.id} className="border-b border-gray-50">
                      <td className="py-2 font-mono text-xs">{t.id}</td>
                      <td className="py-2 text-gray-500">{t.date}</td>
                      <td className="py-2 font-mono text-xs">{t.src}</td>
                      <td className="py-2 text-right font-mono">${t.dr.toFixed(2)}</td>
                      <td className="py-2 text-right font-mono">${t.cr.toFixed(2)}</td>
                      <td className="py-2 text-right font-mono text-red-600 font-bold">${(t.dr - t.cr).toFixed(2)}</td>
                      <td className="py-2"><button className="text-xs bg-green-600 text-white px-2 py-1 rounded">Auto-Fix</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-gray-400 mt-3">Found 2 out-of-balance entries totaling $0.75 difference</p>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button className="border px-4 py-2 rounded text-sm">Fix Selected</button>
            <button className="bg-red-600 text-white px-4 py-2 rounded text-sm">Fix All ({2})</button>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-3">Utility Execution Log</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Timestamp</th><th className="pb-2">Utility</th><th className="pb-2">User</th>
              <th className="pb-2">Details</th><th className="pb-2">Result</th>
            </tr></thead>
            <tbody>
              {[
                { time: '2026-03-14 14:32', tool: 'Fix Out-of-Balance', user: 'admin', detail: 'Scanned Period 03, found 2 issues', result: 'Success' },
                { time: '2026-03-10 09:15', tool: 'Rebuild Indexes', user: 'admin', detail: 'Full index rebuild', result: 'Success' },
                { time: '2026-03-01 16:45', tool: 'Validate COA', user: 'controller', detail: '147 accounts checked, 0 issues', result: 'Success' },
                { time: '2026-02-28 23:01', tool: 'Recalculate Balances', user: 'admin', detail: 'Period 02 rebuild, 1,247 entries', result: 'Success' },
                { time: '2026-02-15 11:20', tool: 'Reverse Transaction', user: 'controller', detail: 'Reversed TRN-44501', result: 'Success' },
              ].map((l, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 text-gray-500 text-xs font-mono">{l.time}</td>
                  <td className="py-2 font-medium">{l.tool}</td>
                  <td className="py-2">{l.user}</td>
                  <td className="py-2 text-gray-600">{l.detail}</td>
                  <td className="py-2"><span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">{l.result}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
