import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, ShieldX, Plus, RefreshCw, History, FileText, Ban } from 'lucide-react';
import { aparApi } from '../../api/client';

// AMACC-CH04 S038 — Vendor Insurance Certificate Management.
//
// Embedded inside VendorMaintenance.tsx's "Insurance" section tab. Reuses
// the parent page's real API client (aparApi) and Golden R0 styling
// conventions (bg-white rounded-lg shadow cards, brand button colors).
//
// S036B BOUNDARY: this UI shows only the raw certificate facts the S038
// API exposes (provider, dates, computed expirationStatus) — there is no
// "verified" / "compliance" indicator here. That belongs to a future S036B
// adapter reading getVendorInsuranceSummary().

const INSURANCE_TYPES = ['GENERAL_LIABILITY', 'AUTO_LIABILITY', 'WORKERS_COMP', 'UMBRELLA', 'PROPERTY', 'OTHER'] as const;

interface CertForm {
  certificateNumber: string;
  insuranceProvider: string;
  insuranceType: string;
  effectiveDate: string;
  expirationDate: string;
  coverageAmount: string;
  coverageDescription: string;
  documentFileName: string;
  notes: string;
}

const emptyCertForm = (): CertForm => ({
  certificateNumber: '',
  insuranceProvider: '',
  insuranceType: 'GENERAL_LIABILITY',
  effectiveDate: '',
  expirationDate: '',
  coverageAmount: '',
  coverageDescription: '',
  documentFileName: '',
  notes: '',
});

function certToPayload(f: CertForm) {
  return {
    certificateNumber: f.certificateNumber.trim(),
    insuranceProvider: f.insuranceProvider.trim(),
    insuranceType: f.insuranceType,
    effectiveDate: f.effectiveDate,
    expirationDate: f.expirationDate,
    coverageAmount: f.coverageAmount ? Number(f.coverageAmount) : undefined,
    coverageDescription: f.coverageDescription.trim() || undefined,
    documentFileName: f.documentFileName.trim() || undefined,
    notes: f.notes.trim() || undefined,
  };
}

function ExpirationBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: any; label: string }> = {
    CURRENT: { cls: 'bg-green-100 text-green-700', icon: ShieldCheck, label: 'Current' },
    EXPIRING_SOON: { cls: 'bg-amber-100 text-amber-700', icon: ShieldAlert, label: 'Expiring Soon' },
    EXPIRED: { cls: 'bg-red-100 text-red-700', icon: ShieldX, label: 'Expired' },
  };
  const cfg = map[status] ?? { cls: 'bg-gray-100 text-gray-600', icon: ShieldCheck, label: status };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      <Icon className="w-3 h-3" /> {cfg.label}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-blue-100 text-blue-700',
    SUPERSEDED: 'bg-gray-200 text-gray-600',
    REVOKED: 'bg-red-100 text-red-700',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>{status}</span>;
}

