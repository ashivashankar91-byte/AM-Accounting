import { useQuery } from '@tanstack/react-query';
import { glApi } from '../../api/client';
import { Lock } from 'lucide-react';

export interface Period {
  code: string;
  name: string;
  isClosed: boolean;
}

interface PeriodSelectorProps {
  value: string;
  onChange: (period: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function PeriodSelector({
  value,
  onChange,
  disabled = false,
  className = '',
}: PeriodSelectorProps) {
  const { data: periods = [], isLoading, error } = useQuery({
    queryKey: ['periods'],
    queryFn: glApi.getPeriods,
    staleTime: 60_000,
    retry: 1,
  });

  const errorMessage = error ? (error as any).message : null;

  return (
    <div className={className}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || isLoading}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-100 disabled:cursor-not-allowed"
      >
        <option value="">
          {isLoading ? 'Loading periods...' : 'Select a period'}
        </option>
        {periods.map((period: Period) => (
          <option
            key={period.code}
            value={period.code}
            disabled={period.isClosed}
            className={period.isClosed ? 'opacity-50' : ''}
          >
            {period.isClosed ? '🔒 ' : ''}
            {period.name}
            {period.isClosed ? ' (CLOSED)' : ' (OPEN)'}
          </option>
        ))}
      </select>

      {errorMessage && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {errorMessage}
        </div>
      )}

      <div className="mt-2 space-y-1 text-xs text-gray-600">
        <div>
          <Lock className="w-3 h-3 inline mr-1" />
          <span>Closed periods cannot be modified</span>
        </div>
      </div>
    </div>
  );
}
