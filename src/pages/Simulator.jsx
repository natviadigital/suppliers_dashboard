import { useState, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import {
  Sparkles,
  Plus,
  Trash2,
  Download,
  Upload,
  ArrowRight,
  Search,
  Check,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Calendar,
  Layers,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building2,
  BarChart2,
} from 'lucide-react'
import { useData } from '../lib/DataContext'
import { createScenario, deleteScenario, saveScenarioItems } from '../lib/api'
import { fmtNum, fmtCompact, utilLevel, LEVEL_STYLES, pct } from '../lib/format'
import { buildBuckets, bucketOf, fmtDate, todayISO } from '../lib/periods'
import Modal from '../components/Modal'

export default function Simulator() {
  const {
    master,
    lookups,
    orders,
    scenarios,
    activeScenario,
    activeScenarioId,
    setActiveScenarioId,
    scenarioItems,
    setScenarioItems,
    reloadScenarios,
    simulationActive,
    setSimulationActive,
  } = useData()

  const [newScenarioName, setNewScenarioName] = useState('')
  const [newScenarioDesc, setNewScenarioDesc] = useState('')
  const [showNewModal, setShowNewModal] = useState(false)
  const [search, setSearch] = useState('')
  const [plantFilter, setPlantFilter] = useState('') // Filter by plant/division (Requirement 1)
  const [vendorFilter, setVendorFilter] = useState('7466') // default Weidmann (7466)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('2027-01-01') // default 2027+
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'reallocated' | 'pending'
  const [sortOrder, setSortOrder] = useState('asc') // 'asc' | 'desc' for date sorting (Requirement 3)
  const [selectedKeys, setSelectedKeys] = useState(new Set())
  const [bulkVendor, setBulkVendor] = useState('')
  const [bulkShipDate, setBulkShipDate] = useState('')
  const [csvError, setCsvError] = useState(null)
  const [csvSuccess, setCsvSuccess] = useState(null)
  const [saveStatus, setSaveStatus] = useState(null)
  const [viewTab, setViewTab] = useState('orders') // 'orders' | 'capacity_summary' (Requirement 4)
  const fileInputRef = useRef(null)
  const today = todayISO()

  // Scenario items mapped by `${po}*${item}`
  const itemMap = useMemo(() => {
    const map = new Map()
    for (const it of scenarioItems) {
      map.set(`${String(it.po).trim()}*${String(it.item).trim()}`, it)
    }
    return map
  }, [scenarioItems])

  // Filter orders according to criteria and sort by date
  const candidateOrders = useMemo(() => {
    const list = orders.filter((o) => {
      // 1. Plant filter (Requirement 1)
      if (plantFilter && String(o.div) !== String(plantFilter)) return false
      if (vendorFilter && o.vendor_code !== vendorFilter) return false
      if (categoryFilter && String(o.category_id) !== categoryFilter) return false
      if (dateFilter && (!o.ship_date || o.ship_date < dateFilter)) return false
      if (search) {
        const q = search.toLowerCase()
        const match =
          (o.po && o.po.toLowerCase().includes(q)) ||
          (o.part_number && o.part_number.toLowerCase().includes(q)) ||
          (o.description && o.description.toLowerCase().includes(q)) ||
          (o.job_reference && o.job_reference.toLowerCase().includes(q))
        if (!match) return false
      }
      const key = `${String(o.po).trim()}*${String(o.item).trim()}`
      const isReallocated = itemMap.has(key)
      if (statusFilter === 'reallocated' && !isReallocated) return false
      if (statusFilter === 'pending' && isReallocated) return false
      return true
    })

    // 3. Sort by date (Requirement 3)
    list.sort((a, b) => {
      const da = a.ship_date || '9999-99-99'
      const db = b.ship_date || '9999-99-99'
      const cmp = da.localeCompare(db)
      return sortOrder === 'asc' ? cmp : -cmp
    })

    return list
  }, [orders, plantFilter, vendorFilter, categoryFilter, dateFilter, search, statusFilter, sortOrder, itemMap])

  // Count summary
  const summary = useMemo(() => {
    let reallocatedCount = 0
    let reallocatedQty = 0
    for (const o of orders) {
      const key = `${String(o.po).trim()}*${String(o.item).trim()}`
      if (itemMap.has(key)) {
        reallocatedCount++
        reallocatedQty += Number(o.bal_qty) || 0
      }
    }
    return { count: reallocatedCount, qty: reallocatedQty }
  }, [orders, itemMap])

  // Helper: auto-save scenario items to DB and DataContext
  const updateItems = async (newItems) => {
    setScenarioItems(newItems)
    if (activeScenarioId) {
      setSaveStatus('Saving...')
      try {
        await saveScenarioItems(activeScenarioId, newItems)
        setSaveStatus('Saved')
        setTimeout(() => setSaveStatus(null), 2000)
      } catch (err) {
        setSaveStatus('Error saving: ' + err.message)
      }
    }
  }

  // Create scenario
  const handleCreateScenario = async () => {
    if (!newScenarioName.trim()) return
    const sc = await createScenario(newScenarioName.trim(), newScenarioDesc.trim())
    await reloadScenarios()
    setActiveScenarioId(sc.id)
    setShowNewModal(false)
    setNewScenarioName('')
    setNewScenarioDesc('')
    setSimulationActive(true)
  }

  // Delete scenario
  const handleDeleteScenario = async (id) => {
    if (!confirm('Are you sure you want to delete this scenario? This cannot be undone.')) return
    await deleteScenario(id)
    await reloadScenarios()
    if (activeScenarioId === id) {
      setActiveScenarioId(null)
      setSimulationActive(false)
    }
  }

  // Reallocate individual item
  const handleReallocateOne = (po, item, newVendor, newShipDate) => {
    if (!activeScenarioId) {
      alert('Please create or select a scenario first.')
      return
    }
    const key = `${String(po).trim()}*${String(item).trim()}`
    const existing = scenarioItems.filter((it) => `${String(it.po).trim()}*${String(it.item).trim()}` !== key)
    if (newVendor) {
      const newItem = {
        id: crypto.randomUUID(),
        scenario_id: activeScenarioId,
        po: String(po).trim(),
        item: Number(item),
        new_vendor: newVendor,
        new_ship_date: newShipDate || null,
        created_at: new Date().toISOString(),
      }
      updateItems([...existing, newItem])
    } else {
      updateItems(existing)
    }
  }

  // Bulk reallocate selected
  const handleBulkReallocate = () => {
    if (!activeScenarioId) {
      alert('Please create or select a scenario first.')
      return
    }
    if (!bulkVendor) {
      alert('Please select a target vendor for bulk reallocation.')
      return
    }
    if (selectedKeys.size === 0) {
      alert('No orders selected.')
      return
    }

    const newMap = new Map()
    for (const it of scenarioItems) {
      newMap.set(`${String(it.po).trim()}*${String(it.item).trim()}`, it)
    }

    for (const o of candidateOrders) {
      const key = `${String(o.po).trim()}*${String(o.item).trim()}`
      if (selectedKeys.has(key)) {
        newMap.set(key, {
          id: newMap.get(key)?.id || crypto.randomUUID(),
          scenario_id: activeScenarioId,
          po: String(o.po).trim(),
          item: Number(o.item),
          new_vendor: bulkVendor,
          new_ship_date: bulkShipDate || o.ship_date,
          created_at: new Date().toISOString(),
        })
      }
    }

    updateItems([...newMap.values()])
    setSelectedKeys(new Set())
    setBulkVendor('')
    setBulkShipDate('')
  }

  // Clear reallocation for selected
  const handleBulkClear = () => {
    if (selectedKeys.size === 0) return
    const remaining = scenarioItems.filter((it) => !selectedKeys.has(`${String(it.po).trim()}*${String(it.item).trim()}`))
    updateItems(remaining)
    setSelectedKeys(new Set())
  }

  // Handle CSV upload
  const handleCsvUpload = async (e) => {
    setCsvError(null)
    setCsvSuccess(null)
    const file = e.target.files?.[0]
    if (!file) return

    if (!activeScenarioId) {
      setCsvError('Please select or create an active scenario before importing.')
      return
    }

    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: false })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(ws, { defval: '' })

      if (!data.length) {
        throw new Error('CSV or Excel file is empty.')
      }

      const findKey = (row, candidates) => {
        const keys = Object.keys(row)
        for (const c of candidates) {
          const match = keys.find((k) => k.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === c.toLowerCase())
          if (match) return match
        }
        return null
      }

      const sample = data[0]
      const poKey = findKey(sample, ['ponbr', 'po', 'purchaseorder', 'pono', 'ponumber'])
      const itemKey = findKey(sample, ['itm', 'item', 'line', 'linenbr'])
      const newVendorKey = findKey(sample, ['newvendor', 'newvendorcode', 'targetvendor', 'newsupplier'])
      const newDateKey = findKey(sample, ['newshipdate', 'newship', 'newdate', 'targetshipdate'])

      if (!poKey || !itemKey || !newVendorKey) {
        throw new Error(
          `Missing required columns in CSV. Found: ${Object.keys(sample).join(', ')}. Expected: PO Nbr, Itm, New Vendor`
        )
      }

      let imported = 0
      const currentMap = new Map()
      for (const it of scenarioItems) {
        currentMap.set(`${String(it.po).trim()}*${String(it.item).trim()}`, it)
      }

      for (const row of data) {
        const po = String(row[poKey] || '').trim()
        const itm = Number(row[itemKey])
        const newVendor = String(row[newVendorKey] || '').trim()
        if (!po || !itm || !newVendor) continue

        let newShipDate = null
        if (newDateKey && row[newDateKey]) {
          const rawDate = row[newDateKey]
          if (rawDate instanceof Date && !isNaN(rawDate)) {
            newShipDate = rawDate.toISOString().slice(0, 10)
          } else {
            const s = String(rawDate).trim()
            const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
            if (m) {
              const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
              newShipDate = `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
            } else if (s.match(/^\d{4}-\d{2}-\d{2}$/)) {
              newShipDate = s
            }
          }
        }

        const key = `${po}*${itm}`
        currentMap.set(key, {
          id: currentMap.get(key)?.id || crypto.randomUUID(),
          scenario_id: activeScenarioId,
          po,
          item: itm,
          new_vendor: newVendor,
          new_ship_date: newShipDate,
          created_at: new Date().toISOString(),
        })
        imported++
      }

      await updateItems([...currentMap.values()])
      setCsvSuccess(`Successfully imported ${imported} reallocations into scenario.`)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setCsvError(err.message)
    }
  }

  // 4. Capacity Summary grouped by Category (Requirement 4)
  const categoryCapacitySummary = useMemo(() => {
    // Map: category_id -> { catName, unit, vendors: Map(vendor_code -> { before, after }) }
    const catMap = new Map()

    for (const c of master.categories) {
      catMap.set(c.id, {
        id: c.id,
        name: c.name,
        unit: c.unit,
        weeklyDemand: c.weekly_demand,
        vendors: new Map(),
      })
    }

    // Pre-populate defined capacities
    for (const cap of master.capacities) {
      const c = catMap.get(cap.category_id)
      if (c) {
        c.vendors.set(cap.vendor_code, {
          code: cap.vendor_code,
          name: lookups?.vendorByCode[cap.vendor_code]?.vendor_name || cap.vendor_code,
          weeklyCap: cap.weekly_capacity,
          before: 0,
          after: 0,
        })
      }
    }

    // Accumulate orders load
    for (const o of orders) {
      if (!o.category_id) continue
      let c = catMap.get(o.category_id)
      if (!c) continue

      const origV = o.vendor_code
      if (!c.vendors.has(origV)) {
        c.vendors.set(origV, {
          code: origV,
          name: lookups?.vendorByCode[origV]?.vendor_name || o.supplier_name || origV,
          weeklyCap: null,
          before: 0,
          after: 0,
        })
      }
      c.vendors.get(origV).before += Number(o.bal_qty) || 0

      // Reallocation target
      const key = `${String(o.po).trim()}*${String(o.item).trim()}`
      const realloc = itemMap.get(key)
      const targetV = realloc ? realloc.new_vendor : origV

      if (!c.vendors.has(targetV)) {
        c.vendors.set(targetV, {
          code: targetV,
          name: lookups?.vendorByCode[targetV]?.vendor_name || targetV,
          weeklyCap: null,
          before: 0,
          after: 0,
        })
      }
      c.vendors.get(targetV).after += Number(o.bal_qty) || 0
    }

    return [...catMap.values()]
      .map((c) => ({
        ...c,
        vendorList: [...c.vendors.values()]
          .filter((v) => v.before > 0 || v.after > 0 || v.weeklyCap > 0)
          .sort((a, b) => b.after - a.after || (b.weeklyCap || 0) - (a.weeklyCap || 0)),
      }))
      .filter((c) => c.vendorList.length > 0)
  }, [master.categories, master.capacities, orders, itemMap, lookups])

  // Export 3-sheet Excel with Plant and Category breakdown (Requirements 4 & 5)
  const handleExportExcel = () => {
    if (!activeScenario) {
      alert('Please select an active scenario to export.')
      return
    }

    const wb = XLSX.utils.book_new()

    // 1. Cancel List (includes Plant / Division - Requirement 5)
    const cancelRows = []
    // 2. Re-source List (includes Plant / Division - Requirement 5)
    const resourceRows = []

    for (const it of scenarioItems) {
      const key = `${String(it.po).trim()}*${String(it.item).trim()}`
      const orig = orders.find((o) => `${String(o.po).trim()}*${String(o.item).trim()}` === key)

      cancelRows.push({
        'Plant / Div': orig?.division_name || orig?.div || '',
        'PO Nbr': it.po,
        'Itm': it.item,
        'Vendor Code': orig?.vendor_code || '',
        'Vendor Name': orig?.supplier_name || '',
        'Part Number': orig?.part_number || '',
        'Description': orig?.description || '',
        'Category': orig?.category_name || '',
        'Original Ship Date': orig?.ship_date || '',
        'Bal Qty': orig?.bal_qty || 0,
        'Buyer': orig?.buyer || '',
        'Job Ref': orig?.job_reference || '',
      })

      const targetVendorName = lookups?.vendorByCode[it.new_vendor]?.vendor_name || it.new_vendor
      resourceRows.push({
        'Plant / Div': orig?.division_name || orig?.div || '',
        'Original PO': it.po,
        'Original Itm': it.item,
        'Original Vendor': orig?.supplier_name || orig?.vendor_code || '',
        'New Vendor Code': it.new_vendor,
        'New Vendor Name': targetVendorName,
        'Part Number': orig?.part_number || '',
        'Description': orig?.description || '',
        'Category': orig?.category_name || '',
        'Original Ship Date': orig?.ship_date || '',
        'New Ship Date': it.new_ship_date || orig?.ship_date || '',
        'Order Qty': orig?.bal_qty || 0,
        'Buyer': orig?.buyer || '',
        'Job Ref': orig?.job_reference || '',
      })
    }

    // 3. Capacity Summary by Category (Requirement 4)
    const summaryRows = []
    for (const cat of categoryCapacitySummary) {
      for (const v of cat.vendorList) {
        summaryRows.push({
          'Category': cat.name,
          'Unit': cat.unit,
          'Vendor Code': v.code,
          'Vendor Name': v.name,
          'Weekly Capacity': v.weeklyCap ?? 'Not Defined',
          'Load Before (Actual)': v.before,
          'Load After (Simulated)': v.after,
          'Net Difference': v.after - v.before,
        })
      }
    }

    const wsCancel = XLSX.utils.json_to_sheet(cancelRows)
    const wsResource = XLSX.utils.json_to_sheet(resourceRows)
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows)

    XLSX.utils.book_append_sheet(wb, wsCancel, 'Cancel List')
    XLSX.utils.book_append_sheet(wb, wsResource, 'Re-source List')
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Capacity by Category')

    const cleanName = activeScenario.name.replace(/[^a-zA-Z0-9_-]/g, '_')
    XLSX.writeFile(wb, `resourcing_action_plan_${cleanName}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // Available candidate target vendors
  const targetVendorOptions = useMemo(() => {
    return master.vendors
      .filter((v) => !v.is_interplant)
      .sort((a, b) => a.vendor_name.localeCompare(b.vendor_name))
  }, [master.vendors])

  return (
    <div className="p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="text-amber-500" />
            Resourcing Simulator (2027+)
          </h1>
          <p className="text-sm text-slate-500">
            Simulate moving purchase orders from Weidmann to alternative suppliers, preview capacity impact by category, and export PO action lists.
          </p>
        </div>

        {/* Scenario Selector & Controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase text-slate-500">Scenario:</label>
            <select
              className="input w-64 font-medium"
              value={activeScenarioId || ''}
              onChange={(e) => {
                setActiveScenarioId(e.target.value || null)
                if (e.target.value) setSimulationActive(true)
              }}
            >
              <option value="">-- Select Scenario --</option>
              {scenarios.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowNewModal(true)}
            className="btn-primary"
            title="Create new simulation scenario"
          >
            <Plus size={16} /> New Scenario
          </button>

          {activeScenario && (
            <>
              <button
                onClick={() => setSimulationActive(!simulationActive)}
                className={`btn px-3 py-2 text-sm font-medium rounded-lg transition flex items-center gap-2 cursor-pointer ${
                  simulationActive
                    ? 'bg-amber-600 text-white hover:bg-amber-700 shadow-sm'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
                title="Toggle simulation mode across the entire dashboard"
              >
                {simulationActive ? <Check size={16} /> : null}
                {simulationActive ? 'Simulation Active' : 'Enable in Dashboard'}
              </button>

              <button
                onClick={handleExportExcel}
                className="btn-outline text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                title="Export 3-sheet Excel with Cancel List, Re-source List, and Category Capacity"
              >
                <Download size={16} /> Export Action Plan
              </button>

              <button
                onClick={() => handleDeleteScenario(activeScenario.id)}
                className="btn-danger p-2"
                title="Delete this scenario"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Scenario Overview Banner */}
      {activeScenario ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-4 border-l-4 border-indigo-500">
            <div className="text-xs text-slate-500">Active Scenario</div>
            <div className="font-bold text-slate-900 text-lg">{activeScenario.name}</div>
            <div className="text-xs text-slate-400 truncate">{activeScenario.description || 'No description'}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-slate-500">Reallocated Lines</div>
            <div className="font-bold text-indigo-600 text-2xl">{fmtNum(summary.count)}</div>
            <div className="text-xs text-slate-400">POs scheduled for resourcing</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-slate-500">Reallocated Quantity</div>
            <div className="font-bold text-emerald-600 text-2xl">{fmtCompact(summary.qty)}</div>
            <div className="text-xs text-slate-400">Bal Qty moved to alternatives</div>
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center bg-slate-50 border-dashed">
          <Sparkles className="mx-auto text-amber-500 mb-2" size={36} />
          <h3 className="font-semibold text-slate-800 text-base">No scenario selected</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mt-1 mb-4">
            Create a new scenario or select an existing one to simulate moving PO lines to other suppliers and balance capacity.
          </p>
          <button onClick={() => setShowNewModal(true)} className="btn-primary">
            <Plus size={16} /> Create First Scenario
          </button>
        </div>
      )}

      {/* Tabs: Reallocation Table vs Capacity Summary by Category (Requirement 4) */}
      {activeScenario && (
        <div className="flex items-center gap-2 border-b border-slate-200">
          <button
            onClick={() => setViewTab('orders')}
            className={`px-4 py-2 font-medium text-sm border-b-2 -mb-px transition cursor-pointer flex items-center gap-2 ${
              viewTab === 'orders'
                ? 'border-indigo-600 text-indigo-700 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers size={16} /> Candidate Orders & Reallocations
          </button>
          <button
            onClick={() => setViewTab('capacity_summary')}
            className={`px-4 py-2 font-medium text-sm border-b-2 -mb-px transition cursor-pointer flex items-center gap-2 ${
              viewTab === 'capacity_summary'
                ? 'border-indigo-600 text-indigo-700 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <BarChart2 size={16} /> Capacity Summary by Category
          </button>
        </div>
      )}

      {/* VIEW TAB 1: ORDERS & REALLOCATION */}
      {activeScenario && viewTab === 'orders' && (
        <>
          {/* Filter and Bulk Action Bar */}
          <div className="card p-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3 justify-between">
              <div className="flex flex-wrap items-end gap-3 flex-1">
                {/* 1. Plant / Division Filter (Requirement 1) */}
                <div className="w-48">
                  <label className="label flex items-center gap-1">
                    <Building2 size={12} /> Plant / Division
                  </label>
                  <select
                    className="input text-sm font-medium"
                    value={plantFilter}
                    onChange={(e) => setPlantFilter(e.target.value)}
                  >
                    <option value="">All Plants</option>
                    {master.divisions.map((d) => (
                      <option key={d.code} value={String(d.code)}>
                        {d.code} – {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Vendor Source Filter */}
                <div className="w-52">
                  <label className="label">Source Vendor</label>
                  <select
                    className="input text-sm"
                    value={vendorFilter}
                    onChange={(e) => setVendorFilter(e.target.value)}
                  >
                    <option value="">All Vendors</option>
                    {master.vendors.map((v) => (
                      <option key={v.vendor_code} value={v.vendor_code}>
                        {v.vendor_name} ({v.vendor_code})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Category Filter */}
                <div className="w-44">
                  <label className="label">Category</label>
                  <select
                    className="input text-sm"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  >
                    <option value="">All Categories</option>
                    {master.categories.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Ship Date Horizon */}
                <div className="w-36">
                  <label className="label">Ship Date From</label>
                  <input
                    type="date"
                    className="input text-sm"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                  />
                </div>

                {/* Status Filter */}
                <div className="w-36">
                  <label className="label">Reallocation</label>
                  <select
                    className="input text-sm"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">All Lines</option>
                    <option value="reallocated">Reallocated</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>

                {/* Search */}
                <div className="w-56">
                  <label className="label">Search</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      className="input pl-8 text-sm"
                      placeholder="PO, Part, Job..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* CSV Import */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={handleCsvUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-outline text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                  title="Import reallocation list (PO Nbr, Itm, New Vendor, New Ship Date)"
                >
                  <Upload size={16} /> Upload CSV
                </button>
              </div>
            </div>

            {/* CSV Feedback Alerts */}
            {csvError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2">
                <AlertTriangle size={16} /> {csvError}
              </div>
            )}
            {csvSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-2">
                <CheckCircle2 size={16} /> {csvSuccess}
              </div>
            )}
            {saveStatus && (
              <div className="text-xs text-indigo-600 font-medium">{saveStatus}</div>
            )}

            {/* Bulk Action Controls */}
            {selectedKeys.size > 0 && (
              <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-amber-50/70 p-3 rounded-lg border border-amber-200">
                <div className="text-sm font-semibold text-amber-900">
                  {selectedKeys.size} line{selectedKeys.size > 1 ? 's' : ''} selected
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-slate-600 uppercase">Move selected to:</span>
                  <select
                    className="input text-sm w-64 bg-white"
                    value={bulkVendor}
                    onChange={(e) => setBulkVendor(e.target.value)}
                  >
                    <option value="">-- Choose Target Supplier --</option>
                    {targetVendorOptions.map((v) => (
                      <option key={v.vendor_code} value={v.vendor_code}>
                        {v.vendor_name} ({v.vendor_code})
                      </option>
                    ))}
                  </select>

                  <input
                    type="date"
                    className="input text-sm w-36 bg-white"
                    placeholder="New Ship Date (optional)"
                    value={bulkShipDate}
                    onChange={(e) => setBulkShipDate(e.target.value)}
                    title="Leave blank to preserve original ship date"
                  />

                  <button
                    onClick={handleBulkReallocate}
                    disabled={!bulkVendor}
                    className="btn-primary"
                  >
                    Apply to Selected
                  </button>

                  <button
                    onClick={handleBulkClear}
                    className="btn-ghost text-red-600 hover:bg-red-50"
                    title="Remove reallocation for selected"
                  >
                    <RotateCcw size={14} /> Clear Selected
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Main Table of Candidate Orders */}
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-800">
                Showing {fmtNum(candidateOrders.length)} open order lines
              </div>
              <div className="text-xs text-slate-500">
                Click column headers like Ship Date to sort. Select rows for bulk reassignments.
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="th w-10">
                      <input
                        type="checkbox"
                        checked={
                          candidateOrders.length > 0 &&
                          candidateOrders.every((o) =>
                            selectedKeys.has(`${String(o.po).trim()}*${String(o.item).trim()}`)
                          )
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            const keys = new Set(
                              candidateOrders.map((o) => `${String(o.po).trim()}*${String(o.item).trim()}`)
                            )
                            setSelectedKeys(keys)
                          } else {
                            setSelectedKeys(new Set())
                          }
                        }}
                      />
                    </th>
                    <th className="th">Plant</th>
                    <th className="th">PO & Item</th>
                    <th className="th">Category</th>
                    <th className="th">Part Number</th>
                    <th className="th">Current Vendor</th>
                    <th className="th text-right">Bal Qty</th>
                    {/* 3. Clickable Sort by Date (Requirement 3) */}
                    <th
                      className="th cursor-pointer hover:bg-slate-100 select-none"
                      onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                      title="Click to sort by ship date"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Orig Ship Date</span>
                        {sortOrder === 'asc' ? (
                          <ArrowUp size={14} className="text-indigo-600" />
                        ) : (
                          <ArrowDown size={14} className="text-indigo-600" />
                        )}
                      </div>
                    </th>
                    <th className="th min-w-[260px] bg-amber-50 text-amber-900 border-l border-amber-200">
                      Simulated Target Supplier
                    </th>
                    <th className="th min-w-[140px] bg-amber-50 text-amber-900">Simulated Ship Date</th>
                    <th className="th w-12 bg-amber-50" />
                  </tr>
                </thead>
                <tbody>
                  {candidateOrders.slice(0, 500).map((o) => {
                    const key = `${String(o.po).trim()}*${String(o.item).trim()}`
                    const isSelected = selectedKeys.has(key)
                    const reallocated = itemMap.get(key)

                    return (
                      <tr
                        key={o.id}
                        className={`hover:bg-slate-50 transition ${
                          reallocated ? 'bg-amber-50/40' : ''
                        } ${isSelected ? 'bg-indigo-50/60' : ''}`}
                      >
                        <td className="td">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const next = new Set(selectedKeys)
                              if (e.target.checked) next.add(key)
                              else next.delete(key)
                              setSelectedKeys(next)
                            }}
                          />
                        </td>
                        {/* Plant / Division column */}
                        <td className="td font-medium text-xs text-slate-700">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-semibold" title={`Division ${o.div}`}>
                            {o.division_name || o.div}
                          </span>
                        </td>
                        <td className="td font-mono font-semibold text-xs">
                          {o.po}*{o.item}
                        </td>
                        <td className="td text-xs">
                          <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium">
                            {o.category_name}
                          </span>
                        </td>
                        <td className="td">
                          <div className="font-mono text-xs font-medium">{o.part_number}</div>
                          <div className="text-[11px] text-slate-500 truncate max-w-48" title={o.description}>
                            {o.description}
                          </div>
                        </td>
                        <td className="td text-xs truncate max-w-44" title={o.supplier_name}>
                          {o.supplier_name}
                        </td>
                        <td className="td text-right font-semibold text-sm">
                          {fmtNum(o.bal_qty)} <span className="text-[10px] text-slate-400 font-normal">{o.unit}</span>
                        </td>
                        <td className="td text-xs font-medium text-slate-700">
                          {fmtDate(o.ship_date)}
                        </td>

                        {/* Simulated Target Supplier Selector */}
                        <td className="td border-l border-amber-200 bg-amber-50/30">
                          <select
                            className={`input py-1 text-xs ${
                              reallocated ? 'border-amber-400 bg-white font-medium text-amber-900' : 'text-slate-500'
                            }`}
                            value={reallocated?.new_vendor || ''}
                            onChange={(e) =>
                              handleReallocateOne(o.po, o.item, e.target.value, reallocated?.new_ship_date || o.ship_date)
                            }
                          >
                            <option value="">-- Keep Current ({o.supplier_name.slice(0, 16)}...) --</option>
                            {targetVendorOptions.map((v) => (
                              <option key={v.vendor_code} value={v.vendor_code}>
                                {v.vendor_name} ({v.vendor_code})
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Simulated Ship Date */}
                        <td className="td bg-amber-50/30">
                          <input
                            type="date"
                            disabled={!reallocated}
                            className="input py-1 text-xs disabled:opacity-40"
                            value={reallocated?.new_ship_date || o.ship_date || ''}
                            onChange={(e) =>
                              handleReallocateOne(o.po, o.item, reallocated.new_vendor, e.target.value)
                            }
                          />
                        </td>

                        {/* Clear Button */}
                        <td className="td bg-amber-50/30">
                          {reallocated && (
                            <button
                              onClick={() => handleReallocateOne(o.po, o.item, '', null)}
                              className="btn-ghost p-1 text-slate-400 hover:text-red-600"
                              title="Revert to original vendor"
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {candidateOrders.length > 500 && (
              <div className="p-3 text-center text-xs text-slate-500 border-t border-slate-200">
                Showing first 500 rows. Use plant and category filters above to narrow results.
              </div>
            )}
          </div>
        </>
      )}

      {/* VIEW TAB 2: CAPACITY SUMMARY BY CATEGORY (Requirement 4) */}
      {activeScenario && viewTab === 'capacity_summary' && (
        <div className="space-y-6">
          <div className="card p-4 bg-indigo-50/50 border-indigo-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-900 text-base">Capacity Impact Breakdown by Category</h3>
              <p className="text-xs text-slate-600">
                Shows the net redistribution of load before vs. after this simulation across each subassembly category and its suppliers.
              </p>
            </div>
            <button
              onClick={handleExportExcel}
              className="btn-outline bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50 text-xs"
            >
              <Download size={14} /> Export to Excel
            </button>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {categoryCapacitySummary.map((cat) => (
              <div key={cat.id} className="card overflow-hidden">
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">{cat.name}</h4>
                    <span className="text-xs text-slate-500">Unit: {cat.unit}</span>
                  </div>
                  {cat.weeklyDemand && (
                    <div className="text-xs font-medium text-purple-700 bg-purple-50 px-2.5 py-1 rounded-md border border-purple-200">
                      Weekly Demand: {fmtNum(cat.weeklyDemand)} {cat.unit}
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr>
                        <th className="th">Supplier</th>
                        <th className="th text-right">Weekly Capacity</th>
                        <th className="th text-right">Original Load (Actual)</th>
                        <th className="th text-right bg-amber-50/60 text-amber-900">Simulated Load (After)</th>
                        <th className="th text-right">Net Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.vendorList.map((v) => {
                        const diff = v.after - v.before
                        return (
                          <tr key={v.code} className="hover:bg-slate-50 transition border-b border-slate-100">
                            <td className="td font-medium text-slate-800">
                              {v.name}{' '}
                              <span className="text-[10px] text-slate-400 font-mono">({v.code})</span>
                            </td>
                            <td className="td text-right text-slate-600 font-medium">
                              {v.weeklyCap ? fmtNum(v.weeklyCap) : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="td text-right text-slate-600">
                              {fmtNum(v.before)}
                            </td>
                            <td className="td text-right font-bold text-slate-900 bg-amber-50/30">
                              {fmtNum(v.after)}
                            </td>
                            <td className="td text-right font-semibold">
                              {diff > 0 ? (
                                <span className="text-emerald-700">+{fmtNum(diff)}</span>
                              ) : diff < 0 ? (
                                <span className="text-red-600">{fmtNum(diff)}</span>
                              ) : (
                                <span className="text-slate-400">0</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Scenario Modal */}
      {showNewModal && (
        <Modal onClose={() => setShowNewModal(false)} title="Create New Simulation Scenario">
          <div className="p-6 space-y-4">
            <div>
              <label className="label">Scenario Name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Weidmann Resourcing 2027 - Option A"
                value={newScenarioName}
                onChange={(e) => setNewScenarioName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="label">Description / Goal</label>
              <textarea
                className="input"
                rows={3}
                placeholder="e.g. Move all 2027 Weidmann Key Spacers to Enpay & Transvick without exceeding 80% weekly capacity."
                value={newScenarioDesc}
                onChange={(e) => setNewScenarioDesc(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <button className="btn-ghost" onClick={() => setShowNewModal(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={!newScenarioName.trim()}
                onClick={handleCreateScenario}
              >
                Create Scenario
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
