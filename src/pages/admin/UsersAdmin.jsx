import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function UsersAdmin() {
  const [rows, setRows] = useState([])
  const [locs, setLocs] = useState([])

  async function load() {
    const [{ data: p }, { data: l }] = await Promise.all([
      supabase.from('profiles').select('user_id, full_name, role, location_id').order('full_name'),
      supabase.from('locations').select('id,name_en').order('name_en')
    ])
    setRows(p || []); setLocs(l || [])
  }
  useEffect(() => { load() }, [])

  async function patch(user_id, fields) {
    await supabase.from('profiles').update(fields).eq('user_id', user_id)
    setRows(p => p.map(x => x.user_id === user_id ? { ...x, ...fields } : x))
  }

  return (
    <div>
      <h3>Users</h3>
      <p className="muted small">New users sign up first; here you set their role and location. (User creation itself is via Supabase Auth.)</p>
      <table className="tbl">
        <thead><tr><th>Name</th><th>Role</th><th>Location</th></tr></thead>
        <tbody>
          {rows.map(u => (
            <tr key={u.user_id}>
              <td>{u.full_name || <span className="muted">{u.user_id.slice(0, 8)}…</span>}</td>
              <td>
                <select value={u.role} onChange={e => patch(u.user_id, { role: e.target.value })}>
                  <option value="restaurant_orderer">restaurant_orderer</option>
                  <option value="kitchen_manager">kitchen_manager</option>
                  <option value="driver">driver</option>
                  <option value="admin">admin</option>
                </select>
              </td>
              <td>
                <select value={u.location_id || ''} onChange={e => patch(u.user_id, { location_id: e.target.value || null })}>
                  <option value="">— none —</option>
                  {locs.map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
