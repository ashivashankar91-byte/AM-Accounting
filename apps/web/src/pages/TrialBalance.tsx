import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { glApi } from '../api/client';

const fmt = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TrialBalance() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: tb, isLoading, isError } = useQuery({
    queryKey: ['trial-balance', year, month],
    queryFn: () => glApi.getTrialBalance(year, month),
    retry: false,
  });

  const rows: any[] = tb?.accounts ?? tb?.rows ?? (Array.isArray(tb) ? tb : []);
  const totalDebit = rows.reduce((s: number, r: any) => s + (r.debit ?? r.totalDebit ?? 0), 0);
  const totalCredit = rows.reduce((s: number, r: any) => s + (r.credit ?? r.totalCredit ?? 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 1;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Trial Balance</h1>
        <p className="text-sm text-gray-500 mt-0.5">Account balances for the selected period. Source: GL Service.</p>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-3">
        <select value={month} onChange={e => setMonth(Number(e.target.value))}
          className="border rounded px-3 py-2 text-sm">
          {['January','February','March','April','May','June','July','August','September','October','November','December']
            .map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="border rounded px-3 py-2 text-sm">
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {!balanced && rows.length > 0 && (
          <span className="text-xs text-red-600 font-semibold bg-red-50 px-3 py-1.5 rounded-full">
            Out of balance by ${fmt(Math.abs(totalDebit - totalCredit))}
          </span>
        )}
        {balanced && rows.length > 0 && (
          <span className="text-xs text-green-600 font-semibold bg-green-50 px-3 py-1.5 rounded-full">Balanced</span>
        )}
      </div>

      {isLoading && <div className="text-gray-400 text-sm p-8 text-center">Loading trial balance...</div>}

      {isError && (
        <div className="text-center py-12">
          <div className="text-gray-300 text-4xl mb-3">📊</div>
          <p className="text-gray-500 font-medium">Trial balance not available</p>
          <p className="text-sm text-gray-400 mt-1">Ensure gl-service is running to view account balances.</p>
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-300 text-4xl mb-3">📋</div>
          <p className="text-gray-500 font-medium">No data yet</p>
          <p className="text-sm text-gray-400 mt-1">No journal entries have been posted for this period. Post journal entries to see balances here.</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b bg-gray-50">
                <th className="px-4 py-3 font-medium">Account Code</th>
                <th className="px-4 py-3 font-medium">Account Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Debit</th>
                <th className="px-4 py-3 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={r.accountCode ?? i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs font-semibold text-brand">{r.accountCode ?? r.code ?? '—'}</td>
                  <td className="px-4 py-2">{r.accountName ?? r.name ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{r.accountType ?? r.type ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-mono">{(r.debit ?? r.totalDebit ?? 0) > 0 ? `$${fmt(r.debit ?? r.totalDebit ?? 0)}` : ''}</td>
                  <td className="px-4 py-2 text-right font-mono">{(r.credit ?? r.totalCredit ?? 0) > 0 ? `$${fmt(r.credit ?? r.totalCredit ?? 0)}` : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-bold bg-gray-50">
                <td className="px-4 py-3" colSpan={3}>Total</td>
                <td className="px-4 py-3 text-right font-mono">${fmt(totalDebit)}</td>
                <td className="px-4 py-3 text-right font-mono">${fmt(totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
