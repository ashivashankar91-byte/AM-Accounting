import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useRef, useEffect } from 'react';
import { agentApi } from '../api/client';
import HelpButton from '../components/HelpButton';
import PageLoader from '../components/PageLoader';
import PageError from '../components/PageError';
import SCREEN_HELP from '../data/screenHelp';

export default function Agents() {
  const queryClient = useQueryClient();
  const { data: logs, isLoading, error, refetch } = useQuery({ queryKey: ['agent-logs'], queryFn: agentApi.getLog, retry: false });
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const resolveMut = useMutation({
    mutationFn: (id: string) => agentApi.resolve(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-logs'] }),
  });

  const humanRequired = (logs ?? []).filter((l: any) => l.humanRequired);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  async function sendChat() {
    if (!input.trim() || streaming) return;
    const message = input;
    setInput('');
    setChatMessages((prev) => [...prev, { role: 'user', content: message }]);
    setStreaming(true);

    try {
      const tenantId = localStorage.getItem('tenantId') ?? '';
      const res = await fetch('/api/v1/agents/t1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, tenantId }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMsg = '';

      setChatMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));
          for (const line of lines) {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'text') {
              assistantMsg += data.content;
              setChatMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: assistantMsg };
                return updated;
              });
            }
          }
        }
      }
    } catch (err) {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: 'Error connecting to T1 Copilot.' }]);
    }
    setStreaming(false);
  }

  if (isLoading) return <PageLoader page="AI Agents" service="audit-service" port={3031} />;
  if (error) return <PageError error={error} serviceName="Audit Service" port={3031} retry={refetch} />;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between"><div>
          <h1 className="text-2xl font-bold">AI Agents</h1>
          <p className="text-sm text-gray-500 mt-0.5">Agent activity log, human-required alerts, and T1 Copilot chat. Source: Agent Services.</p>
        </div><HelpButton help={SCREEN_HELP['agents']} /></div>

      <div className="grid grid-cols-5 gap-3">
        {['GL Integrity', 'EOM Orchestration', 'Payroll Integrity', 'AP/AR Recon', 'T1 Copilot'].map((name) => (
          <div key={name} className="bg-white rounded-lg shadow p-3 text-center">
            <div className="text-2xl">🤖</div>
            <div className="text-sm font-medium mt-1">{name}</div>
            <div className="text-xs text-gray-500 mt-1">
              {(logs ?? []).filter((l: any) => l.agentName?.includes(name.toLowerCase().split(' ')[0])).length} actions
            </div>
          </div>
        ))}
      </div>

      {humanRequired.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-800 mb-2">Human Required Queue</h3>
          {humanRequired.map((l: any) => (
            <div key={l.id} className="flex items-center justify-between py-2 border-b border-yellow-100 last:border-0">
              <div>
                <span className="font-medium">{l.agentName}</span>
                <span className="text-sm text-gray-600 ml-2">{l.actionTaken}</span>
              </div>
              <button onClick={() => resolveMut.mutate(l.id)} className="text-xs bg-green-600 text-white px-3 py-1 rounded">Resolve</button>
            </div>
          ))}
        </div>
      )}

      {/* T1 Copilot Chat */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b px-4 py-3 font-semibold">T1 Accounting Copilot</div>
        <div className="h-64 overflow-y-auto p-4 space-y-3">
          {chatMessages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] rounded-lg px-4 py-2 text-sm ${
                msg.role === 'user' ? 'bg-amacc-600 text-white' : 'bg-gray-100 text-gray-800'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="border-t p-3 flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendChat()}
            placeholder="Ask the T1 Copilot..."
            className="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amacc-500" />
          <button onClick={sendChat} disabled={streaming}
            className="bg-amacc-600 text-white px-4 py-2 rounded text-sm hover:bg-amacc-700 disabled:opacity-50">
            {streaming ? '...' : 'Send'}
          </button>
        </div>
      </div>

      {/* Agent Activity Log */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold mb-3">Agent Activity Log</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500 border-b">
            <th className="pb-2">Agent</th><th className="pb-2">Action</th><th className="pb-2">Outcome</th><th className="pb-2">Human</th><th className="pb-2">Time</th>
          </tr></thead>
          <tbody>
            {(logs ?? []).length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-gray-400"><div className="text-2xl mb-1">🤖</div><span className="text-xs">No agent activity yet</span></td></tr>
            ) : (logs ?? []).map((l: any) => (
              <tr key={l.id} className="border-b border-gray-50">
                <td className="py-2">{l.agentName}</td><td>{l.actionTaken}</td><td className="max-w-xs truncate">{l.outcome}</td>
                <td>{l.humanRequired ? '⚠️' : '✓'}</td>
                <td className="text-xs text-gray-500">{new Date(l.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
