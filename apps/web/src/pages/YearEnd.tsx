import { useState } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';

type Tab = 'checklist' | 'close' | 'history';

const YE_STEPS = [
  { id: 1, name: 'Complete all monthly close procedures', status: 'done' },
  { id: 2, name: 'Post all Period 12 transactions', status: 'done' },
  { id: 3, name: 'Review and post Period 13 adjusting entries', status: 'current' },
  { id: 4, name: 'Run year-end trial balance report', status: 'pending' },
  { id: 5, name: 'Verify all subsidiary schedules balance', status: 'pending' },
  { id: 6, name: 'Generate annual financial statements', status: 'pending' },
  { id: 7, name: 'Calculate retained earnings adjustment', status: 'pending' },
  { id: 8, name: 'Close all revenue/expense to retained earnings', status: 'pending' },
  { id: 9, name: 'Reset accumulator balances', status: 'pending' },
  { id: 10, name: 'Roll forward beginning balances', status: 'pending' },
  { id: 11, name: 'Open new fiscal year periods', status: 'pending' },
  { id: 12, name: 'Archive closed year data', status: 'pending' },
];

export default function YearEnd() {
  const [tab, setTab] = useState<Tab>('checklist');

  const completed = YE_STEPS.filter(s => s.status === 'done').length;
  const progress = Math.round((completed / YE_STEPS.length) * 100);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Year-End Close</h1><p className="text-sm text-gray-500 mt-0.5">Year-end close checklist and final submission. Source: EOM Service.</p></div>
        <HelpButton help={SCREEN_HELP['year-end']} />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Fiscal Year</p><p className="text-2xl font-bold">2026</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Closing Progress</p><p className="text-2xl font-bold text-amacc-700">{progress}%</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Steps Complete</p><p className="text-2xl font-bold">{completed}/{YE_STEPS.length}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Period 13 Entries</p><p className="text-2xl font-bold text-amber-600">3</p></div>
      </div>

      <div className="bg-white rounded-lg shadow p-3">
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-amacc-600 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-gray-500 mt-1 text-center">{completed} of {YE_STEPS.length} steps completed</p>
      </div>

      <div className="flex gap-2 border-b">
        {([['checklist', 'Closing Checklist'], ['close', 'Close Year'], ['history', 'Prior Years']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'checklist' && (
        <div className="bg-white rounded-lg shadow p-4 space-y-1">
          {YE_STEPS.map(step => (
            <div key={step.id} className={`flex items-center gap-3 p-3 rounded ${step.status === 'current' ? 'bg-brand-light border border-brand-border' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                step.status === 'done' ? 'bg-green-100 text-green-700' : step.status === 'current' ? 'bg-amacc-100 text-amacc-700' : 'bg-gray-100 text-gray-400'}`}>
                {step.status === 'done' ? '✓' : step.id}
              </div>
              <span className={`flex-1 text-sm ${step.status === 'done' ? 'line-through text-gray-400' : step.status === 'current' ? 'font-semibold text-amacc-700' : 'text-gray-600'}`}>
                {step.name}
              </span>
              {step.status === 'current' && <button className="text-xs bg-amacc-600 text-white px-3 py-1 rounded">Complete</button>}
              {step.status === 'done' && <span className="text-xs text-gray-400">03/14/2026</span>}
            </div>
          ))}
        </div>
      )}

      {tab === 'close' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-lg font-semibold">Execute Year-End Close</h3>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            <strong>Warning:</strong> Year-end close is a significant, one-time process. Once executed, the following actions occur:
            <ul className="mt-2 ml-4 list-disc space-y-1">
              <li>All revenue and expense accounts are closed to Retained Earnings</li>
              <li>Beginning balances are rolled forward for the new fiscal year</li>
              <li>Period 13 is locked from further entries</li>
              <li>Accumulator values are reset</li>
              <li>The closed year&apos;s periods are permanently locked</li>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <h4 className="font-semibold text-sm">Close Parameters</h4>
              <div><label className="block text-sm text-gray-600">Closing Fiscal Year</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" value="2026" readOnly /></div>
              <div><label className="block text-sm text-gray-600">Retained Earnings Account</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" defaultValue="3900" /></div>
              <div><label className="block text-sm text-gray-600">New Year Opening Date</label>
                <input type="date" className="w-full mt-1 border rounded px-3 py-2 text-sm" defaultValue="2027-01-01" /></div>
            </div>
            <div className="space-y-3">
              <h4 className="font-semibold text-sm">Pre-Close Validation</h4>
              <div className="space-y-2">
                {[
                  { check: 'All periods closed through Period 12', pass: true },
                  { check: 'Period 13 entries reviewed', pass: false },
                  { check: 'Trial balance is in balance', pass: true },
                  { check: 'Subsidiary schedules reconciled', pass: false },
                  { check: 'All pending transactions posted', pass: true },
                ].map((v, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={`text-lg ${v.pass ? 'text-green-500' : 'text-red-500'}`}>{v.pass ? '✓' : '✗'}</span>
                    <span className={v.pass ? 'text-gray-600' : 'text-red-700 font-medium'}>{v.check}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button className="border px-4 py-2 rounded text-sm">Run Validation</button>
            <button className="bg-red-600 text-white px-6 py-2 rounded text-sm opacity-50 cursor-not-allowed" disabled>Close Year (Requires All Validations)</button>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="bg-white rounded-lg shadow p-4">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Year</th><th className="pb-2">Close Date</th><th className="pb-2">Closed By</th>
              <th className="pb-2 text-right">Revenue</th><th className="pb-2 text-right">Expenses</th><th className="pb-2 text-right">Net Income</th><th className="pb-2">Actions</th>
            </tr></thead>
            <tbody>
              {[
                { year: 2025, date: '01/15/2026', by: 'Controller', rev: 8450000, exp: 7890000 },
                { year: 2024, date: '01/18/2025', by: 'Controller', rev: 7980000, exp: 7560000 },
                { year: 2023, date: '01/20/2024', by: 'Controller', rev: 7320000, exp: 6940000 },
              ].map(y => (
                <tr key={y.year} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 font-bold">{y.year}</td>
                  <td className="py-2 text-gray-500">{y.date}</td>
                  <td className="py-2">{y.by}</td>
                  <td className="py-2 text-right font-mono">${(y.rev / 1000000).toFixed(2)}M</td>
                  <td className="py-2 text-right font-mono text-red-600">${(y.exp / 1000000).toFixed(2)}M</td>
                  <td className="py-2 text-right font-mono font-bold text-green-600">${((y.rev - y.exp) / 1000).toFixed(0)}K</td>
                  <td className="py-2"><button className="text-xs text-brand hover:underline">View Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
