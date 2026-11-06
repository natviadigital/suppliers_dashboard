import { useEffect, useMemo, useState } from 'react'
import { Plus, Save, Trash2, Search, Loader2, CalendarOff, RotateCcw, CheckCircle2, Clock3 } from 'lucide-react'
import { useData } from '../lib/DataContext'
import { insertRow, updateRow, deleteRow, loadPrefixSummary } from '../lib/api'
import { fmtNum } from '../lib/format'
import { DEFAULT_SUPPLIER_HOLIDAYS, formatHolidayWeeks } from '../lib/holidays'
import { resolveCapStatus } from '../lib/capStatusAndTdl'

const TABS = [
  ['capacity', 'Supplier Capacity'],
  ['holidays', 'Supplier Holidays'],
  ['prefixes', 'Prefixes'],
  ['categories', 'Categories'],
  ['vendors', 'Vendors'],
]

/** Runs a DB action, reports errors, reloads data afterwards. */
function useAction() {
  const { reloadMaster, reloadOrders } = useData()
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = async (fn, { orders = false } = {}) => {
    setBusy(true); setError(null)
    try {
      await fn()
      await Promise.all([reloadMaster(), orders ? reloadOrders() : null])
      return true
    } catch (e) { setError(e.message); return false }
    finally { setBusy(false) }
  }
  return { run, error, busy, clear: () => setError(null) }
}

export default function Settings() {
  const [tab, setTab] = useState('capacity')
  const action = useAction()
  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Maintain the mother table: categories, prefixes, supplier capacity and vendors</p>
      </div>
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); action.clear() }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px cursor-pointer ${tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {label}
          </button>
        ))}
        {action.busy && <Loader2 size={16} className="animate-spin text-slate-400 self-center ml-2" />}
      </div>
      {action.error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">{action.error}</div>}
      {tab === 'capacity' && <CapacityTab action={action} />}
      {tab === 'holidays' && <HolidaysTab />}
      {tab === 'prefixes' && <PrefixesTab action={action} />}
      {tab === 'categories' && <CategoriesTab action={action} />}
      {tab === 'vendors' && <VendorsTab action={action} />}
    </div>
  )
}

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
const confirmDelete = (what) => window.confirm(`Delete ${what}? This cannot be undone.`)

