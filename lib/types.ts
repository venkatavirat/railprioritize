// lib/types.ts
// Domain model for the multi-department block optimisation system.
// These mirror the tables created by database/multi-dept-schema.sql.

/** Maintenance-owning departments, matching the `dept_type` Postgres enum. */
export const DEPARTMENTS = ['Engineering', 'S&T', 'Traction_TRD'] as const
export type Department = (typeof DEPARTMENTS)[number]

/** Source system each department raises its requests in. */
export const SYSTEM_SOURCES = ['TMS', 'SMMS', 'TDMS'] as const
export type SystemSource = (typeof SYSTEM_SOURCES)[number]

export const PRIORITY_LEVELS = ['Critical', 'High', 'Medium', 'Low'] as const
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number]

export type TrafficDensity = 'High' | 'Medium' | 'Low'

/** Planning horizon for the schedule view. */
export type PlanningHorizon = 'weekly' | 'monthly'

/** A row of `maintenance_defects`. */
export type MaintenanceDefect = {
  id: string
  department: Department
  system_source: string
  asset_id: string
  asset_criticality_score: number
  section_code: string
  defect_description: string
  risk_score: number
  duration_required_hrs: number
  is_overdue: boolean
  created_at: string
}

/** A row of `corridor_windows` (COA traffic availability). */
export type CorridorWindow = {
  id: string
  section_code: string
  window_start: string
  window_end: string
  freight_impact_score: number
  passenger_traffic_density: string
}

/** A row of `block_schedules` (persisted AI recommendations). */
export type BlockSchedule = {
  id: string
  section_code: string
  block_start: string
  block_end: string
  combined_departments: Department[]
  assigned_defect_ids: string[]
  total_downtime_saved_hrs: number
  status: string
}

// ---------------------------------------------------------------------------
// AI optimisation response contract (/api/optimize-schedule)
// ---------------------------------------------------------------------------

export type KpiMetrics = {
  network_safety_index: number
  total_downtime_saved_hrs: number
  multi_dept_co_use_rate_pct: number
  overdue_backlog_reduced_pct: number
}

export type CombinedTask = {
  dept: Department
  asset: string
  task: string
}

export type OptimizedBlock = {
  section_code: string
  block_window_start: string
  block_window_end: string
  combined_departments: Department[]
  combined_tasks: CombinedTask[]
  downtime_saved_hours: number
  traffic_impact: string
}

export type OptimizationResult = {
  kpi_metrics: KpiMetrics
  optimized_blocks: OptimizedBlock[]
  executive_summary: string
}

/** Per-department colour tokens used across the schedule grid and legends. */
export const DEPARTMENT_STYLES: Record<
  Department,
  { label: string; short: string; bg: string; border: string; text: string; dot: string }
> = {
  Engineering: {
    label: 'Engineering (TMS)',
    short: 'ENGG',
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    text: 'text-blue-800',
    dot: 'bg-blue-600',
  },
  'S&T': {
    label: 'Signalling & Telecom (SMMS)',
    short: 'S&T',
    bg: 'bg-green-50',
    border: 'border-green-300',
    text: 'text-green-800',
    dot: 'bg-green-600',
  },
  Traction_TRD: {
    label: 'Traction / TRD (TDMS)',
    short: 'TRD',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-800',
    dot: 'bg-amber-600',
  },
}

/** Maps a loose CSV/AI department string onto the canonical enum value. */
export function normalizeDepartment(value: unknown): Department | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!raw) return null

  if (raw.startsWith('eng') || raw === 'tms' || raw === 'p.way' || raw === 'pway') {
    return 'Engineering'
  }
  if (
    raw === 's&t' ||
    raw === 'snt' ||
    raw === 'smms' ||
    raw.startsWith('signal') ||
    raw.startsWith('telecom')
  ) {
    return 'S&T'
  }
  if (
    raw.startsWith('traction') ||
    raw.startsWith('trd') ||
    raw === 'tdms' ||
    raw.startsWith('ohe') ||
    raw.includes('electric')
  ) {
    return 'Traction_TRD'
  }
  return null
}

/** Default source system for a department, used when a CSV omits the column. */
export function defaultSystemSource(department: Department): SystemSource {
  switch (department) {
    case 'Engineering':
      return 'TMS'
    case 'S&T':
      return 'SMMS'
    case 'Traction_TRD':
      return 'TDMS'
  }
}

/** Buckets a 0-100 risk score into a priority label for display. */
export function riskToPriority(score: number): PriorityLevel {
  if (score >= 80) return 'Critical'
  if (score >= 60) return 'High'
  if (score >= 40) return 'Medium'
  return 'Low'
}
