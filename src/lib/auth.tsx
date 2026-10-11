import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { can, isStaffRole, type Capability } from './permissions'
import type { Role } from './types'

export interface ProfileInfo {
  user_id: string
  role: Role
  location_id: string | null
  full_name: string | null
  is_active: boolean
  location: { name_en: string; name_hu: string | null; is_central: boolean } | null
}

interface AuthState {
  session: Session | null
  userId: string | null
  email: string | null
  profile: ProfileInfo | null
  role: Role | null
  locationId: string | null
  isStaff: boolean
  can: (cap: Capability) => boolean
  /** session known, profile (if any) loaded */
  ready: boolean
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [sessionKnown, setSessionKnown] = useState(false)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession()
      .then(({ data }) => { if (alive) setSession(data.session) })
      .finally(() => { if (alive) setSessionKnown(true) })
    // Keep this callback synchronous: awaiting Supabase queries inside
    // onAuthStateChange can deadlock the auth client.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      setSessionKnown(true)
      if (event === 'SIGNED_OUT') qc.clear()
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [qc])

  const userId = session?.user?.id ?? null
  const profileQ = useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, role, location_id, full_name, is_active, location:locations(name_en, name_hu, is_central)')
        .eq('user_id', userId!)
        .maybeSingle()
      if (error) throw error
      return (data as ProfileInfo | null) ?? null
    },
  })

  const value = useMemo<AuthState>(() => {
    const profile = profileQ.data ?? null
    const role = profile?.role ?? null
    return {
      session,
      userId,
      email: session?.user?.email ?? null,
      profile,
      role,
      locationId: profile?.location_id ?? null,
      isStaff: isStaffRole(role),
      can: (cap: Capability) => can(role, cap),
      ready: sessionKnown && (!userId || !profileQ.isPending),
      signOut: async () => { await supabase.auth.signOut() },
    }
  }, [session, userId, sessionKnown, profileQ.data, profileQ.isPending])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
