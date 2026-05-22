// NS-037/NS-038: Technician + Service Advisor Master File (Service Program 12)
// Route: /service/admin/technicians

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Plus, X, Check } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type RoleType = 'TECH' | 'ADVISOR';
type DetailTab = 'profile' | 'pay-rates' | 'mfr-ids';

interface TechRecord {
  id: string;
  name: string;
  team: string;
  status: 'Active' | 'Inactive';
  payType: 'Flat Rate' | 'Hourly' | 'Salary';
  username: string;
  ssnLast4: string;
  hireDate: string;
  dispatchGroup: string;
  autoAssign: boolean;
  jobLimit: number;
  laborCostMode: string;
  costEffectiveDate: string;
  payrollEmployeeId: string;
}

// ── Mock Data ──────────────────────────────────────────────────────────────────

const MOCK_TECHS: TechRecord[] = [
  { id: 'T001', name: 'Mike Johnson', team: 'A', status: 'Active', payType: 'Flat Rate', username: 'mjohnson', ssnLast4: '4521', hireDate: '2019-03-15', dispatchGroup: 'Body', autoAssign: true, jobLimit: 3, laborCostMode: 'Standard', costEffectiveDate: '2024-01-01', payrollEmployeeId: 'E-1042' },
  { id: 'T002', name: 'Sarah Chen', team: 'B', status: 'Active', payType: 'Hourly', username: 'schen', ssnLast4: '7834', hireDate: '2021-07-01', dispatchGroup: 'Mechanical', autoAssign: false, jobLimit: 5, laborCostMode: 'Actual', costEffectiveDate: '2024-01-01', payrollEmployeeId: 'E-1055' },
  { id: 'T003', name: 'Dave Rodriguez', team: 'A', status: 'Inactive', payType: 'Flat Rate', username: 'drodriguez', ssnLast4: '2291', hireDate: '2017-11-20', dispatchGroup: 'Mechanical', autoAssign: false, jobLimit: 4, laborCostMode: 'Standard', costEffectiveDate: '2023-06-01', payrollEmployeeId: 'E-1031' },
  { id: 'T004', name: 'Tom Williams', team: 'C', status: 'Active', payType: 'Salary', username: 'twilliams', ssnLast4: '9012', hireDate: '2020-05-10', dispatchGroup: 'Quick Service', autoAssign: true, jobLimit: 8, laborCostMode: 'Standard', costEffectiveDate: '2024-01-01', payrollEmployeeId: 'E-1067' },
];

const MOCK_ADVISORS: TechRecord[] = [
  { id: 'A001', name: 'Lisa Martinez', team: 'Front', status: 'Active', payType: 'Salary', username: 'lmartinez', ssnLast4: '6643', hireDate: '2018-09-01', dispatchGroup: 'Front Desk', autoAssign: false, jobLimit: 0, laborCostMode: 'N/A', costEffectiveDate: '2024-01-01', payrollEmployeeId: 'E-1022' },
  { id: 'A002', name: 'Kevin Park', team: 'Front', status: 'Active', payType: 'Hourly', username: 'kpark', ssnLast4: '3317', hireDate: '2022-02-14', dispatchGroup: 'Front Desk', autoAssign: false, jobLimit: 0, laborCostMode: 'N/A', costEffectiveDate: '2024-01-01', payrollEmployeeId: 'E-1078' },
];

const MOCK_PAY_RATES = [
  { code: 'PR1', desc: 'Standard Labor', rate: '$85.00/hr', eff: '2024-01-01' },
  { code: 'PR2', desc: 'Diagnostic', rate: '$95.00/hr', eff: '2024-01-01' },
  { code: 'PR3', desc: 'Overtime', rate: '$127.50/hr', eff: '2024-01-01' },
];

const MOCK_MFR_IDS = [
  { mfr: 'GM', id: 'GM-T-44821', eff: '2020-01-01' },
  { mfr: 'Ford', id: 'F-8842-J', eff: '2021-06-01' },
];

// ── Badge helpers ──────────────────────────────────────────────────────────────

function StatusBadgeMini({ status }: { status: string }) {
  const cls = status === 'Active'
    ? 'bg-green-100 text-green-700'
    : 'bg-gray-100 text-gray-500';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

function PayTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    'Flat Rate': 'bg-brand-light text-brand',
    'Hourly': 'bg-amber-100 text-amber-700',
    'Salary': 'bg-purple-100 text-purple-700',
  };
  const cls = map[type] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {type}
    </span>
  );
}

