import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Build-time fallbacks so `next build` can compile without `.env.local`.
 * Runtime requests must set real Supabase env vars.
 */
function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
}

export function createAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }
  return createClient(supabaseUrl(), key)
}
