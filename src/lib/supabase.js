import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

// All app tables live in the `ordering` schema (shared DB with the recipe app).
export const supabase = createClient(url, anon, {
  db: { schema: 'ordering' },
  auth: { persistSession: true, autoRefreshToken: true }
})
