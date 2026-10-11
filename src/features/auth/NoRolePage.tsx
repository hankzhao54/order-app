import { Navigate } from 'react-router'
import { useAuth } from '@/lib/auth'
import { useT } from '@/lib/i18n'
import { Button } from '@/ui/primitives'

export function NoRolePage() {
  const { ready, userId, role, email, signOut } = useAuth()
  const t = useT()
  if (!ready) return null
  if (!userId) return <Navigate to="/login" replace />
  if (role) return <Navigate to="/" replace />
  return (
    <div className="center-screen">
      <div className="card narrow">
        <h2>{t('norole.title')}</h2>
        <p className="muted">{t('norole.body', { email: email || '' })}</p>
        <Button onClick={() => signOut()}>{t('shell.signOut')}</Button>
      </div>
    </div>
  )
}
