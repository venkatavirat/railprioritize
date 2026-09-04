import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isDevAuthBypassEnabled } from '@/lib/auth-flags'

export const dynamic = 'force-dynamic'

/**
 * Root is a pure dispatcher — it renders nothing, so it cannot participate in
 * a redirect loop. proxy.ts normally handles this first; this is the fallback
 * for when the proxy is skipped (e.g. the dev bypass is on).
 */
export default async function Page() {
  if (isDevAuthBypassEnabled()) {
    redirect('/dashboard')
  }

  let signedIn = false
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    signedIn = Boolean(user)
  } catch {
    signedIn = false
  }

  redirect(signedIn ? '/dashboard' : '/login')
}
