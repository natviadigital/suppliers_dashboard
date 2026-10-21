// Formatting + utilization helpers

export function fmtNum(n, digits) {
  if (n === null || n === undefined || isNaN(n)) return '–'
  const d = digits ?? (Math.abs(n) < 10 && n % 1 !== 0 ? 1 : 0)
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 })
}

export function fmtCompact(n) {
  if (n === null || n === undefined || isNaN(n)) return '–'
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** Saturation level: green < 80%, yellow 80–100%, red > 100% */
export function utilLevel(load, capacity) {
  if (!capacity) return load > 0 ? 'nocap' : 'empty'
  const p = load / capacity
  if (p > 1) return 'red'
  if (p >= 0.8) return 'yellow'
  return load > 0 ? 'green' : 'empty'
}

export const LEVEL_STYLES = {
  green:  { cell: 'bg-emerald-100 text-emerald-900', dot: 'bg-emerald-500', bar: '#10b981', text: 'text-emerald-700' },
  yellow: { cell: 'bg-amber-100 text-amber-900',     dot: 'bg-amber-500',   bar: '#f59e0b', text: 'text-amber-700' },
  red:    { cell: 'bg-red-200 text-red-900 font-semibold', dot: 'bg-red-500', bar: '#ef4444', text: 'text-red-700' },
  nocap:  { cell: 'bg-slate-100 text-slate-700',     dot: 'bg-slate-400',   bar: '#94a3b8', text: 'text-slate-600' },
  empty:  { cell: 'text-slate-300',                  dot: 'bg-slate-200',   bar: '#e2e8f0', text: 'text-slate-400' },
}

export const pct = (load, cap) => (cap ? `${Math.round((load / cap) * 100)}%` : '')

export const SUPPLIER_COLORS = [
  '#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#22c55e',
  '#f97316', '#06b6d4', '#a855f7', '#84cc16', '#e11d48', '#64748b', '#0891b2',
]
