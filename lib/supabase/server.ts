// lib/supabase/server.ts
// Server-side Supabase clients for Route Handlers and Server Actions.
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing ${name}. Add it to .env.local — see SETUP.md for the expected keys.`
    )
  }
  return value
}

/**
 * Cookie-aware server client. Use this when the request's signed-in user
 * matters (RLS policies keyed to auth.uid()).
 *
 * `cookies()` is async in Next.js 16, so this helper must be awaited.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Safe to ignore when middleware/proxy refreshes the session.
          }
        },
      },
    }
  )
}

/**
 * Cookie-free client for background/service work inside Route Handlers.
 *
 * Prefers the service-role key when present so optimizer writes are not
 * blocked by RLS; falls back to the anon key for local development.
 */
export function createSupabaseServiceClient() {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')

  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
