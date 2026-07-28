import { useState } from 'react';
import { goldenPathApi } from '../../api/client';
import {
  EmptyState, ErrorState, LoadingState, MoneyTd, UnauthorizedState, formatMoney,
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd, TotalsRow,
  ExportMenu, RelatedLinks, Banner,
} from '../../components/report';
import { Btn } from '../../components/ui';

interface FSRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  amount: number;
}

interface BalanceSheetReport {
  scope: { entity: string; store: string | null; dept: string | null; asOf: string };
  assets: { rows: FSRow[]; total: number };
  liabilities: { rows: FSRow[]; total: number };
  equity: { rows: FSRow[]; total: number; currentEarnings: number };
  totalLiabilitiesAndEquity: number;
  excludedAccounts: Array<{ accountCode: string; accountType: string; reason: string }>;
  reconciledToTrialBalance: { drSum: number; crSum: number };
}

// Real, confirmed defect fix (Golden R0 UI convergence, Balance Sheet
// refinement, 2026-07-28): getBalanceSheet() calls TrialBalanceService
// .getReport() first -- if the underlying trial balance itself doesn't
// foot, it throws the TB-level StructuralImbalanceError, shape
// {drSum,crSum,delta}, a DIFFERENT real error from FSStructuralImbalanceError
// (assets != liabilities+equity on an already-footed slice), shape
// {totalAssets,totalLiabilitiesAndEquity,delta} -- confirmed by reading
// financial-statement-service.ts and routes.ts directly, both share the
// error code STRUCTURAL_IMBALANCE but never both sets of fields at once.
// This screen previously assumed only the FS-level shape, so a TB-level
// imbalance would have rendered "NaN" for both amounts. Both real shapes
// are now handled explicitly, never assumed.
interface StructuralImbalance {
  error: 'STRUCTURAL_IMBALANCE';
  totalAssets?: number;
  totalLiabilitiesAndEquity?: number;
  drSum?: number;
  crSum?: number;
  delta: number;
}

interface UnclassifiedError {
  error: 'UNCLASSIFIED_ACCOUNT_TYPE';
  // FINAL-R0 defect fix (Golden R0 closure): the real gl-service
  // UnclassifiedAccountTypeError contract (financial-statement-service.ts)
  // always returns a plural `accounts` array -- supports reporting MULTIPLE
  // unclassified accounts in one response.
  accounts: Array<{ accountCode: string; accountType: string }>;
}

function Section({ title, rows, total, testPrefix }: { title: string; rows: FSRow[]; total: number; testPrefix: string }) {
  return (
    <div className="mt-4">
      <h3 className="text-[14px] font-semibold text-slate-900 mb-1.5">{title}</h3>
      <FinancialTable testId={`${testPrefix}-table`}>
        <tbody>
          {rows.map((r) => (
            <ReportTr key={r.accountCode} testId={`${testPrefix}-row-${r.accountCode}`}>
              <ReportTd>{r.accountCode}</ReportTd>
              <ReportTd>{r.accountName}</ReportTd>
              <MoneyTd value={r.amount} />
            </ReportTr>
          ))}
          <TotalsRow testId={`${testPrefix}-total`}>
            <ReportTd colSpan={2}>Total {title}</ReportTd>
            <MoneyTd value={total} bold />
          </TotalsRow>
        </tbody>
      </FinancialTable>
    </div>
  );
}

const now = new Date();
const defaultAsOf = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

