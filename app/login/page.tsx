import { Suspense } from 'react'
import { AuthProvider } from '@/lib/auth-context'
import LoginForm from '@/components/login-form'

export const metadata = {
  title: 'Sign in | RailPrioritize',
}

export default function LoginPage() {
  return (
    <AuthProvider>
      {/* useSearchParams needs a Suspense boundary to stay prerenderable. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthProvider>
  )
}
