import { Link } from 'react-router-dom';

// Golden R0 UI convergence — Phase 2. "Related" links row (design Section
// 02, present on every report screen — GL Search/GL Inquiry/Trial
// Balance/Balance Sheet/Income Statement each list the other four).

export function RelatedLinks({ links }: { links: { label: string; to: string }[] }) {
  if (links.length === 0) return null;
  return (
    <div className="mt-6 pt-3 border-t border-slate-100 flex items-center flex-wrap gap-2 text-[12.5px] text-slate-500">
      <span className="font-semibold text-slate-400 uppercase text-[10px] tracking-wide mr-1">Related</span>
      {links.map((l, i) => (
        <span key={l.to} className="flex items-center gap-2">
          {i > 0 && <span className="text-slate-300">&middot;</span>}
          <Link to={l.to} className="text-[#0B5CAB] hover:underline">{l.label}</Link>
        </span>
      ))}
    </div>
  );
}
