// lib/supabase/client.ts
// Browser-side Supabase client (singleton).
import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null

/**
 * Returns the shared browser Supabase client, creating it on first use.
 *
 * Env vars are read at module-eval time by Next's bundler, so they must be
 * present in `.env.local` for any browser query to succeed.
 */
export function getSupabaseBrowserClient() {
  if (client) return client

  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  return client
}

/** Alias kept so older call sites using `createClient()` keep working. */
export const createClient = getSupabaseBrowserClient

/** True when both public Supabase env vars are configured. */
export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
