import { useState, useRef, useEffect } from 'react';

interface HelpSection {
  [key: string]: string;
}

export interface ScreenHelp {
  title: string;
  overview: string;
  sections: HelpSection;
  tips: string[];
  legacyScreens?: string[];
  legacyContext?: string;
}

interface HelpButtonProps {
  help: ScreenHelp;
}

export default function HelpButton({ help }: HelpButtonProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-brand bg-brand-light hover:bg-blue-100 rounded-lg transition-colors border border-brand-border"
        title={`Help: ${help.title}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
        Help
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
          <div
            ref={panelRef}
            className="w-[480px] max-w-full h-full bg-white shadow-2xl overflow-y-auto animate-slide-in"
          >
            {/* Header */}
            <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <path d="M12 17h.01" />
                  </svg>
                  <h2 className="text-lg font-bold">{help.title}</h2>
                </div>
                <p className="text-blue-100 text-xs mt-1">Page Help & Guide</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-white/80 hover:text-white p-1 rounded"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Overview */}
              <section>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Overview</h3>
                <p className="text-sm text-gray-700 leading-relaxed">{help.overview}</p>
              </section>

              {/* Sections */}
              {Object.keys(help.sections).length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Page Sections</h3>
                  <div className="space-y-3">
                    {Object.entries(help.sections).map(([name, desc]) => (
                      <div key={name} className="bg-gray-50 rounded-lg p-3">
                        <h4 className="text-sm font-semibold text-gray-800">{name}</h4>
                        <p className="text-xs text-gray-600 mt-1 leading-relaxed">{desc}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Tips */}
              {help.tips.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Tips & Best Practices</h3>
                  <ul className="space-y-2">
                    {help.tips.map((tip, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-700">
                        <span className="text-amber-500 mt-0.5 shrink-0">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z" />
                          </svg>
                        </span>
                        <span className="leading-relaxed">{tip}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Legacy Context */}
              {help.legacyContext && (
                <section>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Legacy System Context</h3>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-xs text-amber-800 leading-relaxed">{help.legacyContext}</p>
                    {help.legacyScreens && help.legacyScreens.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {help.legacyScreens.map((s) => (
                          <span key={s} className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-mono rounded">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Keyboard shortcut hint */}
              <div className="text-xs text-gray-400 text-center pt-2 border-t">
                Press <kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Esc</kbd> to close
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
