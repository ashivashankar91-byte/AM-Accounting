type Status = 'POSTED' | 'PENDING_REVIEW' | 'FLAGGED' | 'DRAFT' | 'PROCESSING' | 'CLOSED' | 'OPEN' | 'BLOCKED' | 'COMPLETE' | 'REVERSED' | 'IN_PROGRESS' | 'VALIDATED' | 'SUBMITTED' | 'RELEASED' | 'RUNNING' | 'DONE' | string;

const COLORS: Record<string, { bg: string; text: string }> = {
  POSTED:         { bg: '#ECFDF5', text: '#059669' },
  PENDING_REVIEW: { bg: '#FFFBEB', text: '#D97706' },
  FLAGGED:        { bg: '#FEF2F2', text: '#DC2626' },
  DRAFT:          { bg: '#F1F5F9', text: '#64748B' },
  PROCESSING:     { bg: '#EEF2FD', text: '#1B4FE4' },
  IN_PROGRESS:    { bg: '#EEF2FD', text: '#1B4FE4' },
  RUNNING:        { bg: '#EEF2FD', text: '#1B4FE4' },
  CLOSED:         { bg: '#F1F5F9', text: '#374151' },
  DONE:           { bg: '#ECFDF5', text: '#059669' },
  OPEN:           { bg: '#EEF2FD', text: '#1B4FE4' },
  BLOCKED:        { bg: '#FEF2F2', text: '#DC2626' },
  COMPLETE:       { bg: '#ECFDF5', text: '#059669' },
  REVERSED:       { bg: '#FEF2F2', text: '#DC2626' },
  VALIDATED:      { bg: '#ECFDF5', text: '#059669' },
  SUBMITTED:      { bg: '#EEF2FD', text: '#1B4FE4' },
  RELEASED:       { bg: '#ECFDF5', text: '#059669' },
};

const DEFAULT = { bg: '#F1F5F9', text: '#64748B' };

export default function StatusBadge({ status }: { status: Status }) {
  if (!status) return null;
  const c = COLORS[status] ?? DEFAULT;
  return (
    <span
      style={{ backgroundColor: c.bg, color: c.text }}
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide uppercase whitespace-nowrap"
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
