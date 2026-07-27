import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { goldenPathApi } from '../../api/client';

interface OrgNode {
  type: string;
  id: string;
  code: string;
  name: string;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  children?: OrgNode[];
}

// FINAL-R0 / S202 — Dealer Group Hierarchy Screen. Consumes the real
// tenant-service GET /api/v1/org/tree response (GROUP -> ENTITY -> STORE ->
// DEPARTMENT) exactly as returned -- no client-side tree reconstruction,
// sorting, or synthesized nodes.
function Node({ node, depth }: { node: OrgNode; depth: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = (node.children?.length ?? 0) > 0;
  return (
    <li data-testid={`org-node-${node.id}`} style={{ marginLeft: depth * 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
        {hasChildren && (
          <button data-testid={`org-toggle-${node.id}`} onClick={() => setOpen(!open)} style={{ width: 20 }}>
            {open ? '▾' : '▸'}
          </button>
        )}
        {!hasChildren && <span style={{ width: 20 }} />}
        <span style={{ fontSize: 11, color: '#888', width: 70 }}>{node.type}</span>
        <span style={{ fontWeight: 600 }}>{node.name}</span>
        <span style={{ fontSize: 12, color: '#666' }}>({node.code})</span>
        <span
          style={{
            fontSize: 11, padding: '1px 6px', borderRadius: 4,
            background: node.status === 'ACTIVE' ? '#dcfce7' : '#fef2f2',
            color: node.status === 'ACTIVE' ? '#166534' : '#991b1b',
          }}
        >
          {node.status}
        </span>
      </div>
      {open && hasChildren && (
        <ul style={{ listStyle: 'none', padding: 0 }}>
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

  useEffect(() => {
    goldenPathApi.getOrgTree()
      .then(setTree)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Dealer Group Hierarchy</h1>
      {loading && <p data-testid="org-loading">Loading organization tree…</p>}
      {error && <p data-testid="org-error" style={{ color: '#b91c1c' }}>{error}</p>}
      {!loading && !error && !tree && <p data-testid="org-empty">No organization structure found for this tenant.</p>}
      {tree && (
        <ul data-testid="org-tree" style={{ listStyle: 'none', padding: 0, marginTop: 16 }}>
          <Node node={tree} depth={0} />
        </ul>
      )}
      <p style={{ marginTop: 24 }}>
        <Link to="/golden-path/role-templates">Role Templates</Link>
        {' · '}
        <Link to="/golden-path/fiscal">Continue to Fiscal Period</Link>
      </p>
    </div>
  );
}
