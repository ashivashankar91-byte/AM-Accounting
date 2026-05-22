import { useState, useEffect } from 'react';

interface Props {
  page: string;
  service?: string;
  port?: number;
}

export default function PageLoader({ page, service, port }: Props) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex flex-col items-center gap-4 max-w-xs w-full">
        <div
          className="w-10 h-10 rounded-full border-4 border-slate-100 border-t-brand animate-spin"
          style={{ animationDuration: '0.7s' }}
        />
        <p className="text-sm font-semibold text-slate-700 text-center">Loading {page}…</p>
        {slow && service && (
          <p className="text-amber-600 text-xs text-center mt-1 max-w-[220px]">
            Taking longer than expected. Check that{' '}
            <span className="font-mono font-semibold">{service}</span>
            {port ? (
              <>
                {' '}is running on port{' '}
                <span className="font-mono font-semibold">{port}</span>
              </>
            ) : null}
            .
          </p>
        )}
      </div>
    </div>
  );
}
