// CE-12 gap-closure — shared journal drill-down for every CE-12 posting
// screen (VehicleUnitLedger, FloorplanWorkbench, DealPostingInquiry,
// DealAccountingDetail, ReserveChargeback, CitFundingWorkbench). CE-12's
// core rule is "no direct GL writes, no duplicate engines, always show the
// authoritative source" — this drawer is that authoritative source: it
// calls the real coa-service journal-view endpoint (goldenPathApi.getJournal,
// GET /api/v1/coa/journals/:number) rather than letting any CE-12 screen
// render a bare journal-number string with no way to verify it.
import { useQuery } from '@tanstack/react-query';
import { goldenPathApi } from '../../api/client';
import { Drawer, DrawerRow } from '../report/Drawer';
import { LoadingState, ErrorState, UnauthorizedState } from '../report/primitives';

function isUnauthorized(err: any) {
  return err?.status === 401 || err?.status === 403;
}

const fmt = (n: string | number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return String(n);
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function JournalDrillDrawer({ journalNumber, onClose }: { journalNumber: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['ce12-journal-drill', journalNumber],
    queryFn: () => goldenPathApi.getJournal(journalNumber),
    retry: false,
  });

  const j: any = q.data;

  return (
    <Drawer open onClose={onClose} title={`Journal ${journalNumber}`} subtitle="Real coa-service journal — authoritative source, never recomputed" testId="ce12-journal-drill-drawer">
      {q.isLoading && <LoadingState testId="ce12-journal-drill-loading" label="Loading journal…" />}
      {q.error && (isUnauthorized(q.error)
        ? <UnauthorizedState testId="ce12-journal-drill-unauthorized" message={(q.error as any).message} />
        : <ErrorState testId="ce12-journal-drill-error" message={(q.error as Error).message} onRetry={() => q.refetch()} />)}
      {j && (
        <div className="flex flex-col gap-2" data-testid="ce12-journal-drill-detail">
          <DrawerRow label="Status" value={j.status ?? '—'} />
          <DrawerRow label="Entry date" value={j.entryDate ?? '—'} />
          <DrawerRow label="Period" value={j.periodCode ?? '—'} />
          <DrawerRow label="Memo" value={j.memo ?? '—'} />
          <DrawerRow label="Source" value={j.source ?? '—'} />
          <DrawerRow label="Posted by" value={j.postedBy ?? '—'} />
          <DrawerRow label="Total debits" value={fmt(j.totalDebits)} />
          <DrawerRow label="Total credits" value={fmt(j.totalCredits)} />
          {j.reversalOfJournalNumber && <DrawerRow label="Reverses" value={j.reversalOfJournalNumber} />}
          {j.reversedByJournalNumber && <DrawerRow label="Reversed by" value={j.reversedByJournalNumber} />}
          <div className="text-xs font-semibold text-slate-600 mt-3 mb-1">Lines</div>
          <table className="w-full border-collapse" data-testid="ce12-journal-drill-lines">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">Account</th>
                <th className="px-2 py-1 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">Memo</th>
                <th className="px-2 py-1 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Debit</th>
                <th className="px-2 py-1 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Credit</th>
              </tr>
            </thead>
            <tbody>
              {((j.lines ?? []) as any[]).map((l, i) => (
                <tr key={l.lineIndex ?? i} className="border-b border-slate-100" data-testid={`ce12-journal-drill-line-${i}`}>
                  <td className="px-2 py-1 font-mono text-[12px]">{l.account ?? '—'}</td>
                  <td className="px-2 py-1 text-[12px] text-slate-500">{l.memo ?? '—'}</td>
                  <td className="px-2 py-1 text-right font-mono text-[12px]">{l.dr ? fmt(l.dr) : ''}</td>
                  <td className="px-2 py-1 text-right font-mono text-[12px]">{l.cr ? fmt(l.cr) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}
