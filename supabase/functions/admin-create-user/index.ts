// Edge Function: admin-create-user
// Creates an auth user + ordering.profiles row. Caller MUST be an admin.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // 1) who is calling? verify their JWT and check they are admin
    const authHeader = req.headers.get('Authorization') ?? ''
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, db: { schema: 'ordering' } })
    const { data: u } = await caller.auth.getUser()
    if (!u?.user) return json({ error: 'Not signed in' }, 401)
    const { data: me } = await caller.from('profiles').select('role').eq('user_id', u.user.id).maybeSingle()
    if (me?.role !== 'admin') return json({ error: 'Admin only' }, 403)

    // 2) read input
    const { email, password, role, location_id, full_name } = await req.json()
    if (!email || !password || !role) return json({ error: 'email, password, role required' }, 400)
    const validRoles = ['restaurant_orderer', 'kitchen_manager', 'admin', 'driver']
    if (!validRoles.includes(role)) return json({ error: 'bad role' }, 400)

    // 3) create the user with service role (admin privileges, server-side only)
    const admin = createClient(url, service, { db: { schema: 'ordering' } })
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (cErr) return json({ error: cErr.message }, 400)

    // 4) write the profile (role + location)
    const { error: pErr } = await admin.from('profiles').insert({
      user_id: created.user.id,
      role,
      location_id: location_id || null,
      full_name: full_name || null,
    })
    if (pErr) {
      // roll back the auth user if profile insert failed
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: pErr.message }, 400)
    }

    return json({ ok: true, user_id: created.user.id }, 200)
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
