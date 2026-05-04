import { useState } from 'react';

interface AIInsightProps {
  context: string;
  data: Record<string, unknown>;
  pageType: 'dashboard' | 'general-ledger' | 'reports' | 'analytics' | 'payroll';
}

const PROMPTS: Record<string, string> = {
  dashboard: `You are Ashley, the AMACC accounting copilot. Analyse this month's financial data and produce a 3-paragraph executive summary: (1) what happened this month vs last month, (2) what needs attention, (3) what is looking healthy. Be specific — use actual numbers from the data.`,
  'general-ledger': `Analyse these journal entries. Identify any entries that look unusual, any accounts that are moving in unexpected directions, and summarise what the overall activity tells you about this period's financial health. If technician, part, or department data is available, include those insights.`,
  reports: `Analyse this report data. Identify trends, anomalies, and actionable insights. Compare current period to prior periods where data is available. Be specific with numbers.`,
  analytics: `Analyse these analytics metrics. What patterns do you see in GL posting volume, agent interventions, EOM close duration, and payroll? What should the controller focus on?`,
  payroll: `Analyse this payroll batch data. Identify: any employees with unusual pay vs prior periods, any earning codes with unexpected amounts, the department with highest payroll cost, and whether total is within budget. If line-level detail with earning codes is available, break it down.`,
};

export default function AIInsight({ context, data, pageType }: AIInsightProps) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timestamp, setTimestamp] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setNarrative(null);
    try {
      const prompt = `${PROMPTS[pageType]}\n\nHere is the data:\n${JSON.stringify(data, null, 2)}`;
      const resp = await fetch('/api/v1/agents/t1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': localStorage.getItem('tenantId') ?? 'tenant-kunes',
        },
        body: JSON.stringify({ message: prompt, tenantId: localStorage.getItem('tenantId') ?? 'tenant-kunes' }),
      });
      if (!resp.ok) {
        setNarrative('Unable to generate insight at this time.');
        setLoading(false);
        return;
      }
      const reader = resp.body?.getReader();
      if (!reader) { setNarrative('No response stream.'); setLoading(false); return; }
      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'text') { accumulated += evt.content; setNarrative(accumulated); }
            if (evt.type === 'done') break;
            if (evt.type === 'error') { setNarrative(accumulated || `Error: ${evt.message}`); }
          } catch { /* skip malformed SSE lines */ }
        }
      }
      if (!accumulated) setNarrative('No insight generated.');
      setTimestamp(new Date().toLocaleString());
    } catch (err) {
      setNarrative('Error connecting to AI service.');
    }
    setLoading(false);
  };

  const share = () => {
    if (narrative) {
      navigator.clipboard.writeText(`AMACC AI Insight (${pageType}) — ${timestamp}\n\n${narrative}`);
    }
  };

  return (
    <div className="mt-4">
      {!narrative && (
        <button
          onClick={generate}
          disabled={loading}
          className="bg-amacc-600 text-white px-4 py-2 rounded text-sm hover:bg-amacc-700 disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" /><path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
              Generating...
            </>
          ) : (
            'Generate Insight'
          )}
        </button>
      )}

      {narrative && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-blue-700">AI Insight</span>
              <span className="text-[10px] text-gray-400">{timestamp}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={share} className="text-xs text-blue-600 hover:underline">Share</button>
              <button onClick={generate} disabled={loading} className="text-xs text-blue-600 hover:underline">
                {loading ? 'Regenerating...' : 'Regenerate'}
              </button>
            </div>
          </div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {narrative}
          </div>
        </div>
      )}
    </div>
  );
}
