'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import DataControlCenter from './data-control-center'
import BlockApprovals from './block-approvals'
import DowntimeSavings from './downtime-savings'
import ChatAssistant from './chat-assistant'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Database,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Settings2,
  Sparkles,
  TrainFront,
  UploadCloud,
  X,
} from 'lucide-react'
import { SkeletonMetricGrid, SkeletonTable } from './skeletons'
import {
  DEPARTMENT_STYLES,
  DEPARTMENTS,
  riskToPriority,
  type CorridorWindow,
  type Department,
  type MaintenanceDefect,
  type OptimizationResult,
  type PlanningHorizon,
} from '@/lib/types'

// ============================================================================
// HELPERS
// ============================================================================

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDayLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
}

function durationHours(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round((ms / 3_600_000) * 10) / 10
}

function priorityClass(score: number) {
  const level = riskToPriority(score)
  if (level === 'Critical') return 'severity-badge critical'
  if (level === 'High') return 'severity-badge high'
  if (level === 'Medium') return 'severity-badge medium'
  return 'severity-badge low'
}

function DepartmentBadge({ department }: { department: Department }) {
  const style = DEPARTMENT_STYLES[department]
  if (!style) return <span className="text-xs">{department}</span>

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-semibold ${style.bg} ${style.border} ${style.text}`}
    >
      <i className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.short}
    </span>
  )
}

function EmptyState({
  title,
  message,
  icon: Icon,
}: {
  title: string
  message: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center px-6 py-12 text-center"
    >
      <Icon size={44} className="mb-4 text-slate-300" />
      <h3 className="mb-1 text-base font-semibold text-slate-600">{title}</h3>
      <p className="max-w-sm text-sm text-slate-500">{message}</p>
    </motion.div>
  )
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string
  value: string | number
  hint?: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  tone: 'orange' | 'red' | 'blue' | 'green'
}) {
  return (
    <motion.div
      className="metric"
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', damping: 18 }}
    >
      <div className={`metric-icon ${tone}`}>
        <Icon size={17} />
      </div>
      <div className="min-w-0">
        <span>{label}</span>
        <strong>{value}</strong>
        {hint && <small>{hint}</small>}
      </div>
    </motion.div>
  )
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'backlog', label: 'Defect Backlog', icon: ClipboardList },
  { id: 'optimization', label: 'Block Optimization', icon: Gauge },
  { id: 'approvals', label: 'Block Approvals', icon: CheckCircle2 },
  { id: 'corridors', label: 'Corridor Windows', icon: CalendarDays },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'data', label: 'Data Ingestion', icon: Database },
  { id: 'settings', label: 'Workspace Settings', icon: Settings2 },
] as const

type TabId = (typeof TABS)[number]['id']

// ============================================================================
// MAIN DASHBOARD
// ============================================================================

export default function RailPrioritizeDashboard() {
  const { profile, initials, signOut, loading: authLoading, isDevSession } = useAuth()
  const router = useRouter()

  const [defects, setDefects] = useState<MaintenanceDefect[]>([])
  const [windows, setWindows] = useState<CorridorWindow[]>([])
  const [loadingData, setLoadingData] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [usedSynthetic, setUsedSynthetic] = useState(false)

  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [departmentFilter, setDepartmentFilter] = useState<'All' | Department>('All')
  const [sectionFilter, setSectionFilter] = useState('All')

  const [horizon, setHorizon] = useState<PlanningHorizon>('weekly')
  const [optimizing, setOptimizing] = useState(false)
  const [optimization, setOptimization] = useState<OptimizationResult | null>(null)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)

  // ------------------------------------------------------------------ data

  const loadData = useCallback(async () => {
    setLoadingData(true)
    setDataError(null)
    try {
      // Served by the same loader the optimiser uses, so the two always agree
      // — including when a source table is empty and falls back to synthetic.
      const response = await fetch('/api/dataset')
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed (${response.status})`)
      }

      setDefects((payload.defects ?? []) as MaintenanceDefect[])
      setWindows((payload.windows ?? []) as CorridorWindow[])
      setUsedSynthetic(Boolean(payload.usedSynthetic))
    } catch (error) {
      setDefects([])
      setWindows([])
      setDataError(
        error instanceof Error ? error.message : 'Could not load the dataset.'
      )
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => {
    if (profile) void loadData()
  }, [profile, loadData])

  // -------------------------------------------------------------- optimize

  const runOptimization = useCallback(async () => {
    setOptimizing(true)
    setOptimizeError(null)
    setActiveTab('optimization')

    try {
      const response = await fetch('/api/optimize-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ horizon }),
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed (${response.status})`)
      }

      setOptimization(payload as OptimizationResult)
    } catch (error) {
      setOptimization(null)
      setOptimizeError(
        error instanceof Error ? error.message : 'Optimization request failed.'
      )
    } finally {
      setOptimizing(false)
    }
  }, [horizon])

  // --------------------------------------------------------------- derived

  const sections = useMemo(() => {
    const unique = new Set(defects.map((d) => d.section_code))
    return ['All', ...Array.from(unique).sort()]
  }, [defects])

  const filteredDefects = useMemo(() => {
    return defects.filter((defect) => {
      const deptMatch =
        departmentFilter === 'All' || defect.department === departmentFilter
      const sectionMatch =
        sectionFilter === 'All' || defect.section_code === sectionFilter
      return deptMatch && sectionMatch
    })
  }, [defects, departmentFilter, sectionFilter])

  // ---------------------------------------------------------------- render

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RefreshCw className="animate-spin text-slate-400" size={28} />
      </div>
    )
  }

  // Route guards in proxy.ts and app/dashboard/layout.tsx mean an
  // unauthenticated user never reaches this component. If the profile row is
  // still loading (or missing), show a spinner rather than a login form.
  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <RefreshCw className="animate-spin text-slate-400" size={28} />
        <p className="text-sm text-slate-500">Loading your profile…</p>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {/* ---------------------------------------------------------- sidebar */}
      <aside className={mobileNavOpen ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <span className="brand-mark">
            <TrainFront size={21} />
          </span>
          <span>
            Rail<span>Prioritize</span>
          </span>
          <button className="mobile-close" onClick={() => setMobileNavOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="workspace">
          <span className="status-dot" /> Block Planning Workspace
        </div>

        <nav className="sidebar-nav">
          {TABS.map(({ id, label, icon: Icon }) => (
            <motion.button
              key={id}
              onClick={() => {
                setActiveTab(id)
                setMobileNavOpen(false)
              }}
              className={`nav-item ${activeTab === id ? 'active' : ''}`}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.98 }}
            >
              <Icon size={17} />
              <span>{label}</span>
              {id === 'backlog' && defects.length > 0 && <b>{defects.length}</b>}
            </motion.button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="profile">
            <div className="avatar">{initials}</div>
            <div className="flex-1 min-w-0">
              <strong>{profile.full_name ?? profile.email}</strong>
              <small>{profile.role}</small>
            </div>
            <motion.button
              className="logout"
              onClick={async () => {
                await signOut()
                // Full navigation so proxy.ts re-evaluates the cleared cookie.
                router.replace('/login')
                router.refresh()
              }}
              title="Sign out"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <LogOut size={15} />
            </motion.button>
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------------------- main */}
      <main className="content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNavOpen(true)}>
            <Menu size={20} />
          </button>

          <div className="min-w-0">
            <p className="eyebrow">
              CENTRAL BLOCK CONTROL • {profile.department.toUpperCase()}
              {isDevSession && <span> • DEV SESSION</span>}
            </p>
            <motion.h1
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              key={activeTab}
            >
              {TABS.find((t) => t.id === activeTab)?.label}
            </motion.h1>
          </div>

          <div className="top-actions">
            <HorizonToggle value={horizon} onChange={setHorizon} disabled={optimizing} />

            <motion.button
              onClick={runOptimization}
              disabled={optimizing}
              className="primary-button"
              whileHover={{ scale: optimizing ? 1 : 1.02 }}
              whileTap={{ scale: 0.98 }}
              title="Reconcile all department requests against corridor availability"
            >
              {optimizing ? (
                <>
                  <RefreshCw size={15} className="spin-icon" />
                  Optimizing…
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  Run AI Optimization Engine
                </>
              )}
            </motion.button>

            <div className="avatar top-avatar">{initials}</div>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="page-body"
          >
            {usedSynthetic && !dataError && (
              <div className="reoptimize-alert amber mb-5 flex items-center gap-3 rounded border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle size={17} className="shrink-0" />
                <span>
                  Some source systems have no records yet, so part of this view
                  is <strong>synthetic sample data</strong>. Upload real
                  extracts from the Data Ingestion tab to replace it.
                </span>
                <button
                  onClick={() => setActiveTab('data')}
                  className="ml-auto shrink-0 font-semibold underline"
                >
                  Review sources
                </button>
              </div>
            )}

            {dataError && (
              <div className="reoptimize-alert error">
                <AlertTriangle size={17} />
                <span>{dataError}</span>
                <button
                  onClick={() => void loadData()}
                  className="ml-auto font-semibold underline"
                >
                  Retry
                </button>
              </div>
            )}

            {activeTab === 'overview' && (
              <Overview
                defects={defects}
                windows={windows}
                isLoading={loadingData}
                onRunOptimization={runOptimization}
                optimizing={optimizing}
              />
            )}

            {activeTab === 'backlog' && (
              <Backlog
                defects={filteredDefects}
                isLoading={loadingData}
                departmentFilter={departmentFilter}
                onDepartmentChange={setDepartmentFilter}
                sectionFilter={sectionFilter}
                onSectionChange={setSectionFilter}
                sections={sections}
              />
            )}

            {activeTab === 'optimization' && (
              <OptimizationView
                result={optimization}
                optimizing={optimizing}
                error={optimizeError}
                horizon={horizon}
                onRun={runOptimization}
              />
            )}

            {activeTab === 'corridors' && (
              <Corridors windows={windows} isLoading={loadingData} />
            )}

            {activeTab === 'analytics' && (
              <AnalyticsView defects={defects} isLoading={loadingData} />
            )}

            {activeTab === 'approvals' && (
              <BlockApprovals defects={defects} onChanged={loadData} />
            )}

            {activeTab === 'data' && (
              <DataControlCenter onDataChanged={loadData} />
            )}

            {activeTab === 'settings' && <SettingsView />}
          </motion.div>
        </AnimatePresence>
      </main>

      <ChatAssistant
        context={{
          defectCount: defects.length,
          overdueCount: defects.filter((d) => d.is_overdue).length,
          criticalCount: defects.filter((d) => Number(d.risk_score) >= 80).length,
          windowCount: windows.length,
          blockCount: optimization?.optimized_blocks?.length ?? 0,
          downtimeSavedHrs: Number(
            optimization?.kpi_metrics?.total_downtime_saved_hrs ?? 0
          ),
        }}
      />
    </div>
  )
}

// ============================================================================
// HORIZON TOGGLE
// ============================================================================

function HorizonToggle({
  value,
  onChange,
  disabled,
}: {
  value: PlanningHorizon
  onChange: (next: PlanningHorizon) => void
  disabled?: boolean
}) {
  const options: { id: PlanningHorizon; label: string; title: string }[] = [
    {
      id: 'weekly',
      label: 'Weekly',
      title: 'Weekly Execution Plan — blocks for the next 7 days',
    },
    {
      id: 'monthly',
      label: 'Monthly',
      title: 'Monthly Advance Reservation — corridor bookings for the next 30 days',
    },
  ]

  return (
    <div
      className="inline-flex rounded-md border border-slate-300 bg-white p-0.5"
      role="group"
      aria-label="Planning horizon"
    >
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          disabled={disabled}
          title={option.title}
          aria-pressed={value === option.id}
          className={`rounded px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
            value === option.id
              ? 'bg-[#003C71] text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// ============================================================================
// OVERVIEW
// ============================================================================

function Overview({
  defects,
  windows,
  isLoading,
  onRunOptimization,
  optimizing,
}: {
  defects: MaintenanceDefect[]
  windows: CorridorWindow[]
  isLoading: boolean
  onRunOptimization: () => void
  optimizing: boolean
}) {
  if (isLoading) return <SkeletonMetricGrid />

  if (defects.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          title="No maintenance backlog"
          message="Nothing has been ingested yet. Upload a TMS, SMMS or TDMS export from the Data Ingestion tab, or run database/multi-dept-schema.sql to load the sample backlog."
          icon={Database}
        />
      </div>
    )
  }

  const overdue = defects.filter((d) => d.is_overdue).length
  const critical = defects.filter((d) => Number(d.risk_score) >= 80).length
  const totalHours = defects.reduce(
    (sum, d) => sum + Number(d.duration_required_hrs || 0),
    0
  )

  // Sections where more than one department is waiting — these are the
  // opportunities the optimiser can convert into a single closure.
  const contendedSections = Object.entries(
    defects.reduce<Record<string, Set<Department>>>((acc, defect) => {
      acc[defect.section_code] ??= new Set()
      acc[defect.section_code].add(defect.department)
      return acc
    }, {})
  ).filter(([, depts]) => depts.size > 1)

  return (
    <div className="space-y-5">
      <div className="metric-grid">
        <MetricCard
          label="Pending Defects"
          value={defects.length}
          hint={`${totalHours.toFixed(1)} h of work requested`}
          icon={ClipboardList}
          tone="blue"
        />
        <MetricCard
          label="Overdue"
          value={overdue}
          hint="Past scheduled maintenance date"
          icon={AlertTriangle}
          tone="red"
        />
        <MetricCard
          label="Safety Critical"
          value={critical}
          hint="Risk score 80 or above"
          icon={Gauge}
          tone="orange"
        />
        <MetricCard
          label="Corridor Windows"
          value={windows.length}
          hint="Available COA slots"
          icon={CalendarDays}
          tone="green"
        />
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h3>Multi-Department Co-Use Opportunities</h3>
          <button onClick={onRunOptimization} disabled={optimizing}>
            {optimizing ? 'Optimizing…' : 'Optimize now'}
          </button>
        </div>

        {contendedSections.length === 0 ? (
          <EmptyState
            title="No overlapping requests"
            message="Every section currently has requests from a single department, so there is nothing to combine."
            icon={CheckCircle2}
          />
        ) : (
          <div className="p-4 space-y-2">
            <p className="mb-3 text-sm text-slate-600">
              {contendedSections.length} section
              {contendedSections.length === 1 ? '' : 's'} have competing requests
              from more than one department. Combining these into single
              closures is where downtime is saved.
            </p>
            {contendedSections.map(([section, depts]) => {
              const sectionDefects = defects.filter(
                (d) => d.section_code === section
              )
              const separate = sectionDefects.reduce(
                (sum, d) => sum + Number(d.duration_required_hrs || 0),
                0
              )
              const combined = Math.max(
                ...sectionDefects.map((d) => Number(d.duration_required_hrs || 0))
              )
              return (
                <div
                  key={section}
                  className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 p-3"
                >
                  <strong className="font-mono text-sm">{section}</strong>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(depts).map((dept) => (
                      <DepartmentBadge key={dept} department={dept} />
                    ))}
                  </div>
                  <span className="ml-auto text-xs text-slate-600">
                    {sectionDefects.length} tasks · {separate.toFixed(1)} h separate
                    vs ~{combined.toFixed(1)} h combined
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h3>Highest Risk Defects</h3>
        </div>
        {defects.slice(0, 6).map((defect) => (
          <div key={defect.id} className="queue-row">
            <span
              className={`severity-dot ${riskToPriority(
                Number(defect.risk_score)
              ).toLowerCase()}`}
            />
            <div className="queue-main">
              <strong>
                {defect.asset_id} · {defect.section_code}
              </strong>
              <span>{defect.defect_description}</span>
            </div>
            <DepartmentBadge department={defect.department} />
            <span className={priorityClass(Number(defect.risk_score))}>
              {riskToPriority(Number(defect.risk_score))}
            </span>
            <span className="risk-score">{Number(defect.risk_score).toFixed(0)}</span>
          </div>
        ))}
      </section>
    </div>
  )
}

// ============================================================================
// BACKLOG
// ============================================================================

function Backlog({
  defects,
  isLoading,
  departmentFilter,
  onDepartmentChange,
  sectionFilter,
  onSectionChange,
  sections,
}: {
  defects: MaintenanceDefect[]
  isLoading: boolean
  departmentFilter: 'All' | Department
  onDepartmentChange: (value: 'All' | Department) => void
  sectionFilter: string
  onSectionChange: (value: string) => void
  sections: string[]
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={departmentFilter}
          onChange={(e) => onDepartmentChange(e.target.value as 'All' | Department)}
          className="filter-select"
        >
          <option value="All">All departments</option>
          {DEPARTMENTS.map((dept) => (
            <option key={dept} value={dept}>
              {DEPARTMENT_STYLES[dept].label}
            </option>
          ))}
        </select>

        <select
          value={sectionFilter}
          onChange={(e) => onSectionChange(e.target.value)}
          className="filter-select"
        >
          {sections.map((section) => (
            <option key={section} value={section}>
              {section === 'All' ? 'All sections' : section}
            </option>
          ))}
        </select>

        <span className="status-pill">{defects.length} defects</span>
      </div>

      {isLoading ? (
        <SkeletonTable />
      ) : defects.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="Nothing matches"
            message="No defects match the current department and section filters."
            icon={ClipboardList}
          />
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <th className="p-3 text-left">Asset</th>
                <th className="p-3 text-left">Dept</th>
                <th className="p-3 text-left">Source</th>
                <th className="p-3 text-left">Section</th>
                <th className="p-3 text-left">Defect</th>
                <th className="p-3 text-right">Risk</th>
                <th className="p-3 text-right">Crit.</th>
                <th className="p-3 text-right">Hours</th>
                <th className="p-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {defects.map((defect) => (
                <tr key={defect.id} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="p-3 font-mono text-xs font-semibold">
                    {defect.asset_id}
                  </td>
                  <td className="p-3">
                    <DepartmentBadge department={defect.department} />
                  </td>
                  <td className="p-3 text-xs text-slate-500">{defect.system_source}</td>
                  <td className="p-3 font-mono text-xs">{defect.section_code}</td>
                  <td className="p-3 max-w-xs text-xs text-slate-600">
                    {defect.defect_description}
                  </td>
                  <td className="p-3 text-right">
                    <span className={priorityClass(Number(defect.risk_score))}>
                      {Number(defect.risk_score).toFixed(0)}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono text-xs">
                    {defect.asset_criticality_score}/10
                  </td>
                  <td className="p-3 text-right font-mono text-xs">
                    {Number(defect.duration_required_hrs).toFixed(2)}
                  </td>
                  <td className="p-3 text-center">
                    {defect.is_overdue ? (
                      <span className="status-pill orange">Overdue</span>
                    ) : (
                      <span className="status-pill">Scheduled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// OPTIMIZATION VIEW
// ============================================================================

function OptimizationView({
  result,
  optimizing,
  error,
  horizon,
  onRun,
}: {
  result: OptimizationResult | null
  optimizing: boolean
  error: string | null
  horizon: PlanningHorizon
  onRun: () => void
}) {
  const horizonLabel =
    horizon === 'monthly' ? 'Monthly Advance Reservation' : 'Weekly Execution Plan'

  if (optimizing) {
    return (
      <div className="space-y-5">
        <div className="reoptimize-alert success">
          <RefreshCw size={17} className="spin-icon" />
          <span>
            Reconciling department requests against corridor availability…
          </span>
        </div>
        <SkeletonMetricGrid />
        <div className="panel p-4">
          <SkeletonTable />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="reoptimize-alert error">
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
        <div className="panel">
          <EmptyState
            title="Optimization did not complete"
            message="Fix the issue above, then run the engine again."
            icon={AlertTriangle}
          />
          <div className="flex justify-center pb-6">
            <button onClick={onRun} className="primary-button">
              <Sparkles size={15} />
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="panel">
        <EmptyState
          title="No plan generated yet"
          message={`Run the AI Optimization Engine to build a ${horizonLabel.toLowerCase()} that combines compatible Engineering, S&T and Traction work into shared corridor blocks.`}
          icon={Sparkles}
        />
        <div className="flex justify-center pb-6">
          <button onClick={onRun} className="primary-button">
            <Sparkles size={15} />
            Run AI Optimization Engine
          </button>
        </div>
      </div>
    )
  }

  const kpi = result.kpi_metrics
  const blocks = result.optimized_blocks ?? []

  // Group blocks by calendar day for the timetable.
  const byDay = blocks.reduce<Record<string, typeof blocks>>((acc, block) => {
    const key = new Date(block.block_window_start).toDateString()
    acc[key] ??= []
    acc[key].push(block)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {/* Executive summary banner */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg border-l-4 border-[#e27625] bg-white p-4 shadow-sm"
      >
        <div className="mb-1 flex items-center gap-2">
          <Sparkles size={15} className="text-[#e27625]" />
          <strong className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Executive Summary · {horizonLabel}
          </strong>
        </div>
        <p className="text-sm leading-relaxed text-slate-700">
          {result.executive_summary}
        </p>
      </motion.div>

      {/* Before-vs-after downtime, computed in code rather than by the model. */}
      {result.downtime_metrics && (
        <DowntimeSavings metrics={result.downtime_metrics} />
      )}

      {/* KPI cards */}
      <div className="metric-grid">
        <MetricCard
          label="Network Safety Index"
          value={Number(kpi?.network_safety_index ?? 0).toFixed(1)}
          hint="Post-plan, out of 100"
          icon={Gauge}
          tone="green"
        />
        <MetricCard
          label="Total Downtime Saved"
          value={`${Number(kpi?.total_downtime_saved_hrs ?? 0).toFixed(1)} h`}
          hint="Versus separate closures"
          icon={CheckCircle2}
          tone="blue"
        />
        <MetricCard
          label="Multi-Dept Co-Use Rate"
          value={`${Number(kpi?.multi_dept_co_use_rate_pct ?? 0).toFixed(0)}%`}
          hint="Blocks shared by 2+ departments"
          icon={LayoutDashboard}
          tone="orange"
        />
        <MetricCard
          label="Backlog Reduction"
          value={`${Number(kpi?.overdue_backlog_reduced_pct ?? 0).toFixed(0)}%`}
          hint="Overdue items cleared"
          icon={ClipboardList}
          tone="red"
        />
      </div>

      {/* Department legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Departments
        </span>
        {DEPARTMENTS.map((dept) => (
          <span key={dept} className="flex items-center gap-2 text-xs text-slate-600">
            <i
              className={`inline-block h-2.5 w-2.5 rounded-full ${DEPARTMENT_STYLES[dept].dot}`}
            />
            {DEPARTMENT_STYLES[dept].label}
          </span>
        ))}
      </div>

      {/* Timetable */}
      {blocks.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="No blocks recommended"
            message="The engine could not fit any maintenance into the available corridor windows for this horizon."
            icon={CalendarDays}
          />
        </div>
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <h3>Optimized Block Timetable</h3>
            <span className="status-pill">
              {blocks.length} block{blocks.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="space-y-5 p-4">
            {Object.entries(byDay).map(([day, dayBlocks]) => (
              <div key={day}>
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  {formatDayLabel(dayBlocks[0].block_window_start)}
                </div>

                <div className="space-y-3">
                  {dayBlocks.map((block, index) => (
                    <motion.div
                      key={`${block.section_code}-${block.block_window_start}-${index}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="rounded-lg border border-slate-200 bg-white p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <span className="font-mono text-sm font-bold">
                          {block.section_code}
                        </span>
                        <span className="text-sm text-slate-600">
                          {formatTime(block.block_window_start)} –{' '}
                          {formatTime(block.block_window_end)}
                          <span className="ml-1 text-xs text-slate-400">
                            (
                            {durationHours(
                              block.block_window_start,
                              block.block_window_end
                            )}{' '}
                            h)
                          </span>
                        </span>

                        <div className="flex flex-wrap gap-1.5">
                          {(block.combined_departments ?? []).map((dept) => (
                            <DepartmentBadge key={dept} department={dept} />
                          ))}
                        </div>

                        <span className="ml-auto rounded bg-green-50 px-2 py-1 text-xs font-semibold text-green-800">
                          −{Number(block.downtime_saved_hours ?? 0).toFixed(1)} h
                          downtime
                        </span>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {(block.combined_tasks ?? []).map((task, taskIndex) => {
                          const style =
                            DEPARTMENT_STYLES[task.dept] ??
                            DEPARTMENT_STYLES.Engineering
                          return (
                            <div
                              key={`${task.asset}-${taskIndex}`}
                              className={`rounded border-l-4 p-2.5 ${style.bg} ${style.border}`}
                            >
                              <div
                                className={`text-[11px] font-bold uppercase ${style.text}`}
                              >
                                {style.short}
                              </div>
                              <div className="font-mono text-xs font-semibold text-slate-800">
                                {task.asset}
                              </div>
                              <div className="text-xs text-slate-600">{task.task}</div>
                            </div>
                          )
                        })}
                      </div>

                      <p className="mt-3 text-xs text-slate-500">
                        Traffic impact: {block.traffic_impact}
                      </p>
                    </motion.div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ============================================================================
// CORRIDORS
// ============================================================================

function Corridors({
  windows,
  isLoading,
}: {
  windows: CorridorWindow[]
  isLoading: boolean
}) {
  if (isLoading) return <SkeletonTable />

  if (windows.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          title="No corridor windows"
          message="Upload a COA window file from the Data Ingestion tab, or seed the sample data."
          icon={CalendarDays}
        />
      </div>
    )
  }

  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <th className="p-3 text-left">Section</th>
            <th className="p-3 text-left">Window Start</th>
            <th className="p-3 text-left">Window End</th>
            <th className="p-3 text-right">Length</th>
            <th className="p-3 text-center">Passenger Density</th>
            <th className="p-3 text-right">Freight Impact</th>
          </tr>
        </thead>
        <tbody>
          {windows.map((window) => (
            <tr key={window.id} className="border-b last:border-0 hover:bg-slate-50">
              <td className="p-3 font-mono text-xs font-semibold">
                {window.section_code}
              </td>
              <td className="p-3 text-xs">{formatDateTime(window.window_start)}</td>
              <td className="p-3 text-xs">{formatDateTime(window.window_end)}</td>
              <td className="p-3 text-right font-mono text-xs">
                {durationHours(window.window_start, window.window_end)} h
              </td>
              <td className="p-3 text-center">
                <span
                  className={`status-pill ${
                    window.passenger_traffic_density === 'Low'
                      ? 'green'
                      : window.passenger_traffic_density === 'Medium'
                        ? 'amber'
                        : 'orange'
                  }`}
                >
                  {window.passenger_traffic_density}
                </span>
              </td>
              <td className="p-3 text-right font-mono text-xs">
                {window.freight_impact_score}/5
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ============================================================================
// ANALYTICS
// ============================================================================

function AnalyticsView({
  defects,
  isLoading,
}: {
  defects: MaintenanceDefect[]
  isLoading: boolean
}) {
  if (isLoading) return <SkeletonMetricGrid />

  if (defects.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          title="Nothing to analyse"
          message="Ingest a maintenance backlog first."
          icon={BarChart3}
        />
      </div>
    )
  }

  const byDepartment = DEPARTMENTS.map((dept) => {
    const items = defects.filter((d) => d.department === dept)
    return {
      dept,
      count: items.length,
      hours: items.reduce((sum, d) => sum + Number(d.duration_required_hrs || 0), 0),
      overdue: items.filter((d) => d.is_overdue).length,
    }
  })

  const maxCount = Math.max(1, ...byDepartment.map((d) => d.count))
  const avgRisk =
    defects.reduce((sum, d) => sum + Number(d.risk_score || 0), 0) / defects.length
  const overduePct = Math.round(
    (defects.filter((d) => d.is_overdue).length / defects.length) * 100
  )

  return (
    <div className="space-y-5">
      <div className="metric-grid">
        <MetricCard
          label="Average Risk Score"
          value={avgRisk.toFixed(1)}
          icon={Gauge}
          tone="orange"
        />
        <MetricCard
          label="Overdue Share"
          value={`${overduePct}%`}
          icon={AlertTriangle}
          tone="red"
        />
        <MetricCard
          label="Total Work Requested"
          value={`${defects
            .reduce((sum, d) => sum + Number(d.duration_required_hrs || 0), 0)
            .toFixed(1)} h`}
          icon={ClipboardList}
          tone="blue"
        />
        <MetricCard
          label="Sections Affected"
          value={new Set(defects.map((d) => d.section_code)).size}
          icon={CalendarDays}
          tone="green"
        />
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h3>Backlog by Department</h3>
        </div>
        <div className="space-y-4 p-5">
          {byDepartment.map(({ dept, count, hours, overdue }) => (
            <div key={dept}>
              <div className="mb-1.5 flex items-center gap-3 text-xs">
                <DepartmentBadge department={dept} />
                <span className="text-slate-600">
                  {DEPARTMENT_STYLES[dept].label}
                </span>
                <span className="ml-auto font-mono text-slate-700">
                  {count} defects · {hours.toFixed(1)} h · {overdue} overdue
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <motion.div
                  className={`h-full rounded-full ${DEPARTMENT_STYLES[dept].dot}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${(count / maxCount) * 100}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

// ============================================================================
// SETTINGS
// ============================================================================

function SettingsView() {
  const { profile, isDevSession } = useAuth()

  return (
    <div className="panel p-6">
      <h2 className="mb-5 text-lg font-bold">Workspace Settings</h2>

      <dl className="mb-6 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-slate-500">Full name</dt>
          <dd>{profile?.full_name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">Role</dt>
          <dd>{profile?.role ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">Department</dt>
          <dd>{profile?.department ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">Email</dt>
          <dd className="break-all">{profile?.email ?? '—'}</dd>
        </div>
      </dl>

      {isDevSession && (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <UploadCloud size={16} className="mt-0.5 shrink-0" />
          <span>
            You are signed in through the local developer bypass
            (<code className="font-mono text-xs">NEXT_PUBLIC_DEV_AUTH_BYPASS</code>).
            It is ignored in production builds. Unset it to exercise the real
            Supabase sign-in flow.
          </span>
        </div>
      )}
    </div>
  )
}
