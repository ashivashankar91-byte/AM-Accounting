import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface AuditEntry {
  timestamp: Date;
  userId: string;
  action: string;
  beforeValue?: any;
  afterValue?: any;
}

interface AuditTrailViewerProps {
  entries: AuditEntry[];
  className?: string;
}

function formatTimestamp(date: Date): string {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  return date.toISOString();
}

function formatJsonDiff(before: any, after: any): string {
  const beforeStr = typeof before === 'string' ? before : JSON.stringify(before, null, 2);
  const afterStr = typeof after === 'string' ? after : JSON.stringify(after, null, 2);
  return `${beforeStr} → ${afterStr}`;
}

export default function AuditTrailViewer({
  entries,
  className = '',
}: AuditTrailViewerProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedRows(newExpanded);
  };

  const hasDetails = (entry: AuditEntry) => entry.beforeValue !== undefined || entry.afterValue !== undefined;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="border border-gray-300 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-300">
              <th className="px-4 py-3 text-left font-semibold text-gray-700 w-8"></th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 w-40">Timestamp</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 w-32">User</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 flex-1">Action</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-gray-500 text-sm">
                  No audit entries
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => {
                const isExpanded = expandedRows.has(index);
                const hasDetails_ = hasDetails(entry);

                return (
                  <div key={index}>
                    <tr className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 text-center">
                        {hasDetails_ && (
                          <button
                            onClick={() => toggleExpanded(index)}
                            className="p-0.5 hover:bg-gray-200 rounded"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-600" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-600" />
                            )}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {formatTimestamp(entry.timestamp)}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                        {entry.userId}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{entry.action}</td>
                    </tr>

                    {isExpanded && hasDetails_ && (
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <td colSpan={4} className="px-4 py-3">
                          <div className="space-y-2">
                            {entry.beforeValue !== undefined && (
                              <div>
                                <div className="text-xs font-semibold text-gray-700 mb-1">
                                  Before:
                                </div>
                                <div className="bg-white border border-gray-300 rounded p-2 font-mono text-xs text-gray-600 break-words max-h-32 overflow-y-auto">
                                  {typeof entry.beforeValue === 'object'
                                    ? JSON.stringify(entry.beforeValue, null, 2)
                                    : String(entry.beforeValue)}
                                </div>
                              </div>
                            )}
                            {entry.afterValue !== undefined && (
                              <div>
                                <div className="text-xs font-semibold text-gray-700 mb-1">
                                  After:
                                </div>
                                <div className="bg-white border border-gray-300 rounded p-2 font-mono text-xs text-gray-600 break-words max-h-32 overflow-y-auto">
                                  {typeof entry.afterValue === 'object'
                                    ? JSON.stringify(entry.afterValue, null, 2)
                                    : String(entry.afterValue)}
                                </div>
                              </div>
                            )}
                            {entry.beforeValue !== undefined && entry.afterValue !== undefined && (
                              <div>
                                <div className="text-xs font-semibold text-gray-700 mb-1">
                                  Change:
                                </div>
                                <div className="bg-brand-light border border-blue-300 rounded p-2 font-mono text-xs text-gray-600 break-words">
                                  {formatJsonDiff(entry.beforeValue, entry.afterValue)}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </div>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {entries.length > 0 && (
        <div className="text-xs text-gray-500 text-right">
          Total entries: {entries.length}
        </div>
      )}
    </div>
  );
}
