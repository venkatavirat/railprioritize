import { NextResponse, type NextRequest } from 'next/server'

// Next.js 16 renamed the `middleware` convention to `proxy`. Same behaviour.
//
// This performs an OPTIMISTIC check only: it looks for the presence of a
// Supabase auth cookie and never hits the database. Per the Next.js docs,
// proxy runs on every request (including prefetches), so authoritative checks
// belong in the protected layout — see app/dashboard/layout.tsx.

/** Routes that require a session. */
const PROTECTED_PREFIXES = ['/dashboard']

/** Routes that a signed-in user should be bounced away from. */
const AUTH_ROUTES = ['/login']

/**
 * Supabase stores its session as `sb-<project-ref>-auth-token`, and splits it
 * into `.0` / `.1` chunks when large. Matching the shape avoids hard-coding
 * the project ref.
 */
function hasSessionCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(
      (cookie) =>
        cookie.name.startsWith('sb-') &&
        cookie.name.includes('-auth-token') &&
        // Chunked cookies can exist but be empty during sign-out.
        cookie.value.length > 0
    )
}

import { isDevAuthBypassEnabled as devBypassEnabled } from '@/lib/auth-flags'

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // With the local bypass on, the client adopts a session that the server
  // cannot see. Redirecting here would fight the client and loop, so stand down.
  if (devBypassEnabled()) {
    return NextResponse.next()
  }

  const signedIn = hasSessionCookie(request)
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
  const isAuthRoute = AUTH_ROUTES.includes(pathname)

  // Root is a pure dispatcher — it never renders, so it can never loop.
  if (pathname === '/') {
    return NextResponse.redirect(
      new URL(signedIn ? '/dashboard' : '/login', request.url)
    )
  }

  // Unauthenticated user reaching for a protected page → /login.
  // /login is not protected, so this redirect terminates.
  if (isProtected && !signedIn) {
    const loginUrl = new URL('/login', request.url)
    // Preserve where they were heading so login can return them there.
    loginUrl.searchParams.set('redirectTo', `${pathname}${search}`)
    return NextResponse.redirect(loginUrl)
  }

  // Signed-in user on /login → /dashboard.
  // /dashboard is protected but they hold a cookie, so this also terminates.
  if (isAuthRoute && signedIn) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  // Skip API routes, static assets and image files so the guard only runs on
  // real page navigations.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
}
