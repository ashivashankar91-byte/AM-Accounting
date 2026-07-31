import { useState, useMemo } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';
import { VehicleStatus, type VehicleInventory as VehicleRecord } from '../types/file-maintenance';


type Tab = 'list' | 'detail';
type StatusFilter = 'all' | VehicleStatus;

function ageColor(age: number): string {
  if (age <= 60) return 'text-green-600';
  if (age <= 90) return 'text-amber-600';
  if (age <= 120) return 'text-red-600';
  return 'text-red-800 font-bold';
}

function ageBg(age: number): string {
  if (age <= 60) return '';
  if (age <= 90) return 'bg-amber-50/50';
  if (age <= 120) return 'bg-red-50/50';
  return 'bg-red-100/50';
}

const STATUS_COLORS: Record<VehicleStatus, string> = {
  [VehicleStatus.AVAILABLE]: 'bg-green-100 text-green-700',
  [VehicleStatus.SOLD]: 'bg-gray-200 text-gray-700',
  [VehicleStatus.DEMO]: 'bg-brand-light text-brand',
  [VehicleStatus.LOANER]: 'bg-purple-100 text-purple-700',
  [VehicleStatus.WHOLESALE]: 'bg-amber-100 text-amber-700',
  [VehicleStatus.TRANSIT]: 'bg-cyan-100 text-cyan-700',
  [VehicleStatus.TRADE]: 'bg-orange-100 text-orange-700',
};

function isGenesis(v: VehicleRecord): boolean {
  return v.make === 'Genesis' || v.stockNumber.startsWith('G');
}

