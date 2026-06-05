import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const ROLES = ['restaurant_orderer', 'store_manager', 'bar_staff', 'kitchen_manager', 'driver', 'admin']
const ROLE_LABEL = {
  restaurant_orderer: 'Orderer (store)',
  store_manager: 'Store manager',
  kitchen_manager: 'Kitchen manager',
  bar_staff: 'Bar staff',
  driver: 'Driver',
  admin: 'Admin',
}
const STORE_BOUND = ['restaurant_orderer', 'store_manager', 'bar_staff']

export default function UsersAdmin() {
  const [rows, setRows] = useState([])
  const [locs, setLocs] = useState([])
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'restaurant_orderer', location_id: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [pwFor, setPwFor] = useState(null)   // user row for password modal
  const [pwVal, setPwVal] = useState('')

  async function load() {
    const [{ data: p }, { data: l }] = await Promise.all([
      supabase.from('profiles').select('user_id, full_name, role, location_id, is_active').order('full_name'),
      supabase.from('locations').select('id,name_en').eq('is_active', true).order('name_en')
    ])
    setRows(p || []); setLocs(l || [])
  }
  useEffect(() => { load() }, [])

  async function token() {
    const { data: sess } = await supabase.auth.getSession()
    return sess?.session?.access_token
  }
  async function callFn(body) {
    const t = await token()
    return supabase.functions.invoke('admin-create-user', { headers: t ? { Authorization: `Bearer ${t}` } : {}, body })
  }

  // role change with confirmation
  async function changeRole(u, newRole) {
    if (newRole === u.role) return
    const locName = locs.find(l => l.id === u.location_id)?.name_en
    let warn = `Change ${u.full_name || 'this user'} from “${ROLE_LABEL[u.role]}” to “${ROLE_LABEL[newRole]}”?`
    if (STORE_BOUND.includes(newRole) && !u.location_id) warn += `\n\n⚠ This role is store-bound but the user has no location set — set one after.`
    if (newRole === 'kitchen_manager' || newRole === 'admin') warn += `\n\n⚠ This role can see ALL locations' data.`
    if (!confirm(warn)) return
    await supabase.from('profiles').update({ role: newRole }).eq('user_id', u.user_id)
    setRows(p => p.map(x => x.user_id === u.user_id ? { ...x, role: newRole } : x))
  }
  async function changeLoc(u, location_id) {
    await supabase.from('profiles').update({ location_id: location_id || null }).eq('user_id', u.user_id)
    setRows(p => p.map(x => x.user_id === u.user_id ? { ...x, location_id: location_id || null } : x))
  }

  async function toggleActive(u) {
    const next = !(u.is_active ?? true)
    if (!confirm(next ? `Re-enable ${u.full_name || 'this user'}? They will be able to log in again.`
                      : `Disable ${u.full_name || 'this user'}? They will be signed out and blocked from logging in.`)) return
    const { data, error } = await callFn({ action: 'set_active', user_id: u.user_id, is_active: next })
    if (error || data?.error) { setMsg('Error: ' + (data?.error || error.message)); return }
    setRows(p => p.map(x => x.user_id === u.user_id ? { ...x, is_active: next } : x))
    setMsg(`✓ ${next ? 'Enabled' : 'Disabled'} ${u.full_name || 'user'}.`)
  }

  async function savePassword() {
    if (pwVal.length < 6) { setMsg('Password must be at least 6 characters.'); return }
    const { data, error } = await callFn({ action: 'set_password', user_id: pwFor.user_id, password: pwVal })
    if (error || data?.error) { setMsg('Error: ' + (data?.error || error.message)); return }
    setMsg(`✓ Password changed for ${pwFor.full_name || 'user'}.`)
    setPwFor(null); setPwVal('')
  }

  async function createUser() {
    setMsg('')
    if (!form.email.trim() || !form.password) { setMsg('Email and password are required.'); return }
    if (form.password.length < 6) { setMsg('Password must be at least 6 characters.'); return }
    if (STORE_BOUND.includes(form.role) && !form.location_id) { setMsg('This role must have a location.'); return }
    setBusy(true)
    const { data, error } = await callFn({
      email: form.email.trim(), password: form.password,
      full_name: form.full_name.trim() || null, role: form.role, location_id: form.location_id || null
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
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <select value={form.location_id} onChange={e => setForm({ ...form, location_id: e.target.value })}>
            <option value="">Location (store roles)…</option>
            {locs.map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
          </select>
          <button className="primary" disabled={busy} onClick={createUser}>{busy ? 'Creating…' : '+ Create user'}</button>
        </div>
        {msg && <div className={msg.startsWith('✓') ? 'notice' : 'error'} style={{ marginTop: 8 }}>{msg}</div>}
        <p className="muted small" style={{ marginTop: 6 }}>Email can be real or a fake login like <code>name@restaurant.local</code>. Store-bound roles (orderer, store manager) need a location. Only kitchen manager &amp; admin see all locations.</p>
      </div>

      <h3 style={{ marginTop: 20 }}>Users ({rows.length})</h3>
      <table className="tbl">
        <thead><tr><th>Name</th><th>Role</th><th>Location</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {rows.map(u => {
            const active = u.is_active ?? true
            return (
              <tr key={u.user_id} className={active ? '' : 'row-disabled'}>
                <td>{u.full_name || <span className="muted">{u.user_id.slice(0, 8)}…</span>}</td>
                <td>
                  <select value={u.role} onChange={e => changeRole(u, e.target.value)}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
                <td>
                  <select value={u.location_id || ''} onChange={e => changeLoc(u, e.target.value)}>
                    <option value="">— none —</option>
                    {locs.map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
                  </select>
                </td>
                <td>{active ? <span className="statuschip ready">active</span> : <span className="statuschip short">disabled</span>}</td>
                <td className="user-actions">
                  <button className="mini" onClick={() => { setPwFor(u); setPwVal(''); setMsg('') }}>Password</button>
                  <button className={`mini ${active ? 'danger' : 'ok'}`} onClick={() => toggleActive(u)}>{active ? 'Disable' : 'Enable'}</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {pwFor && (
        <div className="cnt-overlay" onClick={() => setPwFor(null)}>
          <div className="cnt-card" onClick={e => e.stopPropagation()}>
            <div className="cnt-name">Set password</div>
            <div className="cnt-sub muted">{pwFor.full_name || pwFor.user_id.slice(0, 8)}</div>
            <input className="cnt-loc" style={{ marginTop: 14 }} placeholder="New password (min 6)" value={pwVal} onChange={e => setPwVal(e.target.value)} autoFocus />
            <div className="cnt-actions" style={{ marginTop: 16 }}>
              <button className="ghost" onClick={() => setPwFor(null)}>Cancel</button>
              <button className="primary" onClick={savePassword}>Save password</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
