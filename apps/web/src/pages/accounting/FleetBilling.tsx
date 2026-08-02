/**
 * AMACC S049 — Fleet Billing
 * Parent/unit link management + consolidated invoice creation, list, detail,
 * and parent statement view.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Link, FileText, Building2 } from 'lucide-react';
import { fleetBillingApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import {
  Btn, Badge, PageHeader, MoneyCell, EmptyState,
} from '../../components/ui';
import DataTable, { Column } from '../../components/DataTable';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UnitLink {
  id: string;
  parentCustomerId: string;
  childCustomerId: string;
  billingGroupName?: string;
  createdAt?: string;
}

interface ConsolidatedInvoice {
  id: string;
  parentCustomerId: string;
  invoiceDate: string;
  totalAmount?: number | string;
  status?: string;
  items?: Array<{ childCustomerId: string; amount: number | string; description?: string }>;
  createdAt?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

type ActiveView = 'links' | 'invoices' | 'statement';

export default function FleetBilling() {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<ActiveView>('links');

  // Link management state
  const [parentIdInput, setParentIdInput] = useState('');
  const [submittedParentId, setSubmittedParentId] = useState('');
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkForm, setLinkForm] = useState({ parentCustomerId: '', childCustomerId: '', billingGroupName: '' });
  const [linkError, setLinkError] = useState<string | null>(null);
  const [unlinkPending, setUnlinkPending] = useState<string | null>(null);

  // Consolidated invoice state
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    parentCustomerId: '',
    invoiceDate: '',
    items: [{ childCustomerId: '', amount: '', description: '' }],
  });
  const [invoiceFormError, setInvoiceFormError] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Statement state
  const [statementParentId, setStatementParentId] = useState('');
  const [submittedStatementParentId, setSubmittedStatementParentId] = useState('');

  // ── Queries ──────────────────────────────────────────────────────────────

  const {
    data: unitLinks,
    isLoading: linksLoading,
    isError: linksError,
    error: linksErrorObj,
    refetch: refetchLinks,
  } = useQuery<UnitLink[]>({
    queryKey: ['fleet-unit-links', submittedParentId],
    queryFn: () => fleetBillingApi.getParentUnits(submittedParentId),
    enabled: !!submittedParentId,
    retry: false,
  });

  const {
    data: invoices,
    isLoading: invoicesLoading,
    isError: invoicesError,
    error: invoicesErrorObj,
    refetch: refetchInvoices,
  } = useQuery<ConsolidatedInvoice[]>({
    queryKey: ['fleet-consolidated-invoices'],
    queryFn: () => fleetBillingApi.listConsolidatedInvoices(),
    enabled: activeView === 'invoices',
    retry: false,
  });

  const {
    data: invoiceDetail,
    isLoading: invoiceDetailLoading,
    isError: invoiceDetailIsError,
    error: invoiceDetailError,
  } = useQuery<ConsolidatedInvoice>({
    queryKey: ['fleet-invoice-detail', selectedInvoiceId],
    queryFn: () => fleetBillingApi.getConsolidatedInvoice(selectedInvoiceId!),
    enabled: !!selectedInvoiceId,
    retry: false,
  });

  const {
    data: statement,
    isLoading: statementLoading,
    isError: statementIsError,
    error: statementError,
    refetch: refetchStatement,
  } = useQuery<any>({
    queryKey: ['fleet-parent-statement', submittedStatementParentId],
    queryFn: () => fleetBillingApi.getParentStatement(submittedStatementParentId),
    enabled: !!submittedStatementParentId && activeView === 'statement',
    retry: false,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const linkMut = useMutation({
    mutationFn: () =>
      fleetBillingApi.linkUnit({
        parentCustomerId: linkForm.parentCustomerId,
        childCustomerId: linkForm.childCustomerId,
        billingGroupName: linkForm.billingGroupName || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-unit-links'] });
      setShowLinkForm(false);
      setLinkForm({ parentCustomerId: '', childCustomerId: '', billingGroupName: '' });
      if (linkForm.parentCustomerId === submittedParentId || !submittedParentId) {
        setSubmittedParentId(linkForm.parentCustomerId);
        setParentIdInput(linkForm.parentCustomerId);
      }
    },
    onError: (err: any) => setLinkError(err?.body?.message || err.message || 'Link failed'),
  });

  const unlinkMut = useMutation({
    mutationFn: (id: string) => fleetBillingApi.unlinkUnit(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-unit-links'] });
      setUnlinkPending(null);
    },
    onError: (err: any) => {
      setUnlinkPending(null);
      alert(err?.body?.message || err.message || 'Unlink failed');
    },
  });

  const createInvoiceMut = useMutation({
    mutationFn: () =>
      fleetBillingApi.createConsolidatedInvoice({
        parentCustomerId: invoiceForm.parentCustomerId,
        invoiceDate: invoiceForm.invoiceDate,
        items: invoiceForm.items.map(it => ({
          childCustomerId: it.childCustomerId,
          amount: parseFloat(it.amount),
          description: it.description || undefined,
        })),
      }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['fleet-consolidated-invoices'] });
      setShowInvoiceForm(false);
      setInvoiceForm({ parentCustomerId: '', invoiceDate: '', items: [{ childCustomerId: '', amount: '', description: '' }] });
      setSelectedInvoiceId(res.id);
    },
    onError: (err: any) => setInvoiceFormError(err?.body?.message || err.message || 'Invoice creation failed'),
  });

  const isUnauthorized =
    (linksErrorObj as any)?.status === 401 || (linksErrorObj as any)?.status === 403 ||
    (invoicesErrorObj as any)?.status === 401 || (invoicesErrorObj as any)?.status === 403;

  const invoiceColumns: Column<ConsolidatedInvoice>[] = [
    { key: 'parentCustomerId', label: 'Parent Customer', mono: true },
    { key: 'invoiceDate', label: 'Invoice Date', render: (r) => r.invoiceDate?.slice(0, 10) ?? '—' },
    { key: 'totalAmount', label: 'Total', align: 'right', render: (r) => <MoneyCell value={r.totalAmount ?? 0} /> },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <Badge variant={r.status === 'POSTED' ? 'success' : r.status === 'VOIDED' ? 'danger' : 'neutral'}>
          {r.status ?? '—'}
        </Badge>
      ),
    },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="Fleet Billing"
        subtitle="Manage parent/unit links and consolidated invoices"
      />

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {(['links', 'invoices', 'statement'] as ActiveView[]).map((v) => (
          <button
            key={v}
            data-testid={`fleet-tab-${v}`}
            onClick={() => setActiveView(v)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${activeView === v ? 'text-brand border-b-2 border-brand bg-brand-light' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {v === 'links' ? 'Unit Links' : v === 'invoices' ? 'Consolidated Invoices' : 'Parent Statement'}
          </button>
        ))}
      </div>

      {isUnauthorized && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          You do not have permission to manage fleet billing.
        </div>
      )}

      {/* ── UNIT LINKS TAB ── */}
      {activeView === 'links' && (
        <div className="space-y-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Parent Customer ID</label>
              <input
                className="w-full border rounded px-3 py-2 text-sm font-mono"
                placeholder="cust-parent-uuid"
                data-testid="fleet-parent-id-input"
                value={parentIdInput}
                onChange={e => setParentIdInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setSubmittedParentId(parentIdInput.trim()); }}
              />
            </div>
            <Btn variant="secondary" onClick={() => setSubmittedParentId(parentIdInput.trim())} data-testid="fleet-load-units">Load Units</Btn>
            <Btn icon={<Plus size={14} />} onClick={() => { setShowLinkForm(p => !p); setLinkError(null); }} data-testid="fleet-link-unit-open">Link Unit</Btn>
          </div>

          {showLinkForm && (
            <form
              onSubmit={(e) => { e.preventDefault(); setLinkError(null); linkMut.mutate(); }}
              className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3"
            >
              <h3 className="text-sm font-semibold text-slate-700">Link New Unit</h3>
              {linkError && <div className="text-sm text-red-600">{linkError}</div>}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Parent Customer ID <span className="text-red-500">*</span></label>
                  <input data-testid="fleet-link-parent-id" className="w-full border rounded px-3 py-2 text-sm font-mono" value={linkForm.parentCustomerId} onChange={e => setLinkForm(p => ({ ...p, parentCustomerId: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Child Customer ID <span className="text-red-500">*</span></label>
                  <input data-testid="fleet-link-child-id" className="w-full border rounded px-3 py-2 text-sm font-mono" value={linkForm.childCustomerId} onChange={e => setLinkForm(p => ({ ...p, childCustomerId: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Billing Group Name</label>
                  <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Fleet A" value={linkForm.billingGroupName} onChange={e => setLinkForm(p => ({ ...p, billingGroupName: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2">
                <Btn type="submit" size="sm" loading={linkMut.isPending} data-testid="fleet-link-save">Save Link</Btn>
                <Btn variant="secondary" size="sm" type="button" onClick={() => setShowLinkForm(false)}>Cancel</Btn>
              </div>
            </form>
          )}

          {linksLoading && <PageLoader page="unit links" service="apar-service" />}
          {linksError && !isUnauthorized && <PageError error={linksErrorObj as Error} retry={refetchLinks} />}

          {!linksLoading && unitLinks && (
            unitLinks.length === 0 ? (
              <EmptyState icon={<Link size={20} />} title="No unit links for this parent" description="Use 'Link Unit' to add child customers." />
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b text-xs font-semibold text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Child Customer ID</th>
                      <th className="px-4 py-2 text-left">Billing Group</th>
                      <th className="px-4 py-2 text-left">Linked</th>
                      <th className="px-4 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unitLinks.map((link) => (
                      <tr key={link.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-mono text-xs">{link.childCustomerId}</td>
                        <td className="px-4 py-2.5">{link.billingGroupName ?? '—'}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">{link.createdAt ? new Date(link.createdAt).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-2.5">
                          {unlinkPending === link.id ? (
                            <div className="flex gap-2 items-center">
                              <span className="text-xs text-red-600">Confirm unlink?</span>
                              <Btn size="sm" variant="danger" loading={unlinkMut.isPending} onClick={() => unlinkMut.mutate(link.id)} data-testid={`fleet-unlink-confirm-${link.id}`}>Yes, Unlink</Btn>
                              <Btn size="sm" variant="ghost" onClick={() => setUnlinkPending(null)}>Cancel</Btn>
                            </div>
                          ) : (
                            <Btn size="sm" variant="ghost" onClick={() => setUnlinkPending(link.id)} data-testid={`fleet-unlink-open-${link.id}`}>Unlink</Btn>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {!submittedParentId && (
            <EmptyState icon={<Building2 size={20} />} title="Enter a parent customer ID" description="Type a parent customer ID above and click Load Units." />
          )}
        </div>
      )}

      {/* ── CONSOLIDATED INVOICES TAB ── */}
      {activeView === 'invoices' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Btn icon={<Plus size={14} />} onClick={() => { setShowInvoiceForm(p => !p); setInvoiceFormError(null); }} data-testid="fleet-new-invoice-open">New Invoice</Btn>
          </div>

          {showInvoiceForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setInvoiceFormError(null);
                const hasInvalidItems = invoiceForm.items.some(it => !it.childCustomerId.trim() || !it.amount || isNaN(parseFloat(it.amount)));
                if (hasInvalidItems) { setInvoiceFormError('All line items need a child customer ID and valid amount.'); return; }
                createInvoiceMut.mutate();
              }}
              className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3"
            >
              <h3 className="text-sm font-semibold text-slate-700">New Consolidated Invoice</h3>
              {invoiceFormError && <div className="text-sm text-red-600">{invoiceFormError}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Parent Customer ID <span className="text-red-500">*</span></label>
                  <input data-testid="fleet-invoice-parent-id" className="w-full border rounded px-3 py-2 text-sm font-mono" value={invoiceForm.parentCustomerId} onChange={e => setInvoiceForm(p => ({ ...p, parentCustomerId: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Invoice Date <span className="text-red-500">*</span></label>
                  <input data-testid="fleet-invoice-date" type="date" className="w-full border rounded px-3 py-2 text-sm" value={invoiceForm.invoiceDate} onChange={e => setInvoiceForm(p => ({ ...p, invoiceDate: e.target.value }))} required />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-600">Line Items <span className="text-red-500">*</span></label>
                  <Btn size="sm" variant="ghost" type="button" onClick={() => setInvoiceForm(p => ({ ...p, items: [...p.items, { childCustomerId: '', amount: '', description: '' }] }))}>+ Add Line</Btn>
                </div>
                {invoiceForm.items.map((it, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-center">
                    <input data-testid={`fleet-invoice-item-child-${idx}`} className="flex-1 border rounded px-2 py-1.5 text-xs font-mono" placeholder="Child Customer ID" value={it.childCustomerId} onChange={e => setInvoiceForm(p => { const items = [...p.items]; items[idx] = { ...items[idx], childCustomerId: e.target.value }; return { ...p, items }; })} />
                    <input data-testid={`fleet-invoice-item-amount-${idx}`} type="number" step="0.01" min="0.01" className="w-28 border rounded px-2 py-1.5 text-xs font-mono" placeholder="Amount" value={it.amount} onChange={e => setInvoiceForm(p => { const items = [...p.items]; items[idx] = { ...items[idx], amount: e.target.value }; return { ...p, items }; })} />
                    <input className="w-40 border rounded px-2 py-1.5 text-xs" placeholder="Description" value={it.description} onChange={e => setInvoiceForm(p => { const items = [...p.items]; items[idx] = { ...items[idx], description: e.target.value }; return { ...p, items }; })} />
                    {invoiceForm.items.length > 1 && (
                      <button type="button" onClick={() => setInvoiceForm(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Btn type="submit" size="sm" loading={createInvoiceMut.isPending} data-testid="fleet-invoice-create">Create Invoice</Btn>
                <Btn variant="secondary" size="sm" type="button" onClick={() => setShowInvoiceForm(false)}>Cancel</Btn>
              </div>
            </form>
          )}

          {invoicesLoading && <PageLoader page="consolidated invoices" service="apar-service" />}
          {invoicesError && !isUnauthorized && <PageError error={invoicesErrorObj as Error} retry={refetchInvoices} />}
          {!invoicesLoading && !invoicesError && invoices && (
            invoices.length === 0 ? (
              <EmptyState icon={<FileText size={20} />} title="No consolidated invoices" description="Create the first consolidated invoice." />
            ) : (
              <DataTable columns={invoiceColumns} data={invoices} rowTestIdPrefix="fleet-invoice-row" onRowClick={(r) => setSelectedInvoiceId(r.id)} />
            )
          )}

          {/* Invoice detail panel */}
          {selectedInvoiceId && (
            <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-slate-200 flex flex-col z-50">
              <div className="flex items-center justify-between px-6 py-4 border-b">
                <h2 className="text-base font-bold text-slate-900">Invoice Detail</h2>
                <button onClick={() => setSelectedInvoiceId(null)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {invoiceDetailLoading && <PageLoader page="invoice detail" />}
                {invoiceDetailIsError && <PageError error={invoiceDetailError as Error} />}
                {invoiceDetail && !invoiceDetailLoading && (
                  <div className="space-y-4 text-sm">
                    <dl className="grid grid-cols-2 gap-3">
                      <div><dt className="text-xs text-slate-500">Parent Customer</dt><dd className="font-mono">{invoiceDetail.parentCustomerId}</dd></div>
                      <div><dt className="text-xs text-slate-500">Invoice Date</dt><dd>{invoiceDetail.invoiceDate?.slice(0, 10)}</dd></div>
                      <div><dt className="text-xs text-slate-500">Total</dt><dd className="font-mono font-bold" data-testid="fleet-invoice-detail-total"><MoneyCell value={invoiceDetail.totalAmount ?? 0} /></dd></div>
                      <div><dt className="text-xs text-slate-500">Status</dt><dd><Badge variant={invoiceDetail.status === 'POSTED' ? 'success' : invoiceDetail.status === 'VOIDED' ? 'danger' : 'neutral'}>{invoiceDetail.status ?? '—'}</Badge></dd></div>
                    </dl>
                    {invoiceDetail.items && invoiceDetail.items.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Line Items</h3>
                        <table className="w-full text-xs">
                          <thead><tr className="border-b text-slate-500"><th className="py-1 text-left">Child Customer</th><th className="py-1 text-left">Description</th><th className="py-1 text-right">Amount</th></tr></thead>
                          <tbody>
                            {invoiceDetail.items.map((it, i) => (
                              <tr key={i} className="border-b border-slate-50">
                                <td className="py-1.5 font-mono">{it.childCustomerId}</td>
                                <td className="py-1.5 text-slate-500">{it.description ?? '—'}</td>
                                <td className="py-1.5 text-right font-mono"><MoneyCell value={it.amount} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PARENT STATEMENT TAB ── */}
      {activeView === 'statement' && (
        <div className="space-y-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Parent Customer ID</label>
              <input
                className="w-full border rounded px-3 py-2 text-sm font-mono"
                placeholder="cust-parent-uuid"
                data-testid="fleet-statement-parent-id"
                value={statementParentId}
                onChange={e => setStatementParentId(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setSubmittedStatementParentId(statementParentId.trim()); }}
              />
            </div>
            <Btn variant="secondary" onClick={() => setSubmittedStatementParentId(statementParentId.trim())} data-testid="fleet-load-statement">Load Statement</Btn>
          </div>

          {statementLoading && <PageLoader page="parent statement" service="apar-service" />}
          {statementIsError && <PageError error={statementError as Error} retry={refetchStatement} />}

          {!statementLoading && statement && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Parent Statement</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Customer: {submittedStatementParentId}</p>
                </div>
                {statement.asOfDate && <span className="text-xs text-slate-400">As of {statement.asOfDate?.slice(0, 10)}</span>}
              </div>
              <dl className="grid grid-cols-3 gap-4">
                {statement.totalBilled != null && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                    <dt className="text-xs text-slate-500">Total Billed</dt>
                    <dd className="text-lg font-bold font-mono text-slate-900"><MoneyCell value={statement.totalBilled} /></dd>
                  </div>
                )}
                {statement.totalPaid != null && (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                    <dt className="text-xs text-slate-500">Total Paid</dt>
                    <dd className="text-lg font-bold font-mono text-emerald-700"><MoneyCell value={statement.totalPaid} /></dd>
                  </div>
                )}
                {statement.balance != null && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                    <dt className="text-xs text-slate-500">Balance Due</dt>
                    <dd className="text-lg font-bold font-mono text-amber-700" data-testid="fleet-statement-balance"><MoneyCell value={statement.balance} /></dd>
                  </div>
                )}
              </dl>
              {statement.lines && statement.lines.length > 0 && (
                <table className="w-full text-xs">
                  <thead><tr className="border-b text-slate-500"><th className="py-1 text-left">Date</th><th className="py-1 text-left">Description</th><th className="py-1 text-right">Amount</th><th className="py-1 text-right">Balance</th></tr></thead>
                  <tbody>
                    {statement.lines.map((l: any, i: number) => (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="py-1.5">{l.date?.slice(0, 10) ?? '—'}</td>
                        <td className="py-1.5 text-slate-600">{l.description ?? '—'}</td>
                        <td className="py-1.5 text-right font-mono"><MoneyCell value={l.amount} /></td>
                        <td className="py-1.5 text-right font-mono"><MoneyCell value={l.balance} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {!submittedStatementParentId && (
            <EmptyState icon={<Building2 size={20} />} title="Enter a parent customer ID" description="Type a parent customer ID above and click Load Statement." />
          )}
        </div>
      )}
    </div>
  );
}
