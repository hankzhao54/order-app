// Download an array of row-objects as a CSV file (Excel-friendly).
// columns: [{ key, label }]; rows: array of objects.
export function downloadCSV(filename, columns, rows) {
  const esc = v => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map(c => esc(c.label)).join(',')
  const body = rows.map(r => columns.map(c => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(',')).join('\n')
  // BOM so Excel reads UTF-8 (Hungarian/Chinese chars) correctly
  const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const today = () => new Date().toISOString().slice(0, 10)
