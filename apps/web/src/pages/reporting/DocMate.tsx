// NS-044: DOC/Mate — Archived Document Viewer — Program 20
// Route: /reporting/doc-mate
//
// BR-GL-005: DOC/Mate BYPASSES journal source security — all data visible
// BR-GL-006: Same bypass for archived FS viewer

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, FileText, Download, Eye, Search, Calendar } from 'lucide-react';
import { eomApi, glApi } from '../../api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

type DocType = 'All' | 'Financial Statements' | 'Trial Balance' | 'GL Detail' | 'Schedule Reports' | 'Transaction Journals';

interface ArchivedDoc {
  id: string;
  date: string;
  type: Exclude<DocType, 'All'>;
  period: string;
  createdBy: string;
  size: string;
  content: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_DOCS: ArchivedDoc[] = [
  { id: 'd1', date: '2026-04-30', type: 'Financial Statements', period: 'April 2026', createdBy: 'EOM Close (ACCT_065)', size: '248 KB', content: 'IS/BS/CF/Dept tabs archived at EOM close' },
  { id: 'd2', date: '2026-04-30', type: 'Trial Balance', period: 'April 2026', createdBy: 'EOM Close (ACCT_065)', size: '184 KB', content: 'All accounts with debit/credit balances' },
  { id: 'd3', date: '2026-04-30', type: 'GL Detail', period: 'April 2026', createdBy: 'EOM Close (ACCT_065)', size: '1.2 MB', content: 'Complete GL transaction detail' },
  { id: 'd4', date: '2026-04-30', type: 'Schedule Reports', period: 'April 2026', createdBy: 'EOM Close (ACCT_065)', size: '312 KB', content: 'All schedule reconciliation reports' },
  { id: 'd5', date: '2026-04-30', type: 'Transaction Journals', period: 'April 2026', createdBy: 'EOM Close (ACCT_065)', size: '892 KB', content: 'Monthly transaction journals (Program 28)' },
  { id: 'd6', date: '2026-03-31', type: 'Financial Statements', period: 'March 2026', createdBy: 'EOM Close (ACCT_065)', size: '241 KB', content: 'IS/BS/CF/Dept tabs archived at EOM close' },
  { id: 'd7', date: '2026-03-31', type: 'Trial Balance', period: 'March 2026', createdBy: 'EOM Close (ACCT_065)', size: '179 KB', content: 'All accounts with debit/credit balances' },
];

const DOC_TYPE_OPTIONS: DocType[] = [
  'All',
  'Financial Statements',
  'Trial Balance',
  'GL Detail',
  'Schedule Reports',
  'Transaction Journals',
];

// ─── Mock viewer content ──────────────────────────────────────────────────────

function FinancialStatementsContent() {
  return (
    <div className="space-y-4">
      <h4 className="font-semibold text-gray-800">Income Statement — April 2026</h4>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Account</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600 font-mono">MTD</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600 font-mono">YTD</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['New Vehicle Sales', '1,245,600.00', '5,124,800.00'],
            ['Used Vehicle Sales', '687,200.00', '2,891,300.00'],
            ['Service Revenue', '189,400.00', '756,800.00'],
            ['Parts Revenue', '124,700.00', '498,900.00'],
            ['Total Revenue', '2,246,900.00', '9,271,800.00'],
            ['Cost of Sales', '(1,876,400.00)', '(7,689,200.00)'],
            ['Gross Profit', '370,500.00', '1,582,600.00'],
            ['Operating Expenses', '(218,300.00)', '(874,200.00)'],
            ['Net Income', '152,200.00', '708,400.00'],
          ].map(([label, mtd, ytd]) => (
            <tr key={label} className={`border-b border-gray-100 h-9 ${label.startsWith('Total') || label === 'Net Income' || label === 'Gross Profit' ? 'font-semibold bg-brand-light' : ''}`}>
              <td className="px-3 text-gray-800">{label}</td>
              <td className="px-3 text-right font-mono text-gray-800">{mtd}</td>
              <td className="px-3 text-right font-mono text-gray-800">{ytd}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrialBalanceContent() {
  return (
    <div className="space-y-4">
      <h4 className="font-semibold text-gray-800">Trial Balance — April 2026</h4>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Account #</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Account Name</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600 font-mono">Debit</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600 font-mono">Credit</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['1000', 'Cash — Operating', '248,300.00', ''],
            ['1200', 'Accounts Receivable', '124,700.00', ''],
            ['2000', 'Accounts Payable', '', '87,400.00'],
            ['3000', 'Common Stock', '', '500,000.00'],
            ['4000', 'New Vehicle Sales', '', '1,245,600.00'],
            ['5000', 'Cost of Sales', '1,012,400.00', ''],
            ['TOTAL', '', '1,385,400.00', '1,833,000.00'],
          ].map(([acct, name, dr, cr]) => (
            <tr key={acct} className={`border-b border-gray-100 h-9 ${acct === 'TOTAL' ? 'font-semibold bg-brand-light border-t-2 border-brand-border' : ''}`}>
              <td className="px-3 font-mono text-gray-700">{acct}</td>
              <td className="px-3 text-gray-800">{name}</td>
              <td className="px-3 text-right font-mono text-gray-800">{dr}</td>
              <td className="px-3 text-right font-mono text-gray-800">{cr}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GLDetailContent() {
  return (
    <div className="space-y-4">
      <h4 className="font-semibold text-gray-800">GL Detail — April 2026</h4>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Date</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Source</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Reference</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Account</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600 font-mono">Amount</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Comment</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['04/01', '88', 'REF-2001', '1000', '50,000.00', 'Opening balance'],
            ['04/03', '30', 'REF-2002', '4000', '(15,400.00)', 'Service RO batch'],
            ['04/05', '32', 'REF-2003', '4100', '(8,700.00)', 'Parts sales batch'],
            ['04/10', '88', 'REF-2004', '5000', '12,800.00', 'COGS entry'],
            ['04/15', '3', 'REF-2005', '2000', '(4,200.00)', 'AP payment'],
            ['04/20', '40', 'REF-2006', '1200', '9,600.00', 'Warranty remittance'],
            ['04/25', '88', 'REF-2007', '6000', '3,400.00', 'Expense accrual'],
            ['04/28', '88', 'REF-2008', '1000', '22,100.00', 'Deposit'],
            ['04/29', '88', 'REF-2009', '3000', '(1,800.00)', 'Distribution'],
            ['04/30', '88', 'REF-2010', '7000', '5,200.00', 'EOM accrual'],
          ].map(([date, src, ref, acct, amt, comment]) => (
            <tr key={ref} className="border-b border-gray-100 h-9 odd:bg-white even:bg-gray-50 hover:bg-brand-light">
              <td className="px-3 font-mono text-gray-700 text-xs">{date}</td>
              <td className="px-3 text-gray-700">{src}</td>
              <td className="px-3 font-mono text-gray-700 text-xs">{ref}</td>
              <td className="px-3 font-mono text-gray-700">{acct}</td>
              <td className={`px-3 text-right font-mono ${amt.startsWith('(') ? 'text-red-600' : 'text-gray-800'}`}>{amt}</td>
              <td className="px-3 text-gray-500 text-xs">{comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScheduleReportsContent() {
  return (
    <div className="space-y-4">
      <h4 className="font-semibold text-gray-800">Schedule Reconciliation — April 2026</h4>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Control #</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Name</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600 font-mono">Balance</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600">Age Days</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['CTL-101', 'New Vehicle Flooring', '124,800.00', '14', 'OPEN'],
            ['CTL-102', 'Service WIP', '18,400.00', '7', 'OPEN'],
            ['CTL-103', 'Parts Inventory', '67,200.00', '30', 'OPEN'],
            ['CTL-104', 'Factory Holdback', '22,100.00', '45', 'OPEN'],
            ['CTL-105', 'Warranty Reserve', '8,900.00', '3', 'OPEN'],
          ].map(([ctrl, name, bal, age, status]) => (
            <tr key={ctrl} className="border-b border-gray-100 h-9 odd:bg-white even:bg-gray-50 hover:bg-brand-light">
              <td className="px-3 font-mono text-gray-700 text-xs">{ctrl}</td>
              <td className="px-3 text-gray-800">{name}</td>
              <td className="px-3 text-right font-mono text-gray-800">{bal}</td>
              <td className="px-3 text-right text-gray-600">{age}</td>
              <td className="px-3">
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded font-semibold">{status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransactionJournalsContent() {
  return (
    <div className="space-y-4">
      <h4 className="font-semibold text-gray-800">Transaction Journals — April 2026 (Program 28)</h4>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Batch</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Source</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Date</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600 font-mono">Debits</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600 font-mono">Credits</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['B-0401', '88', '04/01', '50,000.00', '50,000.00', 'Manual journal entries'],
            ['B-0403', '30', '04/03', '15,400.00', '15,400.00', 'Service RO batch'],
            ['B-0405', '32', '04/05', '8,700.00', '8,700.00', 'Parts sales batch'],
            ['B-0410', '88', '04/10', '12,800.00', '12,800.00', 'COGS entries'],
            ['B-0415', '3', '04/15', '4,200.00', '4,200.00', 'Prior month adj.'],
            ['B-0420', '40', '04/20', '9,600.00', '9,600.00', 'Warranty remittance'],
            ['B-0428', '88', '04/28', '22,100.00', '22,100.00', 'Deposit clearing'],
            ['TOTAL', '', '', '122,800.00', '122,800.00', ''],
          ].map(([batch, src, date, dr, cr, desc]) => (
            <tr key={batch} className={`border-b border-gray-100 h-9 ${batch === 'TOTAL' ? 'font-semibold bg-brand-light border-t-2 border-brand-border' : 'odd:bg-white even:bg-gray-50 hover:bg-brand-light'}`}>
              <td className="px-3 font-mono text-gray-700 text-xs">{batch}</td>
              <td className="px-3 text-gray-700">{src}</td>
              <td className="px-3 font-mono text-gray-600 text-xs">{date}</td>
              <td className="px-3 text-right font-mono text-gray-800">{dr}</td>
              <td className="px-3 text-right font-mono text-gray-800">{cr}</td>
              <td className="px-3 text-gray-500 text-xs">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocumentContent({ doc }: { doc: ArchivedDoc }) {
  switch (doc.type) {
    case 'Financial Statements': return <FinancialStatementsContent />;
    case 'Trial Balance': return <TrialBalanceContent />;
    case 'GL Detail': return <GLDetailContent />;
    case 'Schedule Reports': return <ScheduleReportsContent />;
    case 'Transaction Journals': return <TransactionJournalsContent />;
    default: return <p className="text-gray-500 text-sm">Document content not available.</p>;
  }
}

// ─── Document Viewer Modal ────────────────────────────────────────────────────

function DocumentViewerModal({ doc, onClose }: { doc: ArchivedDoc; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <FileText size={20} className="text-brand" />
            <div>
              <h3 className="font-bold text-gray-900">{doc.type}</h3>
              <p className="text-xs text-gray-500">{doc.period} · {doc.size} · {doc.createdBy}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none font-light">&times;</button>
        </div>

        {/* Security bypass notice */}
        <div className="mx-6 mt-4 flex-shrink-0">
          <div className="flex items-start gap-2 bg-brand-light border border-brand-border rounded-lg px-4 py-2.5">
            <span className="text-brand mt-0.5 flex-shrink-0">&#x24D8;</span>
            <p className="text-brand text-xs leading-relaxed">
              Showing all data — journal source security bypassed for archived documents (BR-GL-005/BR-GL-006).
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <DocumentContent doc={doc} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 h-8 px-3 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
          >
            <FileText size={13} /> Print
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 h-8 px-4 bg-brand text-white rounded text-sm hover:bg-brand-hover"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DocMate() {
  const [docType, setDocType] = useState<DocType>('All');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [keyword, setKeyword] = useState('');
  const [searchTriggered, setSearchTriggered] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<ArchivedDoc | null>(null);
  const [downloadError, setDownloadError] = useState<string>('');

  // Attempt to fetch from real archive API; merge with mock if successful
  const archiveQuery = useQuery({
    queryKey: ['archived-statements'],
    queryFn: () => glApi.getArchivedStatements(),
    retry: false,
  });

  const allDocs: ArchivedDoc[] = useMemo(() => {
    const apiDocs: ArchivedDoc[] = archiveQuery.data
      ? (archiveQuery.data as any[]).map((d: any) => ({
          id: d.id ?? String(Math.random()),
          date: d.archivedAt?.slice(0, 10) ?? d.date ?? '',
          type: (d.documentType ?? d.type ?? 'Financial Statements') as ArchivedDoc['type'],
          period: d.period ?? '',
          createdBy: d.createdBy ?? 'System',
          size: d.size ?? '—',
          content: d.content ?? '',
        }))
      : [];

    // Merge: API docs first, then mock docs with IDs not already present
    const seen = new Set(apiDocs.map(d => d.id));
    const merged = [...apiDocs, ...MOCK_DOCS.filter(m => !seen.has(m.id))];
    return merged;
  }, [archiveQuery.data]);

  const filteredDocs = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return allDocs.filter(doc => {
      if (docType !== 'All' && doc.type !== docType) return false;
      if (fromDate && doc.date < fromDate) return false;
      if (toDate && doc.date > toDate) return false;
      if (kw && !doc.type.toLowerCase().includes(kw) && !doc.period.toLowerCase().includes(kw) && !doc.content.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [allDocs, docType, fromDate, toDate, keyword, searchTriggered]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    setSearchTriggered(t => !t);
    setDownloadError('');
  };

  const handleDownload = async (doc: ArchivedDoc) => {
    setDownloadError('');
    try {
      await glApi.getArchivedStatement(doc.id);
    } catch {
      setDownloadError(`Download not available for this demo document.`);
      setTimeout(() => setDownloadError(''), 4000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-3xl font-bold flex items-center gap-2" style={{ fontFamily: 'Inter, sans-serif' }}>
          <Archive size={28} className="text-brand" />
          DOC/Mate
        </h1>
        <p className="text-gray-500 mt-1 text-sm">Archived Document Viewer — Program 20</p>
      </div>

      {/* Security bypass banner — always visible per BR-GL-005 */}
      <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 mb-6">
        <span className="text-amber-600 text-lg leading-none flex-shrink-0 mt-0.5">&#x26A0;</span>
        <p className="text-amber-800 text-sm leading-relaxed">
          <span className="font-semibold">Security Bypass Active:</span> Archived documents display all data regardless of journal source permissions.
          This is by design (<span className="font-mono text-xs">BR-GL-005</span>/<span className="font-mono text-xs">BR-GL-006</span>). All sources are visible here.
        </p>
      </div>

      {/* Download error */}
      {downloadError && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 mb-4">
          <span className="text-red-700 text-sm">{downloadError}</span>
          <button onClick={() => setDownloadError('')} className="ml-auto text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}

      {/* Search + Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Document Type</label>
            <select
              value={docType}
              onChange={e => setDocType(e.target.value as DocType)}
              className="h-8 w-56 border border-gray-300 rounded px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {DOC_TYPE_OPTIONS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
              <Calendar size={11} /> From
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 border border-gray-300 rounded px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
              <Calendar size={11} /> To
            </label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 border border-gray-300 rounded px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Keyword</label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search content..."
              className="h-8 w-48 border border-gray-300 rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <button
            onClick={handleSearch}
            className="flex items-center gap-1.5 h-8 px-4 bg-brand text-white rounded text-sm font-medium hover:bg-brand-hover"
          >
            <Search size={14} /> Search
          </button>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">
            Archived Documents
            <span className="ml-2 text-xs text-gray-400 font-normal">{filteredDocs.length} document{filteredDocs.length !== 1 ? 's' : ''}</span>
          </span>
          {archiveQuery.isError && (
            <span className="text-xs text-amber-600">API unavailable — showing demo data</span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap">Date</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap">Type</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap">Period</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap">Created By</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap">Size</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">
                    No archived documents match your search criteria.
                  </td>
                </tr>
              ) : (
                filteredDocs.map((doc, idx) => (
                  <tr
                    key={doc.id}
                    className={`h-9 border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-brand-light`}
                  >
                    <td className="px-4 text-gray-700 font-mono text-xs whitespace-nowrap">{doc.date}</td>
                    <td className="px-4 text-gray-800 whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <FileText size={13} className="text-gray-400 flex-shrink-0" />
                        {doc.type}
                      </span>
                    </td>
                    <td className="px-4 text-gray-700 whitespace-nowrap">{doc.period}</td>
                    <td className="px-4 text-gray-500 text-xs whitespace-nowrap">{doc.createdBy}</td>
                    <td className="px-4 text-right font-mono text-gray-600 text-xs whitespace-nowrap">{doc.size}</td>
                    <td className="px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedDoc(doc)}
                          className="flex items-center gap-1 h-7 px-2.5 border border-gray-300 text-gray-700 rounded text-xs hover:bg-gray-50 whitespace-nowrap"
                          title="View document"
                        >
                          <Eye size={12} /> View
                        </button>
                        <button
                          onClick={() => handleDownload(doc)}
                          className="flex items-center gap-1 h-7 px-2.5 border border-gray-300 text-gray-700 rounded text-xs hover:bg-gray-50 whitespace-nowrap"
                          title="Download PDF"
                        >
                          <Download size={12} /> PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Document Viewer Modal */}
      {selectedDoc && (
        <DocumentViewerModal
          doc={selectedDoc}
          onClose={() => setSelectedDoc(null)}
        />
      )}
    </div>
  );
}
