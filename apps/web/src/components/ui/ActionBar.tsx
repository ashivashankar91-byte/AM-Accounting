import React from 'react';

interface ActionBarProps {
  children: React.ReactNode;
  className?: string;
}

export function ActionBar({ children, className = '' }: ActionBarProps) {
  return (
    <div className={[
      'fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200',
      'px-6 py-3 flex items-center gap-3',
      className,
    ].join(' ')}>
      {children}
    </div>
  );
}
