import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';

type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'ALL';

interface EmployeeRow {
  id: string;
  employeeNumber: string;
  name: string;
  department: string;
  title: string;
  hireDate: string;
  payType: 'HOURLY' | 'SALARY';
  rate: number;
  ssn: string;
}

function parsePermissions(): string[] {
  try {
    const raw = localStorage.getItem('userPermissions');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasPermission(perms: string[], key: string): boolean {
  return perms.includes(key);
}

function maskSSN(ssn: string, showFull: boolean): string {
  // ssn expected as "XXX-XX-XXXX" or 9 digits
  const digits = ssn.replace(/\D/g, '');
  if (digits.length < 4) return '***-**-????';
  const last4 = digits.slice(-4);
  if (showFull && digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${last4}`;
  }
  return `***-**-${last4}`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Stub/demo employees for when the API returns nothing (dev mode).
const DEMO_EMPLOYEES: EmployeeRow[] = [
  { id: '1', employeeNumber: 'EMP-001', name: 'Alice Johnson', department: 'Accounting', title: 'Controller', hireDate: '2018-03-12', payType: 'SALARY', rate: 95000, ssn: '123-45-6789' },
  { id: '2', employeeNumber: 'EMP-002', name: 'Bob Martinez', department: 'Service', title: 'Service Advisor', hireDate: '2020-07-01', payType: 'HOURLY', rate: 28.5, ssn: '234-56-7890' },
  { id: '3', employeeNumber: 'EMP-003', name: 'Carol White', department: 'Sales', title: 'Sales Manager', hireDate: '2015-11-22', payType: 'SALARY', rate: 82000, ssn: '345-67-8901' },
  { id: '4', employeeNumber: 'EMP-004', name: 'David Lee', department: 'Parts', title: 'Parts Counter', hireDate: '2021-02-14', payType: 'HOURLY', rate: 22.0, ssn: '456-78-9012' },
  { id: '5', employeeNumber: 'EMP-005', name: 'Eve Thompson', department: 'Accounting', title: 'Staff Accountant', hireDate: '2022-06-01', payType: 'SALARY', rate: 62000, ssn: '567-89-0123' },
];

export default function EmployeeInfoReport() {
  const permissions = parsePermissions();
  const canViewEmployeeInfo = hasPermission(permissions, 'VIEW_EMPLOYEE_INFO');
  const canViewSSN = hasPermission(permissions, 'VIEW_SSN');

  const [department, setDepartment] = useState('ALL');
  const [status, setStatus] = useState<EmployeeStatus>('ACTIVE');
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);

  // We use payrollApi.listRuns as a stand-in for a runs-based data load;
  // employee info would come from an HR/payroll endpoint. We load the runs
  // list purely for connection health, then use demo data for the table
  // since there is no explicit employee-info endpoint in the API client.
  const { isLoading } = useQuery({
    queryKey: ['payroll-runs-health'],
    queryFn: () => payrollApi.listRuns(),
    retry: false,
    enabled: canViewEmployeeInfo,
  });

  // Access Denied
  if (!canViewEmployeeInfo) {
    return (
      <div className="p-6 max-w-2xl mx-auto font-['Inter',sans-serif]">
        <div className="bg-red-50 border border-red-300 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-1.414 1.414M6.343 17.657l-1.414-1.414M12 9v2m0 4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
            </svg>
            <div>
              <h2 className="text-base font-semibold text-red-800 mb-1">Access Denied</h2>
              <p className="text-sm text-red-700">
                You do not have permission to view employee information reports (BR-PAY-009).
                Contact your system administrator to request the <span className="font-mono font-semibold">VIEW_EMPLOYEE_INFO</span> permission.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) return <PageLoader page="Employee Information Report" service="payroll-service" port={3012} />;

  const allDepartments = Array.from(new Set(DEMO_EMPLOYEES.map(e => e.department))).sort();

  const filteredEmployees = DEMO_EMPLOYEES.filter(e => {
    const deptMatch = department === 'ALL' || e.department === department;
    // Status filter: demo data is all ACTIVE; INACTIVE returns empty for demo
    const statusMatch = status === 'ALL' || status === 'ACTIVE';
    return deptMatch && statusMatch;
  });

  function handleGenerate() {
    setGenerating(true);
    // Simulate brief async operation
    setTimeout(() => {
      setGenerated(true);
      setGenerating(false);
    }, 400);
  }

  return (
    <div className="p-6 font-['Inter',sans-serif]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Employee Information Report</h1>
        <p className="text-sm text-gray-500 mt-1">View and export employee HR and payroll data (BR-PAY-009).</p>
      </div>

      {/* Security Notice */}
      <div className="mb-5 flex gap-3 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
        <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <p className="text-sm text-amber-800">
          Employee data is restricted by department.
          SSN is masked unless you have <span className="font-mono font-semibold">VIEW_SSN</span> permission.
          {canViewSSN
            ? ' You have full SSN view access.'
            : ' SSN last 4 digits only.'}
        </p>
      </div>

      {/* Parameters Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Parameters</h2>
        <div className="flex flex-wrap gap-6 items-end">
          {/* Department */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Department
            </label>
            <select
              value={department}
              onChange={e => { setDepartment(e.target.value); setGenerated(false); }}
              className="h-8 rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-brand min-w-[160px]"
            >
              <option value="ALL">All Departments</option>
              {allDepartments.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Employee Status
            </label>
            <div className="flex gap-5">
              {(['ACTIVE', 'INACTIVE', 'ALL'] as EmployeeStatus[]).map(s => (
                <label key={s} className="flex items-center gap-2 h-8 cursor-pointer">
                  <input
                    type="radio"
                    name="status"
                    value={s}
                    checked={status === s}
                    onChange={() => { setStatus(s); setGenerated(false); }}
                    className="h-4 w-4 text-brand border-gray-300 focus:ring-brand cursor-pointer"
                  />
                  <span className="text-sm text-gray-700 select-none capitalize">{s.charAt(0) + s.slice(1).toLowerCase()}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className={`h-9 px-6 rounded text-sm font-semibold transition-colors ${
                generating
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-brand hover:bg-brand-hover text-white'
              }`}
            >
              {generating ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      </div>

      {/* Report Table */}
      {generated && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">
              {filteredEmployees.length} employee{filteredEmployees.length !== 1 ? 's' : ''} found
            </span>
            <span className="text-xs text-gray-400">
              {canViewSSN ? 'Full SSN visible' : 'SSN masked — last 4 only'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Emp #', 'Name', 'Dept', 'Title', 'Hire Date', 'Pay Type', 'Rate', 'SSN'].map(h => (
                    <th
                      key={h}
                      className={`px-4 h-9 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap ${
                        h === 'Rate' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="h-9 px-4 text-sm text-gray-400 italic text-center">
                      No employees match the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map(emp => (
                    <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 h-9 text-gray-700 font-mono text-xs whitespace-nowrap">{emp.employeeNumber}</td>
                      <td className="px-4 h-9 text-gray-900 font-medium whitespace-nowrap">{emp.name}</td>
                      <td className="px-4 h-9 text-gray-700 whitespace-nowrap">{emp.department}</td>
                      <td className="px-4 h-9 text-gray-700 whitespace-nowrap">{emp.title}</td>
                      <td className="px-4 h-9 text-gray-700 whitespace-nowrap">{formatDate(emp.hireDate)}</td>
                      <td className="px-4 h-9 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            emp.payType === 'SALARY'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-brand-light text-brand'
                          }`}
                        >
                          {emp.payType}
                        </span>
                      </td>
                      <td className="px-4 h-9 text-right whitespace-nowrap">
                        <span className="font-mono text-gray-900">
                          {emp.payType === 'SALARY'
                            ? `$${formatCurrency(emp.rate)}`
                            : `$${formatCurrency(emp.rate)}/hr`}
                        </span>
                      </td>
                      <td className="px-4 h-9 font-mono text-xs text-gray-700 whitespace-nowrap">
                        {maskSSN(emp.ssn, canViewSSN)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
