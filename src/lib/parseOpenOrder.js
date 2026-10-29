import * as XLSX from 'xlsx'

// Header in file -> column in public.open_orders.
// Supports both the legacy format and the new format (PO Nbr, Div, Itm, Part.Number, Ship{Date, etc.)
// "VTC COMMENTS" appears twice in some files: 1st -> vtc_comments, 2nd -> vtc_comments_2
const HEADER_MAP = {
  // Line ID
  'ID': 'line_id',
  'LINE ID': 'line_id',

  // PO
  'PO': 'po',
  'PO NBR': 'po',
  'PO NUMBER': 'po',
  'PO NO': 'po',
  'PO #': 'po',
  'PURCHASE ORDER': 'po',

  // Div
  'DIV': 'div',
  'DIVISION': 'div',
  'PLANT': 'div',

  // Item / Line
  'ITM': 'item',
  'ITEM': 'item',
  'LINE': 'item',
  'LINE NBR': 'item',
  'LINE NO': 'item',

  // Buyer
  'BYR': 'buyer',
  'BUYER': 'buyer',

  // Vendor Code
  'VENDOR': 'vendor_code',
  'VENDOR CODE': 'vendor_code',
  'VENDOR NBR': 'vendor_code',
  'VENDOR NO': 'vendor_code',
  'VENDOR #': 'vendor_code',
  'SUPPLIER': 'vendor_code',
  'SUPPLIER CODE': 'vendor_code',

  // Vendor Name
  'VENDOR NAME': 'vendor_name',
  'SUPPLIER NAME': 'vendor_name',

  // PO Date
  'PO DATE': 'po_date',
  'ORDER DATE': 'po_date',

  // Part Number
  'PART NUMBER': 'part_number',
  'PART.NUMBER': 'part_number',
  'PART NO': 'part_number',
  'PART NBR': 'part_number',
  'PART': 'part_number',
  'ITEM NUMBER': 'part_number',

  // Description
  'DESCRIPTION': 'description',
  'DESC': 'description',
  'PART DESCRIPTION': 'description',

  // Vendor Part Number
  'VEN.PART.NBR': 'vendor_part_number',
  'VEN PART.NBR': 'vendor_part_number',
  'VEN PART NBR': 'vendor_part_number',
  'VENDOR PART NUMBER': 'vendor_part_number',
  'VENDOR PART NO': 'vendor_part_number',
  'VEN.PART.NO': 'vendor_part_number',

  // Delivery Date
  'DELIVERY DATE': 'delivery_date',
  'DLV DATE': 'delivery_date',
  'DELIVERY': 'delivery_date',
  'DUE DATE': 'delivery_date',

  // Line Confirmation
  'LINE CONFIRMED': 'line_confirmed',
  'CONF CODE': 'line_confirmed',
  'CONF{CODE': 'line_confirmed',
  'CONFIRMATION': 'line_confirmed',
  'CONF STATUS': 'line_confirmed',

  // Ship Date
  'SHIP DATE': 'ship_date',
  'SHIP{DATE': 'ship_date',
  'SHIPPED DATE': 'ship_date',
  'PROMISED DATE': 'ship_date',
  'PROMISE DATE': 'ship_date',

  // Quantities
  'ORD QTY': 'ord_qty',
  'ORDER QTY': 'ord_qty',
  'ORDERED QTY': 'ord_qty',
  'QTY ORDERED': 'ord_qty',

  'BAL QTY': 'bal_qty',
  'BALANCE QTY': 'bal_qty',
  'OPEN QTY': 'bal_qty',
  'REMAINING QTY': 'bal_qty',

  // Prices
  'UNIT PRICE': 'unit_price',
  'PRICE': 'unit_price',
  'EXT PRICE': 'ext_price',
  'EXTENDED PRICE': 'ext_price',

  // Job Reference
  'JOB REFERENCE': 'job_reference',
  'JOB': 'job_reference',
  'ROUTE TO/JOBS': 'job_reference',
  'ROUTE TO / JOBS': 'job_reference',
  'ROUTE TO': 'job_reference',

  // Remarks & Comments
  'REMARKS': 'remarks',
  'REMARK': 'remarks',
  'COMMENTS': 'remarks',
  'PO STATUS': 'po_status',
  'STATUS': 'po_status',
  'VTC COMMENTS': ['vtc_comments', 'vtc_comments_2'],
  "EPPM'S/HOT LIST": 'eppm_hot_list',
  'TRACKING/CONTAINER #': 'tracking_container',
  'CARRIER': 'carrier',
  'TRACKING/CONTAINER ETA': 'tracking_container_eta',
  'CONTAINER TO LIVINGSTON DATE': 'container_to_livingston_date',
  'CONTROL #': 'control_number',
  'IMPO DATE': 'impo_date',
  'SUPPLIER COMMENTS': 'supplier_comments',
  'CLASS': 'class',
}