export default function VendorInsuranceCertificates({ vendorId }: { vendorId: string }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [expirationFilter, setExpirationFilter] = useState<'all' | 'expired' | 'expiring'>('all');
  const [withinDays, setWithinDays] = useState('30');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CertForm>(emptyCertForm());
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [renewForm, setRenewForm] = useState<CertForm>(emptyCertForm());
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  const queryParams = new URLSearchParams();
  queryParams.set('scope', scope);
  if (expirationFilter !== 'all') {
    queryParams.set('expirationFilter', expirationFilter);
    if (expirationFilter === 'expiring') queryParams.set('withinDays', withinDays || '30');
  }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['vendor-insurance-certificates', vendorId, scope, expirationFilter, withinDays],
    queryFn: () => aparApi.getVendorInsuranceCertificates(vendorId, queryParams.toString()),
    enabled: !!vendorId,
    retry: false,
  });
  const certificates: any[] = (data as any)?.items ?? [];

  const { data: auditEvents, isLoading: auditLoading } = useQuery({
    queryKey: ['insurance-certificate-audit', historyId],
    queryFn: () => aparApi.getInsuranceCertificateAuditEvents(historyId!),
    enabled: !!historyId,
    retry: false,
  });

  function handleError(err: any) {
    if (err?.status === 403 || err?.body?.error === 'FORBIDDEN') {
      setUnauthorized(err?.body?.message || 'You do not have permission to perform this action.');
      return;
    }
    setFormError(err?.body?.message || err?.body?.error || err.message || 'Request failed');
  }

  const createMut = useMutation({
    mutationFn: (payload: any) => aparApi.createInsuranceCertificate(vendorId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-insurance-certificates', vendorId] });
      setShowCreate(false);
      setCreateForm(emptyCertForm());
      setFormError(null);
      setNotification({ type: 'success', msg: 'Certificate added.' });
      setTimeout(() => setNotification(null), 3000);
    },
    onError: handleError,
  });

  const renewMut = useMutation({
    mutationFn: ({ id, version, payload }: { id: string; version: number; payload: any }) =>
      aparApi.renewInsuranceCertificate(id, { ...payload, version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-insurance-certificates', vendorId] });
      setRenewingId(null);
      setRenewForm(emptyCertForm());
      setFormError(null);
      setNotification({ type: 'success', msg: 'Certificate renewed.' });
      setTimeout(() => setNotification(null), 3000);
    },
    onError: handleError,
  });

  const revokeMut = useMutation({
    mutationFn: ({ id, version, reason }: { id: string; version: number; reason: string }) =>
      aparApi.revokeInsuranceCertificate(id, { version, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-insurance-certificates', vendorId] });
      setRevokingId(null);
      setRevokeReason('');
      setNotification({ type: 'success', msg: 'Certificate revoked.' });
      setTimeout(() => setNotification(null), 3000);
    },
    onError: handleError,
  });

  const startRenew = (cert: any) => {
    setRenewingId(cert.id);
    setRenewForm({
      certificateNumber: cert.certificateNumber,
      insuranceProvider: cert.insuranceProvider,
      insuranceType: cert.insuranceType,
      effectiveDate: '',
      expirationDate: '',
      coverageAmount: cert.coverageAmount != null ? String(cert.coverageAmount) : '',
      coverageDescription: cert.coverageDescription ?? '',
      documentFileName: '',
      notes: '',
    });
  };

  return (
    <div className="space-y-4" data-testid="vendor-insurance-section">
      {notification && (
        <div className={`px-4 py-2 rounded text-sm ${notification.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {notification.msg}
        </div>
      )}
      {unauthorized && (
        <div className="bg-amber-50 border border-amber-200 rounded px-4 py-2 flex items-center gap-2 text-sm text-amber-800">
          <Ban className="w-4 h-4" /> {unauthorized}
          <button className="ml-auto text-xs underline" onClick={() => setUnauthorized(null)}>Dismiss</button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <label className="text-xs font-medium text-gray-600">View</label>
          <select value={scope} onChange={e => setScope(e.target.value as 'current' | 'all')} className="border rounded px-2 py-1 text-sm">
            <option value="current">Current only</option>
            <option value="all">Include history (superseded / revoked)</option>
          </select>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-xs font-medium text-gray-600">Expiration</label>
          <select value={expirationFilter} onChange={e => setExpirationFilter(e.target.value as any)} className="border rounded px-2 py-1 text-sm">
            <option value="all">All</option>
            <option value="expired">Expired</option>
            <option value="expiring">Expiring within...</option>
          </select>
          {expirationFilter === 'expiring' && (
            <input
              type="number"
              min={1}
              value={withinDays}
              onChange={e => setWithinDays(e.target.value)}
              className="w-20 border rounded px-2 py-1 text-sm"
              data-testid="within-days-input"
            />
          )}
        </div>
        <button onClick={() => refetch()} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
        <button
          onClick={() => { setShowCreate(true); setCreateForm(emptyCertForm()); setFormError(null); }}
          className="ml-auto flex items-center gap-2 bg-brand text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-brand"
          data-testid="add-certificate-btn"
        >
          <Plus className="w-4 h-4" /> Add Certificate
        </button>
      </div>

      <div className="bg-white rounded-lg shadow">
        {isLoading ? (
          <p className="text-sm text-gray-400 p-5">Loading certificates...</p>
        ) : isError ? (
          <p className="text-sm text-red-600 p-5">Could not load insurance certificates.</p>
        ) : certificates.length === 0 ? (
          <p className="text-sm text-gray-400 p-5">No insurance certificates on file for this vendor.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Provider</th>
                <th className="px-4 py-2">Certificate #</th>
                <th className="px-4 py-2">Effective</th>
                <th className="px-4 py-2">Expires</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Expiration</th>
                <th className="px-4 py-2">Document</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {certificates.map((c: any) => (
                <tr key={c.id} className="border-b last:border-0" data-testid="certificate-row">
                  <td className="px-4 py-2">{c.insuranceType.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2">{c.insuranceProvider}</td>
                  <td className="px-4 py-2 font-mono">{c.certificateNumber}</td>
                  <td className="px-4 py-2">{new Date(c.effectiveDate).toLocaleDateString()}</td>
                  <td className="px-4 py-2">{new Date(c.expirationDate).toLocaleDateString()}</td>
                  <td className="px-4 py-2"><StatusPill status={c.status} /></td>
                  <td className="px-4 py-2"><ExpirationBadge status={c.expirationStatus} /></td>
                  <td className="px-4 py-2">
                    {c.documentFileName ? (
                      <span className="inline-flex items-center gap-1 text-gray-600"><FileText className="w-3.5 h-3.5" /> {c.documentFileName}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button className="text-xs text-gray-500 hover:text-gray-800 mr-3" onClick={() => setHistoryId(c.id)}>
                      <History className="w-3.5 h-3.5 inline" /> History
                    </button>
                    {c.isCurrent && c.status === 'ACTIVE' && (
                      <>
                        <button className="text-xs text-brand hover:underline mr-3" onClick={() => startRenew(c)} data-testid="renew-btn">
                          Renew
                        </button>
                        <button
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => { setRevokingId(c.id); setRevokeReason(''); }}
                          data-testid="revoke-btn"
                        >
                          Revoke
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-[32rem] p-6 space-y-4 max-h-[90vh] overflow-auto">
            <h3 className="font-bold text-lg">Add Insurance Certificate</h3>
            {formError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{formError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Insurance Type *</label>
                <select
                  value={createForm.insuranceType}
                  onChange={e => setCreateForm(f => ({ ...f, insuranceType: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {INSURANCE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Provider *</label>
                <input value={createForm.insuranceProvider} onChange={e => setCreateForm(f => ({ ...f, insuranceProvider: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Certificate # *</label>
                <input value={createForm.certificateNumber} onChange={e => setCreateForm(f => ({ ...f, certificateNumber: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Effective Date *</label>
                <input type="date" value={createForm.effectiveDate} onChange={e => setCreateForm(f => ({ ...f, effectiveDate: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Expiration Date *</label>
                <input type="date" value={createForm.expirationDate} onChange={e => setCreateForm(f => ({ ...f, expirationDate: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Coverage Amount</label>
                <input type="number" value={createForm.coverageAmount} onChange={e => setCreateForm(f => ({ ...f, coverageAmount: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Document File Name (reference only)</label>
                <input value={createForm.documentFileName} onChange={e => setCreateForm(f => ({ ...f, documentFileName: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. certificate.pdf" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Coverage Description</label>
                <input value={createForm.coverageDescription} onChange={e => setCreateForm(f => ({ ...f, coverageDescription: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea value={createForm.notes} onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => createMut.mutate(certToPayload(createForm))}
                disabled={createMut.isPending || !createForm.certificateNumber || !createForm.insuranceProvider || !createForm.effectiveDate || !createForm.expirationDate}
                className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand disabled:opacity-40"
                data-testid="save-certificate-btn"
              >
                {createMut.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Renew Modal */}
      {renewingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-[32rem] p-6 space-y-4 max-h-[90vh] overflow-auto">
            <h3 className="font-bold text-lg">Renew / Replace Certificate</h3>
            {formError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{formError}</p>}
            <p className="text-xs text-gray-500">
              The current certificate will be preserved as historical and superseded by this new period.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Provider *</label>
                <input value={renewForm.insuranceProvider} onChange={e => setRenewForm(f => ({ ...f, insuranceProvider: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Certificate # *</label>
                <input value={renewForm.certificateNumber} onChange={e => setRenewForm(f => ({ ...f, certificateNumber: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New Effective Date *</label>
                <input type="date" value={renewForm.effectiveDate} onChange={e => setRenewForm(f => ({ ...f, effectiveDate: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New Expiration Date *</label>
                <input type="date" value={renewForm.expirationDate} onChange={e => setRenewForm(f => ({ ...f, expirationDate: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Coverage Amount</label>
                <input type="number" value={renewForm.coverageAmount} onChange={e => setRenewForm(f => ({ ...f, coverageAmount: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Document File Name</label>
                <input value={renewForm.documentFileName} onChange={e => setRenewForm(f => ({ ...f, documentFileName: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setRenewingId(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => {
                  const current = certificates.find(c => c.id === renewingId);
                  if (!current) return;
                  renewMut.mutate({ id: renewingId, version: current.version, payload: certToPayload(renewForm) });
                }}
                disabled={renewMut.isPending || !renewForm.certificateNumber || !renewForm.insuranceProvider || !renewForm.effectiveDate || !renewForm.expirationDate}
                className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand disabled:opacity-40"
                data-testid="confirm-renew-btn"
              >
                {renewMut.isPending ? 'Renewing...' : 'Renew'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Confirmation */}
      {revokingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-6 space-y-4">
            <h3 className="font-bold text-lg text-red-700">Revoke Certificate?</h3>
            <p className="text-sm text-gray-600">This certificate will be marked revoked and preserved as historical. This cannot be undone.</p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reason *</label>
              <textarea value={revokeReason} onChange={e => setRevokeReason(e.target.value)} rows={2} className="w-full border rounded px-3 py-2 text-sm" placeholder="Required" />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setRevokingId(null); setRevokeReason(''); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => {
                  const current = certificates.find(c => c.id === revokingId);
                  if (!current) return;
                  revokeMut.mutate({ id: revokingId, version: current.version, reason: revokeReason });
                }}
                disabled={revokeMut.isPending || !revokeReason.trim()}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40"
                data-testid="confirm-revoke-btn"
              >
                {revokeMut.isPending ? 'Revoking...' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setHistoryId(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-[28rem] p-6 space-y-3 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg">Certificate Audit History</h3>
            {auditLoading ? (
              <p className="text-sm text-gray-400">Loading...</p>
            ) : !auditEvents || (auditEvents as any[]).length === 0 ? (
              <p className="text-sm text-gray-400">No audit events recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {(auditEvents as any[]).map((e: any, i: number) => (
                  <li key={e.id ?? i} className="text-sm border-b pb-2 last:border-0">
                    <p className="font-medium">{e.action}</p>
                    <p className="text-xs text-gray-500">{e.actorName ?? e.actorId ?? 'system'} · {e.occurredAt ? new Date(e.occurredAt).toLocaleString() : ''}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button onClick={() => setHistoryId(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
