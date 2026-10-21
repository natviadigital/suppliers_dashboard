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
 */
export function aggregateCategory({ category, orders, capacities, vendorByCode, buckets, mode, supplierFilter, today }) {
  const bucketKeys = new Set(buckets.map((b) => b.key))
  const map = new Map()
  const ensure = (code, name) => {
    if (!map.has(code)) map.set(code, { code, name: vendorByCode[code]?.vendor_name ?? name ?? code, weeklyCap: null, hasCapacityRow: false, cells: {}, total: 0, lines: [] })
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

  const weeklyCapTotal = suppliers.reduce((sum, s) => sum + (Number(s.weeklyCap) || 0), 0)
  const demand = Number(category.weekly_demand) || 0

  const totals = {}
  const chartData = buckets.map((b) => {
    const row = { key: b.key, label: b.label, sub: b.sub }
    let total = 0
    for (const s of suppliers) {
      const v = s.cells[b.key] ?? 0
      if (v) row[s.code] = v
      total += v
    }
    totals[b.key] = total
    row.total = total
    row.capacity = b.key === PAST_DUE || !weeklyCapTotal ? null : weeklyCapTotal * b.capacityFactor
    row.demand = b.key === PAST_DUE || !demand ? null : demand * b.capacityFactor
    return row
  })

  const overCells = suppliers.reduce((n, s) =>
    n + buckets.filter((b) => b.key !== PAST_DUE && utilLevel(s.cells[b.key] ?? 0, (s.weeklyCap ?? 0) * b.capacityFactor) === 'red').length, 0)

  return { suppliers, chartData, totals, weeklyCapTotal, demand, overCells, totalOpen: suppliers.reduce((a, s) => a + s.total, 0), pastDue: totals[PAST_DUE] ?? 0 }
}
