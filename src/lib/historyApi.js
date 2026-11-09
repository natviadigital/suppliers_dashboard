import * as XLSX from 'xlsx'
import { supabase } from './supabase'
import { normHeader, prefixOf } from './parseOpenOrder'

// Special tags in public.uploads (with status = 'replaced') to persist history cubes in Supabase
// without interfering with loadCurrentUpload() (which only queries status = 'current')
const RECEIPTS_TAG_ROW = -9001
const TRANSACTIONS_TAG_ROW = -9002
const CHUNK_STR_LIMIT = 180000 // ~180 KB per chunk row in public.uploads.file_name

const LS_RECEIPTS_CUBE = 'vtc_po_receipts_cube_v1'
const LS_TRANSACTIONS_CUBE = 'vtc_transactions_cube_v1'

const pad2 = (n) => String(n).padStart(2, '0')

/**
 * Ultra-fast Excel serial / Date / String to ISO 'YYYY-MM-DD' converter
 * Optimized for 264k+ row spreadsheets.
 */
export function fastToISODate(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) {
      // Excel serial date (days since 1899-12-30)
      const utcMs = Math.round((v - 25569) * 86400 * 1000) + 12 * 3600 * 1000
      const d = new Date(utcMs)
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
    }
    return null
  }
  if (v instanceof Date && !isNaN(v)) {
    const d = new Date(v.getTime() + 12 * 3600 * 1000)
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  }
  const s = String(v).trim()
  if (!s) return null
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`
  // M/D/YYYY or M/D/YY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return `${y}-${pad2(m[1])}-${pad2(m[2])}`
  }
  // DD-MMM-YY or DD-MMM-YYYY
  const d = new Date(s)
  if (!isNaN(d)) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  }
  return null
}

/** Given an ISO date 'YYYY-MM-DD', returns the Monday 'YYYY-MM-DD' of that week. */
export function mondayOfISODate(iso) {
  if (!iso) return 'NO_DATE'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return 'NO_DATE'
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay() // 0 = Sun, 1 = Mon, ...
  const diff = day === 0 ? -6 : 1 - day
  dt.setUTCDate(dt.getUTCDate() + diff)
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}

function fastToNum(v) {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return isNaN(v) ? 0 : v
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''))
  return isNaN(n) ? 0 : n
}

export const normVendorStr = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

const stripVendorSuffixes = (s) =>
  normVendorStr(s)
    .replace(/[.,\-()/]/g, ' ')
    .replace(/\b(CO|LTD|LIMITED|INC|INCORPORATED|LLC|SA|DE|CV|S|RL|PVT|PRIVATE|CORP|CORPORATION|A S|AS)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Matches a raw vendor name (or code) from PO Receipts to a vendor in master.vendors.
 * Prefers active non-interplant vendors or vendors that have assigned capacity.
 */
export function buildVendorMatcher(master) {
  const vendors = [...(master?.vendors || [])]
  const capVendorSet = new Set((master?.capacities || []).map((c) => c.vendor_code))

  // Sort so non-interplant and capacity-assigned vendors come first (e.g. VTCW P1 active supplier before old interplant entry)
  vendors.sort((a, b) => {
    const aCap = capVendorSet.has(a.vendor_code) ? 1 : 0
    const bCap = capVendorSet.has(b.vendor_code) ? 1 : 0
    if (aCap !== bCap) return bCap - aCap
    if (a.is_interplant !== b.is_interplant) return a.is_interplant ? 1 : -1
    return 0
  })

  const byExactCode = new Map()
  const byExactName = new Map()
  const byStripped = new Map()
  const list = []

  for (const v of vendors) {
    const c = normVendorStr(v.vendor_code)
    const n = normVendorStr(v.vendor_name)
    const st = stripVendorSuffixes(v.vendor_name)
    if (c && !byExactCode.has(c)) byExactCode.set(c, v)
    if (n && !byExactName.has(n)) byExactName.set(n, v)
    if (st && !byStripped.has(st)) byStripped.set(st, v)
    list.push({ v, c, n, st, firstToken: st.split(' ')[0] || '' })
  }

  // Known aliases (e.g. Industrias LTG renamed to VTCW P1)
  const cache = new Map()

  return function matchVendor(rawName, rawCode = '') {
    const key = `${rawCode}|${rawName}`
    if (cache.has(key)) return cache.get(key)

    const codeNorm = normVendorStr(rawCode)
    const nameNorm = normVendorStr(rawName)

    if (codeNorm && byExactCode.has(codeNorm)) {
      const res = byExactCode.get(codeNorm)
      cache.set(key, res)
      return res
    }
    if (nameNorm && byExactName.has(nameNorm)) {
      const res = byExactName.get(nameNorm)
      cache.set(key, res)
      return res
    }
    if (nameNorm && byExactCode.has(nameNorm)) {
      const res = byExactCode.get(nameNorm)
      cache.set(key, res)
      return res
    }

    // Special alias check for VTCW P1 / INDUSTRIAS LTG
    if (nameNorm === 'VTCW P1' || nameNorm === 'INDUSTRIAS LTG SA DE CV' || nameNorm.startsWith('INDUSTRIAS LTG')) {
      const found =
        vendors.find((x) => !x.is_interplant && (normVendorStr(x.vendor_name) === 'VTCW P1' || x.vendor_code === '10602P' || x.vendor_code === 'VTCW P1')) ||
        byExactName.get('VTCW P1')
      if (found) {
        cache.set(key, found)
        return found
      }
    }

    const st = stripVendorSuffixes(nameNorm)
    if (st && byStripped.has(st)) {
      const res = byStripped.get(st)
      cache.set(key, res)
      return res
    }

    // Prefix / substring match for truncated ERP vendor names (e.g. "LIAONINGXD XINGQI ELECTRIC MATERI...")
    if (st.length >= 5) {
      for (const item of list) {
        if (item.st.length >= 5 && (item.st.startsWith(st) || st.startsWith(item.st))) {
          cache.set(key, item.v)
          return item.v
        }
      }
      const firstTok = st.split(' ')[0]
      if (firstTok && firstTok.length >= 5 && !['GRUPO', 'INDUSTRIAS', 'ELECTRICAL', 'HONG'].includes(firstTok)) {
        const hit = list.find((item) => item.firstToken === firstTok)
        if (hit) {
          cache.set(key, hit.v)
          return hit.v
        }
      }
    }

    cache.set(key, null)
    return null
  }
}

// ============================================================================
// 1. PARSE PO RECEIPTS FILE (Screenshot 1: DIV, CLASS, PART NUMBER, DESCRIPTION,
//    UM, LT, REFERENCE, RECEIPT DATE / RECEIPT DA, QTY, VENDOR NAME)
// ============================================================================
const RECEIPTS_HEADER_MAP = {
  'DIV': 'div',
  'DIVISION': 'div',
  'PLANT': 'div',
  'CLASS': 'class',
  'PART NUMBER': 'part_number',
  'PART NUMBE': 'part_number',
  'PART.NUMBER': 'part_number',
  'PART NO': 'part_number',
  'PART NBR': 'part_number',
  'PART': 'part_number',
  'ITEM NUMBER': 'part_number',
  'DESCRIPTION': 'description',
  'DESC': 'description',
  'UM': 'um',
  'UOM': 'um',
  'LT': 'lt',
  'LEAD TIME': 'lt',
  'REFERENCE': 'reference',
  'REF': 'reference',
  'PO': 'reference',
  'RECEIPT DATE': 'receipt_date',
  'RECEIPT DA': 'receipt_date',
  'RECEIPT DT': 'receipt_date',
  'RCV DATE': 'receipt_date',
  'RECEIVED DATE': 'receipt_date',
  'DATE': 'receipt_date',
  'QTY': 'qty',
  'QUANTITY': 'qty',
  'RECEIPT QTY': 'qty',
  'RCV QTY': 'qty',
  'VENDOR NAME': 'vendor_name',
  'SUPPLIER NAME': 'vendor_name',
  'VENDOR': 'vendor_code',
  'VENDOR CODE': 'vendor_code',
  'SUPPLIER': 'vendor_code',
}

function mapReceiptHeader(raw) {
  const h = normHeader(raw)
  if (RECEIPTS_HEADER_MAP[h]) return RECEIPTS_HEADER_MAP[h]
  if (h.startsWith('RECEIPT D')) return 'receipt_date'
  if (h.startsWith('PART NUM')) return 'part_number'
  if (h.startsWith('VENDOR N') || h.startsWith('SUPPLIER N')) return 'vendor_name'
  return null
}

export async function parsePoReceiptsFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, raw: true, dense: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false })
  if (!matrix.length) throw new Error('The PO Receipts file is empty.')

  let headerRowIdx = 0
  let cols = []
  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const candidate = (matrix[r] || []).map(mapReceiptHeader)
    const found = new Set(candidate.filter(Boolean))
    if (found.has('part_number') && found.has('qty')) {
      headerRowIdx = r
      cols = candidate
      break
    }
  }
  if (!cols.length) {
    cols = (matrix[0] || []).map(mapReceiptHeader)
  }

  const foundSet = new Set(cols.filter(Boolean))
  if (!foundSet.has('part_number') || !foundSet.has('qty')) {
    throw new Error('Missing required columns in PO Receipts file: PART NUMBER and QTY (plus RECEIPT DATE and VENDOR NAME).')
  }

  const idxOf = (field) => cols.indexOf(field)
  const iDiv = idxOf('div')
  const iPart = idxOf('part_number')
  const iDate = idxOf('receipt_date')
  const iQty = idxOf('qty')
  const iVendorName = idxOf('vendor_name')
  const iVendorCode = idxOf('vendor_code')

  // Aggregate into weekly buckets by: prefix | vendorName | vendorCode | div | weekMonday
  // Tuple format: [prefix, vendorNameNorm, vendorCodeNorm, div, weekMonday, sumQty, rowCount]
  const bucketMap = new Map()
  // Also track partPrefix|partNumber -> top vendorNameNorm for linking transactions to vendors
  const partVendorQty = new Map()

  let totalRows = 0
  let validRows = 0
  let minDate = null
  let maxDate = null

  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r]
    if (!row) continue
    const rawPart = iPart >= 0 ? row[iPart] : null
    if (rawPart === null || rawPart === undefined || rawPart === '') continue
    totalRows++

    const partStr = String(rawPart).trim().toUpperCase()
    const prefix = prefixOf(partStr)
    if (!prefix || prefix.length < 2) continue

    const qty = iQty >= 0 ? fastToNum(row[iQty]) : 0
    if (!qty) continue

    const isoDate = iDate >= 0 ? fastToISODate(row[iDate]) : null
    if (isoDate) {
      if (!minDate || isoDate < minDate) minDate = isoDate
      if (!maxDate || isoDate > maxDate) maxDate = isoDate
    }
    const wk = mondayOfISODate(isoDate)
    const div = iDiv >= 0 && row[iDiv] != null && row[iDiv] !== '' ? parseInt(row[iDiv], 10) || 0 : 0
    const vName = iVendorName >= 0 ? normVendorStr(row[iVendorName]) : ''
    const vCode = iVendorCode >= 0 ? normVendorStr(row[iVendorCode]) : ''
    const effectiveVendorName = vName || vCode || 'UNKNOWN'

    validRows++
    const bKey = `${prefix}|${effectiveVendorName}|${vCode}|${div}|${wk}`
    const prev = bucketMap.get(bKey)
    if (prev) {
      prev[5] += qty
      prev[6] += 1
    } else {
      bucketMap.set(bKey, [prefix, effectiveVendorName, vCode, div, wk, qty, 1])
    }

    // Track part -> vendor weight for prefixes starting with monitored/standard characters
    const pvKey = `${partStr}|${effectiveVendorName}`
    partVendorQty.set(pvKey, (partVendorQty.get(pvKey) || 0) + qty)
  }

  // Condense partVendorQty to top vendor per part_number (only keep up to 4000 parts to stay compact)
  const bestVendorByPart = new Map()
  for (const [pvKey, q] of partVendorQty.entries()) {
    const sep = pvKey.indexOf('|')
    const part = pvKey.slice(0, sep)
    const vend = pvKey.slice(sep + 1)
    const cur = bestVendorByPart.get(part)
    if (!cur || q > cur.q) {
      bestVendorByPart.set(part, { v: vend, q })
    }
  }
  const partVendorPairs = []
  for (const [part, obj] of bestVendorByPart.entries()) {
    if (partVendorPairs.length < 5000) {
      partVendorPairs.push([part, obj.v])
    }
  }

  const cube = {
    version: 1,
    kind: 'po_receipts',
    file_name: file.name,
    total_rows: totalRows,
    valid_rows: validRows,
    min_date: minDate,
    max_date: maxDate,
    uploaded_at: new Date().toISOString(),
    // [prefix, vendorNameNorm, vendorCodeNorm, div, weekMonday, sumQty, rowCount]
    buckets: [...bucketMap.values()].map((b) => [b[0], b[1], b[2], b[3], b[4], Math.round(b[5] * 100) / 100, b[6]]),
    part_vendors: partVendorPairs,
  }

  return cube
}

// ============================================================================
// 2. PARSE INVENTORY TRANSACTIONS FILE (Screenshot 2: CLASS, PART NUMBER /
//    PART NUMBE, DESCRIPTION, DIV, REFERENCE, DATE, SUBASSY, TYPE, ID, QTY)
// ============================================================================
const TX_HEADER_MAP = {
  'CLASS': 'class',
  'PART NUMBER': 'part_number',
  'PART NUMBE': 'part_number',
  'PART.NUMBER': 'part_number',
  'PART NO': 'part_number',
  'PART NBR': 'part_number',
  'PART': 'part_number',
  'ITEM NUMBER': 'part_number',
  'DESCRIPTION': 'description',
  'DESC': 'description',
  'DIV': 'div',
  'DIVISION': 'div',
  'PLANT': 'div',
  'REFERENCE': 'reference',
  'REF': 'reference',
  'DATE': 'tx_date',
  'TRANS DATE': 'tx_date',
  'TRANSACTION DATE': 'tx_date',
  'ISSUE DATE': 'tx_date',
  'SUBASSY': 'subassy',
  'SUB ASSY': 'subassy',
  'SUB-ASSY': 'subassy',
  'SUBASSEMBLY': 'subassy',
  'TYPE': 'tx_type',
  'TRANS TYPE': 'tx_type',
  'ID': 'tx_id',
  'QTY': 'qty',
  'QUANTITY': 'qty',
  'TRANS QTY': 'qty',
  'ISSUE QTY': 'qty',
}

function mapTxHeader(raw) {
  const h = normHeader(raw)
  if (TX_HEADER_MAP[h]) return TX_HEADER_MAP[h]
  if (h.startsWith('PART NUM')) return 'part_number'
  if (h.startsWith('SUBASS') || h.startsWith('SUB ASS')) return 'subassy'
  return null
}

export async function parseTransactionsFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, raw: true, dense: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false })
  if (!matrix.length) throw new Error('The Transactions file is empty.')

  let headerRowIdx = 0
  let cols = []
  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const candidate = (matrix[r] || []).map(mapTxHeader)
    const found = new Set(candidate.filter(Boolean))
    if (found.has('part_number') && found.has('qty')) {
      headerRowIdx = r
      cols = candidate
      break
    }
  }
  if (!cols.length) {
    cols = (matrix[0] || []).map(mapTxHeader)
  }

  const foundSet = new Set(cols.filter(Boolean))
  if (!foundSet.has('part_number') || !foundSet.has('qty')) {
    throw new Error('Missing required columns in Transactions file: PART NUMBER and QTY (plus DATE / SUBASSY / DIV).')
  }

  const idxOf = (field) => cols.indexOf(field)
  const iPart = idxOf('part_number')
  const iSubassy = idxOf('subassy')
  const iDiv = idxOf('div')
  const iDate = idxOf('tx_date')
  const iType = idxOf('tx_type')
  const iQty = idxOf('qty')

  // Aggregate into weekly buckets by: [p1, p2, div, weekMonday, sumQty, rowCount]
  // where p1 = prefixOf(part_number), p2 = prefixOf(subassy)
  const bucketMap = new Map()
  // Also track part-level usage by [partNumber, p1, p2, div, weekMonday, sumQty] for parts that might match a vendor
  const partMap = new Map()

  let totalRows = 0
  let validRows = 0
  let minDate = null
  let maxDate = null

  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r]
    if (!row) continue
    const rawPart = iPart >= 0 ? row[iPart] : null
    const rawSub = iSubassy >= 0 ? row[iSubassy] : null
    if ((rawPart === null || rawPart === '') && (rawSub === null || rawSub === '')) continue
    totalRows++

    const qty = iQty >= 0 ? fastToNum(row[iQty]) : 0
    if (!qty) continue

    const partStr = rawPart != null ? String(rawPart).trim().toUpperCase() : ''
    const subStr = rawSub != null ? String(rawSub).trim().toUpperCase() : ''
    const p1 = prefixOf(partStr) || ''
    const p2 = prefixOf(subStr) || ''
    if (!p1 && !p2) continue

    const isoDate = iDate >= 0 ? fastToISODate(row[iDate]) : null
    if (isoDate) {
      if (!minDate || isoDate < minDate) minDate = isoDate
      if (!maxDate || isoDate > maxDate) maxDate = isoDate
    }
    const wk = mondayOfISODate(isoDate)
    const div = iDiv >= 0 && row[iDiv] != null && row[iDiv] !== '' ? parseInt(row[iDiv], 10) || 0 : 0

    validRows++
    const bKey = `${p1}|${p2}|${div}|${wk}`
    const prev = bucketMap.get(bKey)
    if (prev) {
      prev[4] += qty
      prev[5] += 1
    } else {
      bucketMap.set(bKey, [p1, p2, div, wk, qty, 1])
    }

    // Store part-level summary by month for parts that start with 12 or have subassy
    if (partStr && (p1.startsWith('12') || p2.startsWith('12') || p1.startsWith('PB') || p2.startsWith('CB'))) {
      const ym = isoDate ? isoDate.slice(0, 7) : 'NO_DATE'
      const pKey = `${partStr}|${p1}|${p2}|${div}|${ym}`
      const pPrev = partMap.get(pKey)
      if (pPrev) {
        pPrev[5] += qty
      } else if (partMap.size < 6000) {
        partMap.set(pKey, [partStr, p1, p2, div, ym, qty])
      }
    }
  }

  const cube = {
    version: 1,
    kind: 'transactions',
    file_name: file.name,
    total_rows: totalRows,
    valid_rows: validRows,
    min_date: minDate,
    max_date: maxDate,
    uploaded_at: new Date().toISOString(),
    // [p1, p2, div, weekMonday, sumQty, rowCount]
    buckets: [...bucketMap.values()].map((b) => [b[0], b[1], b[2], b[3], Math.round(b[4] * 100) / 100, b[5]]),
    // [partNumber, p1, p2, div, ym, sumQty]
    part_buckets: [...partMap.values()].map((p) => [p[0], p[1], p[2], p[3], p[4], Math.round(p[5] * 100) / 100]),
  }

  return cube
}

// ============================================================================
// 3. SUPABASE PERSISTENCE (Replaces previous data on re-upload)
// ============================================================================

async function saveCubeToSupabase(tagRow, lsKey, cube, onProgress = () => {}) {
  // Save local cache first
  try {
    localStorage.setItem(lsKey, JSON.stringify(cube))
  } catch {}

  const fullJson = JSON.stringify(cube)
  const totalChunks = Math.ceil(fullJson.length / CHUNK_STR_LIMIT) || 1

  onProgress(0.15)
  // Delete existing chunks for this tagRow
  const { error: delErr } = await supabase
    .from('uploads')
    .delete()
    .eq('status', 'replaced')
    .eq('total_rows', tagRow)
  if (delErr) throw new Error(delErr.message)

  onProgress(0.35)
  for (let idx = 0; idx < totalChunks; idx++) {
    const slice = fullJson.slice(idx * CHUNK_STR_LIMIT, (idx + 1) * CHUNK_STR_LIMIT)
    const payload = JSON.stringify({
      _chunk: idx,
      _total: totalChunks,
      data: slice,
    })
    const { error: insErr } = await supabase.from('uploads').insert({
      file_name: payload,
      total_rows: tagRow,
      status: 'replaced',
    })
    if (insErr) throw new Error(insErr.message)
    onProgress(0.35 + ((idx + 1) / totalChunks) * 0.65)
  }

  return cube
}

async function loadCubeFromSupabase(tagRow, lsKey) {
  try {
    const { data, error } = await supabase
      .from('uploads')
      .select('id, file_name, uploaded_at')
      .eq('status', 'replaced')
      .eq('total_rows', tagRow)
      .order('id', { ascending: true })

    if (!error && Array.isArray(data) && data.length > 0) {
      const parsedChunks = data
        .map((r) => {
          try {
            return JSON.parse(r.file_name)
          } catch {
            return null
          }
        })
        .filter((c) => c && typeof c._chunk === 'number')
        .sort((a, b) => a._chunk - b._chunk)

      if (parsedChunks.length > 0) {
        const joined = parsedChunks.map((c) => c.data).join('')
        const cube = JSON.parse(joined)
        try {
          localStorage.setItem(lsKey, joined)
        } catch {}
        return cube
      }
    }
  } catch {}

  try {
    const raw = localStorage.getItem(lsKey)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const saveReceiptsCube = (cube, onProgress) =>
  saveCubeToSupabase(RECEIPTS_TAG_ROW, LS_RECEIPTS_CUBE, cube, onProgress)

export const saveTransactionsCube = (cube, onProgress) =>
  saveCubeToSupabase(TRANSACTIONS_TAG_ROW, LS_TRANSACTIONS_CUBE, cube, onProgress)

export async function loadHistoryCubes() {
  const [receiptsCube, transactionsCube] = await Promise.all([
    loadCubeFromSupabase(RECEIPTS_TAG_ROW, LS_RECEIPTS_CUBE),
    loadCubeFromSupabase(TRANSACTIONS_TAG_ROW, LS_TRANSACTIONS_CUBE),
  ])
  return { receiptsCube, transactionsCube }
}

// ============================================================================
// 4. ANALYTICS ENGINE: 9-Month Purchase Avg & 12-Month Usage Avg
// ============================================================================

/** Subtract `days` from an ISO date 'YYYY-MM-DD' and return 'YYYY-MM-DD'. */
function subtractDaysISO(iso, days) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - days)
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}

/**
 * Computes historical metrics based on the Mother Table (category_prefixes & vendors):
 * - 9-Month Purchases (PO Receipts): last 9 months (39 weeks / 9 months) anchored to receiptsCube.max_date
 * - 12-Month Consumption (Transactions): last 12 months (52 weeks / 12 months) anchored to transactionsCube.max_date
 * Respects `filters.division` (plant filter).
 */
export function computeHistoryAnalytics({ receiptsCube, transactionsCube, master, lookups, orders, filters, mode = 'week' }) {
  if (!master || !lookups) {
    return {
      hasReceipts: false,
      hasTransactions: false,
      byCategory: {},
      periodDivisor9M: mode === 'week' ? 39 : 9,
      periodDivisor12M: mode === 'week' ? 52 : 12,
    }
  }

  const periodDivisor9M = mode === 'week' ? 39 : 9
  const periodDivisor12M = mode === 'week' ? 52 : 12
  const divFilter = filters?.division ? Number(filters.division) : null
  const matchVendor = buildVendorMatcher(master)

  // Build initial structure per category
  const byCategory = {}
  for (const c of master.categories) {
    byCategory[c.id] = {
      categoryId: c.id,
      purch9MTotal: 0,
      purch9MAvg: 0,
      usage12MTotal: 0,
      usage12MAvg: 0,
      byVendorCode: {}, // vendor_code -> { purch9MTotal, purch9MAvg, usage12MTotal, usage12MAvg, vendorName }
    }
  }

  // Build part_number -> vendor_code lookup from open orders + receiptsCube.part_vendors
  const partToVendorCode = new Map()
  if (Array.isArray(orders)) {
    for (const o of orders) {
      if (o.part_number && o.vendor_code) {
        partToVendorCode.set(String(o.part_number).trim().toUpperCase(), o.vendor_code)
      }
    }
  }
  if (receiptsCube?.part_vendors) {
    for (const [part, vName] of receiptsCube.part_vendors) {
      if (!partToVendorCode.has(part)) {
        const matched = matchVendor(vName, '')
        if (matched && !matched.is_interplant) {
          partToVendorCode.set(part, matched.vendor_code)
        }
      }
    }
  }

  // 1. Process PO Receipts (Last 9 Months = 274 days)
  let cutoff9M = null
  const maxReceiptDate = receiptsCube?.max_date || null
  if (maxReceiptDate) {
    // Subtract 280 days (~9.2 months) so the Monday of the week 39 weeks ago is included
    cutoff9M = subtractDaysISO(maxReceiptDate, 280)
  }

  if (receiptsCube?.buckets) {
    for (const b of receiptsCube.buckets) {
      // [prefix, vendorNameNorm, vendorCodeNorm, div, weekMonday, sumQty, rowCount]
      const [prefix, vName, vCode, div, wk, qty] = b
      if (!qty) continue
      if (divFilter && div !== divFilter) continue
      if (cutoff9M && wk !== 'NO_DATE' && wk < cutoff9M) continue

      const cat = lookups.categoryByPrefix[prefix]
      if (!cat) continue

      const matchedVendor = matchVendor(vName, vCode)
      // Skip inter-plant unless this vendor has capacity in this category
      if (matchedVendor?.is_interplant) {
        const hasCapInCat = master.capacities.some(
          (cap) => cap.category_id === cat.id && cap.vendor_code === matchedVendor.vendor_code
        )
        if (!hasCapInCat) continue
      }

      const vendorCode = matchedVendor ? matchedVendor.vendor_code : (vCode || vName || 'OTHER')
      const vendorName = matchedVendor ? matchedVendor.vendor_name : (vName || vCode || 'Unmapped Supplier')

      // If supplier filter is active on Dashboard, filter to that supplier
      if (filters?.supplier && vendorCode !== filters.supplier) continue

      const catEntry = byCategory[cat.id]
      if (!catEntry) continue

      catEntry.purch9MTotal += qty
      if (!catEntry.byVendorCode[vendorCode]) {
        catEntry.byVendorCode[vendorCode] = {
          vendorCode,
          vendorName,
          purch9MTotal: 0,
          purch9MAvg: 0,
          usage12MTotal: 0,
          usage12MAvg: 0,
        }
      }
      catEntry.byVendorCode[vendorCode].purch9MTotal += qty
    }
  }

  // 2. Process Inventory Transactions (Last 12 Months = 365 days)
  let cutoff12M = null
  const maxTxDate = transactionsCube?.max_date || null
  if (maxTxDate) {
    cutoff12M = subtractDaysISO(maxTxDate, 371) // 53 weeks to include Monday of 52nd week
  }

  if (transactionsCube?.buckets) {
    for (const b of transactionsCube.buckets) {
      // [p1, p2, div, weekMonday, sumQty, rowCount]
      const [p1, p2, div, wk, qty] = b
      if (!qty) continue
      if (divFilter && div !== divFilter) continue
      if (cutoff12M && wk !== 'NO_DATE' && wk < cutoff12M) continue

      const cat = lookups.categoryByPrefix[p1] || lookups.categoryByPrefix[p2]
      if (!cat) continue

      const catEntry = byCategory[cat.id]
      if (!catEntry) continue
      catEntry.usage12MTotal += qty
    }
  }

  // Also attribute part-level transactions to vendors where part_number matches a known supplier
  if (transactionsCube?.part_buckets) {
    const cutoff12MYM = cutoff12M ? cutoff12M.slice(0, 7) : null
    for (const pb of transactionsCube.part_buckets) {
      // [partNumber, p1, p2, div, ym, sumQty]
      const [partNumber, p1, p2, div, ym, qty] = pb
      if (!qty) continue
      if (divFilter && div !== divFilter) continue
      if (cutoff12MYM && ym !== 'NO_DATE' && ym < cutoff12MYM) continue

      const cat = lookups.categoryByPrefix[p1] || lookups.categoryByPrefix[p2]
      if (!cat) continue

      const vendorCode = partToVendorCode.get(partNumber)
      if (!vendorCode) continue
      if (filters?.supplier && vendorCode !== filters.supplier) continue

      const catEntry = byCategory[cat.id]
      if (!catEntry) continue
      if (!catEntry.byVendorCode[vendorCode]) {
        const vObj = lookups.vendorByCode[vendorCode]
        catEntry.byVendorCode[vendorCode] = {
          vendorCode,
          vendorName: vObj?.vendor_name || vendorCode,
          purch9MTotal: 0,
          purch9MAvg: 0,
          usage12MTotal: 0,
          usage12MAvg: 0,
        }
      }
      catEntry.byVendorCode[vendorCode].usage12MTotal += qty
    }
  }

  // Finalize averages per period (39w / 9m for purchases, 52w / 12m for usage)
  for (const catEntry of Object.values(byCategory)) {
    catEntry.purch9MAvg = catEntry.purch9MTotal / periodDivisor9M
    catEntry.usage12MAvg = catEntry.usage12MTotal / periodDivisor12M
    for (const vEntry of Object.values(catEntry.byVendorCode)) {
      vEntry.purch9MAvg = vEntry.purch9MTotal / periodDivisor9M
      vEntry.usage12MAvg = vEntry.usage12MTotal / periodDivisor12M
    }
  }

  return {
    hasReceipts: Boolean(receiptsCube?.buckets?.length),
    hasTransactions: Boolean(transactionsCube?.buckets?.length),
    receiptsMeta: receiptsCube
      ? {
          file_name: receiptsCube.file_name,
          total_rows: receiptsCube.total_rows,
          min_date: receiptsCube.min_date,
          max_date: receiptsCube.max_date,
          cutoff_9m: cutoff9M,
          uploaded_at: receiptsCube.uploaded_at,
        }
      : null,
    transactionsMeta: transactionsCube
      ? {
          file_name: transactionsCube.file_name,
          total_rows: transactionsCube.total_rows,
          min_date: transactionsCube.min_date,
          max_date: transactionsCube.max_date,
          cutoff_12m: cutoff12M,
          uploaded_at: transactionsCube.uploaded_at,
        }
      : null,
    periodDivisor9M,
    periodDivisor12M,
    byCategory,
  }
}
