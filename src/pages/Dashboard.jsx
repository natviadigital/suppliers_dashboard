import { useMemo, useState, useRef, useEffect } from 'react'
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Brush, ReferenceArea } from 'recharts'
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
  CalendarOff,
  CheckCircle2,
  Clock3,
  CheckSquare,
} from 'lucide-react'
import { useData } from '../lib/DataContext'
import { resolveCapStatus } from '../lib/capStatusAndTdl'
import TdlPage from './TdlPage'
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
    holidays,
    holidayLookup,
    capStatusMap,
    toggleSupplierCapStatus,
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
    buckets, mode, supplierFilter: filters.supplier, today, holidayLookup,
  })])), [categories, filtered, master, lookups, buckets, mode, filters.supplier, today, holidayLookup])

  // Next-4-weeks snapshot per category (independent of view mode)
  const next4 = useMemo(() => {
    const wk = buildBuckets('week', today).slice(1, 5)
    return Object.fromEntries(categories.map((c) => {
      const a = aggregateCategory({ category: c, orders: filtered, capacities: master.capacities, vendorByCode: lookups.vendorByCode, buckets: wk, mode: 'week', supplierFilter: filters.supplier, today, holidayLookup })
      const load = wk.reduce((s, b) => s + (a.totals[b.key] ?? 0), 0)
      const cap = wk.reduce((s, b) => s + (a.bucketCapTotals?.[b.key] ?? a.weeklyCapTotal), 0)
      return [c.id, { load, cap }]
    }))
  }, [categories, filtered, master, lookups, filters.supplier, today, holidayLookup])

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

      {/* Compact Category Selector Menu */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <span>Select Category ({categories.length})</span>
            <span className="font-normal normal-case text-slate-400">· click a category to display its summary &amp; capacity breakdown below</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> &lt; 80% next 4w</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> 80–100%</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> &gt; 100%</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400" /> No cap / 0 load</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => {
            const a = aggs[c.id]
            const n = next4[c.id]
            const lvl = utilLevel(n.load, n.cap)
            const isActive = activeCat?.id === c.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCat(c.id)}
                title={`${c.name}\nOpen: ${fmtNum(a.totalOpen)} ${c.unit}\nNext 4w: ${n.cap ? `${fmtCompact(n.load)} / ${fmtCompact(n.cap)} (${pct(n.load, n.cap)})` : `${fmtCompact(n.load)} (no capacity)`}${a.pastDue > 0 ? `\nPast due: ${fmtNum(a.pastDue)} ${c.unit}` : ''}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 cursor-pointer border ${
                  isActive
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs ring-2 ring-indigo-200'
                    : 'bg-slate-50/80 hover:bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:shadow-2xs'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'ring-2 ring-white/80' : ''} ${LEVEL_STYLES[lvl].dot}`} />
                <span className="font-semibold">{c.name}</span>
                {a.totalOpen > 0 && (
                  <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                    isActive ? 'bg-indigo-700/80 text-indigo-100' : 'bg-slate-200/75 text-slate-600'
                  }`}>
                    {fmtCompact(a.totalOpen)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {activeCat && agg && (
        <CategoryDetail
          category={activeCat}
          agg={agg}
          next4={next4[activeCat.id]}
          buckets={buckets}
          mode={mode}
          capStatusMap={capStatusMap}
          onToggleCapStatus={toggleSupplierCapStatus}
          onCell={(supplier, bucket) => setDrill({ supplier, bucket })}
          onExportCategory={() => handleExport('activeCat')}
        />
      )}

      {/* TDL (Action & Status Tracker) Section on Dashboard */}
      <div className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-100 text-indigo-700">
              <CheckSquare size={18} />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900">TDL · Action &amp; Status Tracker</h2>
              <p className="text-xs text-slate-500">Monitor supplier capacity confirmations, PO reallocations, and follow-up actions</p>
            </div>
          </div>
          <a href="#/tdl" className="text-xs font-semibold text-indigo-600 hover:underline">
            Open Full TDL View →
          </a>
        </div>
        <TdlPage compact />
      </div>

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

function CategoryDetail({ category, agg, next4, buckets, mode, capStatusMap, onToggleCapStatus, onCell, onExportCategory }) {
  const { suppliers, chartData, totals, bucketCapTotals, weeklyCapTotal, demand } = agg
  const unit = category.unit
  const periodWord = mode === 'week' ? 'week' : 'month'
  const withLoad = suppliers.filter((s) => s.total > 0)

  const n4Load = next4?.load ?? 0
  const n4Cap = next4?.cap ?? 0
  const n4Lvl = utilLevel(n4Load, n4Cap)
  const n4PctWidth = n4Cap ? Math.min(100, (n4Load / n4Cap) * 100) : 0

  const confirmedCount = useMemo(
    () => suppliers.filter((s) => resolveCapStatus(capStatusMap, category.id, s.code, s.weeklyCap) === 'confirmed').length,
    [suppliers, capStatusMap, category.id]
  )

  // Time buckets excluding PAST_DUE for period averaging
  const timeBuckets = useMemo(() => buckets.filter((b) => b.key !== PAST_DUE), [buckets])

  // Selected index range [startIdx, endIdx] inside timeBuckets for the Average column
  const [avgRange, setAvgRange] = useState([0, Math.max(0, timeBuckets.length - 1)])

  // Reset range when buckets/mode change
  useEffect(() => {
    setAvgRange([0, Math.max(0, timeBuckets.length - 1)])
  }, [timeBuckets.length, mode])

  const startIdx = Math.max(0, Math.min(avgRange[0] ?? 0, Math.max(0, timeBuckets.length - 1)))
  const endIdx = Math.max(startIdx, Math.min(avgRange[1] ?? Math.max(0, timeBuckets.length - 1), Math.max(0, timeBuckets.length - 1)))

  const selectedTimeBuckets = useMemo(
    () => timeBuckets.slice(startIdx, endIdx + 1),
    [timeBuckets, startIdx, endIdx]
  )
  const selectedKeySet = useMemo(
    () => new Set(selectedTimeBuckets.map((b) => b.key)),
    [selectedTimeBuckets]
  )
  const avgPeriodCount = Math.max(1, selectedTimeBuckets.length)
  const firstSelBucket = selectedTimeBuckets[0]
  const lastSelBucket = selectedTimeBuckets[selectedTimeBuckets.length - 1]
  const rangeSummaryLabel = firstSelBucket && lastSelBucket
    ? `${firstSelBucket.label} – ${lastSelBucket.label} (${avgPeriodCount}${mode === 'week' ? 'w' : 'm'})`
    : `${avgPeriodCount} ${periodWord}s`

  // Collect blocked holiday weeks visible in the current range for suppliers in this category
  const activeHolidaysInRange = useMemo(() => {
    const map = new Map()
    for (const s of suppliers) {
      for (const b of buckets) {
        const hol = s.holidays?.[b.key]
        if (!hol) continue
        const list = Array.isArray(hol) ? hol : [hol]
        for (const h of list) {
          const k = `${s.code}_${h.id}`
          if (!map.has(k)) {
            map.set(k, {
              ...h,
              supplierName: s.name,
              weeks: [],
            })
          }
          if (mode === 'week') {
            map.get(k).weeks.push(`${b.label} (${b.sub})`)
          }
        }
      }
    }
    return [...map.values()]
  }, [suppliers, buckets, mode])

  // Total average across all suppliers in selected range
  const totalSelectedSum = useMemo(
    () => selectedTimeBuckets.reduce((sum, b) => sum + (totals[b.key] ?? 0), 0),
    [selectedTimeBuckets, totals]
  )
  const totalSelectedCapSum = useMemo(
    () => selectedTimeBuckets.reduce((sum, b) => sum + (bucketCapTotals?.[b.key] ?? (weeklyCapTotal * b.capacityFactor)), 0),
    [selectedTimeBuckets, bucketCapTotals, weeklyCapTotal]
  )
  const totalAvgLoad = totalSelectedSum / avgPeriodCount
  const totalAvgCap = totalSelectedCapSum / avgPeriodCount
  const totalAvgLvl = utilLevel(totalAvgLoad, totalAvgCap)

  return (
    <div className="card">
      <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full shrink-0 ${LEVEL_STYLES[n4Lvl].dot}`} />
          <div>
            <h2 className="text-lg font-bold text-slate-900">{category.name}</h2>
            <p className="text-xs text-slate-500">Load per {periodWord} by supplier · unit: {unit}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
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

      {/* Selected Category Summary Strip (shown when clicking a category pill above) */}
      <div className="px-5 py-3.5 bg-slate-50/75 border-b border-slate-200 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 items-center">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Open Balance</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-slate-900">{fmtCompact(agg.totalOpen)}</span>
            <span className="text-xs text-slate-500">{unit} ({fmtNum(agg.totalOpen)})</span>
          </div>
        </div>

        <div className="col-span-2 md:col-span-1 xl:col-span-2 bg-white px-3.5 py-2 rounded-lg border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-600">Next 4 Weeks Load vs. Cap</span>
            <span className={`font-bold ${LEVEL_STYLES[n4Lvl].text}`}>
              {n4Cap ? `${fmtCompact(n4Load)} / ${fmtCompact(n4Cap)} · ${pct(n4Load, n4Cap)}` : `${fmtCompact(n4Load)} · no capacity`}
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${n4Cap ? n4PctWidth : 0}%`, background: LEVEL_STYLES[n4Lvl].bar }}
            />
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Past Due</div>
          <div className={`mt-0.5 text-base font-bold ${agg.pastDue > 0 ? 'text-red-600' : 'text-slate-700'}`}>
            {fmtNum(agg.pastDue)} <span className="text-xs font-normal text-slate-500">{unit}</span>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Weekly Cap / Demand</div>
          <div className="mt-0.5 text-xs font-semibold text-slate-800">
            Cap: <span className="text-slate-900 font-bold">{weeklyCapTotal ? fmtNum(weeklyCapTotal) : '—'}</span>
            <span className="mx-1 text-slate-300">|</span>
            Dem: <span className="text-purple-700 font-bold">{demand ? fmtNum(demand) : '—'}</span>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Avg / {periodWord} ({rangeSummaryLabel})</div>
          <div className="mt-0.5 text-base font-bold text-indigo-700">
            {fmtNum(Math.round(totalAvgLoad))} <span className="text-xs font-normal text-slate-500">{unit}</span>
          </div>
        </div>
      </div>

      {/* Blocked Holiday Weeks Banner */}
      {activeHolidaysInRange.length > 0 && (
        <div className="mx-5 mt-4 p-3 rounded-lg bg-rose-50/80 border border-rose-200 text-xs text-rose-900 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 font-bold text-rose-700 uppercase tracking-wider">
              <CalendarOff size={14} /> Blocked Holiday Weeks:
            </span>
            {activeHolidaysInRange.map((h) => (
              <span
                key={`${h.vendor_code}_${h.id}`}
                className="px-2 py-0.5 rounded bg-white border border-rose-200 text-rose-800 font-medium shadow-2xs"
                title={`${h.supplierName}: ${h.holiday_name} (${h.start_date} to ${h.end_date} · ${h.total_days} days)`}
              >
                <b>{h.holiday_name}</b> ({h.start_date.slice(5)} to {h.end_date.slice(5)})
                {h.weeks.length > 0 && <span className="text-rose-600 font-mono ml-1">[{h.weeks.join(', ')}]</span>}
              </span>
            ))}
          </div>
          <a href="#/settings" className="text-rose-700 font-semibold hover:underline shrink-0">
            Manage Holidays →
          </a>
        </div>
      )}

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
              {weeklyCapTotal > 0 && <Line dataKey="capacity" name="Effective capacity (excl. holidays)" type="stepAfter" stroke="#0f172a" strokeWidth={2} dot={false} connectNulls />}
              {demand > 0 && <Line dataKey="demand" name="Demand" type="stepAfter" stroke="#a855f7" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />}
              <Brush
                dataKey="label"
                height={22}
                stroke="#6366f1"
                fill="#eef2ff"
                travellerWidth={9}
                startIndex={startIdx + 1}
                endIndex={endIdx + 1}
                onChange={(e) => {
                  if (e && typeof e.startIndex === 'number' && typeof e.endIndex === 'number') {
                    const s = Math.max(0, e.startIndex - 1)
                    const end = Math.max(s, Math.min(timeBuckets.length - 1, e.endIndex - 1))
                    setAvgRange([s, end])
                  }
                }}
              />
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

        {/* Interactive Brush-Style Period Range Selector for Average Calculation */}
        {timeBuckets.length > 0 && (
          <PeriodRangeBrush
            timeBuckets={timeBuckets}
            totals={totals}
            startIdx={startIdx}
            endIdx={endIdx}
            onChange={setAvgRange}
            mode={mode}
          />
        )}

        <div className="overflow-x-auto pb-2">
          <table className="text-xs border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="th sticky left-0 z-10 min-w-56">Supplier</th>
                <th className="th text-right">Cap / {periodWord}</th>
                <th
                  className="th text-center min-w-24"
                  title="Capacity Confirmation Status (click badge to toggle Confirmed / Pending)"
                >
                  Cap status
                </th>
                <th className="th text-right">Open total</th>
                <th
                  className="th text-center min-w-24 bg-indigo-50/90 text-indigo-900 border-x border-indigo-200"
                  title={`Average load per ${periodWord} across selected range: ${firstSelBucket?.label ?? ''} (${firstSelBucket?.sub ?? ''}) to ${lastSelBucket?.label ?? ''} (${lastSelBucket?.sub ?? ''}) · ${avgPeriodCount} ${periodWord}s`}
                >
                  <div>Avg / {periodWord}</div>
                  <div className="font-mono text-[10px] font-semibold text-indigo-600 normal-case">
                    {rangeSummaryLabel}
                  </div>
                </th>
                {buckets.map((b) => {
                  const inAvg = selectedKeySet.has(b.key)
                  return (
                    <th
                      key={b.key}
                      className={`th text-center min-w-16 ${
                        b.key === PAST_DUE
                          ? 'bg-red-50 text-red-700'
                          : inAvg
                            ? 'border-t-2 border-t-indigo-500 bg-indigo-50/35'
                            : 'opacity-60'
                      }`}
                    >
                      <div>{b.label}</div>
                      <div className="font-normal normal-case text-slate-400">{b.sub}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => {
                const rangeSum = selectedTimeBuckets.reduce((sum, b) => sum + (s.cells[b.key] ?? 0), 0)
                const avgLoad = rangeSum / avgPeriodCount
                const rangeCapSum = selectedTimeBuckets.reduce(
                  (sum, b) => sum + (s.bucketCaps?.[b.key] ?? ((s.weeklyCap ?? 0) * b.capacityFactor)),
                  0
                )
                const avgCap = rangeCapSum / avgPeriodCount
                const avgLvl = utilLevel(avgLoad, avgCap)
                const capStatus = resolveCapStatus(capStatusMap, category.id, s.code, s.weeklyCap)
                const isConfirmed = capStatus === 'confirmed'

                return (
                  <tr key={s.code} className="group">
                    <td className="td sticky left-0 z-10 bg-white group-hover:bg-slate-50 max-w-64">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                        <span className="truncate" title={`${s.name} (${s.code})`}>{s.name}</span>
                      </div>
                    </td>
                    <td className="td text-right text-slate-600">{s.weeklyCap ? fmtNum(s.weeklyCap) : <span className="text-slate-400">—</span>}</td>
                    <td className="td text-center">
                      <button
                        type="button"
                        onClick={() => onToggleCapStatus?.(category.id, s.code, s.weeklyCap)}
                        title={`Capacity is ${isConfirmed ? 'Confirmed' : 'Pending confirmation'} for ${s.name}. Click to toggle.`}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition cursor-pointer ${
                          isConfirmed
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                        }`}
                      >
                        {isConfirmed ? <CheckCircle2 size={11} className="shrink-0" /> : <Clock3 size={11} className="shrink-0" />}
                        <span>{isConfirmed ? 'Confirmed' : 'Pending'}</span>
                      </button>
                    </td>
                    <td className="td text-right font-semibold">{fmtNum(s.total)}</td>
                    <td
                      className={`td text-center font-semibold border-x border-indigo-200 ${
                        avgLoad > 0 ? LEVEL_STYLES[avgLvl].cell : 'bg-indigo-50/30 text-slate-400'
                      }`}
                      title={[
                        `${s.name} — Average (${rangeSummaryLabel})`,
                        `Period: ${firstSelBucket?.label ?? ''} (${firstSelBucket?.sub ?? ''}) to ${lastSelBucket?.label ?? ''} (${lastSelBucket?.sub ?? ''})`,
                        `Total in range: ${fmtNum(rangeSum)} ${unit} across ${avgPeriodCount} ${periodWord}s`,
                        `Average load: ${fmtNum(Math.round(avgLoad))} ${unit}/${periodWord}`,
                        avgCap ? `Avg Effective Capacity: ${fmtNum(Math.round(avgCap))} ${unit}/${periodWord} (${pct(avgLoad, avgCap)})` : null,
                      ].filter(Boolean).join('\n')}
                    >
                      {avgLoad > 0 ? (
                        <>
                          <div>{fmtCompact(avgLoad)}</div>
                          {avgCap > 0 && <div className="text-[10px] opacity-75">{pct(avgLoad, avgCap)}</div>}
                        </>
                      ) : '·'}
                    </td>
                    {buckets.map((b) => {
                      const v = s.cells[b.key] ?? 0
                      const hol = s.holidays?.[b.key]
                      const isBlockedWeek = mode === 'week' && Boolean(hol)
                      const cap = s.bucketCaps?.[b.key] ?? ((s.weeklyCap ?? 0) * b.capacityFactor)
                      const lvl = b.key === PAST_DUE
                        ? (v ? 'red' : 'empty')
                        : isBlockedWeek
                          ? (v > 0 ? 'red' : 'holiday')
                          : utilLevel(v, cap)

                      const holLabel = hol
                        ? (Array.isArray(hol)
                            ? hol.map((h) => `${h.holiday_name} (${h.start_date} to ${h.end_date} · ${h.total_days}d)`).join(', ')
                            : `${hol.holiday_name} (${hol.start_date} to ${hol.end_date} · ${hol.total_days} days)`)
                        : ''

                      const cellTitle = [
                        s.name,
                        `${b.label} ${b.sub}`,
                        holLabel ? `🚫 BLOCKED HOLIDAY: ${holLabel}` : null,
                        v ? `Load: ${fmtNum(v)} ${unit}` : (isBlockedWeek ? 'Load: 0 (Blocked Week)' : null),
                        isBlockedWeek ? 'Available Capacity: 0 (Holiday Blocked)' : (cap ? `Capacity: ${fmtNum(cap)}\nUtilization: ${pct(v, cap)}` : null),
                      ].filter(Boolean).join('\n')

                      const cellClass = lvl === 'holiday'
                        ? 'bg-rose-50/90 text-rose-700 border-rose-100'
                        : LEVEL_STYLES[lvl].cell
                      const inAvg = b.key === PAST_DUE || selectedKeySet.has(b.key)

                      return (
                        <td key={b.key} onClick={() => v && onCell(s, b)}
                          title={cellTitle}
                          style={lvl === 'holiday' ? { backgroundImage: 'repeating-linear-gradient(-45deg, rgba(244,63,94,0.06), rgba(244,63,94,0.06) 4px, rgba(255,228,230,0.45) 4px, rgba(255,228,230,0.45) 8px)' } : undefined}
                          className={`td text-center border-l border-white ${cellClass} ${!inAvg ? 'opacity-50' : ''} ${v ? 'cursor-pointer hover:ring-2 hover:ring-indigo-400 hover:ring-inset' : ''}`}>
                          {v ? (
                            <>
                              <div>{fmtCompact(v)}</div>
                              {isBlockedWeek ? (
                                <div className="text-[9px] font-bold uppercase text-rose-800 bg-rose-100/80 rounded px-1 inline-block">HOL</div>
                              ) : (
                                cap > 0 && b.key !== PAST_DUE && <div className="text-[10px] opacity-70">{pct(v, cap)}</div>
                              )}
                            </>
                          ) : isBlockedWeek ? (
                            <span className="text-[10px] font-bold uppercase tracking-tighter text-rose-600 px-1 py-0.5 rounded bg-white/80 border border-rose-200">
                              HOL
                            </span>
                          ) : '·'}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="td sticky left-0 z-10 bg-slate-50">Total load</td>
                <td className="td text-right bg-slate-50">{weeklyCapTotal ? fmtNum(weeklyCapTotal) : '—'}</td>
                <td className="td text-center bg-slate-50 text-[10px] text-slate-500 font-medium">
                  {confirmedCount}/{suppliers.length} conf.
                </td>
                <td className="td text-right bg-slate-50">{fmtNum(agg.totalOpen)}</td>
                <td
                  className={`td text-center border-x border-indigo-200 ${
                    totalAvgLoad > 0 ? LEVEL_STYLES[totalAvgLvl].cell : 'bg-indigo-50/40 text-slate-400'
                  }`}
                  title={`Total Average Load (${rangeSummaryLabel}): ${fmtNum(Math.round(totalAvgLoad))} ${unit}/${periodWord}${totalAvgCap ? `\nAvg Effective Capacity: ${fmtNum(Math.round(totalAvgCap))} (${pct(totalAvgLoad, totalAvgCap)})` : ''}`}
                >
                  {totalAvgLoad > 0 ? fmtCompact(totalAvgLoad) : '·'}
                  {totalAvgCap > 0 && totalAvgLoad > 0 && (
                    <div className="text-[10px] opacity-75">{pct(totalAvgLoad, totalAvgCap)}</div>
                  )}
                </td>
                {buckets.map((b) => {
                  const v = totals[b.key] ?? 0
                  const cap = bucketCapTotals?.[b.key] ?? (weeklyCapTotal * b.capacityFactor)
                  const lvl = b.key === PAST_DUE ? (v ? 'red' : 'empty') : utilLevel(v, cap)
                  const inAvg = b.key === PAST_DUE || selectedKeySet.has(b.key)
                  return <td key={b.key} className={`td text-center border-l border-white ${LEVEL_STYLES[lvl].cell} ${!inAvg ? 'opacity-50' : ''}`}>{v ? fmtCompact(v) : '·'}{cap > 0 && v > 0 && b.key !== PAST_DUE && <div className="text-[10px] opacity-70">{pct(v, cap)}</div>}</td>
                })}
              </tr>
              {demand > 0 && (
                <tr>
                  <td className="td sticky left-0 z-10 bg-white text-purple-700">Demand</td>
                  <td className="td text-right text-purple-700">{fmtNum(demand)}</td>
                  <td className="td" />
                  <td className="td" />
                  <td className="td text-center text-purple-700 font-semibold bg-purple-50/40 border-x border-indigo-200">
                    {fmtCompact(demand * (selectedTimeBuckets[0]?.capacityFactor ?? 1))}
                  </td>
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

function PeriodRangeBrush({ timeBuckets, totals, startIdx, endIdx, onChange, mode }) {
  const trackRef = useRef(null)
  const dragRef = useRef(null)
  const n = timeBuckets.length
  const periodLabel = mode === 'week' ? 'weeks' : 'months'

  const maxTotal = useMemo(() => {
    let m = 1
    for (const b of timeBuckets) {
      const v = totals[b.key] ?? 0
      if (v > m) m = v
    }
    return m
  }, [timeBuckets, totals])

  const startDrag = (e, type) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = {
      type,
      initX: e.clientX,
      initStart: startIdx,
      initEnd: endIdx,
      width: rect.width,
      left: rect.left,
    }

    const onMove = (ev) => {
      const d = dragRef.current
      if (!d) return
      if (d.type === 'left') {
        const rel = Math.max(0, Math.min(1, (ev.clientX - d.left) / d.width))
        const nextStart = Math.min(d.initEnd, Math.max(0, Math.floor(rel * n)))
        onChange([nextStart, d.initEnd])
      } else if (d.type === 'right') {
        const rel = Math.max(0, Math.min(1, (ev.clientX - d.left) / d.width))
        const nextEnd = Math.max(d.initStart, Math.min(n - 1, Math.floor(rel * n)))
        onChange([d.initStart, nextEnd])
      } else if (d.type === 'pan') {
        const deltaIdx = Math.round(((ev.clientX - d.initX) / d.width) * n)
        const span = d.initEnd - d.initStart
        let nextStart = d.initStart + deltaIdx
        if (nextStart < 0) nextStart = 0
        if (nextStart + span > n - 1) nextStart = Math.max(0, n - 1 - span)
        onChange([nextStart, nextStart + span])
      }
    }

    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const handleTrackClick = (e) => {
    if (dragRef.current) return
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const rel = Math.max(0, Math.min(0.999, (e.clientX - rect.left) / rect.width))
    const clickedIdx = Math.floor(rel * n)
    if (clickedIdx < startIdx) {
      onChange([clickedIdx, endIdx])
    } else if (clickedIdx > endIdx) {
      onChange([startIdx, clickedIdx])
    }
  }

  const leftPct = (startIdx / n) * 100
  const widthPct = ((endIdx - startIdx + 1) / n) * 100
  const bStart = timeBuckets[startIdx]
  const bEnd = timeBuckets[endIdx]
  const count = endIdx - startIdx + 1

  const presets = mode === 'week'
    ? [
        [4, 'Next 4W'],
        [8, 'Next 8W'],
        [12, 'Next 12W'],
        [26, 'Next 26W'],
        [n, 'All'],
      ]
    : [
        [3, 'Next 3M'],
        [6, 'Next 6M'],
        [12, 'Next 12M'],
        [n, 'All'],
      ]

  return (
    <div className="px-5 pb-3 pt-1 bg-slate-50/70 border-b border-slate-200 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-700">Average Period Selector:</span>
          <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-semibold font-mono">
            {bStart?.label} ({bStart?.sub}) &rarr; {bEnd?.label} ({bEnd?.sub}) · {count} {periodLabel}
          </span>
          <div className="flex items-center gap-1 text-slate-500 ml-1">
            <span>From:</span>
            <select
              className="border border-slate-300 rounded px-1.5 py-0.5 bg-white text-slate-700 font-mono text-[11px]"
              value={startIdx}
              onChange={(e) => {
                const v = Number(e.target.value)
                onChange([v, Math.max(v, endIdx)])
              }}
            >
              {timeBuckets.map((b, i) => (
                <option key={b.key} value={i}>
                  {b.label} ({b.sub})
                </option>
              ))}
            </select>
            <span>To:</span>
            <select
              className="border border-slate-300 rounded px-1.5 py-0.5 bg-white text-slate-700 font-mono text-[11px]"
              value={endIdx}
              onChange={(e) => {
                const v = Number(e.target.value)
                onChange([Math.min(startIdx, v), v])
              }}
            >
              {timeBuckets.map((b, i) => (
                <option key={b.key} value={i}>
                  {b.label} ({b.sub})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {presets
            .filter(([len]) => len <= n)
            .map(([len, lbl]) => {
              const isActive = startIdx === 0 && endIdx === len - 1
              return (
                <button
                  key={lbl}
                  type="button"
                  onClick={() => onChange([0, Math.min(n - 1, len - 1)])}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer transition ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {lbl}
                </button>
              )
            })}
        </div>
      </div>

      {/* Recharts-Brush-Style Draggable Range Bar */}
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        className="relative h-7 w-full rounded bg-slate-200/70 border border-indigo-300 select-none overflow-hidden cursor-pointer"
        title="Drag the purple handles or slide the highlighted window to choose which periods to average"
      >
        {/* Mini background sparkline bars */}
        <div className="absolute inset-0 flex items-end px-0.5 gap-px pointer-events-none">
          {timeBuckets.map((b, i) => {
            const v = totals[b.key] ?? 0
            const hPct = Math.max(v > 0 ? 12 : 0, Math.round((v / maxTotal) * 85))
            const inside = i >= startIdx && i <= endIdx
            return (
              <div key={b.key} className="flex-1 h-full flex items-end">
                <div
                  className={`w-full rounded-t-[1px] ${inside ? 'bg-indigo-400/70' : 'bg-slate-400/35'}`}
                  style={{ height: `${hPct}%` }}
                />
              </div>
            )
          })}
        </div>

        {/* Selected draggable window */}
        <div
          onPointerDown={(e) => startDrag(e, 'pan')}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          className="absolute top-0 bottom-0 bg-indigo-500/20 border-y-2 border-indigo-600 cursor-grab active:cursor-grabbing flex items-center justify-between"
        >
          {/* Left Traveller Handle */}
          <div
            onPointerDown={(e) => startDrag(e, 'left')}
            className="w-3 h-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center cursor-ew-resize shrink-0 shadow-xs"
            title="Drag left handle"
          >
            <span className="text-[9px] font-bold leading-none">=</span>
          </div>

          {/* Right Traveller Handle */}
          <div
            onPointerDown={(e) => startDrag(e, 'right')}
            className="w-3 h-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center cursor-ew-resize shrink-0 shadow-xs"
            title="Drag right handle"
          >
            <span className="text-[9px] font-bold leading-none">=</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Legend2() {
  const items = [['green', '< 80%'], ['yellow', '80 – 100%'], ['red', '> 100% / Past due'], ['nocap', 'No capacity defined']]
  return (
    <div className="flex flex-wrap gap-3 text-xs text-slate-600 items-center">
      {items.map(([k, l]) => <span key={k} className="flex items-center gap-1"><span className={`w-3 h-3 rounded-sm ${LEVEL_STYLES[k].dot}`} />{l}</span>)}
      <span className="flex items-center gap-1">
        <span className="px-1 py-0.2 text-[9px] font-bold rounded bg-rose-50 text-rose-700 border border-rose-300">HOL</span>
        Blocked Holiday (0 cap)
      </span>
      <span className="text-slate-400">· click a cell to see PO lines</span>
    </div>
  )
}

function ChartTooltip({ active, payload, label, suppliers, unit }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const bars = suppliers.filter((s) => row[s.code]).sort((a, b) => row[b.code] - row[a.code])
  return (
    <div className="card p-3 text-xs shadow-lg min-w-60">
      <div className="font-semibold text-slate-800 mb-1">{label} <span className="font-normal text-slate-400">{row.sub}</span></div>
      {row.holidays?.length > 0 && (
        <div className="mb-2 p-1.5 rounded bg-rose-50 border border-rose-200 text-rose-800 space-y-0.5">
          {row.holidays.map((h, i) => (
            <div key={i} className="font-medium leading-tight">
              🚫 <b>{h.holiday_name}</b> ({h.start_date} – {h.end_date} · {h.total_days}d)
              <div className="text-[10px] text-rose-600">{h.supplierName}: Week Blocked (0 cap)</div>
            </div>
          ))}
        </div>
      )}
      {bars.map((s) => (
        <div key={s.code} className="flex justify-between gap-4">
          <span className="flex items-center gap-1 truncate max-w-48"><span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />{s.name}</span>
          <span className="font-medium">{fmtNum(row[s.code])}</span>
        </div>
      ))}
      <div className="border-t border-slate-200 mt-1 pt-1 flex justify-between font-semibold"><span>Total</span><span>{fmtNum(row.total)} {unit}</span></div>
      {row.capacity != null && <div className="flex justify-between"><span>Effective Capacity</span><span>{fmtNum(row.capacity)} · {pct(row.total, row.capacity)}</span></div>}
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
