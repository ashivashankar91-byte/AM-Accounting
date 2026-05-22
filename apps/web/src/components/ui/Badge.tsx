import React from 'react';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple';

interface BadgeProps {
  variant?: BadgeVariant;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

const variantClass: Record<BadgeVariant, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger:  'bg-red-50 text-red-700 border-red-200',
  info:    'bg-brand-light text-brand border-brand-border',
  neutral: 'bg-slate-50 text-slate-600 border-slate-200',
  purple:  'bg-purple-50 text-purple-700 border-purple-200',
};

const dotClass: Record<BadgeVariant, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger:  'bg-red-500',
  info:    'bg-brand',
  neutral: 'bg-slate-400',
  purple:  'bg-purple-500',
};

export function Badge({ variant = 'neutral', dot = false, children, className = '' }: BadgeProps) {
  return (
    <span className={[
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border',
      variantClass[variant],
      className,
    ].join(' ')}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass[variant]}`} />}
      {children}
    </span>
  );
}
