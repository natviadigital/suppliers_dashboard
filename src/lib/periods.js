// Date bucketing helpers. All dates are local 'YYYY-MM-DD' strings.

export const PAST_DUE = 'PAST_DUE'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n) => String(n).padStart(2, '0')

export const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayISO = () => toISO(new Date())

/** Monday of the week containing the date */
export function mondayOf(iso) {
  const d = fromISO(iso)
  const dow = (d.getDay() + 6) % 7 // Mon=0 .. Sun=6
  d.setDate(d.getDate() - dow)
  return toISO(d)
}

export function isoWeekNumber(iso) {
  const d = fromISO(iso)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)) // Thursday of this week
  const jan4 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
}

export const fmtShort = (iso) => { const d = fromISO(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}` }
export const fmtDate = (iso) => { if (!iso) return ''; const d = fromISO(iso); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` }

/**
 * Builds the list of buckets: Past Due + every week (Mon) / month
 * from today until Dec 31 of (current year + 2).
 * Each bucket: { key, label, sub, capacityFactor } — capacityFactor multiplies weekly capacity.
 */
export function buildBuckets(mode, today = todayISO()) {
  const t = fromISO(today)
  const end = new Date(t.getFullYear() + 2, 11, 31)
  const buckets = [{ key: PAST_DUE, label: 'Past Due', sub: `before ${fmtShort(today)}`, capacityFactor: 0 }]
  if (mode === 'week') {
    const d = fromISO(mondayOf(today))
    while (d <= end) {
      const iso = toISO(d)
      buckets.push({ key: iso, label: `W${isoWeekNumber(iso)}`, sub: `${fmtShort(iso)} ${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), capacityFactor: 1 })
      d.setDate(d.getDate() + 7)
    }
  } else {
    const d = new Date(t.getFullYear(), t.getMonth(), 1)
    while (d <= end) {
      const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      buckets.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, sub: String(d.getFullYear()), year: d.getFullYear(), capacityFactor: days / 7 })
      d.setMonth(d.getMonth() + 1)
    }
  }
  return buckets
}

/** Bucket key for a ship date (null if no date) */
export function bucketOf(shipISO, mode, today = todayISO()) {
  if (!shipISO) return null
  if (shipISO < today) return PAST_DUE
  return mode === 'week' ? mondayOf(shipISO) : shipISO.slice(0, 7)
}
