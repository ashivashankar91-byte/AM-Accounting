import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen } from 'lucide-react';

export default function InquiryMenu() {
  const navigate = useNavigate();
  const [option, setOption] = useState('');
  const [visible, setVisible] = useState(true);

  const go = (path: string) => navigate(path);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!visible) return;
      if (e.key === 'g' || e.key === 'G') go('/accounting/inquiry/gl');
      else if (e.key === 's' || e.key === 'S') go('/accounting/inquiry/schedules');
      else if (e.key === 't' || e.key === 'T') go('/accounting/inquiry/transactions');
      else if (e.key === 'Escape') setVisible(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible]);

  const handleOptionChange = (val: string) => {
    const upper = val.toUpperCase();
    setOption(upper);
    if (upper === 'G') go('/accounting/inquiry/gl');
    else if (upper === 'S') go('/accounting/inquiry/schedules');
    else if (upper === 'T') go('/accounting/inquiry/transactions');
  };

  return (
    <div className="min-h-screen bg-gray-100 font-[Inter,sans-serif]">
      {/* Background page */}
      <div className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen size={18} className="text-brand" />
          <h1 className="text-base font-semibold text-gray-700">Accounting Inquiry</h1>
        </div>
        <p className="text-xs text-gray-500">Program 31</p>
      </div>

      {/* Modal overlay */}
      {visible && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/20">
          <div className="bg-white rounded shadow-xl w-full max-w-sm p-5">
            <h2 className="text-base font-bold text-gray-900 mb-0.5">Accounting Inquiry</h2>
            <p className="text-xs text-gray-500 mb-4">Program 31 — Select inquiry type</p>

            <div className="flex flex-col gap-1.5 mb-4">
              <button
                className="h-10 px-3 text-sm text-left border border-gray-200 rounded hover:bg-brand-light hover:border-blue-300 flex items-center gap-2 font-medium"
                onClick={() => go('/accounting/inquiry/gl')}
              >
                <span className="inline-flex items-center justify-center w-5 h-5 bg-brand text-white text-xs rounded font-bold">G</span>
                General Ledger
              </button>
              <button
                className="h-10 px-3 text-sm text-left border border-gray-200 rounded hover:bg-brand-light hover:border-blue-300 flex items-center gap-2 font-medium"
                onClick={() => go('/accounting/inquiry/schedules')}
              >
                <span className="inline-flex items-center justify-center w-5 h-5 bg-brand text-white text-xs rounded font-bold">S</span>
                Schedules
              </button>
              <button
                className="h-10 px-3 text-sm text-left border border-gray-200 rounded hover:bg-brand-light hover:border-blue-300 flex items-center gap-2 font-medium"
                onClick={() => go('/accounting/inquiry/transactions')}
              >
                <span className="inline-flex items-center justify-center w-5 h-5 bg-brand text-white text-xs rounded font-bold">T</span>
                Find Transactions
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Enter Option (G/S/T):
              </label>
              <input
                className="h-8 w-full border border-gray-300 rounded px-2 text-sm font-mono uppercase focus:outline-none focus:ring-1 focus:ring-brand"
                maxLength={1}
                value={option}
                onChange={(e) => handleOptionChange(e.target.value)}
                autoFocus
                placeholder="G, S, or T"
              />
            </div>

            <div className="flex gap-2">
              <button
                className="h-8 flex-1 bg-brand text-white text-sm rounded hover:bg-brand-hover font-medium"
                onClick={() => {
                  if (option === 'G') go('/accounting/inquiry/gl');
                  else if (option === 'S') go('/accounting/inquiry/schedules');
                  else if (option === 'T') go('/accounting/inquiry/transactions');
                }}
              >
                OK
              </button>
              <button
                className="h-8 px-4 border border-gray-300 text-sm rounded hover:bg-gray-100"
                onClick={() => setVisible(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
