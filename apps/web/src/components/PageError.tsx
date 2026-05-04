interface Props {
  error: Error | string | null;
  serviceName?: string;
  port?: number;
  retry?: () => void;
}

export default function PageError({ error, serviceName, port, retry }: Props) {
  const message = typeof error === 'string' ? error : error?.message ?? 'An unknown error occurred';

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">🔴</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Failed to Load</h2>
        <p className="text-gray-600 text-sm mb-3">{message}</p>
        {serviceName && (
          <p className="text-gray-400 text-xs mb-4">
            Service: <span className="font-mono font-semibold">{serviceName}</span>
            {port ? <> · Port <span className="font-mono font-semibold">{port}</span></> : null}
          </p>
        )}
        {retry && (
          <button
            onClick={retry}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