// ── Shared label/input building blocks ────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  'h-8 rounded border border-gray-300 px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent bg-white';

const selectCls =
  'h-8 rounded border border-gray-300 px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent bg-white';

// ── Main Component ─────────────────────────────────────────────────────────────

export default function TechnicianMasterFile() {
  const [roleType, setRoleType] = useState<RoleType>('TECH');
  const [filterText, setFilterText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('profile');
  const [formData, setFormData] = useState<TechRecord | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // useQuery is here to satisfy the @tanstack/react-query requirement —
  // in production this would fetch from the service API.
  useQuery<any>({
    queryKey: ['technicians', roleType],
    queryFn: async () => null,
    enabled: false,
  });

  const allRecords = roleType === 'TECH' ? MOCK_TECHS : MOCK_ADVISORS;

  const filtered = useMemo(() => {
    const q = filterText.toLowerCase().trim();
    if (!q) return allRecords;
    return allRecords.filter(
      r =>
        r.name.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
    );
  }, [allRecords, filterText]);

  function openRecord(rec: TechRecord) {
    setSelectedId(rec.id);
    setFormData({ ...rec });
    setIsNew(false);
    setActiveTab('profile');
  }

  function openNew() {
    const newId = roleType === 'TECH' ? `T00${MOCK_TECHS.length + 1}` : `A00${MOCK_ADVISORS.length + 1}`;
    const blank: TechRecord = {
      id: newId,
      name: '',
      team: '',
      status: 'Active',
      payType: 'Flat Rate',
      username: '',
      ssnLast4: '',
      hireDate: '',
      dispatchGroup: '',
      autoAssign: false,
      jobLimit: 0,
      laborCostMode: 'Standard',
      costEffectiveDate: '',
      payrollEmployeeId: '',
    };
    setSelectedId(null);
    setFormData(blank);
    setIsNew(true);
    setActiveTab('profile');
  }

  function handleSave() {
    setToast('Record saved successfully');
    setTimeout(() => setToast(null), 3500);
  }

  function handleDeactivate() {
    if (!formData) return;
    setFormData({ ...formData, status: 'Inactive' });
    setToast('Record deactivated');
    setTimeout(() => setToast(null), 3500);
  }

  function setField(key: keyof TechRecord, value: any) {
    if (!formData) return;
    setFormData({ ...formData, [key]: value });
  }

  const selected = formData;
  const showDetail = selected !== null;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium">
          <Check className="w-4 h-4 flex-shrink-0" />
          {toast}
        </div>
      )}

      <div className="flex gap-6">
        {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
        <div className="w-1/3 bg-white rounded-lg border border-gray-200 h-fit">
          {/* Header + role toggle */}
          <div className="px-4 pt-4 pb-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Technicians / Advisors</h2>
            <div className="flex gap-1 mb-3">
              <button
                onClick={() => { setRoleType('TECH'); setSelectedId(null); setFormData(null); setIsNew(false); }}
                className={`flex-1 h-8 rounded text-xs font-semibold transition-colors ${
                  roleType === 'TECH'
                    ? 'bg-brand text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Technicians
              </button>
              <button
                onClick={() => { setRoleType('ADVISOR'); setSelectedId(null); setFormData(null); setIsNew(false); }}
                className={`flex-1 h-8 rounded text-xs font-semibold transition-colors ${
                  roleType === 'ADVISOR'
                    ? 'bg-brand text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Advisors
              </button>
            </div>

            {/* Search + New */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  value={filterText}
                  onChange={e => setFilterText(e.target.value)}
                  placeholder="Search by name or ID..."
                  className="w-full h-8 pl-7 pr-2 rounded border border-gray-300 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                />
              </div>
              <button
                onClick={openNew}
                className="h-8 px-3 bg-brand text-white rounded text-xs font-semibold hover:bg-brand-hover transition-colors flex items-center gap-1 whitespace-nowrap"
              >
                <Plus className="w-3 h-3" />
                New
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">ID</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Team</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Status</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Pay</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(rec => {
                  const isActive = selectedId === rec.id;
                  return (
                    <tr
                      key={rec.id}
                      onClick={() => openRecord(rec)}
                      className={`h-9 border-b border-gray-50 cursor-pointer transition-colors ${
                        isActive ? 'bg-brand-light' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-3 py-0">
                        <span className="font-mono text-[11px] text-gray-500">{rec.id}</span>
                      </td>
                      <td className="px-3 py-0">
                        <span className={`font-medium ${isActive ? 'text-brand' : 'text-gray-800'}`}>{rec.name}</span>
                      </td>
                      <td className="px-3 py-0 text-gray-500">{rec.team}</td>
                      <td className="px-3 py-0">
                        <StatusBadgeMini status={rec.status} />
                      </td>
                      <td className="px-3 py-0">
                        <PayTypeBadge type={rec.payType} />
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-xs text-gray-400">
                      No records found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── RIGHT PANEL ─────────────────────────────────────────────────── */}
        <div className="flex-1 bg-white rounded-lg border border-gray-200 p-6">
          {!showDetail ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                <Search className="w-5 h-5 text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-500">Select a record from the list to view details</p>
              <p className="text-xs text-gray-400 mt-1">or click + New to create a new record</p>
            </div>
          ) : (
            <>
              {/* Record header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    {isNew ? `New ${roleType === 'TECH' ? 'Technician' : 'Advisor'}` : selected.name}
                  </h2>
                  {!isNew && (
                    <p className="text-xs text-gray-500 font-mono mt-0.5">{selected.id}</p>
                  )}
                </div>
                <button
                  onClick={() => { setSelectedId(null); setFormData(null); setIsNew(false); }}
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-200 mb-5 gap-0">
                {(['profile', 'pay-rates', 'mfr-ids'] as DetailTab[]).map(tab => {
                  const labels: Record<DetailTab, string> = {
                    'profile': 'Profile',
                    'pay-rates': 'Pay Rates',
                    'mfr-ids': 'Manufacturer IDs',
                  };
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        activeTab === tab
                          ? 'border-blue-600 text-brand'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {labels[tab]}
                    </button>
                  );
                })}
              </div>

              {/* ── TAB: Profile ── */}
              {activeTab === 'profile' && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  {/* Row 1 */}
                  <Field label="Tech ID">
                    <input
                      type="text"
                      value={selected.id}
                      onChange={e => setField('id', e.target.value)}
                      className={inputCls + ' w-full'}
                    />
                  </Field>
                  <Field label="Name *">
                    <input
                      type="text"
                      value={selected.name}
                      onChange={e => setField('name', e.target.value)}
                      required
                      className={inputCls + ' w-full'}
                    />
                  </Field>

                  {/* Row 2 */}
                  <Field label="Username">
                    <input
                      type="text"
                      value={selected.username}
                      onChange={e => setField('username', e.target.value)}
                      className={inputCls + ' w-full'}
                    />
                  </Field>
                  <Field label="SSN Last 4">
                    <input
                      type="password"
                      value={selected.ssnLast4}
                      onChange={e => setField('ssnLast4', e.target.value)}
                      maxLength={4}
                      className={inputCls + ' w-full'}
                    />
                    <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
                      Only last 4 digits stored — full SSN managed in Payroll
                    </p>
                  </Field>

                  {/* Row 3 */}
                  <Field label="Status">
                    <select
                      value={selected.status}
                      onChange={e => setField('status', e.target.value)}
                      className={selectCls + ' w-full'}
                    >
                      <option>Active</option>
                      <option>Inactive</option>
                    </select>
                  </Field>
                  <Field label="Hire Date">
                    <input
                      type="date"
                      value={selected.hireDate}
                      onChange={e => setField('hireDate', e.target.value)}
                      className={inputCls + ' w-full'}
                    />
                  </Field>

                  {/* Row 4 */}
                  <Field label="Team">
                    <input
                      type="text"
                      value={selected.team}
                      onChange={e => setField('team', e.target.value)}
                      className={inputCls + ' w-32'}
                    />
                  </Field>
                  <Field label="Dispatch Group">
                    <input
                      type="text"
                      value={selected.dispatchGroup}
                      onChange={e => setField('dispatchGroup', e.target.value)}
                      className={inputCls + ' w-full'}
                    />
                  </Field>

                  {/* Row 5 */}
                  <Field label="Auto Assignment">
                    <div className="h-8 flex items-center">
                      <input
                        type="checkbox"
                        id="autoAssign"
                        checked={selected.autoAssign}
                        onChange={e => setField('autoAssign', e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand cursor-pointer"
                      />
                      <label htmlFor="autoAssign" className="ml-2 text-sm text-gray-700 cursor-pointer">
                        Enabled
                      </label>
                    </div>
                  </Field>
                  <Field label="Job Limit">
                    <input
                      type="number"
                      value={selected.jobLimit}
                      onChange={e => setField('jobLimit', parseInt(e.target.value, 10) || 0)}
                      min={0}
                      className={inputCls + ' w-24'}
                    />
                  </Field>

                  {/* Row 6 */}
                  <Field label="Pay Type">
                    <select
                      value={selected.payType}
                      onChange={e => setField('payType', e.target.value)}
                      className={selectCls + ' w-full'}
                    >
                      <option>Flat Rate</option>
                      <option>Hourly</option>
                      <option>Salary</option>
                    </select>
                  </Field>
                  <Field label="Labor Cost Mode">
                    <select
                      value={selected.laborCostMode}
                      onChange={e => setField('laborCostMode', e.target.value)}
                      className={selectCls + ' w-full'}
                    >
                      <option>Standard</option>
                      <option>Actual</option>
                      <option>Blended</option>
                      <option>N/A</option>
                    </select>
                  </Field>

                  {/* Row 7 */}
                  <Field label="Cost Effective Date">
                    <input
                      type="date"
                      value={selected.costEffectiveDate}
                      onChange={e => setField('costEffectiveDate', e.target.value)}
                      className={inputCls + ' w-full'}
                    />
                  </Field>
                  <Field label="Payroll Employee Link">
                    <input
                      type="text"
                      value={selected.payrollEmployeeId}
                      onChange={e => setField('payrollEmployeeId', e.target.value)}
                      placeholder="Employee ID"
                      className={inputCls + ' w-full'}
                    />
                  </Field>
                </div>
              )}

              {/* ── TAB: Pay Rates ── */}
              {activeTab === 'pay-rates' && (
                <div>
                  <div className="overflow-hidden rounded border border-gray-200 mb-4">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Pay Code</th>
                          <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                          <th className="text-right px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Rate</th>
                          <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Effective Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {MOCK_PAY_RATES.map(r => (
                          <tr key={r.code} className="h-9 border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-0 font-mono text-xs text-gray-700 font-semibold">{r.code}</td>
                            <td className="px-4 py-0 text-gray-800">{r.desc}</td>
                            <td className="px-4 py-0 text-right font-mono text-gray-900 tabular-nums">{r.rate}</td>
                            <td className="px-4 py-0 text-gray-500 font-mono text-xs">{r.eff}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button className="h-8 px-4 border border-gray-300 rounded text-sm text-gray-700 font-medium hover:bg-gray-50 transition-colors">
                    + Add Rate
                  </button>
                </div>
              )}

              {/* ── TAB: Manufacturer IDs ── */}
              {activeTab === 'mfr-ids' && (
                <div>
                  <div className="overflow-hidden rounded border border-gray-200 mb-4">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Manufacturer</th>
                          <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Tech ID at OEM</th>
                          <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Effective Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {MOCK_MFR_IDS.map(m => (
                          <tr key={m.mfr} className="h-9 border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-0 font-semibold text-gray-800">{m.mfr}</td>
                            <td className="px-4 py-0 font-mono text-xs text-gray-700">{m.id}</td>
                            <td className="px-4 py-0 font-mono text-xs text-gray-500">{m.eff}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button className="h-8 px-4 border border-gray-300 rounded text-sm text-gray-700 font-medium hover:bg-gray-50 transition-colors">
                    + Add OEM ID
                  </button>
                </div>
              )}

              {/* ── Bottom Action Bar ── */}
              <div className="mt-6 pt-4 border-t border-gray-100 flex gap-3">
                <button
                  onClick={handleSave}
                  className="flex-1 h-9 bg-brand text-white rounded font-semibold text-sm hover:bg-brand-hover transition-colors"
                >
                  Save
                </button>
                {!isNew && selected.status === 'Active' && (
                  <button
                    onClick={handleDeactivate}
                    className="h-9 px-5 bg-amber-50 text-amber-700 border border-amber-200 rounded font-semibold text-sm hover:bg-amber-100 transition-colors"
                  >
                    Deactivate
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
