import { supabase, unwrap, fetchAll } from './supabase'

export async function loadMaster() {
  const [categories, prefixes, capacities, vendors, divisions] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order').order('name').then(unwrap),
    fetchAll(() => supabase.from('category_prefixes').select('*').order('prefix')),
    fetchAll(() => supabase.from('supplier_capacities').select('*').order('id')),
    fetchAll(() => supabase.from('vendors').select('*').order('vendor_name')),
    supabase.from('divisions').select('*').order('code').then(unwrap),
  ])
  return { categories, prefixes, capacities, vendors, divisions }
}

export const loadMonitoredOrders = () =>
  fetchAll(() => supabase.from('v_monitored_orders').select('*').order('id'))

export const loadPrefixSummary = () =>
  fetchAll(() => supabase.from('v_prefix_summary').select('*').order('lines', { ascending: false }))

export async function loadCurrentUpload() {
  const rows = unwrap(await supabase.from('uploads').select('*').eq('status', 'current').order('uploaded_at', { ascending: false }).limit(1))
  return rows[0] ?? null
}

/**
 * Loads raw open orders (paginated), optional filter by vendor_codes or IDs.
 * Used by Simulator to ensure all orders (even unclassified prefixes) are visible.
 */
export async function loadRawOpenOrders(filter = {}) {
  return fetchAll(() => {
    let q = supabase
      .from('open_orders')
      .select('id, line_id, div, class, buyer, vendor_code, vendor_name, po, item, part_number, prefix, description, po_date, ship_date, delivery_date, ord_qty, bal_qty, unit_price, ext_price, line_confirmed, remarks, job_reference, po_status')
      .order('id')
    if (filter.vendor_codes && filter.vendor_codes.length) {
      q = q.in('vendor_code', filter.vendor_codes)
    }
    return q
  })
}

/**
 * Replaces the current open order with `rows`.
 * Inserts into a new "pending" upload, then swaps atomically via commit_upload().
 */
export async function replaceOpenOrder(fileName, rows, newVendors, onProgress = () => {}) {
  if (newVendors.length) {
    unwrap(await supabase.from('vendors').upsert(newVendors, { onConflict: 'vendor_code', ignoreDuplicates: true }))
  }
  const upload = unwrap(await supabase.from('uploads').insert({ file_name: fileName, total_rows: rows.length }).select().single())
  try {
    const CHUNK = 1000
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => ({ ...r, upload_id: upload.id }))
      unwrap(await supabase.from('open_orders').insert(chunk))
      onProgress(Math.min(1, (i + CHUNK) / rows.length))
    }
    unwrap(await supabase.rpc('commit_upload', { p_upload_id: upload.id }))
  } catch (e) {
    await supabase.from('uploads').delete().eq('id', upload.id) // cascade removes partial lines
    throw e
  }
  return upload
}

// ---- generic CRUD used by Settings ----
export const insertRow = async (table, row) => unwrap(await supabase.from(table).insert(row).select().single())
export const updateRow = async (table, match, patch) => unwrap(await supabase.from(table).update(patch).match(match))
export const deleteRow = async (table, match) => unwrap(await supabase.from(table).delete().match(match))

// ---- Scenarios API (with local fallback if Supabase migration is pending) ----
const LS_SCENARIOS = 'vtc_scenarios_fallback'
const LS_ITEMS = 'vtc_scenario_items_fallback'

export async function loadScenarios() {
  try {
    const { data, error } = await supabase.from('scenarios').select('*').order('updated_at', { ascending: false })
    if (!error && data) return data
  } catch {}
  // local fallback
  try {
    return JSON.parse(localStorage.getItem(LS_SCENARIOS) || '[]')
  } catch {
    return []
  }
}

/**
 * Loads ALL scenario items for a scenario using fetchAll to bypass 1000 row limit
 */
export async function loadScenarioItems(scenarioId) {
  try {
    const data = await fetchAll(() =>
      supabase.from('scenario_items').select('*').eq('scenario_id', scenarioId).order('created_at')
    )
    if (data && data.length) return data
  } catch {}
  // local fallback
  try {
    const all = JSON.parse(localStorage.getItem(LS_ITEMS) || '[]')
    return all.filter((it) => it.scenario_id === scenarioId)
  } catch {
    return []
  }
}

export async function createScenario(name, description = '') {
  try {
    const row = unwrap(await supabase.from('scenarios').insert({ name, description }).select().single())
    return row
  } catch {
    const list = JSON.parse(localStorage.getItem(LS_SCENARIOS) || '[]')
    const row = { id: crypto.randomUUID(), name, description, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    list.unshift(row)
    localStorage.setItem(LS_SCENARIOS, JSON.stringify(list))
    return row
  }
}

export async function updateScenario(id, patch) {
  try {
    return unwrap(await supabase.from('scenarios').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single())
  } catch {
    const list = JSON.parse(localStorage.getItem(LS_SCENARIOS) || '[]')
    const idx = list.findIndex((s) => s.id === id)
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch, updated_at: new Date().toISOString() }
      localStorage.setItem(LS_SCENARIOS, JSON.stringify(list))
      return list[idx]
    }
  }
}

export async function deleteScenario(id) {
  try {
    unwrap(await supabase.from('scenarios').delete().eq('id', id))
  } catch {
    const list = JSON.parse(localStorage.getItem(LS_SCENARIOS) || '[]')
    localStorage.setItem(LS_SCENARIOS, JSON.stringify(list.filter((s) => s.id !== id)))
    const items = JSON.parse(localStorage.getItem(LS_ITEMS) || '[]')
    localStorage.setItem(LS_ITEMS, JSON.stringify(items.filter((it) => it.scenario_id !== id)))
  }
}

export async function saveScenarioItems(scenarioId, items) {
  try {
    // Delete existing and insert new
    await supabase.from('scenario_items').delete().eq('scenario_id', scenarioId)
    if (items.length) {
      const CHUNK = 500
      for (let i = 0; i < items.length; i += CHUNK) {
        unwrap(await supabase.from('scenario_items').insert(items.slice(i, i + CHUNK)))
      }
    }
    await supabase.from('scenarios').update({ updated_at: new Date().toISOString() }).eq('id', scenarioId)
  } catch {
    const all = JSON.parse(localStorage.getItem(LS_ITEMS) || '[]').filter((it) => it.scenario_id !== scenarioId)
    localStorage.setItem(LS_ITEMS, JSON.stringify([...all, ...items]))
  }
}
