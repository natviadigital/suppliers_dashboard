import { useMemo, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { useData } from '../lib/DataContext'
import FilterBar from '../components/FilterBar'
import OrderLinesTable from '../components/OrderLinesTable'
import { applyFilters } from '../lib/aggregate'
import { fmtNum } from '../lib/format'
import { exportOrdersToExcel } from '../lib/exportOrders'

const PAGE = 200

export default function OpenOrders({ filters, setFilters }) {
  const { orders, lookups } = useData()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

  const rows = useMemo(() => {
    const s = q.trim().toUpperCase()
    return applyFilters(orders, filters)
      .filter((o) => !s || [o.po, o.part_number, o.description, o.supplier_name, o.prefix].some((v) => String(v ?? '').toUpperCase().includes(s)))
      .sort((a, b) => (a.ship_date ?? '').localeCompare(b.ship_date ?? '') || String(a.po).localeCompare(String(b.po)))
  }, [orders, filters, q])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const current = Math.min(page, pages - 1)
  const total = rows.reduce((s, o) => s + (Number(o.bal_qty) || 0), 0)

  const exportXlsx = () => {
    exportOrdersToExcel({
      orders: rows,
      fileName: `monitored_open_orders_${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Monitored Open Orders',
      lookups,
    })
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Open Orders</h1>
          <p className="text-sm text-slate-500">Monitored lines only (classified prefixes, inter-plant excluded, balance &gt; 0)</p>
        </div>
        <button className="btn-outline" onClick={exportXlsx} disabled={!rows.length}><Download size={16} /> Export to Excel</button>
      </div>

      <FilterBar filters={filters} setFilters={(f) => { setFilters(f); setPage(0) }} />

      <div className="card">
        <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
          <div className="relative w-80">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input className="input pl-9" placeholder="Search PO, part number, description, supplier…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
          </div>
          <div className="text-sm text-slate-600">{fmtNum(rows.length)} lines · Bal qty {fmtNum(total)}</div>
        </div>
        <div className="overflow-auto max-h-[65vh]">
          <OrderLinesTable lines={rows.slice(current * PAGE, (current + 1) * PAGE)} />
        </div>
        {pages > 1 && (
          <div className="p-3 flex items-center justify-end gap-2 text-sm border-t border-slate-200">
            <button className="btn-ghost" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
            <span>Page {current + 1} of {pages}</span>
            <button className="btn-ghost" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
