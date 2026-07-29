import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { goldenPathApi } from '../../api/client';
import { Btn } from '../../components/ui/Btn';
import { LoadingTable } from '../../components/ui/LoadingTable';
import { EmptyState } from '../../components/report';

interface OrgNode {
  type: string;
  id: string;
  code: string;
  name: string;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  children?: OrgNode[];
  isElimination?: boolean;
}

// FINAL-R0 / S202 — Dealer Group Hierarchy Screen. Consumes the real
// tenant-service GET /api/v1/org/tree response (GROUP -> ENTITY -> STORE ->
// DEPARTMENT) exactly as returned -- no client-side tree reconstruction,
// sorting, or synthesized nodes.
//
// Golden R0 UI convergence — Phase 4: baseline product-quality styling only.
// No source design exists for this screen (Organization Hierarchy is
// explicitly deferred in DESIGN_SOURCE_OF_TRUTH.md) -- this is a visual
// baseline pass (ui/Btn, ui/EmptyState, ui/LoadingTable, Tailwind), not a
// claim of pixel-level design parity. All data-testids and behavior
// (expand/collapse, real org tree API) are unchanged.
function Node({ node, depth }: { node: OrgNode; depth: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = (node.children?.length ?? 0) > 0;
  return (
    <li data-testid={`org-node-${node.id}`} style={{ marginLeft: depth * 20 }} className="list-none">
      <div className="flex items-center gap-2 py-1.5">
        {hasChildren ? (
          <button
            data-testid={`org-toggle-${node.id}`}
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Collapse' : 'Expand'}
            className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded focus:outline-none focus:ring-2 focus:ring-[#0B5CAB]"
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-5 inline-block" />
        )}
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 w-[76px] flex-shrink-0">{node.type}</span>
        <span className="font-semibold text-slate-900 text-[13.5px]">{node.name}</span>
        <span className="text-[12.5px] text-slate-500">({node.code})</span>
        <span
          className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded"
          style={{
            background: node.status === 'ACTIVE' ? '#dcfce7' : '#fef2f2',
            color: node.status === 'ACTIVE' ? '#166534' : '#991b1b',
          }}
        >
          {node.status}
        </span>
        {node.type === 'ENTITY' && node.isElimination && (
          <span
            data-testid={`elimination-badge-${node.id}`}
            style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}
          >
            Elimination
          </span>
        )}
      </div>
      {open && hasChildren && (
        <ul className="list-none p-0">
          {node.children!.map((c) => <Node key={c.id} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

export default function OrgHierarchy() {
  const [tree, setTree] = useState<OrgNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError(null);
    goldenPathApi.getOrgTree()
      .then(setTree)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-xl font-semibold text-slate-900 tracking-tight mb-4">Dealer Group Hierarchy</h1>

      {loading && (
        <div data-testid="org-loading">
          <LoadingTable rows={4} cols={3} className="border border-slate-200 rounded-lg" />
        </div>
      )}

      {error && (
        <div data-testid="org-error" className="flex items-center gap-3 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2.5">
          <span>{error}</span>
          <Btn size="sm" variant="secondary" onClick={load}>Retry</Btn>
        </div>
      )}

      {!loading && !error && !tree && (
        <EmptyState testId="org-empty" title="No organization structure found for this tenant" />
      )}

      {tree && (
        <ul data-testid="org-tree" className="list-none p-0 mt-2 border border-slate-200 rounded-lg px-3 py-2">
          <Node node={tree} depth={0} />
        </ul>
      )}

      <p className="mt-6 text-[13px] flex items-center gap-2">
        <Link to="/golden-path/role-templates" className="text-[#0B5CAB] hover:underline">Role Templates</Link>
        <span className="text-slate-300">&middot;</span>
        <Link to="/golden-path/entity-elimination" className="text-[#0B5CAB] hover:underline">Elimination Entity Configuration</Link>
        <span className="text-slate-300">&middot;</span>
        <Link to="/golden-path/fiscal" className="text-[#0B5CAB] hover:underline">Continue to Fiscal Period</Link>
      </p>
    </div>
  );
}
