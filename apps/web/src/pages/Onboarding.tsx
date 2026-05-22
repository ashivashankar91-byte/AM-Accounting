import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { onboardingApi } from '../api/client';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';

const STEPS = ['DMS_CONFIG', 'OEM_CONFIG', 'COA_SETUP', 'IMPORT_HISTORY', 'FS_VALIDATION'] as const;
const STEP_LABELS: Record<string, string> = {
  DMS_CONFIG: 'DMS Connection',
  OEM_CONFIG: 'OEM Configuration',
  COA_SETUP: 'Chart of Accounts',
  IMPORT_HISTORY: 'Import History',
  FS_VALIDATION: 'FS Validation',
};

export default function Onboarding() {
  const [session, setSession] = useState<any>(null);
  const [form, setForm] = useState({ dealerName: '', slug: '', oems: ['GM'] });
  const [stepData, setStepData] = useState<Record<string, string>>({});

  const startMut = useMutation({
    mutationFn: () => onboardingApi.start(form),
    onSuccess: (data) => setSession(data),
  });

  const stepMut = useMutation({
    mutationFn: () => onboardingApi.completeStep(session.id, session.currentStep, stepData),
    onSuccess: (data) => { setSession(data); setStepData({}); },
  });

  if (!session) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6"><div><h1 className="text-2xl font-bold">Tenant Onboarding</h1><p className="text-sm text-gray-500 mt-0.5">Step-by-step onboarding wizard for new tenants. Source: Onboarding Service.</p></div><HelpButton help={SCREEN_HELP['onboarding']} /></div>
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div>
            <label className="text-sm font-medium">Dealer Name</label>
            <input value={form.dealerName} onChange={(e) => setForm({ ...form, dealerName: e.target.value })}
              className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Kunes Auto Group" />
          </div>
          <div>
            <label className="text-sm font-medium">Slug</label>
            <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="kunes-auto" />
          </div>
          <div>
            <label className="text-sm font-medium">OEMs</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {['GM', 'FORD', 'FCA', 'TOYOTA', 'HONDA', 'NISSAN', 'BMW', 'MERCEDES', 'HYUNDAI', 'KIA'].map((o) => (
                <label key={o} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={form.oems.includes(o)}
                    onChange={(e) => setForm({ ...form, oems: e.target.checked ? [...form.oems, o] : form.oems.filter((x) => x !== o) })} />
                  {o}
                </label>
              ))}
            </div>
          </div>
          <button onClick={() => startMut.mutate()} disabled={!form.dealerName || !form.slug || startMut.isPending}
            className="w-full bg-brand text-white py-2 rounded hover:bg-brand disabled:opacity-50">
            {startMut.isPending ? 'Starting...' : 'Start Onboarding'}
          </button>
        </div>
      </div>
    );
  }

  const currentIdx = STEPS.indexOf(session.currentStep);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">Onboarding: {session.dealerName}</h2>
      <p className="text-sm text-gray-500 mb-6">
        {session.status === 'COMPLETED' ? 'Onboarding complete!' : `Step ${currentIdx + 1} of ${STEPS.length}`}
      </p>

      {/* Progress */}
      <div className="flex gap-1 mb-6">
        {STEPS.map((s, i) => (
          <div key={s} className={`flex-1 h-2 rounded ${
            session.completedSteps?.includes(s) ? 'bg-green-500' :
            s === session.currentStep ? 'bg-brand-light0' : 'bg-gray-200'
          }`} />
        ))}
      </div>

      {session.status === 'COMPLETED' ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <div className="text-4xl mb-2">&#10003;</div>
          <h3 className="text-lg font-semibold text-green-700">Onboarding Complete</h3>
          <p className="text-sm text-green-600 mt-1">Tenant {session.dealerName} is ready to use AMACC.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">{STEP_LABELS[session.currentStep]}</h3>

          {session.currentStep === 'DMS_CONFIG' && (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">DMS Type</label>
                <select value={stepData['dmsType'] ?? 'automate'} onChange={(e) => setStepData({ ...stepData, dmsType: e.target.value })}
                  className="w-full mt-1 border rounded px-3 py-2 text-sm">
                  <option value="automate">AutoMate</option>
                  <option value="cdk">CDK</option>
                  <option value="reynolds">Reynolds & Reynolds</option>
                  <option value="dealertrack">DealerTrack</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">API Endpoint</label>
                <input value={stepData['apiEndpoint'] ?? ''} onChange={(e) => setStepData({ ...stepData, apiEndpoint: e.target.value })}
                  className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="https://dms.example.com/api" />
              </div>
            </div>
          )}

          {session.currentStep === 'OEM_CONFIG' && (
            <p className="text-sm text-gray-600">Configuring OEM connections for: {session.oems?.join(', ')}</p>
          )}

          {session.currentStep === 'COA_SETUP' && (
            <p className="text-sm text-gray-600">Setting up standard Chart of Accounts with OEM mappings.</p>
          )}

          {session.currentStep === 'IMPORT_HISTORY' && (
            <p className="text-sm text-gray-600">Importing historical journal entries from DMS.</p>
          )}

          {session.currentStep === 'FS_VALIDATION' && (
            <p className="text-sm text-gray-600">Validating financial statement generation for all configured OEMs.</p>
          )}

          <button onClick={() => stepMut.mutate()} disabled={stepMut.isPending}
            className="mt-6 bg-brand text-white px-6 py-2 rounded hover:bg-brand disabled:opacity-50">
            {stepMut.isPending ? 'Processing...' : `Complete ${STEP_LABELS[session.currentStep]}`}
          </button>
        </div>
      )}
    </div>
  );
}
