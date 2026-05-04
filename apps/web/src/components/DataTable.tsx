import { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  render?: (row: T) => ReactNode;
  mono?: boolean;
  width?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyIcon?: string;
  emptyTitle?: string;
  emptySubtitle?: string;
  keyField?: string;
}

export default function DataTable<T extends Record<string, any>>({
  columns, data, onRowClick, emptyIcon = '📋', emptyTitle = 'No data', emptySubtitle, keyField = 'id',
}: DataTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <span className="text-4xl mb-3">{emptyIcon}</span>
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{emptyTitle}</p>
          {emptySubtitle && <p className="text-xs mt-1" style={{ color: 'var(--text-subtle)' }}>{emptySubtitle}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <table className="w-full">
        <thead>
          <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E5E7EB' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider"
                style={{ color: '#374151', textAlign: col.align ?? 'left', width: col.width }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={row[keyField] ?? i}
              className="transition-colors duration-150"
              style={{ borderBottom: '1px solid #F1F5F9', cursor: onRowClick ? 'pointer' : undefined }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-4 py-3 text-[13px] ${col.mono ? 'font-mono' : ''}`}
                  style={{ color: '#374151', textAlign: col.align ?? 'left' }}
                >
                  {col.render ? col.render(row) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
