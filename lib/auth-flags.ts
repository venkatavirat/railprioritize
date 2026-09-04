// lib/auth-flags.ts
//
// Deliberately NOT a 'use client' module: this is imported from server
// components (app/page.tsx, app/dashboard/layout.tsx), the proxy, and client
// components alike, so all four agree on one definition.

/**
 * The local developer auth bypass.
 *
 * Requires BOTH an explicit opt-in flag and a non-production build, so it can
 * never leave an unauthenticated hole in a deployed environment — it compiles
 * to `return false` in a production build.
 */
export function isDevAuthBypassEnabled() {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true'
  )
}
