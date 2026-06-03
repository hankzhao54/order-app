import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'

export default function Login() {
  const { user, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // Already signed in -> let the router send us home (no nav() during render).
  if (!loading && user) return <Navigate to="/" replace />

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(), password: pw
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
        <input type="email" placeholder="Email" value={email}
          onChange={e => setEmail(e.target.value)} autoComplete="username" required />
        <input type="password" placeholder="Password" value={pw}
          onChange={e => setPw(e.target.value)} autoComplete="current-password" required />
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={busy}>{busy ? '…' : 'Sign in'}</button>
        <p className="muted small">Accounts are created by an admin.</p>
      </form>
    </div>
  )
}
