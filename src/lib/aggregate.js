import { bucketOf, PAST_DUE } from './periods'
import { SUPPLIER_COLORS, utilLevel } from './format'

/** Applies the global filters (division, supplier, category, buyer) to monitored orders. */
export function applyFilters(orders, f, { skipCategory = false } = {}) {
  return orders.filter((o) =>
    (!f.division || String(o.div) === f.division) &&
    (!f.supplier || o.vendor_code === f.supplier) &&
    (skipCategory || !f.category || String(o.category_id) === f.category) &&
    (!f.buyer || String(o.buyer) === f.buyer))
}

/**
 * Builds supplier x bucket load for one category.
 * Suppliers = those with capacity defined for the category + those with open orders in it.
 * Accounts for blocked supplier holiday weeks when computing effective capacity per bucket.
 */
export function aggregateCategory({ category, orders, capacities, vendorByCode, buckets, mode, supplierFilter, today, holidayLookup }) {
  const bucketKeys = new Set(buckets.map((b) => b.key))
  const map = new Map()
  const ensure = (code, name) => {
    if (!map.has(code)) {
      map.set(code, {
        code,
        name: vendorByCode[code]?.vendor_name ?? name ?? code,
        weeklyCap: null,
        hasCapacityRow: false,
        cells: {},
        holidays: {},
        bucketCaps: {},
        total: 0,
        lines: [],
      })
    }
    return map.get(code)
  }

  for (const c of capacities) {
    if (c.category_id !== category.id) continue
    if (supplierFilter && c.vendor_code !== supplierFilter) continue
    const s = ensure(c.vendor_code)
    s.weeklyCap = c.weekly_capacity
    s.hasCapacityRow = true
  }

  for (const o of orders) {
    if (o.category_id !== category.id) continue
    const s = ensure(o.vendor_code, o.supplier_name)
    const qty = Number(o.bal_qty) || 0
    s.total += qty
    s.lines.push(o)
    const key = bucketOf(o.ship_date, mode, today)
    if (key && bucketKeys.has(key)) s.cells[key] = (s.cells[key] ?? 0) + qty
  }

  const suppliers = [...map.values()].sort((a, b) =>
    (b.hasCapacityRow - a.hasCapacityRow) || (b.weeklyCap ?? 0) - (a.weeklyCap ?? 0) || b.total - a.total)
  suppliers.forEach((s, i) => { s.color = SUPPLIER_COLORS[i % SUPPLIER_COLORS.length] })

  // Compute per-supplier per-bucket effective capacity & holiday metadata
  for (const s of suppliers) {
    const vendorWeekHolidays = holidayLookup?.byVendorWeek?.[s.code] || {}
    const vendorMonthHolidays = holidayLookup?.byVendorMonth?.[s.code] || {}
    const wCap = Number(s.weeklyCap) || 0

    for (const b of buckets) {
      if (b.key === PAST_DUE) {
        s.bucketCaps[b.key] = 0
        continue
      }
      if (mode === 'week') {
        const hol = vendorWeekHolidays[b.key]
        if (hol) {
          s.holidays[b.key] = hol
          s.bucketCaps[b.key] = 0 // Blocked week!
        } else {
          s.bucketCaps[b.key] = wCap * b.capacityFactor
        }
      } else {
        const hols = vendorMonthHolidays[b.key]
        if (hols && hols.length) {
          s.holidays[b.key] = hols
          const blockedWksCount = Object.keys(vendorWeekHolidays).filter((m) => m.startsWith(b.key)).length
          const effFactor = Math.max(0, b.capacityFactor - blockedWksCount)
          s.bucketCaps[b.key] = wCap * effFactor
        } else {
          s.bucketCaps[b.key] = wCap * b.capacityFactor
        }
      }
    }
  }

  const weeklyCapTotal = suppliers.reduce((sum, s) => sum + (Number(s.weeklyCap) || 0), 0)
  const demand = Number(category.weekly_demand) || 0

  const totals = {}
  const bucketCapTotals = {}
  const chartData = buckets.map((b) => {
    const row = { key: b.key, label: b.label, sub: b.sub, holidays: [] }
    let total = 0
    let bucketCap = 0
    for (const s of suppliers) {
      const v = s.cells[b.key] ?? 0
      if (v) row[s.code] = v
      total += v
      bucketCap += s.bucketCaps[b.key] ?? 0
      if (s.holidays[b.key]) {
        const hList = Array.isArray(s.holidays[b.key]) ? s.holidays[b.key] : [s.holidays[b.key]]
        for (const h of hList) {
          row.holidays.push({ supplierName: s.name, vendorCode: s.code, ...h })
        }
      }
    }
    totals[b.key] = total
    bucketCapTotals[b.key] = bucketCap
    row.total = total
    row.capacity = b.key === PAST_DUE || !weeklyCapTotal ? null : bucketCap
    row.nominalCapacity = b.key === PAST_DUE || !weeklyCapTotal ? null : weeklyCapTotal * b.capacityFactor
    row.demand = b.key === PAST_DUE || !demand ? null : demand * b.capacityFactor
    return row
  })

  const overCells = suppliers.reduce((n, s) =>
    n + buckets.filter((b) => {
      if (b.key === PAST_DUE) return false
      const v = s.cells[b.key] ?? 0
      const isBlockedWeek = mode === 'week' && Boolean(s.holidays[b.key])
      if (isBlockedWeek && v > 0) return true
      return utilLevel(v, s.bucketCaps[b.key] ?? 0) === 'red'
    }).length, 0)

  return {
    suppliers,
    chartData,
    totals,
    bucketCapTotals,
    weeklyCapTotal,
    demand,
    overCells,
    totalOpen: suppliers.reduce((a, s) => a + s.total, 0),
    pastDue: totals[PAST_DUE] ?? 0,
  }
}
