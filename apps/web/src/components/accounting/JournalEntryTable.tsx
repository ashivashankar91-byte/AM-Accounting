import { useState, useRef } from 'react';
import { Trash2, Check, X } from 'lucide-react';
import GLAccountLookup, { GLAccount } from './GLAccountLookup';

export interface JournalLine {
  id: string;
  accountCode: string;
  department?: string;
  debit: number;
  credit: number;
  memo?: string;
}

interface JournalEntryTableProps {
  lines: JournalLine[];
  onChange: (lines: JournalLine[]) => void;
  readOnly?: boolean;
  className?: string;
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

export default function JournalEntryTable({
  lines,
  onChange,
  readOnly = false,
  className = '',
}: JournalEntryTableProps) {
  const [focusedCell, setFocusedCell] = useState<{ lineId: string; field: string } | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const totalDebits = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredits = lines.reduce((sum, line) => sum + (line.credit || 0), 0);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

  const handleAccountChange = (lineId: string, code: string, account?: GLAccount) => {
    const updated = lines.map((line) =>
      line.id === lineId
        ? { ...line, accountCode: code }
        : line
    );
    onChange(updated);
  };

  const handleFieldChange = (lineId: string, field: 'debit' | 'credit' | 'department' | 'memo', value: any) => {
    const updated = lines.map((line) =>
      line.id === lineId
        ? {
            ...line,
            [field]: field === 'debit' || field === 'credit' ? parseFloat(value) || 0 : value,
          }
        : line
    );
    onChange(updated);
  };

  const handleDeleteLine = (lineId: string) => {
    onChange(lines.filter((line) => line.id !== lineId));
  };

  const handleCopyLine = (lineId: string) => {
    const sourceLine = lines.find((l) => l.id === lineId);
    if (sourceLine) {
      const newLine: JournalLine = {
        ...sourceLine,
        id: generateId(),
        debit: sourceLine.debit,
        credit: sourceLine.credit,
      };
      const sourceIndex = lines.findIndex((l) => l.id === lineId);
      const newLines = [...lines.slice(0, sourceIndex + 1), newLine, ...lines.slice(sourceIndex + 1)];
      onChange(newLines);
    }
  };

  const handleKeyDown = (lineId: string, field: string, e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      handleCopyLine(lineId);
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      handleDeleteLine(lineId);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const currentIndex = lines.findIndex((l) => l.id === lineId);
      const fieldOrder = ['account', 'department', 'debit', 'credit'];
      const currentFieldIndex = fieldOrder.indexOf(field);

      if (field === 'credit' && currentIndex === lines.length - 1) {
        // Auto-add new line on Tab from last credit field
        const newLine: JournalLine = {
          id: generateId(),
          accountCode: '',
          debit: 0,
          credit: 0,
        };
        onChange([...lines, newLine]);
      } else {
        // Move focus to next field
        const nextFieldIndex = (currentFieldIndex + 1) % fieldOrder.length;
        const nextField = fieldOrder[nextFieldIndex];
        const nextLineId = nextFieldIndex <= currentFieldIndex ? lines[currentIndex + 1]?.id : lineId;

        if (nextLineId) {
          setTimeout(() => {
            const nextRef = inputRefs.current[`${nextLineId}-${nextField}`];
            if (nextRef) nextRef.focus();
          }, 0);
        }
      }
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="overflow-x-auto border border-gray-300 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-300">
              <th className="px-3 py-2 text-left font-semibold text-gray-700 w-8">#</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-700 min-w-[250px]">GL Account</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-700 w-32">Dept</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700 w-32">Debit</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700 w-32">Credit</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-700 flex-1">Memo</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-700 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={line.id} className="border-b border-gray-200 hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-600 font-medium">{idx + 1}</td>
                <td className="px-3 py-2">
                  <GLAccountLookup
                    value={line.accountCode}
                    onChange={(code, account) => handleAccountChange(line.id, code, account)}
                    disabled={readOnly}
                    placeholder="Account code or description"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    ref={(el) => {
                      if (el) inputRefs.current[`${line.id}-department`] = el;
                    }}
                    type="text"
                    value={line.department || ''}
                    onChange={(e) => handleFieldChange(line.id, 'department', e.target.value)}
                    onKeyDown={(e) => handleKeyDown(line.id, 'department', e)}
                    onFocus={() => setFocusedCell({ lineId: line.id, field: 'department' })}
                    onBlur={() => setFocusedCell(null)}
                    disabled={readOnly}
                    placeholder="Dept"
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-100"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    ref={(el) => {
                      if (el) inputRefs.current[`${line.id}-debit`] = el;
                    }}
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.debit === 0 ? '' : line.debit}
                    onChange={(e) => handleFieldChange(line.id, 'debit', e.target.value)}
                    onKeyDown={(e) => handleKeyDown(line.id, 'debit', e)}
                    onFocus={() => setFocusedCell({ lineId: line.id, field: 'debit' })}
                    onBlur={() => setFocusedCell(null)}
                    disabled={readOnly}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-100"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    ref={(el) => {
                      if (el) inputRefs.current[`${line.id}-credit`] = el;
                    }}
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.credit === 0 ? '' : line.credit}
                    onChange={(e) => handleFieldChange(line.id, 'credit', e.target.value)}
                    onKeyDown={(e) => handleKeyDown(line.id, 'credit', e)}
                    onFocus={() => setFocusedCell({ lineId: line.id, field: 'credit' })}
                    onBlur={() => setFocusedCell(null)}
                    disabled={readOnly}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-100"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={line.memo || ''}
                    onChange={(e) => handleFieldChange(line.id, 'memo', e.target.value)}
                    disabled={readOnly}
                    placeholder="Memo"
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-100"
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  {!readOnly && (
                    <button
                      onClick={() => handleDeleteLine(line.id)}
                      className="text-red-600 hover:text-red-800 p-1"
                      title="Delete row (or press Delete)"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border border-gray-300 rounded-lg p-3 bg-gray-50">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-right">
            <div className="text-xs text-gray-600 mb-1">Total Debits</div>
            <div className="font-mono font-semibold text-right">${totalDebits.toFixed(2)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-600 mb-1">Total Credits</div>
            <div className="font-mono font-semibold text-right">${totalCredits.toFixed(2)}</div>
          </div>
          <div className={`text-right flex items-center justify-end gap-2 ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>
            <div>
              <div className="text-xs text-gray-600 mb-1">Balance</div>
              <div className="font-mono font-semibold text-right">${(totalDebits - totalCredits).toFixed(2)}</div>
            </div>
            {isBalanced ? (
              <Check className="w-5 h-5 text-green-600" />
            ) : (
              <X className="w-5 h-5 text-red-600" />
            )}
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-500 space-y-1">
        <p>Keyboard shortcuts: Ctrl+D to copy line, Delete to remove, Tab to next cell (auto-adds row at end)</p>
      </div>
    </div>
  );
}
