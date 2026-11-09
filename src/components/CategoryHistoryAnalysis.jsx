import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  ChevronRight,
  ChevronDown,
  Download,
  History,
  Upload as UploadIcon,
  CheckCircle2,
  Clock3,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react'
import { fmtNum, fmtCompact, utilLevel, LEVEL_STYLES, pct } from '../lib/format'
import { PAST_DUE, todayISO } from '../lib/periods'
import { resolveCapStatus } from '../lib/capStatusAndTdl'

export default function CategoryHistoryAnalysis({
  categories,
  aggs,
  historyAnalytics,
  buckets,
  mode,
  capStatusMap,
  onToggleCapStatus,
}) {
  const periodWord = mode === 'week' ? 'wk' : 'mo'
  const periodFull = mode === 'week' ? 'week' : 'month'
  const timeBuckets = useMemo(() => buckets.filter((b) => b.key !== PAST_DUE), [buckets])
  const futurePeriodCount = Math.max(1, timeBuckets.length)
  const firstB = timeBuckets[0]
  const lastB = timeBuckets[timeBuckets.length - 1]
  const horizonLabel = firstB && lastB
    ? `${firstB.label}–${lastB.label} (${futurePeriodCount}${mode === 'week' ? 'w' : 'm'})`
    : `${futurePeriodCount} ${periodFull}s`

  const [expandedIds, setExpandedIds] = useState(() => new Set(categories.slice(0, 1).map((c) => c.id)))

  const toggleExpand = (catId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  const expandAll = () => setExpandedIds(new Set(categories.map((c) => c.id)))
  const collapseAll = () => setExpandedIds(new Set())

  // Build unified rows per category & vendor combining Past (9M Purch, 12M Usage) + Future (Open POs)
  const analysisRows = useMemo(() => {
    return categories.map((c) => {
      const agg = aggs[c.id] || {
        suppliers: [],
        totals: {},
        bucketCapTotals: {},
        weeklyCapTotal: 0,
        demand: 0,
        totalOpen: 0,
        pastDue: 0,
      }
      const histCat = historyAnalytics?.byCategory?.[c.id] || {
        purch9MTotal: 0,
        purch9MAvg: 0,
        usage12MTotal: 0,
        usage12MAvg: 0,
        byVendorCode: {},
      }

      const capFactor = mode === 'week' ? 1 : 4.33
      const catCapPerPeriod = (agg.weeklyCapTotal || 0) * capFactor
      const catDemandPerPeriod = (agg.demand || 0) * capFactor

      // Future sum across timeBuckets (excluding PAST_DUE)
      const futureSum = timeBuckets.reduce((sum, b) => sum + (agg.totals[b.key] ?? 0), 0)
      const futureCapSum = timeBuckets.reduce(
        (sum, b) => sum + (agg.bucketCapTotals?.[b.key] ?? ((agg.weeklyCapTotal || 0) * b.capacityFactor)),
        0
      )
      const futureAvg = futureSum / futurePeriodCount
      const futureAvgCap = futureCapSum / futurePeriodCount

      // Merge suppliers from agg.suppliers and any historical-only suppliers from histCat.byVendorCode
      const seenCodes = new Set()
      const vendorRows = []

      for (const s of agg.suppliers) {
        seenCodes.add(s.code)
        const hVend = histCat.byVendorCode?.[s.code]
        const sFutureSum = timeBuckets.reduce((sum, b) => sum + (s.cells[b.key] ?? 0), 0)
        const sFutureCapSum = timeBuckets.reduce(
          (sum, b) => sum + (s.bucketCaps?.[b.key] ?? ((s.weeklyCap ?? 0) * b.capacityFactor)),
          0
        )
        const sFutureAvg = sFutureSum / futurePeriodCount
        const sFutureAvgCap = sFutureCapSum / futurePeriodCount
        const sCapPerPeriod = (s.weeklyCap ?? 0) * capFactor
        const status = resolveCapStatus(capStatusMap, c.id, s.code, s.weeklyCap)

        vendorRows.push({
          code: s.code,
          name: s.name,
          color: s.color,
          weeklyCap: s.weeklyCap,
          capPerPeriod: sCapPerPeriod,
          capStatus: status,
          purch9MTotal: hVend?.purch9MTotal ?? 0,
          purch9MAvg: hVend?.purch9MAvg ?? 0,
          usage12MTotal: hVend?.usage12MTotal ?? 0,
          usage12MAvg: hVend?.usage12MAvg ?? 0,
          openTotal: s.total ?? 0,
          pastDue: s.cells?.[PAST_DUE] ?? 0,
          futureAvg: sFutureAvg,
          futureAvgCap: sFutureAvgCap,
        })
      }

      // Include any vendor that had 9M historical purchases in this category but has 0 open orders & isn't in agg.suppliers
      for (const [vCode, hVend] of Object.entries(histCat.byVendorCode || {})) {
        if (seenCodes.has(vCode)) continue
        if (!hVend.purch9MTotal && !hVend.usage12MTotal) continue
        vendorRows.push({
          code: vCode,
          name: hVend.vendorName || vCode,
          color: '#94a3b8',
          weeklyCap: null,
          capPerPeriod: 0,
          capStatus: resolveCapStatus(capStatusMap, c.id, vCode, null),
          purch9MTotal: hVend.purch9MTotal ?? 0,
          purch9MAvg: hVend.purch9MAvg ?? 0,
          usage12MTotal: hVend.usage12MTotal ?? 0,
          usage12MAvg: hVend.usage12MAvg ?? 0,
          openTotal: 0,
          pastDue: 0,
          futureAvg: 0,
          futureAvgCap: 0,
        })
      }

      const confirmedCount = vendorRows.filter((v) => v.capStatus === 'confirmed').length

      return {
        category: c,
        unit: c.unit,
        capPerPeriod: catCapPerPeriod,
        demandPerPeriod: catDemandPerPeriod,
        confirmedCount,
        totalSuppliers: vendorRows.length,
        purch9MTotal: histCat.purch9MTotal ?? 0,
        purch9MAvg: histCat.purch9MAvg ?? 0,
        usage12MTotal: histCat.usage12MTotal ?? 0,
        usage12MAvg: histCat.usage12MAvg ?? 0,
        openTotal: agg.totalOpen ?? 0,
        pastDue: agg.pastDue ?? 0,
        futureAvg,
        futureAvgCap,
        vendorRows,
      }
    })
  }, [categories, aggs, historyAnalytics, timeBuckets, futurePeriodCount, mode, capStatusMap])

  const handleExportExcel = () => {
    const today = todayISO()
    const pLabel = mode === 'week' ? 'Wk' : 'Mo'

    // Sheet 1: Condensed by Part Category
    const condensedData = analysisRows.map((r) => ({
      'Part Category': r.category.name,
      Unit: r.unit,
      [`Capacity / ${pLabel}`]: Math.round(r.capPerPeriod),
      'Confirmed Suppliers': `${r.confirmedCount}/${r.totalSuppliers}`,
      [`Target Demand / ${pLabel}`]: r.demandPerPeriod ? Math.round(r.demandPerPeriod) : '',
      'Past 9M Purchases Total': Math.round(r.purch9MTotal),
      [`Past 9M Purch Avg / ${pLabel}`]: Math.round(r.purch9MAvg),
      'Past 12M Usage Total': Math.round(r.usage12MTotal),
      [`Past 12M Usage Avg / ${pLabel}`]: Math.round(r.usage12MAvg),
      'Open PO Total': Math.round(r.openTotal),
      'Past Due Qty': Math.round(r.pastDue),
      [`Future Open PO Avg / ${pLabel} (${horizonLabel})`]: Math.round(r.futureAvg),
      'Future Open PO vs Cap (%)': r.futureAvgCap > 0 ? `${Math.round((r.futureAvg / r.futureAvgCap) * 100)}%` : 'N/A',
      'Past 9M Purch vs 12M Usage (%)': r.usage12MAvg > 0 ? `${Math.round((r.purch9MAvg / r.usage12MAvg) * 100)}%` : 'N/A',
    }))

    // Sheet 2: Breakdown by Vendor
    const vendorData = []
    for (const r of analysisRows) {
      if (r.vendorRows.length === 0) {
        vendorData.push({
          'Part Category': r.category.name,
          Unit: r.unit,
          'Vendor Code': '—',
          'Supplier Name': 'No suppliers',
          'Cap Status': '—',
          [`Supplier Cap / ${pLabel}`]: 0,
          [`Category 12M Usage Avg / ${pLabel} (Ref)`]: Math.round(r.usage12MAvg),
          'Past 9M Purchases Total': 0,
          [`Past 9M Purch Avg / ${pLabel}`]: 0,
          'Part-Matched 12M Usage Total': 0,
          [`Part-Matched 12M Usage Avg / ${pLabel}`]: 0,
          'Open PO Total': 0,
          'Past Due Qty': 0,
          [`Future Open PO Avg / ${pLabel} (${horizonLabel})`]: 0,
          'Future Open PO vs Supplier Cap (%)': 'N/A',
        })
      } else {
        for (const v of r.vendorRows) {
          vendorData.push({
            'Part Category': r.category.name,
            Unit: r.unit,
            'Vendor Code': v.code,
            'Supplier Name': v.name,
            'Cap Status': v.capStatus === 'confirmed' ? 'Confirmed' : 'Pending',
            [`Supplier Cap / ${pLabel}`]: v.capPerPeriod ? Math.round(v.capPerPeriod) : '',
            [`Category 12M Usage Avg / ${pLabel} (Ref)`]: Math.round(r.usage12MAvg),
            'Past 9M Purchases Total': Math.round(v.purch9MTotal),
            [`Past 9M Purch Avg / ${pLabel}`]: Math.round(v.purch9MAvg),
            'Part-Matched 12M Usage Total': Math.round(v.usage12MTotal),
            [`Part-Matched 12M Usage Avg / ${pLabel}`]: Math.round(v.usage12MAvg),
            'Open PO Total': Math.round(v.openTotal),
            'Past Due Qty': Math.round(v.pastDue),
            [`Future Open PO Avg / ${pLabel} (${horizonLabel})`]: Math.round(v.futureAvg),
            'Future Open PO vs Supplier Cap (%)': v.futureAvgCap > 0 ? `${Math.round((v.futureAvg / v.futureAvgCap) * 100)}%` : 'N/A',
          })
        }
      }
    }

    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.json_to_sheet(condensedData)
    ws1['!cols'] = [
      { wch: 24 }, { wch: 8 }, { wch: 15 }, { wch: 18 }, { wch: 18 },
      { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 16 },
      { wch: 14 }, { wch: 28 }, { wch: 22 }, { wch: 24 },
    ]
    const ws2 = XLSX.utils.json_to_sheet(vendorData)
    ws2['!cols'] = [
      { wch: 24 }, { wch: 8 }, { wch: 14 }, { wch: 36 }, { wch: 14 },
      { wch: 18 }, { wch: 26 }, { wch: 22 }, { wch: 22 }, { wch: 24 },
      { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 26 },
    ]

    XLSX.utils.book_append_sheet(wb, ws1, 'Condensed by Category')
    XLSX.utils.book_append_sheet(wb, ws2, 'Breakdown by Vendor')
    XLSX.writeFile(wb, `VTC_Past_And_Future_Category_Vendor_Analysis_${today}.xlsx`)
  }

  const rMeta = historyAnalytics?.receiptsMeta
  const tMeta = historyAnalytics?.transactionsMeta

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
        <div className="flex items-start gap-2.5">
          <span className="p-2 rounded-lg bg-indigo-100 text-indigo-700 mt-0.5">
            <History size={18} />
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Past vs. Future Demand &amp; Purchase Analysis by Part Category
            </h2>
            <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
              <span>Click any category row to expand its <b>Vendor Breakdown</b></span>
              <span>·</span>
              <span>
                <b>Past 9M Purchases:</b>{' '}
                {rMeta ? `${rMeta.file_name} (${fmtNum(rMeta.total_rows)} rows · up to ${rMeta.max_date || '—'})` : <a href="#/upload" className="text-amber-600 underline">Not uploaded yet →</a>}
              </span>
              <span>·</span>
              <span>
                <b>Past 12M Usage:</b>{' '}
                {tMeta ? `${tMeta.file_name} (${fmtNum(tMeta.total_rows)} rows · up to ${tMeta.max_date || '—'})` : <a href="#/upload" className="text-amber-600 underline">Not uploaded yet →</a>}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={expandedIds.size === categories.length ? collapseAll : expandAll}
            className="btn-outline text-xs px-2.5 py-1.5 flex items-center gap-1.5 bg-white cursor-pointer"
          >
            {expandedIds.size === categories.length ? (
              <><ChevronsDownUp size={13} /> Collapse All</>
            ) : (
              <><ChevronsUpDown size={13} /> Expand All Vendors</>
            )}
          </button>
          <a
            href="#/upload"
            className="btn-outline text-xs px-2.5 py-1.5 flex items-center gap-1.5 bg-white cursor-pointer"
            title="Upload or replace PO Receipts (9M) and Transactions (12M)"
          >
            <UploadIcon size={13} /> Upload History Files
          </a>
          <button
            type="button"
            onClick={handleExportExcel}
            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Export 2-sheet Excel workbook: 1) Condensed by Category, 2) Breakdown by Vendor"
          >
            <Download size={13} /> Export Analysis (2 Tabs .xlsx)
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-separate border-spacing-0">
          <thead>
            <tr className="bg-slate-100/80 text-[10px] uppercase tracking-wider text-slate-500">
              <th className="py-1.5 px-3 text-left border-b border-slate-200" colSpan={4}>
                Part Category / Supplier Breakdown
              </th>
              <th className="py-1.5 px-2 text-center border-b border-l border-cyan-200 bg-cyan-50/80 text-cyan-900" colSpan={2}>
                Past Purchases (Last 9 Months)
              </th>
              <th className="py-1.5 px-2 text-center border-b border-l border-amber-200 bg-amber-50/80 text-amber-900" colSpan={2}>
                Past Usage / Issues (Last 12 Months)
              </th>
              <th className="py-1.5 px-2 text-center border-b border-l border-indigo-200 bg-indigo-50/80 text-indigo-900" colSpan={4}>
                Future Open Orders ({horizonLabel})
              </th>
            </tr>
            <tr>
              <th className="th py-2 px-3 min-w-52">Category / Vendor</th>
              <th className="th py-2 px-2 text-right">Cap / {periodWord}</th>
              <th className="th py-2 px-2 text-center">Cap Status</th>
              <th className="th py-2 px-2 text-right">Demand / {periodWord}</th>

              {/* Past 9M Purchases */}
              <th className="th py-2 px-2 text-right bg-cyan-50/40 border-l border-cyan-200 text-cyan-900">
                9M Purch Total
              </th>
              <th className="th py-2 px-2 text-right bg-cyan-50/70 text-cyan-950 font-bold">
                9M Purch / {periodWord}
              </th>

              {/* Past 12M Usage */}
              <th className="th py-2 px-2 text-right bg-amber-50/40 border-l border-amber-200 text-amber-900">
                12M Usage Total
              </th>
              <th className="th py-2 px-2 text-right bg-amber-50/70 text-amber-950 font-bold">
                12M Usage / {periodWord}
              </th>

              {/* Future Open POs */}
              <th className="th py-2 px-2 text-right bg-indigo-50/30 border-l border-indigo-200">
                Open PO Total
              </th>
              <th className="th py-2 px-2 text-right bg-indigo-50/30 text-red-700">
                Past Due
              </th>
              <th className="th py-2 px-2 text-right bg-indigo-50/80 text-indigo-950 font-bold">
                Future PO / {periodWord}
              </th>
              <th className="th py-2 px-2 text-center bg-indigo-50/50 text-indigo-900">
                Future Util %
              </th>
            </tr>
          </thead>
          <tbody>
            {analysisRows.map((row) => {
              const isExp = expandedIds.has(row.category.id)
              const futLvl = utilLevel(row.futureAvg, row.futureAvgCap)
              return (
                <CategoryBlock
                  key={row.category.id}
                  row={row}
                  isExp={isExp}
                  futLvl={futLvl}
                  periodWord={periodWord}
                  onToggleExpand={() => toggleExpand(row.category.id)}
                  onToggleCapStatus={onToggleCapStatus}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CategoryBlock({ row, isExp, futLvl, periodWord, onToggleExpand, onToggleCapStatus }) {
  const { category, unit, vendorRows } = row

  return (
    <>
      {/* Condensed Category Row */}
      <tr
        onClick={onToggleExpand}
        className="bg-white hover:bg-slate-50 cursor-pointer font-semibold border-b border-slate-200 transition"
      >
        <td className="py-2 px-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">
              {isExp ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </span>
            <span className="text-slate-900 font-bold">{category.name}</span>
            <span className="text-[10px] font-normal text-slate-400">({unit})</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-500">
              {vendorRows.length} sup.
            </span>
          </div>
        </td>
        <td className="py-2 px-2 text-right border-b border-slate-200 font-mono text-slate-800">
          {row.capPerPeriod ? fmtNum(Math.round(row.capPerPeriod)) : <span className="text-slate-300">—</span>}
        </td>
        <td className="py-2 px-2 text-center border-b border-slate-200 text-[10px] text-slate-500">
          {row.confirmedCount}/{row.totalSuppliers} conf.
        </td>
        <td className="py-2 px-2 text-right border-b border-slate-200 font-mono text-purple-700">
          {row.demandPerPeriod ? fmtNum(Math.round(row.demandPerPeriod)) : <span className="text-slate-300">—</span>}
        </td>

        {/* Past 9M Purchases */}
        <td className="py-2 px-2 text-right border-b border-l border-cyan-100 bg-cyan-50/20 font-mono text-slate-600">
          {row.purch9MTotal > 0 ? fmtCompact(row.purch9MTotal) : <span className="text-slate-300">·</span>}
        </td>
        <td className="py-2 px-2 text-right border-b border-slate-200 bg-cyan-50/50 font-mono font-bold text-cyan-900">
          {row.purch9MAvg > 0 ? fmtNum(Math.round(row.purch9MAvg)) : <span className="text-slate-300">·</span>}
        </td>

        {/* Past 12M Usage */}
        <td className="py-2 px-2 text-right border-b border-l border-amber-100 bg-amber-50/20 font-mono text-slate-600">
          {row.usage12MTotal > 0 ? fmtCompact(row.usage12MTotal) : <span className="text-slate-300">·</span>}
        </td>
        <td className="py-2 px-2 text-right border-b border-slate-200 bg-amber-50/50 font-mono font-bold text-amber-900">
          {row.usage12MAvg > 0 ? fmtNum(Math.round(row.usage12MAvg)) : <span className="text-slate-300">·</span>}
        </td>

        {/* Future Open POs */}
        <td className="py-2 px-2 text-right border-b border-l border-indigo-100 bg-indigo-50/15 font-mono text-slate-800">
          {row.openTotal > 0 ? fmtNum(Math.round(row.openTotal)) : <span className="text-slate-300">0</span>}
        </td>
        <td className={`py-2 px-2 text-right border-b border-slate-200 bg-indigo-50/15 font-mono ${row.pastDue > 0 ? 'text-red-600 font-bold' : 'text-slate-300'}`}>
          {row.pastDue > 0 ? fmtCompact(row.pastDue) : '·'}
        </td>
        <td className="py-2 px-2 text-right border-b border-slate-200 bg-indigo-50/50 font-mono font-bold text-indigo-900">
          {row.futureAvg > 0 ? fmtNum(Math.round(row.futureAvg)) : <span className="text-slate-300">·</span>}
        </td>
        <td className={`py-2 px-2 text-center border-b border-slate-200 font-mono ${row.futureAvg > 0 ? LEVEL_STYLES[futLvl].cell : 'text-slate-300'}`}>
          {row.futureAvgCap > 0 && row.futureAvg > 0 ? pct(row.futureAvg, row.futureAvgCap) : '·'}
        </td>
      </tr>

      {/* Expanded Vendor Breakdown Rows */}
      {isExp &&
        vendorRows.map((v) => {
          const vFutLvl = utilLevel(v.futureAvg, v.futureAvgCap)
          const isConf = v.capStatus === 'confirmed'
          return (
            <tr key={`${category.id}_${v.code}`} className="bg-slate-50/70 hover:bg-slate-100/70 text-slate-700">
              <td className="py-1.5 pl-9 pr-3 border-b border-slate-200/70">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-xs shrink-0" style={{ background: v.color }} />
                  <span className="truncate font-medium text-slate-800 max-w-52" title={`${v.name} (${v.code})`}>
                    {v.name}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">({v.code})</span>
                </div>
              </td>
              <td className="py-1.5 px-2 text-right border-b border-slate-200/70 font-mono text-slate-600">
                {v.capPerPeriod ? fmtNum(Math.round(v.capPerPeriod)) : <span className="text-slate-300">—</span>}
              </td>
              <td className="py-1.5 px-2 text-center border-b border-slate-200/70">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleCapStatus?.(category.id, v.code, v.weeklyCap)
                  }}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[10px] font-semibold border cursor-pointer ${
                    isConf
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}
                >
                  {isConf ? <CheckCircle2 size={10} /> : <Clock3 size={10} />}
                  <span>{isConf ? 'Confirmed' : 'Pending'}</span>
                </button>
              </td>
              <td className="py-1.5 px-2 text-right border-b border-slate-200/70 text-slate-300">—</td>

              {/* Supplier Past 9M Purchases */}
              <td className="py-1.5 px-2 text-right border-b border-l border-cyan-100 bg-cyan-50/10 font-mono text-slate-500">
                {v.purch9MTotal > 0 ? fmtCompact(v.purch9MTotal) : <span className="text-slate-300">·</span>}
              </td>
              <td className="py-1.5 px-2 text-right border-b border-slate-200/70 bg-cyan-50/30 font-mono font-semibold text-cyan-800">
                {v.purch9MAvg > 0 ? fmtNum(Math.round(v.purch9MAvg)) : <span className="text-slate-300">·</span>}
              </td>

              {/* Supplier Part-Matched 12M Usage */}
              <td className="py-1.5 px-2 text-right border-b border-l border-amber-100 bg-amber-50/10 font-mono text-slate-500">
                {v.usage12MTotal > 0 ? fmtCompact(v.usage12MTotal) : <span className="text-slate-300" title="Usage is tracked by Part Category in ERP">·</span>}
              </td>
              <td className="py-1.5 px-2 text-right border-b border-slate-200/70 bg-amber-50/30 font-mono font-semibold text-amber-800">
                {v.usage12MAvg > 0 ? fmtNum(Math.round(v.usage12MAvg)) : <span className="text-slate-300" title="Usage is tracked by Part Category in ERP">·</span>}
              </td>

              {/* Supplier Future Open POs */}
              <td className="py-1.5 px-2 text-right border-b border-l border-indigo-100 font-mono text-slate-700">
                {v.openTotal > 0 ? fmtNum(Math.round(v.openTotal)) : <span className="text-slate-300">0</span>}
              </td>
              <td className={`py-1.5 px-2 text-right border-b border-slate-200/70 font-mono ${v.pastDue > 0 ? 'text-red-600 font-semibold' : 'text-slate-300'}`}>
                {v.pastDue > 0 ? fmtCompact(v.pastDue) : '·'}
              </td>
              <td className="py-1.5 px-2 text-right border-b border-slate-200/70 bg-indigo-50/30 font-mono font-semibold text-indigo-800">
                {v.futureAvg > 0 ? fmtNum(Math.round(v.futureAvg)) : <span className="text-slate-300">·</span>}
              </td>
              <td className={`py-1.5 px-2 text-center border-b border-slate-200/70 font-mono ${v.futureAvg > 0 ? LEVEL_STYLES[vFutLvl].cell : 'text-slate-300'}`}>
                {v.futureAvgCap > 0 && v.futureAvg > 0 ? pct(v.futureAvg, v.futureAvgCap) : '·'}
              </td>
            </tr>
          )
        })}
    </>
  )
}
