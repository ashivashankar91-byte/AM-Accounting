import { Link } from 'react-router-dom';

// Golden R0 UI convergence — Breadcrumb component, Section 03 spec:
// "Always three levels for GL screens. Last crumb is the current page and
// is not a link." (design doc line 610).

interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12px] leading-none select-none">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-slate-300">/</span>}
            {last || !c.to ? (
              <span className={last ? 'font-medium text-slate-900' : 'text-slate-400'}>{c.label}</span>
            ) : (
              <Link to={c.to} className="text-[#0B5CAB] no-underline hover:underline">{c.label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
