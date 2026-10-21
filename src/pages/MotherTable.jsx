import { Settings as SettingsIcon } from 'lucide-react'
import { useData } from '../lib/DataContext'
import { fmtNum, SUPPLIER_COLORS } from '../lib/format'

/** Read-only reference view of the mother table (categories, prefixes, supplier capacities). */
export default function MotherTable() {
  const { master, lookups } = useData()

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mother Table</h1>
          <p className="text-sm text-slate-500">Part categories, part-number prefixes (first 4 characters) and weekly supplier capacity</p>
        </div>
        <a href="#/settings" className="btn-outline"><SettingsIcon size={16} /> Edit in Settings</a>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th w-56">Part Category</th>
              <th className="th">Prefixes</th>
              <th className="th text-right w-36">Weekly Demand</th>
              <th className="th w-[38%]">Suppliers · Weekly Capacity</th>
            </tr>
          </thead>
          <tbody>
            {master.categories.map((c) => {
              const prefixes = master.prefixes.filter((p) => p.category_id === c.id)
              const caps = master.capacities.filter((x) => x.category_id === c.id)
                .sort((a, b) => (b.weekly_capacity ?? 0) - (a.weekly_capacity ?? 0))
              const totalCap = caps.reduce((s, x) => s + (Number(x.weekly_capacity) || 0), 0)
              const max = Math.max(...caps.map((x) => Number(x.weekly_capacity) || 0), 1)
              const demand = Number(c.weekly_demand) || 0
              return (
                <tr key={c.id} className="align-top">
                  <td className="td whitespace-normal">
                    <div className="font-semibold text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500">Unit: {c.unit}</div>
                  </td>
                  <td className="td whitespace-normal">
                    {prefixes.length ? (
                      <div className="flex flex-wrap gap-1">
                        {prefixes.map((p) => <span key={p.prefix} className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono text-xs">{p.prefix}</span>)}
                      </div>
                    ) : <span className="text-xs text-amber-600">No prefixes yet</span>}
                  </td>
                  <td className="td text-right font-semibold">{demand ? fmtNum(demand) : <span className="text-slate-300">—</span>}</td>
                  <td className="td whitespace-normal">
                    {caps.length ? (
                      <div className="space-y-1.5">
                        {caps.map((x, i) => {
                          const v = Number(x.weekly_capacity) || 0
                          return (
                            <div key={x.id} className="flex items-center gap-2 text-xs">
                              <span className="w-56 truncate" title={`${lookups.vendorByCode[x.vendor_code]?.vendor_name} (${x.vendor_code})`}>
                                {lookups.vendorByCode[x.vendor_code]?.vendor_name ?? x.vendor_code}
                              </span>
                              <div className="flex-1 h-3 rounded bg-slate-100 overflow-hidden">
                                <div className="h-full rounded" style={{ width: `${(v / max) * 100}%`, background: SUPPLIER_COLORS[i % SUPPLIER_COLORS.length] }} />
                              </div>
                              <span className="w-20 text-right font-medium">{x.weekly_capacity != null ? fmtNum(v) : <span className="text-slate-400">n/a</span>}</span>
                            </div>
                          )
                        })}
                        <div className="flex justify-between text-xs border-t border-slate-200 pt-1.5 font-semibold">
                          <span>Total capacity</span>
                          <span className={demand && totalCap < demand ? 'text-red-600' : 'text-slate-900'}>
                            {fmtNum(totalCap)} {c.unit}/wk{demand ? ` · ${Math.round((totalCap / demand) * 100)}% of demand` : ''}
                          </span>
                        </div>
                      </div>
                    ) : <span className="text-xs text-slate-400">No suppliers defined</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
