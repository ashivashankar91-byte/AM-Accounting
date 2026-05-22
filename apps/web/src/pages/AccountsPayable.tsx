import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import HelpButton from '../components/HelpButton';
import PageLoader from '../components/PageLoader';
import PageError from '../components/PageError';
import SCREEN_HELP from '../data/screenHelp';
import { aparApi } from '../api/client';
import SalesTaxAccrual from '../components/SalesTaxAccrual';
import ContractorReports1099 from '../components/ContractorReports1099';

type Tab = 'vouchers' | 'payments' | 'aging' | 'vendors' | 'tax' | '1099';

const STATUS_COLORS: Record<string, string> = {
  UNPOSTED: 'bg-gray-100 text-gray-700',
  POSTED: 'bg-brand-light text-brand',
  PENDING_PAYMENT: 'bg-amber-100 text-amber-700',
  PAID: 'bg-green-100 text-green-700',
  VOIDED: 'bg-red-100 text-red-700',
  PARTIAL_PAY: 'bg-purple-100 text-purple-700',
};

export default function AccountsPayable() {
  const [tab, setTab] = useState<Tab>('vouchers');
  const { data: apEntries, isLoading, error, refetch } = useQuery({ queryKey: ['ap-entries'], queryFn: aparApi.getAP, retry: false });
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showNewVoucher, setShowNewVoucher] = useState(false);

  const vouchers = (apEntries ?? []);
  const filtered = vouchers.filter((v: any) => {
    if (statusFilter && v.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (v.vendorName ?? '').toLowerCase().includes(q) ||
        (v.invoiceNumber ?? '').toLowerCase().includes(q) ||
        (v.description ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const unpaid = vouchers.filter((v: any) => !['PAID', 'VOIDED'].includes(v.status));
  const totalOutstanding = unpaid.reduce((s: number, v: any) => s + (v.amount?.amount ?? v.amount ?? 0), 0);

  if (isLoading) return <PageLoader page="Accounts Payable" service="apar-service" port={3013} />;
  if (error) return <PageError error={error} serviceName="AP/AR Service" port={3013} retry={refetch} />;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Accounts Payable</h1><p className="text-sm text-gray-500 mt-0.5">Manage vendor invoices, vouchers, and payment processing. Source: AP/AR Service.</p></div>
        <div className="flex gap-2">
          <button onClick={() => setShowNewVoucher(!showNewVoucher)}
            className="bg-amacc-600 text-white px-4 py-2 rounded text-sm hover:bg-amacc-700">
            {showNewVoucher ? 'Cancel' : 'New Voucher'}
          </button>
          <HelpButton help={SCREEN_HELP['accounts-payable']} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <KPI label="Total Vouchers" value={vouchers.length} />
        <KPI label="Outstanding" value={unpaid.length} color={unpaid.length > 0 ? 'text-amber-600' : undefined} />
        <KPI label="Total Due" value={`$${(totalOutstanding / 100).toLocaleString()}`} />
        <KPI label="Paid This Month" value={vouchers.filter((v: any) => v.status === 'PAID').length} />
      </div>

      {showNewVoucher && (
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-amacc-500">
          <h3 className="font-semibold mb-4">New Voucher Entry</h3>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Vendor</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Search vendor..." />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Invoice #</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="INV-001" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Invoice Date</label>
              <input type="date" className="w-full mt-1 border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Due Date</label>
              <input type="date" className="w-full mt-1 border rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Amount</label>
              <input type="number" step="0.01" className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="0.00" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">GL Account</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="5xxx" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Department</label>
              <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                <option value="">Select dept</option>
                <option value="new">New</option><option value="used">Used</option>
                <option value="service">Service</option><option value="parts">Parts</option>
                <option value="body">Body Shop</option><option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" /> 1099</label>
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" /> Discount</label>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="bg-green-600 text-white px-4 py-2 rounded text-sm">Save Voucher</button>
            <button className="bg-brand text-white px-4 py-2 rounded text-sm">Save & Post</button>
          </div>
        </div>
      )}

      <div className="flex gap-2 border-b overflow-x-auto">
        {([['vouchers', 'Vouchers'], ['payments', 'Payment Processing'], ['aging', 'AP Aging'], ['vendors', 'Vendor Master'], ['tax', 'Sales Tax'], ['1099', '1099 Reports']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'vouchers' && (
        <>
          <div className="flex gap-3">
            <input type="text" placeholder="Search vendor, invoice..." value={search} onChange={e => setSearch(e.target.value)}
              className="border rounded px-3 py-2 text-sm w-64" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border rounded px-3 py-2 text-sm">
              <option value="">All Status</option>
              <option value="UNPOSTED">Unposted</option><option value="POSTED">Posted</option>
              <option value="PENDING_PAYMENT">Pending Payment</option><option value="PAID">Paid</option><option value="VOIDED">Voided</option>
            </select>
          </div>
            <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Vendor</th><th className="pb-2">Invoice #</th><th className="pb-2">Date</th>
                <th className="pb-2">Due</th><th className="pb-2 text-right">Amount</th><th className="pb-2">Status</th><th className="pb-2">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map((v: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2">{v.vendorName ?? 'Vendor'}</td>
                    <td className="py-2 font-mono text-xs">{v.invoiceNumber ?? '-'}</td>
                    <td className="py-2">{v.invoiceDate ? new Date(v.invoiceDate).toLocaleDateString() : '-'}</td>
                    <td className="py-2">{v.dueDate ? new Date(v.dueDate).toLocaleDateString() : '-'}</td>
                    <td className="py-2 text-right font-mono">${((v.amount?.amount ?? v.amount ?? 0) / 100).toFixed(2)}</td>
                    <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[v.status] ?? 'bg-gray-100'}`}>{v.status ?? 'UNKNOWN'}</span></td>
                    <td className="py-2 flex gap-2">
                      {v.status === 'POSTED' && <button className="text-xs text-green-600 hover:underline">Pay</button>}
                      {v.status === 'UNPOSTED' && <button className="text-xs text-brand hover:underline">Post</button>}
                      <button className="text-xs text-gray-500 hover:underline">View</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-gray-400">No vouchers found</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'payments' && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-3">Payment Processing</h3>
          <div className="flex gap-4 items-end mb-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Payment Method</label>
              <select className="block mt-1 border rounded px-3 py-2 text-sm">
                <option value="check">Check</option><option value="eft">EFT</option><option value="card">Credit Card</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Payment Date</label>
              <input type="date" className="block mt-1 border rounded px-3 py-2 text-sm" />
            </div>
            <button className="bg-amacc-600 text-white px-4 py-2 rounded text-sm">Select Vouchers for Payment</button>
            <button className="bg-green-600 text-white px-4 py-2 rounded text-sm">Process Payment Batch</button>
          </div>
          <p className="text-gray-400 text-sm">Select posted vouchers and process payment by check, EFT, or credit card.</p>
        </div>
      )}

      {tab === 'aging' && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-3">AP Aging Summary</h3>
          <div className="flex gap-3 mb-4">
            <button className="text-xs bg-brand text-white px-3 py-1.5 rounded">Run Aging Report</button>
            <button className="text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded">Export to Excel</button>
            <button className="text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded">Cash Requirements</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Vendor</th><th className="pb-2 text-right">Current</th>
              <th className="pb-2 text-right">1-30</th><th className="pb-2 text-right">31-60</th>
              <th className="pb-2 text-right">61-90</th><th className="pb-2 text-right">Over 90</th><th className="pb-2 text-right">Total</th>
            </tr></thead>
            <tbody>
              <tr><td colSpan={7} className="py-6 text-center text-gray-400 text-sm">Run the aging report to view vendor payable aging</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === 'vendors' && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-3">Vendor Master</h3>
          <div className="flex gap-3 mb-4">
            <input type="text" placeholder="Search vendors..." className="border rounded px-3 py-2 text-sm w-64" />
            <button className="text-xs bg-amacc-600 text-white px-3 py-1.5 rounded">Add Vendor</button>
            <button className="text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded">Export 1099</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">ID</th><th className="pb-2">Vendor Name</th><th className="pb-2">Contact</th>
              <th className="pb-2">Terms</th><th className="pb-2">1099</th><th className="pb-2">Status</th>
              <th className="pb-2 text-right">YTD Paid</th>
            </tr></thead>
            <tbody>
              <tr><td colSpan={7} className="py-6 text-center text-gray-400 text-sm">Vendor list loads from the vendor master API</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === 'tax' && (
        <div className="bg-white rounded-lg shadow p-6">
          <SalesTaxAccrual />
        </div>
      )}

      {tab === '1099' && (
        <div className="bg-white rounded-lg shadow p-6">
          <ContractorReports1099 />
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ?? 'text-amacc-700'}`}>{value}</div>
    </div>
  );
}
