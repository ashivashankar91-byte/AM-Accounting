import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  accountCode: string;
}

export interface FinancialStatementData {
  lineAmounts: Record<string, number>;
  departmentAmounts: Record<string, Record<string, number>>;
  structure?: Array<{
    code: string;
    label: string;
    level: number;
    children?: string[];
  }>;
}

interface FinancialStatementViewerProps {
  data: FinancialStatementData;
  onDrillDown?: (lineCode: string, transactions: Transaction[]) => void;
  className?: string;
}

export default function FinancialStatementViewer({
  data,
  onDrillDown,
  className = '',
}: FinancialStatementViewerProps) {
  const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());
  const [selectedLine, setSelectedLine] = useState<string | null>(null);

  const toggleExpanded = (code: string) => {
    const newExpanded = new Set(expandedLines);
    if (newExpanded.has(code)) {
      newExpanded.delete(code);
    } else {
      newExpanded.add(code);
    }
    setExpandedLines(newExpanded);
  };

  const handleLineClick = (code: string) => {
    setSelectedLine(code);
    if (onDrillDown) {
      // In a real app, would fetch transactions from API
      const mockTransactions: Transaction[] = [
        {
          id: '1',
          date: new Date().toISOString().split('T')[0],
          description: 'Sample transaction',
          amount: data.lineAmounts[code] || 0,
          accountCode: code,
        },
      ];
      onDrillDown(code, mockTransactions);
    }
  };

  const renderLine = (code: string, label: string, level: number, isExpandable: boolean = false) => {
    const amount = data.lineAmounts[code] || 0;
    const isExpanded = expandedLines.has(code);
    const indentPixels = level * 24;

    return (
      <tr
        key={code}
        className={`hover:bg-brand-light cursor-pointer transition-colors border-b border-gray-200 ${
          selectedLine === code ? 'bg-blue-100' : ''
        }`}
        onClick={() => handleLineClick(code)}
      >
        <td className="px-4 py-2" style={{ paddingLeft: `${indentPixels + 16}px` }}>
          <div className="flex items-center gap-2">
            {isExpandable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded(code);
                }}
                className="p-0.5 hover:bg-gray-200 rounded"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-600" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-600" />
                )}
              </button>
            )}
            {!isExpandable && <div className="w-4" />}
            <span className={level === 0 ? 'font-bold' : level === 1 ? 'font-semibold' : ''}>
              {label}
            </span>
          </div>
        </td>
        <td className="px-4 py-2 text-right font-mono text-sm">
          {amount < 0 ? (
            <span className="text-red-600">({Math.abs(amount).toFixed(2)})</span>
          ) : (
            <span>{amount.toFixed(2)}</span>
          )}
        </td>
        {level === 1 && (
          <td className="px-4 py-2 text-right text-xs text-gray-600">
            {data.lineAmounts[code] !== undefined ? (
              <>
                {(
                  ((Math.abs(data.lineAmounts[code]) || 0) /
                    (Math.abs(data.lineAmounts[Object.keys(data.lineAmounts)[0]] || 1) || 1)) *
                  100
                ).toFixed(1)}
                %
              </>
            ) : null}
          </td>
        )}
      </tr>
    );
  };

  // Build a simple hierarchical structure if not provided
  const lines = Object.entries(data.lineAmounts).map(([code, amount]) => ({
    code,
    label: code,
    amount,
    level: 0,
  }));

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="border border-gray-300 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-300">
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Description</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-700 w-40">Amount</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-700 w-24">% of Parent</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => renderLine(line.code, line.label, line.level, false))}
          </tbody>
        </table>
      </div>

      {selectedLine && (
        <div className="bg-brand-light border border-blue-300 rounded-lg p-3">
          <div className="text-xs text-brand">
            <strong>Selected:</strong> {selectedLine} —{' '}
            {data.lineAmounts[selectedLine] !== undefined
              ? `$${data.lineAmounts[selectedLine].toFixed(2)}`
              : 'No amount'}
          </div>
          {onDrillDown && (
            <div className="text-xs text-brand mt-1">Click to view transactions</div>
          )}
        </div>
      )}
    </div>
  );
}
