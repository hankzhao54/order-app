import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'

export default function RequireAuth({ children, allow }) {
  const { user, role, loading } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (allow && !allow.includes(role)) return <Navigate to="/" replace />
  return children
}
