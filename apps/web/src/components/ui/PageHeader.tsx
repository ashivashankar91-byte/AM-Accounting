import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Status badge rendered inline next to the title (e.g. <Badge variant="success">Certified</Badge>). */
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, badge, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={['flex items-start justify-between mb-6', className].join(' ')}>
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
