import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { loadCurrentUpload, loadMaster, loadMonitoredOrders } from './api'

const DataContext = createContext(null)

export function DataProvider({ children }) {
  const [master, setMaster] = useState(null)
  const [orders, setOrders] = useState([])
  const [upload, setUpload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reloadMaster = useCallback(async () => setMaster(await loadMaster()), [])
  const reloadOrders = useCallback(async () => {
    const [o, u] = await Promise.all([loadMonitoredOrders(), loadCurrentUpload()])
    setOrders(o); setUpload(u)
  }, [])
  const reloadAll = useCallback(async () => {
    setLoading(true); setError(null)
    try { await Promise.all([reloadMaster(), reloadOrders()]) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [reloadMaster, reloadOrders])

  useEffect(() => { reloadAll() }, [reloadAll])

  // Convenience lookups
  const lookups = useMemo(() => {
    if (!master) return null
    const vendorByCode = Object.fromEntries(master.vendors.map((v) => [v.vendor_code, v]))
    const categoryById = Object.fromEntries(master.categories.map((c) => [c.id, c]))
    const categoryByPrefix = Object.fromEntries(master.prefixes.map((p) => [p.prefix, categoryById[p.category_id]]))
    return { vendorByCode, categoryById, categoryByPrefix }
  }, [master])

  const value = { master, lookups, orders, upload, loading, error, reloadAll, reloadMaster, reloadOrders }
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export const useData = () => useContext(DataContext)
