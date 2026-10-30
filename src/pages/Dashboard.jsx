import { useMemo, useState, useRef, useEffect } from 'react'
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Brush } from 'recharts'
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  Clock,
  Factory,
  Sparkles,
  Eye,
  EyeOff,
  Download,
  ChevronDown,
  Filter,
  FileSpreadsheet,
  Layers,
  Loader2,
} from 'lucide-react'
import { useData } from '../lib/DataContext'
import FilterBar from '../components/FilterBar'
import Modal from '../components/Modal'
import OrderLinesTable from '../components/OrderLinesTable'
import { applyFilters, aggregateCategory } from '../lib/aggregate'
import { buildBuckets, bucketOf, PAST_DUE, todayISO } from '../lib/periods'
import { fmtNum, fmtCompact, utilLevel, LEVEL_STYLES, pct } from '../lib/format'
import { exportOrdersToExcel } from '../lib/exportOrders'
import { loadRawOpenOrders } from '../lib/api'

const RANGES = {
  week: [[12, '12 weeks'], [26, '26 weeks'], [52, '52 weeks'], [0, 'All (to Dec ' + (new Date().getFullYear() + 2) + ')']],
  month: [[6, '6 months'], [12, '12 months'], [24, '24 months'], [0, 'All (to Dec ' + (new Date().getFullYear() + 2) + ')']],
}