// ---------------------------------------------------------------- Supplier Holidays
function HolidaysTab() {
  const { master, lookups, holidays, updateHolidays } = useData()
  const [vendorFilter, setVendorFilter] = useState('')
  const [draft, setDraft] = useState({
    vendor_code: '12123',
    holiday_name: '',
    start_date: '',
    end_date: '',
    total_days: '',
  })

  const filteredHolidays = useMemo(() => {
    return (holidays || [])
      .filter((h) => !vendorFilter || h.vendor_code === vendorFilter)
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
  }, [holidays, vendorFilter])

  const handleAdd = () => {
    if (!draft.vendor_code || !draft.holiday_name.trim() || !draft.start_date) return
    const end = draft.end_date || draft.start_date
    const d1 = new Date(draft.start_date + 'T00:00:00')
    const d2 = new Date(end + 'T00:00:00')
    const calcDays = Math.max(1, Math.round((d2 - d1) / 86400000) + 1)
    const newHoliday = {
      id: `hol-${Date.now()}`,
      vendor_code: draft.vendor_code,
      holiday_name: draft.holiday_name.trim(),
      start_date: draft.start_date,
      end_date: end,
      total_days: Number(draft.total_days) || calcDays,
    }
    updateHolidays([...(holidays || []), newHoliday])
    setDraft({ ...draft, holiday_name: '', start_date: '', end_date: '', total_days: '' })
  }

  const handleRemove = (id) => {
    if (!confirmDelete('this holiday period')) return
    updateHolidays((holidays || []).filter((h) => h.id !== id))
  }

  const handleResetDefaults = () => {
    if (!window.confirm('Restore default Liaoning XD 2027 holiday schedule?')) return
    updateHolidays(DEFAULT_SUPPLIER_HOLIDAYS)
  }

  return (
    <div className="card">
      <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-rose-50 text-rose-600">
            <CalendarOff size={20} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Supplier Holiday &amp; Blackout Weeks</h3>
            <p className="text-xs text-slate-500">
              Weeks overlapped by a supplier holiday are blocked (0 weekly capacity) on the Dashboard chart and heatmap.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input w-64 text-xs"
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
          >
            <option value="">All Suppliers ({holidays?.length || 0} holidays)</option>
            {master.vendors
              .filter((v) => !v.is_interplant)
              .map((v) => (
                <option key={v.vendor_code} value={v.vendor_code}>
                  {v.vendor_name} ({v.vendor_code})
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={handleResetDefaults}
            className="btn-outline text-xs px-2.5 py-1.5 flex items-center gap-1 cursor-pointer"
            title="Restore default Liaoning 2027 holidays"
          >
            <RotateCcw size={13} /> Restore Defaults
          </button>
        </div>
      </div>

      <table className="w-full">
        <thead>
          <tr>
            <th className="th">Supplier</th>
            <th className="th">Holiday Name</th>
            <th className="th">Start Date</th>
            <th className="th">End Date</th>
            <th className="th text-center">Total Days</th>
            <th className="th">Blocked ISO Week(s)</th>
            <th className="th w-20" />
          </tr>
        </thead>
        <tbody>
          {filteredHolidays.map((h) => {
            const wks = formatHolidayWeeks(h.start_date, h.end_date)
            const vName = lookups.vendorByCode[h.vendor_code]?.vendor_name || h.vendor_code
            return (
              <tr key={h.id}>
                <td className="td">
                  <div className="font-medium text-slate-800 text-xs">{vName}</div>
                  <div className="font-mono text-[11px] text-slate-400">{h.vendor_code}</div>
                </td>
                <td className="td font-semibold text-slate-900">{h.holiday_name}</td>
                <td className="td font-mono text-xs">{h.start_date}</td>
                <td className="td font-mono text-xs">{h.end_date}</td>
                <td className="td text-center font-mono text-xs">{h.total_days} days</td>
                <td className="td">
                  <div className="flex flex-wrap gap-1">
                    {wks.map((w) => (
                      <span
                        key={w.monday}
                        className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-mono text-xs font-semibold"
                        title={`Monday ${w.monday}`}
                      >
                        {w.year}-{w.label} ({w.monday.slice(5)})
                      </span>
                    ))}
                  </div>
                </td>
                <td className="td text-right">
                  <button
                    type="button"
                    className="btn-danger p-1.5"
                    title="Delete holiday"
                    onClick={() => handleRemove(h.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            )
          })}
          <tr className="bg-slate-50">
            <td className="td">
              <select
                className="input text-xs"
                value={draft.vendor_code}
                onChange={(e) => setDraft({ ...draft, vendor_code: e.target.value })}
              >
                <option value="">Select supplier…</option>
                {master.vendors
                  .filter((v) => !v.is_interplant)
                  .map((v) => (
                    <option key={v.vendor_code} value={v.vendor_code}>
                      {v.vendor_name} ({v.vendor_code})
                    </option>
                  ))}
              </select>
            </td>
            <td className="td">
              <input
                className="input text-xs"
                placeholder="e.g. Spring Festival"
                value={draft.holiday_name}
                onChange={(e) => setDraft({ ...draft, holiday_name: e.target.value })}
              />
            </td>
            <td className="td">
              <input
                type="date"
                className="input text-xs font-mono"
                value={draft.start_date}
                onChange={(e) => setDraft({ ...draft, start_date: e.target.value, end_date: draft.end_date || e.target.value })}
              />
            </td>
            <td className="td">
              <input
                type="date"
                className="input text-xs font-mono"
                value={draft.end_date}
                onChange={(e) => setDraft({ ...draft, end_date: e.target.value })}
              />
            </td>
            <td className="td">
              <input
                type="number"
                min="1"
                className="input text-xs text-center"
                placeholder="Auto"
                value={draft.total_days}
                onChange={(e) => setDraft({ ...draft, total_days: e.target.value })}
              />
            </td>
            <td className="td text-xs text-slate-400">Auto-calculated from dates</td>
            <td className="td text-right">
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={!draft.vendor_code || !draft.holiday_name.trim() || !draft.start_date}
                onClick={handleAdd}
              >
                <Plus size={15} /> Add
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- Capacity
function CapacityTab({ action }) {
  const { master, lookups, capStatusMap, toggleSupplierCapStatus } = useData()
  const [catId, setCatId] = useState(master.categories[0]?.id)
  const [newVendor, setNewVendor] = useState('')
  const [newCap, setNewCap] = useState('')
  const cat = lookups.categoryById[catId]
  const rows = master.capacities.filter((c) => c.category_id === catId)
  const used = new Set(rows.map((r) => r.vendor_code))
  const available = master.vendors.filter((v) => !v.is_interplant && !used.has(v.vendor_code))
  const total = rows.reduce((s, r) => s + (Number(r.weekly_capacity) || 0), 0)

  const add = async () => {
    if (!newVendor) return
    const ok = await action.run(() => insertRow('supplier_capacities', { category_id: catId, vendor_code: newVendor, weekly_capacity: numOrNull(newCap) }))
    if (ok) { setNewVendor(''); setNewCap('') }
  }

  return (
    <div className="card">
      <div className="p-4 flex flex-wrap items-end gap-4 border-b border-slate-200">
        <div className="w-72">
          <label className="label">Category</label>
          <select className="input" value={catId} onChange={(e) => setCatId(Number(e.target.value))}>
            {master.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="text-sm text-slate-600 pb-2">
          Total capacity: <b>{fmtNum(total)}</b> {cat?.unit}/week
          {cat?.weekly_demand ? <> · Weekly demand: <b>{fmtNum(cat.weekly_demand)}</b></> : null}
        </div>
      </div>
      <table className="w-full">
        <thead><tr><th className="th">Vendor code</th><th className="th">Supplier</th><th className="th w-48">Weekly capacity ({cat?.unit})</th><th className="th text-center w-36">Cap status</th><th className="th w-28" /></tr></thead>
        <tbody>
          {rows.map((r) => {
            const status = resolveCapStatus(capStatusMap, catId, r.vendor_code, r.weekly_capacity)
            const isConfirmed = status === 'confirmed'
            return (
              <EditRow key={r.id} row={r} fields={['weekly_capacity']}
                onSave={(d) => action.run(() => updateRow('supplier_capacities', { id: r.id }, { weekly_capacity: numOrNull(d.weekly_capacity) }))}
                onDelete={() => confirmDelete('this supplier from the category') && action.run(() => deleteRow('supplier_capacities', { id: r.id }))}>
                {(d, set) => (<>
                  <td className="td font-mono text-xs">{r.vendor_code}</td>
                  <td className="td">{lookups.vendorByCode[r.vendor_code]?.vendor_name}</td>
                  <td className="td"><input type="number" step="any" min="0" className="input" value={d.weekly_capacity ?? ''} onChange={(e) => set('weekly_capacity', e.target.value)} placeholder="Not defined" /></td>
                  <td className="td text-center">
                    <button
                      type="button"
                      onClick={() => toggleSupplierCapStatus(catId, r.vendor_code, r.weekly_capacity)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition cursor-pointer ${
                        isConfirmed
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                      }`}
                    >
                      {isConfirmed ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}
                      {isConfirmed ? 'Confirmed' : 'Pending'}
                    </button>
                  </td>
                </>)}
              </EditRow>
            )
          })}
          <tr className="bg-slate-50">
            <td className="td" colSpan={2}>
              <select className="input" value={newVendor} onChange={(e) => setNewVendor(e.target.value)}>
                <option value="">+ Add supplier…</option>
                {available.map((v) => <option key={v.vendor_code} value={v.vendor_code}>{v.vendor_name} ({v.vendor_code})</option>)}
              </select>
            </td>
            <td className="td"><input type="number" step="any" min="0" className="input" value={newCap} onChange={(e) => setNewCap(e.target.value)} placeholder="Weekly capacity" /></td>
            <td className="td text-center text-xs text-slate-400">Auto</td>
            <td className="td"><button className="btn-primary" disabled={!newVendor || action.busy} onClick={add}><Plus size={16} /> Add</button></td>
          </tr>
        </tbody>
      </table>
      <p className="p-4 text-xs text-slate-500">Supplier not in the list? Add it first in the <b>Vendors</b> tab.</p>
    </div>
  )
}

// ---------------------------------------------------------------- Prefixes
function PrefixesTab({ action }) {
  const { master, upload } = useData()
  const [prefix, setPrefix] = useState('')
  const [catId, setCatId] = useState('')
  const [q, setQ] = useState('')
  const [summary, setSummary] = useState(null)

  useEffect(() => { if (upload) loadPrefixSummary().then(setSummary).catch(() => setSummary([])) }, [upload, master.prefixes])

  const p = prefix.trim().toUpperCase()
  const exists = master.prefixes.find((x) => x.prefix === p)
  const valid = p.length === 4 && catId && !exists

  const add = async (pre, cat) => {
    const ok = await action.run(() => insertRow('category_prefixes', { prefix: pre, category_id: Number(cat) }), { orders: true })
    if (ok) { setPrefix(''); }
  }

  const list = master.prefixes.filter((x) => !q || x.prefix.includes(q.toUpperCase()))
  const unclassified = (summary ?? []).filter((s) => !s.category_id)

  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <div className="card">
        <div className="p-4 border-b border-slate-200 space-y-3">
          <div className="flex gap-2 items-end">
            <div className="w-28">
              <label className="label">Prefix</label>
              <input className="input font-mono uppercase" maxLength={4} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="12XX" />
            </div>
            <div className="flex-1">
              <label className="label">Category</label>
              <select className="input" value={catId} onChange={(e) => setCatId(e.target.value)}>
                <option value="">Select…</option>
                {master.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={!valid || action.busy} onClick={() => add(p, catId)}><Plus size={16} /> Add</button>
          </div>
          {exists && <p className="text-xs text-amber-700">{p} already belongs to another category — change it in the list below.</p>}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input className="input pl-9" placeholder="Search prefix…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0"><tr><th className="th">Prefix</th><th className="th">Category</th><th className="th w-12" /></tr></thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.prefix}>
                  <td className="td font-mono">{x.prefix}</td>
                  <td className="td">
                    <select className="input py-1" value={x.category_id}
                      onChange={(e) => action.run(() => updateRow('category_prefixes', { prefix: x.prefix }, { category_id: Number(e.target.value) }), { orders: true })}>
                      {master.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td className="td"><button className="btn-danger p-1.5" onClick={() => confirmDelete(`prefix ${x.prefix}`) && action.run(() => deleteRow('category_prefixes', { prefix: x.prefix }), { orders: true })}><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800">Prefixes in current file not in the mother table</h3>
          <p className="text-xs text-slate-500">These lines are currently ignored. Assign a category to start monitoring them (inter-plant orders excluded).</p>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          {!upload ? <p className="p-4 text-sm text-slate-500">Upload an open order file first.</p> : summary === null ? <p className="p-4 text-sm text-slate-500">Loading…</p> : (
            <table className="w-full">
              <thead className="sticky top-0"><tr><th className="th">Prefix</th><th className="th">Sample description</th><th className="th text-right">Lines</th><th className="th">Assign</th></tr></thead>
              <tbody>
                {unclassified.map((s) => (
                  <tr key={s.prefix}>
                    <td className="td font-mono">{s.prefix}</td>
                    <td className="td max-w-48 truncate text-slate-500" title={s.sample_description}>{s.sample_description}</td>
                    <td className="td text-right">{fmtNum(s.lines)}</td>
                    <td className="td">
                      <select className="input py-1" value="" disabled={s.prefix.length !== 4} onChange={(e) => e.target.value && add(s.prefix, e.target.value)}>
                        <option value="">Ignore</option>
                        {master.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Categories
function CategoriesTab({ action }) {
  const { master } = useData()
  const [draft, setDraft] = useState({ name: '', unit: 'pcs', weekly_demand: '', sort_order: '' })
  const add = async () => {
    const ok = await action.run(() => insertRow('categories', {
      name: draft.name.trim(), unit: draft.unit.trim() || 'pcs', weekly_demand: numOrNull(draft.weekly_demand),
      sort_order: numOrNull(draft.sort_order) ?? master.categories.length + 1,
    }))
    if (ok) setDraft({ name: '', unit: 'pcs', weekly_demand: '', sort_order: '' })
  }
  return (
    <div className="card">
      <table className="w-full">
        <thead><tr><th className="th">Name</th><th className="th w-32">Unit</th><th className="th w-44">Weekly demand</th><th className="th w-28">Order</th><th className="th w-28" /></tr></thead>
        <tbody>
          {master.categories.map((c) => (
            <EditRow key={c.id} row={c} fields={['name', 'unit', 'weekly_demand', 'sort_order']}
              onSave={(d) => action.run(() => updateRow('categories', { id: c.id }, { name: d.name.trim(), unit: d.unit.trim(), weekly_demand: numOrNull(d.weekly_demand), sort_order: numOrNull(d.sort_order) ?? 0 }))}
              onDelete={() => confirmDelete(`category "${c.name}" and all its prefixes and capacities`) && action.run(() => deleteRow('categories', { id: c.id }), { orders: true })}>
              {(d, set) => (<>
                <td className="td"><input className="input" value={d.name} onChange={(e) => set('name', e.target.value)} /></td>
                <td className="td"><input className="input" value={d.unit} onChange={(e) => set('unit', e.target.value)} /></td>
                <td className="td"><input type="number" step="any" className="input" value={d.weekly_demand ?? ''} onChange={(e) => set('weekly_demand', e.target.value)} placeholder="—" /></td>
                <td className="td"><input type="number" className="input" value={d.sort_order ?? ''} onChange={(e) => set('sort_order', e.target.value)} /></td>
              </>)}
            </EditRow>
          ))}
          <tr className="bg-slate-50">
            <td className="td"><input className="input" placeholder="New category name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
            <td className="td"><input className="input" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} /></td>
            <td className="td"><input type="number" step="any" className="input" value={draft.weekly_demand} onChange={(e) => setDraft({ ...draft, weekly_demand: e.target.value })} /></td>
            <td className="td"><input type="number" className="input" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} /></td>
            <td className="td"><button className="btn-primary" disabled={!draft.name.trim() || action.busy} onClick={add}><Plus size={16} /> Add</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- Vendors
function VendorsTab({ action }) {
  const { master } = useData()
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState({ vendor_code: '', vendor_name: '', is_interplant: false })
  const list = useMemo(() => master.vendors.filter((v) => !q || `${v.vendor_code} ${v.vendor_name}`.toUpperCase().includes(q.toUpperCase())), [master.vendors, q])
  const add = async () => {
    const ok = await action.run(() => insertRow('vendors', { vendor_code: draft.vendor_code.trim(), vendor_name: draft.vendor_name.trim(), is_interplant: draft.is_interplant }), { orders: true })
    if (ok) setDraft({ vendor_code: '', vendor_name: '', is_interplant: false })
  }
  return (
    <div className="card">
      <div className="p-4 border-b border-slate-200 flex flex-wrap gap-3 items-center justify-between">
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input className="input pl-9" placeholder="Search vendor…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="text-xs text-slate-500">Vendor code must match the VENDOR column of the open order file. Inter-plant vendors are never monitored.</p>
      </div>
      <div className="max-h-[65vh] overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10"><tr><th className="th w-40">Vendor code</th><th className="th">Vendor name</th><th className="th w-32 text-center">Inter-plant</th><th className="th w-28" /></tr></thead>
          <tbody>
            <tr className="bg-slate-50">
              <td className="td"><input className="input font-mono" placeholder="Code" value={draft.vendor_code} onChange={(e) => setDraft({ ...draft, vendor_code: e.target.value })} /></td>
              <td className="td"><input className="input" placeholder="New vendor name" value={draft.vendor_name} onChange={(e) => setDraft({ ...draft, vendor_name: e.target.value })} /></td>
              <td className="td text-center"><input type="checkbox" className="w-4 h-4" checked={draft.is_interplant} onChange={(e) => setDraft({ ...draft, is_interplant: e.target.checked })} /></td>
              <td className="td"><button className="btn-primary" disabled={!draft.vendor_code.trim() || !draft.vendor_name.trim() || action.busy} onClick={add}><Plus size={16} /> Add</button></td>
            </tr>
            {list.map((v) => (
              <EditRow key={v.vendor_code} row={v} fields={['vendor_code', 'vendor_name', 'is_interplant']}
                onSave={(d) => action.run(() => updateRow('vendors', { vendor_code: v.vendor_code }, { vendor_code: d.vendor_code.trim(), vendor_name: d.vendor_name.trim(), is_interplant: d.is_interplant }), { orders: true })}
                onDelete={() => confirmDelete(`vendor ${v.vendor_name} (and its capacities)`) && action.run(() => deleteRow('vendors', { vendor_code: v.vendor_code }), { orders: true })}>
                {(d, set) => (<>
                  <td className="td"><input className="input font-mono" value={d.vendor_code} onChange={(e) => set('vendor_code', e.target.value)} /></td>
                  <td className="td"><input className="input" value={d.vendor_name} onChange={(e) => set('vendor_name', e.target.value)} /></td>
                  <td className="td text-center"><input type="checkbox" className="w-4 h-4" checked={!!d.is_interplant} onChange={(e) => set('is_interplant', e.target.checked)} /></td>
                </>)}
              </EditRow>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Shared editable row
function EditRow({ row, fields, onSave, onDelete, children }) {
  const pick = (r) => Object.fromEntries(fields.map((f) => [f, r[f] ?? '']))
  const [draft, setDraft] = useState(() => pick(row))
  useEffect(() => { setDraft(pick(row)) }, [row]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = fields.some((f) => String(draft[f] ?? '') !== String(row[f] ?? ''))
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
  return (
    <tr className={dirty ? 'bg-amber-50' : ''}>
      {children(draft, set)}
      <td className="td">
        <div className="flex gap-1">
          <button className="btn-primary p-1.5" title="Save" disabled={!dirty} onClick={() => onSave(draft)}><Save size={16} /></button>
          <button className="btn-danger p-1.5" title="Delete" onClick={onDelete}><Trash2 size={16} /></button>
        </div>
      </td>
    </tr>
  )
}
