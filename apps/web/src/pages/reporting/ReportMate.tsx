// NS-039 through NS-043: Report/Mate — Custom Report Builder
// Route: /reporting/report-mate

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart2, FileText, Play, Save, Download, Calendar,
  Trash2, Plus, Settings, ChevronDown,
} from 'lucide-react';
import { reportApi } from '../../api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

type ReportType = 'GL' | 'Schedule' | 'Sales Tax' | 'DOC' | 'Custom';
type SortDir = 'ASC' | 'DESC';
type ScheduleFreq = 'Daily' | 'Weekly' | 'Monthly';
type ScheduleDelivery = 'Email' | 'File';

interface FilterRow {
  id: string;
  field: string;
  operator: 'equals' | 'contains' | 'greater than' | 'less than' | 'between';
  value: string;
}

interface SavedReport {
  id: string;
  name: string;
  type: ReportType;
  createdAt: string;
  fields: string[];
  filters: FilterRow[];
  sortField: string;
  sortDir: SortDir;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_REPORTS: SavedReport[] = [
  { id: 'r1', name: 'Monthly GL Summary', type: 'GL', createdAt: '2026-05-01', fields: ['account', 'amount', 'date'], filters: [], sortField: 'date', sortDir: 'ASC' },
  { id: 'r2', name: 'Sales Tax by Jurisdiction', type: 'Sales Tax', createdAt: '2026-04-15', fields: ['jurisdiction', 'taxableAmt', 'taxAmt', 'rate'], filters: [], sortField: 'jurisdiction', sortDir: 'ASC' },
  { id: 'r3', name: 'Open Schedule Balances', type: 'Schedule', createdAt: '2026-03-20', fields: ['controlNum', 'name', 'balance', 'ageDays'], filters: [], sortField: 'ageDays', sortDir: 'DESC' },
];

const FIELDS_BY_TYPE: Record<ReportType, { key: string; label: string }[]> = {
  GL: [
    { key: 'account', label: 'Account #' },
    { key: 'accountName', label: 'Account Name' },
    { key: 'date', label: 'Date' },
    { key: 'source', label: 'Source' },
    { key: 'referenceNum', label: 'Reference #' },
    { key: 'amount', label: 'Amount' },
    { key: 'controlNum', label: 'Control #' },
    { key: 'comment', label: 'Comment' },
    { key: 'runningBalance', label: 'Running Balance' },
    { key: 'postedBy', label: 'Posted By' },
  ],
  Schedule: [
    { key: 'controlNum', label: 'Control #' },
    { key: 'name', label: 'Name' },
    { key: 'scheduleNum', label: 'Schedule #' },
    { key: 'date', label: 'Date' },
    { key: 'referenceNum', label: 'Reference #' },
    { key: 'amount', label: 'Amount' },
    { key: 'applyTo', label: 'Apply-To' },
    { key: 'comment', label: 'Comment' },
    { key: 'ageDays', label: 'Age Days' },
  ],
  'Sales Tax': [
    { key: 'jurisdiction', label: 'Jurisdiction' },
    { key: 'taxableAmt', label: 'Taxable Amount' },
    { key: 'taxAmt', label: 'Tax Amount' },
    { key: 'rate', label: 'Rate' },
    { key: 'period', label: 'Period' },
    { key: 'glAccount', label: 'GL Account' },
  ],
  DOC: [
    { key: 'documentType', label: 'Document Type' },
    { key: 'period', label: 'Period' },
    { key: 'createdBy', label: 'Created By' },
    { key: 'date', label: 'Date' },
    { key: 'size', label: 'Size' },
  ],
  Custom: [
    { key: 'account', label: 'Account #' },
    { key: 'accountName', label: 'Account Name' },
    { key: 'date', label: 'Date' },
    { key: 'source', label: 'Source' },
    { key: 'referenceNum', label: 'Reference #' },
    { key: 'amount', label: 'Amount' },
    { key: 'controlNum', label: 'Control #' },
    { key: 'comment', label: 'Comment' },
    { key: 'runningBalance', label: 'Running Balance' },
    { key: 'postedBy', label: 'Posted By' },
    { key: 'name', label: 'Name' },
    { key: 'scheduleNum', label: 'Schedule #' },
    { key: 'applyTo', label: 'Apply-To' },
    { key: 'ageDays', label: 'Age Days' },
    { key: 'jurisdiction', label: 'Jurisdiction' },
    { key: 'taxableAmt', label: 'Taxable Amount' },
    { key: 'taxAmt', label: 'Tax Amount' },
    { key: 'rate', label: 'Rate' },
    { key: 'period', label: 'Period' },
    { key: 'glAccount', label: 'GL Account' },
    { key: 'documentType', label: 'Document Type' },
    { key: 'createdBy', label: 'Created By' },
    { key: 'size', label: 'Size' },
  ],
};

const TYPE_DESCRIPTIONS: Record<ReportType, string> = {
  GL: 'General Ledger transactions and balances',
  Schedule: 'Schedule items with aging and balances',
  'Sales Tax': 'Tax accruals by jurisdiction and period',
  DOC: 'Archived document metadata',
  Custom: 'All fields — build any report',
};

const TYPE_BADGE_COLORS: Record<ReportType, string> = {
  GL: 'bg-brand-light text-brand',
  Schedule: 'bg-purple-100 text-purple-700',
  'Sales Tax': 'bg-green-100 text-green-700',
  DOC: 'bg-amber-100 text-amber-700',
  Custom: 'bg-gray-100 text-gray-700',
};

const OPERATORS = ['equals', 'contains', 'greater than', 'less than', 'between'] as const;

// ─── Mock result generators ───────────────────────────────────────────────────

function generateMockResults(report: SavedReport): any[] {
  const rows: any[] = [];
  const count = 10;
  for (let i = 0; i < count; i++) {
    const row: any = {};
    for (const key of report.fields) {
      switch (key) {
        case 'account': row[key] = `${1000 + i * 10}`; break;
        case 'accountName': row[key] = ['Cash', 'AR', 'Inventory', 'Revenue', 'COGS', 'Expenses', 'AP', 'Equity', 'Deposits', 'Accruals'][i % 10]; break;
        case 'date': row[key] = `2026-05-${String(i + 1).padStart(2, '0')}`; break;
        case 'source': row[key] = ['88', '3', '30', '32', '40'][i % 5]; break;
        case 'referenceNum': row[key] = `REF-${2000 + i}`; break;
        case 'amount': row[key] = ((i + 1) * 1234.56 * (i % 2 === 0 ? 1 : -1)).toFixed(2); break;
        case 'controlNum': row[key] = `CTL-${100 + i}`; break;
        case 'comment': row[key] = `Entry ${i + 1} comment`; break;
        case 'runningBalance': row[key] = ((i + 1) * 5678.90).toFixed(2); break;
        case 'postedBy': row[key] = ['jsmith', 'adoe', 'mbrown'][i % 3]; break;
        case 'name': row[key] = `Schedule Item ${i + 1}`; break;
        case 'scheduleNum': row[key] = `${40 + i}`; break;
        case 'applyTo': row[key] = `CTL-${200 + i}`; break;
        case 'ageDays': row[key] = (i + 1) * 7; break;
        case 'balance': row[key] = ((i + 1) * 3456.78).toFixed(2); break;
        case 'jurisdiction': row[key] = ['IL - Cook', 'IL - Kane', 'WI - Kenosha', 'IL - DuPage', 'WI - Racine'][i % 5]; break;
        case 'taxableAmt': row[key] = ((i + 1) * 15000).toFixed(2); break;
        case 'taxAmt': row[key] = ((i + 1) * 15000 * 0.0625).toFixed(2); break;
        case 'rate': row[key] = '6.25%'; break;
        case 'period': row[key] = 'April 2026'; break;
        case 'glAccount': row[key] = `${2300 + i}`; break;
        case 'documentType': row[key] = ['FS', 'TB', 'GL', 'SCHED', 'TJ'][i % 5]; break;
        case 'createdBy': row[key] = 'EOM Close (ACCT_065)'; break;
        case 'size': row[key] = `${(i + 1) * 48} KB`; break;
        default: row[key] = `—`;
      }
    }
    rows.push(row);
  }
  return rows;
}

const MONEY_KEYS = new Set(['amount', 'runningBalance', 'balance', 'taxableAmt', 'taxAmt']);

function isMoney(key: string): boolean {
  return MONEY_KEYS.has(key);
}

function fmtCell(key: string, val: any): string {
  if (val === undefined || val === null) return '—';
  if (isMoney(key)) {
    const n = parseFloat(String(val));
    if (isNaN(n)) return String(val);
    const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? `(${abs})` : abs;
  }
  return String(val);
}

function fieldLabel(key: string, type: ReportType): string {
  const all = FIELDS_BY_TYPE[type] ?? FIELDS_BY_TYPE.Custom;
  return all.find(f => f.key === key)?.label ?? key;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'reportmate-saved';

function loadSaved(): SavedReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_REPORTS));
      return DEFAULT_REPORTS;
    }
    return JSON.parse(raw) as SavedReport[];
  } catch {
    return DEFAULT_REPORTS;
  }
}

