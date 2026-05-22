import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { AlertCircle, Check, Loader2, Save, FileText, Copy, Printer, Search, RotateCcw } from 'lucide-react';
import { glApi, mlApi } from '../../api/client';
import { Btn, PageHeader } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import JournalSourceLookup from '../../components/accounting/JournalSourceLookup';
import JournalTemplateSelector from '../../components/accounting/JournalTemplateSelector';

// TypeScript Interfaces
interface JournalLine {
  id?: string;
  accountCode: string;
  description: string;
  debit: number;
  credit: number;
  quantity?: number;
}

interface JournalEntryData {
  id?: string;
  entryDate: string;
  referenceNumber: string;
  description: string;
  sourceCode: string;
  companyId: string;
  lines: JournalLine[];
  status?: 'DRAFT' | 'POSTED' | 'APPROVED' | 'REVERSED';
  totalDebits: number;
  totalCredits: number;
}

interface Anomaly {
  lineIndex: number;
  accountCode: string;
  amount: number;
  threshold: number;
  message: string;
}

type UIState = 'idle' | 'loading' | 'success' | 'error' | 'empty' | 'editing' | 'posting' | 'anomaly-detected';

// Utility formatters
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const emptyLine = (): JournalLine => ({ accountCode: '', description: '', debit: 0, credit: 0 });

