import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, PlayCircle } from 'lucide-react';
import {
  fniReserveApi,
  type ReserveRemittance,
  type LenderProgramConfig,
  type ChargebackDrawResult,
  type ChargebackPreviewResult,
} from '../../../api/ce12-fni-client';
import { PageHeader, Btn, Badge } from '../../../components/ui';
import { Drawer, DrawerRow, FilterBar, FilterField, FILTER_CONTROL_CLASS, EmptyState, ErrorState, LoadingState, UnauthorizedState, Banner } from '../../../components/report';
import { JournalDrillDrawer } from '../../../components/ce12/JournalDrillDrawer';

// CE-12 / S091 — Finance Reserve & Flat-% Chargeback Reserve. The INITIAL
// reserve income booking (reserve receivable item) happens in
// deal-accounting-service's S084 journal — this screen owns everything
// AFTER that: lender remittance receipt (relieves the item) + the flat-%
// chargeback-reserve accrual it triggers, explicit short-pay disposition,
// and actual chargeback draws (early-payoff notices). No dollar amount
// here is ever computed in the browser — every figure below is a verbatim
// field from a real fni-reserve-service API response.
//
// Gap-closure pass: fni-reserve-service now exposes real persisted list
// endpoints for individual ChargebackReserveAccrual and ChargebackDraw rows
// (GET /chargeback-reserve/accruals, GET /chargeback-reserve/draws) — the
// Accruals tab shows these alongside the aggregated tie-out, and the
// Chargeback Draws tab now shows real persisted draw history instead of only
// a session-local list of POST responses. POST /chargebacks/preview is a
// real dry-run endpoint (computes the drawn-from-reserve/excess-to-expense
// split server-side without posting) — the confirm step below calls it
// directly rather than only checking the current balance client-side.

