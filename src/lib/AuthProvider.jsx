import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId) {
    if (!userId) { setProfile(null); return }
    try {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, role, location_id, full_name, location:locations(name_en,name_hu)')
        .eq('user_id', userId)
        .maybeSingle()
      setProfile(data || null)
    } catch { /* keep going even if profile fetch fails */ }
  }

  useEffect(() => {
    let done = false
    const finish = () => { if (!done) { done = true; setLoading(false) } }
    // hard fallback: never hang on the splash loader
    const t = setTimeout(finish, 2500)

    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        setSession(data.session)
        await loadProfile(data.session?.user?.id)
      } catch { /* ignore */ }
      finally { clearTimeout(t); finish() }
    })()

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s)
      await loadProfile(s?.user?.id)
      finish()
    })
    return () => { clearTimeout(t); sub.subscription.unsubscribe() }
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    role: profile?.role ?? null,
    locationId: profile?.location_id ?? null,
    isStaff: profile?.role === 'kitchen_manager' || profile?.role === 'admin',
    loading,
    signOut: () => supabase.auth.signOut()
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
