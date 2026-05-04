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
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="inline-block w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
        <p className="text-gray-600 font-medium">Loading {page}…</p>
        {slow && service && (
          <p className="text-amber-600 text-sm mt-3 max-w-xs mx-auto">
            Taking longer than expected. Check that <span className="font-mono font-semibold">{service}</span>
            {port ? <> is running on port <span className="font-mono font-semibold">{port}</span></> : null}.
          </p>
        )}
      </div>
    </div>
  );
}
