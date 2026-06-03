import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function LocationsAdmin() {
  const [locs, setLocs] = useState([])
  const [form, setForm] = useState({ code: '', name_en: '', name_hu: '', is_central: false })
  const [msg, setMsg] = useState('')

  async function load() {
    const { data } = await supabase.from('locations').select('*').order('name_en')
    setLocs(data || [])
  }
  useEffect(() => { load() }, [])

  async function add() {
    setMsg('')
    const { error } = await supabase.from('locations').insert(form)
    if (error) { setMsg(error.message); return }
    setForm({ code: '', name_en: '', name_hu: '', is_central: false }); load()
  }
  async function toggle(id, is_active) {
    await supabase.from('locations').update({ is_active }).eq('id', id); load()
  }

  return (
    <div>
      <h3>Locations</h3>
      <table className="tbl">
        <thead><tr><th>Code</th><th>Name (EN)</th><th>Name (HU)</th><th>Central</th><th>Active</th></tr></thead>
        <tbody>
          {locs.map(l => (
            <tr key={l.id} className={l.is_active ? '' : 'inactive'}>
              <td>{l.code}</td><td>{l.name_en}</td><td className="muted">{l.name_hu}</td>
              <td>{l.is_central ? '✓' : ''}</td>
              <td><input type="checkbox" checked={l.is_active} onChange={e => toggle(l.id, e.target.checked)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="addrow">
        <input placeholder="CODE" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
        <input placeholder="Name EN" value={form.name_en} onChange={e => setForm({ ...form, name_en: e.target.value })} />
        <input placeholder="Name HU" value={form.name_hu} onChange={e => setForm({ ...form, name_hu: e.target.value })} />
        <label className="inline"><input type="checkbox" checked={form.is_central} onChange={e => setForm({ ...form, is_central: e.target.checked })} /> central</label>
        <button className="primary" onClick={add}>Add</button>
      </div>
      {msg && <div className="error">{msg}</div>}
    </div>
  )
}
