import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { goldenPathApi } from '../../api/client';

// ACC-S003 — Elimination Entity Configuration screen. Configuration-only:
// flagging + validation + visibility (BR003-1/2/3). No elimination posting
// or consolidation math — those are S034/S035 (R5). Lists the tenant's legal
// entities and lets a Controller toggle the governed elimination flag with
// impact preview / guard errors surfaced inline, matching the existing
// Golden Path screen conventions (loading/empty/validation/error/unauthorized).
interface LegalEntityRow {
  id: string;
  entityCode: string;
  legalName: string;
  status: string;
  version: number;
  isElimination: boolean;
  hasPostedJournals: boolean;
}

export default function EntityElimination() {
  const [entities, setEntities] = useState<LegalEntityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [ownedStores, setOwnedStores] = useState<Array<{ id: string; storeCode: string; storeName: string }> | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    setUnauthorized(false);
    goldenPathApi.listLegalEntities()
      .then((res) => setEntities(res.items))
      .catch((err) => {
        if (err.status === 401 || err.status === 403) setUnauthorized(true);
        else setError(err.message);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function startToggle(entity: LegalEntityRow) {
    setActiveId(entity.id);
    setReason('');
    setOwnedStores(null);
    setFieldError(null);
  }

  async function confirmToggle(entity: LegalEntityRow) {
    setSaving(true);
    setFieldError(null);
    setOwnedStores(null);
    try {
      await goldenPathApi.configureElimination(entity.id, {
        version: entity.version,
        isElimination: !entity.isElimination,
        reason: reason.trim() || undefined,
      });
      setActiveId(null);
      load();
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) {
        setUnauthorized(true);
      } else if (err.body?.error === 'OWNS_STORES') {
        setOwnedStores(err.body.ownedStores ?? []);
        setFieldError(err.message);
      } else if (err.body?.error === 'REASON_REQUIRED') {
        setFieldError('A reason is required to change the elimination designation.');
      } else if (err.body?.error === 'VERSION_CONFLICT') {
        setFieldError('This entity changed since the page loaded — refresh and try again.');
      } else {
        setFieldError(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Elimination Entity Configuration</h1>
      <p style={{ color: '#555' }}>
        Designate entities used purely for intercompany elimination. An elimination entity cannot own stores.
        Configuration only — no elimination posting or consolidation math (R5).
      </p>

      {loading && <p data-testid="elimination-loading">Loading legal entities…</p>}

      {unauthorized && (
        <p data-testid="elimination-unauthorized" style={{ color: '#b91c1c' }}>
          You do not have permission to view or configure elimination entities.
        </p>
      )}

      {error && !unauthorized && <p data-testid="elimination-error" style={{ color: '#b91c1c' }}>{error}</p>}

      {!loading && !error && !unauthorized && entities.length === 0 && (
        <p data-testid="elimination-empty">No legal entities found for this tenant.</p>
      )}

      {!loading && !unauthorized && entities.length > 0 && (
        <ul data-testid="elimination-entity-list" style={{ listStyle: 'none', padding: 0 }}>
          {entities.map((e) => (
            <li key={e.id} data-testid={`elimination-row-${e.entityCode}`} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {e.legalName} ({e.entityCode})
                    {e.isElimination && (
                      <span
                        data-testid={`elimination-badge-${e.entityCode}`}
                        style={{ marginLeft: 8, fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}
                      >
                        Elimination
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: '#666' }}>{e.status}</div>
                </div>
                <button
                  data-testid={`elimination-toggle-${e.entityCode}`}
                  onClick={() => startToggle(e)}
                >
                  {e.isElimination ? 'Unset elimination flag…' : 'Designate as elimination entity…'}
                </button>
              </div>

              {activeId === e.id && (
                <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 12 }}>
                  {!e.isElimination && (
                    <p style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', padding: 8, borderRadius: 4 }}>
                      Impact: this entity will no longer be able to own stores or be a cashiering/operational posting target.
                    </p>
                  )}
                  <label style={{ display: 'block', marginBottom: 8 }}>
                    Reason (required)
                    <input
                      data-testid="elimination-reason-input"
                      value={reason}
                      onChange={(ev) => setReason(ev.target.value)}
                      style={{ display: 'block', width: '100%', marginTop: 4 }}
                    />
                  </label>
                  {fieldError && (
                    <p data-testid="elimination-validation-error" style={{ color: '#b91c1c' }}>{fieldError}</p>
                  )}
                  {ownedStores && ownedStores.length > 0 && (
                    <ul data-testid="elimination-owned-stores">
                      {ownedStores.map((s) => (
                        <li key={s.id}>{s.storeName} ({s.storeCode})</li>
                      ))}
                    </ul>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <button
                      data-testid={`elimination-confirm-${e.entityCode}`}
                      disabled={saving}
                      onClick={() => confirmToggle(e)}
                    >
                      Confirm
                    </button>
                    <button style={{ marginLeft: 8 }} onClick={() => setActiveId(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: 24 }}>
        <Link to="/golden-path/org-hierarchy">Back to Dealer Group Hierarchy</Link>
      </p>
    </div>
  );
}
