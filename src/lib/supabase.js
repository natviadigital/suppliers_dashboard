import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(url, key, { auth: { persistSession: false } })

/** Throws on Supabase error, returns data otherwise. */
export function unwrap({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

/** Fetches all rows of a query (Supabase caps responses at 1000 rows). */
export async function fetchAll(buildQuery, pageSize = 1000) {
  const out = []
  for (let from = 0; ; from += pageSize) {
    const rows = unwrap(await buildQuery().range(from, from + pageSize - 1))
    out.push(...rows)
    if (rows.length < pageSize) break
  }
  return out
}
