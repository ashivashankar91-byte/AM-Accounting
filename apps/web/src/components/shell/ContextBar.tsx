// Golden R0 UI convergence — Accounting context bar, Section 03 spec:
// "Sticky under the header. Present on every Accounting screen with
// identical field order." (design doc line 613).
//
// Phase 1 scope: tenant / legal entity / signed-in user, sourced from the
// real AuthContext (S205 login). Store / Department / Fiscal period are
// deliberately NOT shown here — those are selected per-screen on individual
// report pages (GLInquiry, TrialBalance, etc.), not as global session state
// anywhere in this app today. Wiring them into one global context selector
// is out of scope for this phase; each report screen keeps its own local
// Store/Dept filters until that's addressed.

interface ContextBarProps {
  tenantId: string;
  legalEntityLabel: string | null;
  userDisplayName: string;
}

function Field({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="px-4 py-2 border-r border-slate-200 last:border-r-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-[13px] font-medium mt-0.5 ${muted ? 'text-slate-400 italic font-normal' : 'text-slate-900'}`}>
        {value}
      </div>
    </div>
  );
}

export function ContextBar({ tenantId, legalEntityLabel, userDisplayName }: ContextBarProps) {
  return (
    <div className="flex items-stretch bg-slate-50 border-b border-slate-200 text-[12.5px]">
      <Field label="Tenant" value={tenantId} />
      <Field
        label="Legal entity"
        value={legalEntityLabel ?? 'Not selected'}
        muted={!legalEntityLabel}
      />
      <Field label="Signed in as" value={userDisplayName} />
    </div>
  );
}
