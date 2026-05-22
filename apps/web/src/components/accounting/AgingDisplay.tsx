import { useState } from 'react';

interface AgingDisplayProps {
  current: number;
  days30: number;
  days60: number;
  days90: number;
  over90: number;
  total?: number;
  className?: string;
}

interface AgeCategory {
  label: string;
  value: number;
  color: string;
  bgColor: string;
  percentage: number;
}

export default function AgingDisplay({
  current,
  days30,
  days60,
  days90,
  over90,
  total,
  className = '',
}: AgingDisplayProps) {
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);

  const totalAmount = total ?? current + days30 + days60 + days90 + over90;
  const safe = totalAmount > 0;

  const categories: AgeCategory[] = [
    {
      label: 'Current',
      value: current,
      color: 'text-emerald-700',
      bgColor: 'bg-emerald-500',
      percentage: safe ? (current / totalAmount) * 100 : 0,
    },
    {
      label: '31-60 days',
      value: days30,
      color: 'text-brand',
      bgColor: 'bg-brand-light0',
      percentage: safe ? (days30 / totalAmount) * 100 : 0,
    },
    {
      label: '61-90 days',
      value: days60,
      color: 'text-amber-700',
      bgColor: 'bg-amber-500',
      percentage: safe ? (days60 / totalAmount) * 100 : 0,
    },
    {
      label: '91-120 days',
      value: days90,
      color: 'text-orange-700',
      bgColor: 'bg-orange-500',
      percentage: safe ? (days90 / totalAmount) * 100 : 0,
    },
    {
      label: '120+ days',
      value: over90,
      color: 'text-red-700',
      bgColor: 'bg-red-600',
      percentage: safe ? (over90 / totalAmount) * 100 : 0,
    },
  ];

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="bg-white border border-gray-300 rounded-lg p-4">
        <div className="flex h-8 gap-1 rounded overflow-hidden border border-gray-300">
          {categories.map((cat) => (
            <div
              key={cat.label}
              className={`flex-grow transition-opacity ${cat.bgColor} ${
                hoveredCategory === null || hoveredCategory === cat.label ? 'opacity-100' : 'opacity-40'
              }`}
              style={{ width: `${cat.percentage}%`, minWidth: cat.percentage > 0 ? '4px' : '0' }}
              onMouseEnter={() => setHoveredCategory(cat.label)}
              onMouseLeave={() => setHoveredCategory(null)}
              title={`${cat.label}: $${cat.value.toFixed(2)} (${cat.percentage.toFixed(1)}%)`}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {categories.map((cat) => (
          <div
            key={cat.label}
            className={`p-2 rounded border-l-4 bg-gray-50 cursor-help transition-all ${
              hoveredCategory === cat.label ? 'ring-2 ring-blue-400 bg-brand-light' : 'border-l-gray-300'
            } ${hoveredCategory === null || hoveredCategory === cat.label ? '' : 'opacity-50'}`}
            onMouseEnter={() => setHoveredCategory(cat.label)}
            onMouseLeave={() => setHoveredCategory(null)}
            title={`${cat.label}: $${cat.value.toFixed(2)} (${cat.percentage.toFixed(1)}%)`}
          >
            <div className={`text-xs font-semibold ${cat.color} mb-1`}>{cat.label}</div>
            <div className="font-mono font-bold text-sm text-gray-900">${cat.value.toFixed(2)}</div>
            <div className="text-xs text-gray-600">{cat.percentage.toFixed(1)}%</div>
          </div>
        ))}
      </div>

      <div className="bg-gray-50 border border-gray-300 rounded-lg p-3 text-right">
        <span className="font-semibold text-gray-900">
          Total Due: <span className="font-mono">${totalAmount.toFixed(2)}</span>
        </span>
      </div>
    </div>
  );
}
