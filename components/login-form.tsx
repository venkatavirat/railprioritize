'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { TrainFront, Mail, Lock, User, Building2, Loader, CheckCircle2 } from 'lucide-react'
import {
  useAuth,
  PROFILE_DEPARTMENTS,
  type ProfileDepartment,
} from '@/lib/auth-context'

type Tab = 'signin' | 'signup'

export default function LoginForm() {
  const { signIn, signUp } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  // proxy.ts stashes the originally-requested path here.
  const redirectTo = searchParams.get('redirectTo') || '/dashboard'

  const [tab, setTab] = useState<Tab>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [department, setDepartment] = useState<ProfileDepartment>('Engineering')

  const [error, setError] = useState(
    searchParams.get('reason') === 'expired'
      ? 'Your session has expired. Please sign in again.'
      : ''
  )
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  function switchTab(next: Tab) {
    setTab(next)
    setError('')
    setNotice('')
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)

    try {
      if (tab === 'signin') {
        await signIn(email, password)
        // Full reload so proxy.ts sees the freshly-written session cookie.
        router.replace(redirectTo)
        router.refresh()
        return
      }

      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters.')
      }

      const { needsEmailConfirmation } = await signUp(email, password, {
        fullName,
        department,
      })

      if (needsEmailConfirmation) {
        setNotice(
          'Account created. Check your inbox to confirm the address, then sign in.'
        )
        setTab('signin')
        setPassword('')
      } else {
        router.replace(redirectTo)
        router.refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      {/* ------------------------------------------------------- form panel */}
      <div className="login-panel">
        <div className="login-brand">
          <span className="brand-mark">
            <TrainFront size={19} />
          </span>
          <span>
            Rail<span>Prioritize</span>
          </span>
        </div>

        <div className="login-copy">
          <p className="eyebrow">CENTRAL BLOCK CONTROL</p>
          <h1>
            {tab === 'signin' ? (
              <>
                Sign in to your <em>workspace</em>
              </>
            ) : (
              <>
                Request <em>workspace</em> access
              </>
            )}
          </h1>

          <form className="login-form" onSubmit={handleSubmit}>
            {/* Tab switch */}
            <div
              className="mb-6 inline-flex rounded-md border border-slate-300 bg-white p-0.5"
              role="group"
              aria-label="Authentication mode"
            >
              {(['signin', 'signup'] as Tab[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => switchTab(id)}
                  aria-pressed={tab === id}
                  className={`rounded px-4 py-1.5 text-xs font-semibold transition ${
                    tab === id
                      ? 'bg-[#003C71] text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {id === 'signin' ? 'Sign In' : 'Sign Up'}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="space-y-4"
              >
                {tab === 'signup' && (
                  <>
                    <div>
                      <label htmlFor="fullName">Full name</label>
                      <div className="input-wrap">
                        <User size={15} />
                        <input
                          id="fullName"
                          type="text"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="R. Ramakrishnan"
                          required
                          autoComplete="name"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="department">Department</label>
                      <div className="input-wrap">
                        <Building2 size={15} />
                        <select
                          id="department"
                          value={department}
                          onChange={(e) =>
                            setDepartment(e.target.value as ProfileDepartment)
                          }
                          required
                          className="w-full border-0 bg-transparent py-3 text-sm outline-none"
                        >
                          {PROFILE_DEPARTMENTS.map((dept) => (
                            <option key={dept} value={dept}>
                              {dept}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label htmlFor="email">Official email</label>
                  <div className="input-wrap">
                    <Mail size={15} />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@scr.railways.gov.in"
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password">Password</label>
                  <div className="input-wrap">
                    <Lock size={15} />
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      autoComplete={
                        tab === 'signin' ? 'current-password' : 'new-password'
                      }
                    />
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>

            {error && <p className="error-text">{error}</p>}

            {notice && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-green-700">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                {notice}
              </p>
            )}

            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? (
                <>
                  <Loader size={15} className="spin-icon" />
                  {tab === 'signin' ? 'Signing in…' : 'Creating account…'}
                </>
              ) : tab === 'signin' ? (
                'Sign In'
              ) : (
                'Create Account'
              )}
            </button>

            <small className="login-hint">
              {tab === 'signin'
                ? 'Access is restricted to authorised divisional staff.'
                : 'Your department determines which maintenance systems you can see.'}
            </small>
          </form>
        </div>

        <div className="login-footer">
          <span>South Central Railway · Secunderabad</span>
          <span>v2.0</span>
        </div>
      </div>

      {/* -------------------------------------------------------- art panel */}
      <div className="login-art">
        <div className="route-grid" />
        <div className="art-copy">
          <p className="tag">AI BLOCK OPTIMISATION</p>
          <h2>One corridor. One closure.</h2>
          <p>
            Reconciling Engineering, S&amp;T and Traction maintenance demands
            against live train timetables — so the track opens again sooner.
          </p>
        </div>
        <div className="art-stats">
          <div>
            <strong>3</strong>
            <span>DEPARTMENTS UNIFIED</span>
          </div>
          <div>
            <strong>20.5h</strong>
            <span>DOWNTIME SAVED</span>
          </div>
        </div>
      </div>
    </div>
  )
}
