// Golden R0 UI convergence — Accounting context bar, Section 03 spec:
// "Sticky under the header. Present on every Accounting screen with
// identical field order." (design doc line 613).
//
// Dashboard rebuild (AMACC 2.0 non-negotiable constraint): "Entity is a
// first-class axis, not a filter... The current 'Legal entity: Not
// selected' state must not be reachable." The field is now a real picker
// backed by `EntityScopeContext`, which auto-selects the tenant's first
// legal entity the moment the entity list loads, so an authenticated
// session can no longer render "Not selected" — it renders "Loading…"
// while entities are being fetched, an explicit "No legal entities
// configured" empty state if the tenant genuinely has none, or the
// selected/consolidated entity otherwise. Store / Department / Fiscal
// period remain per-screen local state on individual report pages
// (GLInquiry, TrialBalance, etc.) — unchanged, out of scope here.

import { useEntityScope } from '../../context/EntityScopeContext';

interface ContextBarProps {
  tenantId: string;
  userDisplayName: string;
}

function Field({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    // Golden R0 Phase — narrow-width/200%-zoom fix: this used to be a single
    // nowrap flex row, so a long value (the tenant UUID especially) forced
    // the whole bar wider than the viewport, clipping "Signed in as" off the
    // right edge instead of wrapping. min-w-0 + break-words let each field
    // shrink and wrap its own value instead of pushing siblings off-screen.
    <div className="px-4 py-2 border-r border-b border-slate-200 last:border-r-0 min-w-0 flex-1 basis-[200px]">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-[13px] font-medium mt-0.5 break-words ${muted ? 'text-slate-400 italic font-normal' : 'text-slate-900'}`}>
        {value}
      </div>
    </div>
  );
}

export function ContextBar({ tenantId, userDisplayName }: ContextBarProps) {
  const { entityId, entities, loading, noEntitiesConfigured, consolidated, setEntity, setConsolidated } = useEntityScope();

  return (
    // flex-wrap (was nowrap): at narrow widths / 200% zoom the three fields
    // now wrap onto additional rows instead of overflowing the viewport —
    // all three values stay visible, none are clipped or truncated.
    <div className="flex flex-wrap items-stretch bg-slate-50 border-b border-slate-200 text-[12.5px]">
      <Field label="Tenant" value={tenantId} />
      <div className="px-4 py-2 border-r border-b border-slate-200 last:border-r-0 min-w-0 flex-1 basis-[200px]">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Legal entity</div>
        {loading && (
          <div className="text-[13px] font-medium mt-0.5 text-slate-400 italic">Loading…</div>
        )}
        {!loading && noEntitiesConfigured && (
          <div
            className="text-[13px] font-medium mt-0.5 text-amber-700"
            title="No legal entities are configured for this tenant. Create one in Organization Setup before using entity-scoped screens."
          >
            No legal entities configured
          </div>
        )}
        {!loading && !noEntitiesConfigured && (
          <select
            data-testid="context-bar-entity-select"
            className="text-[13px] font-medium mt-0.5 text-slate-900 bg-transparent border-0 p-0 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded cursor-pointer max-w-full"
            value={consolidated ? '__consolidated__' : entityId ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '__consolidated__') {
                setConsolidated(true);
                return;
              }
              const picked = entities.find((entity) => entity.id === val);
              if (picked) setEntity(picked.id, `${picked.entityCode} — ${picked.legalName}`);
            }}
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.entityCode} — {entity.legalName}
              </option>
            ))}
            <option value="__consolidated__">Consolidated (all entities)</option>
          </select>
        )}
      </div>
      <Field label="Signed in as" value={userDisplayName} />
    </div>
  );
}
