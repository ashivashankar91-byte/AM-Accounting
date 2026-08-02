import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

// Golden R0 UI convergence — Phase 2. Right-side drill-down drawer (design
// Section 02: title/sub/key-value rows/note/Close+action buttons). Escape
// closes and focus returns to the element that opened it, matching the
// design's stated Playwright scenario ("Escape closes drawer and restores
// focus").

export function Drawer({
  open, onClose, title, subtitle, children, actions, testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement;
      function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') onClose();
      }
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('keydown', onKey);
        if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
      };
    }
    return undefined;
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* z-[60]/z-[61]: the app shell's global floating chat assistant (T1Sidebar)
          renders its toggle button at a fixed bottom-right z-50, on every
          authenticated page — the exact corner a drawer's own action-button
          footer occupies. Any consumer passing `actions` (this is the first
          one) would otherwise have its buttons silently unclickable there. */}
      <div className="fixed inset-0 bg-slate-900/20 z-[60]" onClick={onClose} aria-hidden="true" />
      <div
        data-testid={testId}
        role="dialog"
        aria-label={title}
        className="fixed right-0 top-0 h-screen w-[400px] max-w-full bg-white border-l border-slate-200 z-[61] flex flex-col shadow-xl"
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
          <div>
            <div className="text-[15px] font-semibold text-slate-900">{title}</div>
            {subtitle && <div className="text-[12px] text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-100 flex-shrink-0"
          >
            &#10005;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {actions && <div className="px-5 py-3 border-t border-slate-200 flex gap-2 justify-end flex-shrink-0">{actions}</div>}
      </div>
    </>
  );
}

export function DrawerRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-slate-100 text-[13px]">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900 text-right">{value}</span>
    </div>
  );
}
