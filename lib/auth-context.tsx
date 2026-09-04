'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getSupabaseBrowserClient } from './supabase/client'
import { isDevAuthBypassEnabled } from './auth-flags'
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js'

// Re-exported for existing client-side imports.
export { isDevAuthBypassEnabled }

/** Departments allowed by the public.profiles CHECK constraint. */
export const PROFILE_DEPARTMENTS = [
  'Engineering',
  'S&T',
  'Traction',
  'Operations',
  'Admin',
] as const

export type ProfileDepartment = (typeof PROFILE_DEPARTMENTS)[number]

/** A row of public.profiles. */
export type Profile = {
  id: string
  email: string
  department: string
  full_name: string | null
  role: string
  created_at?: string
}

export type SignUpDetails = {
  fullName: string
  department: ProfileDepartment
}

type AuthContextType = {
  user: User | null
  profile: Profile | null
  session: Session | null
  loading: boolean
  /** Initials derived from the profile, for the avatar. */
  initials: string
  /** True when the active identity came from the local dev bypass. */
  isDevSession: boolean
  signUp: (
    email: string,
    password: string,
    details: SignUpDetails
  ) => Promise<{ needsEmailConfirmation: boolean }>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/** Identity adopted by the local developer bypass. */
export const DEV_PROFILE: Profile = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'chief.engineer@scr.railways.gov.in',
  department: 'Operations',
  full_name: 'Chief Engineer',
  role: 'Chief Operational Block Planner',
}

/** "Asha Rao" → "AR"; falls back to the email's first two letters. */
export function deriveInitials(profile: Profile | null): string {
  if (!profile) return '—'

  const name = profile.full_name?.trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  }

  return profile.email.slice(0, 2).toUpperCase()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isDevSession, setIsDevSession] = useState(false)

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from('profiles')
        .select('id,email,department,full_name,role,created_at')
        .eq('id', userId)
        .maybeSingle()

      if (error) {
        console.error('Error fetching profile:', error.message)
        return
      }

      if (data) {
        setProfile(data as Profile)
      } else {
        console.warn(
          'No profile row for user',
          userId,
          '— has supabase/migrations/00_reset_auth.sql been run?'
        )
      }
    } catch (error) {
      console.error('Error fetching profile:', error)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (isDevAuthBypassEnabled()) {
      setProfile(DEV_PROFILE)
      setIsDevSession(true)
      setLoading(false)
      return
    }

    const supabase = getSupabaseBrowserClient()

    const initAuth = async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (cancelled) return

        setSession(data.session)
        setUser(data.session?.user ?? null)

        if (data.session?.user) {
          await fetchProfile(data.session.user.id)
        }
      } catch (error) {
        console.error('Auth init error:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void initAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (_event: AuthChangeEvent, nextSession: Session | null) => {
        setSession(nextSession)
        setUser(nextSession?.user ?? null)

        if (nextSession?.user) {
          await fetchProfile(nextSession.user.id)
        } else {
          setProfile(null)
        }
        setLoading(false)
      }
    )

    return () => {
      cancelled = true
      subscription?.unsubscribe()
    }
  }, [fetchProfile])

  async function signUp(
    email: string,
    password: string,
    details: SignUpDetails
  ): Promise<{ needsEmailConfirmation: boolean }> {
    const supabase = getSupabaseBrowserClient()

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Consumed by the handle_new_user() trigger to populate the profile.
        data: {
          full_name: details.fullName,
          department: details.department,
        },
      },
    })

    if (error) throw error

    // With email confirmation enabled, Supabase returns a user but no session.
    if (data.user && !data.session) {
      return { needsEmailConfirmation: true }
    }

    if (data.user) {
      await fetchProfile(data.user.id)
    }

    return { needsEmailConfirmation: false }
  }

  async function signIn(email: string, password: string) {
    const supabase = getSupabaseBrowserClient()

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) throw error
    if (data.user) await fetchProfile(data.user.id)
  }

  async function signOut() {
    if (isDevSession) {
      setProfile(null)
      setIsDevSession(false)
      return
    }

    const supabase = getSupabaseBrowserClient()
    const { error } = await supabase.auth.signOut()
    if (error) throw error

    setUser(null)
    setProfile(null)
    setSession(null)
  }

  const initials = useMemo(() => deriveInitials(profile), [profile])

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        loading,
        initials,
        isDevSession,
        signUp,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
