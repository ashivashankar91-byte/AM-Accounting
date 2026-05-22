import { AlertCircle } from 'lucide-react';

interface Props {
  error: Error | string | null;
  serviceName?: string;
  port?: number;
  retry?: () => void;
}

export default function PageError({ error, serviceName, port, retry }: Props) {
  const message = typeof error === 'string' ? error : error?.message ?? 'An unknown error occurred';

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex flex-col items-center gap-4 max-w-sm w-full text-center">
        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center">
          <AlertCircle size={22} className="text-red-500" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900 mb-1">Failed to Load</h2>
          <p className="text-sm text-slate-500">{message}</p>
        </div>
        {serviceName && (
          <p className="text-xs text-slate-400">
            Service: <span className="font-mono font-semibold text-slate-600">{serviceName}</span>
            {port ? (
              <>
                {' · '}Port{' '}
                <span className="font-mono font-semibold text-slate-600">{port}</span>
              </>
            ) : null}
          </p>
        )}
        {retry && (
          <button
            onClick={retry}
            className="bg-brand text-white px-5 py-2 rounded-lg hover:bg-brand-hover transition-colors text-sm font-medium"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
