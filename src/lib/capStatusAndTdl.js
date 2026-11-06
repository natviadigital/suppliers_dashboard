import { supabase } from './supabase'

const LS_CAP_STATUS_KEY = 'vtc_supplier_cap_status_v1'
const LS_TDL_ITEMS_KEY = 'vtc_tdl_items_v1'

export const TDL_STATUSES = [
  'Pending',
  'In Progress',
  'Waiting on Supplier',
  'Completed',
  'Blocked',
]

export const TDL_PRIORITIES = ['High', 'Medium', 'Low']

export const DEFAULT_TDL_ITEMS = [
  {
    id: 'tdl-default-1',
    action: 'Execute Key Spacers Resourcing Plan (90 POs / 934 lines) to balance Liaoning XD <= 80% weekly capacity',
    category: 'Key Spacers',
    supplier: 'Multiple (EMID, Enpay, Transvick, Sabar, Gund, Krempel, VTCW P1)',
    plant: 'All',
    owner: 'Purchasing',
    priority: 'High',
    due_date: '2026-11-16',
    status: 'In Progress',
    notes: 'Prioritize domestic/NAFTA suppliers first; apply 10-week ocean transit buffer for overseas.',
    created_at: '2026-11-06',
  },
  {
    id: 'tdl-default-2',
    action: 'Confirm weekly capacity for Ramp / Risers / Jokers suppliers (Liaoning, Venameca, Weidmann, Serra, McClung)',
    category: 'Ramp / Risers / Jokers',
    supplier: 'Multiple',
    plant: 'All',
    owner: 'Purchasing',
    priority: 'High',
    due_date: '2026-11-13',
    status: 'Waiting on Supplier',
    notes: 'Currently only Canduct (158 pcs/wk) is defined; remaining suppliers pending capacity confirmation.',
    created_at: '2026-11-06',
  },
  {
    id: 'tdl-default-3',
    action: 'Block Liaoning XD 2027 official holiday weeks in production schedule & PO ship dates',
    category: 'Key Spacers',
    supplier: 'LIAONINGXD XINGQI ELECTRIC MATERIAL CO.,LTD (12123)',
    plant: 'GTC',
    owner: 'Purchasing',
    priority: 'Medium',
    due_date: '2026-11-10',
    status: 'Completed',
    notes: '7 holiday periods (New Year, Spring Festival W05-W07, Qingming, Labour Day, Dragon Boat, Mid-Autumn, National Day) blocked.',
    created_at: '2026-11-06',
  },
]

/**
 * Loads the capacity confirmation map: { [`${category_id}_${vendor_code}`]: 'confirmed' | 'pending' }
 */
export function loadCapStatusMap() {
  try {
    const raw = localStorage.getItem(LS_CAP_STATUS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveCapStatusMap(map) {
  try {
    localStorage.setItem(LS_CAP_STATUS_KEY, JSON.stringify(map))
  } catch {}
  return map
}

/**
 * Returns 'confirmed' or 'pending' for a supplier in a category.
 * If not explicitly set by the user, defaults to 'pending' when weeklyCap is null/0,
 * or 'confirmed' when weeklyCap > 0 (and can be toggled anytime).
 */
export function resolveCapStatus(capStatusMap, categoryId, vendorCode, weeklyCap) {
  const key = `${categoryId}_${vendorCode}`
  const explicit = capStatusMap?.[key]
  if (explicit === 'confirmed' || explicit === 'pending') return explicit
  return Number(weeklyCap) > 0 ? 'confirmed' : 'pending'
}

/**
 * TDL (To-Do List) Action Items CRUD with Supabase + localStorage persistence
 */
export async function loadTdlItems() {
  try {
    const { data, error } = await supabase
      .from('tdl_items')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && Array.isArray(data)) {
      localStorage.setItem(LS_TDL_ITEMS_KEY, JSON.stringify(data))
      return data
    }
  } catch {}

  try {
    const raw = localStorage.getItem(LS_TDL_ITEMS_KEY)
    if (!raw) {
      localStorage.setItem(LS_TDL_ITEMS_KEY, JSON.stringify(DEFAULT_TDL_ITEMS))
      return DEFAULT_TDL_ITEMS
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : DEFAULT_TDL_ITEMS
  } catch {
    return DEFAULT_TDL_ITEMS
  }
}

export async function saveTdlItems(items) {
  try {
    localStorage.setItem(LS_TDL_ITEMS_KEY, JSON.stringify(items))
  } catch {}
  return items
}
