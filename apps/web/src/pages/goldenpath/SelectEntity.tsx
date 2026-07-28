import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { goldenPathApi } from '../../api/client';

// FINAL-R0 Golden Path step 2: select tenant/legal entity.
// Tenant is already fixed by the login step (S205 login is tenant-scoped);
// this page lists the real legal entities for that tenant via tenant-service
// (S200) through the real gateway and lets the user pick the one to work in.
export default function SelectEntity() {
  const { user, tenantId, selectLegalEntity, logout } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    goldenPathApi.listLegalEntities()
      .then((res) => setEntities(res.items))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function pick(id: string, label: string) {
    selectLegalEntity(id, label);
    navigate('/golden-path/org-hierarchy');
  }

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Select Tenant / Legal Entity</h1>
        <button onClick={() => logout().then(() => navigate('/golden-path/login'))}>Sign out</button>
      </div>
      <p style={{ color: '#555' }}>Signed in as {user?.displayName} — tenant {tenantId}</p>

      {loading && <p>Loading legal entities…</p>}
      {error && <p data-testid="select-entity-error" style={{ color: '#b91c1c' }}>{error}</p>}

      <ul data-testid="legal-entity-list" style={{ listStyle: 'none', padding: 0 }}>
        {entities.map((e) => (
          <li key={e.id} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>{e.legalName} ({e.entityCode})</div>
            <div style={{ fontSize: 13, color: '#666' }}>{e.status} · FY end month {e.fiscalYearEndMonth}</div>
            <button data-testid={`select-entity-${e.entityCode}`} onClick={() => pick(e.id, `${e.entityCode} — ${e.legalName}`)} style={{ marginTop: 8 }}>
              Select
            </button>
          </li>
        ))}
      </ul>
      {!loading && entities.length === 0 && !error && <p>No legal entities found for this tenant.</p>}
    </div>
  );
}
