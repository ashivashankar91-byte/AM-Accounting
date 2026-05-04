import { useState, useEffect } from 'react';

export default function AMACCSync() {
  const [status, setStatus] = useState<Record<string, { up: boolean; label: string }>>({});
  const [checking, setChecking] = useState(true);

  const services = [
    { key: 'gl', port: 3010, label: 'GL Service', path: '/api/v1/gl/accounts' },
    { key: 'eom', port: 3011, label: 'EOM Service', path: '/api/v1/eom' },
    { key: 'payroll', port: 3012, label: 'Payroll Service', path: '/api/v1/payroll/batches' },
    { key: 'apar', port: 3013, label: 'AP/AR Service', path: '/api/v1/apar/ar' },
    { key: 'recon', port: 3014, label: 'Recon Service', path: '/api/v1/recon' },
    { key: 'fs', port: 3015, label: 'FS Service', path: '/api/v1/fs/status/test/2026-03/GM' },
    { key: 'coa', port: 3016, label: 'COA Service', path: '/api/v1/coa/standard' },
    { key: 'auth', port: 3001, label: 'Auth Service', path: '/api/v1/auth/health' },
    { key: 'tenant', port: 3002, label: 'Tenant Service', path: '/api/v1/tenants' },
    { key: 'cashflow', port: 3037, label: 'Cashflow Service', path: '/api/v1/cashflow/forecast' },
    { key: 'audit', port: 3031, label: 'Audit Service', path: '/api/v1/audit/log' },
    { key: 'approval', port: 3033, label: 'Approval Service', path: '/api/v1/approvals/pending/test' },
  ];

  useEffect(() => {
    const checkAll = async () => {
      setChecking(true);
      const results: Record<string, { up: boolean; label: string }> = {};
      const tenantId = localStorage.getItem('tenantId') || 'tenant-kunes';
      await Promise.all(services.map(async (svc) => {
        try {
          const res = await fetch(svc.path, { headers: { 'x-tenant-id': tenantId } });
          results[svc.key] = { up: res.ok || res.status < 500, label: svc.label };
        } catch {
          results[svc.key] = { up: false, label: svc.label };
        }
      }));
      setStatus(results);
      setChecking(false);
    };
    checkAll();
    const id = setInterval(checkAll, 30000);
    return () => clearInterval(id);
  }, []);

  const upCount = Object.values(status).filter(s => s.up).length;
  const total = Object.keys(status).length;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AMACC Sync</h1>
        <p className="text-sm text-gray-500 mt-0.5">Agentic DMS service connectivity and sync status. Checks every 30 seconds.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Services Online</div>
          <div className={`text-3xl font-bold mt-1 ${upCount === total ? 'text-green-600' : 'text-amber-600'}`}>{checking ? '...' : `${upCount}/${total}`}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Sync Status</div>
          <div className={`text-xl font-bold mt-1 ${upCount === total ? 'text-green-600' : 'text-red-600'}`}>
            {checking ? 'Checking...' : upCount === total ? 'All Connected' : `${total - upCount} Disconnected`}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Last Check</div>
          <div className="text-xl font-bold mt-1 text-gray-700">{checking ? '...' : new Date().toLocaleTimeString()}</div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b bg-gray-50">
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Service</th>
              <th className="px-4 py-3 font-medium">Health Endpoint</th>
            </tr>
          </thead>
          <tbody>
            {services.map(svc => {
              const s = status[svc.key];
              return (
                <tr key={svc.key} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {checking ? (
                      <span className="inline-block w-3 h-3 rounded-full bg-gray-300 animate-pulse" />
                    ) : s?.up ? (
                      <span className="inline-flex items-center gap-1.5 text-green-600 text-xs font-medium">
                        <span className="w-3 h-3 rounded-full bg-green-500" /> Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-red-600 text-xs font-medium">
                        <span className="w-3 h-3 rounded-full bg-red-500" /> Disconnected
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">{svc.label}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">localhost:{svc.port}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
