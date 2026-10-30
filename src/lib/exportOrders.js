import * as XLSX from 'xlsx'

/**
 * Standardized order export to Excel (.xlsx)
 */
export function exportOrdersToExcel({
  orders,
  fileName,
  sheetName = 'Open Orders',
  lookups = null,
  isSimulated = false,
}) {
  if (!orders || !orders.length) {
    alert('No orders available to export.')
    return
  }

  const data = orders.map((o) => {
    const plant = o.division_name || (o.div ? lookups?.divisionByCode?.[o.div] : '') || o.div || ''
    const supplier = o.supplier_name || o.vendor_name || (o.vendor_code ? lookups?.vendorByCode?.[o.vendor_code]?.vendor_name : '') || o.vendor_code || ''
    const category = o.category_name || (o.prefix ? lookups?.categoryByPrefix?.[o.prefix]?.name : '') || 'Unclassified'

    const row = {
      'PO Nbr': o.po,
      'Itm': o.item,
      'Div': o.div,
      'Plant': plant,
      'Vendor Code': o.vendor_code,
      'Vendor Name': supplier,
      'Category': category,
      'Prefix': o.prefix || '',
      'Part Number': o.part_number,
      'Description': o.description,
      'Buyer': o.buyer || '',
      'PO Date': o.po_date || '',
      'Ship Date': o.ship_date || '',
      'Delivery Date': o.delivery_date || '',
      'Ord Qty': o.ord_qty != null ? Number(o.ord_qty) : '',
      'Bal Qty': o.bal_qty != null ? Number(o.bal_qty) : 0,
      'Unit': o.unit || 'pcs',
      'PO Status': o.po_status || '',
      'Line Confirmed': o.line_confirmed || '',
      'Job Ref': o.job_reference || '',
      'Remarks': o.remarks || '',
    }

    if (isSimulated && o._simulated) {
      row['Simulation'] = 'REALLOCATED'
      row['Original Vendor Code'] = o._orig_vendor_code || ''
      row['Original Vendor Name'] = o._orig_vendor_name || ''
      row['Original Ship Date'] = o._orig_ship_date || ''
    }

    return row
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(data)

  // Compute column widths for cleaner readability in Excel
  if (data.length > 0) {
    const keys = Object.keys(data[0])
    const colWidths = keys.map((key) => {
      let maxLen = key.length
      const sampleCount = Math.min(data.length, 120)
      for (let i = 0; i < sampleCount; i++) {
        const val = data[i][key]
        if (val != null) {
          maxLen = Math.max(maxLen, String(val).length)
        }
      }
      return { wch: Math.min(Math.max(maxLen + 2, 9), 50) }
    })
    ws['!cols'] = colWidths
  }

  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  XLSX.writeFile(wb, `${fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}.xlsx`)
}
