import { useMemo, useRef, useState } from 'react'
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { useData } from '../lib/DataContext'
import { parseOpenOrderFile, prefixOf } from '../lib/parseOpenOrder'
import { replaceOpenOrder } from '../lib/api'
import { fmtNum } from '../lib/format'

// Vendor names that are VTC plants (inter-plant orders are not monitored)
const INTERPLANT_RE = /^(VTC|GTC)\b/i
const normName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

export default function UploadPage({ onDone }) {
  const { master, lookups, upload, reloadOrders, reloadMaster } = useData()
  const inputRef = useRef()
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const [drag, setDrag] = useState(false)

  const handleFile = async (f) => {
    if (!f) return
    setFile(f); setParsed(null); setError(null); setDone(false)
    try { setParsed(await parseOpenOrderFile(f)) }
    catch (e) { setError(e.message) }
  }

  const preview = useMemo(() => {
    if (!parsed) return null
    const isInterplant = (r) => lookups.vendorByCode[r.vendor_code]?.is_interplant ?? INTERPLANT_RE.test(normName(r.vendor_name))
    const newVendors = new Map()
    const byCat = {}
    let interplant = 0, unclassified = 0, zeroBal = 0, monitored = 0, noDate = 0
    for (const r of parsed.rows) {
      if (r.vendor_code && !lookups.vendorByCode[r.vendor_code] && !newVendors.has(r.vendor_code)) {
        newVendors.set(r.vendor_code, { vendor_code: r.vendor_code, vendor_name: normName(r.vendor_name) || r.vendor_code, is_interplant: INTERPLANT_RE.test(normName(r.vendor_name)) })
      }
      if (isInterplant(r)) { interplant++; continue }
      const cat = lookups.categoryByPrefix[prefixOf(r.part_number)]
      if (!cat) { unclassified++; continue }
      if (!(r.bal_qty > 0)) { zeroBal++; continue }
      monitored++
      if (!r.ship_date) noDate++
      byCat[cat.name] = byCat[cat.name] ?? { lines: 0, qty: 0, unit: cat.unit }
      byCat[cat.name].lines++; byCat[cat.name].qty += r.bal_qty
    }
    return { total: parsed.rows.length, interplant, unclassified, zeroBal, monitored, noDate, byCat, newVendors: [...newVendors.values()] }
  }, [parsed, lookups])

  const submit = async () => {
    setBusy(true); setError(null); setProgress(0)
    try {
      await replaceOpenOrder(file.name, parsed.rows, preview.newVendors, setProgress)
      await Promise.all([reloadMaster(), reloadOrders()])
      setDone(true)
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  const reset = () => { setFile(null); setParsed(null); setDone(false); setError(null); if (inputRef.current) inputRef.current.value = '' }

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Upload Open Order</h1>
        <p className="text-sm text-slate-500">Accepts .xlsx, .xls or .csv. Uploading a new file <b>replaces</b> the current open order.</p>
      </div>

      {upload && (
        <div className="card p-4 text-sm flex items-center gap-3">
          <FileSpreadsheet className="text-indigo-600" />
          <div>Current file: <b>{upload.file_name}</b> · {fmtNum(upload.total_rows)} rows · uploaded {new Date(upload.uploaded_at).toLocaleString('en-US')}</div>
        </div>
      )}

      {!done && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]) }}
          onClick={() => inputRef.current?.click()}
          className={`card border-2 border-dashed p-10 text-center cursor-pointer transition ${drag ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400'}`}>
          <UploadCloud className="mx-auto text-indigo-500" size={40} />
          <div className="mt-3 font-medium text-slate-800">{file ? file.name : 'Drag & drop the Open Order file here, or click to browse'}</div>
          <div className="text-xs text-slate-500 mt-1">The header row must include PART NUMBER, VENDOR, SHIP DATE and BAL QTY</div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 flex gap-2"><AlertTriangle className="shrink-0" size={18} />{error}</div>
      )}

      {preview && !done && (
        <div className="card">
          <div className="p-5 border-b border-slate-200">
            <h2 className="font-semibold text-slate-900">Preview</h2>
            {parsed.warnings.map((w) => <p key={w} className="text-xs text-amber-700 mt-1">{w}</p>)}
          </div>
          <div className="p-5 grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
            <Box label="Rows in file" value={preview.total} />
            <Box label="Monitored" value={preview.monitored} tone="green" />
            <Box label="Not in mother table" value={preview.unclassified} tone="muted" />
            <Box label="Inter-plant" value={preview.interplant} tone="muted" />
            <Box label="Zero balance" value={preview.zeroBal} tone="muted" />
          </div>
          <div className="px-5 pb-5">
            <table className="w-full">
              <thead><tr><th className="th">Category</th><th className="th text-right">Lines</th><th className="th text-right">Bal Qty</th></tr></thead>
              <tbody>
                {master.categories.map((c) => {
                  const v = preview.byCat[c.name]
                  return <tr key={c.id}><td className="td">{c.name}</td><td className="td text-right">{fmtNum(v?.lines ?? 0)}</td><td className="td text-right">{fmtNum(v?.qty ?? 0)} {c.unit}</td></tr>
                })}
              </tbody>
            </table>
            {preview.noDate > 0 && <p className="text-xs text-amber-700 mt-3">{preview.noDate} monitored lines have no ship date and will not appear in the charts.</p>}
            {preview.newVendors.length > 0 && (
              <p className="text-xs text-slate-600 mt-3">
                {preview.newVendors.length} new vendor code(s) will be added to Settings → Vendors: {preview.newVendors.map((v) => `${v.vendor_code} ${v.vendor_name}${v.is_interplant ? ' (inter-plant)' : ''}`).join(', ')}
              </p>
            )}
          </div>
          <div className="p-5 border-t border-slate-200 flex items-center justify-end gap-3">
            {busy && (
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress * 100}%` }} /></div>
            )}
            <button className="btn-ghost" onClick={reset} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>
              {busy ? <><Loader2 size={16} className="animate-spin" /> Uploading {Math.round(progress * 100)}%</> : 'Replace current open order'}
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="card p-8 text-center">
          <CheckCircle2 className="mx-auto text-emerald-500" size={44} />
          <div className="mt-3 font-semibold text-slate-900">Open order updated</div>
          <div className="text-sm text-slate-500">{fmtNum(preview.monitored)} monitored lines loaded.</div>
          <div className="mt-5 flex justify-center gap-3">
            <button className="btn-outline" onClick={reset}>Upload another</button>
            <button className="btn-primary" onClick={onDone}>Go to dashboard</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Box({ label, value, tone }) {
  const color = tone === 'green' ? 'text-emerald-600' : tone === 'muted' ? 'text-slate-400' : 'text-slate-900'
  return <div className="rounded-lg bg-slate-50 p-3"><div className={`text-2xl font-bold ${color}`}>{fmtNum(value)}</div><div className="text-xs text-slate-500">{label}</div></div>
}
