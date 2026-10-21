import { useEffect, useState } from 'react'
import { BarChart3, ListOrdered, Table2, Upload as UploadIcon, Settings as SettingsIcon, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react'
import { useData } from './lib/DataContext'
import Dashboard from './pages/Dashboard'
import OpenOrders from './pages/OpenOrders'
import MotherTable from './pages/MotherTable'
import UploadPage from './pages/Upload'
import Settings from './pages/Settings'

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'orders', label: 'Open Orders', icon: ListOrdered },
  { id: 'mother', label: 'Mother Table', icon: Table2 },
  { id: 'upload', label: 'Upload Open Order', icon: UploadIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

const pageFromHash = () => {
  const h = window.location.hash.replace('#/', '').replace('#', '')
  return PAGES.some((p) => p.id === h) ? h : 'dashboard'
}

export const EMPTY_FILTERS = { division: '', supplier: '', category: '', buyer: '' }

export default function App() {
  const { loading, error, upload, reloadAll } = useData()
  const [page, setPage] = useState(pageFromHash)
  const [filters, setFilters] = useState(EMPTY_FILTERS)

  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (id) => { window.location.hash = `#/${id}` }

  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 bg-slate-900 text-slate-300 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="text-white font-bold leading-tight">Supplier Capacity</div>
          <div className="text-xs text-slate-400">Insulation Purchasing</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {PAGES.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => go(id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition cursor-pointer ${page === id ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800 text-xs space-y-2">
          <div className="text-slate-400">Current open order</div>
          {upload ? (
            <>
              <div className="text-slate-200 break-words">{upload.file_name}</div>
              <div className="text-slate-500">{new Date(upload.uploaded_at).toLocaleString('en-US')}</div>
            </>
          ) : <div className="text-amber-400">No file uploaded yet</div>}
          <button onClick={reloadAll} className="flex items-center gap-1 text-slate-400 hover:text-white cursor-pointer"><RefreshCw size={12} /> Refresh data</button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {error && (
          <div className="m-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 flex gap-3">
            <AlertTriangle className="shrink-0" />
            <div>
              <div className="font-semibold">Could not load data from Supabase</div>
              <div className="text-sm">{error}</div>
              <div className="text-sm mt-1">If this is the first run, execute <code>supabase/setup.sql</code> in the Supabase SQL Editor.</div>
            </div>
          </div>
        )}
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-500 gap-2"><Loader2 className="animate-spin" /> Loading…</div>
        ) : !error && (
          <>
            {page === 'dashboard' && <Dashboard filters={filters} setFilters={setFilters} />}
            {page === 'orders' && <OpenOrders filters={filters} setFilters={setFilters} />}
            {page === 'mother' && <MotherTable />}
            {page === 'upload' && <UploadPage onDone={() => go('dashboard')} />}
            {page === 'settings' && <Settings />}
          </>
        )}
      </main>
    </div>
  )
}