function persistSaved(reports: SavedReport[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: ReportType }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${TYPE_BADGE_COLORS[type]}`}>
      {type}
    </span>
  );
}

function SuccessBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4">
      <span className="text-green-700 text-sm font-medium flex-1">{message}</span>
      <button onClick={onDismiss} className="text-green-500 hover:text-green-700 text-lg leading-none">&times;</button>
    </div>
  );
}

// ─── Schedule Modal ───────────────────────────────────────────────────────────

function ScheduleModal({ onClose }: { onClose: () => void }) {
  const [freq, setFreq] = useState<ScheduleFreq>('Monthly');
  const [delivery, setDelivery] = useState<ScheduleDelivery>('Email');
  const [email, setEmail] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(onClose, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Calendar size={18} className="text-brand" />
            Schedule Report
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {saved && <SuccessBanner message="Schedule saved successfully." onDismiss={onClose} />}

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Frequency</label>
            <div className="flex gap-3">
              {(['Daily', 'Weekly', 'Monthly'] as ScheduleFreq[]).map(f => (
                <label key={f} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="freq" checked={freq === f} onChange={() => setFreq(f)} className="accent-blue-600" />
                  <span className="text-sm">{f}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Delivery</label>
            <div className="flex gap-3">
              {(['Email', 'File'] as ScheduleDelivery[]).map(d => (
                <label key={d} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="delivery" checked={delivery === d} onChange={() => setDelivery(d)} className="accent-blue-600" />
                  <span className="text-sm">{d}</span>
                </label>
              ))}
            </div>
          </div>

          {delivery === 'Email' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="accounting@dealership.com"
                className="h-8 w-full border border-gray-300 rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">File Destination</label>
              <p className="text-sm text-gray-500 font-mono bg-gray-50 border border-gray-200 rounded px-3 py-2">/reports/scheduled/</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="h-8 px-4 border border-gray-300 rounded text-sm hover:bg-gray-50">Cancel</button>
            <button
              onClick={handleSave}
              disabled={delivery === 'Email' && !email.trim()}
              className="h-8 px-4 bg-brand text-white rounded text-sm hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save Schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReportMate() {
  const [activeTab, setActiveTab] = useState<'my-reports' | 'build' | 'run'>('my-reports');

  // ── My Reports state ──
  const [savedReports, setSavedReports] = useState<SavedReport[]>(loadSaved);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState('');

  // ── Build Report state ──
  const [buildType, setBuildType] = useState<ReportType>('GL');
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [sortField, setSortField] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('ASC');
  const [reportName, setReportName] = useState('');

  // ── Run Report state ──
  const [runReportId, setRunReportId] = useState('');
  const [runFromDate, setRunFromDate] = useState('2026-04-01');
  const [runToDate, setRunToDate] = useState('2026-04-30');
  const [runCompany, setRunCompany] = useState('01');
  const [isRunning, setIsRunning] = useState(false);
  const [runResults, setRunResults] = useState<any[] | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  const queryClient = useQueryClient();

  // Query for report history (used lightly — primary data is localStorage)
  useQuery({
    queryKey: ['report-history'],
    queryFn: reportApi.getHistory,
    retry: false,
  });

  const scheduleMut = useMutation({
    mutationFn: (data: any) => reportApi.schedule(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['report-history'] }),
  });

  // ── Helpers ──

  const syncSaved = (updated: SavedReport[]) => {
    setSavedReports(updated);
    persistSaved(updated);
  };

  const deleteReport = (id: string) => {
    syncSaved(savedReports.filter(r => r.id !== id));
    setDeleteConfirm(null);
    if (runReportId === id) setRunReportId('');
  };

  const editReport = (report: SavedReport) => {
    setBuildType(report.type);
    setSelectedFields(new Set(report.fields));
    setFilters(report.filters);
    setSortField(report.sortField);
    setSortDir(report.sortDir);
    setReportName(report.name);
    setActiveTab('build');
  };

  const runReport = (report: SavedReport) => {
    setRunReportId(report.id);
    setActiveTab('run');
  };

  const availableFields = FIELDS_BY_TYPE[buildType];

  const toggleField = (key: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addFilter = () => {
    if (filters.length >= 5) return;
    setFilters(prev => [...prev, {
      id: `f-${Date.now()}`,
      field: availableFields[0]?.key ?? '',
      operator: 'equals',
      value: '',
    }]);
  };

  const removeFilter = (id: string) => setFilters(prev => prev.filter(f => f.id !== id));

  const updateFilter = (id: string, patch: Partial<FilterRow>) => {
    setFilters(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  };

  const canSave = reportName.trim().length > 0 && selectedFields.size > 0;

  const saveReport = () => {
    const report: SavedReport = {
      id: `r-${Date.now()}`,
      name: reportName.trim(),
      type: buildType,
      createdAt: new Date().toISOString().slice(0, 10),
      fields: [...selectedFields],
      filters,
      sortField: sortField || (availableFields[0]?.key ?? ''),
      sortDir,
    };
    const updated = savedReports.filter(r => r.name !== report.name).concat(report);
    syncSaved(updated);
    setSuccessBanner(`Report saved: ${report.name}`);
    setTimeout(() => setSuccessBanner(''), 4000);
  };

  const selectedRunReport = savedReports.find(r => r.id === runReportId);

  const handleRun = () => {
    if (!selectedRunReport) return;
    setIsRunning(true);
    setRunResults(null);
    setTimeout(() => {
      setRunResults(generateMockResults(selectedRunReport));
      setIsRunning(false);
    }, 1500);
  };

  const exportCsv = () => {
    if (!runResults || !selectedRunReport) return;
    const fields = selectedRunReport.fields;
    const header = fields.map(k => fieldLabel(k, selectedRunReport.type));
    const rows = runResults.map(row => fields.map(k => fmtCell(k, row[k])));
    const csv = [header, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedRunReport.name.replace(/\s+/g, '_')}_${runFromDate}_${runToDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totals = (runResults && selectedRunReport)
    ? selectedRunReport.fields.reduce((acc: any, key) => {
        if (isMoney(key)) {
          acc[key] = runResults.reduce((sum, row) => sum + (parseFloat(row[key]) || 0), 0);
        }
        return acc;
      }, {})
    : null;

  // ── Render tabs ──

  const TAB_ITEMS = [
    { id: 'my-reports' as const, label: 'My Reports', icon: <FileText size={15} /> },
    { id: 'build' as const, label: 'Build Report', icon: <Settings size={15} /> },
    { id: 'run' as const, label: 'Run Report', icon: <Play size={15} /> },
  ];

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2" style={{ fontFamily: 'Inter, sans-serif' }}>
          <BarChart2 size={28} className="text-brand" />
          Report/Mate
        </h1>
        <p className="text-gray-500 mt-1 text-sm">Custom report builder — build, save, and schedule reports</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-0">
          {TAB_ITEMS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-brand'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════ TAB: MY REPORTS ══════════════ */}
      {activeTab === 'my-reports' && (
        <div>
          {successBanner && <SuccessBanner message={successBanner} onDismiss={() => setSuccessBanner('')} />}

          {savedReports.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
              <BarChart2 size={40} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No saved reports yet. Use &apos;Build Report&apos; to create your first custom report.</p>
            </div>
          ) : (
            <div>
              {savedReports.map(report => (
                <div key={report.id} className="bg-white border border-gray-200 rounded-lg p-4 mb-3 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">{report.name}</span>
                        <TypeBadge type={report.type} />
                      </div>
                      <span className="text-xs text-gray-400">Created {report.createdAt}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => runReport(report)}
                      className="flex items-center gap-1.5 h-8 px-3 bg-brand text-white rounded text-sm hover:bg-brand-hover font-medium"
                    >
                      <Play size={13} /> Run
                    </button>
                    <button
                      onClick={() => editReport(report)}
                      className="flex items-center gap-1.5 h-8 px-3 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    {deleteConfirm === report.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-red-600 mr-1">Delete?</span>
                        <button onClick={() => deleteReport(report.id)} className="h-8 px-2 bg-red-600 text-white rounded text-xs hover:bg-red-700">Yes</button>
                        <button onClick={() => setDeleteConfirm(null)} className="h-8 px-2 border border-gray-300 rounded text-xs hover:bg-gray-50">No</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteConfirm(report.id)} className="h-8 w-8 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════ TAB: BUILD REPORT ══════════════ */}
      {activeTab === 'build' && (
        <div className="space-y-6">
          {successBanner && <SuccessBanner message={successBanner} onDismiss={() => setSuccessBanner('')} />}

          {/* Section 1: Report Type */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-brand-light text-brand text-xs font-bold flex items-center justify-center">1</span>
              Report Type
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(Object.keys(FIELDS_BY_TYPE) as ReportType[]).map(type => (
                <label
                  key={type}
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    buildType === type
                      ? 'border-blue-600 bg-brand-light'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="reportType"
                    value={type}
                    checked={buildType === type}
                    onChange={() => {
                      setBuildType(type);
                      setSelectedFields(new Set());
                      setSortField('');
                    }}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div>
                    <div className="font-semibold text-sm text-gray-900">{type}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{TYPE_DESCRIPTIONS[type]}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Section 2: Fields */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-brand-light text-brand text-xs font-bold flex items-center justify-center">2</span>
                Fields
                {selectedFields.size > 0 && (
                  <span className="ml-1 px-2 py-0.5 bg-brand-light text-brand text-xs rounded-full font-semibold">
                    {selectedFields.size} selected
                  </span>
                )}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedFields(new Set(availableFields.map(f => f.key)))}
                  className="text-xs text-brand hover:underline"
                >
                  Select All
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => setSelectedFields(new Set())}
                  className="text-xs text-gray-500 hover:underline"
                >
                  Clear All
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {availableFields.map(f => (
                <label key={f.key} className="flex items-center gap-2 cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={selectedFields.has(f.key)}
                    onChange={() => toggleField(f.key)}
                    className="accent-blue-600 w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">{f.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Section 3: Filters */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-brand-light text-brand text-xs font-bold flex items-center justify-center">3</span>
              Filters
              <span className="text-xs text-gray-400 font-normal">(up to 5)</span>
            </h3>
            {filters.length === 0 && (
              <p className="text-sm text-gray-400 mb-3">No filters applied — report will return all data.</p>
            )}
            <div className="space-y-2 mb-3">
              {filters.map(f => (
                <div key={f.id} className="flex items-center gap-2">
                  <select
                    value={f.field}
                    onChange={e => updateFilter(f.id, { field: e.target.value })}
                    className="h-8 border border-gray-300 rounded px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                  >
                    {availableFields.map(af => (
                      <option key={af.key} value={af.key}>{af.label}</option>
                    ))}
                  </select>
                  <select
                    value={f.operator}
                    onChange={e => updateFilter(f.id, { operator: e.target.value as FilterRow['operator'] })}
                    className="h-8 border border-gray-300 rounded px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                  >
                    {OPERATORS.map(op => (
                      <option key={op} value={op}>{op}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={f.value}
                    onChange={e => updateFilter(f.id, { value: e.target.value })}
                    placeholder="Value"
                    className="h-8 flex-1 border border-gray-300 rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <button onClick={() => removeFilter(f.id)} className="h-8 w-8 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                    &times;
                  </button>
                </div>
              ))}
            </div>
            {filters.length < 5 && (
              <button
                onClick={addFilter}
                className="flex items-center gap-1.5 text-sm text-brand hover:text-brand font-medium"
              >
                <Plus size={14} /> Add Filter
              </button>
            )}
          </div>

          {/* Section 4: Sort Order */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-brand-light text-brand text-xs font-bold flex items-center justify-center">4</span>
              Sort Order
            </h3>
            <div className="flex items-center gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Sort By</label>
                <select
                  value={sortField}
                  onChange={e => setSortField(e.target.value)}
                  className="h-8 border border-gray-300 rounded px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand min-w-[160px]"
                >
                  <option value="">— select field —</option>
                  {[...selectedFields].map(key => {
                    const fld = availableFields.find(f => f.key === key);
                    return <option key={key} value={key}>{fld?.label ?? key}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Direction</label>
                <div className="flex gap-3">
                  {(['ASC', 'DESC'] as SortDir[]).map(d => (
                    <label key={d} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="sortDir" checked={sortDir === d} onChange={() => setSortDir(d)} className="accent-blue-600" />
                      <span className="text-sm">{d}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Section 5: Save */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-brand-light text-brand text-xs font-bold flex items-center justify-center">5</span>
              Save Report
            </h3>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={reportName}
                onChange={e => setReportName(e.target.value)}
                placeholder="Report name (required)"
                className="h-8 w-64 border border-gray-300 rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <button
                onClick={saveReport}
                disabled={!canSave}
                className="flex items-center gap-1.5 h-8 px-4 bg-brand text-white rounded text-sm hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                <Save size={14} /> Save Report
              </button>
              {!canSave && (
                <span className="text-xs text-gray-400">
                  {reportName.trim().length === 0 ? 'Enter a report name.' : 'Select at least 1 field.'}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ TAB: RUN REPORT ══════════════ */}
      {activeTab === 'run' && (
        <div className="space-y-5">
          {/* Report selector + params */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Run Parameters</h3>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Select Report</label>
                <select
                  value={runReportId}
                  onChange={e => { setRunReportId(e.target.value); setRunResults(null); }}
                  className="h-8 w-64 border border-gray-300 rounded px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                >
                  <option value="">— choose a report —</option>
                  {savedReports.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              {selectedRunReport && (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Date From</label>
                    <input
                      type="date"
                      value={runFromDate}
                      onChange={e => setRunFromDate(e.target.value)}
                      className="h-8 border border-gray-300 rounded px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Date To</label>
                    <input
                      type="date"
                      value={runToDate}
                      onChange={e => setRunToDate(e.target.value)}
                      className="h-8 border border-gray-300 rounded px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Company</label>
                    <input
                      type="text"
                      value={runCompany}
                      onChange={e => setRunCompany(e.target.value)}
                      className="h-8 w-20 border border-gray-300 rounded px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                </>
              )}
            </div>

            {selectedRunReport && selectedRunReport.filters.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 font-semibold mb-2">Applied Filters</p>
                <div className="flex flex-wrap gap-2">
                  {selectedRunReport.filters.map(f => (
                    <span key={f.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                      {f.field} {f.operator} &quot;{f.value}&quot;
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <button
                onClick={handleRun}
                disabled={!selectedRunReport || isRunning}
                className="w-full flex items-center justify-center gap-2 h-9 bg-brand text-white rounded text-sm font-medium hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRunning ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Running report&hellip;
                  </>
                ) : (
                  <>
                    <Play size={15} />
                    Run Report
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Results */}
          {runResults && selectedRunReport && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-800">{selectedRunReport.name}</span>
                  <TypeBadge type={selectedRunReport.type} />
                  <span className="text-xs text-gray-400">{runResults.length} rows</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={exportCsv}
                    className="flex items-center gap-1.5 h-8 px-3 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
                  >
                    <Download size={13} /> Export CSV
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 h-8 px-3 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
                  >
                    <FileText size={13} /> Print
                  </button>
                  <button
                    onClick={() => setShowScheduleModal(true)}
                    className="flex items-center gap-1.5 h-8 px-3 border border-blue-300 text-brand rounded text-sm hover:bg-brand-light"
                  >
                    <Calendar size={13} /> Schedule
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      {selectedRunReport.fields.map(key => (
                        <th
                          key={key}
                          className={`px-4 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap ${isMoney(key) ? 'text-right' : 'text-left'}`}
                        >
                          {fieldLabel(key, selectedRunReport.type)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {runResults.map((row, idx) => (
                      <tr
                        key={idx}
                        className={`h-9 border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-brand-light`}
                      >
                        {selectedRunReport.fields.map(key => (
                          <td
                            key={key}
                            className={`px-4 text-sm ${isMoney(key) ? 'text-right font-mono' : 'text-left'} text-gray-800`}
                          >
                            {fmtCell(key, row[key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {/* Totals row */}
                    {totals && Object.keys(totals).length > 0 && (
                      <tr className="h-9 bg-brand-light border-t-2 border-brand-border font-semibold">
                        {selectedRunReport.fields.map((key, i) => (
                          <td
                            key={key}
                            className={`px-4 text-sm ${isMoney(key) ? 'text-right font-mono text-blue-800' : 'text-left text-gray-500'}`}
                          >
                            {i === 0
                              ? 'TOTAL'
                              : isMoney(key) && totals[key] !== undefined
                                ? fmtCell(key, totals[key].toFixed(2))
                                : ''}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Schedule Modal */}
      {showScheduleModal && (
        <ScheduleModal
          onClose={() => {
            setShowScheduleModal(false);
            scheduleMut.reset();
          }}
        />
      )}
    </div>
  );
}
