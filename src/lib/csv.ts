export interface CsvColumn<T> { label: string; value: (row: T) => unknown }

export function toCSV<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const esc = (v: unknown) => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map(c => esc(c.label)).join(',')
  const body = rows.map(r => columns.map(c => esc(c.value(r))).join(',')).join('\r\n')
  return header + '\r\n' + body
}

/** Download rows as an Excel-friendly UTF-8 CSV (BOM so HU/ZH characters survive). */
export function downloadCSV<T>(filename: string, columns: CsvColumn<T>[], rows: T[]) {
  const blob = new Blob(['﻿' + toCSV(columns, rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
