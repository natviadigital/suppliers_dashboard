import { useMemo } from 'react'
import { X } from 'lucide-react'
import { useData } from '../lib/DataContext'

/** Global filters: Division, Supplier, Category, Buyer */
export default function FilterBar({ filters, setFilters }) {
  const { master, orders, lookups } = useData()

  const options = useMemo(() => {
    const suppliers = new Map()
    orders.forEach((o) => suppliers.set(o.vendor_code, o.supplier_name))
    master.capacities.forEach((c) => suppliers.set(c.vendor_code, lookups.vendorByCode[c.vendor_code]?.vendor_name ?? c.vendor_code))
    const buyers = [...new Set(orders.map((o) => String(o.buyer ?? '')).filter(Boolean))].sort()
    return {
      divisions: master.divisions.map((d) => [String(d.code), `${d.code} – ${d.name}`]),
      suppliers: [...suppliers.entries()].sort((a, b) => a[1].localeCompare(b[1])),
      categories: master.categories.map((c) => [String(c.id), c.name]),
      buyers: buyers.map((b) => [b, b]),
    }
  }, [master, orders, lookups])

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value })
  const active = Object.values(filters).some(Boolean)

  const Select = ({ k, label, opts }) => (
    <div className="min-w-0 flex-1">
      <label className="label">{label}</label>
      <select className="input" value={filters[k]} onChange={set(k)}>
        <option value="">All</option>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )

  return (
    <div className="card p-4 flex flex-wrap gap-4 items-end">
      <Select k="division" label="Division" opts={options.divisions} />
      <Select k="supplier" label="Supplier" opts={options.suppliers} />
      <Select k="category" label="Category" opts={options.categories} />
      <Select k="buyer" label="Buyer" opts={options.buyers} />
      {active && (
        <button className="btn-ghost" onClick={() => setFilters({ division: '', supplier: '', category: '', buyer: '' })}>
          <X size={16} /> Clear
        </button>
      )}
    </div>
  )
}
