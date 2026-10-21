import { fmtDate } from '../lib/periods'
import { fmtNum } from '../lib/format'

const STATUS_STYLE = {
  'PAST DUE': 'bg-red-100 text-red-700',
  'DUE IN 7 DAYS': 'bg-amber-100 text-amber-700',
  'ON TIME': 'bg-emerald-100 text-emerald-700',
}

export const StatusBadge = ({ status }) =>
  status ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-600'}`}>{status}</span> : null

/** Table of order lines (used in drill-down modal and Open Orders page) */
export default function OrderLinesTable({ lines, showCategory = true, showSupplier = true }) {
  return (
    <table className="w-full">
      <thead className="sticky top-0">
        <tr>
          <th className="th">PO</th><th className="th">Itm</th><th className="th">Div</th>
          {showSupplier && <th className="th">Supplier</th>}
          {showCategory && <th className="th">Category</th>}
          <th className="th">Part Number</th><th className="th">Description</th><th className="th">Buyer</th>
          <th className="th">Ship Date</th><th className="th">Delivery</th>
          <th className="th text-right">Ord Qty</th><th className="th text-right">Bal Qty</th>
          <th className="th">Status</th><th className="th">Confirmed</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((o) => (
          <tr key={o.id} className="hover:bg-slate-50">
            <td className="td font-medium">{o.po}</td>
            <td className="td">{o.item}</td>
            <td className="td" title={o.division_name}>{o.division_name ?? o.div}</td>
            {showSupplier && <td className="td max-w-56 truncate" title={o.supplier_name}>{o.supplier_name}</td>}
            {showCategory && <td className="td">{o.category_name}</td>}
            <td className="td font-mono text-xs">{o.part_number}</td>
            <td className="td max-w-64 truncate" title={o.description}>{o.description}</td>
            <td className="td">{o.buyer}</td>
            <td className="td">{fmtDate(o.ship_date)}</td>
            <td className="td">{fmtDate(o.delivery_date)}</td>
            <td className="td text-right">{fmtNum(o.ord_qty)}</td>
            <td className="td text-right font-semibold">{fmtNum(o.bal_qty)}</td>
            <td className="td"><StatusBadge status={o.po_status} /></td>
            <td className="td text-xs">{o.line_confirmed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