export default function Dashboard({ filters, setFilters }) {
  const {
    master,
    lookups,
    orders,
    rawOrders,
    simulatedOrders,
    upload,
    activeScenario,
    simulationActive,
    setSimulationActive,
    scenarioItems,
  } = useData()

  const [mode, setMode] = useState('week')
  const [range, setRange] = useState({ week: 26, month: 12 })
  const [selectedCat, setSelectedCat] = useState(null)
  const [drill, setDrill] = useState(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportMenuRef = useRef(null)
  const today = todayISO()

  // Close export dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setExportMenuOpen(false)
      }
    }
    if (exportMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [exportMenuOpen])

  // Use simulated orders if simulation is toggled ON, otherwise actual orders
  const effectiveOrders = simulationActive ? simulatedOrders : orders

  const buckets = useMemo(() => {
    const all = buildBuckets(mode, today)
    const n = range[mode]
    return n ? all.slice(0, n + 1) : all
  }, [mode, range, today])

  const filtered = useMemo(() => applyFilters(effectiveOrders, filters, { skipCategory: true }), [effectiveOrders, filters])

  const categories = useMemo(() =>
    master.categories.filter((c) => !filters.category || String(c.id) === filters.category), [master, filters.category])

  // Aggregate every visible category
  const aggs = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, aggregateCategory({
    category: c, orders: filtered, capacities: master.capacities, vendorByCode: lookups.vendorByCode,
    buckets, mode, supplierFilter: filters.supplier, today,
  })])), [categories, filtered, master, lookups, buckets, mode, filters.supplier, today])

  // Next-4-weeks snapshot per category (independent of view mode)
  const next4 = useMemo(() => {
    const wk = buildBuckets('week', today).slice(1, 5)
    return Object.fromEntries(categories.map((c) => {
      const a = aggregateCategory({ category: c, orders: filtered, capacities: master.capacities, vendorByCode: lookups.vendorByCode, buckets: wk, mode: 'week', supplierFilter: filters.supplier, today })
      const load = wk.reduce((s, b) => s + (a.totals[b.key] ?? 0), 0)
      return [c.id, { load, cap: a.weeklyCapTotal * 4 }]
    }))
  }, [categories, filtered, master, lookups, filters.supplier, today])

  const activeCat = categories.find((c) => c.id === selectedCat)
    ?? categories.find((c) => aggs[c.id]?.totalOpen > 0) ?? categories[0]
  const agg = activeCat ? aggs[activeCat.id] : null

  const scoped = filtered.filter((o) => !filters.category || String(o.category_id) === filters.category)
  const kpis = {
    lines: scoped.length,
    pos: new Set(scoped.map((o) => o.po)).size,
    pastDue: scoped.filter((o) => o.ship_date && o.ship_date < today).length,
    suppliers: new Set(scoped.map((o) => o.vendor_code)).size,
    over: Object.values(aggs).reduce((s, a) => s + a.overCells, 0),
  }

  // Active filters description list
  const activeFiltersList = useMemo(() => {
    const list = []
    if (filters.division) {
      const name = lookups?.divisionByCode?.[filters.division] || `Div ${filters.division}`
      list.push(`Plant: ${name}`)
    }
    if (filters.supplier) {
      const name = lookups?.vendorByCode?.[filters.supplier]?.vendor_name || filters.supplier
      list.push(`Supplier: ${name}`)
    }
    if (filters.category) {
      const cat = master?.categories?.find((c) => String(c.id) === String(filters.category))
      list.push(`Category: ${cat?.name || filters.category}`)
    }
    if (filters.buyer) {
      list.push(`Buyer: ${filters.buyer}`)
    }
    return list
  }, [filters, lookups, master])

  const hasActiveFilters = activeFiltersList.length > 0
  const activeFilterSummary = activeFiltersList.join(', ')

  // Export handlers
  const handleExport = async (type) => {
    setExporting(true)
    try {
      if (type === 'filtered') {
        const fileTag = hasActiveFilters
          ? `_filtered_${activeFiltersList.join('_').slice(0, 35)}`
          : '_filtered'
        exportOrdersToExcel({
          orders: scoped,
          fileName: `open_orders${fileTag}_${today}`,
          sheetName: hasActiveFilters ? 'Filtered Orders' : 'Open Orders',
          lookups,
          isSimulated: simulationActive,
        })
      } else if (type === 'monitored') {
        exportOrdersToExcel({
          orders: effectiveOrders,
          fileName: `monitored_open_orders_${today}`,
          sheetName: 'Monitored Orders',
          lookups,
          isSimulated: simulationActive,
        })
      } else if (type === 'raw') {
        let allRows = rawOrders
        if (!allRows || !allRows.length) {
          allRows = await loadRawOpenOrders()
        }
        exportOrdersToExcel({
          orders: allRows,
          fileName: `all_open_orders_${today}`,
          sheetName: 'All Open Orders',
          lookups,
          isSimulated: false,
        })
      } else if (type === 'activeCat' && activeCat) {
        const catOrders = effectiveOrders.filter((o) => o.category_id === activeCat.id)
        exportOrdersToExcel({
          orders: catOrders,
          fileName: `open_orders_${activeCat.name.slice(0, 20)}_${today}`,
          sheetName: activeCat.name.slice(0, 31),
          lookups,
          isSimulated: simulationActive,
        })
      }
    } catch (err) {
      alert('Error exporting orders: ' + err.message)
    } finally {
      setExporting(false)
      setExportMenuOpen(false)
    }
  }

  if (!upload) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Dashboard</h1>
        <div className="card p-8 text-center text-slate-600">
          No open order file has been uploaded yet. Go to <a className="text-indigo-600 font-medium" href="#/upload">Upload Open Order</a> to get started.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      {/* Simulation Banner & Toggle */}
      {activeScenario && (
        <div className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-4 transition-all ${
          simulationActive
            ? 'bg-amber-50 border-amber-300 text-amber-900 shadow-sm'
            : 'bg-slate-100 border-slate-200 text-slate-700'
        }`}>
          <div className="flex items-center gap-3">
            <span className={`p-2 rounded-lg ${simulationActive ? 'bg-amber-200 text-amber-900' : 'bg-slate-200 text-slate-600'}`}>
              <Sparkles size={20} />
            </span>
            <div>
              <div className="font-semibold flex items-center gap-2">
                Simulation Scenario: <span className="underline">{activeScenario.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-white font-mono border border-current">
                  {scenarioItems.length} lines reallocated
                </span>
              </div>
              <div className="text-xs opacity-80">
                {simulationActive
                  ? 'Showing simulated capacity load with re-sourced orders.'
                  : 'Showing actual load (Simulation is turned OFF).'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href="#/simulator" className="text-xs font-semibold text-indigo-700 hover:underline">
              Edit in Simulator →
            </a>
            <button
              onClick={() => setSimulationActive(!simulationActive)}
              className={`btn px-4 py-2 font-medium rounded-lg text-sm transition flex items-center gap-2 cursor-pointer ${
                simulationActive
                  ? 'bg-amber-600 hover:bg-amber-700 text-white shadow'
                  : 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-300'
              }`}
            >
              {simulationActive ? <><EyeOff size={16} /> Turn Off Simulator</> : <><Eye size={16} /> Preview Simulator</>}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            Supplier Capacity Dashboard
            {simulationActive && (
              <span className="text-xs uppercase px-2.5 py-1 rounded bg-amber-500 text-white font-bold tracking-wider">
                Simulated
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500">Open balance (BAL QTY) by ship date vs. weekly supplier capacity</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Export Dropdown Menu */}
          <div className="relative" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
              disabled={exporting}
              className={`btn px-3.5 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-xs transition cursor-pointer ${
                hasActiveFilters
                  ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300'
              }`}
              title="Export open orders to Excel"
            >
              {exporting ? (
                <Loader2 size={16} className="animate-spin text-indigo-600" />
              ) : (
                <Download size={16} className={hasActiveFilters ? 'text-indigo-600' : 'text-slate-500'} />
              )}
              <span>Export Open Orders</span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {exportMenuOpen && (
              <div className="absolute right-0 mt-2 w-84 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-40 text-left">
                <div className="px-4 py-1.5 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Export to Excel (.xlsx)</span>
                  {simulationActive && <span className="text-[10px] text-amber-600 font-mono">SIMULATION ACTIVE</span>}
                </div>

                {/* Option 1: Filtered */}
                <button
                  type="button"
                  onClick={() => handleExport('filtered')}
                  className="w-full px-4 py-2.5 hover:bg-indigo-50/70 text-left flex items-start gap-3 transition cursor-pointer"
                >
                  <span className="p-1.5 rounded-lg bg-indigo-100 text-indigo-700 mt-0.5 shrink-0">
                    <Filter size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-800 flex items-center justify-between">
                      <span>Export Filtered Orders</span>
                      <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                        {fmtNum(scoped.length)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 truncate mt-0.5" title={hasActiveFilters ? activeFilterSummary : 'Matches active dashboard filters'}>
                      {hasActiveFilters ? activeFilterSummary : 'Matches current dashboard view'}
                    </div>
                  </div>
                </button>

                {/* Option 2: Active Category (if no category filter set) */}
                {activeCat && !filters.category && (
                  <button
                    type="button"
                    onClick={() => handleExport('activeCat')}
                    className="w-full px-4 py-2.5 hover:bg-purple-50/70 text-left flex items-start gap-3 transition cursor-pointer"
                  >
                    <span className="p-1.5 rounded-lg bg-purple-100 text-purple-700 mt-0.5 shrink-0">
                      <Boxes size={16} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 flex items-center justify-between">
                        <span>Selected Category</span>
                        <span className="text-xs font-mono font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">
                          {fmtNum(effectiveOrders.filter((o) => o.category_id === activeCat.id).length)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 truncate mt-0.5">
                        {activeCat.name} only
                      </div>
                    </div>
                  </button>
                )}

                {/* Option 3: All Monitored */}
                <button
                  type="button"
                  onClick={() => handleExport('monitored')}
                  className="w-full px-4 py-2.5 hover:bg-emerald-50/70 text-left flex items-start gap-3 transition cursor-pointer"
                >
                  <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 mt-0.5 shrink-0">
                    <FileSpreadsheet size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-800 flex items-center justify-between">
                      <span>All Monitored Orders</span>
                      <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                        {fmtNum(effectiveOrders.length)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      All monitored insulation lines (excludes inter-plant)
                    </div>
                  </div>
                </button>

                {/* Option 4: Complete Raw File */}
                <button
                  type="button"
                  onClick={() => handleExport('raw')}
                  className="w-full px-4 py-2.5 hover:bg-slate-100 text-left flex items-start gap-3 transition cursor-pointer border-t border-slate-100"
                >
                  <span className="p-1.5 rounded-lg bg-slate-100 text-slate-700 mt-0.5 shrink-0">
                    <Layers size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-800 flex items-center justify-between">
                      <span>Complete Raw Open Orders</span>
                      <span className="text-xs font-mono font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                        {fmtNum(rawOrders?.length || upload?.total_rows || 0)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Full master open order table (all commodities)
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>

          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
            {['week', 'month'].map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-sm rounded-md cursor-pointer ${mode === m ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {m === 'week' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
          <select className="input w-auto" value={range[mode]} onChange={(e) => setRange({ ...range, [mode]: Number(e.target.value) })}>
            {RANGES[mode].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <FilterBar filters={filters} setFilters={setFilters} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={ClipboardList} label="Monitored lines" value={fmtNum(kpis.lines)} />
        <Kpi icon={Boxes} label="Open POs" value={fmtNum(kpis.pos)} />
        <Kpi icon={Factory} label="Suppliers" value={fmtNum(kpis.suppliers)} />
        <Kpi icon={Clock} label="Past due lines" value={fmtNum(kpis.pastDue)} tone={kpis.pastDue ? 'red' : null} />
        <Kpi icon={AlertTriangle} label="Over-capacity periods" value={fmtNum(kpis.over)} tone={kpis.over ? 'red' : null} hint="Supplier-periods above 100% in the selected range" />
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-3">
        {categories.map((c) => {
          const a = aggs[c.id]; const n = next4[c.id]
          const lvl = utilLevel(n.load, n.cap)
          const p = n.cap ? Math.min(100, (n.load / n.cap) * 100) : 0
          const isActive = activeCat?.id === c.id
          return (
            <button key={c.id} onClick={() => setSelectedCat(c.id)}
              className={`card p-4 text-left transition cursor-pointer hover:shadow-md ${isActive ? 'ring-2 ring-indigo-500' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-slate-800 text-sm">{c.name}</div>
                <span className={`w-2.5 h-2.5 mt-1 rounded-full ${LEVEL_STYLES[lvl].dot}`} />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{fmtCompact(a.totalOpen)} <span className="text-xs font-normal text-slate-500">{c.unit} open</span></div>
              <div className="mt-3 text-xs text-slate-500 flex justify-between">
                <span>Next 4 weeks</span>
                <span className={LEVEL_STYLES[lvl].text}>{n.cap ? `${fmtCompact(n.load)} / ${fmtCompact(n.cap)} · ${pct(n.load, n.cap)}` : `${fmtCompact(n.load)} · no capacity`}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${n.cap ? p : 0}%`, background: LEVEL_STYLES[lvl].bar }} />
              </div>
              {a.pastDue > 0 && <div className="mt-2 text-xs text-red-600">Past due: {fmtNum(a.pastDue)} {c.unit}</div>}
            </button>
          )
        })}
      </div>

      {activeCat && agg && (
        <CategoryDetail
          category={activeCat}
          agg={agg}
          buckets={buckets}
          mode={mode}
          onCell={(supplier, bucket) => setDrill({ supplier, bucket })}
          onExportCategory={() => handleExport('activeCat')}
        />
      )}

      {drill && (
        <DrillDown
          drill={drill}
          category={activeCat}
          mode={mode}
          today={today}
          lookups={lookups}
          isSimulated={simulationActive}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, tone, hint }) {
  return (
    <div className="card p-4 flex items-center gap-3" title={hint}>
      <div className={`p-2 rounded-lg ${tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-indigo-50 text-indigo-600'}`}><Icon size={20} /></div>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className={`text-xl font-bold ${tone === 'red' ? 'text-red-600' : 'text-slate-900'}`}>{value}</div>
      </div>
    </div>
  )
}

function CategoryDetail({ category, agg, buckets, mode, onCell, onExportCategory }) {
  const { suppliers, chartData, totals, weeklyCapTotal, demand } = agg
  const unit = category.unit
  const periodWord = mode === 'week' ? 'week' : 'month'
  const withLoad = suppliers.filter((s) => s.total > 0)

  return (
    <div className="card">
      <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{category.name}</h2>
          <p className="text-sm text-slate-500">Load per {periodWord} by supplier · unit: {unit}</p>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <Stat label="Total weekly capacity" value={weeklyCapTotal ? fmtNum(weeklyCapTotal) : 'Not defined'} />
          <Stat label="Weekly demand" value={demand ? fmtNum(demand) : 'Not defined'} />
          <Stat label="Open balance" value={fmtNum(agg.totalOpen)} />
          {onExportCategory && (
            <button
              type="button"
              onClick={onExportCategory}
              className="btn-outline text-xs px-2.5 py-1.5 flex items-center gap-1.5 cursor-pointer shadow-2xs hover:bg-slate-50"
              title={`Export open orders for ${category.name}`}
            >
              <Download size={13} /> Export Category
            </button>
          )}
        </div>
      </div>

      <div className="p-5">
        {withLoad.length === 0 ? (
          <div className="text-center text-slate-500 py-12">No open orders for this category with the current filters.</div>
        ) : (
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11 }} width={60} />
              <Tooltip content={<ChartTooltip suppliers={suppliers} unit={unit} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {withLoad.map((s) => (
                <Bar key={s.code} dataKey={s.code} name={s.name} stackId="load" fill={s.color} maxBarSize={48} />
              ))}
              {weeklyCapTotal > 0 && <Line dataKey="capacity" name="Total capacity" type="stepAfter" stroke="#0f172a" strokeWidth={2} dot={false} connectNulls />}
              {demand > 0 && <Line dataKey="demand" name="Demand" type="stepAfter" stroke="#a855f7" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />}
              {chartData.length > 30 && <Brush dataKey="label" height={22} stroke="#6366f1" travellerWidth={8} />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Heatmap */}
      <div className="border-t border-slate-200">
        <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-800 text-sm">Supplier load heatmap</h3>
          <Legend2 />
        </div>
        <div className="overflow-x-auto pb-2">
          <table className="text-xs border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="th sticky left-0 z-10 min-w-56">Supplier</th>
                <th className="th text-right">Cap / {periodWord}</th>
                <th className="th text-right border-r border-slate-200">Open total</th>
                {buckets.map((b) => (
                  <th key={b.key} className={`th text-center min-w-16 ${b.key === PAST_DUE ? 'bg-red-50 text-red-700' : ''}`}>
                    <div>{b.label}</div><div className="font-normal normal-case text-slate-400">{b.sub}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.code} className="group">
                  <td className="td sticky left-0 z-10 bg-white group-hover:bg-slate-50 max-w-64">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                      <span className="truncate" title={`${s.name} (${s.code})`}>{s.name}</span>
                    </div>
                  </td>
                  <td className="td text-right text-slate-600">{s.weeklyCap ? fmtNum(s.weeklyCap) : <span className="text-slate-400">—</span>}</td>
                  <td className="td text-right font-semibold border-r border-slate-200">{fmtNum(s.total)}</td>
                  {buckets.map((b) => {
                    const v = s.cells[b.key] ?? 0
                    const cap = (s.weeklyCap ?? 0) * b.capacityFactor
                    const lvl = b.key === PAST_DUE ? (v ? 'red' : 'empty') : utilLevel(v, cap)
                    return (
                      <td key={b.key} onClick={() => v && onCell(s, b)}
                        title={v ? `${s.name}\n${b.label} ${b.sub}\nLoad: ${fmtNum(v)} ${unit}${cap ? `\nCapacity: ${fmtNum(cap)}\nUtilization: ${pct(v, cap)}` : ''}` : ''}
                        className={`td text-center border-l border-white ${LEVEL_STYLES[lvl].cell} ${v ? 'cursor-pointer hover:ring-2 hover:ring-indigo-400 hover:ring-inset' : ''}`}>
                        {v ? <><div>{fmtCompact(v)}</div>{cap > 0 && b.key !== PAST_DUE && <div className="text-[10px] opacity-70">{pct(v, cap)}</div>}</> : '·'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="td sticky left-0 z-10 bg-slate-50">Total load</td>
                <td className="td text-right bg-slate-50">{weeklyCapTotal ? fmtNum(weeklyCapTotal) : '—'}</td>
                <td className="td text-right bg-slate-50 border-r border-slate-200">{fmtNum(agg.totalOpen)}</td>
                {buckets.map((b) => {
                  const v = totals[b.key] ?? 0
                  const cap = weeklyCapTotal * b.capacityFactor
                  const lvl = b.key === PAST_DUE ? (v ? 'red' : 'empty') : utilLevel(v, cap)
                  return <td key={b.key} className={`td text-center border-l border-white ${LEVEL_STYLES[lvl].cell}`}>{v ? fmtCompact(v) : '·'}{cap > 0 && v > 0 && b.key !== PAST_DUE && <div className="text-[10px] opacity-70">{pct(v, cap)}</div>}</td>
                })}
              </tr>
              {demand > 0 && (
                <tr>
                  <td className="td sticky left-0 z-10 bg-white text-purple-700">Demand</td>
                  <td className="td text-right text-purple-700">{fmtNum(demand)}</td>
                  <td className="td border-r border-slate-200" />
                  {buckets.map((b) => {
                    const d = demand * b.capacityFactor; const v = totals[b.key] ?? 0
                    return <td key={b.key} className="td text-center text-purple-700" title={d ? `Load vs demand: ${pct(v, d)}` : ''}>{d ? fmtCompact(d) : ''}</td>
                  })}
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

const Stat = ({ label, value }) => (
  <div><div className="text-xs text-slate-500">{label}</div><div className="font-semibold text-slate-900">{value}</div></div>
)

function Legend2() {
  const items = [['green', '< 80%'], ['yellow', '80 – 100%'], ['red', '> 100% / Past due'], ['nocap', 'No capacity defined']]
  return (
    <div className="flex flex-wrap gap-3 text-xs text-slate-600">
      {items.map(([k, l]) => <span key={k} className="flex items-center gap-1"><span className={`w-3 h-3 rounded-sm ${LEVEL_STYLES[k].dot}`} />{l}</span>)}
      <span className="text-slate-400">· click a cell to see PO lines</span>
    </div>
  )
}

function ChartTooltip({ active, payload, label, suppliers, unit }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const bars = suppliers.filter((s) => row[s.code]).sort((a, b) => row[b.code] - row[a.code])
  return (
    <div className="card p-3 text-xs shadow-lg min-w-56">
      <div className="font-semibold text-slate-800 mb-1">{label} <span className="font-normal text-slate-400">{row.sub}</span></div>
      {bars.map((s) => (
        <div key={s.code} className="flex justify-between gap-4">
          <span className="flex items-center gap-1 truncate max-w-48"><span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />{s.name}</span>
          <span className="font-medium">{fmtNum(row[s.code])}</span>
        </div>
      ))}
      <div className="border-t border-slate-200 mt-1 pt-1 flex justify-between font-semibold"><span>Total</span><span>{fmtNum(row.total)} {unit}</span></div>
      {row.capacity != null && <div className="flex justify-between"><span>Capacity</span><span>{fmtNum(row.capacity)} · {pct(row.total, row.capacity)}</span></div>}
      {row.demand != null && <div className="flex justify-between text-purple-700"><span>Demand</span><span>{fmtNum(row.demand)}</span></div>}
    </div>
  )
}

function DrillDown({ drill, category, mode, today, lookups, isSimulated, onClose }) {
  const { supplier, bucket } = drill
  const lines = supplier.lines
    .filter((o) => bucketOf(o.ship_date, mode, today) === bucket.key)
    .sort((a, b) => (a.ship_date ?? '').localeCompare(b.ship_date ?? ''))
  const total = lines.reduce((s, o) => s + (Number(o.bal_qty) || 0), 0)

  const handleExportDrill = () => {
    exportOrdersToExcel({
      orders: lines,
      fileName: `open_orders_${supplier.name}_${category.name}_${bucket.key}_${today}`,
      sheetName: `${supplier.name.slice(0, 15)} ${bucket.key}`,
      lookups,
      isSimulated,
    })
  }

  return (
    <Modal wide onClose={onClose} title={`${supplier.name} · ${category.name}`}
      subtitle={`${bucket.label} ${bucket.sub} — ${lines.length} lines · ${fmtNum(total)} ${category.unit}`}>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={handleExportDrill}
          className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1.5 cursor-pointer shadow-2xs hover:bg-slate-50"
          title={`Export ${lines.length} lines to Excel`}
        >
          <Download size={14} /> Export {lines.length} lines to Excel
        </button>
      </div>
      <OrderLinesTable lines={lines} showCategory={false} showSupplier={false} />
    </Modal>
  )
}
