import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { goldenPathApi } from '../../api/client';

interface RoleTemplate {
  id: string;
  key: string;
  name: string;
  permissions: string[];
  fieldMasks: string[];
  builtIn: boolean;
  status: string;
  clonedFromId: string | null;
}

// FINAL-R0 / S004A — Dealership Position Role Templates Screen (apply-only).
// Consumes the real S206/S207-backed auth-service role-template API; the
// permission list shown for each template is exactly what the API returned,
// no local permission map is maintained. Create/clone/deactivate CRUD
// already has independent live-gateway backend evidence from S004A
// certification -- this minimal screen covers only the Golden Path
// journey step of applying an existing template to a user.
export default function RoleTemplates() {
  const { user, legalEntityId } = useAuth();
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<any>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    goldenPathApi.listRoleTemplates()
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function apply(templateId: string) {
    setApplyResult(null);
    setApplyError(null);
    if (!user || !legalEntityId) {
      setApplyError('No signed-in user or selected legal entity in this session.');
      return;
    }
    setBusy(true);
    try {
      const result = await goldenPathApi.applyRoleTemplate({
        templateId,
        userId: user.id,
        entityId: legalEntityId,
        allStores: true,
      });
      setApplyResult(result);
    } catch (err: any) {
      setApplyError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Dealership Position Role Templates</h1>
      {loading && <p data-testid="rt-loading">Loading role templates…</p>}
      {error && <p data-testid="rt-error" style={{ color: '#b91c1c' }}>{error}</p>}
      {applyError && <p data-testid="rt-apply-error" style={{ color: '#b91c1c' }}>{applyError}</p>}
      {applyResult && (
        <p data-testid="rt-apply-success" style={{ color: '#166534' }}>
          Template applied — assignment {applyResult.id ?? applyResult.assignmentId ?? 'created'}.
        </p>
      )}

      {!loading && !error && templates.length === 0 && (
        <p data-testid="rt-empty">No role templates found for this tenant.</p>
      )}

      <table data-testid="rt-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Key</th>
            <th style={{ textAlign: 'left' }}>Name</th>
            <th style={{ textAlign: 'left' }}>Permissions</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} data-testid={`rt-row-${t.key}`}>
              <td>{t.key}</td>
              <td>{t.name}</td>
              <td style={{ fontSize: 12, color: '#555' }}>{t.permissions.join(', ')}</td>
              <td style={{ textAlign: 'center' }}>{t.status}</td>
              <td>
                <button
                  data-testid={`rt-apply-${t.key}`}
                  disabled={busy || t.status !== 'ACTIVE'}
                  onClick={() => apply(t.id)}
                >
                  Apply to me
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: 24 }}>
        <Link to="/golden-path/org-hierarchy">Org Hierarchy</Link>
        {' · '}
        <Link to="/golden-path/fiscal">Continue to Fiscal Period</Link>
      </p>
    </div>
  );
}
