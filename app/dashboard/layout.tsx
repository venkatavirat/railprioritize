import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isDevAuthBypassEnabled } from '@/lib/auth-flags'

// Session state differs per request, so this subtree must never be prerendered.
export const dynamic = 'force-dynamic'

/** Re-thrown so Next's own redirect/notFound signals are not swallowed. */
function isNextControlFlow(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    ((error as { digest: string }).digest.startsWith('NEXT_REDIRECT') ||
      (error as { digest: string }).digest === 'NEXT_NOT_FOUND')
  )
}

/**
 * Authoritative auth gate.
 *
 * proxy.ts only checks that a session cookie *exists*, which a user can forge
 * or leave behind after expiry. `getUser()` validates the token with Supabase,
 * so this is the check that actually protects the route.
 *
 * On failure we redirect through /auth/signout rather than straight to /login:
 * that clears the stale cookie, which is what stops the proxy from bouncing
 * the user back here in an endless loop.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (isDevAuthBypassEnabled()) {
    return <>{children}</>
  }

  let authenticated = false

  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    authenticated = Boolean(user)
  } catch (error) {
    if (isNextControlFlow(error)) throw error

    // Misconfigured or unreachable Supabase. Failing closed is the safe
    // default for an auth gate.
    console.error('Dashboard auth check failed:', error)
    authenticated = false
  }

  if (!authenticated) {
    redirect('/auth/signout?reason=expired')
  }

  return <>{children}</>
}