// FINAL-R0 / S227 — Balance Sheet Screen. Consumes the real gl-service
// FinancialStatementService API only — every asset/liability/equity amount
// and the currentEarnings/A=L+E figures shown are exactly what the API
// returned; no classification, contra-account sign, or net-income
// calculation happens client-side (per PO instruction #4/#9 for S227).
//
// Golden R0 UI convergence — Phase 3: migrated onto the shared
// ReportShell/FilterBar/FinancialTable foundation (components/report,
// Phase 2). All data-testids, API calls and calculations are unchanged,
// including the bs-balanced-badge element (kept verbatim — its exact
// "BALANCED"/"NOT BALANCED" text is asserted by
// tests/e2e/golden-path.spec.ts). Explicitly NOT added: comparative/
// prior-period columns, a rounding filter, or any client-side
// recomputation of backend totals -- none of these are supported by the
// real S227 contract.
export default function BalanceSheet() {
  const [entity, setEntity] = useState('01');
  const [store, setStore] = useState('');
  const [dept, setDept] = useState('');
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [report, setReport] = useState<BalanceSheetReport | null>(null);
  const [imbalance, setImbalance] = useState<StructuralImbalance | null>(null);
  const [unclassified, setUnclassified] = useState<UnclassifiedError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportUnauthorized, setExportUnauthorized] = useState<string | null>(null);

  async function runReport() {
    setBusy(true);
    setError(null);
    setUnauthorized(null);
    setImbalance(null);
    setUnclassified(null);
    setReport(null);
    setCsv(null);
    try {
      const result = await goldenPathApi.getBalanceSheet({
        entity,
        store: store || undefined,
        dept: dept || undefined,
        asOf,
      });
      setReport(result);
    } catch (err: any) {
      // Exception workflows per the accepted contract: a real structural
      // error or an unclassified account type must surface as a full-width
      // banner, never a silently-balanced or silently-dropped render.
      if (err.status === 500 && err.body?.error === 'STRUCTURAL_IMBALANCE') {
        setImbalance(err.body);
      } else if (err.status === 500 && err.body?.error === 'UNCLASSIFIED_ACCOUNT_TYPE') {
        setUnclassified(err.body);
      } else if (err.status === 401 || err.status === 403) {
        setUnauthorized(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    if (exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    setExportUnauthorized(null);
    try {
      const text = await goldenPathApi.exportBalanceSheet({
        entity,
        store: store || undefined,
        dept: dept || undefined,
        asOf,
      });
      setCsv(text);
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `balance-sheet-${entity}-${asOf}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      // The export route reuses the identical view computation, so it can
      // fail with the exact same two real error contracts -- reuse the same
      // banners rather than inventing a third, different message.
      if (err.status === 500 && err.body?.error === 'STRUCTURAL_IMBALANCE') {
        setImbalance(err.body);
      } else if (err.status === 500 && err.body?.error === 'UNCLASSIFIED_ACCOUNT_TYPE') {
        setUnclassified(err.body);
      } else if (err.status === 401 || err.status === 403) {
        setExportUnauthorized(err.message);
      } else {
        setExportError(err.message);
      }
    } finally {
      setExportBusy(false);
    }
  }

  const balanced = report ? Math.abs(report.assets.total - report.totalLiabilitiesAndEquity) < 0.005 : false;
  const isEmpty = !!report && report.assets.rows.length === 0 && report.liabilities.rows.length === 0 && report.equity.rows.length === 0;

  return (
    <ReportShell
      title="Balance Sheet"
      description="Assets, liabilities and equity for a legal entity, as of a fiscal month."
      actions={
        <ExportMenu
          disabled={exportBusy}
          formats={[{ key: 'csv', label: exportBusy ? 'Exporting…' : 'Export CSV', onSelect: doExport, testId: 'bs-export' }]}
        />
      }
    >
      {error && <ErrorState testId="bs-error" message={error} />}
      {unauthorized && <UnauthorizedState testId="bs-unauthorized" message={unauthorized} />}

      {imbalance && (
        <Banner kind="error" testId="bs-structural-imbalance-banner" title="STRUCTURAL_IMBALANCE">
          {imbalance.totalAssets !== undefined ? (
            <>
              Assets do not equal Liabilities + Equity for this slice; the statement was not rendered.
              <div>Assets {formatMoney(imbalance.totalAssets)} vs Liabilities+Equity {formatMoney(imbalance.totalLiabilitiesAndEquity!)} — delta {formatMoney(imbalance.delta)}</div>
            </>
          ) : (
            <>
              The underlying trial balance for this slice does not foot; the statement cannot be produced until it does.
              <div>Debits {formatMoney(imbalance.drSum ?? 0)} vs Credits {formatMoney(imbalance.crSum ?? 0)} — delta {formatMoney(imbalance.delta)}</div>
            </>
          )}
        </Banner>
      )}

      {unclassified && (
        <Banner kind="error" testId="bs-unclassified-banner" title="UNCLASSIFIED_ACCOUNT_TYPE">
          {unclassified.accounts.length === 1 ? 'Account' : 'Accounts'}{' '}
          {unclassified.accounts.map((a, i) => (
            <span key={a.accountCode}>
              {i > 0 && ', '}
              {a.accountCode} (type {a.accountType || 'EMPTY'})
            </span>
          ))}{' '}
          {unclassified.accounts.length === 1 ? 'is' : 'are'} not recognized by the approved Financial Statement Roll-Up Contract. The statement was not rendered.
        </Banner>
      )}

      <FilterBar>
        <FilterField label="Entity/Company" width={130}>
          <input data-testid="bs-entity" value={entity} onChange={(e) => setEntity(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Store" width={90}>
          <input data-testid="bs-store" value={store} onChange={(e) => setStore(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Dept" width={90}>
          <input data-testid="bs-dept" value={dept} onChange={(e) => setDept(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="As of (YYYY-MM)" width={120}>
          <input data-testid="bs-asof" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <Btn data-testid="bs-run" size="sm" onClick={runReport} disabled={busy} loading={busy}>
          {busy ? 'Loading…' : 'Run Balance Sheet'}
        </Btn>
      </FilterBar>

      {busy && <LoadingState testId="bs-loading" label="Producing balance sheet…" />}
      {exportBusy && <LoadingState testId="bs-export-loading" label="Preparing export…" />}
      {exportError && <ErrorState testId="bs-export-error" message={exportError} />}
      {exportUnauthorized && <UnauthorizedState testId="bs-export-unauthorized" message={exportUnauthorized} />}

      {report && isEmpty && (
        <EmptyState
          testId="bs-empty"
          title="No balance sheet data for this scope"
          message="No asset, liability or equity accounts were returned for this entity/store/department/period."
        />
      )}

      {report && !isEmpty && (
        <>
          <p className="text-[13px] text-slate-600 mt-1">
            Entity {report.scope.entity} — As of {report.scope.asOf}
            {report.scope.store ? ` — Store ${report.scope.store}` : ''}
            {report.scope.dept ? ` — Dept ${report.scope.dept}` : ''}
          </p>
          <div
            data-testid="bs-balanced-badge"
            className="inline-block px-2.5 py-1 rounded font-semibold text-[12.5px] mt-2"
            style={{
              background: balanced ? '#dcfce7' : '#fef2f2',
              color: balanced ? '#166534' : '#991b1b',
            }}
          >
            {balanced ? 'BALANCED' : 'NOT BALANCED'}
          </div>

          <Section title="Assets" rows={report.assets.rows} total={report.assets.total} testPrefix="bs-assets" />
          <Section title="Liabilities" rows={report.liabilities.rows} total={report.liabilities.total} testPrefix="bs-liabilities" />
          <Section title="Equity" rows={report.equity.rows} total={report.equity.total} testPrefix="bs-equity" />

          <FinancialTable className="mt-3">
            <tbody>
              <ReportTr testId="bs-current-earnings">
                <ReportTd colSpan={2}>Current-Period Earnings (included in Equity)</ReportTd>
                <MoneyTd value={report.equity.currentEarnings} />
              </ReportTr>
              <TotalsRow testId="bs-grand-total">
                <ReportTd colSpan={2}>Total Liabilities + Equity</ReportTd>
                <MoneyTd value={report.totalLiabilitiesAndEquity} bold />
              </TotalsRow>
              <ReportTr testId="bs-reconciled-tb" className="text-slate-500">
                <ReportTd colSpan={2}>Reconciled to Trial Balance (Dr / Cr)</ReportTd>
                <td className="px-3 text-right font-mono tabular-nums">{formatMoney(report.reconciledToTrialBalance.drSum)} / {formatMoney(report.reconciledToTrialBalance.crSum)}</td>
              </ReportTr>
            </tbody>
          </FinancialTable>

          {report.excludedAccounts.length > 0 && (
            <div data-testid="bs-excluded-accounts" className="mt-4 border border-amber-300 bg-amber-50 rounded-md p-3 text-[13px]">
              <strong>Out-of-scope accounts (excluded, not silently absorbed):</strong>
              <ul className="mt-1 pl-5 list-disc">
                {report.excludedAccounts.map((a) => (
                  <li key={a.accountCode}>{a.accountCode} ({a.accountType}) — {a.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {csv && (
            <pre data-testid="bs-csv-preview" className="mt-4 bg-slate-50 border border-slate-200 rounded-md p-3 text-[11px] overflow-x-auto">{csv}</pre>
          )}
        </>
      )}

      {!report && !error && !unauthorized && !imbalance && !unclassified && !busy && (
        <EmptyState testId="bs-initial-state" title="Run a Balance Sheet to see results." />
      )}

      <RelatedLinks
        links={[
          { label: 'Trial Balance', to: '/golden-path/trial-balance' },
          { label: 'Income Statement', to: '/golden-path/income-statement' },
          { label: 'Back to Journal Workflow', to: '/golden-path/journal' },
        ]}
      />
    </ReportShell>
  );
}
