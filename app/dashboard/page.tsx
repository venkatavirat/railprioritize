import { AuthProvider } from '@/lib/auth-context'
import RailPrioritizeDashboard from '@/components/rail-prioritize-dashboard-final'

export const metadata = {
  title: 'Dashboard | RailPrioritize',
}

export default function DashboardPage() {
  return (
    <AuthProvider>
      <RailPrioritizeDashboard />
    </AuthProvider>
  )
}
