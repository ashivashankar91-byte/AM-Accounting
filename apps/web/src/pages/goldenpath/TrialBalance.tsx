import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { goldenPathApi } from '../../api/client';
import {
  Banner, EmptyState, ErrorState, LoadingState, MoneyTd, UnauthorizedState, formatMoney,
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd, TotalsRow,
  ExportMenu, Drawer, DrawerRow, RelatedLinks,
} from '../../components/report';
import { Btn } from '../../components/ui';

interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  priorBalance: number;
  currentAmount: number;
  endingBalance: number;
  debitBalance: number;
  creditBalance: number;
}

interface TrialBalanceReport {
  scope: { entity: string; store: string | null; dept: string | null; asOf: string };
  accounts: TrialBalanceRow[];
  drSum: number;
  crSum: number;
  delta: number;
}

interface StructuralImbalance {
  error: 'STRUCTURAL_IMBALANCE';
  drSum: number;
  crSum: number;
  delta: number;
}

const now = new Date();
const defaultAsOf = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

// FINAL-R0 / S222 — Trial Balance Screen. Not part of the sequential
// login->...->audit-history Golden Path (Trial Balance is not one of its
// steps); reachable directly for the Controller reporting workflow. Consumes
// the real S014 gl-service API only — every prior/activity/ending/dr/cr
// value shown is exactly what the API returned. `entity` is gl-service's own
// companyCode slice, not the tenant-service legalEntityId used elsewhere in
// the Golden Path (see api/client.ts comment on getTrialBalance) — the
// Controller enters it directly rather than it being inferred from entity
// selection.
//
// Golden R0 UI convergence — Phase 2/3 reference migration: rebuilt on the
// shared ReportShell/FilterBar/FinancialTable/Drawer foundation
// (components/report). All data-testids, API calls, calculations and the
// fail-closed structural-imbalance behavior are unchanged from the prior
// pass — only the surrounding markup changed. The "Balanced"/"Out of
// balance" status badge is derived purely from client state that already
// existed (whether the last run threw STRUCTURAL_IMBALANCE) — it is not a
// new concept and reports nothing the API didn't already tell this screen.
export default function TrialBalance() {
  const { legalEntityId } = useAuth();
  const [entity, setEntity] = useState('01');
  const [store, setStore] = useState('');
  const [dept, setDept] = useState('');
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [zeroSuppression, setZeroSuppression] = useState(false);
  const [report, setReport] = useState<TrialBalanceReport | null>(null);
  const [imbalance, setImbalance] = useState<StructuralImbalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drillAccountCode, setDrillAccountCode] = useState<string | null>(null);
  const [drillRow, setDrillRow] = useState<TrialBalanceRow | null>(null);
  const [drillResult, setDrillResult] = useState<any>(null);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportUnauthorized, setExportUnauthorized] = useState<string | null>(null);

  async function runReport() {
    setBusy(true);
    setError(null);
    setUnauthorized(null);
    setImbalance(null);
    setReport(null);
    try {
      const result = await goldenPathApi.getTrialBalance({
        entity,
        store: store || undefined,
        dept: dept || undefined,
        asOf,
      });
      setReport(result);
    } catch (err: any) {
      // BR222-1 / exception workflow: a real S014 structural error must
      // surface as a full-width banner, never a silently-unbalanced render.
      if (err.status === 500 && err.body?.error === 'STRUCTURAL_IMBALANCE') {
        setImbalance(err.body);
      } else if (err.status === 401 || err.status === 403) {
        setUnauthorized(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function drillToInquiry(row: TrialBalanceRow) {
    setDrillAccountCode(row.accountCode);
    setDrillRow(row);
    setDrillResult(null);
    setDrillError(null);
    if (!legalEntityId) {
      setDrillError('No legal entity selected in this session — cannot resolve a matching S220 account.');
      return;
    }
    try {
      const { accounts } = await goldenPathApi.listAccounts(legalEntityId);
      const match = accounts.find((a: any) => a.accountNumber === row.accountCode);
      if (!match) {
        // Honest gap: gl-service (S014) and coa-service (S220) are separate
        // ledgers today (ADR-JL-001). Cross-service drill only works when the
        // account number happens to also exist in this legal entity's COA.
        setDrillError(`No account numbered ${row.accountCode} exists in the current legal entity's Chart of Accounts — cross-service drill-through unavailable for this row.`);
        return;
      }
      // FINAL-R0 closure defect fix (UXMAP-03): real coa-service S220
      // QuerySchema only implements preset=OPEN_MONTH.
      const activity = await goldenPathApi.getAccountActivity(match.id, `preset=OPEN_MONTH`);
      setDrillResult(activity);
    } catch (err: any) {
      setDrillError(err.message);
    }
  }

  // PRODUCT CHECKPOINT (Golden R0 UI convergence, 2026-07-28) — real
  // server-side audited export, replacing the previous client-only CSV
  // generation. Reuses the exact same query params as the view (same
  // scoping), and surfaces the exact same STRUCTURAL_IMBALANCE banner the
  // view uses if the slice doesn't foot — the export can never succeed
  // where the view would fail closed. Duplicate-click prevention: the
  // button is disabled for the duration of the request.
  async function doExport() {
    if (exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    setExportUnauthorized(null);
    try {
      const text = await goldenPathApi.exportTrialBalance({
        entity,
        store: store || undefined,
        dept: dept || undefined,
        asOf,
      });
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trial-balance-${entity}-${asOf}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      if (err.status === 500 && err.body?.error === 'STRUCTURAL_IMBALANCE') {
        setImbalance(err.body);
      } else if (err.status === 401 || err.status === 403) {
        setExportUnauthorized(err.message);
      } else {
        setExportError(err.message);
      }
    } finally {
      setExportBusy(false);
    }
  }

  const rows = report ? (zeroSuppression ? report.accounts.filter((a) => a.endingBalance !== 0) : report.accounts) : [];

  // Subtotal-by-accountType — an aggregation of the rows already returned by
  // the API, not a recomputation of any dr/cr/ending value.
  const subtotalsByType = rows.reduce<Record<string, { debit: number; credit: number }>>((acc, r) => {
    const t = acc[r.accountType] ?? { debit: 0, credit: 0 };
    t.debit += r.debitBalance;
    t.credit += r.creditBalance;
    acc[r.accountType] = t;
    return acc;
  }, {});

  const status = imbalance
    ? { label: 'Out of balance', variant: 'danger' as const }
    : report
      ? { label: 'Balanced', variant: 'success' as const }
      : undefined;

  return (
    <ReportShell
      title="Trial Balance"
      description="Working trial balance for a legal entity, as of a fiscal month."
      status={status}
      actions={
        <ExportMenu
          disabled={exportBusy}
          formats={[{ key: 'csv', label: exportBusy ? 'Exporting…' : 'Export CSV', onSelect: doExport }]}
        />
      }
    >
      {error && <ErrorState testId="tb-error" message={error} />}
      {unauthorized && <UnauthorizedState testId="tb-unauthorized" message={unauthorized} />}

      {imbalance && (
        <Banner kind="error" testId="tb-structural-imbalance-banner" title="STRUCTURAL_IMBALANCE — this slice does not foot and was not rendered.">
          Debits {formatMoney(imbalance.drSum)} vs Credits {formatMoney(imbalance.crSum)} — delta {formatMoney(imbalance.delta)}
        </Banner>
      )}

      <FilterBar>
        <FilterField label="Entity/Company" width={130}>
          <input data-testid="tb-entity" value={entity} onChange={(e) => setEntity(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Store" width={90}>
          <input data-testid="tb-store" value={store} onChange={(e) => setStore(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Dept" width={90}>
          <input data-testid="tb-dept" value={dept} onChange={(e) => setDept(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="As of (YYYY-MM)" width={120}>
          <input data-testid="tb-asof" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <label className="flex items-center gap-1.5 h-8 text-[13px] text-slate-700">
          <input type="checkbox" checked={zeroSuppression} onChange={(e) => setZeroSuppression(e.target.checked)} data-testid="tb-zero-suppression" />
          Suppress zero balances
        </label>
        <Btn data-testid="tb-run" size="sm" onClick={runReport} disabled={busy} loading={busy}>
          {busy ? 'Loading…' : 'Run Trial Balance'}
        </Btn>
      </FilterBar>

      {busy && <LoadingState testId="tb-loading" label="Building trial balance…" />}
      {exportBusy && <LoadingState testId="tb-export-loading" label="Preparing export…" />}
      {exportError && <ErrorState testId="tb-export-error" message={exportError} />}
      {exportUnauthorized && <UnauthorizedState testId="tb-export-unauthorized" message={exportUnauthorized} />}

      {report && rows.length === 0 && (
        <EmptyState
          testId="tb-empty"
          title="No accounts to display"
          message={zeroSuppression ? 'Every account has a zero balance and zero balances are suppressed. Turn off suppression to see all accounts.' : 'No accounts were returned for this scope.'}
        />
      )}

      {report && rows.length > 0 && (
        <>
          <FinancialTable testId="tb-table">
            <ReportThead>
              <tr>
                <ReportTh>Account</ReportTh>
                <ReportTh>Name</ReportTh>
                <ReportTh>Type</ReportTh>
                <ReportTh align="right">Opening</ReportTh>
                <ReportTh align="right">Activity</ReportTh>
                <ReportTh align="right">Debit</ReportTh>
                <ReportTh align="right">Credit</ReportTh>
              </tr>
            </ReportThead>
            <tbody>
              {rows.map((r) => (
                <ReportTr key={r.accountId} testId={`tb-row-${r.accountCode}`} onClick={() => drillToInquiry(r)}>
                  <ReportTd>{r.accountCode}</ReportTd>
                  <ReportTd>{r.accountName}</ReportTd>
                  <ReportTd>{r.accountType}</ReportTd>
                  <MoneyTd value={r.priorBalance} />
                  <MoneyTd value={r.currentAmount} />
                  <MoneyTd value={r.debitBalance || null} />
                  <MoneyTd value={r.creditBalance || null} />
                </ReportTr>
              ))}
              {Object.entries(subtotalsByType).map(([type, sub]) => (
                <TotalsRow key={`subtotal-${type}`} testId={`tb-subtotal-${type}`}>
                  <ReportTd colSpan={5}>{type} subtotal</ReportTd>
                  <td className="px-3 text-right font-mono tabular-nums">{formatMoney(sub.debit)}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{formatMoney(sub.credit)}</td>
                </TotalsRow>
              ))}
              <TotalsRow testId="tb-grand-total" className="border-t-2 border-slate-900">
                <ReportTd colSpan={5}>Total</ReportTd>
                <td className="px-3 text-right font-mono tabular-nums">{formatMoney(report.drSum)}</td>
                <td className="px-3 text-right font-mono tabular-nums">{formatMoney(report.crSum)}</td>
              </TotalsRow>
            </tbody>
          </FinancialTable>

          <Drawer
            open={Boolean(drillAccountCode)}
            onClose={() => setDrillAccountCode(null)}
            title={`Drill-through — account ${drillAccountCode ?? ''}`}
            subtitle="Real S220 GL Inquiry"
            testId="tb-drill-panel"
          >
            {drillError && <ErrorState testId="tb-drill-error" message={drillError} />}
            {drillResult && (
              <div data-testid="tb-drill-result">
                <DrawerRow
                  label="Account"
                  value={<span data-testid="tb-drill-account">{drillResult.account?.accountNumber} — {drillResult.account?.name}</span>}
                />
                <DrawerRow
                  label="Period"
                  value={<span data-testid="tb-drill-period">{drillResult.range?.preset ?? drillResult.range?.periodCode ?? `${drillResult.range?.startDate} to ${drillResult.range?.endDate}`}</span>}
                />
                <DrawerRow label="Beginning balance" value={formatMoney(drillResult.beginningBalance ?? 0)} />
                <DrawerRow label="Ending balance" value={<span data-testid="tb-drill-ending-balance">{formatMoney(drillResult.endingBalance ?? 0)}</span>} />
                <DrawerRow label="Period debit" value={<span data-testid="tb-drill-period-debit">{formatMoney(drillResult.periodDebitActivity ?? 0)}</span>} />
                <DrawerRow label="Period credit" value={<span data-testid="tb-drill-period-credit">{formatMoney(drillResult.periodCreditActivity ?? 0)}</span>} />
                {drillRow && (
                  <div data-testid="tb-drill-source-row" className="mt-3 text-[12.5px] text-slate-500">
                    Trial Balance source row — Debit {formatMoney(drillRow.debitBalance)} — Credit {formatMoney(drillRow.creditBalance)}
                  </div>
                )}
                {(drillResult.lines ?? []).length > 0 && (
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Activity ({drillResult.lines.length})</div>
                    {(drillResult.lines ?? []).map((l: any, i: number) => (
                      <div key={l.journalEntryId ?? i} data-testid={`tb-drill-line-${i}`} className="text-[12.5px] py-1 border-b border-slate-100">
                        {l.entryDate} — {l.journalNumber} — DR {formatMoney(l.dr)} / CR {formatMoney(l.cr)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Drawer>
        </>
      )}

      {!report && !busy && !error && !unauthorized && !imbalance && (
        <EmptyState testId="tb-initial-state" title="Enter a scope and run the trial balance." />
      )}

      <RelatedLinks
        links={[
          { label: 'GL Search', to: '/golden-path/gl-search' },
          { label: 'Balance Sheet', to: '/golden-path/balance-sheet' },
          { label: 'Income Statement', to: '/golden-path/income-statement' },
          { label: 'Back to Journal Workflow', to: '/golden-path/journal' },
        ]}
      />
    </ReportShell>
  );
}