const fmt = (n: string | number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return '—';
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—';

function isUnauthorized(err: any) {
  return err?.status === 401 || err?.status === 403;
}

// ── Accruals tab ────────────────────────────────────────────────────────
function AccrualsTab() {
  const qc = useQueryClient();
  const [lenderFilter, setLenderFilter] = useState('');
  const [newConfigOpen, setNewConfigOpen] = useState(false);
  const [form, setForm] = useState({ lenderProgramCode: '', lenderProgramName: '', chargebackReservePercent: '', effectiveFrom: '', effectiveTo: '', message: '' });
  const [busy, setBusy] = useState(false);

  const configsQ = useQuery({
    queryKey: ['ce12-lender-program-configs'],
    queryFn: () => fniReserveApi.listLenderProgramConfigs(),
    retry: false,
  });

  const tieOutQ = useQuery({
    queryKey: ['ce12-chargeback-tieout', lenderFilter],
    queryFn: () => fniReserveApi.getChargebackReserveTieOut(lenderFilter || undefined),
    retry: false,
  });

  async function submitConfig() {
    if (!form.lenderProgramCode.trim() || !form.lenderProgramName.trim() || !form.chargebackReservePercent.trim() || !form.effectiveFrom.trim()) {
      setForm((f) => ({ ...f, message: 'Lender program code, name, chargeback reserve %, and effective-from are required.' }));
      return;
    }
    setBusy(true);
    try {
      await fniReserveApi.createLenderProgramConfig({
        lenderProgramCode: form.lenderProgramCode.trim(),
        lenderProgramName: form.lenderProgramName.trim(),
        chargebackReservePercent: form.chargebackReservePercent.trim(),
        effectiveFrom: form.effectiveFrom.trim(),
        effectiveTo: form.effectiveTo.trim() || null,
      });
      setNewConfigOpen(false);
      setForm({ lenderProgramCode: '', lenderProgramName: '', chargebackReservePercent: '', effectiveFrom: '', effectiveTo: '', message: '' });
      await qc.invalidateQueries({ queryKey: ['ce12-lender-program-configs'] });
    } catch (err: any) {
      setForm((f) => ({ ...f, message: err.message }));
    } finally {
      setBusy(false);
    }
  }

  const accrualsQ = useQuery({
    queryKey: ['ce12-chargeback-accruals', lenderFilter],
    queryFn: () => fniReserveApi.listChargebackReserveAccruals({ lenderProgramCode: lenderFilter || undefined }),
    retry: false,
  });

  const configs = configsQ.data ?? [];
  const lines = tieOutQ.data?.lines ?? [];
  const accrualRows = accrualsQ.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold text-slate-700">Configured lender-program chargeback reserve %</h3>
          <Btn size="sm" onClick={() => setNewConfigOpen(true)} data-testid="reserve-new-lender-program-btn">New lender program…</Btn>
        </div>
        {configsQ.isLoading && <LoadingState testId="reserve-configs-loading" label="Loading lender program configuration…" />}
        {configsQ.error && (isUnauthorized(configsQ.error)
          ? <UnauthorizedState testId="reserve-configs-unauthorized" message={(configsQ.error as any).message} />
          : <ErrorState testId="reserve-configs-error" message={(configsQ.error as Error).message} onRetry={() => configsQ.refetch()} />)}
        {!configsQ.isLoading && !configsQ.error && configs.length === 0 && (
          <EmptyState testId="reserve-configs-empty" title="No lender-program configuration yet" message="No flat-% chargeback reserve rate is configured for any lender program — accruals will not compute until one exists." />
        )}
        {!configsQ.isLoading && !configsQ.error && configs.length > 0 && (
          <table className="w-full border-collapse" data-testid="reserve-configs-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Program code</th>
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Name</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Chargeback reserve %</th>
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Effective</th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c: LenderProgramConfig) => (
                <tr key={c.id} data-testid={`reserve-config-row-${c.lenderProgramCode}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 font-mono text-[13px]">{c.lenderProgramCode}</td>
                  <td className="px-3 text-[13px]">{c.lenderProgramName}</td>
                  <td className="px-3 text-right font-mono text-[13px] font-semibold">{c.chargebackReservePercent}%</td>
                  <td className="px-3 text-[13px] text-slate-600">{fmtDate(c.effectiveFrom)}{c.effectiveTo ? ` – ${fmtDate(c.effectiveTo)}` : ' – open'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h3 className="text-[13px] font-semibold text-slate-700 mb-2">Accrual history (aggregated by control number — deal + lender program)</h3>
        <FilterBar>
          <FilterField label="Lender program code (optional)" width={220}>
            <input className={FILTER_CONTROL_CLASS} value={lenderFilter} onChange={(e) => setLenderFilter(e.target.value)} data-testid="reserve-accruals-lender-filter" />
          </FilterField>
          <Btn size="sm" variant="secondary" icon={<Search size={13} />} onClick={() => tieOutQ.refetch()} data-testid="reserve-accruals-search-btn">Search</Btn>
        </FilterBar>
        {tieOutQ.isLoading && <LoadingState testId="reserve-accruals-loading" label="Loading accrual history…" />}
        {tieOutQ.error && (isUnauthorized(tieOutQ.error)
          ? <UnauthorizedState testId="reserve-accruals-unauthorized" message={(tieOutQ.error as any).message} />
          : <ErrorState testId="reserve-accruals-error" message={(tieOutQ.error as Error).message} onRetry={() => tieOutQ.refetch()} />)}
        {!tieOutQ.isLoading && !tieOutQ.error && lines.length === 0 && (
          <EmptyState testId="reserve-accruals-empty" title="No chargeback-reserve accrual activity" message="Accruals are created automatically when a lender remittance is recorded on the Remittances tab for a deal/lender-program pair with a configured rate." />
        )}
        {!tieOutQ.isLoading && !tieOutQ.error && lines.length > 0 && (
          <table className="w-full border-collapse" data-testid="reserve-accruals-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Control #</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Accrued (Σ)</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Drawn (Σ)</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Remaining balance</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.controlNumber} data-testid={`reserve-accrual-row-${l.controlNumber}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 font-mono text-[13px]">{l.controlNumber}</td>
                  <td className="px-3 text-right font-mono text-[13px]">{fmt(l.accruedTotal)}</td>
                  <td className="px-3 text-right font-mono text-[13px]">{fmt(l.drawnTotal)}</td>
                  <td className="px-3 text-right font-mono text-[13px] font-semibold">{fmt(l.remainingBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h3 className="text-[13px] font-semibold text-slate-700 mb-2">Individual accrual rows (real, persisted — gap-closure)</h3>
        {accrualsQ.isLoading && <LoadingState testId="reserve-accrual-rows-loading" label="Loading accrual rows…" />}
        {accrualsQ.error && (isUnauthorized(accrualsQ.error)
          ? <UnauthorizedState testId="reserve-accrual-rows-unauthorized" message={(accrualsQ.error as any).message} />
          : <ErrorState testId="reserve-accrual-rows-error" message={(accrualsQ.error as Error).message} onRetry={() => accrualsQ.refetch()} />)}
        {!accrualsQ.isLoading && !accrualsQ.error && accrualRows.length === 0 && (
          <EmptyState testId="reserve-accrual-rows-empty" title="No individual accrual rows" message="Each accrual row is created automatically when a lender remittance triggers a chargeback-reserve accrual." />
        )}
        {!accrualsQ.isLoading && !accrualsQ.error && accrualRows.length > 0 && (
          <table className="w-full border-collapse" data-testid="reserve-accrual-rows-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Deal #</th>
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Lender program</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Reserve income</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Accrual %</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Accrual amount</th>
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Created</th>
              </tr>
            </thead>
            <tbody>
              {accrualRows.map((a) => (
                <tr key={a.id} data-testid={`reserve-accrual-detail-row-${a.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 font-mono text-[13px]">{a.dealNumber}</td>
                  <td className="px-3 text-[13px]">{a.lenderProgramCode}</td>
                  <td className="px-3 text-right font-mono text-[13px]">{fmt(a.reserveIncomeAmount)}</td>
                  <td className="px-3 text-right font-mono text-[13px]">{a.accrualPercent}%</td>
                  <td className="px-3 text-right font-mono text-[13px] font-semibold">{fmt(a.accrualAmount)}</td>
                  <td className="px-3 text-[13px] text-slate-600">{fmtDate(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Drawer
        open={newConfigOpen}
        onClose={() => setNewConfigOpen(false)}
        title="New lender-program chargeback reserve config"
        testId="reserve-new-config-drawer"
        actions={<>
          <Btn variant="ghost" size="sm" onClick={() => setNewConfigOpen(false)} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" size="sm" onClick={submitConfig} loading={busy} data-testid="reserve-new-config-submit">Create</Btn>
        </>}
      >
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold text-slate-600">Lender program code
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.lenderProgramCode} onChange={(e) => setForm({ ...form, lenderProgramCode: e.target.value })} data-testid="reserve-config-code-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Lender program name
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.lenderProgramName} onChange={(e) => setForm({ ...form, lenderProgramName: e.target.value })} data-testid="reserve-config-name-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Chargeback reserve % (flat, tenant-configured)
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={form.chargebackReservePercent} onChange={(e) => setForm({ ...form, chargebackReservePercent: e.target.value })} placeholder="e.g. 5.00" data-testid="reserve-config-percent-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Effective from
            <input type="date" className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} data-testid="reserve-config-effective-from-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Effective to (optional)
            <input type="date" className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} data-testid="reserve-config-effective-to-input" />
          </label>
          {form.message && <p className="text-xs text-red-600" data-testid="reserve-config-message">{form.message}</p>}
        </div>
      </Drawer>
    </div>
  );
}

// ── Remittances tab ─────────────────────────────────────────────────────
function DispositionModal({ remittance, onClose }: { remittance: ReserveRemittance; onClose: () => void }) {
  const qc = useQueryClient();
  const [dispositionType, setDispositionType] = useState<'WRITE_OFF_TO_EXPENSE' | 'FLAG_FOR_FOLLOWUP'>('WRITE_OFF_TO_EXPENSE');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => fniReserveApi.dispositionShortPay(remittance.id, { dispositionType, reason: reason.trim(), idempotencyKey: crypto.randomUUID() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce12-remittances'] });
      onClose();
    },
    onError: (err: any) => setError(err.message),
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Disposition short-pay — deal ${remittance.dealNumber}`}
      subtitle={`Short-pay amount: ${fmt(remittance.shortPayAmount)}`}
      testId="reserve-disposition-drawer"
      actions={<>
        <Btn variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>Cancel</Btn>
        <Btn variant="danger" size="sm" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!reason.trim()} data-testid="reserve-disposition-submit">Disposition</Btn>
      </>}
    >
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold text-slate-600">Disposition type
          <select className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={dispositionType} onChange={(e) => setDispositionType(e.target.value as any)} data-testid="reserve-disposition-type-select">
            <option value="WRITE_OFF_TO_EXPENSE">Write off to expense</option>
            <option value="FLAG_FOR_FOLLOWUP">Flag for follow-up</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">Reason (required)
          <textarea className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reserve-disposition-reason-input" />
        </label>
        {error && <p className="text-xs text-red-600" data-testid="reserve-disposition-error">{error}</p>}
      </div>
    </Drawer>
  );
}

function RemittancesTab() {
  const qc = useQueryClient();
  const [dealFilter, setDealFilter] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [dispositionTarget, setDispositionTarget] = useState<ReserveRemittance | null>(null);
  const [form, setForm] = useState({ dealNumber: '', lenderProgramCode: '', expectedAmount: '', remittedAmount: '', message: '' });
  const [busy, setBusy] = useState(false);

  const listQ = useQuery({
    queryKey: ['ce12-remittances', dealFilter],
    queryFn: () => fniReserveApi.listRemittances(dealFilter || undefined),
    retry: false,
  });

  async function submitNew() {
    if (!form.dealNumber.trim() || !form.lenderProgramCode.trim() || !form.expectedAmount.trim() || !form.remittedAmount.trim()) {
      setForm((f) => ({ ...f, message: 'Deal #, lender program, expected amount, and remitted amount are all required.' }));
      return;
    }
    setBusy(true);
    try {
      await fniReserveApi.processRemittance({
        dealNumber: form.dealNumber.trim(),
        lenderProgramCode: form.lenderProgramCode.trim(),
        expectedAmount: form.expectedAmount.trim(),
        remittedAmount: form.remittedAmount.trim(),
        idempotencyKey: crypto.randomUUID(),
      });
      setNewOpen(false);
      setForm({ dealNumber: '', lenderProgramCode: '', expectedAmount: '', remittedAmount: '', message: '' });
      await qc.invalidateQueries({ queryKey: ['ce12-remittances'] });
      await qc.invalidateQueries({ queryKey: ['ce12-chargeback-tieout'] });
    } catch (err: any) {
      setForm((f) => ({ ...f, message: err.message }));
    } finally {
      setBusy(false);
    }
  }

  const rows = listQ.data ?? [];

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <FilterBar>
          <FilterField label="Deal # (optional)" width={200}>
            <input className={FILTER_CONTROL_CLASS} value={dealFilter} onChange={(e) => setDealFilter(e.target.value)} data-testid="remittances-deal-filter" />
          </FilterField>
          <Btn size="sm" variant="secondary" icon={<Search size={13} />} onClick={() => listQ.refetch()} data-testid="remittances-search-btn">Search</Btn>
        </FilterBar>
        <Btn size="sm" onClick={() => setNewOpen(true)} data-testid="remittances-new-btn">Record remittance…</Btn>
      </div>

      {listQ.isLoading && <LoadingState testId="remittances-loading" label="Loading remittances…" />}
      {listQ.error && (isUnauthorized(listQ.error)
        ? <UnauthorizedState testId="remittances-unauthorized" message={(listQ.error as any).message} />
        : <ErrorState testId="remittances-error" message={(listQ.error as Error).message} onRetry={() => listQ.refetch()} />)}
      {!listQ.isLoading && !listQ.error && rows.length === 0 && (
        <EmptyState testId="remittances-empty" title="No lender remittances recorded" message="Record a lender remittance receipt to relieve the reserve-receivable item for a deal." action={<Btn variant="secondary" size="sm" onClick={() => setNewOpen(true)}>Record remittance…</Btn>} />
      )}
      {!listQ.isLoading && !listQ.error && rows.length > 0 && (
        <table className="w-full border-collapse" data-testid="remittances-table">
          <thead>
            <tr className="bg-slate-50 border-b-2 border-slate-200">
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Deal #</th>
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Lender program</th>
              <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Expected</th>
              <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Remitted</th>
              <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Short-pay</th>
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const shortPay = Number(r.shortPayAmount);
              return (
                <tr key={r.id} data-testid={`remittance-row-${r.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 font-mono text-[13px]">{r.dealNumber}</td>
                  <td className="px-3 text-[13px]">{r.lenderProgramCode}</td>
                  <td className="px-3 text-right font-mono text-[13px]">{fmt(r.expectedAmount)}</td>
                  <td className="px-3 text-right font-mono text-[13px]">{fmt(r.remittedAmount)}</td>
                  <td className={`px-3 text-right font-mono text-[13px] ${shortPay > 0 ? 'text-red-600 font-semibold' : ''}`}>{fmt(r.shortPayAmount)}</td>
                  <td className="px-3"><Badge variant={r.status === 'PROCESSED' ? 'success' : 'danger'} dot>{r.status}</Badge></td>
                  <td className="px-3">
                    {shortPay > 0 && (
                      <Btn variant="secondary" size="sm" onClick={() => setDispositionTarget(r)} data-testid={`remittance-disposition-btn-${r.id}`}>Disposition short-pay…</Btn>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Drawer
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Record lender remittance receipt"
        testId="remittances-new-drawer"
        actions={<>
          <Btn variant="ghost" size="sm" onClick={() => setNewOpen(false)} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" size="sm" onClick={submitNew} loading={busy} data-testid="remittances-new-submit">Record</Btn>
        </>}
      >
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold text-slate-600">Deal #
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={form.dealNumber} onChange={(e) => setForm({ ...form, dealNumber: e.target.value })} data-testid="remittances-deal-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Lender program code
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={form.lenderProgramCode} onChange={(e) => setForm({ ...form, lenderProgramCode: e.target.value })} data-testid="remittances-lender-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Expected amount (recap reserve income figure)
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={form.expectedAmount} onChange={(e) => setForm({ ...form, expectedAmount: e.target.value })} placeholder="0.00" data-testid="remittances-expected-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Remitted amount (actual receipt)
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={form.remittedAmount} onChange={(e) => setForm({ ...form, remittedAmount: e.target.value })} placeholder="0.00" data-testid="remittances-remitted-input" />
          </label>
          {form.message && <p className="text-xs text-red-600" data-testid="remittances-new-message">{form.message}</p>}
        </div>
      </Drawer>

      {dispositionTarget && <DispositionModal remittance={dispositionTarget} onClose={() => setDispositionTarget(null)} />}
    </div>
  );
}

// ── Chargeback Draws tab ────────────────────────────────────────────────
function ChargebackDrawsTab() {
  const [dealNumber, setDealNumber] = useState('');
  const [lenderProgramCode, setLenderProgramCode] = useState('');
  const [chargebackAmount, setChargebackAmount] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [preview, setPreview] = useState<ChargebackPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [justPosted, setJustPosted] = useState<ChargebackDrawResult | null>(null);
  const [drawFilter, setDrawFilter] = useState('');

  const canSubmit = !!dealNumber.trim() && !!lenderProgramCode.trim() && !!chargebackAmount.trim();

  const drawsQ = useQuery({
    queryKey: ['ce12-chargeback-draws', drawFilter],
    queryFn: () => fniReserveApi.listChargebackReserveDraws({ lenderProgramCode: drawFilter || undefined }),
    retry: false,
  });

  const previewMutation = useMutation({
    // Gap-closure — real dry-run preview (POST /chargebacks/preview): same
    // request shape as the real POST /chargebacks, computes the drawn-from-
    // reserve/excess-to-expense split server-side without posting anything.
    mutationFn: () => fniReserveApi.previewChargeback({
      dealNumber: dealNumber.trim(),
      lenderProgramCode: lenderProgramCode.trim(),
      chargebackAmount: chargebackAmount.trim(),
      idempotencyKey: crypto.randomUUID(),
    }),
    onSuccess: (result) => {
      setPreview(result);
      setPreviewError(null);
      setReviewing(true);
    },
    onError: (err: any) => setPreviewError(err.message),
  });

  const mutation = useMutation({
    mutationFn: () => fniReserveApi.processChargebackNotice({
      dealNumber: dealNumber.trim(),
      lenderProgramCode: lenderProgramCode.trim(),
      chargebackAmount: chargebackAmount.trim(),
      idempotencyKey: crypto.randomUUID(),
    }),
    onSuccess: (result) => {
      setJustPosted(result);
      setReviewing(false);
      setPreview(null);
      setDealNumber('');
      setLenderProgramCode('');
      setChargebackAmount('');
      drawsQ.refetch();
    },
    onError: (err: any) => setPostError(err.message),
  });

  return (
    <div className="p-4 flex flex-col gap-4">
      <Banner kind="info" testId="chargeback-preview-note" title="Preview before post">
        POST /chargebacks/preview computes the drawn-from-reserve/excess-to-expense split server-side without posting
        anything. Review the real preview below, then Confirm &amp; Post to execute the same computation for real.
      </Banner>

      <div className="bg-white border border-slate-200 rounded-xl p-4 max-w-xl">
        <h3 className="text-[13px] font-semibold text-slate-700 mb-3">Chargeback notice (early payoff)</h3>
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold text-slate-600">Deal #
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={dealNumber} onChange={(e) => setDealNumber(e.target.value)} data-testid="chargeback-deal-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Lender program code
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={lenderProgramCode} onChange={(e) => setLenderProgramCode(e.target.value)} data-testid="chargeback-lender-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Chargeback amount
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={chargebackAmount} onChange={(e) => setChargebackAmount(e.target.value)} placeholder="0.00" data-testid="chargeback-amount-input" />
          </label>
          {previewError && <p className="text-xs text-red-600" data-testid="chargeback-error">{previewError}</p>}
          <div>
            <Btn size="sm" disabled={!canSubmit} loading={previewMutation.isPending} onClick={() => previewMutation.mutate()} data-testid="chargeback-review-btn">Preview chargeback notice…</Btn>
          </div>
        </div>
      </div>

      {justPosted && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3" data-testid="chargeback-just-posted-banner">
          <div className="text-[13px] font-semibold text-emerald-800 mb-1">Posted — server's verbatim split</div>
          <div className="flex gap-6 text-[13px]">
            <span>Drawn: <span className="font-mono font-semibold">{fmt(justPosted.drawFromReserveAmount)}</span></span>
            <span>Excess: <span className="font-mono font-semibold">{fmt(justPosted.excessToExpenseAmount)}</span></span>
            <span>Balance after: <span className="font-mono font-semibold">{fmt(justPosted.reserveBalanceAfter)}</span></span>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold text-slate-700">Draw history (real, persisted — gap-closure)</h3>
          <FilterBar>
            <FilterField label="Lender program code (optional)" width={200}>
              <input className={FILTER_CONTROL_CLASS} value={drawFilter} onChange={(e) => setDrawFilter(e.target.value)} data-testid="chargeback-draws-lender-filter" />
            </FilterField>
            <Btn size="sm" variant="secondary" icon={<Search size={13} />} onClick={() => drawsQ.refetch()} data-testid="chargeback-draws-search-btn">Search</Btn>
          </FilterBar>
        </div>
        {drawsQ.isLoading && <LoadingState testId="chargeback-draws-loading" label="Loading draw history…" />}
        {drawsQ.error && (isUnauthorized(drawsQ.error)
          ? <UnauthorizedState testId="chargeback-draws-unauthorized" message={(drawsQ.error as any).message} />
          : <ErrorState testId="chargeback-draws-error" message={(drawsQ.error as Error).message} onRetry={() => drawsQ.refetch()} />)}
        {!drawsQ.isLoading && !drawsQ.error && (drawsQ.data?.items ?? []).length === 0 && (
          <EmptyState testId="chargeback-draws-empty" title="No chargeback draws recorded" message="Post a chargeback notice above to draw from the reserve." />
        )}
        {!drawsQ.isLoading && !drawsQ.error && (drawsQ.data?.items ?? []).length > 0 && (
          <table className="w-full border-collapse" data-testid="chargeback-draws-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Deal #</th>
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Source</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Chargeback amount</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Drawn from reserve</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Excess to expense</th>
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Created</th>
              </tr>
            </thead>
            <tbody>
              {(drawsQ.data?.items ?? []).map((d) => (
                <tr key={d.id} data-testid={`chargeback-draw-row-${d.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 font-mono text-[13px]">{d.dealNumber}</td>
                  <td className="px-3"><Badge variant={d.sourceType === 'CANCELLATION' ? 'purple' : 'info'} dot>{d.sourceType}</Badge></td>
                  <td className="px-3 text-right font-mono text-[13px]">{fmt(d.chargebackAmount)}</td>
                  <td className="px-3 text-right font-mono text-[13px] font-semibold">{fmt(d.drawFromReserveAmount)}</td>
                  <td className="px-3 text-right font-mono text-[13px] font-semibold text-amber-700">{fmt(d.excessToExpenseAmount)}</td>
                  <td className="px-3 text-[13px] text-slate-600">{fmtDate(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {reviewing && preview && (
        <Drawer
          open
          onClose={() => setReviewing(false)}
          title="Confirm chargeback notice"
          subtitle="Real server-computed preview — Confirm & Post executes the same computation for real"
          testId="chargeback-confirm-drawer"
          actions={<>
            <Btn variant="ghost" size="sm" onClick={() => setReviewing(false)} disabled={mutation.isPending}>Cancel</Btn>
            <Btn variant="danger" size="sm" onClick={() => mutation.mutate()} loading={mutation.isPending} data-testid="chargeback-confirm-submit">Confirm &amp; Post</Btn>
          </>}
        >
          <DrawerRow label="Deal #" value={dealNumber} />
          <DrawerRow label="Lender program" value={lenderProgramCode} />
          <DrawerRow label="Chargeback amount" value={fmt(preview.chargebackAmount)} />
          <DrawerRow label="Reserve balance before" value={fmt(preview.reserveBalanceBefore)} />
          <DrawerRow label="Drawn from reserve" value={fmt(preview.drawFromReserveAmount)} />
          <DrawerRow label="Excess to expense" value={fmt(preview.excessToExpenseAmount)} />
          <DrawerRow label="Reserve balance after" value={fmt(preview.reserveBalanceAfter)} />
          {postError && <p className="text-xs text-red-600 mt-2" data-testid="chargeback-post-error">{postError}</p>}
        </Drawer>
      )}
    </div>
  );
}

// ── Liability Tie tab ───────────────────────────────────────────────────
function LiabilityTieTab() {
  const [lenderFilter, setLenderFilter] = useState('');
  const tieOutQ = useQuery({
    queryKey: ['ce12-chargeback-tieout-liability', lenderFilter],
    queryFn: () => fniReserveApi.getChargebackReserveTieOut(lenderFilter || undefined),
    retry: false,
  });

  const lines = tieOutQ.data?.lines ?? [];
  const totalRemaining = tieOutQ.data ? Number(tieOutQ.data.totalRemainingBalance) : null;

  return (
    <div className="p-4">
      <FilterBar>
        <FilterField label="Lender program code (optional)" width={220}>
          <input className={FILTER_CONTROL_CLASS} value={lenderFilter} onChange={(e) => setLenderFilter(e.target.value)} data-testid="liability-tie-lender-filter" />
        </FilterField>
        <Btn size="sm" variant="secondary" icon={<PlayCircle size={13} />} onClick={() => tieOutQ.refetch()} data-testid="liability-tie-run-btn">Run tie-out</Btn>
      </FilterBar>

      <p className="text-[12.5px] text-slate-500 mb-3">
        Reserve-liability tie-out: Σ accruals − Σ draws, computed purely from this service's own accrual/draw records
        (S091 AC). A remaining balance reflects still-open reserve for that control number — it is expected to be
        exactly $0 only once every accrual for a given deal/lender-program has been fully drawn down.
      </p>

      {tieOutQ.isLoading && <LoadingState testId="liability-tie-loading" label="Running tie-out…" />}
      {tieOutQ.error && (isUnauthorized(tieOutQ.error)
        ? <UnauthorizedState testId="liability-tie-unauthorized" message={(tieOutQ.error as any).message} />
        : <ErrorState testId="liability-tie-error" message={(tieOutQ.error as Error).message} onRetry={() => tieOutQ.refetch()} />)}

      {!tieOutQ.isLoading && !tieOutQ.error && lines.length === 0 && (
        <EmptyState testId="liability-tie-empty" title="No chargeback-reserve activity" message="No accruals or draws recorded yet." />
      )}

      {!tieOutQ.isLoading && !tieOutQ.error && lines.length > 0 && (
        <>
          <table className="w-full border-collapse" data-testid="liability-tie-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Control #</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Accrued</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Drawn</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Remaining</th>
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const remaining = Number(l.remainingBalance);
                return (
                  <tr key={l.controlNumber} data-testid={`liability-tie-row-${l.controlNumber}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 font-mono text-[13px]">{l.controlNumber}</td>
                    <td className="px-3 text-right font-mono text-[13px]">{fmt(l.accruedTotal)}</td>
                    <td className="px-3 text-right font-mono text-[13px]">{fmt(l.drawnTotal)}</td>
                    <td className={`px-3 text-right font-mono text-[13px] font-semibold ${remaining !== 0 ? 'text-red-600' : ''}`}>{fmt(l.remainingBalance)}</td>
                    <td className="px-3"><Badge variant={remaining === 0 ? 'success' : 'danger'} dot>{remaining === 0 ? 'FULLY DRAWN' : 'OPEN'}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="h-9 border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <td className="px-3 text-[13px]">Total</td>
                <td className="px-3 text-right font-mono text-[13px]">{fmt(tieOutQ.data!.totalAccrued)}</td>
                <td className="px-3 text-right font-mono text-[13px]">{fmt(tieOutQ.data!.totalDrawn)}</td>
                <td className={`px-3 text-right font-mono text-[13px] ${totalRemaining !== 0 ? 'text-red-600' : ''}`} data-testid="liability-tie-total-remaining">{fmt(tieOutQ.data!.totalRemainingBalance)}</td>
                <td className="px-3">{lenderFilter && <Badge variant={totalRemaining === 0 ? 'success' : 'danger'} dot>{totalRemaining === 0 ? 'TIES TO $0' : 'OPEN BALANCE'}</Badge>}</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  );
}

// ── Page shell ───────────────────────────────────────────────────────────
const TABS = [
  { key: 'accruals', label: 'Accruals' },
  { key: 'remittances', label: 'Remittances' },
  { key: 'draws', label: 'Chargeback Draws' },
  { key: 'liability', label: 'Liability Tie' },
] as const;
type TabKey = typeof TABS[number]['key'];

export default function ReserveChargeback() {
  const [tab, setTab] = useState<TabKey>('accruals');

  return (
    <div className="p-7 min-h-full" data-testid="reserve-chargeback-page">
      <PageHeader
        title="Reserve &amp; Chargeback"
        subtitle="S091 — finance reserve income relief, flat-% chargeback-reserve accrual, remittance short-pay disposition, and actual chargeback draws (early payoff)."
      />

      <div className="flex items-center gap-1 border-b border-slate-200 mb-2 bg-white rounded-t-xl px-2 pt-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            data-testid={`reserve-tab-${t.key}`}
            className={`px-3 py-2 text-[13px] font-semibold border-b-2 ${tab === t.key ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 border-t-0 rounded-b-xl shadow-sm">
        {tab === 'accruals' && <AccrualsTab />}
        {tab === 'remittances' && <RemittancesTab />}
        {tab === 'draws' && <ChargebackDrawsTab />}
        {tab === 'liability' && <LiabilityTieTab />}
      </div>
    </div>
  );
}
