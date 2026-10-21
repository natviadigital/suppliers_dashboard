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