export default function JournalEntry() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { id: entryId } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const isBatchMode = searchParams.get('batch') === 'true';

  // State
  const [uiState, setUiState] = useState<UIState>('idle');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [batchCount, setBatchCount] = useState({ session: 0, saved: 0 });
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [referenceNumber, setReferenceNumber] = useState(Date.now().toString().slice(-6));
  const [description, setDescription] = useState('');
  const [sourceCode, setSourceCode] = useState('MANUAL');
  const [companyId, setCompanyId] = useState('01');
  const [lines, setLines] = useState<JournalLine[]>([emptyLine(), emptyLine()]);
  const [draftSaved, setDraftSaved] = useState(false);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [suggestedOffsetAccount, setSuggestedOffsetAccount] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string>('');
  const [sourceError, setSourceError] = useState<string>('');
  const [showSourceLookup, setShowSourceLookup] = useState(false);

  // Queries
  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: ['gl-accounts'],
    queryFn: glApi.getAccounts,
    retry: false,
  });

  const { data: periods } = useQuery({
    queryKey: ['gl-periods'],
    queryFn: glApi.getPeriods,
    retry: false,
  });

  // Mutations
  const createMut = useMutation({
    mutationFn: (data: JournalEntryData) => glApi.createJournalEntry(data),
    onSuccess: () => {
      setUiState('success');
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      if (isBatchMode) {
        setBatchCount(prev => ({ ...prev, saved: prev.saved + 1 }));
        setTimeout(() => {
          setLines([emptyLine(), emptyLine()]);
          setDescription('');
          setReferenceNumber(Date.now().toString().slice(-6));
          setDraftSaved(false);
          setUiState('idle');
          setBatchCount(prev => ({ ...prev, session: prev.session + 1 }));
        }, 800);
      } else {
        setTimeout(() => {
          setLines([emptyLine(), emptyLine()]);
          setDescription('');
          setReferenceNumber(Date.now().toString().slice(-6));
          setDraftSaved(false);
          setUiState('idle');
        }, 2000);
      }
    },
    onError: () => {
      setUiState('error');
    },
  });

  const postMut = useMutation({
    mutationFn: (id: string) => glApi.submitEntry(id),
    onSuccess: () => {
      setUiState('success');
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      setTimeout(() => {
        setUiState('idle');
        setLines([emptyLine(), emptyLine()]);
      }, 2000);
    },
    onError: () => {
      setUiState('error');
    },
  });

  const reverseMut = useMutation({
    mutationFn: (data: { reversalDate: string; reason: string }) =>
      glApi.reverseEntry(entryId!, data),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      setUiState('success');
      setNotification({ type: 'success', msg: `Reversal entry created: ${result?.id?.slice(-8) ?? 'OK'}` });
      setTimeout(() => setNotification(null), 5000);
    },
    onError: (err: any) => {
      setNotification({ type: 'error', msg: `Reversal failed: ${err.message ?? 'Unknown error'}` });
    },
  });

  // Calculations
  const totalDebits = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredits = lines.reduce((sum, line) => sum + line.credit, 0);
  const difference = Math.abs(totalDebits - totalCredits);
  const isBalanced = difference < 0.01;
  const hasContent = lines.some(l => l.accountCode && (l.debit > 0 || l.credit > 0));

  // Check for anomalies
  useEffect(() => {
    if (lines.length > 0 && accounts) {
      checkAnomalies();
    }
  }, [lines, accounts]);

  const checkAnomalies = async () => {
    const detectedAnomalies: Anomaly[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.accountCode && (line.debit > 0 || line.credit > 0)) {
        const amount = line.debit > 0 ? line.debit : line.credit;
        const account = (accounts ?? []).find(a => a.code === line.accountCode);
        if (account && account.averageDebit) {
          const threshold = account.averageDebit * 10;
          if (amount > threshold) {
            detectedAnomalies.push({
              lineIndex: i,
              accountCode: line.accountCode,
              amount,
              threshold,
              message: `Amount $${fmt(amount)} exceeds 10x historical average ($${fmt(threshold)})`,
            });
          }
        }
      }
    }
    if (detectedAnomalies.length > 0) {
      setAnomalies(detectedAnomalies);
      setUiState('anomaly-detected');
    } else {
      setAnomalies([]);
    }
  };

  // Line management
  const addLine = () => setLines([...lines, emptyLine()]);
  const removeLine = (i: number) => {
    if (lines.length > 2) setLines(lines.filter((_, idx) => idx !== i));
  };
  const updateLine = (i: number, field: keyof JournalLine, val: any) => {
    const updated = [...lines];
    updated[i] = { ...updated[i], [field]: val };
    setLines(updated);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F8' && isBalanced && hasContent && !createMut.isPending) {
        e.preventDefault();
        handlePost();
      }
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSaveDraft();
      }
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        duplicateLine();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBalanced, hasContent, lines]);

  // Load template from navigation state (from JournalTemplateList "Use" button)
  useEffect(() => {
    if (location.state?.template) {
      const t = location.state.template;
      setSourceCode(t.sourceCode ?? '88');
      setSourceName('');
      if (t.lines?.length) {
        setLines(t.lines.map((l: any) => ({
          accountCode: l.accountCode ?? '',
          description: l.memo ?? '',
          debit: l.isCredit ? 0 : (parseFloat(l.amount) || 0),
          credit: l.isCredit ? (parseFloat(l.amount) || 0) : 0,
        })));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const duplicateLine = () => {
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      setLines([...lines, { ...lastLine, id: undefined }]);
    }
  };

  const handleSaveDraft = () => {
    setDraftSaved(true);
    setTimeout(() => setDraftSaved(false), 2000);
  };

  const handlePost = () => {
    if (!isBalanced || !hasContent) return;
    setUiState('posting');
    const data: JournalEntryData = {
      entryDate,
      referenceNumber,
      description,
      sourceCode,
      companyId,
      lines: lines.filter(l => l.accountCode && (l.debit > 0 || l.credit > 0)),
      totalDebits,
      totalCredits,
    };
    createMut.mutate(data);
  };

  const handleReverse = () => {
    if (!entryId) {
      setNotification({ type: 'error', msg: 'Cannot reverse an unsaved entry. Post the entry first, then open it from the journal entry list and use Reverse.' });
      return;
    }
    if (!window.confirm('This will create a reversing journal entry with all debits/credits swapped. Proceed?')) return;
    reverseMut.mutate({ reversalDate: entryDate, reason: 'Manual reversal' });
  };

  const handleLoadTemplate = (t: any) => {
    setSourceCode(t.sourceCode ?? '88');
    setSourceName('');
    if (t.lines?.length) {
      setLines(t.lines.map((l: any) => ({
        accountCode: l.accountCode ?? '',
        description: l.memo ?? '',
        debit: l.isCredit ? 0 : (parseFloat(l.amount) || 0),
        credit: l.isCredit ? (parseFloat(l.amount) || 0) : 0,
      })));
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Render logic
  if (accountsLoading) {
    return <PageLoader page="Journal Entry" service="gl-service" port={3010} />;
  }

  return (
    <div className="p-6 space-y-4">
      {/* Notification toast */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          notification.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {notification.msg}
          <button onClick={() => setNotification(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
      {/* Header */}
      <PageHeader
        title="Journal Entry (WF-A001)"
        subtitle="Create and post journal entries to the General Ledger."
        actions={
          <>
            <Btn
              variant="secondary"
              icon={<FileText className="w-4 h-4" />}
              onClick={() => setShowTemplateSelector(true)}
            >
              Load Template
            </Btn>
            {uiState === 'success' && (
              <div className="bg-green-50 text-green-700 px-4 py-2 rounded flex items-center gap-2">
                <Check className="w-4 h-4" />
                Saved successfully
              </div>
            )}
          </>
        }
      />

      {/* Batch Mode Banner */}
      {isBatchMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-amber-900">
              Batch Entry Mode — Entry #{batchCount.session + 1} of session ({batchCount.saved} saved)
            </span>
          </div>
          <button
            onClick={() => navigate('/accounting/gl')}
            className="text-xs text-amber-700 border border-amber-300 px-3 py-1 rounded hover:bg-amber-100"
          >
            Stop Batch
          </button>
        </div>
      )}

      {/* Status Messages */}
      {uiState === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          <span>{(createMut.error || postMut.error) as any}</span>
        </div>
      )}

      {uiState === 'anomaly-detected' && anomalies.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg space-y-2">
          <div className="font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            AI Anomaly Detected
          </div>
          <ul className="text-sm space-y-1 ml-6">
            {anomalies.map((a, i) => (
              <li key={i}>Line {a.lineIndex + 1}: {a.message}</li>
            ))}
          </ul>
          <button
            onClick={() => setUiState('editing')}
            className="text-xs bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded mt-2"
          >
            Continue Anyway
          </button>
        </div>
      )}

      {suggestedOffsetAccount && (
        <div className="bg-brand-light border border-brand-border text-blue-800 px-4 py-3 rounded-lg">
          <p className="text-sm">
            Auto-suggest: Most used offset account is <span className="font-mono font-bold">{suggestedOffsetAccount}</span>
          </p>
        </div>
      )}

      {/* Main Form */}
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        {/* Header Fields */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Entry Date</label>
            <input
              type="date"
              value={entryDate}
              onChange={e => setEntryDate(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reference #</label>
            <input
              type="text"
              value={referenceNumber}
              onChange={e => setReferenceNumber(e.target.value.slice(0, 8))}
              maxLength={8}
              className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
            <select
              value={companyId}
              onChange={e => setCompanyId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
            >
              <option value="01">Company 01</option>
              <option value="02">Company 02</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe this journal entry..."
              className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={sourceCode}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                  setSourceCode(val);
                  setSourceError('');
                  setSourceName('');
                }}
                onBlur={async () => {
                  if (!sourceCode) return;
                  try {
                    const results = await glApi.getSources(`sourceCode=${encodeURIComponent(sourceCode)}`);
                    const match = (results as any[]).find(s => s.sourceCode === sourceCode);
                    if (match) {
                      setSourceName(match.name);
                      setSourceError('');
                    } else {
                      setSourceName('');
                      setSourceError(`Unknown source code "${sourceCode}"`);
                    }
                  } catch {
                    setSourceError('Could not look up source code');
                  }
                }}
                placeholder="00"
                maxLength={2}
                className={`w-20 border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-brand focus:outline-none ${
                  sourceError ? 'border-red-500' : ''
                }`}
              />
              <button
                type="button"
                onClick={() => setShowSourceLookup(true)}
                className="flex items-center gap-1.5 border border-gray-300 rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                <Search className="w-3.5 h-3.5" />
                Source
              </button>
              {sourceName && (
                <span className="self-center text-sm text-gray-700 font-medium">{sourceName}</span>
              )}
            </div>
            {sourceError && (
              <p className="text-xs text-red-600 mt-1">{sourceError}</p>
            )}
            {showSourceLookup && (
              <JournalSourceLookup
                onSelect={s => {
                  setSourceCode(s.sourceCode);
                  setSourceName(s.name);
                  setSourceError('');
                  setShowSourceLookup(false);
                }}
                onClose={() => setShowSourceLookup(false)}
              />
            )}
          </div>
        </div>

        {/* Journal Lines */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-gray-700">GL Lines</h3>
            <button
              onClick={addLine}
              className="text-xs bg-brand-light text-brand px-3 py-1.5 rounded hover:bg-blue-200 font-medium"
            >
              + Add Line
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600 border-b border-gray-200">
                  <th className="pb-2 w-8">#</th>
                  <th className="pb-2">GL Account</th>
                  <th className="pb-2">Description</th>
                  <th className="pb-2 text-right w-32">Debit</th>
                  <th className="pb-2 text-right w-32">Credit</th>
                  <th className="pb-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3 text-gray-400 text-xs">{i + 1}</td>
                    <td className="py-3 pr-2">
                      <select
                        value={line.accountCode}
                        onChange={e => updateLine(i, 'accountCode', e.target.value)}
                        className="w-full border rounded px-2 py-1.5 text-sm"
                      >
                        <option value="">Select account...</option>
                        {(accounts ?? []).map((a: any) => (
                          <option key={a.id} value={a.code}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 pr-2">
                      <input
                        type="text"
                        value={line.description}
                        onChange={e => updateLine(i, 'description', e.target.value)}
                        placeholder="Line memo"
                        className="w-full border rounded px-2 py-1.5 text-sm"
                      />
                    </td>
                    <td className="py-3 pr-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.debit}
                        onChange={e => updateLine(i, 'debit', parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        className="w-full border rounded px-2 py-1.5 text-sm text-right font-mono"
                      />
                    </td>
                    <td className="py-3 pr-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.credit}
                        onChange={e => updateLine(i, 'credit', parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        className="w-full border rounded px-2 py-1.5 text-sm text-right font-mono"
                      />
                    </td>
                    <td className="py-3">
                      {lines.length > 2 && (
                        <button
                          onClick={() => removeLine(i)}
                          className="text-red-400 hover:text-red-600 text-xs"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 font-bold bg-gray-50">
                  <td colSpan={3} className="py-3 text-right pr-4">Totals:</td>
                  <td className="py-3 text-right font-mono pr-2">${fmt(totalDebits)}</td>
                  <td className="py-3 text-right font-mono pr-2">${fmt(totalCredits)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Balance Check - Footer */}
        <div className="border-t pt-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                isBalanced ? 'text-green-600' : 'text-red-600'
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full ${isBalanced ? 'bg-green-500' : 'bg-red-500'}`}
              />
              {isBalanced ? 'Balanced' : `Out of balance: $${fmt(difference)}`}
            </span>
            {!isBalanced && (
              <span className="text-xs text-gray-500">
                Debits must equal credits to post (F8)
              </span>
            )}
          </div>

          {/* Action Bar */}
          <div className="flex gap-2">
            <Btn
              variant="secondary"
              icon={<Printer className="w-4 h-4" />}
              onClick={handlePrint}
            >
              Print
            </Btn>

            <Btn
              variant="secondary"
              icon={<RotateCcw className="w-4 h-4" />}
              onClick={handleReverse}
              disabled={!hasContent || reverseMut.isPending}
            >
              {reverseMut.isPending ? 'Reversing...' : 'Reverse'}
            </Btn>

            <Btn
              variant="secondary"
              icon={<Save className="w-4 h-4" />}
              onClick={handleSaveDraft}
              disabled={!hasContent}
            >
              Save Draft (Ctrl+S)
            </Btn>

            <Btn
              variant="primary"
              icon={createMut.isPending ? undefined : <Check className="w-4 h-4" />}
              loading={createMut.isPending}
              onClick={handlePost}
              disabled={!isBalanced || !hasContent || createMut.isPending}
              shortcut="F8"
            >
              {createMut.isPending ? 'Posting...' : 'Post'}
            </Btn>
          </div>
        </div>
      </div>

      {/* Help Text */}
      <div className="bg-brand-light border border-brand-border rounded-lg p-4 text-sm text-blue-900">
        <p className="font-medium mb-1">Keyboard Shortcuts:</p>
        <ul className="list-disc list-inside space-y-0.5 text-xs">
          <li>F8: Post entry (when balanced)</li>
          <li>Ctrl+S: Save as draft</li>
          <li>Ctrl+D: Duplicate last line</li>
        </ul>
      </div>

      {/* Journal Template Selector popup */}
      {showTemplateSelector && (
        <JournalTemplateSelector
          isOpen={showTemplateSelector}
          onClose={() => setShowTemplateSelector(false)}
          onSelect={handleLoadTemplate}
        />
      )}
    </div>
  );
}
