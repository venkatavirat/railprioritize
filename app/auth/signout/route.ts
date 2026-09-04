import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Clears the Supabase session cookies, then sends the user to /login.
 *
 * This exists to break a redirect loop. proxy.ts can only check that an auth
 * cookie *exists*; app/dashboard/layout.tsx is the one that validates it. When
 * a cookie is present but stale, those two disagree forever:
 *
 *   /login -> (proxy sees cookie) -> /dashboard -> (layout: invalid) -> /login -> …
 *
 * Redirecting the failed case through here removes the cookie that the proxy
 * was reacting to, so the next hop settles on /login and stops.
 */
export async function GET(request: NextRequest) {
  const target = new URL('/login', request.url)

  const reason = request.nextUrl.searchParams.get('reason')
  if (reason) target.searchParams.set('reason', reason)

  const redirectTo = request.nextUrl.searchParams.get('redirectTo')
  if (redirectTo?.startsWith('/')) {
    target.searchParams.set('redirectTo', redirectTo)
  }

  const response = NextResponse.redirect(target)

  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token')) {
      // maxAge 0 expires it immediately; path must match how it was written.
      response.cookies.set(cookie.name, '', { maxAge: 0, path: '/' })
    }
  }

  return response
}
