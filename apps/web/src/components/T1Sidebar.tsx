import { useState, useRef, useEffect } from 'react';

export default function T1Sidebar() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send() {
    if (!input.trim() || streaming) return;
    const msg = input;
    setInput('');
    setMessages((p) => [...p, { role: 'user', content: msg }]);
    setStreaming(true);

    try {
      const tenantId = localStorage.getItem('tenantId') ?? '';
      const res = await fetch('/api/v1/agents/t1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, tenantId }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMsg = '';
      setMessages((p) => [...p, { role: 'assistant', content: '' }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split('\n').filter((l) => l.startsWith('data: '))) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'text') {
                assistantMsg += data.content;
                setMessages((p) => {
                  const u = [...p];
                  u[u.length - 1] = { role: 'assistant', content: assistantMsg };
                  return u;
                });
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch {
      setMessages((p) => [...p, { role: 'assistant', content: 'Error connecting to T1.' }]);
    }
    setStreaming(false);
  }

  return (
    <>
      {/* Toggle button */}
      <button onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-50 bg-brand text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-xl hover:bg-brand">
        {open ? '\u2715' : '\uD83E\uDD16'}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-96 h-[500px] bg-white rounded-lg shadow-2xl flex flex-col border">
          <div className="bg-brand text-white px-4 py-3 rounded-t-lg text-sm font-semibold">
            T1 Accounting Copilot
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-sm text-gray-400 text-center mt-8">Ask me anything about your dealership accounting...</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
                m.role === 'user' ? 'bg-blue-100 text-blue-900 ml-auto' : 'bg-gray-100 text-gray-800'
              }`}>
                {m.content}
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="border-t p-2 flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              className="flex-1 border rounded px-3 py-2 text-sm"
              placeholder="Ask T1..." disabled={streaming} />
            <button onClick={send} disabled={streaming}
              className="bg-brand text-white px-3 py-2 rounded text-sm hover:bg-brand disabled:opacity-50">
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
