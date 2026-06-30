import { useEffect, useState } from 'react'
import { fetchList, patchRow, insertRow } from '../../lib/db'

export default function SuppliersAdmin() {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState({ name: '', contact: '', note: '' })
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const data = await fetchList('suppliers', { build: q => q.order('name') })
    setRows(data); setLoading(false)
  }
  useEffect(() => { load() }, [])

  function set(id, fields) { setRows(p => p.map(x => x.id === id ? { ...x, ...fields } : x)) }
  async function patch(id, fields) {
    set(id, fields)
    const { error } = await patchRow('suppliers', id, fields)
    if (error) setMsg(error.message)
  }
  async function add() {
    setMsg('')
    if (!form.name.trim()) { setMsg('Supplier name is required.'); return }
    const { error } = await insertRow('suppliers', { name: form.name.trim(), contact: form.contact.trim() || null, note: form.note.trim() || null })
    if (error) { setMsg(error.message); return }
    setForm({ name: '', contact: '', note: '' }); load()
  }

  if (loading) return <div className="center muted">Loading…</div>
  return (
    <div className="suppliersadmin">
      <div className="addtask card">
        <h3>Add supplier</h3>
        <div className="adduser-grid">
          <input placeholder="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input placeholder="Contact (phone / person)" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} />
          <input placeholder="Note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
          <button className="primary" onClick={add}>+ Add supplier</button>
        </div>
        {msg && <div className="error" style={{ marginTop: 8 }}>{msg}</div>}
      </div>

      <h3 style={{ marginTop: 20 }}>Suppliers ({rows.length})</h3>
      <table className="tbl">
        <thead><tr><th>Name</th><th>Contact</th><th>Note</th><th style={{ width: 70 }}>Active</th></tr></thead>
        <tbody>
          {rows.map(s => (
            <tr key={s.id} className={s.is_active ? '' : 'inactive'}>
              <td><input className="cell wide" value={s.name} onChange={e => set(s.id, { name: e.target.value })} onBlur={e => patch(s.id, { name: e.target.value })} /></td>
              <td><input className="cell wide" value={s.contact || ''} onChange={e => set(s.id, { contact: e.target.value })} onBlur={e => patch(s.id, { contact: e.target.value || null })} /></td>
              <td><input className="cell wide" value={s.note || ''} onChange={e => set(s.id, { note: e.target.value })} onBlur={e => patch(s.id, { note: e.target.value || null })} /></td>
              <td><input type="checkbox" checked={s.is_active} onChange={e => patch(s.id, { is_active: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small" style={{ marginTop: 8 }}>Text fields save on blur. Inactive suppliers stay on past prices but won't show for new price entries.</p>
    </div>
  )
}
