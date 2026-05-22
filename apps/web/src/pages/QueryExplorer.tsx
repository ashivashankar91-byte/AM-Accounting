import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const tenantId = () => localStorage.getItem('tenantId') || 'tenant-kunes';

const EXAMPLE_QUERIES = [
  'Which technician had most flat-rate hours last month?',
  'Show me all GL entries over $10,000 this quarter',
  'Total payroll cost by department for March 2026',
  'Parts sold below cost last 30 days',
  'Highest F&I gross profit deals this year',
];

export default function QueryExplorer() {
  const [question, setQuestion] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [columns, setColumns] = useState<string[]>([]);

  const runQuery = async (q: string) => {
    setLoading(true);
    setError('');
    setResults(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/query/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId() },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) throw new Error('Query failed');
      const data = await res.json();
      const rows = data.results ?? data.rows ?? [];
      if (rows.length > 0) setColumns(Object.keys(rows[0]));
      setResults(rows);
    } catch (err: any) {
      setError(err.message || 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!results || results.length === 0) return;
    const header = columns.join(',');
    const rows = results.map(r => columns.map(c => JSON.stringify(r[c] ?? '')).join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'query-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Query Explorer</h1>
        <p className="text-sm text-gray-500 mt-0.5">Ask natural language questions about your financial data. Source: Query Service.</p>
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <input type="text" value={question} onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && question && runQuery(question)}
          placeholder="Ask anything about your financials..."
          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
        <button onClick={() => question && runQuery(question)} disabled={!question || loading}
          className="px-6 py-3 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand disabled:opacity-50">
          {loading ? 'Running...' : 'Ask'}
        </button>
      </div>

      {/* Example queries */}
      <div className="flex flex-wrap gap-2">
        {EXAMPLE_QUERIES.map(q => (
          <button key={q} onClick={() => { setQuestion(q); runQuery(q); }}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs hover:bg-gray-200 transition-colors">
            {q}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{error}</div>}

      {/* Results */}
      {results && (
        <div className="bg-white rounded-lg shadow">
          <div className="flex justify-between items-center p-4 border-b">
            <span className="text-sm text-gray-600">{results.length} results</span>
            <button onClick={exportCSV} className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">
              Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  {columns.map(c => <th key={c} className="px-4 py-2 text-left text-xs font-semibold text-gray-600">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {results.map((row: any, i: number) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    {columns.map(c => <td key={c} className="px-4 py-2 text-gray-700">{String(row[c] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
