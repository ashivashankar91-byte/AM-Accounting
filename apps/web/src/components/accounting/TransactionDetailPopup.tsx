import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X, Printer, RotateCcw, SlidersHorizontal, MessageSquare, Loader2, AlertCircle } from 'lucide-react';
import { glApi } from '../../api/client';

export interface TransactionDetailPopupProps {
  isOpen: boolean;
  onClose: () => void;
  transactionId: string | null;
  highlightAccountId?: string;
}

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return { date, time };
};

export default function TransactionDetailPopup({
  isOpen,
  onClose,
  transactionId,
  highlightAccountId,
}: TransactionDetailPopupProps) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const { data: txn, isLoading, error } = useQuery<any>({
    queryKey: ['txn-detail', transactionId],
    queryFn: () => glApi.getEntries(`id=${transactionId}`).then((r: any) => Array.isArray(r) ? r[0] : r),
    enabled: isOpen && transactionId !== null,
    retry: false,
  });

  const reverseMutation = useMutation<any, Error, { type: 'ADJUSTMENT' | 'REVERSAL' }>({
    mutationFn: ({ type }) => glApi.reverseEntry(transactionId!, { type }),
    onSuccess: (_, vars) => {
      setActionSuccess(vars.type === 'REVERSAL' ? 'Reversal created successfully.' : 'Adjustment created successfully.');
      setActionError(null);
    },
    onError: (e) => {
      setActionError(e.message);
      setActionSuccess(null);
    },
  });

  if (!isOpen) return null;

  const lines: any[] = txn?.lines ?? txn?.entries ?? [];
  const postedAt = txn?.postedAt ?? txn?.createdAt ?? '';
  const { date: postedDate, time: postedTime } = postedAt ? fmtDateTime(postedAt) : { date: '—', time: '—' };
  const txnDate = txn?.entryDate ?? txn?.transactionDate ?? '';
  const formattedTxnDate = txnDate
    ? new Date(txnDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    : '—';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-5xl rounded shadow-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-brand text-white rounded-t">
          <span className="font-semibold text-sm tracking-wide">Transaction Detail</span>
          <button onClick={onClose} className="hover:bg-brand rounded p-0.5">
            <X size={16} />
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center flex-1 py-16">
            <Loader2 size={24} className="animate-spin text-brand" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-4 text-red-700">
            <AlertCircle size={16} />
            <span className="text-sm">{(error as Error).message}</span>
          </div>
        )}

        {txn && (
          <>
            {/* Transaction metadata */}
            <div className="bg-brand-light border-b border-blue-100 px-4 py-3 grid grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Transaction Date</p>
                <p className="text-brand text-lg font-semibold font-mono">{formattedTxnDate}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Source</p>
                <p className="text-sm font-mono font-semibold text-gray-800">
                  {txn.sourceCode ?? txn.source ?? '—'}
                  {(txn.sourceName || txn.source?.name) && (
                    <span className="font-sans font-normal text-gray-500 ml-1">
                      — {txn.sourceName ?? txn.source?.name}
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Ref No.</p>
                <p className="text-sm font-mono font-semibold text-gray-800">
                  {txn.referenceNumber ?? txn.refNo ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Posted By</p>
                <p className="text-sm text-gray-800">
                  {txn.postedBy ?? txn.createdBy ?? '—'}
                  <span className="text-gray-500 text-xs ml-1">{postedDate} {postedTime}</span>
                </p>
              </div>
            </div>

            {/* Lines table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                    <th className="text-left px-2 py-1.5 border-b border-gray-200 font-medium w-20">Ctrl#</th>
                    <th className="text-left px-2 py-1.5 border-b border-gray-200 font-medium w-16">Acct</th>
                    <th className="text-left px-2 py-1.5 border-b border-gray-200 font-medium w-36">Acct Name</th>
                    <th className="text-left px-2 py-1.5 border-b border-gray-200 font-medium">Ctrl. Description</th>
                    <th className="text-right px-2 py-1.5 border-b border-gray-200 font-medium w-28">Amount</th>
                    <th className="text-left px-2 py-1.5 border-b border-gray-200 font-medium w-24">App#/Cost</th>
                    <th className="text-left px-2 py-1.5 border-b border-gray-200 font-medium">Comments</th>
                    <th className="text-center px-2 py-1.5 border-b border-gray-200 font-medium w-10">Adj</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-6 text-gray-400">No line items.</td>
                    </tr>
                  )}
                  {lines.map((line: any, i: number) => {
                    const acct = line.accountCode ?? line.acct ?? line.account ?? '';
                    const isHighlighted = highlightAccountId && acct === highlightAccountId;
                    const amount: number = line.amount ?? (line.debit ?? 0) - (line.credit ?? 0);
                    const isNeg = amount < 0;
                    return (
                      <tr
                        key={line.id ?? i}
                        className={`border-b border-gray-100 h-9 ${isHighlighted ? 'bg-yellow-100' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                      >
                        <td className={`px-2 font-mono text-xs ${isHighlighted ? 'font-semibold' : ''}`}>
                          {line.controlNum ?? line.ctrlNum ?? ''}
                        </td>
                        <td className={`px-2 font-mono text-xs ${isHighlighted ? 'font-semibold' : ''}`}>
                          {acct}
                        </td>
                        <td className={`px-2 text-xs ${isHighlighted ? 'font-semibold' : ''}`}>
                          {line.accountName ?? line.acctName ?? ''}
                        </td>
                        <td className={`px-2 text-xs ${isHighlighted ? 'font-semibold' : ''}`}>
                          {line.description ?? line.ctrlDescription ?? ''}
                        </td>
                        <td className={`px-2 font-mono text-xs text-right tabular-nums ${isHighlighted ? 'font-semibold' : ''} ${isNeg ? 'text-red-600' : 'text-gray-800'}`}>
                          {isNeg ? `(${fmt(Math.abs(amount))})` : fmt(amount)}
                        </td>
                        <td className={`px-2 font-mono text-xs ${isHighlighted ? 'font-semibold' : ''}`}>
                          {line.appNum ?? line.costCenter ?? ''}
                        </td>
                        <td className={`px-2 text-xs ${isHighlighted ? 'font-semibold' : ''}`}>
                          {line.comments ?? line.comment ?? ''}
                        </td>
                        <td className="px-2 text-center text-xs">
                          {line.isAdjustment || line.adj ? (
                            <span className="inline-block w-3 h-3 bg-yellow-400 rounded-full" title="Adjustment" />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Inline note textarea */}
            {noteOpen && (
              <div className="border-t border-gray-200 px-4 py-2 bg-gray-50">
                <p className="text-xs font-medium text-gray-600 mb-1">Add Note</p>
                <textarea
                  className="w-full h-20 text-xs border border-gray-300 rounded px-2 py-1 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-brand"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Enter note…"
                />
                <div className="flex gap-2 mt-1">
                  <button
                    className="h-7 px-3 text-xs bg-brand text-white rounded hover:bg-brand-hover"
                    onClick={() => { setNoteOpen(false); setNoteText(''); }}
                  >
                    Save Note
                  </button>
                  <button
                    className="h-7 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100"
                    onClick={() => { setNoteOpen(false); setNoteText(''); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Action feedback */}
            {(actionError || actionSuccess) && (
              <div className={`px-4 py-2 text-xs ${actionError ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {actionError ?? actionSuccess}
              </div>
            )}

            {/* Button bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-200 bg-gray-50 rounded-b">
              <button
                className="h-8 px-3 text-xs flex items-center gap-1.5 border border-gray-300 rounded hover:bg-gray-100"
                onClick={() => window.print()}
              >
                <Printer size={13} />
                Print
              </button>
              <button
                className="h-8 px-3 text-xs flex items-center gap-1.5 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                disabled={reverseMutation.isPending}
                onClick={() => reverseMutation.mutate({ type: 'ADJUSTMENT' })}
              >
                {reverseMutation.isPending && reverseMutation.variables?.type === 'ADJUSTMENT' ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <SlidersHorizontal size={13} />
                )}
                Adjustment
              </button>
              <button
                className="h-8 px-3 text-xs flex items-center gap-1.5 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                disabled={reverseMutation.isPending}
                onClick={() => reverseMutation.mutate({ type: 'REVERSAL' })}
              >
                {reverseMutation.isPending && reverseMutation.variables?.type === 'REVERSAL' ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RotateCcw size={13} />
                )}
                Reverse
              </button>
              <button
                className="h-8 px-3 text-xs flex items-center gap-1.5 border border-gray-300 rounded hover:bg-gray-100"
                onClick={() => setNoteOpen((v) => !v)}
              >
                <MessageSquare size={13} />
                Notes
              </button>
              <div className="flex-1" />
              <button
                className="h-8 px-4 text-xs bg-gray-200 rounded hover:bg-gray-300 font-medium"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