const REQUIRED_FIELDS = [
  { field: 'part_number', label: 'PART NUMBER' },
  { field: 'bal_qty', label: 'BAL QTY' },
  { field: 'ship_date', label: 'SHIP DATE' },
  { field: 'vendor_code', label: 'VENDOR' },
]

const DATE_COLS = new Set(['po_date', 'ship_date', 'delivery_date'])
const INT_COLS = new Set(['div', 'item'])
const NUM_COLS = new Set(['ord_qty', 'bal_qty', 'unit_price', 'ext_price'])

export const normHeader = (h) =>
  String(h ?? '')
    .replace(/[{}_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

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

  const isPartMatch = (c) => {
    const h = normHeader(c)
    return h === 'PART NUMBER' || h === 'PART.NUMBER' || h === 'PART NO' || h === 'PART NBR' || h === 'PART'
  }

  // Find header row (row containing PART NUMBER or BAL QTY)
  const headerIdx = matrix.findIndex((r) => {
    if (!Array.isArray(r)) return false
    const rowHeaders = r.map(normHeader)
    return rowHeaders.some(isPartMatch) || rowHeaders.some((h) => h === 'BAL QTY' || h === 'BALANCE QTY')
  })

  if (headerIdx < 0) {
    throw new Error('Could not find a header row with "PART NUMBER" or "BAL QTY".')
  }

  const rawHeaders = matrix[headerIdx]
  const seen = {}
  const colMap = rawHeaders.map((h) => {
    const nh = normHeader(h)
    let target = HEADER_MAP[nh]
    if (!target) {
      target = HEADER_MAP[nh.replace(/\./g, ' ')] || HEADER_MAP[nh.replace(/\./g, '')]
    }
    if (!target) return null
    if (Array.isArray(target)) {
      const i = seen[nh] = (seen[nh] ?? -1) + 1
      return target[i] ?? null
    }
    return target
  })

  // Validate required fields
  const mappedFields = new Set(colMap.filter(Boolean))
  const missing = REQUIRED_FIELDS.filter((rf) => !mappedFields.has(rf.field))
  if (missing.length) {
    throw new Error(`Missing required column(s): ${missing.map((m) => m.label).join(', ')}`)
  }

  const warnings = []
  const unknown = rawHeaders.filter((h, i) => h && !colMap[i])
  if (unknown.length) {
    warnings.push(`Ignored extra column(s): ${unknown.map((u) => String(u).trim()).join(', ')}`)
  }

  const today = new Date().toISOString().slice(0, 10)
  const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

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

    // Auto-fill line_id if missing (e.g. "571931*9")
    if (!row.line_id && row.po) {
      row.line_id = (row.item !== null && row.item !== undefined) ? `${row.po}*${row.item}` : String(row.po)
    }

    // Auto-compute po_status if missing from file
    if (!row.po_status && row.ship_date) {
      if (row.ship_date < today) {
        row.po_status = 'PAST DUE'
      } else if (row.ship_date <= next7) {
        row.po_status = 'DUE IN 7 DAYS'
      } else {
        row.po_status = 'ON TIME'
      }
    }

    rows.push(row)
  }
  return { rows, warnings }
}

/** First 4 chars of a part number, uppercase (same rule as the DB generated column). */
export const prefixOf = (pn) => String(pn ?? '').trim().slice(0, 4).toUpperCase()
