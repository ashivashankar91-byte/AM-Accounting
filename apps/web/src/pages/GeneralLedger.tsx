import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { glApi } from '../api/client';
import PageError from '../components/PageError';
import StatusBadge from '../components/StatusBadge';
import { SkeletonTable } from '../components/Skeleton';
import AIInsight from '../components/AIInsight';

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  AUTOMATE_DMS: { label: 'AutoMate DMS', color: 'bg-brand-light text-brand' },
  EXTERNAL_DMS: { label: 'External DMS', color: 'bg-purple-100 text-purple-700' },
  CONNECTOR_CDK: { label: 'CDK Drive', color: 'bg-indigo-100 text-indigo-700' },
  MANUAL: { label: 'Manual', color: 'bg-gray-100 text-gray-600' },
  PAYROLL: { label: 'Payroll', color: 'bg-amber-100 text-amber-700' },
};

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function GeneralLedger() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'accounts' | 'entries' | 'trial-balance'>('entries');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [docModal, setDocModal] = useState<any>(null);
  const { data: accounts, isLoading: loadingAccts, error: errorAccts, refetch: refetchAccts } = useQuery({ queryKey: ['gl-accounts'], queryFn: glApi.getAccounts, retry: false });
  const { data: entries, isLoading: loadingEntries, error: errorEntries, refetch: refetchEntries } = useQuery({ queryKey: ['gl-entries'], queryFn: () => glApi.getEntries(), retry: false });
  const isLoading = loadingAccts || loadingEntries;
  const error = errorAccts || errorEntries;

  const postMutation = useMutation({
    mutationFn: (id: string) => glApi.postEntry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gl-entries'] }),
  });

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (error) return <PageError error={error} serviceName="GL Service" port={3010} retry={() => { refetchAccts(); refetchEntries(); }} />;

  return (
    <div style={{ padding: 28 }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
        {(['entries', 'accounts', 'trial-balance'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 20px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
            background: 'none', borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
            color: tab === t ? 'var(--primary)' : 'var(--text-muted)', marginBottom: -2,
          }}>
            {t === 'trial-balance' ? 'Trial Balance' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'accounts' && (
        isLoading ? <SkeletonTable rows={8} cols={4} /> : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Chart of Accounts</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E5E7EB' }}>
                {['Code', 'Name', 'Type', 'Active'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(accounts ?? []).map((a: any) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #F1F5F9' }}
                  onMouseEnter={(ev) => ev.currentTarget.style.background = '#F8FAFC'}
                  onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                  <td style={{ padding: '12px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>{a.code}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>{a.name}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>{a.type}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>{a.isActive ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )
      )}

      {tab === 'entries' && (
        isLoading ? <SkeletonTable rows={8} cols={8} /> : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Journal Entries</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E5E7EB' }}>
                {['', 'Date', 'Ref #', 'Description', 'Accounts', 'Total Debit', 'Total Credit', 'Source', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: (h === 'Total Debit' || h === 'Total Credit') ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(entries ?? []).length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '48px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>No journal entries found</div>
                </td></tr>
              ) : (entries ?? []).map((e: any) => {
                const lines = e.lines ?? [];
                const totalDebit = lines.reduce((s: number, l: any) => s + (l.debit ?? 0), 0);
                const totalCredit = lines.reduce((s: number, l: any) => s + (l.credit ?? 0), 0);
                const accountCodes = lines.map((l: any) => l.accountCode).filter(Boolean);
                const uniqueAccounts = [...new Set(accountCodes)] as string[];
                const isOpen = expanded.has(e.id);
                const src = SOURCE_LABELS[e.source] ?? { label: e.source, color: 'bg-gray-100 text-gray-600' };
                const hasDmsSource = ['AUTOMATE_DMS', 'EXTERNAL_DMS', 'CONNECTOR_CDK'].includes(e.source);

                return (
                  <React.Fragment key={e.id}>
                    <tr style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer', background: isOpen ? '#EFF6FF' : '' }}
                      onClick={() => toggle(e.id)}
                      onMouseEnter={(ev) => { if (!isOpen) ev.currentTarget.style.background = '#F8FAFC'; }}
                      onMouseLeave={(ev) => { if (!isOpen) ev.currentTarget.style.background = ''; }}>
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12 }}>{isOpen ? '▼' : '▶'}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>{new Date(e.entryDate).toLocaleDateString()}</td>
                      <td style={{ padding: '12px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>{e.sourceRef || '-'}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13 }}>{e.description}</td>
                      <td style={{ padding: '12px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-muted)' }}>{uniqueAccounts.length > 0 ? uniqueAccounts.slice(0, 3).join(', ') + (uniqueAccounts.length > 3 ? ` +${uniqueAccounts.length - 3}` : '') : '-'}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: 'var(--debit-color)' }}>${fmt(totalDebit)}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: 'var(--credit-color)' }}>${fmt(totalCredit)}</td>
                      <td style={{ padding: '12px 16px' }}><StatusBadge status={e.source} /></td>
                      <td style={{ padding: '12px 16px' }}><StatusBadge status={e.status} /></td>
                      <td style={{ padding: '12px 16px' }} onClick={(ev) => ev.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {e.status === 'DRAFT' && <button onClick={() => postMutation.mutate(e.id)} style={{ fontSize: 12, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Post</button>}
                          {hasDmsSource && e.sourceRef && (
                            <button onClick={() => setDocModal(e)} style={{ fontSize: 12, color: '#6366F1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>View Source</button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${e.id}-detail`}>
                        <td colSpan={10} className="p-0">
                          <div className="bg-slate-50 border-l-4 border-blue-400 mx-2 mb-2 rounded">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-500 border-b border-gray-200">
                                  <th className="py-1.5 px-3 text-left">Acct #</th>
                                  <th className="py-1.5 px-3 text-left">Account Name</th>
                                  <th className="py-1.5 px-3 text-right">Debit</th>
                                  <th className="py-1.5 px-3 text-right">Credit</th>
                                  <th className="py-1.5 px-3 text-left">Memo</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((l: any) => (
                                  <tr key={l.id} className="border-b border-gray-100">
                                    <td className="py-1.5 px-3 font-mono font-semibold text-brand">{l.accountCode || '—'}</td>
                                    <td className="py-1.5 px-3">{l.accountName || '—'}</td>
                                    <td className="py-1.5 px-3 text-right font-mono">{l.debit > 0 ? `$${fmt(l.debit)}` : ''}</td>
                                    <td className="py-1.5 px-3 text-right font-mono">{l.credit > 0 ? `$${fmt(l.credit)}` : ''}</td>
                                    <td className="py-1.5 px-3 text-gray-500 italic">{l.memo || ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="font-semibold border-t-2 border-gray-300">
                                  <td className="py-1.5 px-3" colSpan={2}>Entry Total</td>
                                  <td className="py-1.5 px-3 text-right font-mono">${fmt(totalDebit)}</td>
                                  <td className="py-1.5 px-3 text-right font-mono">${fmt(totalCredit)}</td>
                                  <td className="py-1.5 px-3">{totalDebit.toFixed(2) === totalCredit.toFixed(2) ? <span className="text-green-600">✓ Balanced</span> : <span className="text-red-600">✗ Unbalanced</span>}</td>
                                </tr>
                              </tfoot>
                            </table>
                            {e.postedBy && <div className="px-3 py-1.5 text-xs text-gray-400 border-t border-gray-200">Posted by {e.postedBy} on {e.postedAt ? new Date(e.postedAt).toLocaleString() : '—'}</div>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        )
      )}

      {tab === 'trial-balance' && <TrialBalanceView />}

      {docModal && <SourceDocumentModal entry={docModal} onClose={() => setDocModal(null)} />}

      <AIInsight pageType="general-ledger" context="General Ledger" data={{ entries: entries?.slice(0, 20), accounts: accounts?.slice(0, 30) }} />
    </div>
  );
}

function SourceDocumentModal({ entry, onClose }: { entry: any; onClose: () => void }) {
  const lines = entry.lines ?? [];
  const totalDebit = lines.reduce((s: number, l: any) => s + (l.debit ?? 0), 0);
  const src = entry.source;
  const ref = entry.sourceRef || 'N/A';
  const isRO = ref.startsWith('RO');
  const isInvoice = entry.description?.includes('Invoice') || ref.startsWith('INV');
  const isDeal = entry.description?.includes('Deal') || ref.startsWith('D-');
  const isVehicleSale = entry.description?.includes('Vehicle Sale');
  const isWarranty = entry.description?.includes('Warranty');

  let docType = 'Transaction';
  if (isRO) docType = 'Repair Order';
  else if (isInvoice) docType = 'Invoice';
  else if (isDeal) docType = 'Deal Jacket';
  else if (isVehicleSale) docType = 'Vehicle Sale';
  else if (isWarranty) docType = 'Warranty Claim';

  const sourceSystem = src === 'AUTOMATE_DMS' ? 'AutoMate DMS 4.x' : src === 'CONNECTOR_CDK' ? 'CDK Drive 3.x' : src === 'EXTERNAL_DMS' ? 'External DMS' : src;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-[700px] max-h-[85vh] overflow-auto" onClick={(ev) => ev.stopPropagation()}>
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-6 py-4 rounded-t-lg flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-300">Source Document</div>
            <div className="text-lg font-bold">{docType} — {ref}</div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-2xl leading-none">&times;</button>
        </div>

        {/* Document Info Bar */}
        <div className="bg-slate-50 px-6 py-3 border-b flex items-center gap-6 text-sm">
          <div><span className="text-gray-400">Source:</span> <span className="font-medium">{sourceSystem}</span></div>
          <div><span className="text-gray-400">Date:</span> <span className="font-medium">{new Date(entry.entryDate).toLocaleDateString()}</span></div>
          <div><span className="text-gray-400">Status:</span> <span className={`font-medium ${entry.status === 'POSTED' ? 'text-green-600' : 'text-yellow-600'}`}>{entry.status}</span></div>
        </div>

        {/* Document Body — simulated source document */}
        <div className="px-6 py-4 space-y-4">
          {/* Header section */}
          <div className="border border-gray-200 rounded p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-xs text-gray-400 uppercase">Kunes Auto Group</div>
                <div className="font-bold text-lg">{docType}</div>
                <div className="text-sm text-gray-500 mt-1">{entry.description}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl font-bold text-slate-700">#{ref}</div>
                <div className="text-xs text-gray-400 mt-1">{new Date(entry.entryDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
              </div>
            </div>
          </div>

          {/* GL Distribution */}
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">GL Account Distribution</div>
            <table className="w-full text-sm border border-gray-200 rounded">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <th className="py-2 px-3 text-left">Account</th>
                  <th className="py-2 px-3 text-left">Description</th>
                  <th className="py-2 px-3 text-right">Debit</th>
                  <th className="py-2 px-3 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l: any) => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="py-2 px-3 font-mono font-semibold">{l.accountCode || '—'}</td>
                    <td className="py-2 px-3">{l.accountName || '—'}<br/><span className="text-xs text-gray-400">{l.memo}</span></td>
                    <td className="py-2 px-3 text-right font-mono">{l.debit > 0 ? `$${fmt(l.debit)}` : ''}</td>
                    <td className="py-2 px-3 text-right font-mono">{l.credit > 0 ? `$${fmt(l.credit)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 font-bold bg-gray-50">
                  <td className="py-2 px-3" colSpan={2}>Total</td>
                  <td className="py-2 px-3 text-right font-mono">${fmt(lines.reduce((s: number, l: any) => s + (l.debit ?? 0), 0))}</td>
                  <td className="py-2 px-3 text-right font-mono">${fmt(lines.reduce((s: number, l: any) => s + (l.credit ?? 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Source System Details */}
          <div className="border border-gray-200 rounded p-4 bg-brand-light/50">
            <div className="text-sm font-semibold text-gray-700 mb-2">Source System Details</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-400">System:</span> <span className="font-medium">{sourceSystem}</span></div>
              <div><span className="text-gray-400">Reference:</span> <span className="font-mono font-medium">{ref}</span></div>
              <div><span className="text-gray-400">Transaction Type:</span> <span className="font-medium">{docType}</span></div>
              <div><span className="text-gray-400">Amount:</span> <span className="font-mono font-bold">${fmt(totalDebit)}</span></div>
              {entry.postedBy && <div><span className="text-gray-400">Posted By:</span> <span className="font-medium">{entry.postedBy}</span></div>}
              {entry.postedAt && <div><span className="text-gray-400">Posted At:</span> <span className="font-medium">{new Date(entry.postedAt).toLocaleString()}</span></div>}
            </div>
            {src === 'AUTOMATE_DMS' && (
              <div className="mt-3 pt-3 border-t border-brand-border text-xs text-brand">
                <span className="font-medium">AutoMate DMS Integration:</span> This document was automatically imported from AutoMate DMS via the connector service. The original {docType.toLowerCase()} can be viewed in AutoMate under {isRO ? 'Service → Repair Orders' : isVehicleSale ? 'Sales → Deals' : 'Accounting → Transactions'} → {ref}.
              </div>
            )}
            {src === 'CONNECTOR_CDK' && (
              <div className="mt-3 pt-3 border-t border-indigo-200 text-xs text-indigo-600">
                <span className="font-medium">CDK Drive Integration:</span> This document was synced from CDK Drive via the connector adapter. Source reference: {ref || entry.description}.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-3 rounded-b-lg border-t flex justify-between items-center">
          <div className="text-xs text-gray-400">Entry ID: {entry.id}</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-100">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrialBalanceView() {
  const now = new Date();
  const [year] = useState(now.getFullYear());
  const [month] = useState(now.getMonth() + 1);
  const { data: tb } = useQuery({
    queryKey: ['trial-balance', year, month],
    queryFn: () => glApi.getTrialBalance(year, month),
    retry: false,
  });

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold mb-3">Trial Balance — {year}-{String(month).padStart(2, '0')}</h3>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-gray-500 border-b">
          <th className="pb-2">Account</th><th className="pb-2">Name</th><th className="pb-2 text-right">Debit</th><th className="pb-2 text-right">Credit</th>
        </tr></thead>
        <tbody>
          {(tb?.accounts ?? []).map((a: any, i: number) => (
            <tr key={i} className="border-b border-gray-50">
              <td className="py-2 font-mono">{a.accountCode}</td><td>{a.accountName}</td>
              <td className="text-right">{a.debit > 0 ? `$${a.debit.toFixed(2)}` : '-'}</td>
              <td className="text-right">{a.credit > 0 ? `$${a.credit.toFixed(2)}` : '-'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="font-bold border-t-2">
          <td className="pt-2" colSpan={2}>Totals</td>
          <td className="text-right pt-2">${(tb?.totalDebits ?? 0).toFixed(2)}</td>
          <td className="text-right pt-2">${(tb?.totalCredits ?? 0).toFixed(2)}</td>
        </tr></tfoot>
      </table>
    </div>
  );
}
