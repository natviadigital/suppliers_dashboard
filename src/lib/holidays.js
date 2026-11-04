import { fromISO, toISO, mondayOf, isoWeekNumber } from './periods'

const LS_HOLIDAYS_KEY = 'vtc_supplier_holidays_v1'

/**
 * Official 2027 Holiday Schedule for LIAONINGXD XINGQI ELECTRIC MATERIAL CO.,LTD (12123)
 */
export const DEFAULT_SUPPLIER_HOLIDAYS = [
  {
    id: 'liaoning-2027-new-year',
    vendor_code: '12123',
    holiday_name: "New Year's Day",
    start_date: '2027-01-01',
    end_date: '2027-01-03',
    total_days: 3,
  },
  {
    id: 'liaoning-2027-spring-festival',
    vendor_code: '12123',
    holiday_name: 'Spring Festival',
    start_date: '2027-02-06',
    end_date: '2027-02-15',
    total_days: 9,
  },
  {
    id: 'liaoning-2027-qingming',
    vendor_code: '12123',
    holiday_name: 'Qingming Festival',
    start_date: '2027-04-03',
    end_date: '2027-04-05',
    total_days: 3,
  },
  {
    id: 'liaoning-2027-labour-day',
    vendor_code: '12123',
    holiday_name: 'Labour Day',
    start_date: '2027-05-01',
    end_date: '2027-05-05',
    total_days: 5,
  },
  {
    id: 'liaoning-2027-dragon-boat',
    vendor_code: '12123',
    holiday_name: 'Dragon Boat Festival',
    start_date: '2027-06-07',
    end_date: '2027-06-09',
    total_days: 3,
  },
  {
    id: 'liaoning-2027-mid-autumn',
    vendor_code: '12123',
    holiday_name: 'Mid-Autumn Festival',
    start_date: '2027-09-15',
    end_date: '2027-09-17',
    total_days: 3,
  },
  {
    id: 'liaoning-2027-national-day',
    vendor_code: '12123',
    holiday_name: 'National Day',
    start_date: '2027-10-01',
    end_date: '2027-10-07',
    total_days: 7,
  },
]

/**
 * Returns the list of Monday ISO dates ('YYYY-MM-DD') for all working weeks (Mon-Fri)
 * touched by [start_date, end_date]. If a holiday only touches Sat/Sun, falls back to start_date's Monday.
 */
export function getBlockedWeeksForHoliday(startISO, endISO) {
  if (!startISO) return []
  const end = endISO || startISO
  const cur = fromISO(startISO)
  const last = fromISO(end)
  const weeks = new Set()

  while (cur <= last) {
    const dow = cur.getDay() // 0=Sun, 6=Sat
    if (dow >= 1 && dow <= 5) {
      weeks.add(mondayOf(toISO(cur)))
    }
    cur.setDate(cur.getDate() + 1)
  }

  if (weeks.size === 0) {
    weeks.add(mondayOf(startISO))
  }
  return [...weeks].sort()
}

/**
 * Formats a holiday week label e.g. "W6 (2027-02-08)"
 */
export function formatHolidayWeeks(startISO, endISO) {
  return getBlockedWeeksForHoliday(startISO, endISO).map((mon) => ({
    monday: mon,
    label: `W${isoWeekNumber(mon)}`,
    year: fromISO(mon).getFullYear(),
  }))
}

/**
 * Loads supplier holidays, merging default built-in holidays with any user-saved holidays in localStorage.
 */
export function loadSupplierHolidays() {
  try {
    const raw = localStorage.getItem(LS_HOLIDAYS_KEY)
    if (!raw) {
      localStorage.setItem(LS_HOLIDAYS_KEY, JSON.stringify(DEFAULT_SUPPLIER_HOLIDAYS))
      return DEFAULT_SUPPLIER_HOLIDAYS
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_SUPPLIER_HOLIDAYS
    // Ensure default Liaoning holidays exist unless explicitly removed by user flag
    const byId = new Map(parsed.map((h) => [h.id, h]))
    for (const def of DEFAULT_SUPPLIER_HOLIDAYS) {
      if (!byId.has(def.id) && !parsed.some((p) => p._deletedId === def.id)) {
        byId.set(def.id, def)
      }
    }
    return [...byId.values()].filter((h) => !h._deletedId)
  } catch {
    return DEFAULT_SUPPLIER_HOLIDAYS
  }
}

export function saveSupplierHolidays(holidays) {
  try {
    localStorage.setItem(LS_HOLIDAYS_KEY, JSON.stringify(holidays))
  } catch {}
  return holidays
}

/**
 * Builds a lookup map of blocked weeks and months per vendor:
 * {
 *   byVendorWeek: { [vendor_code]: { [mondayISO]: holidayObj } },
 *   byVendorMonth: { [vendor_code]: { [yyyy_mm]: holidayObj[] } }
 * }
 */
export function buildHolidayLookup(holidays = DEFAULT_SUPPLIER_HOLIDAYS) {
  const byVendorWeek = {}
  const byVendorMonth = {}

  for (const h of holidays) {
    if (!h || !h.vendor_code || !h.start_date) continue
    const code = h.vendor_code
    if (!byVendorWeek[code]) byVendorWeek[code] = {}
    if (!byVendorMonth[code]) byVendorMonth[code] = {}

    const blockedMondays = getBlockedWeeksForHoliday(h.start_date, h.end_date)
    for (const mon of blockedMondays) {
      byVendorWeek[code][mon] = h
      const ym = mon.slice(0, 7)
      if (!byVendorMonth[code][ym]) byVendorMonth[code][ym] = []
      if (!byVendorMonth[code][ym].some((x) => x.id === h.id)) {
        byVendorMonth[code][ym].push(h)
      }
    }
  }

  return { byVendorWeek, byVendorMonth }
}
