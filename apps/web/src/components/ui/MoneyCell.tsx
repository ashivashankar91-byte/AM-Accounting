import React from 'react';

type ColorCode = 'auto' | 'green' | 'red' | 'none';

interface MoneyCellProps {
  value: number | string | null | undefined;
  currency?: string;
  decimals?: number;
  colorCode?: ColorCode;
  className?: string;
  zeroDisplay?: string;
}

function formatMoney(value: number | string | null | undefined, decimals: number, zeroDisplay?: string): string {
  if (value === null || value === undefined || value === '') return zeroDisplay ?? '—';
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(n)) return zeroDisplay ?? '—';
  if (n === 0 && zeroDisplay) return zeroDisplay;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function resolveColor(value: number | string | null | undefined, colorCode: ColorCode): string {
  if (colorCode === 'none') return '';
  if (colorCode === 'green') return 'text-emerald-600';
  if (colorCode === 'red') return 'text-red-600';
  if (colorCode === 'auto') {
    const n = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
    if (typeof n === 'number' && !isNaN(n)) {
      if (n < 0) return 'text-red-600';
      if (n > 0) return 'text-emerald-600';
    }
  }
  return '';
}

export function MoneyCell({
  value,
  currency = '$',
  decimals = 2,
  colorCode = 'none',
  className = '',
  zeroDisplay,
}: MoneyCellProps) {
  const formatted = formatMoney(value, decimals, zeroDisplay);
  const colorClass = resolveColor(value, colorCode);

  return (
    <span className={['font-mono text-right tabular-nums', colorClass, className].join(' ')}>
      {formatted !== '—' && formatted !== zeroDisplay ? `${currency}${formatted}` : formatted}
    </span>
  );
}