export default function VehicleInventory() {
  const [tab, setTab] = useState<Tab>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<VehicleRecord | null>(null);
  const [detailTab, setDetailTab] = useState<'pricing' | 'options' | 'gl'>('pricing');

  // No backend implements /api/v1/companies/:companyId/inventory yet (unlike Chart of
  // Accounts / Standard Journal Entries, this is a real gap, not a missed wiring) — the
  // DMS Connector Service that would populate per-VIN vehicle records doesn't exist in
  // this stack, so the honest "no data yet" state below is accurate, not a bug.
  const vehicles: VehicleRecord[] = [];

  if (vehicles.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vehicle Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track new and used vehicle inventory, aging, and GL account linkage. Source: DMS Connector Service.</p>
        </div>
        <div className="text-center py-16">
          <div className="text-gray-300 text-5xl mb-4">🚗</div>
          <p className="text-gray-500 font-medium text-lg">No vehicle inventory data yet</p>
          <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">Vehicle inventory will appear here once your DMS connector is configured and syncing vehicle data. Use the Onboarding wizard to connect your DMS.</p>
        </div>
      </div>
    );
  }

  const filtered = useMemo(() =>
    vehicles.filter(v =>
      (statusFilter === 'all' || v.status === statusFilter) &&
      (!search || v.stockNumber.toLowerCase().includes(search.toLowerCase()) ||
        v.vin.toLowerCase().includes(search.toLowerCase()) ||
        v.model.toLowerCase().includes(search.toLowerCase()) ||
        `${v.year}`.includes(search))
    ), [vehicles, statusFilter, search]);

  const stats = useMemo(() => {
    const active = vehicles.filter(v => v.status !== VehicleStatus.SOLD);
    const newUnits = active.filter(v => v.invGL === '2310' || v.invGL === 'G2310');
    const usedUnits = active.filter(v => v.invGL === '2400' || v.invGL === 'G2390');
    return {
      newCount: newUnits.length,
      usedCount: usedUnits.length,
      floorplanExposure: active.reduce((s, v) => s + v.totalCost, 0),
      aged90: active.filter(v => v.age > 90).length,
    };
  }, [vehicles]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: vehicles.length };
    vehicles.forEach(v => { c[v.status] = (c[v.status] || 0) + 1; });
    return c;
  }, [vehicles]);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Vehicle Inventory</h2>
          <p className="text-sm text-gray-500">Lee Hyundai Inc. — Company 03 • INVACC / SCHDUPKY</p>
        </div>
        <HelpButton help={SCREEN_HELP['vehicle-inventory']} />
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-4 gap-3">
        <KPI label="New Units" value={stats.newCount} />
        <KPI label="Used Units" value={stats.usedCount} />
        <KPI label="Floorplan Exposure" value={`$${(stats.floorplanExposure).toLocaleString()}`} />
        <KPI label="Aged > 90 Days" value={stats.aged90} color={stats.aged90 > 0 ? 'text-red-600' : undefined} />
      </div>

      {/* Status Filter Chips */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border ${statusFilter === 'all' ? 'bg-amacc-600 text-white border-amacc-600' : 'bg-white text-gray-600 border-gray-200'}`}>
          All ({statusCounts.all})
        </button>
        {Object.values(VehicleStatus).map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${statusFilter === s ? 'bg-amacc-600 text-white border-amacc-600' : 'bg-white text-gray-600 border-gray-200'}`}>
            {s} ({statusCounts[s] ?? 0})
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {([['list', 'Inventory List'], ['detail', 'Vehicle Detail']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* List Tab */}
      {tab === 'list' && (
        <>
          <input type="text" placeholder="Search by stock#, VIN, model, or year..." value={search} onChange={e => setSearch(e.target.value)}
            className="border rounded px-3 py-2 text-sm w-80" />
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b bg-gray-50">
                  <th className="px-4 py-2.5">Stock #</th><th className="py-2.5">Year/Make/Model</th><th className="py-2.5">Color</th>
                  <th className="py-2.5">Status</th><th className="py-2.5 text-center">Age</th><th className="py-2.5">Miles</th>
                  <th className="py-2.5 text-right">Total Cost</th><th className="py-2.5 text-right">Price</th>
                  <th className="py-2.5">GL</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.stockNumber}
                    onClick={() => { setSelected(v); setTab('detail'); }}
                    className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${ageBg(v.age)} ${isGenesis(v) ? 'border-l-2 border-l-purple-400' : ''}`}>
                    <td className="px-4 py-2 font-mono font-bold text-amacc-700">{v.stockNumber}</td>
                    <td className="py-2">
                      <span className="font-medium">{v.year} {v.make} {v.model}</span>
                      <span className="text-xs text-gray-500 ml-1">{v.trim}</span>
                    </td>
                    <td className="py-2 text-xs">{v.exteriorColor}</td>
                    <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[v.status]}`}>{v.status}</span></td>
                    <td className={`py-2 text-center font-mono font-bold ${ageColor(v.age)}`}>{v.age}d</td>
                    <td className="py-2 font-mono text-xs">{v.mileage.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono">${v.totalCost.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono font-bold">${v.totalPrice.toLocaleString()}</td>
                    <td className="py-2 font-mono text-xs text-gray-500">{v.invGL}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={9} className="py-8 text-center text-gray-400">No vehicles match filter</td></tr>}
              </tbody>
            </table>
            <p className="text-xs text-gray-400 p-3">Showing {filtered.length} of {vehicles.length} vehicles</p>
          </div>
        </>
      )}

      {/* Detail Tab */}
      {tab === 'detail' && (
        <div className="space-y-4">
          {!selected ? (
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-gray-400 text-sm">Select a vehicle from the list to view details.</p>
            </div>
          ) : (
            <>
              {/* Header Card */}
              <div className="bg-white rounded-lg shadow p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-xl font-bold">{selected.year} {selected.make} {selected.model} {selected.trim}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
                      {isGenesis(selected) && <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs font-bold">Genesis</span>}
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${ageColor(selected.age)}`}>{selected.age} days</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                      <span>Stock# <strong className="font-mono">{selected.stockNumber}</strong></span>
                      <span>VIN <strong className="font-mono">{selected.vin}</strong></span>
                      <span className="font-mono">{selected.exteriorColor} / {selected.interiorColor}</span>
                    </div>
                  </div>
                  <button onClick={() => { setSelected(null); setTab('list'); }} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
                </div>
              </div>

              {/* Sub-Tabs */}
              <div className="flex gap-2">
                {([['pricing', 'Pricing & Cost'], ['options', 'Options'], ['gl', 'GL Linkage']] as const).map(([t, label]) => (
                  <button key={t} onClick={() => setDetailTab(t as typeof detailTab)}
                    className={`px-3 py-1.5 rounded text-xs font-medium border ${detailTab === t ? 'bg-amacc-600 text-white border-amacc-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Pricing & Cost */}
              {detailTab === 'pricing' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white rounded-lg shadow p-4">
                    <h4 className="font-semibold text-sm mb-3">Cost Breakdown</h4>
                    <div className="space-y-2 text-sm">
                      <Row label="Original Cost" value={fmt(selected.originalCost)} />
                      <Row label="Cost Change / Adds" value={fmt(selected.costChange)} />
                      <Row label="Total Cost" value={fmt(selected.totalCost)} bold />
                      <div className="border-t my-2" />
                      <Row label="Holdback" value={fmt(selected.holdback)} />
                      <Row label="Advertising" value={fmt(selected.advertising)} />
                      <Row label="Sales Cost (Gross)" value={fmt(selected.salesCost)} bold />
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow p-4">
                    <h4 className="font-semibold text-sm mb-3">Pricing</h4>
                    <div className="space-y-2 text-sm">
                      <Row label="Original Price" value={fmt(selected.originalPrice)} />
                      <Row label="Price Change" value={fmt(selected.priceChange)} />
                      <Row label="Total Price" value={fmt(selected.totalPrice)} bold />
                      <div className="border-t my-2" />
                      <Row label="Invoice Amount" value={fmt(selected.invoiceAmount)} />
                      <Row label="Market Value" value={fmt(selected.marketValue)} />
                      <Row label="Advertised Price" value={fmt(selected.advertisedPrice)} />
                      <div className="border-t my-2" />
                      <Row label="Gross Margin" value={fmt(selected.totalPrice - selected.salesCost)}
                        bold color={selected.totalPrice - selected.salesCost > 0 ? 'text-green-600' : 'text-red-600'} />
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow p-4 col-span-2">
                    <h4 className="font-semibold text-sm mb-3">Vehicle Details</h4>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <DetailField label="Body Style" value={selected.bodyStyle} />
                      <DetailField label="Model Number" value={selected.modelNumber} />
                      <DetailField label="Color Code" value={selected.colorCode} />
                      <DetailField label="Lot" value={String(selected.lot)} />
                      <DetailField label="Mileage" value={selected.mileage.toLocaleString()} />
                      <DetailField label="Inventory Date" value={selected.inventoryDate} />
                      <DetailField label="Status Date" value={selected.statusDate} />
                      <DetailField label="In-Service Date" value={selected.inServiceDate ?? '—'} />
                    </div>
                  </div>
                </div>
              )}

              {/* Options */}
              {detailTab === 'options' && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h4 className="font-semibold text-sm mb-3">Vehicle Options ({selected.options.length})</h4>
                  {selected.options.length === 0 ? (
                    <p className="text-gray-400 text-sm py-4">No factory options recorded for this vehicle.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-gray-500 border-b bg-gray-50">
                        <th className="px-3 py-2">Code</th><th className="py-2">Description</th>
                        <th className="py-2 text-right">MSRP</th><th className="py-2 text-right">Invoice</th>
                      </tr></thead>
                      <tbody>
                        {selected.options.map((opt, i) => (
                          <tr key={i} className="border-b border-gray-50">
                            <td className="px-3 py-2 font-mono font-bold">{opt.code}</td>
                            <td className="py-2">{opt.description}</td>
                            <td className="py-2 text-right font-mono">{fmt(opt.msrp)}</td>
                            <td className="py-2 text-right font-mono">{fmt(opt.invoice)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 font-bold">
                          <td colSpan={2} className="px-3 py-2 text-right">Total:</td>
                          <td className="py-2 text-right font-mono">{fmt(selected.options.reduce((s, o) => s + o.msrp, 0))}</td>
                          <td className="py-2 text-right font-mono">{fmt(selected.options.reduce((s, o) => s + o.invoice, 0))}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              )}

              {/* GL Linkage */}
              {detailTab === 'gl' && (
                <div className="bg-white rounded-lg shadow p-4 space-y-4">
                  <h4 className="font-semibold text-sm mb-3">GL Account Linkage</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="border rounded-lg p-3">
                      <dt className="text-xs text-gray-500">Inventory GL</dt>
                      <dd className="font-mono font-bold text-lg text-amacc-700 mt-1">{selected.invGL}</dd>
                      <p className="text-xs text-gray-500 mt-1">
                        {selected.invGL === '2310' ? 'New Hyundai Inventory' :
                          selected.invGL === 'G2310' ? 'New Genesis Inventory' :
                          selected.invGL === '2400' ? 'Used Car Inventory' :
                          selected.invGL === '2410' ? 'Service Loaners' :
                          selected.invGL}
                      </p>
                    </div>
                    <div className="border rounded-lg p-3">
                      <dt className="text-xs text-gray-500">Schedule</dt>
                      <dd className="font-mono font-bold text-lg text-amacc-700 mt-1">
                        {selected.invGL === '2310' ? '#3 New Hyundai Inventory' :
                          selected.invGL === 'G2310' ? '#40 New Genesis Inventory' :
                          selected.invGL === '2400' ? '#4 Used Car Inventory' :
                          selected.invGL === '2410' ? '#13 Service Loaners' :
                          '—'}
                      </dd>
                    </div>
                  </div>
                  <div className="bg-brand-light border border-brand-border rounded-lg p-3 text-sm">
                    <p className="text-blue-800">
                      <strong>GL Derivation:</strong> The inventory GL account is derived from the vehicle's status and make.
                      Status transitions (e.g., Available → Sold) generate automatic GL reclassification entries via the deal posting process.
                    </p>
                  </div>
                </div>
              )}

              {/* Action Bar */}
              <div className="flex gap-3">
                <button className="bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm">Forms</button>
                <button className="bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm">Bookout</button>
                <button className="bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm">Transfer</button>
                <button className="bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm">Print Window Sticker</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function fmt(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function Row({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className={bold ? 'font-semibold' : ''}>{label}</span>
      <span className={`font-mono ${bold ? 'font-bold' : ''} ${color ?? ''}`}>{value}</span>
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

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-medium text-sm mt-0.5">{value}</dd>
    </div>
  );
}
