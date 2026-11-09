import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { loadCurrentUpload, loadMaster, loadMonitoredOrders, loadRawOpenOrders, loadScenarios, loadScenarioItems } from './api'
import { loadSupplierHolidays, saveSupplierHolidays, buildHolidayLookup } from './holidays'
import { loadCapStatusMap, saveCapStatusMap, resolveCapStatus, loadTdlItems, saveTdlItems } from './capStatusAndTdl'
import { loadHistoryCubes } from './historyApi'

const DataContext = createContext(null)

export function DataProvider({ children }) {
  const [master, setMaster] = useState(null)
  const [orders, setOrders] = useState([])
  const [rawOrders, setRawOrders] = useState([]) // all orders (for simulator & action plan)
  const [upload, setUpload] = useState(null)
  const [scenarios, setScenarios] = useState([])
  const [activeScenarioId, setActiveScenarioId] = useState(null)
  const [scenarioItems, setScenarioItems] = useState([])
  const [simulationActive, setSimulationActive] = useState(false)
  const [holidays, setHolidays] = useState(() => loadSupplierHolidays())
  const [capStatusMap, setCapStatusMap] = useState(() => loadCapStatusMap())
  const [tdlItems, setTdlItems] = useState([])
  const [receiptsCube, setReceiptsCube] = useState(null)
  const [transactionsCube, setTransactionsCube] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const updateHolidays = useCallback((nextHolidays) => {
    setHolidays(nextHolidays)
    saveSupplierHolidays(nextHolidays)
  }, [])

  const setSupplierCapStatus = useCallback((categoryId, vendorCode, nextStatus) => {
    setCapStatusMap((prev) => {
      const next = { ...prev, [`${categoryId}_${vendorCode}`]: nextStatus }
      saveCapStatusMap(next)
      return next
    })
  }, [])

  const toggleSupplierCapStatus = useCallback((categoryId, vendorCode, weeklyCap) => {
    setCapStatusMap((prev) => {
      const current = resolveCapStatus(prev, categoryId, vendorCode, weeklyCap)
      const nextStatus = current === 'confirmed' ? 'pending' : 'confirmed'
      const next = { ...prev, [`${categoryId}_${vendorCode}`]: nextStatus }
      saveCapStatusMap(next)
      return next
    })
  }, [])

  const updateTdlItems = useCallback((nextItems) => {
    setTdlItems(nextItems)
    saveTdlItems(nextItems)
  }, [])

  useEffect(() => {
    loadTdlItems().then(setTdlItems).catch(() => {})
  }, [])

  const reloadHistory = useCallback(async () => {
    try {
      const { receiptsCube: rc, transactionsCube: tc } = await loadHistoryCubes()
      setReceiptsCube(rc)
      setTransactionsCube(tc)
    } catch {}
  }, [])

  useEffect(() => {
    reloadHistory()
  }, [reloadHistory])

  const holidayLookup = useMemo(() => buildHolidayLookup(holidays), [holidays])

  const reloadMaster = useCallback(async () => setMaster(await loadMaster()), [])
  const reloadOrders = useCallback(async () => {
    const [o, raw, u] = await Promise.all([
      loadMonitoredOrders(),
      loadRawOpenOrders(),
      loadCurrentUpload(),
    ])
    setOrders(o)
    setRawOrders(raw)
    setUpload(u)
  }, [])
  const reloadScenarios = useCallback(async () => {
    const sc = await loadScenarios()
    setScenarios(sc)
  }, [])

  const reloadAll = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      await Promise.all([reloadMaster(), reloadOrders(), reloadScenarios()])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [reloadMaster, reloadOrders, reloadScenarios])

  useEffect(() => { reloadAll() }, [reloadAll])

  // When active scenario changes, load its items
  useEffect(() => {
    if (!activeScenarioId) {
      setScenarioItems([])
      return
    }
    let cancelled = false
    loadScenarioItems(activeScenarioId).then((items) => {
      if (!cancelled) setScenarioItems(items || [])
    }).catch(() => {
      if (!cancelled) setScenarioItems([])
    })
    return () => { cancelled = true }
  }, [activeScenarioId])

  // Convenience lookups
  const lookups = useMemo(() => {
    if (!master) return null
    const vendorByCode = Object.fromEntries(master.vendors.map((v) => [v.vendor_code, v]))
    const categoryById = Object.fromEntries(master.categories.map((c) => [c.id, c]))
    const categoryByPrefix = Object.fromEntries(master.prefixes.map((p) => [p.prefix, categoryById[p.category_id]]))
    const divisionByCode = Object.fromEntries(master.divisions.map((d) => [d.code, d.name]))
    return { vendorByCode, categoryById, categoryByPrefix, divisionByCode }
  }, [master])

  // Active scenario map: key `${po}_${item}` -> item
  const scenarioItemMap = useMemo(() => {
    const map = new Map()
    for (const it of scenarioItems) {
      map.set(`${String(it.po).trim()}*${String(it.item).trim()}`, it)
    }
    return map
  }, [scenarioItems])

  // Simulated orders: when simulation is active, replace vendor & ship_date with simulated values
  const simulatedOrders = useMemo(() => {
    if (!simulationActive || !scenarioItemMap.size) return orders
    return orders.map((o) => {
      const key = `${String(o.po).trim()}*${String(o.item).trim()}`
      const match = scenarioItemMap.get(key)
      if (!match) return o
      const newVendorCode = match.new_vendor
      const newVendorName = lookups?.vendorByCode[newVendorCode]?.vendor_name || o.vendor_name
      return {
        ...o,
        _simulated: true,
        _orig_vendor_code: o.vendor_code,
        _orig_vendor_name: o.supplier_name,
        _orig_ship_date: o.ship_date,
        vendor_code: newVendorCode,
        supplier_name: newVendorName,
        ship_date: match.new_ship_date || o.ship_date,
      }
    })
  }, [orders, simulationActive, scenarioItemMap, lookups])

  const activeScenario = useMemo(() =>
    scenarios.find((s) => s.id === activeScenarioId) || null,
  [scenarios, activeScenarioId])

  const value = {
    master,
    lookups,
    orders, // monitored orders (for capacity dashboard)
    rawOrders, // all orders (for simulator & full action plan)
    simulatedOrders, // orders with simulation applied (or actual if inactive)
    upload,
    scenarios,
    activeScenario,
    activeScenarioId,
    setActiveScenarioId,
    scenarioItems,
    setScenarioItems,
    scenarioItemMap,
    simulationActive,
    setSimulationActive,
    holidays,
    holidayLookup,
    updateHolidays,
    capStatusMap,
    setSupplierCapStatus,
    toggleSupplierCapStatus,
    tdlItems,
    updateTdlItems,
    receiptsCube,
    setReceiptsCube,
    transactionsCube,
    setTransactionsCube,
    reloadHistory,
    loading,
    error,
    reloadAll,
    reloadMaster,
    reloadOrders,
    reloadScenarios,
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export const useData = () => useContext(DataContext)
