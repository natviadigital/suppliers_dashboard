import * as XLSX from 'xlsx'

// Header in file -> column in public.open_orders.
// "VTC COMMENTS" appears twice: 1st -> vtc_comments, 2nd -> vtc_comments_2
const HEADER_MAP = {
  'ID': 'line_id',
  'DIV': 'div',
  'CLASS': 'class',
  'BYR': 'buyer',
  'VENDOR': 'vendor_code',
  'VENDOR NAME': 'vendor_name',
  'PO': 'po',
  'ITM': 'item',
  'PART NUMBER': 'part_number',
  'DESCRIPTION': 'description',
  'VEN.PART.NBR': 'vendor_part_number',
  'PO DATE': 'po_date',
  'SHIP DATE': 'ship_date',
  'DELIVERY DATE': 'delivery_date',
  'ORD QTY': 'ord_qty',
  'BAL QTY': 'bal_qty',
  'UNIT PRICE': 'unit_price',
  'EXT PRICE': 'ext_price',
  'LINE CONFIRMED': 'line_confirmed',
  'REMARKS': 'remarks',
  'JOB REFERENCE': 'job_reference',
  'PO STATUS': 'po_status',
  'VTC COMMENTS': ['vtc_comments', 'vtc_comments_2'],
  "EPPM'S/HOT LIST": 'eppm_hot_list',
  'TRACKING/CONTAINER #': 'tracking_container',
  'CARRIER': 'carrier',
  'TRACKING/CONTAINER ETA': 'tracking_container_eta',
  'CONTAINER TO LIVINGSTON DATE': 'container_to_livingston_date',
  'CONTROL #': 'control_number',
  'IMPO DATE': 'impo_date',
  'SUPPLIER COMMENTS': 'supplier_comments',
}

const REQUIRED = ['PART NUMBER', 'BAL QTY', 'SHIP DATE', 'VENDOR']
const DATE_COLS = new Set(['po_date', 'ship_date', 'delivery_date'])
const INT_COLS = new Set(['div', 'item'])
const NUM_COLS = new Set(['ord_qty', 'bal_qty', 'unit_price', 'ext_price'])

const normHeader = (h) => String(h ?? '').replace(/\s+/g, ' ').trim().toUpperCase()

const pad = (n) => String(n).padStart(2, '0')

/** Any cell value -> 'YYYY-MM-DD' or null */
export function toISODate(v) {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !isNaN(v)) {
    // +12h guards against timezone/second offsets around midnight
    const d = new Date(v.getTime() + 12 * 3600 * 1000)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  if (typeof v === 'number') {
    const p = XLSX.SSF.parse_date_code(v)
    return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/) // M/D/YYYY
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return `${y}-${pad(m[1])}-${pad(m[2])}`
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  return null
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''))
  return isNaN(n) ? null : n
}

function toText(v) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return toISODate(v)
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * Parses an Open Order file (.xlsx / .xls / .csv / .txt tab-separated).
 * Returns { rows, warnings } where rows match public.open_orders columns.
 */
export async function parseOpenOrderFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: false, dense: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false })

  // Find header row (first row containing "PART NUMBER")
  const headerIdx = matrix.findIndex((r) => r.some((c) => normHeader(c) === 'PART NUMBER'))
  if (headerIdx < 0) throw new Error('Could not find a header row with "PART NUMBER".')
  const headers = matrix[headerIdx].map(normHeader)

  const missing = REQUIRED.filter((h) => !headers.includes(h))
  if (missing.length) throw new Error(`Missing required column(s): ${missing.join(', ')}`)

  // Column index -> db field
  const seen = {}
  const colMap = headers.map((h) => {
    const target = HEADER_MAP[h]
    if (!target) return null
    if (Array.isArray(target)) {
      const i = seen[h] = (seen[h] ?? -1) + 1
      return target[i] ?? null
    }
    return target
  })

  const warnings = []
  const unknown = headers.filter((h, i) => h && !colMap[i])
  if (unknown.length) warnings.push(`Ignored unknown column(s): ${unknown.join(', ')}`)

  const rows = []
  for (const r of matrix.slice(headerIdx + 1)) {
    const row = {}
    colMap.forEach((field, i) => {
      if (!field) return
      const v = r[i]
      if (DATE_COLS.has(field)) row[field] = toISODate(v)
      else if (INT_COLS.has(field)) { const n = toNumber(v); row[field] = n === null ? null : Math.round(n) }
      else if (NUM_COLS.has(field)) row[field] = toNumber(v)
      else row[field] = toText(v)
    })
    if (!row.part_number) continue
    rows.push(row)
  }
  return { rows, warnings }
}

/** First 4 chars of a part number, uppercase (same rule as the DB generated column). */
export const prefixOf = (pn) => String(pn ?? '').trim().slice(0, 4).toUpperCase()
