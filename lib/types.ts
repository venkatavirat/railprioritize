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
  /** Kilometre post of the work site, when the source supplies one. */
  chainage_km?: number | null
  chainage_start_km?: number | null
  chainage_end_km?: number | null
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
  /** The window the AI originally proposed, preserved across edits. */
  original_block_start?: string | null
  original_block_end?: string | null
  approved_by?: string | null
  approval_timestamp?: string | null
  rejection_reason?: string | null
  permit_number?: string | null
  chainage_start_km?: number | null
  chainage_end_km?: number | null
  safety_flags?: {
    requiresSpeedRestriction?: boolean
    notes?: string[]
  } | null
  coa_window_ref?: string | null
  created_at?: string
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
  /** Computed in code, not by the model — see DowntimeMetrics. */
  downtime_metrics?: DowntimeMetrics
}

/**
 * Before-vs-after downtime accounting.
 *
 * Derived arithmetically from the plan rather than asked of the model: these
 * numbers are quoted to a Sr. DEN, and a language model is the wrong tool for
 * summing hours.
 */
export type DowntimeMetrics = {
  /** Track hours if every department took its own separate block. */
  total_uncoordinated_hours: number
  /** Wall-clock track hours once bundled into joint blocks. */
  joint_block_hours: number
  /** ((uncoordinated - joint) / uncoordinated) * 100. */
  downtime_reduction_percent: number
  /** Estimated passenger delay avoided; see DELAY_ASSUMPTIONS. */
  passenger_delay_minutes_saved: number
  /** Tasks folded into shared blocks. */
  tasks_planned: number
  /** Blocks in the plan. */
  blocks_planned: number
  /**
   * Blocks whose window is shorter than their longest single task, so they
   * cannot physically be executed as scheduled. Any value above zero makes
   * `downtime_reduction_percent` unreliable — the "saving" is then partly an
   * artefact of compressing work into time that does not exist.
   */
  blocks_not_executable: number
}

/**
 * Planning coefficients behind `passenger_delay_minutes_saved`.
 *
 * These are stated assumptions, not measurements: the corridor feed carries a
 * traffic *density band* rather than a train count, so the figure is an
 * order-of-magnitude planning aid and is labelled as such in the UI.
 */
export const DELAY_ASSUMPTIONS = {
  /** Trains per hour affected by a block, by traffic density band. */
  trainsPerHour: { High: 12, Medium: 6, Low: 2 } as Record<string, number>,
  /** Average minutes lost per affected train. */
  minutesPerTrain: 8,
} as const

// ---------------------------------------------------------------------------
// Block approval workflow
// ---------------------------------------------------------------------------

export const BLOCK_STATUSES = [
  'PROPOSED',
  'APPROVED',
  'MODIFIED',
  'REJECTED',
] as const
export type BlockStatus = (typeof BLOCK_STATUSES)[number]

export function isBlockStatus(value: unknown): value is BlockStatus {
  return (
    typeof value === 'string' && (BLOCK_STATUSES as readonly string[]).includes(value)
  )
}

export const BLOCK_STATUS_STYLES: Record<
  BlockStatus,
  { label: string; bg: string; border: string; text: string; dot: string }
> = {
  PROPOSED: {
    label: 'Proposed',
    bg: 'bg-slate-50',
    border: 'border-slate-300',
    text: 'text-slate-700',
    dot: 'bg-slate-500',
  },
  APPROVED: {
    label: 'Approved',
    bg: 'bg-green-50',
    border: 'border-green-300',
    text: 'text-green-800',
    dot: 'bg-green-600',
  },
  MODIFIED: {
    label: 'Modified',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-800',
    dot: 'bg-amber-600',
  },
  REJECTED: {
    label: 'Rejected',
    bg: 'bg-red-50',
    border: 'border-red-300',
    text: 'text-red-800',
    dot: 'bg-red-600',
  },
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
