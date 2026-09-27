import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { toLoginEmail } from '@/lib/username'
import { LANGS, useI18n } from '@/lib/i18n'
import { Button, Input } from '@/ui/primitives'

export function LoginPage() {
  const { ready, userId } = useAuth()
  const { t, lang, setLang } = useI18n()
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (ready && userId) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: toLoginEmail(name), password: pw })
    setBusy(false)
    if (error) setErr(error.message === 'Invalid login credentials' ? t('login.invalid') : error.message)
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><span className="brand-mark lg">订</span><div><b>Order</b><span>{t('login.tagline')}</span></div></div>
        <label className="field">
          <span className="field-label">{t('login.username')}</span>
          <Input value={name} onChange={e => setName(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required autoFocus />
        </label>
        <label className="field">
          <span className="field-label">{t('login.password')}</span>
          <div className="input-affix">
            <Input type={show ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" required />
            <button type="button" className="affix-btn" aria-label={show ? t('login.hide') : t('login.show')} onClick={() => setShow(s => !s)}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        {err && <div className="note note-bad" role="alert">{err}</div>}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>{t('login.submit')}</Button>
        <p className="muted small center">{t('login.hint')}</p>
        <div className="login-langs">
          {LANGS.map(l => <button key={l.code} type="button" className={l.code === lang ? 'on' : ''} onClick={() => setLang(l.code)}>{l.label}</button>)}
        </div>
      </form>
    </div>
  )
}
