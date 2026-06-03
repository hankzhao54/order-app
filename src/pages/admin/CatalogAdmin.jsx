import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function CatalogAdmin() {
  const [items, setItems] = useState([])
  const [cats, setCats] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [{ data: it }, { data: c }] = await Promise.all([
      supabase.from('catalog_items').select('id,name_en,name_hu,order_unit,default_fulfillment,is_active,category_id').order('name_en'),
      supabase.from('categories').select('id,name_en').order('sort_order')
    ])
    setItems(it || []); setCats(c || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function patch(id, fields) {
    await supabase.from('catalog_items').update(fields).eq('id', id)
    setItems(p => p.map(x => x.id === id ? { ...x, ...fields } : x))
  }

  const catName = id => cats.find(c => c.id === id)?.name_en || '—'
  const filtered = items.filter(i => !q || `${i.name_en} ${i.name_hu || ''}`.toLowerCase().includes(q.toLowerCase()))

  if (loading) return <div className="center muted">Loading…</div>
  return (
    <div>
      <div className="toolbar">
        <input className="search" placeholder="Search catalog…" value={q} onChange={e => setQ(e.target.value)} />
        <span className="muted">{filtered.length} items</span>
      </div>
      <table className="tbl">
        <thead><tr><th>Name (EN)</th><th>Name (HU)</th><th>Category</th><th>Default</th><th>Unit</th><th>Active</th></tr></thead>
        <tbody>
          {filtered.map(i => (
            <tr key={i.id} className={i.is_active ? '' : 'inactive'}>
              <td>{i.name_en}</td>
              <td className="muted">{i.name_hu}</td>
              <td>{catName(i.category_id)}</td>
              <td>
                <select value={i.default_fulfillment || ''} onChange={e => patch(i.id, { default_fulfillment: e.target.value || null })}>
                  <option value="">—</option>
                  <option value="make">🍳 make</option>
                  <option value="purchase">🛒 purchase</option>
                </select>
              </td>
              <td><input className="cell" value={i.order_unit || ''} onChange={e => patch(i.id, { order_unit: e.target.value })} /></td>
              <td><input type="checkbox" checked={i.is_active} onChange={e => patch(i.id, { is_active: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
