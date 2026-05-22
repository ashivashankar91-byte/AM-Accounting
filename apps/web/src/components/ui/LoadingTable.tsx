import React from 'react';

interface LoadingTableProps {
  rows?: number;
  cols?: number;
  className?: string;
}

export function LoadingTable({ rows = 8, cols = 5, className = '' }: LoadingTableProps) {
  const colWidths = ['w-24', 'w-32', 'w-48', 'w-20', 'w-28'];

  return (
    <div className={['animate-pulse', className].join(' ')}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 h-9 border-b border-slate-100">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className={['h-3 rounded bg-slate-200', colWidths[c % colWidths.length]].join(' ')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
