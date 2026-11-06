import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  CheckSquare,
  Plus,
  Trash2,
  Search,
  Download,
  RotateCcw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
  PauseCircle,
  Edit3,
  Save,
  X,
} from 'lucide-react'
import { useData } from '../lib/DataContext'
import { TDL_STATUSES, TDL_PRIORITIES, DEFAULT_TDL_ITEMS } from '../lib/capStatusAndTdl'
import { todayISO } from '../lib/periods'

const STATUS_BADGE = {
  Pending: 'bg-slate-100 text-slate-700 border-slate-300',
  'In Progress': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'Waiting on Supplier': 'bg-amber-50 text-amber-800 border-amber-200',
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Blocked: 'bg-red-50 text-red-700 border-red-200',
}

const PRIORITY_BADGE = {
  High: 'bg-red-50 text-red-700 border-red-200',
  Medium: 'bg-amber-50 text-amber-700 border-amber-200',
  Low: 'bg-slate-100 text-slate-600 border-slate-200',
}

export default function TdlPage({ compact = false }) {
  const { master, lookups, tdlItems, updateTdlItems } = useData()
  const today = todayISO()

  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showAddForm, setShowAddForm] = useState(!compact)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)

  const [draft, setDraft] = useState({
    action: '',
    category: 'Key Spacers',
    supplier: '',
    plant: 'All',
    owner: '',
    priority: 'High',
    due_date: '',
    status: 'Pending',
    notes: '',
  })

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return (tdlItems || []).filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false
      if (priorityFilter && item.priority !== priorityFilter) return false
      if (categoryFilter && item.category !== categoryFilter) return false
      if (query) {
        const hay = `${item.action} ${item.category} ${item.supplier} ${item.plant} ${item.owner} ${item.notes}`.toLowerCase()
        if (!hay.includes(query)) return false
      }
      return true
    })
  }, [tdlItems, q, statusFilter, priorityFilter, categoryFilter])

  const stats = useMemo(() => {
    const all = tdlItems || []
    return {
      total: all.length,
      pending: all.filter((i) => i.status === 'Pending').length,
      inProgress: all.filter((i) => i.status === 'In Progress').length,
      waiting: all.filter((i) => i.status === 'Waiting on Supplier').length,
      completed: all.filter((i) => i.status === 'Completed').length,
      overdue: all.filter((i) => i.status !== 'Completed' && i.due_date && i.due_date < today).length,
    }
  }, [tdlItems, today])

  const handleAdd = (e) => {
    e?.preventDefault()
    if (!draft.action.trim()) return
    const nextItem = {
      id: `tdl-${Date.now()}`,
      action: draft.action.trim(),
      category: draft.category || 'All',
      supplier: draft.supplier.trim() || 'Multiple',
      plant: draft.plant || 'All',
      owner: draft.owner.trim() || 'Purchasing',
      priority: draft.priority || 'Medium',
      due_date: draft.due_date || today,
      status: draft.status || 'Pending',
      notes: draft.notes.trim(),
      created_at: today,
    }
    updateTdlItems([nextItem, ...(tdlItems || [])])
    setDraft({
      ...draft,
      action: '',
      supplier: '',
      notes: '',
    })
    if (compact) setShowAddForm(false)
  }

  const handleStatusChange = (id, newStatus) => {
    updateTdlItems(
      (tdlItems || []).map((item) => (item.id === id ? { ...item, status: newStatus } : item))
    )
  }

  const handleDelete = (id) => {
    if (!window.confirm('Delete this action item from the TDL?')) return
    updateTdlItems((tdlItems || []).filter((item) => item.id !== id))
  }

  const startEdit = (item) => {
    setEditingId(item.id)
    setEditDraft({ ...item })
  }

  const saveEdit = () => {
    if (!editDraft || !editDraft.action.trim()) return
    updateTdlItems(
      (tdlItems || []).map((item) => (item.id === editingId ? { ...editDraft, action: editDraft.action.trim() } : item))
    )
    setEditingId(null)
    setEditDraft(null)
  }

  const handleResetDefaults = () => {
    if (!window.confirm('Restore default TDL action items?')) return
    updateTdlItems(DEFAULT_TDL_ITEMS)
  }

  const handleExportExcel = () => {
    const rows = filtered.map((item, idx) => ({
      '#': idx + 1,
      'Action / Task': item.action,
      Category: item.category,
      Supplier: item.supplier,
      Plant: item.plant,
      Owner: item.owner,
      Priority: item.priority,
      'Due Date': item.due_date,
      Status: item.status,
      Notes: item.notes,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [
      { wch: 5 },
      { wch: 48 },
      { wch: 22 },
      { wch: 28 },
      { wch: 10 },
      { wch: 18 },
      { wch: 10 },
      { wch: 14 },
      { wch: 20 },
      { wch: 45 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'TDL Action Tracker')
    XLSX.writeFile(wb, `VTC_Supplier_Capacity_TDL_${today}.xlsx`)
  }

  return (
    <div className={compact ? 'space-y-4' : 'p-6 space-y-5'}>
      {!compact && (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
              <CheckSquare className="text-indigo-600" size={24} />
              <span>TDL · Action &amp; Status Tracker</span>
            </h1>
            <p className="text-sm text-slate-500">
              Monitor resourcing actions, supplier capacity confirmations, PO reallocations, and follow-up statuses
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(!showAddForm)}
              className="btn-primary text-xs px-3.5 py-2 flex items-center gap-1.5 cursor-pointer"
            >
              <Plus size={15} /> {showAddForm ? 'Hide New Action Form' : 'New Action Item'}
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="btn-outline text-xs px-3 py-2 flex items-center gap-1.5 cursor-pointer bg-white"
            >
              <Download size={14} /> Export TDL (.xlsx)
            </button>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="btn-outline text-xs px-2.5 py-2 flex items-center gap-1 cursor-pointer bg-white text-slate-600"
              title="Restore default TDL items"
            >
              <RotateCcw size={13} /> Reset
            </button>
          </div>
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <TdlKpi
          label="Total Actions"
          value={stats.total}
          icon={CheckSquare}
          tone="slate"
          active={statusFilter === ''}
          onClick={() => setStatusFilter('')}
        />
        <TdlKpi
          label="Pending"
          value={stats.pending}
          icon={Clock}
          tone="slate"
          active={statusFilter === 'Pending'}
          onClick={() => setStatusFilter(statusFilter === 'Pending' ? '' : 'Pending')}
        />
        <TdlKpi
          label="In Progress"
          value={stats.inProgress}
          icon={PlayCircle}
          tone="indigo"
          active={statusFilter === 'In Progress'}
          onClick={() => setStatusFilter(statusFilter === 'In Progress' ? '' : 'In Progress')}
        />
        <TdlKpi
          label="Waiting on Supplier"
          value={stats.waiting}
          icon={PauseCircle}
          tone="amber"
          active={statusFilter === 'Waiting on Supplier'}
          onClick={() => setStatusFilter(statusFilter === 'Waiting on Supplier' ? '' : 'Waiting on Supplier')}
        />
        <TdlKpi
          label="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          tone="emerald"
          active={statusFilter === 'Completed'}
          onClick={() => setStatusFilter(statusFilter === 'Completed' ? '' : 'Completed')}
        />
        <TdlKpi
          label="Overdue"
          value={stats.overdue}
          icon={AlertTriangle}
          tone={stats.overdue > 0 ? 'red' : 'slate'}
        />
      </div>

      {/* Add Action Form */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="card p-4 bg-indigo-50/40 border-indigo-200 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
              <Plus size={14} /> Add New TDL Action Item
            </div>
            {compact && (
              <button type="button" onClick={() => setShowAddForm(false)} className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={15} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="md:col-span-3">
              <label className="label text-xs">Action / Task Description *</label>
              <input
                className="input text-xs bg-white"
                placeholder="e.g. Confirm weekly capacity with supplier or move PO lines..."
                value={draft.action}
                onChange={(e) => setDraft({ ...draft, action: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label text-xs">Category</label>
              <select
                className="input text-xs bg-white"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              >
                <option value="All">All Categories</option>
                {master.categories.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">Supplier</label>
              <input
                list="tdl-suppliers-list"
                className="input text-xs bg-white"
                placeholder="Supplier name..."
                value={draft.supplier}
                onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
              />
              <datalist id="tdl-suppliers-list">
                {master.vendors
                  .filter((v) => !v.is_interplant)
                  .map((v) => (
                    <option key={v.vendor_code} value={`${v.vendor_name} (${v.vendor_code})`} />
                  ))}
              </datalist>
            </div>
            <div>
              <label className="label text-xs">Plant</label>
              <select
                className="input text-xs bg-white"
                value={draft.plant}
                onChange={(e) => setDraft({ ...draft, plant: e.target.value })}
              >
                <option value="All">All Plants</option>
                <option value="GTC">GTC</option>
                <option value="VTCU">VTCU</option>
                <option value="VTCR">VTCR</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div>
              <label className="label text-xs">Owner / Buyer</label>
              <input
                className="input text-xs bg-white"
                placeholder="e.g. R. Ramirez / Purchasing"
                value={draft.owner}
                onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              />
            </div>
            <div>
              <label className="label text-xs">Priority</label>
              <select
                className="input text-xs bg-white"
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
              >
                {TDL_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">Due Date</label>
              <input
                type="date"
                className="input text-xs font-mono bg-white"
                value={draft.due_date}
                onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
              />
            </div>
            <div>
              <label className="label text-xs">Initial Status</label>
              <select
                className="input text-xs bg-white"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                {TDL_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">Notes / Reference</label>
              <input
                className="input text-xs bg-white"
                placeholder="PO #, details, next steps..."
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary text-xs w-full py-2 flex items-center justify-center gap-1.5 cursor-pointer">
                <Plus size={15} /> Add to TDL
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filter & Table Card */}
      <div className="card">
        <div className="p-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative w-64">
              <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input
                className="input pl-8 text-xs"
                placeholder="Search action, supplier, owner, notes..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              className="input w-auto text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              {TDL_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              className="input w-auto text-xs"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
            >
              <option value="">All Priorities</option>
              {TDL_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select
              className="input w-auto text-xs"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              <option value="All">General / All</option>
              {master.categories.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
            {(q || statusFilter || priorityFilter || categoryFilter) && (
              <button
                type="button"
                onClick={() => { setQ(''); setStatusFilter(''); setPriorityFilter(''); setCategoryFilter('') }}
                className="text-xs text-indigo-600 hover:underline px-2 cursor-pointer"
              >
                Clear filters
              </button>
            )}
          </div>
          {compact && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(!showAddForm)}
                className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1 cursor-pointer"
              >
                <Plus size={14} /> Add Action
              </button>
              <button
                type="button"
                onClick={handleExportExcel}
                className="btn-outline text-xs px-2.5 py-1.5 flex items-center gap-1 cursor-pointer"
              >
                <Download size={13} /> Export
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="th w-10 text-center">#</th>
                <th className="th min-w-64">Action / Task</th>
                <th className="th">Category</th>
                <th className="th">Supplier</th>
                <th className="th text-center">Plant</th>
                <th className="th">Owner</th>
                <th className="th text-center">Priority</th>
                <th className="th text-center">Due Date</th>
                <th className="th text-center w-44">Status</th>
                <th className="th min-w-52">Notes</th>
                <th className="th w-20 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="td text-center py-8 text-slate-400">
                    No action items match the current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((item, idx) => {
                  const isEditing = editingId === item.id
                  const isOverdue = item.status !== 'Completed' && item.due_date && item.due_date < today
                  const isDone = item.status === 'Completed'

                  if (isEditing && editDraft) {
                    return (
                      <tr key={item.id} className="bg-indigo-50/50">
                        <td className="td text-center font-mono text-slate-400">{idx + 1}</td>
                        <td className="td">
                          <input
                            className="input text-xs bg-white"
                            value={editDraft.action}
                            onChange={(e) => setEditDraft({ ...editDraft, action: e.target.value })}
                          />
                        </td>
                        <td className="td">
                          <input
                            className="input text-xs bg-white"
                            value={editDraft.category}
                            onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })}
                          />
                        </td>
                        <td className="td">
                          <input
                            className="input text-xs bg-white"
                            value={editDraft.supplier}
                            onChange={(e) => setEditDraft({ ...editDraft, supplier: e.target.value })}
                          />
                        </td>
                        <td className="td">
                          <input
                            className="input text-xs bg-white w-20 text-center"
                            value={editDraft.plant}
                            onChange={(e) => setEditDraft({ ...editDraft, plant: e.target.value })}
                          />
                        </td>
                        <td className="td">
                          <input
                            className="input text-xs bg-white"
                            value={editDraft.owner}
                            onChange={(e) => setEditDraft({ ...editDraft, owner: e.target.value })}
                          />
                        </td>
                        <td className="td">
                          <select
                            className="input text-xs bg-white"
                            value={editDraft.priority}
                            onChange={(e) => setEditDraft({ ...editDraft, priority: e.target.value })}
                          >
                            {TDL_PRIORITIES.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </td>
                        <td className="td">
                          <input
                            type="date"
                            className="input text-xs font-mono bg-white"
                            value={editDraft.due_date || ''}
                            onChange={(e) => setEditDraft({ ...editDraft, due_date: e.target.value })}
                          />
                        </td>
                        <td className="td">
                          <select
                            className="input text-xs bg-white"
                            value={editDraft.status}
                            onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value })}
                          >
                            {TDL_STATUSES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </td>
                        <td className="td">
                          <input
                            className="input text-xs bg-white"
                            value={editDraft.notes || ''}
                            onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })}
                          />
                        </td>
                        <td className="td text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={saveEdit}
                              className="p-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
                              title="Save"
                            >
                              <Save size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => { setEditingId(null); setEditDraft(null) }}
                              className="p-1.5 rounded bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer"
                              title="Cancel"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  }

                  return (
                    <tr key={item.id} className={`hover:bg-slate-50/80 ${isDone ? 'opacity-65 bg-slate-50/40' : ''}`}>
                      <td className="td text-center font-mono text-slate-400">{idx + 1}</td>
                      <td className="td">
                        <div className={`font-semibold text-slate-900 ${isDone ? 'line-through text-slate-500' : ''}`}>
                          {item.action}
                        </div>
                      </td>
                      <td className="td">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                          {item.category}
                        </span>
                      </td>
                      <td className="td font-medium text-slate-700">{item.supplier}</td>
                      <td className="td text-center font-mono text-slate-600">{item.plant}</td>
                      <td className="td text-slate-700">{item.owner}</td>
                      <td className="td text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${PRIORITY_BADGE[item.priority] || PRIORITY_BADGE.Medium}`}>
                          {item.priority}
                        </span>
                      </td>
                      <td className="td text-center font-mono">
                        <span className={isOverdue ? 'text-red-600 font-bold' : 'text-slate-600'}>
                          {item.due_date || '—'}
                        </span>
                        {isOverdue && (
                          <span className="block text-[9px] font-sans font-bold uppercase text-red-600">Overdue</span>
                        )}
                      </td>
                      <td className="td text-center">
                        <select
                          value={item.status}
                          onChange={(e) => handleStatusChange(item.id, e.target.value)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full border cursor-pointer outline-none ${
                            STATUS_BADGE[item.status] || STATUS_BADGE.Pending
                          }`}
                        >
                          {TDL_STATUSES.map((s) => (
                            <option key={s} value={s} className="bg-white text-slate-800">
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="td text-slate-600 max-w-xs">
                        <div className="truncate" title={item.notes}>{item.notes || <span className="text-slate-300">—</span>}</div>
                      </td>
                      <td className="td text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(item)}
                            className="p-1.5 rounded text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 cursor-pointer"
                            title="Edit item"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id)}
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                            title="Delete item"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TdlKpi({ label, value, icon: Icon, tone, active, onClick }) {
  const toneMap = {
    slate: 'bg-slate-100 text-slate-700',
    indigo: 'bg-indigo-50 text-indigo-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-600',
  }
  return (
    <div
      onClick={onClick}
      className={`card p-3.5 flex items-center gap-3 transition ${
        onClick ? 'cursor-pointer hover:shadow-sm' : ''
      } ${active ? 'ring-2 ring-indigo-500 bg-indigo-50/20' : ''}`}
    >
      <div className={`p-2 rounded-lg ${toneMap[tone] || toneMap.slate}`}>
        <Icon size={18} />
      </div>
      <div>
        <div className="text-[11px] text-slate-500 font-medium">{label}</div>
        <div className={`text-lg font-bold ${tone === 'red' ? 'text-red-600' : 'text-slate-900'}`}>{value}</div>
      </div>
    </div>
  )
}
