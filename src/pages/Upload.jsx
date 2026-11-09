import { useMemo, useRef, useState } from 'react'
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, History, PackageCheck, Activity } from 'lucide-react'
import { useData } from '../lib/DataContext'
import { parseOpenOrderFile, prefixOf } from '../lib/parseOpenOrder'
import { replaceOpenOrder } from '../lib/api'
import {
  parsePoReceiptsFile,
  parseTransactionsFile,
  saveReceiptsCube,
  saveTransactionsCube,
  computeHistoryAnalytics,
} from '../lib/historyApi'
import { fmtNum } from '../lib/format'

// Vendor names that are VTC plants (inter-plant orders are not monitored)
const INTERPLANT_RE = /^(VTC|GTC)\b/i
const normName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

export default function UploadPage({ onDone }) {
  const {
    master,
    lookups,
    upload,
    receiptsCube,
    setReceiptsCube,
    transactionsCube,
    setTransactionsCube,
    reloadOrders,
    reloadMaster,
  } = useData()

  const [uploadTab, setUploadTab] = useState('open_order') // 'open_order' | 'receipts' | 'transactions'

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Upload Data Files</h1>
        <p className="text-sm text-slate-500">
          Upload and replace the <b>Open Order Report</b>, <b>PO Receipts History (9M Purchases)</b>, or <b>Inventory Transactions History (12M Usage)</b> in Supabase.
        </p>
      </div>

      {/* 3-Card Status & Tab Selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setUploadTab('open_order')}
          className={`card p-4 text-left transition cursor-pointer border-2 ${
            uploadTab === 'open_order' ? 'border-indigo-600 bg-indigo-50/30 shadow-xs' : 'border-transparent hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 font-bold text-sm text-slate-900">
              <FileSpreadsheet size={18} className="text-indigo-600" />
              1. Open Order Report
            </span>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">Future</span>
          </div>
          <div className="mt-2 text-xs text-slate-600 truncate">
            {upload ? (
              <>
                <b>{upload.file_name}</b> · {fmtNum(upload.total_rows)} rows
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Uploaded {new Date(upload.uploaded_at).toLocaleDateString('en-US')}
                </div>
              </>
            ) : (
              <span className="text-amber-600">No file uploaded yet</span>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setUploadTab('receipts')}
          className={`card p-4 text-left transition cursor-pointer border-2 ${
            uploadTab === 'receipts' ? 'border-cyan-600 bg-cyan-50/30 shadow-xs' : 'border-transparent hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 font-bold text-sm text-slate-900">
              <PackageCheck size={18} className="text-cyan-600" />
              2. PO Receipts (Purchases)
            </span>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-cyan-100 text-cyan-800">Past 9M</span>
          </div>
          <div className="mt-2 text-xs text-slate-600 truncate">
            {receiptsCube ? (
              <>
                <b>{receiptsCube.file_name}</b> · {fmtNum(receiptsCube.total_rows)} rows
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Range: {receiptsCube.min_date || '—'} to {receiptsCube.max_date || '—'}
                </div>
              </>
            ) : (
              <span className="text-amber-600">No PO receipts file uploaded yet</span>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setUploadTab('transactions')}
          className={`card p-4 text-left transition cursor-pointer border-2 ${
            uploadTab === 'transactions' ? 'border-amber-600 bg-amber-50/30 shadow-xs' : 'border-transparent hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 font-bold text-sm text-slate-900">
              <Activity size={18} className="text-amber-600" />
              3. Transactions (Usage)
            </span>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-800">Past 12M</span>
          </div>
          <div className="mt-2 text-xs text-slate-600 truncate">
            {transactionsCube ? (
              <>
                <b>{transactionsCube.file_name}</b> · {fmtNum(transactionsCube.total_rows)} rows
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Range: {transactionsCube.min_date || '—'} to {transactionsCube.max_date || '—'}
                </div>
              </>
            ) : (
              <span className="text-amber-600">No transactions file uploaded yet</span>
            )}
          </div>
        </button>
      </div>

      {uploadTab === 'open_order' && (
        <OpenOrderUploader
          master={master}
          lookups={lookups}
          upload={upload}
          reloadMaster={reloadMaster}
          reloadOrders={reloadOrders}
          onDone={onDone}
        />
      )}

      {uploadTab === 'receipts' && (
        <HistoryCubeUploader
          kind="receipts"
          title="Upload PO Receipts History (Past 9 Months Purchases)"
          subtitle="Expected columns: DIV, CLASS, PART NUMBER, DESCRIPTION, UM, LT, REFERENCE, RECEIPT DATE, QTY, VENDOR NAME. Uploading a new file replaces the current PO Receipts history in Supabase."
          currentCube={receiptsCube}
          master={master}
          lookups={lookups}
          parseFn={parsePoReceiptsFile}
          saveFn={async (cube, onProg) => {
            const saved = await saveReceiptsCube(cube, onProg)
            setReceiptsCube(saved)
          }}
          onDone={onDone}
        />
      )}

      {uploadTab === 'transactions' && (
        <HistoryCubeUploader
          kind="transactions"
          title="Upload Inventory Transactions History (Past 12 Months Issues & Adjustments)"
          subtitle="Expected columns: CLASS, PART NUMBER, DESCRIPTION, DIV, REFERENCE, DATE, SUBASSY, TYPE, ID, QTY. Uploading a new file replaces the current Transactions history in Supabase."
          currentCube={transactionsCube}
          master={master}
          lookups={lookups}
          parseFn={parseTransactionsFile}
          saveFn={async (cube, onProg) => {
            const saved = await saveTransactionsCube(cube, onProg)
            setTransactionsCube(saved)
          }}
          onDone={onDone}
        />
      )}
    </div>
  )
}

function OpenOrderUploader({ master, lookups, upload, reloadMaster, reloadOrders, onDone }) {
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
    <div className="space-y-4">
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
            <h2 className="font-semibold text-slate-900">Preview — Open Order Report</h2>
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
            <table className="w-full text-xs">
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

function HistoryCubeUploader({ kind, title, subtitle, currentCube, master, lookups, parseFn, saveFn, onDone }) {
  const inputRef = useRef()
  const [file, setFile] = useState(null)
  const [cube, setCube] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const [drag, setDrag] = useState(false)

  const handleFile = async (f) => {
    if (!f) return
    setFile(f); setCube(null); setError(null); setDone(false); setParsing(true)
    try {
      // Allow UI to render spinner before parsing large 264k row files
      await new Promise((r) => setTimeout(r, 40))
      const parsedCube = await parseFn(f)
      setCube(parsedCube)
    } catch (e) {
      setError(e.message)
    } finally {
      setParsing(false)
    }
  }

  const previewAnalytics = useMemo(() => {
    if (!cube) return null
    return computeHistoryAnalytics({
      receiptsCube: kind === 'receipts' ? cube : null,
      transactionsCube: kind === 'transactions' ? cube : null,
      master,
      lookups,
      orders: [],
      filters: {},
      mode: 'week',
    })
  }, [cube, kind, master, lookups])

  const submit = async () => {
    if (!cube) return
    setBusy(true); setError(null); setProgress(0.05)
    try {
      await saveFn(cube, setProgress)
      setDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setFile(null); setCube(null); setDone(false); setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const isReceipts = kind === 'receipts'

  return (
    <div className="space-y-4">
      <div className="card p-4 bg-slate-50/70 border-slate-200">
        <div className="font-semibold text-slate-900 text-sm">{title}</div>
        <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>
        {currentCube && (
          <div className="mt-2.5 pt-2.5 border-t border-slate-200/80 text-xs text-slate-700 flex flex-wrap items-center gap-4">
            <span>Currently active in Supabase: <b>{currentCube.file_name}</b></span>
            <span>Total rows: <b>{fmtNum(currentCube.total_rows)}</b></span>
            <span>Date range: <b>{currentCube.min_date || '—'}</b> to <b>{currentCube.max_date || '—'}</b></span>
            <span>Uploaded: <b>{new Date(currentCube.uploaded_at).toLocaleString('en-US')}</b></span>
          </div>
        )}
      </div>

      {!done && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]) }}
          onClick={() => !parsing && inputRef.current?.click()}
          className={`card border-2 border-dashed p-10 text-center cursor-pointer transition ${
            drag ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400'
          }`}
        >
          {parsing ? (
            <div className="py-4 space-y-2">
              <Loader2 className="mx-auto text-indigo-600 animate-spin" size={38} />
              <div className="font-semibold text-slate-800">Reading &amp; indexing {file?.name}…</div>
              <div className="text-xs text-slate-500">Large files (67k – 264k rows) take ~2–5 seconds to process in memory.</div>
            </div>
          ) : (
            <>
              <UploadCloud className="mx-auto text-indigo-500" size={40} />
              <div className="mt-3 font-medium text-slate-800">
                {file ? file.name : `Drag & drop the ${isReceipts ? 'PO Receipts' : 'Inventory Transactions'} file here, or click to browse`}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {isReceipts
                  ? 'Columns: DIV, CLASS, PART NUMBER, DESCRIPTION, UM, LT, REFERENCE, RECEIPT DATE, QTY, VENDOR NAME'
                  : 'Columns: CLASS, PART NUMBER, DESCRIPTION, DIV, REFERENCE, DATE, SUBASSY, TYPE, ID, QTY'}
              </div>
            </>
          )}
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 flex gap-2">
          <AlertTriangle className="shrink-0" size={18} />
          {error}
        </div>
      )}

      {cube && previewAnalytics && !done && (
        <div className="card">
          <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-900">
                Preview — {isReceipts ? 'PO Receipts (9-Month Purchases Analysis)' : 'Inventory Transactions (12-Month Consumption Analysis)'}
              </h2>
              <p className="text-xs text-slate-500">
                Matched against Mother Table 4-character prefixes · Date range in file: <b>{cube.min_date || '—'}</b> to <b>{cube.max_date || '—'}</b>
              </p>
            </div>
          </div>

          <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <Box label="Total rows in file" value={cube.total_rows} />
            <Box label="Valid rows with Qty" value={cube.valid_rows} tone="green" />
            <Box label="Condensed weekly buckets" value={cube.buckets.length} />
            <Box
              label={isReceipts ? '9M Weekly Divisor' : '12M Weekly Divisor'}
              value={isReceipts ? 39 : 52}
              tone="muted"
            />
          </div>

          <div className="px-5 pb-5">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="th">Part Category (Mother Table)</th>
                  <th className="th text-right">
                    {isReceipts ? 'Total Purchases (Last 9M)' : 'Total Usage (Last 12M)'}
                  </th>
                  <th className="th text-right">
                    {isReceipts ? '9M Avg / Week (÷ 39w)' : '12M Avg / Week (÷ 52w)'}
                  </th>
                  <th className="th text-right">
                    {isReceipts ? '9M Avg / Month (÷ 9m)' : '12M Avg / Month (÷ 12m)'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {master.categories.map((c) => {
                  const catStat = previewAnalytics.byCategory[c.id]
                  const tot = isReceipts ? (catStat?.purch9MTotal ?? 0) : (catStat?.usage12MTotal ?? 0)
                  const wkAvg = isReceipts ? (catStat?.purch9MAvg ?? 0) : (catStat?.usage12MAvg ?? 0)
                  const moAvg = isReceipts ? tot / 9 : tot / 12
                  return (
                    <tr key={c.id}>
                      <td className="td font-medium text-slate-800">{c.name}</td>
                      <td className="td text-right font-mono">{fmtNum(Math.round(tot))} {c.unit}</td>
                      <td className="td text-right font-semibold text-indigo-700">{fmtNum(Math.round(wkAvg))} {c.unit}/wk</td>
                      <td className="td text-right text-slate-600">{fmtNum(Math.round(moAvg))} {c.unit}/mo</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="p-5 border-t border-slate-200 flex items-center justify-end gap-3">
            {busy && (
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
            <button className="btn-ghost" onClick={reset} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>
              {busy ? (
                <><Loader2 size={16} className="animate-spin" /> Saving to Supabase {Math.round(progress * 100)}%</>
              ) : (
                `Save & Replace ${isReceipts ? 'PO Receipts' : 'Transactions'} in Supabase`
              )}
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="card p-8 text-center">
          <CheckCircle2 className="mx-auto text-emerald-500" size={44} />
          <div className="mt-3 font-semibold text-slate-900">
            {isReceipts ? 'PO Receipts (9M Purchases) Saved to Supabase' : 'Inventory Transactions (12M Usage) Saved to Supabase'}
          </div>
          <div className="text-sm text-slate-500">
            {fmtNum(cube.total_rows)} rows processed and stored. Previous data has been replaced.
          </div>
          <div className="mt-5 flex justify-center gap-3">
            <button className="btn-outline" onClick={reset}>Upload another file</button>
            <button className="btn-primary" onClick={onDone}>Go to Dashboard</button>
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
