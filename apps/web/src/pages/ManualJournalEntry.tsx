import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { glApi } from '../api/client';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Line {
  account: string;
  description: string;
  debit: string;
  credit: string;
}

const emptyLine = (): Line => ({ account: '', description: '', debit: '', credit: '' });

export default function ManualJournalEntry() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('MANUAL');
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [submitted, setSubmitted] = useState(false);

  const { data: accounts } = useQuery({ queryKey: ['gl-accounts'], queryFn: glApi.getAccounts, retry: false });

  const addLine = () => setLines([...lines, emptyLine()]);
  const removeLine = (i: number) => { if (lines.length > 2) setLines(lines.filter((_, idx) => idx !== i)); };
  const updateLine = (i: number, field: keyof Line, val: string) => {
    const updated = [...lines];
    updated[i] = { ...updated[i], [field]: val };
    setLines(updated);
  };

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005;
  const hasLines = lines.some(l => l.account && (Number(l.debit) || Number(l.credit)));

  const createMut = useMutation({
    mutationFn: () => glApi.createEntry({
      entryDate: date,
      source,
      description,
      lines: lines.filter(l => l.account).map(l => ({
        accountCode: l.account,
        debit: l.debit ? Math.round(Number(l.debit) * 100) : 0,
        credit: l.credit ? Math.round(Number(l.credit) * 100) : 0,
        description: l.description,
      })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gl-entries'] });
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setDescription('');
        setLines([emptyLine(), emptyLine()]);
      }, 3000);
    },
  });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Manual Journal Entry</h1>
        <p className="text-sm text-gray-500 mt-0.5">Create and submit journal entries to the General Ledger. Source: GL Service.</p>
      </div>

      {submitted && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm font-medium">
          Journal entry created successfully as DRAFT. Go to Transactions to post.
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        {/* Header Fields */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Entry Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
            <select value={source} onChange={e => setSource(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
              <option value="MANUAL">Manual (GJ)</option>
              <option value="ADJUSTING">Adjusting Entry</option>
              <option value="REVERSING">Reversing Entry</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Describe this journal entry..."
              className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
        </div>

        {/* Journal Lines */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm text-gray-700">Journal Lines</h3>
            <button onClick={addLine} className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200">+ Add Line</button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2 w-10">#</th>
                <th className="pb-2">Account</th>
                <th className="pb-2">Description</th>
                <th className="pb-2 text-right w-36">Debit</th>
                <th className="pb-2 text-right w-36">Credit</th>
                <th className="pb-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 text-gray-400 text-xs">{i + 1}</td>
                  <td className="py-2 pr-2">
                    <select value={line.account} onChange={e => updateLine(i, 'account', e.target.value)}
                      className="w-full border rounded px-2 py-1.5 text-sm">
                      <option value="">Select account...</option>
                      {(accounts ?? []).map((a: any) => (
                        <option key={a.id} value={a.code}>{a.code} — {a.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <input value={line.description} onChange={e => updateLine(i, 'description', e.target.value)}
                      placeholder="Line memo" className="w-full border rounded px-2 py-1.5 text-sm" />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" step="0.01" min="0" value={line.debit} onChange={e => updateLine(i, 'debit', e.target.value)}
                      placeholder="0.00" className="w-full border rounded px-2 py-1.5 text-sm text-right font-mono" />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" step="0.01" min="0" value={line.credit} onChange={e => updateLine(i, 'credit', e.target.value)}
                      placeholder="0.00" className="w-full border rounded px-2 py-1.5 text-sm text-right font-mono" />
                  </td>
                  <td className="py-2">
                    {lines.length > 2 && (
                      <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-bold">
                <td colSpan={3} className="py-3 text-right pr-4">Totals:</td>
                <td className="py-3 text-right font-mono pr-2">${fmt(totalDebit)}</td>
                <td className="py-3 text-right font-mono pr-2">${fmt(totalCredit)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Balance indicator + Submit */}
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${balanced ? 'text-green-600' : 'text-red-600'}`}>
              <span className={`w-2.5 h-2.5 rounded-full ${balanced ? 'bg-green-500' : 'bg-red-500'}`} />
              {balanced ? 'Balanced' : `Out of balance: $${fmt(Math.abs(totalDebit - totalCredit))}`}
            </span>
            {!balanced && <span className="text-xs text-gray-400">Debits must equal credits to submit.</span>}
          </div>
          <button
            onClick={() => createMut.mutate()}
            disabled={!balanced || !hasLines || !description || !date || createMut.isPending}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {createMut.isPending ? 'Submitting...' : 'Create Journal Entry (DRAFT)'}
          </button>
        </div>

        {createMut.isError && (
          <div className="bg-red-50 text-red-700 p-3 rounded text-sm">
            Failed to create entry: {(createMut.error as Error)?.message ?? 'Unknown error'}
          </div>
        )}
      </div>
    </div>
  );
}
