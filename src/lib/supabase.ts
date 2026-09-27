import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anon)

// All app tables live in the `ordering` schema (shared DB with the recipe app).
export const supabase = createClient<Database, 'ordering'>(
  url || 'http://localhost:54321',
  anon || 'missing-anon-key',
  {
    db: { schema: 'ordering' },
    auth: { persistSession: true, autoRefreshToken: true },
  },
)
