import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { closeApi } from '../../../api/client';
import { PageHeader, Btn } from '../../../components/ui';

export default function TaxPack() {
  const [legalEntityId, setLegalEntityId] = useState('default');
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear() - 1);

  const generateMutation = useMutation({
    mutationFn: () => closeApi.generateTaxPack({ legalEntityId, fiscalYear }),
  });

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Year-End Tax Pack (S117)" subtitle="Generate the year-end tax package for the entity." />
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm max-w-md">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Legal Entity ID</label>
            <input className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm" value={legalEntityId} onChange={e => setLegalEntityId(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Fiscal Year</label>
            <input type="number" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm" value={fiscalYear} onChange={e => setFiscalYear(parseInt(e.target.value))} />
          </div>
          <Btn variant="primary" size="md" onClick={() => generateMutation.mutate()} loading={generateMutation.isPending}>Generate Tax Pack</Btn>
          {generateMutation.isSuccess && <p className="text-sm text-green-700">Tax pack generated: {(generateMutation.data as any)?.id}</p>}
          {generateMutation.isError && <p className="text-sm text-red-700">{(generateMutation.error as Error).message}</p>}
        </div>
      </div>
    </div>
  );
}
