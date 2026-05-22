import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { tenantApi } from '../api/client';
import HelpButton from '../components/HelpButton';
import PageLoader from '../components/PageLoader';
import PageError from '../components/PageError';
import SCREEN_HELP from '../data/screenHelp';

export default function Tenants() {
  const queryClient = useQueryClient();
  const { data: tenants, isLoading, error, refetch } = useQuery({ queryKey: ['tenants'], queryFn: tenantApi.list, retry: false });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', dmsType: 'AUTOMATE', dmsApiKey: '', rooftopCount: 1, webhookUrl: '' });

  const createMut = useMutation({
    mutationFn: () => tenantApi.create({
      ...form,
      rooftopCount: Number(form.rooftopCount),
      webhookUrl: form.webhookUrl || undefined,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tenants'] }); setShowAdd(false); },
  });

  if (isLoading) return <PageLoader page="Tenants" service="tenant-service" port={3002} />;
  if (error) return <PageError error={error} serviceName="Tenant Service" port={3002} retry={refetch} />;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center justify-between"><div>
          <h1 className="text-2xl font-bold">Tenants</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage dealership tenants and provisioning. Source: Tenant Service.</p>
        </div><HelpButton help={SCREEN_HELP['tenants']} /></div>
        <button onClick={() => setShowAdd(!showAdd)} className="bg-amacc-600 text-white px-4 py-2 rounded text-sm">
          {showAdd ? 'Cancel' : 'Add Tenant'}
        </button>
      </div>

      {showAdd && (
        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <h3 className="font-semibold">Add New Tenant</h3>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Tenant Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="border rounded px-3 py-2 text-sm" />
            <select value={form.dmsType} onChange={(e) => setForm({ ...form, dmsType: e.target.value })}
              className="border rounded px-3 py-2 text-sm">
              <option value="AUTOMATE">AutoMate</option><option value="CDK">CDK</option>
              <option value="REYNOLDS">Reynolds</option><option value="DEALERTRACK">Dealertrack</option>
            </select>
            <input placeholder="DMS API Key" value={form.dmsApiKey} onChange={(e) => setForm({ ...form, dmsApiKey: e.target.value })}
              className="border rounded px-3 py-2 text-sm" />
            <input placeholder="Rooftop Count" type="number" value={form.rooftopCount} onChange={(e) => setForm({ ...form, rooftopCount: Number(e.target.value) })}
              className="border rounded px-3 py-2 text-sm" />
            <input placeholder="Webhook URL (optional)" value={form.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
              className="border rounded px-3 py-2 text-sm col-span-2" />
          </div>
          <button onClick={() => createMut.mutate()} className="bg-green-600 text-white px-4 py-2 rounded text-sm">Create Tenant</button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500 border-b">
            <th className="pb-2">Name</th><th className="pb-2">DMS</th><th className="pb-2">Rooftops</th>
            <th className="pb-2">Status</th><th className="pb-2">Schema</th><th className="pb-2">Created</th>
          </tr></thead>
          <tbody>
            {(tenants ?? []).map((t: any) => (
              <tr key={t.id} className="border-b border-gray-50 cursor-pointer hover:bg-gray-50"
                onClick={() => localStorage.setItem('tenantId', t.id)}>
                <td className="py-2 font-medium">{t.name}</td><td>{t.dmsType}</td><td>{t.rooftopCount}</td>
                <td><span className={`px-2 py-0.5 rounded text-xs font-medium ${t.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>{t.status}</span></td>
                <td className="font-mono text-xs">{t.schemaName}</td>
                <td>{new Date(t.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
