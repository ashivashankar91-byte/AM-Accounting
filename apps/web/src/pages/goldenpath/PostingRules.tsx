import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { postingEngineApi } from '../../api/client';

// ACC-S019 — Posting Rules screen. Author, validate and activate Posting DSL
// v1 rule-pack versions. Activated versions are immutable (read-only) —
// matches the DB trigger backstop in posting_rule_pack_version. Configuration
// only; this screen never posts a journal itself (that's the Posting
// Executions screen / the certification test journey).

interface RulePackVersionRow {
  id: string;
  packKey: string;
  semver: string;
  status: string;
  eventType: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  contentHash: string;
  createdAt: string;
  validatedAt: string | null;
  activatedBy: string | null;
  activatedAt: string | null;
  validationFindings: Array<{ severity: string; code: string; path: string; ruleId?: string; message: string }> | null;
}

interface PackRow {
  pack: { id: string; packKey: string; createdBy: string; createdAt: string };
  versions: RulePackVersionRow[];
}

export default function PostingRules() {
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const [selectedPackKey, setSelectedPackKey] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<RulePackVersionRow | null>(null);

  const [draftPackKey, setDraftPackKey] = useState('');
  const [draftSource, setDraftSource] = useState('');
  const [draftFindings, setDraftFindings] = useState<RulePackVersionRow['validationFindings']>(null);
  const [draftValid, setDraftValid] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function classifyError(err: any) {
    if (err.status === 401) setUnauthorized(true);
    else if (err.status === 403) setForbidden(true);
    else setError(err.message);
  }

  function load() {
    setLoading(true);
    setError(null);
    setUnauthorized(false);
    setForbidden(false);
    postingEngineApi.listRulePacks()
      .then((res) => setPacks(res.items))
      .catch(classifyError)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleValidateDraft() {
    setActionError(null);
    setBusy(true);
    try {
      const result = await postingEngineApi.validateDraft(draftSource);
      setDraftValid(result.valid);
      setDraftFindings(result.findings);
    } catch (err: any) {
      if (err.status === 401) setUnauthorized(true);
      else if (err.status === 403) setForbidden(true);
      else setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDraft() {
    setActionError(null);
    setBusy(true);
    try {
      await postingEngineApi.createRulePackVersion(draftPackKey, draftSource);
      setDraftSource('');
      setDraftPackKey('');
      setDraftFindings(null);
      setDraftValid(null);
      load();
    } catch (err: any) {
      if (err.status === 401) setUnauthorized(true);
      else if (err.status === 403) setForbidden(true);
      else setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleValidateVersion(id: string) {
    setActionError(null);
    setBusy(true);
    try {
      const result = await postingEngineApi.validateVersion(id);
      setSelectedVersion(result.version);
      load();
    } catch (err: any) {
      if (err.status === 401) setUnauthorized(true);
      else if (err.status === 403) setForbidden(true);
      else setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleActivateVersion(id: string) {
    setActionError(null);
    setBusy(true);
    try {
      const activated = await postingEngineApi.activateVersion(id);
      setSelectedVersion(activated);
      load();
    } catch (err: any) {
      if (err.status === 401) setUnauthorized(true);
      else if (err.status === 403) setForbidden(true);
      else setActionError(err.body?.message ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  const selectedPack = packs.find((p) => p.pack.packKey === selectedPackKey) ?? null;

  return (
    <div style={{ maxWidth: 960, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Posting Rules</h1>
      <p style={{ color: '#555' }}>
        Author, validate and activate Posting DSL v1 rule-pack versions. Activated versions are immutable.
      </p>

      {loading && <p data-testid="posting-rules-loading">Loading rule packs…</p>}
      {unauthorized && (
        <p data-testid="posting-rules-unauthorized" style={{ color: '#b91c1c' }}>
          You must sign in to view posting rules.
        </p>
      )}
      {forbidden && !unauthorized && (
        <p data-testid="posting-rules-forbidden" style={{ color: '#b91c1c' }}>
          You do not have permission to view posting rules.
        </p>
      )}
      {error && !unauthorized && !forbidden && (
        <p data-testid="posting-rules-error" style={{ color: '#b91c1c' }}>{error}</p>
      )}

      {!loading && !error && !unauthorized && !forbidden && (
        <>
          {packs.length === 0 && <p data-testid="posting-rules-empty">No rule packs found for this tenant.</p>}

          {packs.length > 0 && (
            <ul data-testid="posting-rules-pack-list" style={{ listStyle: 'none', padding: 0 }}>
              {packs.map(({ pack, versions }) => (
                <li key={pack.id} data-testid={`posting-rules-pack-${pack.packKey}`} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600 }}>{pack.packKey}</div>
                    <button data-testid={`posting-rules-select-${pack.packKey}`} onClick={() => setSelectedPackKey(pack.packKey)}>
                      View versions ({versions.length})
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {selectedPack && (
            <div data-testid="posting-rules-version-history" style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>{selectedPack.pack.packKey} — version history</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                    <th>Semver</th><th>Status</th><th>Effective from</th><th>Effective to</th><th>Content hash</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPack.versions.map((v) => (
                    <tr key={v.id} data-testid={`posting-rules-version-row-${v.id}`} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td>{v.semver}</td>
                      <td data-testid={`posting-rules-version-status-${v.id}`}>{v.status}</td>
                      <td>{v.effectiveFrom?.slice(0, 10)}</td>
                      <td>{v.effectiveTo ? v.effectiveTo.slice(0, 10) : '—'}</td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{v.contentHash.slice(0, 12)}…</td>
                      <td>
                        <button data-testid={`posting-rules-view-${v.id}`} onClick={() => setSelectedVersion(v)}>View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedVersion && (
            <div data-testid="posting-rules-version-detail" style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 16 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600 }}>
                Version {selectedVersion.semver} — <span data-testid="posting-rules-version-detail-status">{selectedVersion.status}</span>
              </h3>
              {(selectedVersion.status === 'ACTIVE' || selectedVersion.status === 'SUPERSEDED') && (
                <p data-testid="posting-rules-version-readonly" style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', padding: 8, borderRadius: 4 }}>
                  This version is {selectedVersion.status.toLowerCase()} and immutable. Content hash: {selectedVersion.contentHash}
                  {selectedVersion.activatedBy && <> — activated by {selectedVersion.activatedBy} at {selectedVersion.activatedAt}</>}
                </p>
              )}
              {selectedVersion.validationFindings && selectedVersion.validationFindings.length > 0 && (
                <ul data-testid="posting-rules-findings">
                  {selectedVersion.validationFindings.map((f, i) => (
                    <li key={i} data-testid={`posting-rules-finding-${i}`} style={{ color: f.severity === 'ERROR' ? '#b91c1c' : '#92400e' }}>
                      [{f.severity}] {f.code} @ {f.path}: {f.message}
                    </li>
                  ))}
                </ul>
              )}
              {selectedVersion.status === 'DRAFT' && (
                <button data-testid={`posting-rules-validate-version-${selectedVersion.id}`} disabled={busy} onClick={() => handleValidateVersion(selectedVersion.id)}>
                  Validate
                </button>
              )}
              {selectedVersion.status === 'VALIDATED' && (
                <button data-testid={`posting-rules-activate-version-${selectedVersion.id}`} disabled={busy} onClick={() => handleActivateVersion(selectedVersion.id)}>
                  Activate
                </button>
              )}
            </div>
          )}

          <div style={{ marginTop: 24, borderTop: '1px solid #eee', paddingTop: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>New draft rule pack version</h2>
            <label style={{ display: 'block', marginBottom: 8 }}>
              Pack key
              <input data-testid="posting-rules-draft-pack-key" value={draftPackKey} onChange={(e) => setDraftPackKey(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }} />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              Rule pack JSON (Posting DSL v1)
              <textarea
                data-testid="posting-rules-draft-json"
                value={draftSource}
                onChange={(e) => setDraftSource(e.target.value)}
                rows={14}
                style={{ display: 'block', width: '100%', marginTop: 4, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
              />
            </label>
            {actionError && <p data-testid="posting-rules-action-error" style={{ color: '#b91c1c' }}>{actionError}</p>}
            {draftValid !== null && (
              <p data-testid="posting-rules-draft-valid" style={{ color: draftValid ? '#166534' : '#b91c1c' }}>
                {draftValid ? 'Valid — no errors found.' : 'Invalid — see findings below.'}
              </p>
            )}
            {draftFindings && draftFindings.length > 0 && (
              <ul data-testid="posting-rules-draft-findings">
                {draftFindings.map((f, i) => (
                  <li key={i} data-testid={`posting-rules-draft-finding-${i}`} style={{ color: f.severity === 'ERROR' ? '#b91c1c' : '#92400e' }}>
                    [{f.severity}] {f.code} @ {f.path}: {f.message}
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: 8 }}>
              <button data-testid="posting-rules-validate-draft" disabled={busy || !draftSource} onClick={handleValidateDraft}>Validate</button>
              <button data-testid="posting-rules-save-draft" disabled={busy || !draftSource || !draftPackKey} style={{ marginLeft: 8 }} onClick={handleSaveDraft}>Save draft</button>
            </div>
          </div>
        </>
      )}

      <p style={{ marginTop: 24 }}>
        <Link to="/golden-path/posting-executions">Go to Posting Executions</Link>
      </p>
    </div>
  );
}
