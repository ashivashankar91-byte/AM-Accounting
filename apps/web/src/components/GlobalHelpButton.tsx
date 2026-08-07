/**
 * GlobalHelpButton — A single floating help icon rendered once in App.tsx.
 * It reads the current URL path and shows rich, layman-friendly explanations
 * of the current page, its sections, and real-world examples.
 *
 * Position: fixed top-right corner, below the top navigation bar.
 */
import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import SCREEN_HELP from '../data/screenHelp';
import type { ScreenHelp } from './HelpButton';

// ─── Route → Help key mapping ─────────────────────────────────────────────────
const ROUTE_HELP_MAP: Array<{ pattern: RegExp; key: string }> = [
  // Dashboard
  { pattern: /\/accounting\/dashboard|\/financial-dashboard/i, key: 'financial-dashboard' },
  { pattern: /\/dashboard$/i,                                   key: 'financial-dashboard' },

  // General Ledger
  { pattern: /\/accounting\/gl\/entry/i,     key: 'journal-entries' },
  { pattern: /\/accounting\/gl$/i,           key: 'journal-entries' },
  { pattern: /\/accounting\/gl\//i,          key: 'journal-entries' },
  { pattern: /\/trial-balance/i,             key: 'trial-balance' },
  { pattern: /\/accounting\/inquiry\/gl/i,   key: 'general-ledger' },

  // Financial Statements
  { pattern: /\/financial-statements/i,      key: 'financial-statements-detail' },
  { pattern: /\/period-close\/fs/i,          key: 'financial-statements-detail' },

  // Period Close / EOM
  { pattern: /\/period-close|\/eom/i,        key: 'period-close' },
  { pattern: /\/eom-close/i,                 key: 'period-close' },

  // AP / AR
  { pattern: /\/accounting\/ap/i,            key: 'accounts-payable-detail' },
  { pattern: /\/accounting\/ar/i,            key: 'accounts-receivable' },
  { pattern: /\/purchase-orders/i,           key: 'accounts-payable-detail' },
  { pattern: /\/use-tax/i,                   key: 'accounts-payable-detail' },

  // Bank Reconciliation
  { pattern: /\/bank-rec/i,                  key: 'bank-reconciliation' },
  { pattern: /\/reconciliation/i,            key: 'bank-reconciliation' },

  // Payroll
  { pattern: /\/payroll/i,                   key: 'payroll' },

  // Chart of Accounts
  { pattern: /\/chart-of-accounts|\/coa/i,   key: 'chart-of-accounts' },

  // Approvals
  { pattern: /\/approvals/i,                 key: 'approvals' },

  // AI Agents
  { pattern: /\/agents|\/ai-agent/i,         key: 'agents' },

  // Year-end / Intercompany / Tenants
  { pattern: /\/year-end/i,                  key: 'year-end' },
  { pattern: /\/intercompany/i,              key: 'intercompany' },
  { pattern: /\/tenants/i,                   key: 'tenants' },
  { pattern: /\/reports/i,                   key: 'reports' },
  { pattern: /\/reconciliation/i,            key: 'reconciliation' },

  // GL Posting
  { pattern: /\/posting-rules/i,             key: 'general-ledger' },
  { pattern: /\/posting-executions/i,        key: 'general-ledger' },
  { pattern: /\/posting-recovery/i,          key: 'general-ledger' },

  // Fallback
  { pattern: /\/accounting/i,                key: 'dashboard' },
];

function resolveHelpKey(pathname: string): string | null {
  for (const { pattern, key } of ROUTE_HELP_MAP) {
    if (pattern.test(pathname)) {
      return key;
    }
  }
  return null;
}

// ─── Panel Component ──────────────────────────────────────────────────────────
function HelpPanel({ help, onClose }: { help: ScreenHelp; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[9999] flex justify-end" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <div
        ref={panelRef}
        className="w-[520px] max-w-[95vw] h-full bg-white shadow-2xl overflow-y-auto flex flex-col"
        style={{ animation: 'slideInRight 0.22s ease-out' }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-blue-700 to-indigo-700 text-white px-6 py-4 flex items-start justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
              </svg>
              <h2 className="text-lg font-bold leading-tight">{help.title}</h2>
            </div>
            <p className="text-blue-200 text-xs">Page Guide — Plain English Edition</p>
          </div>
          <button onClick={onClose} className="ml-4 text-white/70 hover:text-white transition-colors mt-0.5 shrink-0" aria-label="Close help panel">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-6 flex-1">
          {/* Overview */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1 h-4 bg-blue-600 rounded-full" />
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">What is this page?</h3>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed bg-blue-50 rounded-lg p-3 border border-blue-100">
              {help.overview}
            </p>
          </section>

          {/* Sections */}
          {Object.keys(help.sections).length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-indigo-600 rounded-full" />
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Section-by-Section Guide</h3>
              </div>
              <div className="space-y-2.5">
                {Object.entries(help.sections).map(([name, desc]) => (
                  <div key={name} className="rounded-xl border border-gray-100 bg-gray-50 p-3.5 hover:bg-indigo-50 hover:border-indigo-200 transition-colors">
                    <h4 className="text-sm font-semibold text-gray-900 mb-1">{name}</h4>
                    <p className="text-xs text-gray-600 leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Tips */}
          {help.tips.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1 h-4 bg-amber-500 rounded-full" />
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Pro Tips</h3>
              </div>
              <ul className="space-y-2">
                {help.tips.map((tip, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-gray-700">
                    <span className="text-amber-500 shrink-0 mt-0.5">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z"/>
                      </svg>
                    </span>
                    <span className="leading-relaxed text-xs">{tip}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Legacy Context */}
          {help.legacyContext && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1 h-4 bg-orange-400 rounded-full" />
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Legacy System Reference</h3>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-800 leading-relaxed">{help.legacyContext}</p>
                {help.legacyScreens && help.legacyScreens.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {help.legacyScreens.map((s) => (
                      <span key={s} className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-mono rounded border border-amber-200">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          <div className="text-[10px] text-gray-300 text-center pt-2 border-t">
            Press <kbd className="px-1 py-0.5 bg-gray-100 text-gray-400 rounded text-[9px]">Esc</kbd> to close · AutoMate Accounting Help System
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────
export default function GlobalHelpButton() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const helpKey = resolveHelpKey(pathname);
  const help: ScreenHelp | null = helpKey ? (SCREEN_HELP[helpKey] ?? null) : null;

  if (!help) return null;

  return (
    <>
      {/* Floating help button — fixed top-right, below header */}
      <button
        onClick={() => setOpen(true)}
        title={`Help: ${help.title}`}
        aria-label="Open page help guide"
        className="fixed top-[72px] right-4 z-[9998] flex items-center justify-center w-9 h-9 rounded-full bg-white border-2 border-blue-200 shadow-md hover:shadow-lg hover:border-blue-400 hover:bg-blue-50 transition-all group"
        style={{ backdropFilter: 'blur(4px)' }}
      >
        {/* Book-open icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18" height="18"
          fill="none"
          stroke="#3B82F6"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
          className="group-hover:stroke-blue-700 transition-colors"
        >
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>

        {/* Tooltip */}
        <span className="absolute right-11 top-1/2 -translate-y-1/2 bg-gray-800 text-white text-[10px] font-medium px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          Page Guide
        </span>
      </button>

      {open && <HelpPanel help={help} onClose={() => setOpen(false)} />}
    </>
  );
}
