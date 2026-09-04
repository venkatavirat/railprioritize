// lib/current-user.ts
//
// Resolves who is making the current request, for per-user data isolation.
//
// Every ingested row is stamped with an owner and every read is filtered by
// it. The server-side filter is the practical boundary because the app talks
// to Supabase with the service key (which bypasses RLS); the owner-scoped
// policies in database/2026-09-per-user-data-isolation.sql are the second
// line of defence for anything reaching the database directly.

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isDevAuthBypassEnabled } from '@/lib/auth-flags'

/**
 * Stable owner id for the local bypass session.
 *
 * A fixed UUID rather than null, so bypass mode is isolated on exactly the
 * same code path as a real user instead of silently seeing everything.
 */
export const DEV_USER_ID = '00000000-0000-0000-0000-000000000000'

/**
 * The current user's id, or null when nobody is signed in.
 *
 * Callers treat null as "show nothing" rather than "show everything" — a
 * failure to identify the caller must never widen access.
 */
export async function getCurrentUserId(): Promise<string | null> {
  if (isDevAuthBypassEnabled()) return DEV_USER_ID

  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}
