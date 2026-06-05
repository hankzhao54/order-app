// Edge Function: admin-create-user
// Actions: create | set_password | set_active. Caller MUST be an admin.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const VALID_ROLES = ['restaurant_orderer', 'store_manager', 'kitchen_manager', 'admin', 'driver']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authHeader = req.headers.get('Authorization') ?? ''
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, db: { schema: 'ordering' } })
    const { data: u } = await caller.auth.getUser()
    if (!u?.user) return json({ error: 'Not signed in' }, 401)
    const { data: me } = await caller.from('profiles').select('role').eq('user_id', u.user.id).maybeSingle()
    if (me?.role !== 'admin') return json({ error: 'Admin only' }, 403)

    const body = await req.json()
    const action = body.action || 'create'
    const admin = createClient(url, service, { db: { schema: 'ordering' } })

    if (action === 'create') {
      const { email, password, role, location_id, full_name } = body
      if (!email || !password || !role) return json({ error: 'email, password, role required' }, 400)
      if (!VALID_ROLES.includes(role)) return json({ error: 'bad role' }, 400)
      const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (cErr) return json({ error: cErr.message }, 400)
      const { error: pErr } = await admin.from('profiles').insert({
        user_id: created.user.id, role, location_id: location_id || null, full_name: full_name || null,
      })
      if (pErr) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: pErr.message }, 400) }
      return json({ ok: true, user_id: created.user.id })
    }

    if (action === 'set_password') {
      const { user_id, password } = body
      if (!user_id || !password) return json({ error: 'user_id, password required' }, 400)
      if (String(password).length < 6) return json({ error: 'password too short' }, 400)
      const { error } = await admin.auth.admin.updateUserById(user_id, { password })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'set_active') {
      const { user_id, is_active } = body
      if (!user_id || typeof is_active !== 'boolean') return json({ error: 'user_id, is_active required' }, 400)
      // ban/unban in auth + flag profile
      const { error: aErr } = await admin.auth.admin.updateUserById(user_id, { ban_duration: is_active ? 'none' : '876000h' })
      if (aErr) return json({ error: aErr.message }, 400)
      await admin.from('profiles').update({ is_active }).eq('user_id', user_id)
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
