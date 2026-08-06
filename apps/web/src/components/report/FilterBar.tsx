import type { ReactNode } from 'react';

// Golden R0 UI convergence — Phase 2. Styled filter surface (design Section
// 02/05-09: compact bordered fields, 32px control height, primary run action
// right-aligned). FilterField only supplies the label + container; each
// screen keeps its own <input>/<select> — apply FILTER_CONTROL_CLASS to them
// for consistent height/border/focus treatment.

export const FILTER_CONTROL_CLASS =
  'h-8 px-2.5 text-[13px] rounded-md border border-slate-300 text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-[#0B5CAB] focus:border-transparent ' +
  'disabled:bg-slate-50 disabled:text-slate-400';

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 px-4 py-3 bg-white border border-slate-200 rounded-md mb-4">
      {children}
    </div>
  );
}

export function FilterField({ label, children, width }: { label: string; children: ReactNode; width?: number }) {
  return (
    <label className="flex flex-col gap-1" style={width ? { width } : undefined}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 break-words">{label}</span>
      {children}
    </label>
  );
}
