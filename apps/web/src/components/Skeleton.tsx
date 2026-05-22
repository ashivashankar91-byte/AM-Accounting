export function SkeletonText({ width = '60%', height = '16px' }: { width?: string; height?: string }) {
  return <div className="skeleton" style={{ width, height }} />;
}

export function SkeletonBox({ width = '100%', height = '48px' }: { width?: string; height?: string }) {
  return <div className="skeleton" style={{ width, height, borderRadius: 12 }} />;
}

export function SkeletonKPI() {
  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="skeleton" style={{ width: '45%', height: 14 }} />
        <div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%' }} />
      </div>
      <div className="skeleton" style={{ width: '60%', height: 28 }} />
      <div className="skeleton mt-2" style={{ width: '40%', height: 12 }} />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      {/* Header */}
      <div className="flex gap-4 px-4 py-3" style={{ background: '#F8FAFC', borderBottom: '2px solid #E5E7EB' }}>
        {Array.from({ length: cols }).map((_, c) => (
          <div key={c} className="skeleton flex-1" style={{ height: 12 }} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3" style={{ borderBottom: '1px solid #F1F5F9' }}>
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skeleton flex-1" style={{ height: 14 }} />
          ))}
        </div>
      ))}
    </div>
  );
}
