import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { goldenPathApi } from '../../api/client';
import { Btn } from '../../components/ui/Btn';
import { LoadingTable } from '../../components/ui/LoadingTable';
import { EmptyState } from '../../components/report';

// FINAL-R0 Golden Path step 2: select tenant/legal entity.
// Tenant is already fixed by the login step (S205 login is tenant-scoped);
// this page lists the real legal entities for that tenant via tenant-service
// (S200) through the real gateway and lets the user pick the one to work in.
//
// Golden R0 UI convergence — Phase 4: baseline product-quality styling only.
// This screen has no source design (confirmed absent from the approved
// Claude Design package — Organization Setup/Legal Entities is explicitly
// deferred, DESIGN_SOURCE_OF_TRUTH.md), so this is NOT a claim of pixel-level
// design parity — just bringing it in line with the rest of the app's visual
// baseline (existing ui/Btn, ui/EmptyState, ui/LoadingTable, Tailwind).
// All data-testids and behavior are unchanged.
export default function SelectEntity() {
  const { user, tenantId, selectLegalEntity, logout } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    goldenPathApi.listLegalEntities()
      .then((res) => setEntities(res.items))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function pick(id: string, label: string) {
    selectLegalEntity(id, label);
    navigate('/golden-path/org-hierarchy');
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Select Tenant / Legal Entity</h1>
        <Btn variant="ghost" size="sm" onClick={() => logout().then(() => navigate('/golden-path/login'))}>Sign out</Btn>
      </div>
      <p className="text-sm text-slate-500 mb-6">Signed in as {user?.displayName} — tenant {tenantId}</p>

      {loading && <LoadingTable rows={3} cols={2} className="border border-slate-200 rounded-lg" />}

      {error && (
        <div data-testid="select-entity-error" className="flex items-center gap-3 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2.5 mb-4">
          <span>{error}</span>
          <Btn size="sm" variant="secondary" onClick={load}>Retry</Btn>
        </div>
      )}

      {!loading && (
        <ul data-testid="legal-entity-list" className="list-none p-0 flex flex-col gap-2.5">
          {entities.map((e) => (
            <li key={e.id} className="border border-slate-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-slate-900 text-[14px]">{e.legalName} <span className="font-normal text-slate-400">({e.entityCode})</span></div>
                <div className="text-[12.5px] text-slate-500 mt-0.5">{e.status} &middot; FY end month {e.fiscalYearEndMonth}</div>
              </div>
              <Btn data-testid={`select-entity-${e.entityCode}`} size="sm" onClick={() => pick(e.id, `${e.entityCode} — ${e.legalName}`)}>
                Select
              </Btn>
            </li>
          ))}
        </ul>
      )}

      {!loading && entities.length === 0 && !error && (
        <EmptyState title="No legal entities found for this tenant" />
      )}
    </div>
  );
}
