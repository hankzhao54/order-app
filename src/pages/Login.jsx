import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { toLoginEmail } from '../lib/username'

export default function Login() {
  const { user, loading } = useAuth()
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // Already signed in -> let the router send us home (no nav() during render).
  if (!loading && user) return <Navigate to="/" replace />

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: toLoginEmail(name), password: pw
    })
    setBusy(false)
    if (error) setErr(error.message)
    // on success: auth state changes -> <Navigate> above redirects automatically
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand big">订货 · <span>Order</span></div>
        <p className="muted">Sign in to continue</p>
        <input type="text" placeholder="Username" value={name}
          onChange={e => setName(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" required />
        <input type="password" placeholder="Password" value={pw}
          onChange={e => setPw(e.target.value)} autoComplete="current-password" required />
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={busy}>{busy ? '…' : 'Sign in'}</button>
        <p className="muted small">Enter your username (or full email). Accounts are created by an admin.</p>
      </form>
    </div>
  )
}
