import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { glApi } from '../api/client';

type TabType = 'balance-sheet' | 'income-statement' | 'cash-flow';

export default function FinancialStatements() {
  const [tab, setTab] = useState<TabType>('balance-sheet');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: bs, isLoading: bsLoading } = useQuery({
    queryKey: ['balance-sheet', year, month],
    queryFn: () => glApi.getBalanceSheet(new Date(year, month - 1, 28).toISOString()),
    retry: false,
    enabled: tab === 'balance-sheet',
  });

  const { data: pl, isLoading: plLoading } = useQuery({
    queryKey: ['income-statement', year, month],
    queryFn: () => glApi.getIncomeStatement(year, month),
    retry: false,
    enabled: tab === 'income-statement',
  });

  const { data: cf, isLoading: cfLoading } = useQuery({
    queryKey: ['cash-flow', year, month],
    queryFn: () => glApi.getCashFlowStatement(year, month),
    retry: false,
    enabled: tab === 'cash-flow',
  });

  const tabs: { key: TabType; label: string }[] = [
    { key: 'balance-sheet', label: 'Balance Sheet' },
    { key: 'income-statement', label: 'Income Statement' },
    { key: 'cash-flow', label: 'Cash Flow' },
  ];

  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Financial Statements</h1>
          <p className="text-sm text-gray-500 mt-0.5">Balance Sheet, Income Statement, and Cash Flow Statement. Source: GL Service.</p>
        </div>
        <div className="flex gap-2 items-center">
          <select value={year} onChange={e => setYear(+e.target.value)} className="border rounded px-2 py-1 text-sm">
            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(+e.target.value)} className="border rounded px-2 py-1 text-sm">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString('default', { month: 'long' })}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Balance Sheet */}
      {tab === 'balance-sheet' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Balance Sheet</h3>
          {bsLoading ? <p className="text-gray-500">Loading...</p> : !bs ? <p className="text-gray-400">No data</p> : (
            <div className="grid grid-cols-2 gap-8">
              <div>
                <h4 className="font-semibold text-green-700 mb-2">Assets</h4>
                <table className="w-full text-sm">
                  <tbody>
                    {bs.assets?.accounts?.map((a: any) => (
                      <tr key={a.code} className="border-b border-gray-100">
                        <td className="py-1 text-gray-600">{a.code}</td>
                        <td className="py-1">{a.name}</td>
                        <td className="py-1 text-right font-mono">{fmt(a.balance)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t-2">
                      <td colSpan={2} className="py-2">Total Assets</td>
                      <td className="py-2 text-right font-mono">{fmt(bs.assets?.total ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div>
                <h4 className="font-semibold text-red-700 mb-2">Liabilities</h4>
                <table className="w-full text-sm">
                  <tbody>
                    {bs.liabilities?.accounts?.map((a: any) => (
                      <tr key={a.code} className="border-b border-gray-100">
                        <td className="py-1 text-gray-600">{a.code}</td>
                        <td className="py-1">{a.name}</td>
                        <td className="py-1 text-right font-mono">{fmt(a.balance)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t">
                      <td colSpan={2} className="py-1">Total Liabilities</td>
                      <td className="py-1 text-right font-mono">{fmt(bs.liabilities?.total ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
                <h4 className="font-semibold text-blue-700 mb-2 mt-4">Equity</h4>
                <table className="w-full text-sm">
                  <tbody>
                    {bs.equity?.accounts?.map((a: any) => (
                      <tr key={a.code} className="border-b border-gray-100">
                        <td className="py-1 text-gray-600">{a.code}</td>
                        <td className="py-1">{a.name}</td>
                        <td className="py-1 text-right font-mono">{fmt(a.balance)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t">
                      <td colSpan={2} className="py-1">Total Equity</td>
                      <td className="py-1 text-right font-mono">{fmt(bs.equity?.total ?? 0)}</td>
                    </tr>
                    <tr className="font-bold border-t-2 text-lg">
                      <td colSpan={2} className="py-2">Total L + E</td>
                      <td className="py-2 text-right font-mono">{fmt(bs.totalLiabilitiesAndEquity ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className={`mt-2 px-3 py-1 rounded text-sm font-medium ${bs.balanced ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {bs.balanced ? '✓ Balance sheet is balanced' : '✗ OUT OF BALANCE'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Income Statement */}
      {tab === 'income-statement' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Income Statement (P&L)</h3>
          {plLoading ? <p className="text-gray-500">Loading...</p> : !pl ? <p className="text-gray-400">No data</p> : (
            <div className="max-w-2xl">
              <h4 className="font-semibold text-green-700 mb-2">Revenue</h4>
              <table className="w-full text-sm mb-4">
                <tbody>
                  {pl.revenue?.accounts?.map((a: any) => (
                    <tr key={a.code} className="border-b border-gray-100">
                      <td className="py-1 text-gray-600">{a.code}</td>
                      <td className="py-1">{a.name}</td>
                      <td className="py-1 text-right font-mono">{fmt(a.amount)}</td>
                    </tr>
                  ))}
                  <tr className="font-bold border-t">
                    <td colSpan={2} className="py-1">Total Revenue</td>
                    <td className="py-1 text-right font-mono">{fmt(pl.revenue?.total ?? 0)}</td>
                  </tr>
                </tbody>
              </table>

              <h4 className="font-semibold text-orange-700 mb-2">Cost of Sales</h4>
              <table className="w-full text-sm mb-4">
                <tbody>
                  {pl.costOfSales?.accounts?.map((a: any) => (
                    <tr key={a.code} className="border-b border-gray-100">
                      <td className="py-1 text-gray-600">{a.code}</td>
                      <td className="py-1">{a.name}</td>
                      <td className="py-1 text-right font-mono">{fmt(a.amount)}</td>
                    </tr>
                  ))}
                  <tr className="font-bold border-t">
                    <td colSpan={2} className="py-1">Total COGS</td>
                    <td className="py-1 text-right font-mono">{fmt(pl.costOfSales?.total ?? 0)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="bg-blue-50 rounded p-3 mb-4">
                <span className="font-bold text-blue-800">Gross Profit: </span>
                <span className="font-mono font-bold text-blue-900">{fmt(pl.grossProfit ?? 0)}</span>
              </div>

              <h4 className="font-semibold text-red-700 mb-2">Operating Expenses</h4>
              <table className="w-full text-sm mb-4">
                <tbody>
                  {pl.expenses?.accounts?.map((a: any) => (
                    <tr key={a.code} className="border-b border-gray-100">
                      <td className="py-1 text-gray-600">{a.code}</td>
                      <td className="py-1">{a.name}</td>
                      <td className="py-1 text-right font-mono">{fmt(a.amount)}</td>
                    </tr>
                  ))}
                  <tr className="font-bold border-t">
                    <td colSpan={2} className="py-1">Total Expenses</td>
                    <td className="py-1 text-right font-mono">{fmt(pl.expenses?.total ?? 0)}</td>
                  </tr>
                </tbody>
              </table>

              <div className={`rounded p-3 ${(pl.netIncome ?? 0) >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                <span className="font-bold text-lg">Net Income: </span>
                <span className={`font-mono font-bold text-lg ${(pl.netIncome ?? 0) >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                  {fmt(pl.netIncome ?? 0)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cash Flow Statement */}
      {tab === 'cash-flow' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Cash Flow Statement (Indirect Method)</h3>
          {cfLoading ? <p className="text-gray-500">Loading...</p> : !cf ? <p className="text-gray-400">No data</p> : (
            <div className="max-w-2xl space-y-4">
              <div className="border rounded p-4">
                <h4 className="font-semibold mb-2">Operating Activities</h4>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b"><td className="py-1">Net Income</td><td className="py-1 text-right font-mono">{fmt(cf.operating?.netIncome ?? 0)}</td></tr>
                    <tr className="border-b"><td className="py-1">Depreciation & Amortization</td><td className="py-1 text-right font-mono">{fmt(cf.operating?.depreciation ?? 0)}</td></tr>
                    <tr className="border-b"><td className="py-1">Working Capital Changes</td><td className="py-1 text-right font-mono">{fmt(cf.operating?.workingCapitalChanges ?? 0)}</td></tr>
                    <tr className="font-bold border-t-2"><td className="py-2">Net Cash from Operations</td><td className="py-2 text-right font-mono">{fmt(cf.operating?.total ?? 0)}</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="border rounded p-4">
                <h4 className="font-semibold mb-2">Investing Activities</h4>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="font-bold"><td className="py-2">Net Cash from Investing</td><td className="py-2 text-right font-mono">{fmt(cf.investing?.total ?? 0)}</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="border rounded p-4">
                <h4 className="font-semibold mb-2">Financing Activities</h4>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="font-bold"><td className="py-2">Net Cash from Financing</td><td className="py-2 text-right font-mono">{fmt(cf.financing?.total ?? 0)}</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-gray-50 rounded p-4">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b"><td className="py-1 font-semibold">Net Change in Cash</td><td className="py-1 text-right font-mono font-bold">{fmt(cf.netCashChange ?? 0)}</td></tr>
                    <tr className="border-b"><td className="py-1">Beginning Cash Balance</td><td className="py-1 text-right font-mono">{fmt(cf.beginningCash ?? 0)}</td></tr>
                    <tr className="font-bold text-lg"><td className="py-2">Ending Cash Balance</td><td className="py-2 text-right font-mono">{fmt(cf.endingCash ?? 0)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
