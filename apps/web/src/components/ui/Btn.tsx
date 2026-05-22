import React from 'react';

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type BtnSize = 'sm' | 'md' | 'lg';

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  shortcut?: string;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantClass: Record<BtnVariant, string> = {
  primary:   'bg-brand text-white hover:bg-brand-hover focus:ring-brand rounded-lg font-medium',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 focus:ring-slate-200 rounded-lg font-medium',
  danger:    'bg-danger text-white hover:bg-red-700 focus:ring-red-300 rounded-lg font-medium',
  ghost:     'bg-transparent text-slate-600 hover:bg-slate-100 focus:ring-slate-200 rounded-lg font-medium',
};

const sizeClass: Record<BtnSize, string> = {
  sm: 'h-7 px-3 text-xs gap-1.5',
  md: 'h-8 px-4 text-sm gap-2',
  lg: 'h-10 px-5 text-sm gap-2',
};

export function Btn({
  variant = 'primary',
  size = 'md',
  shortcut,
  loading = false,
  icon,
  children,
  disabled,
  className = '',
  ...rest
}: BtnProps) {
  return (
    <button
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantClass[variant],
        sizeClass[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {children}
      {shortcut && !loading && (
        <kbd className="ml-1 px-1 py-0.5 text-[10px] font-mono bg-white/20 rounded border border-current/20 leading-none">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
