import { useState } from 'react';
import { Btn } from '../ui/Btn';

// Golden R0 UI convergence — Phase 2. Export dropdown (design Section 02,
// CSV/Excel/PDF overlay). Per PRODUCT CHECKPOINT (Golden R0 UI convergence)
// and the certified contracts, screens must only offer export formats that
// actually have a backend endpoint — pass exactly those in `formats`, never
// an invented PDF/Excel option. A single supported format renders as a plain
// button (a one-item dropdown is unnecessary UI); two or more render the
// overlay menu.

export interface ExportFormat {
  key: string;
  label: string;
  onSelect: () => void | Promise<void>;
}

export function ExportMenu({ formats, disabled }: { formats: ExportFormat[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);

  if (formats.length === 0) return null;

  if (formats.length === 1) {
    const only = formats[0]!;
    return (
      <Btn variant="secondary" size="sm" disabled={disabled} onClick={only.onSelect}>
        {only.label}
      </Btn>
    );
  }

  return (
    <div className="relative inline-block">
      <Btn variant="secondary" size="sm" disabled={disabled} onClick={() => setOpen((o) => !o)}>
        Export <span className="ml-0.5">&#9662;</span>
      </Btn>
      {open && (
        <div
          className="absolute right-0 mt-1 w-40 bg-white border border-slate-200 rounded-md shadow-lg z-50 py-1"
          onMouseLeave={() => setOpen(false)}
        >
          {formats.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => { setOpen(false); f.onSelect(); }}
              className="w-full text-left px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50"
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
