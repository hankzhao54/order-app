import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const ROLES = ['restaurant_orderer', 'kitchen_manager', 'driver', 'admin']

export default function UsersAdmin() {
  const [rows, setRows] = useState([])
  const [locs, setLocs] = useState([])
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'restaurant_orderer', location_id: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    const [{ data: p }, { data: l }] = await Promise.all([
      supabase.from('profiles').select('user_id, full_name, role, location_id').order('full_name'),
      supabase.from('locations').select('id,name_en').eq('is_active', true).order('name_en')
    ])
    setRows(p || []); setLocs(l || [])
  }
  useEffect(() => { load() }, [])

  async function patch(user_id, fields) {
    await supabase.from('profiles').update(fields).eq('user_id', user_id)
    setRows(p => p.map(x => x.user_id === user_id ? { ...x, ...fields } : x))
  }

  async function createUser() {
    setMsg('')
    if (!form.email.trim() || !form.password) { setMsg('Email and password are required.'); return }
    if (form.password.length < 6) { setMsg('Password must be at least 6 characters.'); return }
    if (form.role === 'restaurant_orderer' && !form.location_id) { setMsg('An orderer must have a location.'); return }
    setBusy(true)
    const { data: sess } = await supabase.auth.getSession()
    const token = sess?.session?.access_token
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: {
        email: form.email.trim(), password: form.password,
        full_name: form.full_name.trim() || null,
        role: form.role, location_id: form.location_id || null
      }
    })
    setBusy(false)
    if (error || data?.error) { setMsg('Error: ' + (data?.error || error.message)); return }
    setMsg(`✓ Created ${form.email.trim()}.`)
    setForm({ email: '', password: '', full_name: '', role: 'restaurant_orderer', location_id: '' })
    load()
  }

  return (
    <div className="usersadmin">
      <div className="addtask card">
        <h3>Add user</h3>
        <div className="adduser-grid">
          <input placeholder="Email *" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input placeholder="Password *" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          <input placeholder="Full name" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={form.location_id} onChange={e => setForm({ ...form, location_id: e.target.value })}>
            <option value="">Location (for orderer)…</option>
            {locs.map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
          </select>
          <button className="primary" disabled={busy} onClick={createUser}>{busy ? 'Creating…' : '+ Create user'}</button>
        </div>
        {msg && <div className={msg.startsWith('✓') ? 'notice' : 'error'} style={{ marginTop: 8 }}>{msg}</div>}
        <p className="muted small" style={{ marginTop: 6 }}>Email can be real or a fake login like <code>name@restaurant.local</code>. The account is created confirmed and can log in immediately.</p>
      </div>

      <h3 style={{ marginTop: 20 }}>Users ({rows.length})</h3>
      <table className="tbl">
        <thead><tr><th>Name</th><th>Role</th><th>Location</th></tr></thead>
        <tbody>
          {rows.map(u => (
            <tr key={u.user_id}>
              <td>{u.full_name || <span className="muted">{u.user_id.slice(0, 8)}…</span>}</td>
              <td>
                <select value={u.role} onChange={e => patch(u.user_id, { role: e.target.value })}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
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
